"""Exercise inventory upgrades only in fresh, explicitly isolated PostgreSQL DBs.

Requires FIELDOPS_TEST_DATABASE_URL, validated before any connection or write.
All databases remain inside the disposable test cluster for lifecycle cleanup;
these tests never reset an existing database or use the development engine.
"""

import json
import os
import secrets
import unittest
import uuid
from datetime import datetime, timezone
from pathlib import Path

import psycopg
from alembic import command
from alembic.config import Config
from psycopg import sql
from sqlalchemy import MetaData, Table, create_engine, inspect, select, text
from sqlalchemy.exc import DBAPIError, IntegrityError

from day9_server import validated_database_url
import test_bulk_migration as bulk


BACKEND_DIR = Path(__file__).resolve().parents[1]
PREVIOUS_REVISION = "e53dc831db7c"
FINITE_REVISION = "7f82ac19d604"
FINITE_COLUMNS = (
    ("inventory_items", "current_quantity", "ck_inventory_items_current_quantity_finite"),
    ("inventory_items", "minimum_quantity", "ck_inventory_items_minimum_quantity_finite"),
    ("inventory_movements", "quantity_delta", "ck_inventory_movements_quantity_delta_finite"),
    ("inventory_movements", "quantity_before", "ck_inventory_movements_quantity_before_finite"),
    ("inventory_movements", "quantity_after", "ck_inventory_movements_quantity_after_finite"),
)
FINITE_NAMES = {name for _table, _column, name in FINITE_COLUMNS}


class InventoryMigrationPreservation(unittest.TestCase):
    # Reuse the historical fixture's assertions without inheriting its test.
    schema_snapshot = bulk.BulkMigrationPreservation.schema_snapshot

    def setUp(self):
        self.source = validated_database_url(os.environ.get("FIELDOPS_TEST_DATABASE_URL"))
        self.new_database()
        os.environ.setdefault("POSTGRES_PASSWORD", secrets.token_urlsafe(24))

    def new_database(self):
        name = f"fieldops_day9_test_inventory_migration_{uuid.uuid4().hex[:12]}"
        url = validated_database_url(self.source.set(database=name).render_as_string(hide_password=False))
        with psycopg.connect(
            host=self.source.host, port=self.source.port, dbname=self.source.database,
            user=self.source.username, password=self.source.password, autocommit=True,
        ) as admin:
            admin.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
        self.engine = create_engine(url, pool_pre_ping=True)
        self.addCleanup(self.engine.dispose)

    def migrate(self, direction, revision):
        config = Config(str(BACKEND_DIR / "alembic.ini"))
        config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
        config.set_main_option("prepend_sys_path", str(BACKEND_DIR))
        # Keep all DDL and the version change in one PostgreSQL transaction.
        with self.engine.begin() as connection:
            config.attributes["connection"] = connection
            getattr(command, direction)(config, revision)

    def upgrade(self, revision):
        self.migrate("upgrade", revision)

    def tables(self):
        metadata = MetaData()
        metadata.reflect(bind=self.engine)
        return {name: table for name, table in metadata.tables.items() if name != "alembic_version"}

    def snapshot(self, tables):
        with self.engine.connect() as connection:
            # String conversion preserves NaN exactly and avoids NaN != NaN
            # making an unchanged historical row appear different.
            return {
                name: json.dumps(
                    [dict(row) for row in connection.execute(select(table).order_by(*table.primary_key.columns)).mappings()],
                    sort_keys=True, default=str,
                ) for name, table in tables.items()
            }

    def full_schema_snapshot(self):
        inspector = inspect(self.engine)
        return {
            name: {
                "columns": [(c["name"], str(c["type"]), c["nullable"], c.get("default"))
                            for c in inspector.get_columns(name)],
                "primary_key": inspector.get_pk_constraint(name),
                "unique": inspector.get_unique_constraints(name),
                "foreign_keys": inspector.get_foreign_keys(name),
                "checks": inspector.get_check_constraints(name),
                "indexes": inspector.get_indexes(name),
            } for name in inspector.get_table_names() if name != "alembic_version"
        }

    def revision(self):
        with self.engine.connect() as connection:
            return connection.scalar(text("SELECT version_num FROM alembic_version"))

    def seed_inventory(self):
        tables = self.tables()
        names = (
            "users", "organizations", "memberships", "organization_join_requests",
            "organization_archive_events", "notifications", "inventory_categories",
            "storage_locations", "inventory_items", "inventory_movements",
        )
        ids = {name: uuid.uuid4() for name in names}
        now = datetime(2026, 11, 3, 9, 0, tzinfo=timezone.utc)
        with self.engine.begin() as connection:
            connection.execute(tables["users"].insert().values(
                id=ids["users"], name="Inventory migration fixture",
                email=f"inventory-migration-{uuid.uuid4().hex}@example.com",
                password_hash="fixture-not-a-login-credential", created_at=now,
            ))
            connection.execute(tables["organizations"].insert().values(
                id=ids["organizations"], name="Historical inventory workspace",
                organization_type="Other", organization_type_other="Historical community",
                city="Beirut", country="LB", description="Preserve all historical fields",
                is_discoverable=False, created_at=now,
            ))
            connection.execute(tables["memberships"].insert().values(
                id=ids["memberships"], user_id=ids["users"], organization_id=ids["organizations"],
                role="Owner", status="active", created_at=now,
            ))
            connection.execute(tables["organization_join_requests"].insert().values(
                id=ids["organization_join_requests"], organization_id=ids["organizations"],
                user_id=ids["users"], status="pending", message="Preserve request", created_at=now,
            ))
            connection.execute(tables["onboarding_rate_limits"].insert().values(
                user_id=ids["users"], action="inventory_migration", window_started_at=now, attempt_count=1,
            ))
            connection.execute(tables["organization_archive_events"].insert().values(
                id=ids["organization_archive_events"], organization_id=ids["organizations"],
                actor_id=ids["users"], action="restore", created_at=now,
            ))
            connection.execute(tables["notifications"].insert().values(
                id=ids["notifications"], recipient_id=ids["users"], organization_id=ids["organizations"],
                join_request_id=ids["organization_join_requests"], created_at=now, updated_at=now, read_at=now,
            ))
            connection.execute(tables["inventory_categories"].insert().values(
                id=ids["inventory_categories"], organization_id=ids["organizations"],
                name="Historical equipment", description="Preserve category", created_at=now,
            ))
            connection.execute(tables["storage_locations"].insert().values(
                id=ids["storage_locations"], organization_id=ids["organizations"],
                name="Historical store", description="Preserve location", created_at=now,
            ))
            connection.execute(tables["inventory_items"].insert().values(
                id=ids["inventory_items"], organization_id=ids["organizations"],
                category_id=ids["inventory_categories"], location_id=ids["storage_locations"],
                name="Historical ropes", sku="ROPES-01", unit="meter", item_type="reusable",
                current_quantity="2.50", minimum_quantity="0.25", archived=False, created_at=now,
            ))
            connection.execute(tables["inventory_movements"].insert().values(
                id=ids["inventory_movements"], organization_id=ids["organizations"],
                item_id=ids["inventory_items"], movement_type="receive",
                quantity_before="1.25", quantity_delta="1.25", quantity_after="2.50",
                actor_id=ids["users"], notes="Preserve ledger history", created_at=now,
            ))
        return tables, ids

    def assert_only_finite_checks_added(self, before):
        after = self.full_schema_snapshot()
        found = set()
        for table in after.values():
            found.update(c["name"] for c in table["checks"] if c["name"] in FINITE_NAMES)
            table["checks"] = [c for c in table["checks"] if c["name"] not in FINITE_NAMES]
        self.assertEqual(found, FINITE_NAMES)
        self.assertEqual(after, before, "Only five finite checks may change the historical schema")

    def test_upgrade_downgrade_and_repeat_preserve_all_records_and_schema(self):
        bulk.BulkMigrationPreservation.test_additive_migration_preserves_all_old_tables_records_and_constraints(self)
        self.upgrade(PREVIOUS_REVISION)
        tables, _ids = self.seed_inventory()
        before = self.snapshot(tables)
        before_schema = self.full_schema_snapshot()
        self.upgrade(FINITE_REVISION)
        self.assertEqual(self.revision(), FINITE_REVISION)
        self.assertEqual(self.snapshot(tables), before)
        self.assert_only_finite_checks_added(before_schema)
        self.upgrade(FINITE_REVISION)
        self.assertEqual(self.snapshot(tables), before)
        self.assert_only_finite_checks_added(before_schema)
        self.migrate("downgrade", PREVIOUS_REVISION)
        self.assertEqual(self.revision(), PREVIOUS_REVISION)
        self.assertEqual(self.snapshot(tables), before)
        self.assertEqual(self.full_schema_snapshot(), before_schema)
        self.upgrade(FINITE_REVISION)
        self.assertEqual(self.snapshot(tables), before)
        self.assert_only_finite_checks_added(before_schema)

    def test_finite_checks_reject_special_values_and_retain_old_quantity_rules(self):
        self.upgrade(PREVIOUS_REVISION)
        tables, ids = self.seed_inventory()
        self.upgrade(FINITE_REVISION)
        from app.models import InventoryItem, InventoryMovement

        models = {model.__tablename__: model.__table__ for model in (InventoryItem, InventoryMovement)}
        inspector = inspect(self.engine)
        for table, column, name in FINITE_COLUMNS:
            database_check = next(c["sqltext"] for c in inspector.get_check_constraints(table) if c["name"] == name)
            model_check = str(next(c.sqltext for c in models[table].constraints if c.name == name))
            for expression in (database_check, model_check):
                for value in ("NaN", "Infinity", "-Infinity", "0", "1.25", "-1.25", "9999999999.99"):
                    with self.subTest(table=table, column=column, value=value, expression=expression):
                        with self.engine.connect() as connection:
                            accepted = connection.scalar(text(
                                f"SELECT ({expression}) FROM (SELECT CAST(:value AS numeric) AS {column}) AS candidate"
                            ), {"value": value})
                        self.assertEqual(accepted, value not in {"NaN", "Infinity", "-Infinity"})
            for value in ("NaN", "Infinity", "-Infinity"):
                with self.subTest(stored_column=column, value=value):
                    with self.assertRaises(DBAPIError):
                        with self.engine.begin() as connection:
                            connection.execute(tables[table].update().where(tables[table].c.id == ids[table]).values(**{column: value}))

        invalid = (
            ("inventory_items", {"current_quantity": -1}),
            ("inventory_items", {"minimum_quantity": -1}),
            ("inventory_items", {"item_type": "unknown"}),
            ("inventory_movements", {"movement_type": "unknown"}),
            ("inventory_movements", {"quantity_delta": 0, "quantity_before": 1, "quantity_after": 1}),
            ("inventory_movements", {"quantity_before": -1, "quantity_delta": 2, "quantity_after": 1}),
            ("inventory_movements", {"quantity_before": 1, "quantity_delta": -2, "quantity_after": -1}),
            ("inventory_movements", {"quantity_before": 1, "quantity_delta": 1, "quantity_after": 3}),
            ("inventory_movements", {"movement_type": "issue", "quantity_before": 1, "quantity_delta": 1, "quantity_after": 2}),
        )
        for table, changes in invalid:
            with self.subTest(invalid=changes):
                with self.assertRaises(IntegrityError):
                    with self.engine.begin() as connection:
                        connection.execute(tables[table].update().where(tables[table].c.id == ids[table]).values(**changes))
        for movement_type, before, delta, after in (
            ("opening", "0", "0.25", "0.25"), ("receive", "1.25", "1.25", "2.50"),
            ("issue", "2.50", "-0.25", "2.25"), ("return", "2.25", "0.25", "2.50"),
            ("adjustment", "2.50", "-0.50", "2.00"), ("adjustment", "2.00", "0.50", "2.50"),
        ):
            with self.subTest(valid_movement=movement_type, delta=delta):
                with self.engine.begin() as connection:
                    connection.execute(tables["inventory_movements"].update().where(
                        tables["inventory_movements"].c.id == ids["inventory_movements"]
                    ).values(movement_type=movement_type, quantity_before=before, quantity_delta=delta, quantity_after=after))

    def test_existing_nan_aborts_upgrade_atomically_without_rewriting_records(self):
        for index, (table, column, _name) in enumerate(FINITE_COLUMNS):
            with self.subTest(table=table, column=column):
                if index:
                    self.new_database()
                self.upgrade(PREVIOUS_REVISION)
                tables, ids = self.seed_inventory()
                changes = {column: "NaN"}
                if table == "inventory_movements":
                    # NaN arithmetic satisfies the original balance checks.
                    # Keep these rows intact after the validating DDL fails.
                    changes["quantity_after"] = "NaN"
                    if column == "quantity_after":
                        changes["quantity_before"] = "NaN"
                with self.engine.begin() as connection:
                    connection.execute(tables[table].update().where(tables[table].c.id == ids[table]).values(**changes))
                before = self.snapshot(tables)
                before_schema = self.full_schema_snapshot()
                with self.assertRaises(IntegrityError) as failure:
                    self.upgrade(FINITE_REVISION)
                self.assertIn(failure.exception.orig.diag.constraint_name, FINITE_NAMES)
                self.assertEqual(self.revision(), PREVIOUS_REVISION)
                self.assertEqual(self.snapshot(tables), before, "Bad historical quantities must never be cleaned automatically")
                self.assertEqual(self.full_schema_snapshot(), before_schema, "Failed DDL must roll back every added check")


if __name__ == "__main__":
    unittest.main(verbosity=2)
