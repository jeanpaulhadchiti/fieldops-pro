"""Persist deduplicated Owner join-request notifications.

Revision ID: e95a03
Revises: e95a02
"""

from alembic import op
import sqlalchemy as sa


revision = "e95a03"
down_revision = "e95a02"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "notifications",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("recipient_id", sa.UUID(), nullable=False),
        sa.Column("organization_id", sa.UUID(), nullable=False),
        sa.Column("join_request_id", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["recipient_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
        sa.ForeignKeyConstraint(["join_request_id"], ["organization_join_requests.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("recipient_id", "join_request_id", name="uq_notification_recipient_request"),
    )
    op.create_index("ix_notifications_recipient_created", "notifications", ["recipient_id", "created_at"])


def downgrade():
    op.drop_table("notifications")
