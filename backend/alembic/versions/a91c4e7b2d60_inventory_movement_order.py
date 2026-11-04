"""Give each item's stock movements an authoritative application order.

Revision ID: a91c4e7b2d60
Revises: 7f82ac19d604

Historical order is inferred only when every next balance identifies exactly
one remaining movement, from zero to the item's saved stock. Branches, gaps or
inconsistent endpoints stop the migration instead of using timestamps or UUIDs.
No historical quantity, identity, actor, note or timestamp is changed.

Downgrade removes this new ordering metadata only. A subsequent upgrade repeats
the same conservative validation and may require explicit historical review if
new movements made the balance chain ambiguous; it never guesses that order.
"""

from decimal import Decimal

from alembic import op
import sqlalchemy as sa


revision = "a91c4e7b2d60"
down_revision = "7f82ac19d604"
branch_labels = None
depends_on = None


def _ordered_movements(item, movements):
    outgoing = {}
    for movement in movements:
        outgoing.setdefault(movement["quantity_before"], []).append(movement)
    balance = Decimal("0")
    ordered = []
    for _ in movements:
        candidates = outgoing.get(balance, [])
        if len(candidates) != 1:
            raise RuntimeError(
                "Inventory movement order cannot be inferred safely for item "
                f"{item['id']}: expected one next movement at balance {balance}, "
                f"found {len(candidates)}. Review the historical ledger explicitly; "
                "no timestamp/UUID ordering or data cleanup has been applied."
            )
        movement = candidates.pop()
        if movement["movement_type"] == "opening" and ordered:
            raise RuntimeError(
                "Inventory movement order cannot be inferred safely for item "
                f"{item['id']}: opening stock is not the first movement."
            )
        ordered.append(movement["id"])
        balance = movement["quantity_after"]
    if balance != item["current_quantity"]:
        raise RuntimeError(
            "Inventory movement order cannot be inferred safely for item "
            f"{item['id']}: final ledger balance {balance} differs from saved "
            f"stock {item['current_quantity']}. No historical values were changed."
        )
    return ordered


def upgrade():
    connection = op.get_bind()
    # Require a quiet maintenance window rather than waiting behind readers or
    # writers. Failure rolls back immediately; items precede movements as in
    # the application's stock-lock order.
    connection.execute(sa.text(
        "LOCK TABLE inventory_items, inventory_movements IN ACCESS EXCLUSIVE MODE NOWAIT"
    ))
    op.add_column(
        "inventory_movements", sa.Column("sequence_number", sa.BigInteger(), nullable=True)
    )
    items = connection.execute(sa.text(
        "SELECT id, organization_id, current_quantity FROM inventory_items"
    )).mappings().all()
    for item in items:
        movements = connection.execute(sa.text(
            "SELECT id, quantity_before, quantity_after, movement_type "
            "FROM inventory_movements WHERE item_id=:item AND organization_id=:org"
        ), {"item": item["id"], "org": item["organization_id"]}).mappings().all()
        ordered = _ordered_movements(item, movements)
        if ordered:
            connection.execute(sa.text(
                "UPDATE inventory_movements SET sequence_number=:sequence WHERE id=:id"
            ), [{"id": identity, "sequence": number}
                for number, identity in enumerate(ordered, start=1)])
    op.alter_column(
        "inventory_movements", "sequence_number", existing_type=sa.BigInteger(), nullable=False
    )
    op.create_check_constraint(
        "ck_inventory_movements_sequence_positive", "inventory_movements", "sequence_number > 0"
    )
    op.create_unique_constraint(
        "uq_inventory_movements_item_sequence", "inventory_movements",
        ["organization_id", "item_id", "sequence_number"]
    )


def downgrade():
    op.drop_constraint(
        "uq_inventory_movements_item_sequence", "inventory_movements", type_="unique"
    )
    op.drop_constraint(
        "ck_inventory_movements_sequence_positive", "inventory_movements", type_="check"
    )
    op.drop_column("inventory_movements", "sequence_number")
