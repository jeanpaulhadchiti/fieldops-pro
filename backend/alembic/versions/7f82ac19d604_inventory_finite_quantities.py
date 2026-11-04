"""Reject nonfinite inventory quantities without rewriting existing records.

Revision ID: 7f82ac19d604
Revises: e53dc831db7c
"""

from alembic import op


revision = "7f82ac19d604"
down_revision = "e53dc831db7c"
branch_labels = None
depends_on = None


FINITE_QUANTITIES = (
    ("inventory_items", "current_quantity", "ck_inventory_items_current_quantity_finite"),
    ("inventory_items", "minimum_quantity", "ck_inventory_items_minimum_quantity_finite"),
    ("inventory_movements", "quantity_delta", "ck_inventory_movements_quantity_delta_finite"),
    ("inventory_movements", "quantity_before", "ck_inventory_movements_quantity_before_finite"),
    ("inventory_movements", "quantity_after", "ck_inventory_movements_quantity_after_finite"),
)


def upgrade():
    # Validate saved rows as well as future writes. PostgreSQL rolls back this
    # migration if an existing nonfinite value violates a new constraint; no
    # historical quantity or movement is replaced, deleted, or silently fixed.
    for table, column, name in FINITE_QUANTITIES:
        op.create_check_constraint(
            name,
            table,
            f"{column} <> 'NaN'::numeric "
            f"AND {column} <> 'Infinity'::numeric "
            f"AND {column} <> '-Infinity'::numeric",
        )


def downgrade():
    for table, _column, name in reversed(FINITE_QUANTITIES):
        op.drop_constraint(name, table, type_="check")
