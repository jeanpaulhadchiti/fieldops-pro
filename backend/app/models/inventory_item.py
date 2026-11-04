
import uuid
from decimal import Decimal
from datetime import datetime

from sqlalchemy import (
    String,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    UniqueConstraint,
    CheckConstraint,
    Numeric,
    Boolean,
    func,
)

from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class InventoryItem(Base):
    __tablename__ = "inventory_items"

    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "sku",
            name="uq_inventory_items_org_sku"
        ),
        UniqueConstraint(
    "id",
    "organization_id",
    name="uq_inventory_items_id_org"
),

        CheckConstraint(
            "current_quantity >= 0",
            name="ck_inventory_items_quantity"
        ),

        CheckConstraint(
            "minimum_quantity >= 0",
            name="ck_inventory_items_minimum"
        ),

        CheckConstraint(
            "current_quantity <> 'NaN'::numeric "
            "AND current_quantity <> 'Infinity'::numeric "
            "AND current_quantity <> '-Infinity'::numeric",
            name="ck_inventory_items_current_quantity_finite"
        ),

        CheckConstraint(
            "minimum_quantity <> 'NaN'::numeric "
            "AND minimum_quantity <> 'Infinity'::numeric "
            "AND minimum_quantity <> '-Infinity'::numeric",
            name="ck_inventory_items_minimum_quantity_finite"
        ),

        CheckConstraint(
            "item_type IN ('consumable', 'reusable')",
            name="ck_inventory_items_type"
        ),

        ForeignKeyConstraint(
            ["category_id", "organization_id"],
            [
                "inventory_categories.id",
                "inventory_categories.organization_id"
            ],
            name="fk_inventory_items_category_org"
        ),

        ForeignKeyConstraint(
            ["location_id", "organization_id"],
            [
                "storage_locations.id",
                "storage_locations.organization_id"
            ],
            name="fk_inventory_items_location_org"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4
    )

    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.id"),
        nullable=False,
        index=True
    )

    category_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        nullable=True
    )

    location_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        nullable=True
    )

    name: Mapped[str] = mapped_column(
        String(150),
        nullable=False
    )

    sku: Mapped[str | None] = mapped_column(
        String(50),
        nullable=True
    )

    unit: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        server_default="piece"
    )

    item_type: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        server_default="reusable"
    )

    current_quantity: Mapped[Decimal] = mapped_column(
        Numeric(12, 2),
        nullable=False,
        server_default="0"
    )

    minimum_quantity: Mapped[Decimal] = mapped_column(
        Numeric(12, 2),
        nullable=False,
        server_default="0"
    )

    archived: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default="false"
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False
    )
