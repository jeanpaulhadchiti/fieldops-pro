FieldOps Pro — Day 10 final backend repairs

Completed November 4, 2026. Executive verdict: **READY for commit** within the requested repair scope. Development remains at `7f82ac19d604`; deploying the new movement code requires the separately approved migration described below. The legacy membership correction remains pending explicit authorization.

Final test accounting: **157 passed, 0 failed, 0 skipped**. This counts each collected unittest method once across the final suites:130 integration methods,11 migration methods,11 existing validation/seed methods,3 validation-response methods and2 startup/registration methods. Preliminary subset runs and the five-method migration rerun after adding schema-drift verification are not counted twice. There are no unresolved test failures.

| Confirmed issue | Root cause | Implemented repair |
|---|---|---|
| 1. Startup failure | Category Update annotation referenced an unimported class. | Imported the existing InventoryCategoryUpdate schema. Fresh-interpreter app.main import and production OpenAPI tests pass. |
| 2. Category DELETE failure | Linked-item deletion check referenced unimported InventoryItem. | Imported the existing model. Real Owner/Admin unused deletion204 and referenced deletion409 tests pass, along with permissions, tenant isolation and archive protection. |
| 3. Raw NaN/Infinity500 | Rejected non-finite floats remained in validation-error details and could not be JSON serialized. | Added a narrow application RequestValidationError handler: rejected non-finite numeric error values become safe strings; ordinary errors delegate unchanged to FastAPI's standard handler. No dependency package was edited. Raw and quoted NaN/Infinity/-Infinity return422 for item Create, item PATCH and movement Create. |
| 4. Ledger chronology | Transaction-start now() timestamps and random UUIDs did not represent the order stock changes acquired the item lock. | Added positive per-item sequence_number, unique within organization/item; allocated max+1 under the existing item FOR UPDATE lock and committed with stock/movement in the same transaction. Item history orders by sequence descending. Global history uses a running timestamp maximum computed over sequence to retain cross-item recency while preserving per-item order, including timestamp inversions. |
| 5. Protected stock input | Item schemas silently ignored extra fields. | Item Create/Update now use ConfigDict(extra='forbid'). current_quantity, archived, injected id and unknown fields return422 without partial updates. Normal decimals and numeric strings remain supported. |
| 6. Lowercase owner | One existing active membership uses a noncanonical role. | Expanded the explicitly read-only audit to identify noncanonical memberships and documented a separately approved correction procedure. No role was changed or elevated; canonical Owner/Admin semantics remain exact. |
| 7. Regression coverage drift | Isolated test app duplicated a stale router list. | The test API now uses actual app.main.app, all production routes/dependencies/exception handlers, and only redirects get_db. A test-only ASGI health probe verifies DB identity. Development-engine connections are blocked. Full CRUD, security, startup/OpenAPI, input and ledger tests were added. |

Every modified or created file in this repair task:

| File | Action |
|---|---|
| [backend/app/routers/inventory_categories.py](C:/Projects/FieldOps-Pro/backend/app/routers/inventory_categories.py:19) | Modified: two missing imports. |
| [backend/app/main.py](C:/Projects/FieldOps-Pro/backend/app/main.py:14) | Modified: narrow validation-handler import/registration only; existing user router registrations retained. |
| [backend/app/schemas/inventory_item.py](C:/Projects/FieldOps-Pro/backend/app/schemas/inventory_item.py:42) | Modified: forbid extra fields in Create and Update. |
| [backend/app/models/inventory_movement.py](C:/Projects/FieldOps-Pro/backend/app/models/inventory_movement.py:30) | Modified: sequence column, positive check and per-item uniqueness. |
| [backend/app/schemas/inventory_movement.py](C:/Projects/FieldOps-Pro/backend/app/schemas/inventory_movement.py:91) | Modified: expose authoritative sequence_number in read responses. |
| [backend/app/routers/inventory_movements.py](C:/Projects/FieldOps-Pro/backend/app/routers/inventory_movements.py:152) | Modified: sequence allocation under item lock and sequence-respecting history ordering. |
| [backend/tests/day9_server.py](C:/Projects/FieldOps-Pro/backend/tests/day9_server.py:39) | Modified: actual production app, verified disposable sessions and health wrapper. |
| [backend/tests/inventory_data_audit.py](C:/Projects/FieldOps-Pro/backend/tests/inventory_data_audit.py:72) | Modified: read-only noncanonical membership identifiers. |
| [backend/app/validation.py](C:/Projects/FieldOps-Pro/backend/app/validation.py:39) | Created: serialization-safe validation errors for rejected non-finite values. |
| [backend/alembic/versions/a91c4e7b2d60_inventory_movement_order.py](C:/Projects/FieldOps-Pro/backend/alembic/versions/a91c4e7b2d60_inventory_movement_order.py) | Created: the single additive migration. |
| [backend/tests/test_inventory_registration.py](C:/Projects/FieldOps-Pro/backend/tests/test_inventory_registration.py) | Created: fresh startup, production OpenAPI, duplicate registrations and shared-guard checks. |
| [backend/tests/test_inventory_crud_integration.py](C:/Projects/FieldOps-Pro/backend/tests/test_inventory_crud_integration.py) | Created: category/location/item CRUD, all11 write permission/archive matrices, tenant/media spoofing, duplicate races. |
| [backend/tests/test_inventory_input_integration.py](C:/Projects/FieldOps-Pro/backend/tests/test_inventory_input_integration.py) | Created: real-auth non-finite/protected-input rejection and unchanged stock/history. |
| [backend/tests/test_inventory_movements_integration.py](C:/Projects/FieldOps-Pro/backend/tests/test_inventory_movements_integration.py) | Created: balances, sequence ordering,18 stock/archive races, timestamp inversion, immutable public history and actual FK-failure rollback. |
| [backend/tests/test_inventory_order_migration.py](C:/Projects/FieldOps-Pro/backend/tests/test_inventory_order_migration.py) | Created: preservation, ambiguity refusal, sequence constraints, writer refusal, model/default drift and downgrade/re-upgrade tests. |
| [backend/tests/test_validation_errors.py](C:/Projects/FieldOps-Pro/backend/tests/test_validation_errors.py) | Created: exact normal-error compatibility and nested non-finite error serialization. |
| [docs/day-10-legacy-membership-procedure.md](C:/Projects/FieldOps-Pro/docs/day-10-legacy-membership-procedure.md) | Created: read-only audit and proposed role correction, pending authorization. |
| [docs/day-10-final-backend-repairs.md](C:/Projects/FieldOps-Pro/docs/day-10-final-backend-repairs.md) | Created: this handoff report. |

Pre-existing uncommitted work remains intact. SHA-256 preservation checks matched all220 original files outside these eight modified paths, including all14 existing migration files and frontend files. Existing user changes to app.models exports, archive guard, membership seed, historical QA migration tests and other inventory files were preserved. No installed package, frontend, credentials or unrelated configuration was edited.

| Required final check | Result | Executed evidence |
|---|---|---|
| 1. Python syntax/imports | PASS | All102 backend Python files parsed/compiled in memory; all61 application modules imported with DB connection methods blocked; safe membership seed import and mapper configuration pass. |
| 2. import app.main | PASS | Fresh interpreter regression prevents module-cache masking of missing imports. |
| 3. Production OpenAPI | PASS | All19 expected inventory operations are present with no duplicates; all11 writes have guard_workspace_mutation. |
| 4. Category CRUD | PASS | Owner/Admin create/list/get/update/delete; unused204, referenced409; validation, permissions, tenant isolation and archive denial. |
| 5. Storage CRUD | PASS | Full real-auth CRUD, referenced deletion409, duplicate/case/tenant/validation checks and concurrent duplicate creation. |
| 6. Item CRUD/archive/restore | PASS | Defaults, SKU/null SKU, category/location references, filters/pagination/low stock, updates, nonzero-stock archive refusal, zero-stock archive/restore and retained history. |
| 7. Movement types/balances | PASS | Exact sequence0→20→25→15→23→21 verified after every operation; positive adjustment and fractional values also tested. |
| 8. Raw/quoted non-finite values | PASS |18 raw/quoted cases over all three request scenarios return422, with stock/history snapshots unchanged. |
| 9. Protected current_quantity | PASS | POST/PATCH422, plus other protected and unknown fields; valid normal requests retained. |
| 10. Archives/organization isolation | PASS | All11 inventory writes exercise401/403/404/409; archived writes persist no changes, authorized reads remain available, restore enables writes; body/query/media spoofing and cross-tenant references denied. |
| 11. Concurrent stock/ledger | PASS |12 repeated stock/opening races and6 item/organization archive races preserve contiguous unique per-item sequence, exact stock, and movement counts. Category/location duplicates and existing archive/event races also pass. Timestamp inversion fixtures do not reverse history; pagination remains consistent. |
| 12. Atomic rollback | PASS | Real injected movement actor FK failure returns409 with stock/history unchanged; next successful movement reuses sequence1 rather than leaving an allocation gap. |
| 13. Existing regressions | PASS | Complete production-route integration suite130/130, including all99 original application tests and31 inventory methods, in295.337 seconds. |
| 14. Isolated migrations | PASS | All11 historical/current migration methods pass in77.414 seconds. The final five ordering methods were rerun after adding full model/default-drift comparison and pass5/5 in18.670 seconds. |
| 15. Development preservation | PASS | Enforced read-only audit before/after matches row counts and fingerprints for all18 tables, membership roles and revision7f82ac19d604. No development migration or writes. |

Other final suites: existing validation/seed11/11; new validation-response3/3; startup/registration2/2. All final suites have zero failures and zero skips. Earlier subset runs are excluded from the157 total. A sandbox-only TestClient initialization probe could not create Windows loopback sockets; its final execution with allowed loopback access passed, and its temporary process was stopped.

The runtime tests use the production app and real register/login/JWT flows. Every test Session checks its exact selected database. The disposable PostgreSQL17 container was `fieldops-qa-49c46b141f3b`, labelled `fieldops.qa.disposable=true`, separate from `fieldops-db`. HTTP fixtures use current model metadata; Alembic tests create fresh named databases within that verified disposable cluster and execute the real migration chain on explicit test connections. The migrated schema matches model metadata including types/defaults. The disposable container and generated ignored runtime file were removed after completion.

Migration details and historical safety:

- Revision: `a91c4e7b2d60`; parent: `7f82ac19d604`; exactly one new migration and one repository head.
- New column: non-null BigInteger `inventory_movements.sequence_number`.
- New constraints: `ck_inventory_movements_sequence_positive` and `uq_inventory_movements_item_sequence` over organization/item/sequence.
- Allocation happens while the existing inventory item row lock is held; stock update, movement insert and sequence assignment commit atomically. Existing organization-before-item lock order remains unchanged. Sequence is returned read-only; timestamps are retained as recorded data.
- Backfill follows quantity_before→quantity_after from zero to the saved item quantity only when each next movement is uniquely determined. It does not sort by timestamps or UUIDs. Branches, gaps, nonzero starts, invalid opening positions and final-stock mismatches abort the entire transaction without changing old values or advancing the revision.
- All original movement IDs, organizations, items, quantities, actors, notes and timestamps are preserved. Only new ordering metadata is populated. Development has zero inventory rows at this audit, so no historical ambiguity is currently present there; repeat the audit before any approved application.
- The migration requires ACCESS EXCLUSIVE table locks on items then movements, with NOWAIT. An active inventory reader/writer causes immediate transactional refusal rather than indefinite waiting or partial DDL. Use a quiet maintenance window and retry only after confirming transactions have ended.
- Downgrade drops only the new sequence column and its two constraints. It retains original rows/columns/checks. Downgrade discards ordering metadata; re-upgrade may safely refuse a history that has become ambiguous. Never reconstruct such a history by guessing; take a backup and review before rollback.
- Per-item and filtered history is sequence-authoritative. Organization-wide history retains cross-item recency through a monotonic running timestamp anchor, while preserving each item's sequence. It is not a single global stock sequence across unrelated items. Consumers should use sequence_number for an item's stock application order.

Remaining user decisions:

1. The development database has NOT been upgraded. Approval is still required before applying `a91c4e7b2d60`. Deploy the new movement code with its schema migration; new movement queries require the new column.
2. The one active lowercase owner remains unchanged and receives403 for inventory writes. This is intentional under the requested exact RBAC. Use the separate read-only audit/proposed correction document; verify intended ownership and obtain explicit approval before any data correction. No bulk normalization or privilege broadening was added.
3. If another environment has ambiguous historical movement chains, this migration deliberately blocks. An explicit reviewed historical-order decision is required; the code never silently rewrites quantity history.

Exact next steps before committing Day10:

1. Review these18 task files together with the existing uncommitted Day10 work. Review the new migration and the two authorization boundaries above. Confirm that only intended backend/tests/docs files are staged.
2. Keep all previously applied migration files unchanged. `git diff --check` passes; the current implementation has the final157-test passing result. Rerun relevant checks if further edits are made.
3. Commit only after a separate instruction or manual review; this task did not stage, commit or push anything.
4. Separately before deployment: back up development, rerun the explicit read-only audit, obtain migration approval, stop/drain inventory transactions for the quiet window, apply only the reviewed new revision, then verify sequence constraints, stock history, archive behavior and production health. Treat membership correction as a separate approved data change.

Reproduction from the project root, using a fresh disposable cluster:

```powershell
.\backend\.venv\Scripts\python.exe -B backend/tests/inventory_data_audit.py --development-read-only
.\backend\.venv\Scripts\python.exe -B backend/tests/qa_runtime.py start
.\backend\.venv\Scripts\python.exe -B backend/tests/qa_runtime.py test 'test_*integration.py'
.\backend\.venv\Scripts\python.exe -B backend/tests/qa_runtime.py test 'test_*migration.py'
.\backend\.venv\Scripts\python.exe -B backend/tests/qa_runtime.py test test_inventory_validation.py
.\backend\.venv\Scripts\python.exe -B backend/tests/qa_runtime.py test test_validation_errors.py
.\backend\.venv\Scripts\python.exe -B backend/tests/qa_runtime.py test test_inventory_registration.py
.\backend\.venv\Scripts\python.exe -B backend/tests/qa_runtime.py stop
```

No development reset, seed, role update, migration, Git commit or push was performed.
