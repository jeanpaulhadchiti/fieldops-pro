"""Join notification writes belong to the same transaction as the request."""

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert

from app.models.membership import Membership
from app.models.notification import Notification


def notify_join_request(db, request):
    owners = db.scalars(select(Membership.user_id).where(
        Membership.organization_id == request.organization_id,
        Membership.status == "active", Membership.role == "Owner",
    )).all()
    for recipient_id in owners:
        db.execute(insert(Notification).values(
            recipient_id=recipient_id, organization_id=request.organization_id,
            join_request_id=request.id,
        ).on_conflict_do_nothing(constraint="uq_notification_recipient_request"))


def update_join_notifications(db, request):
    # The request row remains the status source of truth. Reviewing changes the
    # existing notification rather than adding another one. Owners see the new
    # decision as unread, including decisions made by an Admin.
    db.execute(update(Notification).where(
        Notification.join_request_id == request.id,
        Notification.organization_id == request.organization_id,
    ).values(updated_at=request.reviewed_at, read_at=None))
