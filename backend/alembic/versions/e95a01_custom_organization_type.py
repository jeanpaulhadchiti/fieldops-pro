"""Add optional custom type, preserving all existing organization values.

Revision ID: e95a01
Revises: d92a6f31c047
"""
from alembic import op
import sqlalchemy as sa

revision = 'e95a01'
down_revision = 'd92a6f31c047'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('organizations', sa.Column('organization_type_other', sa.String(100), nullable=True))


def downgrade():
    op.drop_column('organizations', 'organization_type_other')
