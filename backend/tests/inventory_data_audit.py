"""Read-only development inventory preflight; never runs schema or data writes.

From the project root:
    backend/.venv/Scripts/python.exe -B backend/tests/inventory_data_audit.py --development-read-only

Only counts, roles, revision and row fingerprints are printed, never secrets or
row contents. Repeat before/after testing to verify development data preservation.
"""

import argparse
import hashlib
import json
import sys
from pathlib import Path

from sqlalchemy import inspect, text


QUANTITY_COLUMNS = {
    "inventory_items": ("current_quantity", "minimum_quantity"),
    "inventory_movements": ("quantity_delta", "quantity_before", "quantity_after"),
}


def audit_development():
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from app.database import engine

    try:
        with engine.connect().execution_options(
            isolation_level="REPEATABLE READ", postgresql_readonly=True,
        ) as connection:
            with connection.begin():
                readonly = connection.scalar(text("SHOW transaction_read_only"))
                if readonly != "on":
                    raise RuntimeError("Refusing an audit without a read-only transaction")
                inspector = inspect(connection)
                tables = sorted(inspector.get_table_names(schema="public"))
                quote = connection.dialect.identifier_preparer.quote_identifier
                fingerprints = {}
                for name in tables:
                    digest = hashlib.sha256()
                    count = 0
                    rows = connection.exec_driver_sql(
                        f"SELECT to_jsonb(t)::text FROM public.{quote(name)} t ORDER BY to_jsonb(t)::text"
                    )
                    for (row,) in rows:
                        encoded = row.encode("utf-8")
                        digest.update(len(encoded).to_bytes(8, "big"))
                        digest.update(encoded)
                        count += 1
                    fingerprints[name] = {"rows": count, "sha256": digest.hexdigest()}
                nonfinite = {}
                for table, columns in QUANTITY_COLUMNS.items():
                    if table not in tables:
                        nonfinite[table] = {"status": "TABLE ABSENT"}
                        continue
                    nonfinite[table] = {
                        column: connection.scalar(text(
                            f"SELECT count(*) FROM public.{quote(table)} WHERE {quote(column)} "
                            "IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)"
                        )) for column in columns
                    }
                return {
                    "database": connection.scalar(text("SELECT current_database()")),
                    "transaction_read_only": readonly,
                    "revision": list(connection.scalars(text("SELECT version_num FROM alembic_version"))),
                    "membership_roles": [dict(row) for row in connection.execute(text(
                        "SELECT role, status, count(*) AS count FROM memberships "
                        "GROUP BY role, status ORDER BY role, status"
                    )).mappings()],
                    "noncanonical_memberships": [
                        {
                            "membership_id": str(row["id"]),
                            "user_id": str(row["user_id"]),
                            "organization_id": str(row["organization_id"]),
                            "role": row["role"],
                            "status": row["status"],
                        }
                        for row in connection.execute(text(
                            "SELECT id, user_id, organization_id, role, status FROM memberships "
                            "WHERE role NOT IN ('Owner','Admin','Treasurer','Logistics','Member','Viewer') "
                            "ORDER BY id"
                        )).mappings()
                    ],
                    "nonfinite_quantity_counts": nonfinite,
                    "data_fingerprints": fingerprints,
                }
    finally:
        engine.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--development-read-only", action="store_true", required=True)
    parser.parse_args()
    print(json.dumps(audit_development(), indent=2, sort_keys=True))
