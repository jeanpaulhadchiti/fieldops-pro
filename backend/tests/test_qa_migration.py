"""Verify the full QA upgrade against seeded historical PostgreSQL records."""
from sqlalchemy import MetaData, Table, inspect, select, text

import test_onboarding_migration as onboarding
import test_bulk_migration as bulk


class QAMigrationPreservation(onboarding.OnboardingMigrationPreservation):
    def snapshot(self, tables):
        with self.engine.connect() as connection:
            return {name: [dict(row) for row in connection.execute(select(table).order_by(*table.primary_key.columns)).mappings()]
                    for name, table in tables.items()}

    def test_additive_migration_preserves_all_old_tables_records_and_constraints(self):
        super().test_additive_migration_preserves_all_old_tables_records_and_constraints()
        inspector = inspect(self.engine)
        names = inspector.get_table_names()
        tables = {name: Table(name, MetaData(), autoload_with=self.engine) for name in names if name != 'alembic_version'}
        before = self.snapshot(tables)
        before_schema = self.schema_snapshot()
        self.upgrade('head')
        self.assertEqual(self.snapshot(tables), before, 'Every historical column and row must remain unchanged')
        after_schema = self.schema_snapshot()
        for name in bulk.DOMAIN_TABLES:
            for key, values in before_schema[name].items():
                if name == 'organizations' and key in {'columns', 'foreign_keys'}:
                    self.assertTrue(all(value in after_schema[name][key] for value in values))
                else:
                    self.assertEqual(values, after_schema[name][key])
        inspector = inspect(self.engine)
        self.assertEqual(set(inspector.get_table_names()), set(names) | {'notifications', 'organization_archive_events'})
        organizations = Table('organizations', MetaData(), autoload_with=self.engine)
        with self.engine.connect() as connection:
            for record in connection.execute(select(organizations)).mappings():
                self.assertIsNone(record['organization_type_other'])
                self.assertIsNone(record['archived_at'])
                self.assertIsNone(record['archived_by'])
                self.assertFalse(record['is_discoverable'])
            self.assertEqual(connection.scalar(text('SELECT version_num FROM alembic_version')), 'e95a03')
        unique = inspector.get_unique_constraints('notifications')
        self.assertTrue(any(set(item['column_names']) == {'recipient_id', 'join_request_id'} for item in unique))
        self.upgrade('head')
        self.assertEqual(self.snapshot(tables), before, 'Repeated upgrade must preserve historical data')
