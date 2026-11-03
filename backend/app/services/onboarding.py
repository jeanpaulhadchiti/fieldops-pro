"""Authenticated, bounded discovery and transactional membership onboarding."""

import hashlib
import math
from datetime import datetime, timedelta, timezone
from difflib import SequenceMatcher

from fastapi import HTTPException
from sqlalchemy import case, func, or_, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import SQLAlchemyError

from app.models.membership import Membership
from app.models.onboarding_rate_limit import OnboardingRateLimit
from app.models.organization import Organization
from app.models.organization_join_request import OrganizationJoinRequest
from app.models.user import User
from app.organization_names import normalize_organization_name
from app.countries import countries_match
from app.schemas.organization import OrganizationDiscoveryCard
from app.services.notifications import notify_join_request, update_join_notifications


RATE_LIMITS = {"discovery": (30, 60), "create_organization": (20, 600), "join_request": (10, 600)}


def rate_limit(db, user_id, action):
    """Consume before business writes; rejected requests cannot roll it back.

    One row per authenticated user/action bounds storage and uses PostgreSQL's
    atomic UPSERT row lock across all workers. No process-local limit bypass.
    """
    maximum, seconds = RATE_LIMITS[action]
    table = OnboardingRateLimit
    now = func.now()
    expired = table.window_started_at <= now - timedelta(seconds=seconds)
    statement = insert(table).values(user_id=user_id, action=action, window_started_at=now, attempt_count=1)
    statement = statement.on_conflict_do_update(
        index_elements=[table.user_id, table.action],
        set_={"window_started_at": case((expired, now), else_=table.window_started_at),
              "attempt_count": case((expired, 1), else_=table.attempt_count + 1)},
    ).returning(table.window_started_at, table.attempt_count)
    try:
        started, attempts = db.execute(statement).one()
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(503, "Onboarding is temporarily unavailable. Please try again later.")
    if attempts > maximum:
        wait = max(1, math.ceil(seconds - (datetime.now(timezone.utc) - started).total_seconds()))
        raise HTTPException(429, "Too many onboarding requests. Please wait before trying again.", headers={"Retry-After": str(wait)})


def name_lock(db, name):
    """Serialize duplicate-name check and creation without making names unique."""
    identity = ("organization-create:" + normalize_organization_name(name)).encode("utf-8")
    key = int.from_bytes(hashlib.sha256(identity).digest()[:8], "big", signed=True)
    db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": key})


def discover(db, query, organization_type=None, country=None, city=None):
    normalized = normalize_organization_name(query)
    if len(normalized) < 3:
        raise HTTPException(422, "Search using at least three characters")
    # No wildcard interpolation: contains/startswith escape SQL LIKE metacharacters.
    # A small candidate window permits typo suggestions without a PostgreSQL
    # extension, broad directory download, public counts, or member joins.
    prefix = normalized.split()[0][:3]
    candidates = db.scalars(select(Organization).where(
        Organization.is_discoverable.is_(True),
        Organization.archived_at.is_(None),
        or_(Organization.normalized_name.contains(normalized, autoescape=True),
            Organization.normalized_name.startswith(prefix, autoescape=True)),
    ).order_by((Organization.normalized_name == normalized).desc(), Organization.normalized_name, Organization.id).limit(200)).all()
    ranked = []
    for organization in candidates:
        if organization_type and organization.organization_type != organization_type:
            continue
        if country and not countries_match(organization.country, country):
            continue
        if city and normalize_organization_name(organization.city or "") != normalize_organization_name(city):
            continue
        candidate_name = organization.normalized_name
        exact = candidate_name == normalized
        ratio = SequenceMatcher(None, normalized, candidate_name, autojunk=False).ratio()
        tokens = set(normalized.split())
        other_tokens = set(candidate_name.split())
        overlap = len(tokens & other_tokens) / max(len(tokens | other_tokens), 1)
        if exact or normalized in candidate_name or ratio >= 0.72 or overlap >= 0.6:
            ranked.append((exact, ratio, organization))
    ranked.sort(key=lambda value: (not value[0], -value[1], value[2].normalized_name, str(value[2].id)))
    return [OrganizationDiscoveryCard(
        id=organization.id, name=organization.name, organization_type=organization.organization_type,
        organization_type_other=organization.organization_type_other,
        country=organization.country, city=organization.city, match_kind="exact" if exact else "similar",
    ) for exact, _, organization in ranked[:10]]


def require_reviewer(db, organization_id, user_id):
    membership = db.scalar(select(Membership).where(
        Membership.organization_id == organization_id, Membership.user_id == user_id, Membership.status == "active",
    ).execution_options(populate_existing=True))
    if membership is None:
        raise HTTPException(404, "Organization not found")
    if membership.role not in {"Owner", "Admin"}:
        raise HTTPException(403, "Only an active Owner or Admin can review join requests or manage organization settings")
    return membership


def organization_lock(db, organization_id):
    # NO KEY UPDATE coordinates imports, manual member additions, settings, and
    # approvals, while allowing foreign-key KEY SHARE checks from other writes.
    organization = db.scalar(select(Organization).where(Organization.id == organization_id)
                             .with_for_update(key_share=True).execution_options(populate_existing=True))
    if organization is None:
        raise HTTPException(404, "Organization not found")
    return organization


def membership_for(db, organization_id, user_id):
    return db.scalar(select(Membership).where(Membership.organization_id == organization_id, Membership.user_id == user_id)
                     .execution_options(populate_existing=True))


def request_response(db, request, organization=None, reviewer=False):
    organization = organization or db.get(Organization, request.organization_id)
    membership = membership_for(db, request.organization_id, request.user_id)
    result = {
        "id": request.id, "organization_id": request.organization_id, "organization_name": organization.name,
        "status": request.status, "message": request.message, "created_at": request.created_at,
        "reviewed_at": request.reviewed_at, "membership_active": bool(membership and membership.status == "active"),
    }
    if reviewer:
        applicant = db.get(User, request.user_id)
        result.update(user_id=request.user_id, applicant_name=applicant.name, applicant_email=applicant.email, reviewed_by=request.reviewed_by)
    return result


def create_join_request(db, current_user, organization_id, data):
    user_id = current_user.id
    rate_limit(db, user_id, "join_request")
    organization = organization_lock(db, organization_id)
    # Private and absent organizations share a response for nonmembers. Merely
    # knowing a UUID or a previously discoverable name grants no request access.
    if not organization.is_discoverable or organization.archived_at is not None:
        raise HTTPException(404, "Organization not found")
    membership = membership_for(db, organization_id, user_id)
    if membership and membership.status == "active":
        raise HTTPException(409, "You already have active access to this organization")
    pending = db.scalar(select(OrganizationJoinRequest).where(
        OrganizationJoinRequest.organization_id == organization_id,
        OrganizationJoinRequest.user_id == user_id, OrganizationJoinRequest.status == "pending",
    ))
    if pending:
        # Safe replay also covers pending requests created before notifications
        # were deployed; the recipient/request key prevents duplicate alerts.
        notify_join_request(db, pending)
        result = request_response(db, pending, organization)
        db.commit()
        return result, False
    request = OrganizationJoinRequest(organization_id=organization_id, user_id=user_id, message=data.message)
    db.add(request)
    db.flush()
    notify_join_request(db, request)
    result = request_response(db, request, organization)
    db.commit()
    return result, True


def review_join_request(db, current_user, organization_id, request_id, data):
    user_id = current_user.id
    require_reviewer(db, organization_id, user_id)
    organization = organization_lock(db, organization_id)
    # Recheck after waiting on the shared membership-write lock.
    if organization.archived_at is not None:
        raise HTTPException(409, "This organization is archived. Restore it before making changes.")
    require_reviewer(db, organization_id, user_id)
    request = db.scalar(select(OrganizationJoinRequest).where(
        OrganizationJoinRequest.id == request_id, OrganizationJoinRequest.organization_id == organization_id,
    ).with_for_update().execution_options(populate_existing=True))
    if request is None:
        raise HTTPException(404, "Join request not found")
    if request.user_id == user_id:
        raise HTTPException(403, "You cannot review your own join request")
    target_status = "approved" if data.decision == "approve" else "rejected"
    if request.status != "pending":
        if request.status != target_status:
            raise HTTPException(409, "This join request has already been reviewed with a different decision")
        result = request_response(db, request, organization, reviewer=True)
        db.commit()
        return result
    if data.decision == "approve":
        membership = membership_for(db, organization_id, request.user_id)
        if membership is None:
            db.add(Membership(organization_id=organization_id, user_id=request.user_id, role="Member", status="active"))
        elif membership.status != "active":
            if membership.role not in {"Member", "Viewer"}:
                raise HTTPException(409, "An existing privileged membership requires direct review by the organization Owner")
            membership.role = "Member"
            membership.status = "active"
        # Existing active membership roles are preserved, including Owner/Admin.
        # Approval never grants or replaces elevated permissions.
    request.status = target_status
    request.reviewed_at = datetime.now(timezone.utc)
    request.reviewed_by = user_id
    db.flush()
    update_join_notifications(db, request)
    result = request_response(db, request, organization, reviewer=True)
    db.commit()
    return result
