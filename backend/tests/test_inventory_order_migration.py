"""Inventory ordering upgrades only in verified, fresh disposable databases."""

import json
import os
import secrets
import unittest
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import psycopg
from psycopg import sql
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy import MetaData, Table, create_engine, inspect, select, text
from sqlalchemy.exc import DBAPIError, IntegrityError

from day9_server import validated_database_url


BACKEND = Path(__file__).resolve().parents[1]
PARENT = "7f82ac19d604"
REVISION = "a91c4e7b2d60"


class InventoryOrderMigration(unittest.TestCase):
    def setUp(self):
        self.source = validated_database_url(os.environ.get("FIELDOPS_TEST_DATABASE_URL"))
        if self.source.port == 5432:
            raise RuntimeError("Ordering migration tests refuse the development PostgreSQL port")
        os.environ.setdefault("POSTGRES_PASSWORD", secrets.token_urlsafe(24))
        self.new_database()

    def new_database(self):
        name = "fieldops_day9_test_order_" + uuid.uuid4().hex[:12]
        with psycopg.connect(
            host=self.source.host, port=self.source.port, dbname=self.source.database,
            user=self.source.username, password=self.source.password, autocommit=True,
        ) as admin:
            self.assertEqual(admin.execute("SELECT current_database()").fetchone()[0], self.source.database)
            self.assertEqual(admin.execute("SELECT current_user").fetchone()[0], "qa")
            admin.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
        self.engine = create_engine(self.source.set(database=name))
        self.addCleanup(self.engine.dispose)
        with self.engine.connect() as connection:
            self.assertEqual(connection.scalar(text("SELECT current_database()")), name)

    def migrate(self, direction, revision):
        config = Config(str(BACKEND / "alembic.ini"))
        config.set_main_option("script_location", str(BACKEND / "alembic"))
        config.set_main_option("prepend_sys_path", str(BACKEND))
        with self.engine.begin() as connection:
            self.assertTrue(connection.scalar(text("SELECT current_database()")).startswith("fieldops_day9_test_order_"))
            config.attributes["connection"] = connection
            getattr(command, direction)(config, revision)

    def revision(self):
        with self.engine.connect() as connection:
            return connection.scalar(text("SELECT version_num FROM alembic_version"))

    def tables(self):
        metadata = MetaData()
        metadata.reflect(bind=self.engine)
        return {name: table for name, table in metadata.tables.items() if name != "alembic_version"}

    def snapshot(self, tables):
        with self.engine.connect() as connection:
            return {
                name: json.dumps([dict(row) for row in connection.execute(
                    select(table).order_by(*table.primary_key.columns)
                ).mappings()], sort_keys=True, default=str)
                for name, table in tables.items()
            }

    def seed(self, edges, stock):
        tables = self.tables()
        organization = uuid.uuid4()
        item = uuid.uuid4()
        identities = [uuid.uuid4() for _ in edges]
        base = datetime(2026, 11, 4, 10, tzinfo=timezone.utc)
        with self.engine.begin() as connection:
            connection.execute(tables["organizations"].insert().values(id=organization, name="Ordering history"))
            connection.execute(tables["inventory_items"].insert().values(
                id=item, organization_id=organization, name="Historical stock", current_quantity=stock,
            ))
            # Reverse both insertion and timestamps so neither can choose order.
            for index in reversed(range(len(edges))):
                before, after, kind = edges[index]
                connection.execute(tables["inventory_movements"].insert().values(
                    id=identities[index], organization_id=organization, item_id=item,
                    quantity_before=before, quantity_after=after,
                    quantity_delta=after-before, movement_type=kind,
                    notes="Retain historical notes", created_at=base-timedelta(minutes=index),
                ))
        return tables, organization, item, identities

    def test_unique_balance_backfill_preserves_old_values_and_round_trips(self):
        self.migrate("upgrade", PARENT)
        tables, org, item, ids = self.seed(
            [(0, 20, "opening"), (20, 25, "receive"), (25, 15, "issue"),
             (15, 23, "return"), (23, 21, "adjustment")], 21,
        )
        before = self.snapshot(tables)
        checks_before = inspect(self.engine).get_check_constraints("inventory_movements")
        self.migrate("upgrade", REVISION)
        self.assertEqual(self.revision(), REVISION)
        self.assertEqual(self.snapshot(tables), before)
        with self.engine.connect() as connection:
            rows = connection.execute(text(
                "SELECT id,sequence_number FROM inventory_movements WHERE item_id=:item ORDER BY sequence_number"
            ), {"item": item}).all()
        self.assertEqual(rows, list(zip(ids, range(1, 6))))
        inspector = inspect(self.engine)
        self.assertTrue(all(check in inspector.get_check_constraints("inventory_movements") for check in checks_before))
        self.assertTrue(any(c["name"] == "uq_inventory_movements_item_sequence" for c in inspector.get_unique_constraints("inventory_movements")))
        self.assertFalse(next(c for c in inspector.get_columns("inventory_movements") if c["name"] == "sequence_number")["nullable"])
        self.migrate("upgrade", REVISION)
        self.assertEqual(self.snapshot(tables), before)
        self.migrate("downgrade", PARENT)
        self.assertEqual(self.revision(), PARENT)
        self.assertNotIn("sequence_number", {c["name"] for c in inspect(self.engine).get_columns("inventory_movements")})
        self.assertEqual(inspect(self.engine).get_check_constraints("inventory_movements"), checks_before)
        self.assertEqual(self.snapshot(tables), before)
        self.migrate("upgrade", REVISION)
        self.assertEqual(self.snapshot(tables), before)
        with self.engine.connect() as connection:
            self.assertEqual(connection.execute(text(
                "SELECT id,sequence_number FROM inventory_movements WHERE item_id=:item ORDER BY sequence_number"
            ), {"item": item}).all(), rows)

    def test_ambiguous_gap_nonzero_start_and_stock_mismatch_abort_atomically(self):
        cases = (
            ([(0, 1, "receive"), (1, 0, "issue"), (0, 2, "receive"), (2, 0, "issue")], 0),
            ([(0, 1, "receive"), (3, 4, "receive")], 4),
            ([(1, 2, "receive")], 2),
            ([(0, 1, "receive")], 2),
            ([], 1),
        )
        for index, (edges, stock) in enumerate(cases):
            with self.subTest(case=index):
                if index:
                    self.new_database()
                self.migrate("upgrade", PARENT)
                tables, _org, _item, _ids = self.seed(edges, stock)
                before = self.snapshot(tables)
                with self.assertRaisesRegex(RuntimeError, "cannot be inferred safely"):
                    self.migrate("upgrade", REVISION)
                self.assertEqual(self.revision(), PARENT)
                self.assertNotIn("sequence_number", {c["name"] for c in inspect(self.engine).get_columns("inventory_movements")})
                self.assertEqual(self.snapshot(tables), before)

    def test_sequence_constraints_are_positive_unique_and_item_scoped(self):
        self.migrate("upgrade", PARENT)
        _tables, org, item, _ids = self.seed([(0, 1, "opening")], 1)
        self.migrate("upgrade", REVISION)
        table = Table("inventory_movements", MetaData(), autoload_with=self.engine)
        base = dict(organization_id=org, item_id=item, movement_type="receive",
                    quantity_before=1, quantity_delta=1, quantity_after=2)
        for sequence in (0, -1, None, 1):
            with self.subTest(sequence=sequence), self.assertRaises(IntegrityError):
                with self.engine.begin() as connection:
                    connection.execute(table.insert().values(id=uuid.uuid4(), sequence_number=sequence, **base))
        other_item = uuid.uuid4()
        with self.engine.begin() as connection:
            connection.execute(text("INSERT INTO inventory_items (id,organization_id,name) VALUES (:id,:org,'Other item')"), {"id": other_item, "org": org})
            connection.execute(table.insert().values(id=uuid.uuid4(), sequence_number=1,
                **{**base, "item_id": other_item, "quantity_before": 0, "quantity_after": 1}))
        from app.models import Base, InventoryMovement
        self.assertIn("uq_inventory_movements_item_sequence", {c.name for c in InventoryMovement.__table__.constraints})
        self.assertIn("ck_inventory_movements_sequence_positive", {c.name for c in InventoryMovement.__table__.constraints})
        with self.engine.connect() as connection:
            context = MigrationContext.configure(connection, opts={
                "compare_type": True, "compare_server_default": True,
            })
            self.assertEqual(compare_metadata(context, Base.metadata), [])

    def test_downgrade_retains_rows_and_reupgrade_refuses_new_ambiguous_history(self):
        self.migrate("upgrade", PARENT)
        tables, org, item, _ids = self.seed([(0, 10, "opening")], 10)
        self.migrate("upgrade", REVISION)
        with self.engine.begin() as connection:
            for sequence, before, after, kind in ((2,10,0,"issue"),(3,0,5,"receive"),(4,5,0,"issue")):
                connection.execute(text(
                    "INSERT INTO inventory_movements (id,organization_id,item_id,sequence_number,movement_type,quantity_before,quantity_delta,quantity_after) "
                    "VALUES (:id,:org,:item,:sequence,:kind,:before,:delta,:after)"
                ), dict(id=uuid.uuid4(),org=org,item=item,sequence=sequence,kind=kind,before=before,delta=after-before,after=after))
            connection.execute(text("UPDATE inventory_items SET current_quantity=0 WHERE id=:id"), {"id":item})
        before = self.snapshot(tables)
        self.migrate("downgrade", PARENT)
        self.assertEqual(self.snapshot(tables), before)
        with self.assertRaisesRegex(RuntimeError, "cannot be inferred safely"):
            self.migrate("upgrade", REVISION)
        self.assertEqual(self.revision(), PARENT)
        self.assertEqual(self.snapshot(tables), before)

    def test_active_writer_refuses_migration_without_partial_schema_then_retries(self):
        self.migrate("upgrade", PARENT)
        tables, _org, item, _ids = self.seed([(0, 1, "opening")], 1)
        before = self.snapshot(tables)
        with self.engine.begin() as writer:
            writer.execute(text("SELECT id FROM inventory_items WHERE id=:id FOR UPDATE"), {"id": item})
            with self.assertRaises(DBAPIError) as failure:
                self.migrate("upgrade", REVISION)
            self.assertEqual(failure.exception.orig.sqlstate, "55P03")
            self.assertEqual(self.revision(), PARENT)
            self.assertNotIn("sequence_number", {c["name"] for c in inspect(self.engine).get_columns("inventory_movements")})
            self.assertEqual(self.snapshot(tables), before)
        self.migrate("upgrade", REVISION)
        self.assertEqual(self.revision(), REVISION)
        self.assertEqual(self.snapshot(tables), before)


if __name__ == "__main__":
    unittest.main(verbosity=2)
