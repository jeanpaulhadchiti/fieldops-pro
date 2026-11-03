
import uuid
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, ForeignKey, Index, String, Text, DateTime, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base
from app.organization_names import normalize_organization_name


class Organization(Base):
    __tablename__ = "organizations"
    __table_args__ = (
        CheckConstraint("organization_type IN ('Scout Group', 'Sports Club', 'NGO', 'Other')", name="ck_organization_type"),
        Index("ix_organizations_discovery", "normalized_name", postgresql_where=text("is_discoverable = true")),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4
    )

    name: Mapped[str] = mapped_column(
        String(150),
        nullable=False
    )

    normalized_name: Mapped[str] = mapped_column(
        String(450), nullable=False, server_default="",
        default=lambda context: normalize_organization_name(context.get_current_parameters()["name"]),
    )
    organization_type: Mapped[str] = mapped_column(String(30), nullable=False, default="Other", server_default="Other")
    organization_type_other: Mapped[str | None] = mapped_column(String(100), nullable=True)
    country: Mapped[str | None] = mapped_column(String(100), nullable=True)
    city: Mapped[str | None] = mapped_column(String(100), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_discoverable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    archived_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False
    )
