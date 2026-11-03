"""Read-only audit, or additive upgrade with exact historical-value checks.

This is an operator migration utility, never an automated test. It does not
seed, reset, delete, or archive development records. Output contains no secrets.
"""
import hashlib
import json
from pathlib import Path
import sys

from alembic import command
from alembic.config import Config
from sqlalchemy import MetaData, Table, inspect, select, text

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'backend'))
from app.database import engine  # noqa: E402
from app.organization_names import normalize_organization_name  # noqa: E402


def snapshot(connection, tables):
    result = {}
    for name, table in tables.items():
        rows = [dict(row) for row in connection.execute(select(table).order_by(*table.primary_key.columns)).mappings()]
        result[name] = {'rows': len(rows), 'sha256': hashlib.sha256(json.dumps(rows, default=str, sort_keys=True).encode()).hexdigest()}
    return result


def main():
    apply = len(sys.argv) > 1 and sys.argv[1] == 'apply'
    with engine.begin() as connection:
        inspector = inspect(connection)
        names = [name for name in inspector.get_table_names() if name != 'alembic_version']
        tables = {name: Table(name, MetaData(), autoload_with=connection) for name in names}
        # Prevent other local writers from invalidating the comparison while
        # preserving ordinary read access. No record content is written.
        if apply:
            connection.execute(text('SET LOCAL lock_timeout = \'10s\''))
            for name in sorted(names):
                connection.execute(text('LOCK TABLE ' + connection.dialect.identifier_preparer.quote(name) + ' IN SHARE MODE'))
        before = snapshot(connection, tables)
        revision = connection.scalar(text('SELECT version_num FROM alembic_version'))
        target = normalize_organization_name('Groupe Sainte Rita Di Cascia')
        organizations = tables['organizations']
        matching = [str(row.id) for row in connection.execute(select(organizations.c.id, organizations.c.name))
                    if normalize_organization_name(row.name) == target]
        if apply:
            config = Config(str(ROOT / 'backend/alembic.ini'))
            config.set_main_option('script_location', str(ROOT / 'backend/alembic'))
            config.attributes['connection'] = connection
            command.upgrade(config, 'head')
            after = snapshot(connection, tables)
            if after != before:
                raise RuntimeError('Historical-value comparison failed; transaction will roll back')
        report = {'mode': 'additive_upgrade' if apply else 'read_only_audit', 'previous_revision': revision,
                  'revision': connection.scalar(text('SELECT version_num FROM alembic_version')),
                  'historical_tables': before, 'historical_values_preserved': True if apply else None,
                  'reported_namesake_distinct_uuids': matching}
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
