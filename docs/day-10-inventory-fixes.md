FieldOps Pro — Day 10 inventory fixes, November 3, 2026

All six requested defects are addressed in code. Final verification passed: 110 backend integration tests, 11 schema/seed tests, and 6 migration tests. Development remains at `e53dc831db7c`; the new migration has not been applied there.

The new migration is `7f82ac19d604`, parent `e53dc831db7c`. It is the only migration created in this task. SHA-256 verification confirmed that all 13 pre-existing migration files, including `e53dc831db7c_create_inventory_tables.py`, remain unchanged. Existing uncommitted inventory work was preserved. No frontend, authentication dependency, existing role data, commit, or push was changed.

| Issue | Root cause | Fix and behavior |
|---|---|---|
| Archived workspace writes | Inventory router lacked the shared mutation dependency, and canonical creation scope lacked the inventory path. | Added `guard_workspace_mutation` to production router registration and mapped category creation to its body `organization_id`. Existing organization row locking is reused unchanged. Active writes return 201; archived writes return 409 without persisting a category. Restore permits writes again. |
| NUL text | Length validation accepted NUL; PostgreSQL text rejected it with a DataError, producing 500. | Shared Pydantic validators reject NUL in both name and description for Create and Update. Creation requests return 422. Database error handling was not broadened to classify all failures as 409. |
| Blank names | Raw length validation accepted whitespace-only names. | Both input schemas strip names before validation and reject blank results. Maximum length applies after trimming. Existing case-sensitive uniqueness is preserved: `Camping` and `camping` remain distinct; ` Camping ` normalizes to `Camping`. Description whitespace is retained. |
| Non-finite quantities | Ordinary numeric comparisons, direction checks and balance arithmetic permit PostgreSQL numeric NaN. | Both models and one additive migration explicitly exclude NaN, Infinity and -Infinity from all five quantity columns. Existing nonnegative, type, direction and balance constraints remain intact. |
| Legacy seed role | The seed used lowercase `owner` instead of canonical `Owner` and ran on import. | New seed memberships use `Owner`. Seed logic now has an import-safe entry point and an injectable session for focused tests. Existing memberships are not rewritten, and authorization remains case-sensitive. |
| Migration regressions | Historical QA tests upgraded to a moving `head` while asserting revision `e95a03`. | Pinned those historical tests to `e95a03` and added separate inventory migration tests for the current additive constraint change. |

Every file modified or created by this task:

| File | Task action |
|---|---|
| [backend/app/main.py](C:/Projects/FieldOps-Pro/backend/app/main.py:46) | Modified inventory router registration to reuse the archive guard. |
| [backend/app/services/archive.py](C:/Projects/FieldOps-Pro/backend/app/services/archive.py:106) | Added inventory category canonical organization scope. |
| [backend/app/schemas/inventory_category.py](C:/Projects/FieldOps-Pro/backend/app/schemas/inventory_category.py:14) | Added shared Create/Update name and NUL validation. This file existed untracked at task start. |
| [backend/app/models/inventory_item.py](C:/Projects/FieldOps-Pro/backend/app/models/inventory_item.py:49) | Added two finite-value constraints. This file existed untracked at task start. |
| [backend/app/models/inventory_movement.py](C:/Projects/FieldOps-Pro/backend/app/models/inventory_movement.py:56) | Added three finite-value constraints. This file existed untracked at task start. |
| [backend/seed_test_membership.py](C:/Projects/FieldOps-Pro/backend/seed_test_membership.py:7) | Corrected future seed role and added import-safe entry point; no seed ran on development. |
| [backend/tests/day9_server.py](C:/Projects/FieldOps-Pro/backend/tests/day9_server.py:63) | Registered inventory in the existing isolated integration server with the shared guard. |
| [backend/tests/test_qa_migration.py](C:/Projects/FieldOps-Pro/backend/tests/test_qa_migration.py:21) | Preserved historical QA regression scope by pinning its revision. |
| [backend/alembic/versions/7f82ac19d604_inventory_finite_quantities.py](C:/Projects/FieldOps-Pro/backend/alembic/versions/7f82ac19d604_inventory_finite_quantities.py:25) | Created the single additive migration. |
| [backend/tests/test_inventory_validation.py](C:/Projects/FieldOps-Pro/backend/tests/test_inventory_validation.py:17) | Created 11 focused schema/seed tests. |
| [backend/tests/test_inventory_integration.py](C:/Projects/FieldOps-Pro/backend/tests/test_inventory_integration.py:25) | Created 11 inventory HTTP tests, including actual production registration and concurrency. |
| [backend/tests/test_inventory_migration.py](C:/Projects/FieldOps-Pro/backend/tests/test_inventory_migration.py:40) | Created three migration tests with multiple fresh databases and subcases. |
| [backend/tests/inventory_data_audit.py](C:/Projects/FieldOps-Pro/backend/tests/inventory_data_audit.py:26) | Created an explicitly invoked read-only preflight/fingerprint utility. |
| [docs/day-10-inventory-fixes.md](C:/Projects/FieldOps-Pro/docs/day-10-inventory-fixes.md) | Created this handoff report. |

`backend/app/models/__init__.py` already had user changes; its contents were preserved exactly. Existing category/location models, inventory router, and migration `e53dc831db7c` were not modified by this task.

| Required test | Result | Evidence |
|---|---|---|
| 1. Syntax and imports | PASS | All 88 backend Python files parsed and compiled in memory. All 54 application modules imported with DB connection methods blocked. Corrected seed imported safely. SQLAlchemy mapper configuration and PostgreSQL DDL compilation passed. |
| 2. Create/Update schema validation | PASS | Trimming before length checks; blank/Unicode-whitespace rejection; NUL in both fields; required fields/types/lengths; omitted versus explicit-null update name; case preservation. |
| 3. Owner/Admin success | PASS | Both roles create categories with 201 and committed persistence. |
| 4. Member 403 and outsider 404 | PASS | Member, Viewer, Treasurer and Logistics receive 403. Outsider and unrelated Owner receive 404. |
| 5. Unauthenticated 401 | PASS | Missing authentication and invalid bearer token receive 401. |
| 6. Duplicate category 409 | PASS | Exact and trimmed duplicates return 409; concurrent duplicate requests yield one 201 and one 409. |
| 7. Archived workspace 409 | PASS | Owner/Admin denied without writes; restored workspace accepts creation. Three archive/write races and canonical body/query/media-type scope cases passed. |
| 8. Invalid input 422 | PASS | Blank and NUL inputs, missing fields, invalid UUID, invalid types, oversized text, malformed JSON and non-object bodies rejected. |
| 9. NaN database rejection | PASS | All five columns reject non-finite stored values after migration. Direct model/database constraint expression checks also verify NaN and positive/negative infinity independently of numeric precision and old stock checks. |
| 10. Organization isolation | PASS | Cross-organization and unknown resources hidden with 404; inactive membership hidden. Identical category names in separate organizations succeed. |
| 11. Existing backend integration regressions | PASS | 110/110 total: all 99 existing tests plus 11 new inventory tests, in 81.243 seconds. |
| 12. Isolated Alembic upgrades/downgrades | PASS | 6/6 total: three historical and three new inventory methods, in 29.833 seconds. Includes repeated upgrade, downgrade to parent, re-upgrade, all-table row/schema preservation, original stock rules, and atomic rollback on existing NaN rows in five fresh databases. |

The 11 validation/seed tests passed in 3.061 seconds. Final suites executed 127 passing tests in total. An initial inventory test relied on direct enumeration of FastAPI routes, but this installation represents included routers with deferred entries. That test was corrected to exercise actual production registration through real authentication and HTTP behavior; the final complete integration run passed. No unresolved test failures remain.

All write tests ran in the labelled disposable PostgreSQL 17 container `fieldops-qa-cb01902a215b`. Integration schemas used model metadata. Migration tests created fresh, validated `fieldops_day9_test_*` databases inside that same test cluster and passed explicit test connections to Alembic. No development-engine connection was used by the new production-app integration test; only its `get_db` dependency was redirected, and real JWT authentication was retained. The disposable container and generated runtime state were removed after testing.

Development data preservation was verified using `REPEATABLE READ` transactions with `postgresql_readonly=True`, and `SHOW transaction_read_only` returned `on`. Before/after row counts and SHA-256 fingerprints matched for every one of the 18 public tables, including `alembic_version`, inventory tables and memberships. Revision remained `e53dc831db7c`. All four inventory tables currently contain zero rows, and all five non-finite quantity counts are zero. The active role counts remain: Owner 5, Member 1, Treasurer 1, Viewer 1, lowercase owner 1. No persisted role was corrected automatically.

The new constraint names are:

- `ck_inventory_items_current_quantity_finite`
- `ck_inventory_items_minimum_quantity_finite`
- `ck_inventory_movements_quantity_delta_finite`
- `ck_inventory_movements_quantity_before_finite`
- `ck_inventory_movements_quantity_after_finite`

Upgrade validates existing records and adds only those five checks. If invalid historical values exist, PostgreSQL aborts the migration transaction: tests verify no partial constraints, no revision advance, and no row cleanup. Downgrade removes only those five checks, retaining all tables, data and original constraints.

Remaining limitations and safe next steps:

1. The database constraint fix is pending on development until explicitly approved. Development migration execution is NOT TESTED/NOT APPLIED intentionally; applying and verifying it is a separate step.
2. One existing active lowercase `owner` membership still receives 403 under canonical RBAC. Review the account and intended ownership separately before authorizing any persisted-role correction. The seed correction prevents new instances; it intentionally does not repair that row.
3. Update validation was tested directly against Pydantic schemas. The existing inventory router exposes only POST; this task did not add an update endpoint.
4. Before applying, take a database backup and rerun the read-only preflight immediately before the change. If any non-finite count becomes nonzero, stop and review those records; do not clean them automatically.
5. Review the additive migration and arrange a suitable maintenance window for PostgreSQL constraint validation/locks. Obtain explicit approval before any development upgrade. Only then, from the backend directory and its configured environment, apply `alembic upgrade 7f82ac19d604`; verify the revision, five checks, archive behavior and category POST afterward.

Reproduction commands from the project root, with Docker available:

```powershell
.\backend\.venv\Scripts\python.exe -B backend/tests/inventory_data_audit.py --development-read-only
.\backend\.venv\Scripts\python.exe -B backend/tests/qa_runtime.py start
.\backend\.venv\Scripts\python.exe -B backend/tests/qa_runtime.py test test_inventory_validation.py
.\backend\.venv\Scripts\python.exe -B backend/tests/qa_runtime.py test 'test_*integration.py'
.\backend\.venv\Scripts\python.exe -B backend/tests/qa_runtime.py test 'test_*migration.py'
.\backend\.venv\Scripts\python.exe -B backend/tests/qa_runtime.py stop
```

No development reset, seed, data update, migration, commit or push was performed.
