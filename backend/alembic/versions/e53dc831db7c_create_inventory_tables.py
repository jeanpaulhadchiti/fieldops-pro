
"""create inventory tables

Revision ID: e53dc831db7c
Revises: e95a03
Create Date: 2026-11-03 11:49:30.221792
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# Revision identifiers, used by Alembic.
revision: str = "e53dc831db7c"
down_revision: Union[str, Sequence[str], None] = "e95a03"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create inventory tables."""

    # 1. Inventory Categories
    op.create_table(
        "inventory_categories",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("organization_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("description", sa.String(length=500), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"]
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "organization_id",
            "name",
            name="uq_inventory_categories_org_name"
        ),
        sa.UniqueConstraint(
            "id",
            "organization_id",
            name="uq_inventory_categories_id_org"
        ),
    )

    op.create_index(
        "ix_inventory_categories_organization_id",
        "inventory_categories",
        ["organization_id"],
        unique=False
    )

    # 2. Storage Locations
    op.create_table(
        "storage_locations",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("organization_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("description", sa.String(length=500), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"]
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "organization_id",
            "name",
            name="uq_storage_locations_org_name"
        ),
        sa.UniqueConstraint(
            "id",
            "organization_id",
            name="uq_storage_locations_id_org"
        ),
    )

    op.create_index(
        "ix_storage_locations_organization_id",
        "storage_locations",
        ["organization_id"],
        unique=False
    )

    # 3. Inventory Items
    op.create_table(
        "inventory_items",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("organization_id", sa.UUID(), nullable=False),
        sa.Column("category_id", sa.UUID(), nullable=True),
        sa.Column("location_id", sa.UUID(), nullable=True),
        sa.Column("name", sa.String(length=150), nullable=False),
        sa.Column("sku", sa.String(length=50), nullable=True),
        sa.Column(
            "unit",
            sa.String(length=20),
            server_default="piece",
            nullable=False
        ),
        sa.Column(
            "item_type",
            sa.String(length=20),
            server_default="reusable",
            nullable=False
        ),
        sa.Column(
            "current_quantity",
            sa.Numeric(precision=12, scale=2),
            server_default="0",
            nullable=False
        ),
        sa.Column(
            "minimum_quantity",
            sa.Numeric(precision=12, scale=2),
            server_default="0",
            nullable=False
        ),
        sa.Column(
            "archived",
            sa.Boolean(),
            server_default="false",
            nullable=False
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False
        ),

        sa.CheckConstraint(
            "item_type IN ('consumable', 'reusable')",
            name="ck_inventory_items_type"
        ),
        sa.CheckConstraint(
            "current_quantity >= 0",
            name="ck_inventory_items_quantity"
        ),
        sa.CheckConstraint(
            "minimum_quantity >= 0",
            name="ck_inventory_items_minimum"
        ),

        sa.ForeignKeyConstraint(
            ["category_id", "organization_id"],
            [
                "inventory_categories.id",
                "inventory_categories.organization_id"
            ],
            name="fk_inventory_items_category_org"
        ),
        sa.ForeignKeyConstraint(
            ["location_id", "organization_id"],
            [
                "storage_locations.id",
                "storage_locations.organization_id"
            ],
            name="fk_inventory_items_location_org"
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"]
        ),

        sa.PrimaryKeyConstraint("id"),

        sa.UniqueConstraint(
            "id",
            "organization_id",
            name="uq_inventory_items_id_org"
        ),
        sa.UniqueConstraint(
            "organization_id",
            "sku",
            name="uq_inventory_items_org_sku"
        ),
    )

    op.create_index(
        "ix_inventory_items_organization_id",
        "inventory_items",
        ["organization_id"],
        unique=False
    )

    # 4. Inventory Movements
    op.create_table(
        "inventory_movements",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("organization_id", sa.UUID(), nullable=False),
        sa.Column("item_id", sa.UUID(), nullable=False),
        sa.Column(
            "movement_type",
            sa.String(length=20),
            nullable=False
        ),
        sa.Column(
            "quantity_delta",
            sa.Numeric(precision=12, scale=2),
            nullable=False
        ),
        sa.Column(
            "quantity_before",
            sa.Numeric(precision=12, scale=2),
            nullable=False
        ),
        sa.Column(
            "quantity_after",
            sa.Numeric(precision=12, scale=2),
            nullable=False
        ),
        sa.Column("actor_id", sa.UUID(), nullable=True),
        sa.Column("notes", sa.String(length=1000), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False
        ),

        sa.CheckConstraint(
            "movement_type IN "
            "('opening', 'receive', 'issue', 'return', 'adjustment')",
            name="ck_inventory_movements_type"
        ),
        sa.CheckConstraint(
            "quantity_delta <> 0",
            name="ck_inventory_movements_nonzero"
        ),
        sa.CheckConstraint(
            "quantity_before >= 0",
            name="ck_inventory_movements_before"
        ),
        sa.CheckConstraint(
            "quantity_after >= 0",
            name="ck_inventory_movements_after"
        ),
        sa.CheckConstraint(
            "quantity_after = quantity_before + quantity_delta",
            name="ck_inventory_movements_balance"
        ),
        sa.CheckConstraint(
            """
            (
                movement_type IN ('opening', 'receive', 'return')
                AND quantity_delta > 0
            )
            OR
            (
                movement_type = 'issue'
                AND quantity_delta < 0
            )
            OR
            (
                movement_type = 'adjustment'
                AND quantity_delta <> 0
            )
            """,
            name="ck_inventory_movements_direction"
        ),

        sa.ForeignKeyConstraint(
            ["actor_id"],
            ["users.id"]
        ),
        sa.ForeignKeyConstraint(
            ["item_id", "organization_id"],
            [
                "inventory_items.id",
                "inventory_items.organization_id"
            ],
            name="fk_inventory_movements_item_org"
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"]
        ),

        sa.PrimaryKeyConstraint("id"),
    )

    op.create_index(
        "ix_inventory_movements_item_created",
        "inventory_movements",
        ["item_id", "created_at"],
        unique=False
    )

    op.create_index(
        "ix_inventory_movements_organization_id",
        "inventory_movements",
        ["organization_id"],
        unique=False
    )


def downgrade() -> None:
    """Remove inventory tables."""

    # Inventory Movements
    op.drop_index(
        "ix_inventory_movements_organization_id",
        table_name="inventory_movements"
    )
    op.drop_index(
        "ix_inventory_movements_item_created",
        table_name="inventory_movements"
    )
    op.drop_table("inventory_movements")

    # Inventory Items
    op.drop_index(
        "ix_inventory_items_organization_id",
        table_name="inventory_items"
    )
    op.drop_table("inventory_items")

    # Storage Locations
    op.drop_index(
        "ix_storage_locations_organization_id",
        table_name="storage_locations"
    )
    op.drop_table("storage_locations")

    # Inventory Categories
    op.drop_index(
        "ix_inventory_categories_organization_id",
        table_name="inventory_categories"
    )
    op.drop_table("inventory_categories")
