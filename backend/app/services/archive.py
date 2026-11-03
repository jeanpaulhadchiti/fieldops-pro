"""Workspace mutation guard and reversible, Owner-only lifecycle operations."""

import uuid
from datetime import datetime, timezone
from email.message import Message

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.database import get_db
from app.dependencies import get_current_user
from app.models.event import Event
from app.models.membership import Membership
from app.models.organization import Organization
from app.models.organization_archive_event import OrganizationArchiveEvent
from app.models.registration import Registration
from app.models.task import Task
from app.models.task_assignment import TaskAssignment
from app.models.user import User


def _uuid(value):
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        return None


def _target_organization(db, values):
    """Resolve only a route's primary scope; existing RBAC checks still apply."""
    if identity := _uuid(values.get("organization_id")):
        return identity
    event_id = _uuid(values.get("event_id"))
    if not event_id and (identity := _uuid(values.get("registration_id"))):
        registration = db.get(Registration, identity)
        event_id = registration.event_id if registration else None
    task_id = _uuid(values.get("task_id"))
    if not task_id and (identity := _uuid(values.get("assignment_id"))):
        assignment = db.get(TaskAssignment, identity)
        task_id = assignment.task_id if assignment else None
    if not event_id and task_id:
        task = db.get(Task, task_id)
        event_id = task.event_id if task else None
    if event_id:
        event = db.get(Event, event_id)
        return event.organization_id if event else None
    return None


def _guard_mutation(db, user_id, values):
    organization_id = _target_organization(db, values)
    if organization_id is None:
        return
    membership = db.scalar(select(Membership).where(
        Membership.organization_id == organization_id, Membership.user_id == user_id,
        Membership.status == "active",
    ))
    # Join submissions are intentionally available to nonmembers. Their service
    # repeats discovery/archive checks after its independent rate-limit commit.
    # For all other routes, existing handlers retain their generic denial.
    if membership is None:
        return
    # Serialize a write with archive/restore before the handler acquires child
    # row locks, avoiding archive/write races and inconsistent lock ordering.
    organization = db.scalar(select(Organization).where(Organization.id == organization_id)
        .with_for_update(key_share=True).execution_options(populate_existing=True))
    if organization is not None and organization.archived_at is not None:
        raise HTTPException(409, "This organization is archived. Its Owner must restore it before changes can be made.")


async def guard_workspace_mutation(request: Request, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Installed on every organization/workflow router, including bulk imports."""
    if request.method in {"GET", "HEAD", "OPTIONS"}:
        return
    payload = {}
    content_type = request.headers.get("content-type", "")
    media_type = Message()
    media_type["content-type"] = content_type
    # Match FastAPI's JSON detection, including omitted Content-Type and
    # vendor application/*+json types, so accepted requests cannot bypass scope.
    is_json = not content_type or (
        media_type.get_content_maintype() == "application" and (
            media_type.get_content_subtype() == "json" or media_type.get_content_subtype().endswith("+json")
        )
    )
    if is_json:
        try:
            payload = await request.json()
        except ValueError:
            payload = {}
        if not isinstance(payload, dict):
            payload = {}
    elif media_type.get_content_type() in {"multipart/form-data", "application/x-www-form-urlencoded"}:
        form = await request.form()
        payload = {"organization_id": form.get("organization_id")}
    # Only the route's canonical resource selects the scope. Historical schemas
    # ignore extra fields, so an attacker can add an unrelated organization_id
    # to a task/registration body or query string. Never trust those extras.
    canonical_fields = ("organization_id", "event_id", "registration_id", "task_id", "assignment_id")
    values = {field: request.path_params[field] for field in canonical_fields if field in request.path_params}
    if not values:
        route_path = request.scope["route"].path
        creation_scope = {
            "/api/v1/events": "organization_id",
            "/api/v1/participants": "organization_id",
            "/api/v1/participants/import": "organization_id",
            "/api/v1/participants/import/preview": "organization_id",
            "/api/v1/registrations": "event_id",
            "/api/v1/registrations/bulk": "event_id",
            "/api/v1/tasks": "event_id",
            "/api/v1/task-assignments": "task_id",
        }
        if field := creation_scope.get(route_path):
            values = {field: payload.get(field)}
    await run_in_threadpool(_guard_mutation, db, current_user.id, values)


def require_owner(db, organization_id, user_id):
    membership = db.scalar(select(Membership).where(
        Membership.organization_id == organization_id, Membership.user_id == user_id, Membership.status == "active",
    ).execution_options(populate_existing=True))
    if membership is None:
        raise HTTPException(404, "Organization not found")
    if membership.role != "Owner":
        raise HTTPException(403, "Only the active Owner can archive or restore this organization")


def change_archive_state(db, user, organization_id, data, archive):
    require_owner(db, organization_id, user.id)
    organization = db.scalar(select(Organization).where(Organization.id == organization_id)
        .with_for_update(key_share=True).execution_options(populate_existing=True))
    if organization is None:
        raise HTTPException(404, "Organization not found")
    require_owner(db, organization_id, user.id)
    if data.confirmation_name != organization.name:
        raise HTTPException(422, "Enter the organization's current name exactly to confirm")
    # Repeat submissions are safe and do not manufacture extra history records.
    if bool(organization.archived_at) != archive:
        organization.archived_at = datetime.now(timezone.utc) if archive else None
        organization.archived_by = user.id if archive else None
        db.add(OrganizationArchiveEvent(organization_id=organization.id, actor_id=user.id, action="archive" if archive else "restore"))
    db.commit()
    db.refresh(organization)
    return organization
