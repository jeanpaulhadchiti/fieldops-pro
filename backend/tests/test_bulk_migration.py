"""Preserve existing records while applying the additive receipt migration.

This test creates a uniquely named database inside the explicitly configured
local test PostgreSQL cluster. It never connects to the development database,
never drops any database/table, and leaves cleanup to the test container's
lifecycle. FIELDOPS_TEST_DATABASE_URL is required and validated before writes.
"""

import os
import secrets
import sys
import unittest
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import psycopg
from alembic import command
from alembic.config import Config
from psycopg import sql
from sqlalchemy import MetaData, Table, create_engine, func, inspect, select, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.exc import IntegrityError

from day9_server import validated_database_url


BACKEND_DIR = Path(__file__).resolve().parents[1]
PREVIOUS_REVISION = "ebe128559b9c"
BULK_REVISION = "b891e225d419"
DOMAIN_TABLES = (
    "users", "organizations", "memberships", "events", "participants",
    "registrations", "tasks", "task_assignments",
)


class BulkMigrationPreservation(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        source = validated_database_url(os.environ.get("FIELDOPS_TEST_DATABASE_URL"))
        name = f"fieldops_day9_test_migration_{uuid.uuid4().hex[:12]}"
        cls.url = validated_database_url(source.set(database=name).render_as_string(hide_password=False))
        # The name is safely quoted, and all connection fields come from the
        # validated local TEST URL. No .env-derived database URL is accepted.
        with psycopg.connect(
            host=source.host, port=source.port, dbname=source.database,
            user=source.username, password=source.password, autocommit=True,
        ) as admin:
            admin.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
        cls.engine = create_engine(cls.url, pool_pre_ping=True)
        cls.addClassCleanup(cls.engine.dispose)
        if str(BACKEND_DIR) not in sys.path:
            sys.path.insert(0, str(BACKEND_DIR))
        # app.database is imported by Alembic's environment, but its ordinary
        # engine is never opened because each migration supplies our connection.
        os.environ.setdefault("POSTGRES_PASSWORD", secrets.token_urlsafe(24))

    def upgrade(self, revision):
        config = Config(str(BACKEND_DIR / "alembic.ini"))
        config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
        config.set_main_option("prepend_sys_path", str(BACKEND_DIR))
        with self.engine.connect() as connection:
            config.attributes["connection"] = connection
            command.upgrade(config, revision)

    def snapshot(self, tables):
        with self.engine.connect() as connection:
            return {
                name: [dict(row) for row in connection.execute(select(table).order_by(table.c.id)).mappings()]
                for name, table in tables.items()
            }

    def schema_snapshot(self):
        inspector = inspect(self.engine)
        return {
            name: {
                "columns": [(column["name"], str(column["type"]), column["nullable"], column.get("default"))
                            for column in inspector.get_columns(name)],
                "primary_key": inspector.get_pk_constraint(name),
                "unique": inspector.get_unique_constraints(name),
                "foreign_keys": inspector.get_foreign_keys(name),
                "checks": inspector.get_check_constraints(name),
                "indexes": inspector.get_indexes(name),
            } for name in DOMAIN_TABLES
        }

    def test_additive_migration_preserves_all_old_tables_records_and_constraints(self):
        self.upgrade(PREVIOUS_REVISION)
        before_table_names = set(inspect(self.engine).get_table_names())
        self.assertNotIn("bulk_operations", before_table_names)
        metadata = MetaData()
        tables = {name: Table(name, metadata, autoload_with=self.engine) for name in DOMAIN_TABLES}
        ids = {name: uuid.uuid4() for name in DOMAIN_TABLES}
        now = datetime(2027, 1, 1, 10, 20, 30, 123456, tzinfo=timezone.utc)
        with self.engine.begin() as connection:
            connection.execute(tables["users"].insert().values(
                id=ids["users"], name="Migration preservation user",
                email=f"migration-{uuid.uuid4().hex[:10]}@example.com",
                password_hash="migration-fixture-not-a-login-credential", created_at=now,
            ))
            connection.execute(tables["organizations"].insert().values(
                id=ids["organizations"], name="Migration preservation organization", created_at=now,
            ))
            connection.execute(tables["memberships"].insert().values(
                id=ids["memberships"], user_id=ids["users"], organization_id=ids["organizations"],
                role="Owner", status="active", created_at=now,
            ))
            connection.execute(tables["events"].insert().values(
                id=ids["events"], organization_id=ids["organizations"], title="Existing event",
                description="Preserve this description", location="Existing location",
                start_at=now, end_at=now + timedelta(hours=4), status="active",
                capacity=17, archived_at=None, created_at=now,
            ))
            connection.execute(tables["participants"].insert().values(
                id=ids["participants"], organization_id=ids["organizations"],
                full_name="Existing participant", created_at=now,
            ))
            connection.execute(tables["registrations"].insert().values(
                id=ids["registrations"], event_id=ids["events"], participant_id=ids["participants"],
                status="registered", attended_at=now + timedelta(minutes=10),
                fee_required=True, payment_status="partial", created_at=now,
            ))
            connection.execute(tables["tasks"].insert().values(
                id=ids["tasks"], event_id=ids["events"], title="Existing task",
                description="Preserve task description", priority="high", status="in_progress",
                due_at=now + timedelta(hours=1), created_at=now,
            ))
            connection.execute(tables["task_assignments"].insert().values(
                id=ids["task_assignments"], task_id=ids["tasks"], user_id=ids["users"], created_at=now,
            ))
        before_rows = self.snapshot(tables)
        before_schema = self.schema_snapshot()

        self.upgrade(BULK_REVISION)
        self.assertEqual(set(inspect(self.engine).get_table_names()), before_table_names | {"bulk_operations"})
        self.assertEqual(self.snapshot(tables), before_rows)
        self.assertEqual(self.schema_snapshot(), before_schema)
        inspector = inspect(self.engine)
        columns = {column["name"]: column for column in inspector.get_columns("bulk_operations")}
        self.assertIsInstance(columns["result"]["type"], JSONB)
        self.assertTrue(any(
            constraint["name"] == "uq_bulk_operation_request"
            and constraint["column_names"] == ["organization_id", "user_id", "idempotency_key"]
            for constraint in inspector.get_unique_constraints("bulk_operations")
        ))
        self.assertEqual({foreign_key["referred_table"] for foreign_key in inspector.get_foreign_keys("bulk_operations")}, {"organizations", "users"})
        with self.engine.connect() as connection:
            self.assertEqual(connection.scalar(text("SELECT version_num FROM alembic_version")), BULK_REVISION)

        receipts = Table("bulk_operations", MetaData(), autoload_with=self.engine)
        key = uuid.uuid4()
        receipt = {
            "id": uuid.uuid4(), "organization_id": ids["organizations"], "user_id": ids["users"],
            "idempotency_key": key, "operation_type": "migration_preservation",
            "request_hash": "0" * 64,
            "result": {"ids": [str(ids["participants"])], "counts": {"participants": 1}, "replayed": False},
        }
        with self.engine.begin() as connection:
            connection.execute(receipts.insert().values(**receipt))
        with self.engine.connect() as connection:
            self.assertEqual(connection.scalar(select(receipts.c.result)), receipt["result"])
            self.assertEqual(connection.scalar(select(receipts.c.result["counts"]["participants"].as_integer())), 1)
        with self.assertRaises(IntegrityError):
            with self.engine.begin() as connection:
                connection.execute(receipts.insert().values(**{**receipt, "id": uuid.uuid4()}))

        # Applying the same head twice must neither recreate the table nor alter
        # its saved JSON receipt or any pre-existing business data.
        self.upgrade(BULK_REVISION)
        self.assertEqual(self.snapshot(tables), before_rows)
        self.assertEqual(self.schema_snapshot(), before_schema)
        with self.engine.connect() as connection:
            self.assertEqual(connection.scalar(select(func.count()).select_from(receipts)), 1)
            self.assertEqual(connection.scalar(select(receipts.c.result)), receipt["result"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
