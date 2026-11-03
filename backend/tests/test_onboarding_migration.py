"""Upgrade only disposable PostgreSQL data; preserve all historical records."""

import uuid

from sqlalchemy import MetaData, Table, inspect, select, text
from sqlalchemy.exc import IntegrityError

import test_bulk_migration as bulk


class OnboardingMigrationPreservation(bulk.BulkMigrationPreservation):
    def test_additive_migration_preserves_all_old_tables_records_and_constraints(self):
        # This creates historical tables, seeds every Day 9 domain, applies the
        # bulk receipt migration, and validates its existing JSON receipt too.
        super().test_additive_migration_preserves_all_old_tables_records_and_constraints()
        names = (*bulk.DOMAIN_TABLES, "bulk_operations")
        metadata = MetaData()
        tables = {name: Table(name, metadata, autoload_with=self.engine) for name in names}
        with self.engine.begin() as connection:
            organization = connection.execute(select(tables["organizations"])).mappings().one()
            connection.execute(tables["organizations"].update().where(tables["organizations"].c.id == organization["id"]).values(name="  Groupe   Sainte Ríta  "))
            # Two legitimate historical organizations may already share a name.
            connection.execute(tables["organizations"].insert().values(id=uuid.uuid4(), name="  Groupe   Sainte Ríta  "))
        before_rows = self.snapshot(tables)
        before_schema = self.schema_snapshot()
        before_names = set(inspect(self.engine).get_table_names())
        self.upgrade("d92a6f31c047")
        after_names = set(inspect(self.engine).get_table_names())
        self.assertEqual(after_names, before_names | {"organization_join_requests", "onboarding_rate_limits"})
        self.assertEqual(self.snapshot(tables), before_rows, "Historical rows changed")
        after_schema = self.schema_snapshot()
        for name in bulk.DOMAIN_TABLES:
            for key in before_schema[name]:
                if name == "organizations" and key in {"columns", "indexes", "checks"}:
                    self.assertTrue(all(old in after_schema[name][key] for old in before_schema[name][key]))
                else:
                    self.assertEqual(after_schema[name][key], before_schema[name][key])
        organizations = Table("organizations", MetaData(), autoload_with=self.engine)
        with self.engine.connect() as connection:
            records = connection.execute(select(organizations)).mappings().all()
            self.assertEqual(len(records), 2)
            for record in records:
                self.assertEqual(record["name"], "  Groupe   Sainte Ríta  ")
                self.assertEqual(record["normalized_name"], "groupe sainte rita")
                self.assertEqual(record["organization_type"], "Other")
                self.assertFalse(record["is_discoverable"])
                self.assertIsNone(record["country"])
                self.assertIsNone(record["city"])
                self.assertIsNone(record["description"])
            self.assertEqual(connection.scalar(text("SELECT version_num FROM alembic_version")), "d92a6f31c047")
        inspector = inspect(self.engine)
        request_indexes = inspector.get_indexes("organization_join_requests")
        self.assertTrue(any(index["unique"] and "postgresql_where" in index.get("dialect_options", {}) for index in request_indexes))
        self.assertEqual({fk["referred_table"] for fk in inspector.get_foreign_keys("organization_join_requests")}, {"organizations", "users"})
        requests = Table("organization_join_requests", MetaData(), autoload_with=self.engine)
        seed_user = before_rows["users"][0]["id"]
        pending = {"id": uuid.uuid4(), "organization_id": records[0]["id"], "user_id": seed_user, "status": "pending", "message": "Disposable migration test"}
        with self.engine.begin() as connection:
            connection.execute(requests.insert().values(**pending))
        with self.assertRaises(IntegrityError):
            with self.engine.begin() as connection:
                connection.execute(requests.insert().values(**{**pending, "id": uuid.uuid4()}))
        self.upgrade("d92a6f31c047")
        self.assertEqual(self.snapshot(tables), before_rows)


if __name__ == "__main__":
    import unittest
    unittest.main(verbosity=2)
