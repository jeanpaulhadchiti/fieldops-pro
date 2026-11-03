"""Add reversible organization archiving and preserved action history.

Revision ID: e95a02
Revises: e95a01
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "e95a02"
down_revision = "e95a01"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("organizations", sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("organizations", sa.Column("archived_by", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key("fk_organizations_archived_by", "organizations", "users", ["archived_by"], ["id"])
    op.create_table("organization_archive_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("actor_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("action", sa.String(10), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("action IN ('archive', 'restore')", name="ck_organization_archive_event_action"),
    )
    op.create_index("ix_organization_archive_events_organization_id", "organization_archive_events", ["organization_id"])


def downgrade():
    op.drop_index("ix_organization_archive_events_organization_id", table_name="organization_archive_events")
    op.drop_table("organization_archive_events")
    op.drop_constraint("fk_organizations_archived_by", "organizations", type_="foreignkey")
    op.drop_column("organizations", "archived_by")
    op.drop_column("organizations", "archived_at")
