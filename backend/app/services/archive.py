
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


# CONVERT VALUE TO UUID
def _uuid(value):
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        return None


# FIND THE ORGANIZATION ASSOCIATED WITH A REQUEST
def _target_organization(db, values):
    """
    Resolve the organization from the route's canonical resource.

    Existing endpoint authorization checks still apply.
    """

    if identity := _uuid(values.get("organization_id")):
        return identity

    event_id = _uuid(values.get("event_id"))

    if not event_id and (
        identity := _uuid(values.get("registration_id"))
    ):
        registration = db.get(Registration, identity)
        event_id = registration.event_id if registration else None

    task_id = _uuid(values.get("task_id"))

    if not task_id and (
        identity := _uuid(values.get("assignment_id"))
    ):
        assignment = db.get(TaskAssignment, identity)
        task_id = assignment.task_id if assignment else None

    if not event_id and task_id:
        task = db.get(Task, task_id)
        event_id = task.event_id if task else None

    if event_id:
        event = db.get(Event, event_id)
        return event.organization_id if event else None

    return None


# BLOCK CHANGES TO ARCHIVED ORGANIZATIONS
def _guard_mutation(db, user_id, values):
    organization_id = _target_organization(db, values)

    if organization_id is None:
        return

    # Check active organization membership
    membership = db.scalar(
        select(Membership).where(
            Membership.organization_id == organization_id,
            Membership.user_id == user_id,
            Membership.status == "active",
        )
    )

    # Nonmembers are handled by the endpoint's own
    # authorization and organization discovery checks.
    #
    # Join submissions are available to nonmembers.
    # Their service performs additional checks.
    if membership is None:
        return

    # Lock the organization row before allowing writes.
    #
    # FOR UPDATE serializes inventory/workflow writes
    # with organization archive and restore operations.
    organization = db.scalar(
        select(Organization)
        .where(Organization.id == organization_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )

    if (
        organization is not None
        and organization.archived_at is not None
    ):
        raise HTTPException(
            status_code=409,
            detail=(
                "This organization is archived. "
                "Its Owner must restore it before "
                "changes can be made."
            )
        )


# SHARED FASTAPI WORKSPACE MUTATION GUARD
async def guard_workspace_mutation(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Protect organization/workflow write endpoints.

    Read-only requests remain available.
    Mutation requests are checked against the
    organization's archive state.
    """

    # Read-only HTTP methods do not modify data
    if request.method in {"GET", "HEAD", "OPTIONS"}:
        return

    payload = {}

    content_type = request.headers.get(
        "content-type",
        ""
    )

    media_type = Message()
    media_type["content-type"] = content_type

    # Support standard JSON, omitted Content-Type,
    # and application/*+json media types.
    is_json = not content_type or (
        media_type.get_content_maintype() == "application"
        and (
            media_type.get_content_subtype() == "json"
            or media_type.get_content_subtype().endswith("+json")
        )
    )

    if is_json:
        try:
            payload = await request.json()
        except ValueError:
            payload = {}

        if not isinstance(payload, dict):
            payload = {}

    elif media_type.get_content_type() in {
        "multipart/form-data",
        "application/x-www-form-urlencoded",
    }:
        form = await request.form()

        payload = {
            "organization_id": form.get("organization_id")
        }

    # Use only canonical path identifiers.
    #
    # Unrelated organization_id fields supplied by clients
    # must not override the route's actual resource scope.
    canonical_fields = (
        "organization_id",
        "event_id",
        "registration_id",
        "task_id",
        "assignment_id",
    )

    values = {
        field: request.path_params[field]
        for field in canonical_fields
        if field in request.path_params
    }

    if not values:
        route_path = request.scope["route"].path

        # CREATE OPERATIONS
        #
        # These endpoints identify the organization
        # using a field in the request body.
        creation_scope = {
            # Inventory Management
            "/api/v1/inventory/categories":
                "organization_id",

            "/api/v1/inventory/locations":
                "organization_id",

            "/api/v1/inventory/items":
                "organization_id",

            "/api/v1/inventory/movements":
                "organization_id",

            # Existing FieldOps Pro endpoints
            "/api/v1/events":
                "organization_id",

            "/api/v1/participants":
                "organization_id",

            "/api/v1/participants/import":
                "organization_id",

            "/api/v1/participants/import/preview":
                "organization_id",

            "/api/v1/registrations":
                "event_id",

            "/api/v1/registrations/bulk":
                "event_id",

            "/api/v1/tasks":
                "event_id",

            "/api/v1/task-assignments":
                "task_id",
        }

        # UPDATE, DELETE, ARCHIVE AND RESTORE OPERATIONS
        #
        # These inventory endpoints use organization_id
        # in the URL query parameters.
        inventory_query_scope = {
            "/api/v1/inventory/categories/{category_id}":
                "organization_id",

            "/api/v1/inventory/locations/{location_id}":
                "organization_id",

            "/api/v1/inventory/items/{item_id}":
                "organization_id",

            "/api/v1/inventory/items/{item_id}/restore":
                "organization_id",
        }

        # Resolve organization scope from JSON/form body
        if field := creation_scope.get(route_path):
            values = {
                field: payload.get(field)
            }

        # Resolve organization scope from query parameters
        elif field := inventory_query_scope.get(route_path):
            values = {
                field: request.query_params.get(field)
            }

    # Run the database guard using the shared session.
    await run_in_threadpool(
        _guard_mutation,
        db,
        current_user.id,
        values
    )


# REQUIRE ACTIVE OWNER
def require_owner(
    db,
    organization_id,
    user_id
):
    membership = db.scalar(
        select(Membership)
        .where(
            Membership.organization_id == organization_id,
            Membership.user_id == user_id,
            Membership.status == "active",
        )
        .execution_options(populate_existing=True)
    )

    if membership is None:
        raise HTTPException(
            status_code=404,
            detail="Organization not found"
        )

    if membership.role != "Owner":
        raise HTTPException(
            status_code=403,
            detail=(
                "Only the active Owner can archive "
                "or restore this organization"
            )
        )


# ARCHIVE OR RESTORE AN ORGANIZATION
def change_archive_state(
    db,
    user,
    organization_id,
    data,
    archive
):
    # Step 1: Verify the user is an Owner
    require_owner(
        db,
        organization_id,
        user.id
    )

    # Step 2: Lock the organization row
    organization = db.scalar(
        select(Organization)
        .where(
            Organization.id == organization_id
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )

    if organization is None:
        raise HTTPException(
            status_code=404,
            detail="Organization not found"
        )

    # Step 3: Recheck ownership after acquiring lock
    require_owner(
        db,
        organization_id,
        user.id
    )

    # Step 4: Verify confirmation name
    if data.confirmation_name != organization.name:
        raise HTTPException(
            status_code=422,
            detail=(
                "Enter the organization's current "
                "name exactly to confirm"
            )
        )

    # Step 5: Update archive state only if needed
    if bool(organization.archived_at) != archive:
        if archive:
            organization.archived_at = datetime.now(
                timezone.utc
            )
            organization.archived_by = user.id
        else:
            organization.archived_at = None
            organization.archived_by = None

        # Record the lifecycle operation
        db.add(
            OrganizationArchiveEvent(
                organization_id=organization.id,
                actor_id=user.id,
                action=(
                    "archive"
                    if archive
                    else "restore"
                )
            )
        )

    # Step 6: Save and return
    db.commit()
    db.refresh(organization)

    return organization
