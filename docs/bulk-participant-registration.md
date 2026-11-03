# Bulk participant registration and spreadsheet import

## Delivered workflows

This extension adds an atomic bulk-registration API, a multi-select interface for existing participants, and a server-validated CSV/XLSX participant-import workflow. Existing single-participant APIs, Day 9 event/attendance/task flows, authentication, and organization permissions remain available. No commit or push was performed.

Only active organization Owners and Admins can preview or apply imports and register batches. The backend checks authorization on every request, including a retry that returns a saved receipt. Members and Viewers retain their existing read permissions.

### Register existing participants

Open an event’s **Participants & registrations** section. Search the organization directory, choose individual eligible participants, use **Select All Eligible**, or **Deselect All**. Select All Eligible includes the full eligible organization list, including participants outside the current search. Hidden selections remain selected.

The interface displays capacity, registered count, remaining places, and selected count. **Register Selected** opens a confirmation listing the names, event, and fee requirement. An empty selection, more than 1,000 participants, an unavailable participant, or insufficient capacity prevents a new batch. The server rechecks every condition when saving.

Participants with any existing registration for the event are excluded, including cancelled registrations. A new idempotency key does not bypass this permanent event/participant uniqueness rule; it does not reactivate cancelled registrations.

### Import new participants

Open **Participants → Import participants**, or `/participants?import=1`.

1. Download the CSV template. It contains only the `full_name` header.
2. Upload a CSV or XLSX file and request **Preview import**. The server parses and validates the file without writing participants or registrations.
3. Review each source row, normalized full name, validation errors, duplicates within the file, and matches in the existing organization directory. Invalid or duplicate rows cannot be selected.
4. Select the valid rows to create. If invalid rows exist, explicitly acknowledge that those rows will be skipped. Unselected valid rows are also excluded.
5. Optionally select an existing event and a fee requirement for the new registrations. The UI verifies event scope/status and reads current registration capacity before enabling review.
6. Confirm the exact selected count, excluded count, organization, event, and capacity information. The backend revalidates and saves the selected batch in one transaction.

Atomicity applies to the explicitly selected rows. A preview may contain excluded invalid rows; that does not make the selected batch partially successful. Every selected participant and optional registration succeeds together, or none of that batch is committed.

Duplicate-name matching collapses whitespace, trims, and compares with Unicode case folding. This is a conservative duplicate check, not proof that two records represent the same human. Review possible duplicates manually. The existing manual participant-create flow still permits two different people to share a name; imports do not silently reuse an existing participant.

## API contracts

These are backend paths. The frontend’s existing `/backend` proxy prefix is removed before forwarding to FastAPI. All requests use the existing JWT bearer authentication; file preview sends multipart form data without a manually assigned content type.

| Endpoint | Request | Successful response |
| --- | --- | --- |
| `POST /api/v1/registrations/bulk` | JSON `{event_id,participant_ids,fee_required,idempotency_key}`. One to 1,000 unique participant UUIDs. | HTTP 200 `{operation_id,idempotency_key,event_id,created_count,registrations,replayed}`. |
| `POST /api/v1/participants/import/preview` | Multipart `organization_id` and `file`. | HTTP 200 `{organization_id,filename,rows,total_rows,valid_rows,invalid_rows}`. Each row includes `row_number`, `full_name`, `errors`, nullable `duplicate_of_row`, and nullable `existing_participant_id`. Read-only. |
| `POST /api/v1/participants/import` | JSON `{organization_id,rows,event_id,fee_required,idempotency_key}`. Selected rows contain `{row_number,full_name}`. | HTTP 200 `{operation_id,idempotency_key,organization_id,event_id,created_count,registered_count,participants,registrations,replayed}`. |

A new operation uses a new UUID idempotency key. Retry the same operation with the same payload and key. Replace all UUID placeholders below with real authorized resource IDs and a newly generated UUID; no credentials are included in these examples.

Bulk registration:

```json
{
  "event_id": "EVENT_UUID",
  "participant_ids": ["FIRST_PARTICIPANT_UUID", "SECOND_PARTICIPANT_UUID"],
  "fee_required": false,
  "idempotency_key": "NEW_OPERATION_UUID"
}
```

Apply selected import rows after preview:

```json
{
  "organization_id": "ORGANIZATION_UUID",
  "rows": [
    {"row_number": 2, "full_name": "Example participant"},
    {"row_number": 5, "full_name": "Another example participant"}
  ],
  "event_id": null,
  "fee_required": false,
  "idempotency_key": "NEW_OPERATION_UUID"
}
```

Set `event_id` to an authorized event UUID to register every newly created participant in the same transaction. A fee requirement needs a selected event. Imports create new directory entries only; existing participants use the bulk-registration workflow.

Validation failures use normal FastAPI detail responses. Apply-time row errors include `row_number`; registration-batch errors include participant identity/index information. The frontend retains and displays those details. Permission, duplicate, event-state, capacity, and concurrent-update conflicts are rejected by the backend rather than simulated in the client.

## Atomic writes, capacity, and retry behavior

New batches accept planned or active, non-archived events. All selected participants must belong to the event’s organization. The backend counts current `registered` registrations and rejects the complete new batch if there is insufficient capacity. It does not automatically reduce a batch to fit.

Bulk registration locks the event row using `FOR UPDATE`, matching the existing single-registration locking design. Import with event registration uses the same event lock. Import also locks the organization while rechecking directory duplicates. The manual participant-create endpoint now takes that organization lock as well, preserving its existing duplicate-name behavior while coordinating with imports. Task APIs and task models were not changed.

A successful batch commits both its resource rows and a durable PostgreSQL receipt in the same transaction. The new `bulk_operations` table records organization, user, key, operation type, canonical request hash, original result, and creation time. A unique constraint on `(organization_id,user_id,idempotency_key)` and transaction-scoped locking serialize concurrent use of a key.

- The same authorized user, organization, key, operation, and canonical payload returns the original saved result with `replayed: true`.
- The same key with another payload or operation returns HTTP 409.
- Current authorization is rechecked before receipt replay. A replay resolves the earlier saved operation even if event state, capacity, or eligible-participant reads changed afterwards.
- No receipt is committed for a rejected batch. A failed batch cannot leave a partial set of new participants or registrations.
- Receipts have no automatic TTL or expiry. No background cleanup job was added.

After a network/5xx uncertainty, the UI freezes the confirmed request and its key in memory. **Retry same batch** or **Retry unchanged import** submits that immutable snapshot. It must not rebuild the request from a refreshed directory that now excludes already-saved rows, or block the retry because the saved batch consumed the capacity.

Changing a confirmed operation’s payload starts a new operation/key. The bulk-selection UI requires an explicit recovery-discard confirmation before changing an uncertain batch. Import controls remain frozen until the saved outcome is resolved. No additional participant-name snapshot is persisted in browser storage. Keep the import screen open to retain its retry reference; after leaving/reloading, refresh real directory/registration data before starting another import. Durable receipts remain on the server, and existing-record checks still prevent a fresh key from creating duplicate registrations/imported names.

## File format and bounds

| Limit | Behavior |
| --- | --- |
| Formats | `.csv` and `.xlsx` only. Legacy `.xls`, macro-enabled file extensions, encrypted workbooks, and malformed files are rejected. |
| Upload size | At most 5 MiB. |
| Data rows | At most 1,000 per import. Source row numbers start at 2 after the header. |
| Header | The first row must contain exactly one `full_name` column. Header matching is normalized/case-insensitive. Only full names are imported; extra columns have no field-mapping behavior. |
| CSV encoding | UTF-8, with or without a BOM (`utf-8-sig`). Comma, semicolon, or tab separators are detected. Other encodings must be converted to CSV UTF-8. |
| XLSX worksheet | Only the first worksheet supplies imported names. Workbook safety limits are also checked before parsing. |
| XLSX expansion | At most 20 MiB total expanded archive content, bounded archive entries/cells, and at most 64 columns. Oversized worksheet content is rejected even if a different sheet would otherwise be ignored. |
| Name values | Plain text, normalized whitespace, required, at most 150 characters. Formula cells in the name column are flagged as invalid and never evaluated. Non-text XLSX name cells are invalid. |

There is no custom column mapper, multi-sheet import, legacy XLS support, or automatic existing-participant merge. Invalid rows require correction or explicit exclusion; the UI never invents names to fill missing values.

## Files and integration changes

| File/module | Purpose |
| --- | --- |
| `backend/app/routers/bulk.py` | Three authenticated endpoints and transaction rollback/error handling. |
| `backend/app/schemas/bulk.py` | Bounded request/response contracts and normalization. |
| `backend/app/services/bulk.py` | File parsing, preview, duplicate/capacity validation, locks, atomic batches, and receipt replay. |
| `backend/app/models/bulk_operation.py` | Durable receipt model and organization/user/key uniqueness. |
| `backend/alembic/versions/b891e225d419_add_bulk_operation_receipts.py` | Additive `bulk_operations` table migration, following `ebe128559b9c`. |
| `backend/alembic/env.py` | Includes the new model and supports an explicitly supplied migration connection for isolated tests. |
| `backend/app/main.py` | Registers the new bulk router. |
| `backend/app/routers/participants.py` | Coordinates manual create with import via the organization row lock. |
| `backend/requirements-import.txt` | Additional XLSX parsing dependencies. |
| `frontend/src/features/registrations/RegistrationCreateForm.tsx` | Bulk selection, confirmation, receipt feedback, and immutable recovery workflow. |
| `frontend/src/features/registrations/EventRegistrations.tsx` | Keeps confirmed-batch recovery available after event state changes; refreshes saved registration data. |
| `frontend/src/features/registrations/BulkParticipantChecklist.tsx` | Searchable checkbox list and full-list select/deselect controls. |
| `frontend/src/features/registrations/BulkRegistrationSelection.ts` | Batch validation, stable payload identity, retry and error helpers. |
| `frontend/src/features/registrations/BulkRegistrationApi.ts` | Real bulk API call and receipt consistency checks. |
| `frontend/src/features/registrations/types.ts` | Bulk contracts alongside existing registration types. |
| `frontend/src/features/participants/import/types.ts` | Import request, preview, row, and result contracts. |
| `frontend/src/features/participants/import/api.ts` | Multipart preview and JSON apply calls with runtime response validation. |
| `frontend/src/features/participants/import/policies.ts` | File/row selection, payload identity, and error mapping. |
| `frontend/src/features/participants/import/ImportPreviewTable.tsx` | Accessible row selection and validation feedback. |
| `frontend/src/features/participants/import/ParticipantImportPanel.tsx` | Upload, preview, optional registration, confirmation, and immutable retries. |
| `frontend/src/pages/ParticipantsPage.tsx` | Import entry point alongside existing create/search/profile navigation. |
| `frontend/public/participant-import-template.csv` | Downloadable `full_name` header-only template. |
| `frontend/src/components/ui/ConfirmationDialog.tsx` | Shared accessible native confirmation dialog. |
| `frontend/src/services/api.ts` | FormData transport and rich server validation details. |
| `frontend/tests/bulk-registration.test.mjs` | Production-source bulk-selection/API regression tests. |
| `frontend/tests/participant-import.test.mjs` | Production-source import validation/API/FormData regression tests. |
| `frontend/tests/day9.browser.mjs` | Extended real-browser import, batch, recovery, and persistence acceptance checks. |
| `backend/tests/test_bulk_integration.py` | Real PostgreSQL/HTTP atomicity, concurrency, validation, isolation, replay, and parser checks. |
| `backend/tests/test_bulk_migration.py` | Applies historical and new migrations only in a disposable test database; checks existing records, schema, constraints, and receipt uniqueness. |
| `backend/tests/day9_server.py` | Registers actual bulk routes in the isolated test API. |
| `frontend/package.json` | Includes the added regression suites in `npm test`. |
| `frontend/README.md` | Links this workflow, setup, and validation report. |
| `docs/bulk-participant-registration.md` | Feature contracts, changed-file inventory, operational limits, and verified results. |

Existing credentials, root `.env`, development records, and historical migrations were preserved. This feature adds one new migration; it does not rewrite older migrations or reset data.

## Installation and deployment

The additional backend manifest allows `openpyxl>=3.1.5,<4` and `defusedxml>=0.7.1,<1`; the installed versions validated for this work are openpyxl 3.1.5 and defusedxml 0.7.1. No frontend dependency was added.

From `backend`, install the import dependencies into the existing virtual environment:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-import.txt
```

The new API requires migration `b891e225d419`, which adds `bulk_operations` without deleting existing records. During normal deployment, take the normal database backup, then apply the additive migration using the existing environment configuration:

```powershell
.\.venv\Scripts\python.exe -m alembic upgrade head
```

Do not reset the database, rewrite `.env`, or run an Alembic downgrade to deploy this feature. Migration execution/verification status for this work is recorded below. Existing frontend API-base/proxy/CORS settings remain unchanged.

## Validation record

| Check | Result |
| --- | --- |
| `npm test` | 70 frontend regression tests passed across Day 8, Day 9, bulk registration, and import suites. Tests execute production validation/API code with explicit network/session boundaries. |
| `npm run build` | Passed with strict TypeScript checking. |
| `npm run lint` | Passed. |
| Real browser/API/PostgreSQL | 18 scenarios passed. Includes all Day 9 flows, CSV invalid-row preview and optional registration, XLSX formula rejection with lost-response receipt replay, and 100-participant CSV creation/full-list selection/deselection/bulk registration with a lost response, zero remaining eligible participants, smaller post-save capacity, and persistence after refresh. |
| Backend bulk integration suite | All 31 tests passed, including 1/10/100 participants, RBAC/tenant isolation, capacity, concurrent bulk/single/import requests, replay, invalid spreadsheets, and rollback after a real receipt database failure. The discovered organization/event/FK deadlock was fixed with `FOR NO KEY UPDATE` directory locking. |
| Additive Alembic migration verification | Passed in a separate disposable database. Existing rows, table schemas, and constraints were identical after upgrade; JSON receipts, uniqueness, and repeated upgrade were verified. |
| Existing development database migration | Applied `ebe128559b9c` → `b891e225d419`. Every existing record in all eight domain tables was compared before/after and remained unchanged. No reset or deletion performed. |

Real data-changing tests use a dedicated local PostgreSQL 17 Docker test container, a separate port and randomized `fieldops_day9_test_*` database, and generated credentials. They do not treat the development database as disposable.

Rerun frontend checks from `frontend`:

```powershell
npm run build
npm run lint
npm test
```

With `FIELDOPS_TEST_DATABASE_URL` configured for the explicitly named isolated local PostgreSQL database, run from `backend`:

```powershell
.\.venv\Scripts\python.exe -B -m unittest discover -s tests -p test_bulk_integration.py -v
.\.venv\Scripts\python.exe -B -m unittest discover -s tests -p test_bulk_migration.py -v
```

Run the real browser suite from `frontend` after building, with the same isolated test-database environment and an available Playwright/Chrome runtime:

```powershell
npm run test:browser
```

The existing test runner accepts `FIELDOPS_PLAYWRIGHT_MODULE` for an available Playwright installation. No test connection URL, generated password, bearer token, or production credential is included in this document.

## Remaining work and limits

- All requested implementation and validation checks are complete; no known blocking errors remain.
- Keep receipt storage capacity and any future retention policy under explicit review; durable retry behavior currently has no automatic receipt expiry.
- Larger imports require separate batches of at most 1,000 names; multi-sheet/custom-column/legacy-file import and automatic person identity resolution remain unsupported.
- Existing cancelled registrations remain terminal; this work does not add reactivation or attendance undo.
- Deployment still requires the existing production HTTPS, SPA routing, API proxy/base URL, and explicit CORS configuration where cross-origin hosting is used.
