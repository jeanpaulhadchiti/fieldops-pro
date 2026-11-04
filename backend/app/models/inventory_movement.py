
import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    String,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    CheckConstraint,
    UniqueConstraint,
    BigInteger,
    Numeric,
    Index,
    func,
)

from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class InventoryMovement(Base):
    __tablename__ = "inventory_movements"

    __table_args__ = (
        UniqueConstraint(
            "organization_id", "item_id", "sequence_number",
            name="uq_inventory_movements_item_sequence"
        ),
        CheckConstraint(
            "sequence_number > 0",
            name="ck_inventory_movements_sequence_positive"
        ),
        ForeignKeyConstraint(
            ["item_id", "organization_id"],
            [
                "inventory_items.id",
                "inventory_items.organization_id"
            ],
            name="fk_inventory_movements_item_org"
        ),

        CheckConstraint(
            "movement_type IN ('opening', 'receive', 'issue', 'return', 'adjustment')",
            name="ck_inventory_movements_type"
        ),

        CheckConstraint(
            "quantity_delta <> 0",
            name="ck_inventory_movements_nonzero"
        ),

        CheckConstraint(
            "quantity_before >= 0",
            name="ck_inventory_movements_before"
        ),

        CheckConstraint(
            "quantity_after >= 0",
            name="ck_inventory_movements_after"
        ),

        CheckConstraint(
            "quantity_delta <> 'NaN'::numeric "
            "AND quantity_delta <> 'Infinity'::numeric "
            "AND quantity_delta <> '-Infinity'::numeric",
            name="ck_inventory_movements_quantity_delta_finite"
        ),

        CheckConstraint(
            "quantity_before <> 'NaN'::numeric "
            "AND quantity_before <> 'Infinity'::numeric "
            "AND quantity_before <> '-Infinity'::numeric",
            name="ck_inventory_movements_quantity_before_finite"
        ),

        CheckConstraint(
            "quantity_after <> 'NaN'::numeric "
            "AND quantity_after <> 'Infinity'::numeric "
            "AND quantity_after <> '-Infinity'::numeric",
            name="ck_inventory_movements_quantity_after_finite"
        ),

        CheckConstraint(
            "quantity_after = quantity_before + quantity_delta",
            name="ck_inventory_movements_balance"
        ),

        CheckConstraint(
            """(
                movement_type IN ('opening', 'receive', 'return')
                AND quantity_delta > 0
            ) OR (
                movement_type = 'issue'
                AND quantity_delta < 0
            ) OR (
                movement_type = 'adjustment'
                AND quantity_delta <> 0
            )""",
            name="ck_inventory_movements_direction"
        ),

        Index(
            "ix_inventory_movements_item_created",
            "item_id",
            "created_at"
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

    item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        nullable=False
    )

    # Allocated under the inventory item lock, independently of transaction time.
    sequence_number: Mapped[int] = mapped_column(
        BigInteger,
        nullable=False
    )

    movement_type: Mapped[str] = mapped_column(
        String(20),
        nullable=False
    )

    quantity_delta: Mapped[Decimal] = mapped_column(
        Numeric(12, 2),
        nullable=False
    )

    quantity_before: Mapped[Decimal] = mapped_column(
        Numeric(12, 2),
        nullable=False
    )

    quantity_after: Mapped[Decimal] = mapped_column(
        Numeric(12, 2),
        nullable=False
    )

    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        nullable=True
    )

    notes: Mapped[str | None] = mapped_column(
        String(1000),
        nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False
    )
