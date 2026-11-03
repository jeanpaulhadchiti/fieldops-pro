import uuid
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.exc import SQLAlchemyError, IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy import select
from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.models.organization import Organization
from app.models.membership import Membership
from app.schemas.organization import OrganizationCreate, OrganizationResponse, OrganizationSettings, OrganizationDiscoveryResult, OrganizationType
from app.schemas.membership import MembershipResponse, MemberAddRequest, MemberRoleUpdate
from app.organization_names import normalize_organization_name
from app.countries import normalize_country
from app.services.onboarding import discover, name_lock, organization_lock, rate_limit, require_reviewer

router = APIRouter(
    prefix="/organizations",
    tags=["Organizations"]
)


@router.post(
    "",
    response_model=OrganizationResponse,
    status_code=status.HTTP_201_CREATED
)
def create_organization(
    organization_data: OrganizationCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    user_id = current_user.id
    rate_limit(db, user_id, "create_organization")
    try:
        name_lock(db, organization_data.name)
        # Only discoverable workspaces participate in a user-facing warning.
        # Private organizations do not change the response or become a side channel.
        # Keep differing location/type visible for human comparison: legitimate
        # namesakes can acknowledge the warning and create a distinct workspace.
        matches = discover(db, organization_data.name) if len(normalize_organization_name(organization_data.name)) >= 3 else []
        if matches and not organization_data.allow_possible_duplicate:
            raise HTTPException(409, {
                "code": "possible_duplicate",
                "message": "A discoverable organization may already match. Review it or confirm this is a distinct organization.",
                "matches": [match.model_dump(mode="json") for match in matches],
            })
        new_organization = Organization(
            **organization_data.model_dump(exclude={"allow_possible_duplicate"}),
            normalized_name=normalize_organization_name(organization_data.name),
        )
        db.add(new_organization)
        db.flush()

        membership = Membership(
            user_id=user_id,
            organization_id=new_organization.id,
            role="Owner",
            status="active"
        )

        db.add(membership)
        db.commit()

        db.refresh(new_organization)

    except HTTPException:
        db.rollback()
        raise
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Could not create organization"
        )

    return new_organization


@router.get("", response_model=list[OrganizationResponse])
def get_my_organizations(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):

    organizations = db.scalars(
        select(Organization)
        .join(
            Membership,
            Membership.organization_id == Organization.id
        )
        .where(
            Membership.user_id == current_user.id,
            Membership.status == "active"
        )
    ).all()

    return organizations


@router.get("/discover", response_model=OrganizationDiscoveryResult)
def discover_organizations(
    q: str = Query(min_length=3, max_length=150),
    organization_type: OrganizationType | None = None,
    country: str | None = Query(default=None, max_length=100),
    city: str | None = Query(default=None, max_length=100),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rate_limit(db, current_user.id, "discovery")
    return {"matches": discover(db, q, organization_type, country, city)}


@router.patch("/{organization_id}/settings", response_model=OrganizationResponse)
def update_organization_settings(
    organization_id: uuid.UUID,
    data: OrganizationSettings,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_reviewer(db, organization_id, current_user.id)
    try:
        organization = organization_lock(db, organization_id)
        require_reviewer(db, organization_id, current_user.id)
        changes = data.model_dump(exclude_unset=True)
        if "country" in changes:
            try:
                changes["country"] = normalize_country(changes["country"])
            except ValueError:
                if changes["country"] != organization.country:
                    raise HTTPException(422, "Select a valid ISO 3166-1 country")
                # An unchanged historical free-text location is preserved.
        final_type = changes.get("organization_type", organization.organization_type)
        final_other = changes.get("organization_type_other", organization.organization_type_other)
        if final_type == "Other":
            # Unrelated edits to legacy Other records remain possible. Explicit
            # selection or modification of Other must supply a meaningful label.
            if ("organization_type" in changes or "organization_type_other" in changes) and not final_other:
                raise HTTPException(422, "Specify organization type when selecting Other")
        else:
            changes["organization_type_other"] = None
        for field, value in changes.items():
            setattr(organization, field, value)
        organization.normalized_name = normalize_organization_name(organization.name)
        db.commit()
        db.refresh(organization)
        return organization
    except HTTPException:
        db.rollback()
        raise
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(500, "Could not update organization settings")


@router.get("/{organization_id}", response_model=OrganizationResponse)
def get_organization(
    organization_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):

    membership = db.scalar(
        select(Membership).where(
            Membership.organization_id == organization_id,
            Membership.user_id == current_user.id,
            Membership.status == "active"
        )
    )

    if membership is None:
        raise HTTPException(
            status_code=404,
            detail="Organization not found"
        )

    organization = db.get(Organization, organization_id)

    if organization is None:
        raise HTTPException(
            status_code=404,
            detail="Organization not found"
        )

    return organization


@router.get(
    "/{organization_id}/members",
    response_model=list[MembershipResponse]
)
def get_organization_members(
    organization_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):

    membership = db.scalar(
        select(Membership).where(
            Membership.organization_id == organization_id,
            Membership.user_id == current_user.id,
            Membership.status == "active"
        )
    )

    if membership is None:
        raise HTTPException(
            status_code=404,
            detail="Organization not found"
        )

    members = db.execute(
        select(
            Membership.id,
            Membership.user_id,
            User.name,
            User.email,
            Membership.role,
            Membership.status,
            Membership.created_at
        )
        .join(User, Membership.user_id == User.id)
        .where(
            Membership.organization_id == organization_id
        )
    ).mappings().all()

    return [dict(member) for member in members]

@router.post(
    "/{organization_id}/members",
    response_model=MembershipResponse,
    status_code=status.HTTP_201_CREATED
)
def add_organization_member(
    organization_id: uuid.UUID,
    member_data: MemberAddRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):

    current_membership = db.scalar(
        select(Membership).where(
            Membership.organization_id == organization_id,
            Membership.user_id == current_user.id,
            Membership.status == "active"
        )
    )

    if current_membership is None:
        raise HTTPException(
            status_code=404,
            detail="Organization not found"
        )

    if current_membership.role not in ["Owner", "Admin"]:
        raise HTTPException(
            status_code=403,
            detail="Permission denied"
        )

    if member_data.role == "Admin" and current_membership.role != "Owner":
        raise HTTPException(
            status_code=403,
            detail="Only the Owner can assign Admin role"
        )

    # Membership creation and join approval share this lock. The unique
    # user/organization constraint remains the final duplicate safeguard.
    organization_lock(db, organization_id)
    current_membership = require_reviewer(db, organization_id, current_user.id)
    if member_data.role == "Admin" and current_membership.role != "Owner":
        raise HTTPException(403, "Only the Owner can assign Admin role")

    email = str(member_data.email).lower()

    user = db.scalar(
        select(User).where(User.email == email)
    )

    if user is None:
        raise HTTPException(
            status_code=404,
            detail="User not found"
        )

    existing_membership = db.scalar(
        select(Membership).where(
            Membership.organization_id == organization_id,
            Membership.user_id == user.id
        )
    )

    if existing_membership:
        raise HTTPException(
            status_code=409,
            detail="User is already a member"
        )

    new_membership = Membership(
        user_id=user.id,
        organization_id=organization_id,
        role=member_data.role,
        status="active"
    )

    db.add(new_membership)

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="User is already a member"
        )

    db.refresh(new_membership)

    return {
        "id": new_membership.id,
        "user_id": user.id,
        "name": user.name,
        "email": user.email,
        "role": new_membership.role,
        "status": new_membership.status,
        "created_at": new_membership.created_at
    }


@router.patch(
    "/{organization_id}/members/{membership_id}/role",
    response_model=MembershipResponse
)
def update_member_role(
    organization_id: uuid.UUID,
    membership_id: uuid.UUID,
    role_data: MemberRoleUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):

    current_membership = db.scalar(
        select(Membership).where(
            Membership.organization_id == organization_id,
            Membership.user_id == current_user.id,
            Membership.status == "active"
        )
    )

    if current_membership is None:
        raise HTTPException(
            status_code=404,
            detail="Organization not found"
        )

    if current_membership.role not in ["Owner", "Admin"]:
        raise HTTPException(
            status_code=403,
            detail="Permission denied"
        )

    # Role writes coordinate with approvals/settings and recheck authorization
    # after waiting, so a stale Admin snapshot cannot promote another member.
    organization_lock(db, organization_id)
    current_membership = require_reviewer(db, organization_id, current_user.id)

    target_membership = db.scalar(
        select(Membership).where(
            Membership.id == membership_id,
            Membership.organization_id == organization_id,
            Membership.status == "active"
        )
    )

    if target_membership is None:
        raise HTTPException(
            status_code=404,
            detail="Member not found"
        )

    if target_membership.role == "Owner":
        raise HTTPException(
            status_code=403,
            detail="Cannot change Owner role"
        )

    if current_membership.role == "Admin":
        if target_membership.role == "Admin":
            raise HTTPException(
                status_code=403,
                detail="Admin cannot modify another Admin"
            )

        if role_data.role == "Admin":
            raise HTTPException(
                status_code=403,
                detail="Only Owner can assign Admin role"
            )

    if target_membership.user_id == current_user.id:
        raise HTTPException(
            status_code=403,
            detail="Cannot change your own role"
        )

    target_membership.role = role_data.role

    try:
        db.commit()
        db.refresh(target_membership)
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Could not update member role"
        )

    user = db.get(User, target_membership.user_id)

    return {
        "id": target_membership.id,
        "user_id": user.id,
        "name": user.name,
        "email": user.email,
        "role": target_membership.role,
        "status": target_membership.status,
        "created_at": target_membership.created_at
    }
