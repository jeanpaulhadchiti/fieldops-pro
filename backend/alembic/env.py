
from logging.config import fileConfig
from app.models.event import Event
from alembic import context
from app.database import engine
from app.models import Base
from app.models.participant import Participant
from app.models.registration import Registration
from app.models.task import Task
from app.models.task_assignment import TaskAssignment
from app.models.bulk_operation import BulkOperation
from app.models.organization_join_request import OrganizationJoinRequest
from app.models.onboarding_rate_limit import OnboardingRateLimit
from app.models.organization_archive_event import OrganizationArchiveEvent
from app.models.notification import Notification

# Alembic configuration
config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# We will connect our SQLAlchemy models later
target_metadata = Base.metadata


def run_migrations_offline():
    context.configure(
        url=engine.url.render_as_string(hide_password=False),
        target_metadata=target_metadata,
        literal_binds=True
    )

    with context.begin_transaction():
        context.run_migrations()


def migrate_connection(connection):
    context.configure(
        connection=connection,
        target_metadata=target_metadata
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online():
    # Programmatic callers can supply an already selected connection, including
    # an isolated test database. Ordinary CLI migration behavior is unchanged.
    provided_connection = config.attributes.get("connection")
    if provided_connection is not None:
        migrate_connection(provided_connection)
    else:
        with engine.connect() as connection:
            migrate_connection(connection)


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
