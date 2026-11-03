import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class OrganizationJoinRequest(Base):
    __tablename__ = "organization_join_requests"
    __table_args__ = (
        CheckConstraint("status IN ('pending', 'approved', 'rejected')", name="ck_join_request_status"),
        CheckConstraint("(status = 'pending' AND reviewed_at IS NULL AND reviewed_by IS NULL) OR (status <> 'pending' AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL)", name="ck_join_request_review"),
        CheckConstraint("reviewed_by IS NULL OR reviewed_by <> user_id", name="ck_join_request_no_self_review"),
        Index("uq_join_request_pending", "organization_id", "user_id", unique=True, postgresql_where=text("status = 'pending'")),
        Index("ix_join_requests_organization_status", "organization_id", "status", "created_at"),
        Index("ix_join_requests_user_created", "user_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending", server_default="pending")
    message: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
