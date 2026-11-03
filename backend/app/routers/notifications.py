import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.membership import Membership
from app.models.notification import Notification
from app.models.organization import Organization
from app.models.organization_join_request import OrganizationJoinRequest
from app.models.user import User
from app.schemas.notification import NotificationPage, NotificationReadUpdate, NotificationResponse


router = APIRouter(prefix="/notifications", tags=["Notifications"])


def recipient_query(user_id):
    # Revoking/demoting a recipient also revokes notification visibility. Never
    # accept a recipient or organization filter supplied by the client.
    return (select(Notification, Organization.name.label("organization_name"),
                   User.name.label("applicant_name"), OrganizationJoinRequest.status)
        .join(Organization, Organization.id == Notification.organization_id)
        .join(OrganizationJoinRequest,
              (OrganizationJoinRequest.id == Notification.join_request_id)
              & (OrganizationJoinRequest.organization_id == Notification.organization_id))
        .join(User, User.id == OrganizationJoinRequest.user_id)
        .join(Membership, (Membership.organization_id == Notification.organization_id)
              & (Membership.user_id == user_id)
              & (Membership.status == "active") & (Membership.role == "Owner"))
        .where(Notification.recipient_id == user_id))


def response(row):
    notification, organization_name, applicant_name, status = row
    return NotificationResponse(
        id=notification.id, organization_id=notification.organization_id,
        organization_name=organization_name, join_request_id=notification.join_request_id,
        applicant_name=applicant_name, status=status,
        created_at=notification.created_at, updated_at=notification.updated_at, read_at=notification.read_at,
    )


@router.get("", response_model=NotificationPage)
def list_notifications(
    page: int = Query(default=1, ge=1, le=10000),
    page_size: int = Query(default=20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    scoped = recipient_query(current_user.id)
    unread_count = db.scalar(select(func.count()).select_from(
        scoped.where(Notification.read_at.is_(None)).subquery()))
    rows = db.execute(scoped.order_by(Notification.updated_at.desc(), Notification.id)
                      .offset((page - 1) * page_size).limit(page_size + 1)).all()
    return NotificationPage(items=[response(row) for row in rows[:page_size]],
                            unread_count=unread_count, has_more=len(rows) > page_size)


@router.patch("/{notification_id}", response_model=NotificationResponse)
def set_notification_read(
    notification_id: uuid.UUID,
    data: NotificationReadUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.execute(recipient_query(current_user.id).where(Notification.id == notification_id)
                     .with_for_update(of=Notification)).first()
    if row is None:
        raise HTTPException(404, "Notification not found")
    notification = row[0]
    notification.read_at = (notification.read_at or datetime.now(timezone.utc)) if data.is_read else None
    try:
        db.flush()
        result = response(row)
        db.commit()
        return result
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(500, "Could not update notification")
