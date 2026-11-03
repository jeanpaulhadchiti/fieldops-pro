"""Add private-by-default discovery metadata and reviewed join requests.

Revision ID: d92a6f31c047
Revises: b891e225d419
"""

import re
import unicodedata

from alembic import op
import sqlalchemy as sa


revision = "d92a6f31c047"
down_revision = "b891e225d419"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("organizations", sa.Column("normalized_name", sa.String(450), nullable=False, server_default=""))
    op.add_column("organizations", sa.Column("organization_type", sa.String(30), nullable=False, server_default="Other"))
    op.add_column("organizations", sa.Column("country", sa.String(100), nullable=True))
    op.add_column("organizations", sa.Column("city", sa.String(100), nullable=True))
    op.add_column("organizations", sa.Column("description", sa.Text(), nullable=True))
    op.add_column("organizations", sa.Column("is_discoverable", sa.Boolean(), nullable=False, server_default=sa.false()))
    # Backfill only the new derived matching field. Original display names,
    # memberships, owners, and business rows are never rewritten or merged.
    connection = op.get_bind()
    organizations = sa.table("organizations", sa.column("id", sa.UUID()), sa.column("name", sa.String()), sa.column("normalized_name", sa.String()))
    for row in connection.execute(sa.select(organizations.c.id, organizations.c.name)).mappings():
        cleaned = re.sub(r"\s+", " ", row["name"]).strip().casefold()
        decomposed = unicodedata.normalize("NFKD", cleaned)
        normalized = "".join(character for character in decomposed if not unicodedata.combining(character))
        connection.execute(organizations.update().where(organizations.c.id == row["id"]).values(normalized_name=normalized))
    op.create_check_constraint("ck_organization_type", "organizations", "organization_type IN ('Scout Group', 'Sports Club', 'NGO', 'Other')")
    op.create_index("ix_organizations_discovery", "organizations", ["normalized_name"], postgresql_where=sa.text("is_discoverable = true"))

    op.create_table(
        "organization_join_requests",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("organization_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("message", sa.String(1000), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reviewed_by", sa.UUID(), nullable=True),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["reviewed_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("status IN ('pending', 'approved', 'rejected')", name="ck_join_request_status"),
        sa.CheckConstraint("(status = 'pending' AND reviewed_at IS NULL AND reviewed_by IS NULL) OR (status <> 'pending' AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL)", name="ck_join_request_review"),
        sa.CheckConstraint("reviewed_by IS NULL OR reviewed_by <> user_id", name="ck_join_request_no_self_review"),
    )
    op.create_index("uq_join_request_pending", "organization_join_requests", ["organization_id", "user_id"], unique=True, postgresql_where=sa.text("status = 'pending'"))
    op.create_index("ix_join_requests_organization_status", "organization_join_requests", ["organization_id", "status", "created_at"])
    op.create_index("ix_join_requests_user_created", "organization_join_requests", ["user_id", "created_at"])
    op.create_table(
        "onboarding_rate_limits",
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("action", sa.String(30), nullable=False),
        sa.Column("window_started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("attempt_count", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("user_id", "action"),
        sa.CheckConstraint("attempt_count > 0", name="ck_onboarding_rate_positive"),
    )


def downgrade():
    op.drop_table("onboarding_rate_limits")
    op.drop_table("organization_join_requests")
    op.drop_index("ix_organizations_discovery", table_name="organizations")
    op.drop_constraint("ck_organization_type", "organizations", type_="check")
    for column in ("is_discoverable", "description", "city", "country", "organization_type", "normalized_name"):
        op.drop_column("organizations", column)
