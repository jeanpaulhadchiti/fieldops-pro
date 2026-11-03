# Day 9.5 QA improvements — completed handover

Verified on 2026-11-03 in `C:\Projects\FieldOps-Pro`. QA-01 through QA-06 are implemented, integrated, and tested. The development database is at revision `e95a03`; every pre-upgrade record and original column value was preserved. The repository is ready to begin Day 10 Inventory development.

## Features delivered

| Item | Result |
| --- | --- |
| QA-01 | Matching Zod/Pydantic signup validation: 10–128 Unicode code points, uppercase A–Z, and a Unicode punctuation/symbol character. Passwords are never trimmed. Requirements and field errors are visible. Existing login validation and Argon2 hashing remain intact; historical short passwords still authenticate. Exactly ten-character passwords, invalid boundaries, Unicode special characters, and preserved whitespace were tested. |
| QA-02 | Selecting Other reveals the required “Specify organization type” field. Values are whitespace-normalized, limited to 100 characters, reject NUL, persist in PostgreSQL, and appear on profiles/discovery cards. Switching to an enumerated type clears the custom value in both client and server. Historical Other records and older name-only create clients remain supported; unrelated profile edits do not require inventing a historical type. |
| QA-03 | Searchable, labelled country combobox with keyboard navigation, selection feedback, mobile layout, and bundled ISO 3166-1 alpha-2 codes for all 249 assignments, including Lebanon. English display names come from Unicode CLDR/ICU. New known names/codes canonicalize to alpha-2. Historical country strings remain readable; unknown historical values can be preserved during unrelated edits. Discovery matches known historical country names against codes. No interaction-time REST dependency or new package was added. |
| QA-04 | Persisted Owner notifications with bell, unread count, read/unread controls, applicant name, organization context, pagination, and 30-second polling. Deep links select the authorized organization and filter to the exact request, including older reviewed requests. Pending retries cannot duplicate recipient/request alerts. Approval/rejection updates the existing notification and marks its new status unread. |
| QA-05 | Read-only development audit confirmed two separate UUIDs for the reported namesake. Both records remain untouched. Cards show type/custom type, readable country/city, and full workspace UUID. Frontend deduplication uses UUID; distinct namesakes remain separate and React keys use stable IDs. |
| QA-06 | Owner-only archive/restore with exact-name confirmation, clear reversible-archive wording, timestamps, actor references, and retained action history. Existing memberships and all child records remain intact. Archived organizations disappear from discovery, remain labelled in member selection, and reject ordinary workspace mutations. Active workspaces are preferred for default selection. Archived workspace pages explain restoration; settings retain historical review with operational controls disabled. Restore resumes the saved discovery preference. |

The two investigated organization IDs are `2d40b06e-d5d4-4a23-bc96-6037c2c7ee7e` and `0e67177c-ab97-4fb6-aec9-5e166c782964`. No merge, rename, deletion, or automatic archive was performed.

## Audit and preservation

The initial complete Git inventory included 24 tracked modified files plus untracked Day 9, bulk import/registration, and Day 9.5 work. Actual FastAPI routes, SQLAlchemy models, Alembic history, authentication/RBAC, React forms, and existing tests were inspected before extending them. Existing query scoping, React Hook Form/Zod, Pydantic, membership authorization, dialogs, and mutation guards were reused.

Baseline frontend build, lint, and all 90 tests passed. A clean pre-change backend result was not obtained: sandbox loopback access initially blocked the runner, and the first accessible run encountered signup fixtures after the stronger policy had landed. Those fixtures were updated, and the complete final backend suite passed. No unsuccessful or unexecuted baseline backend check is represented as passing.

Development migration verification compared SHA-256 fingerprints of every row projected onto every original column in all 11 pre-existing tables. Comparison ran inside the migration transaction, with rollback on any mismatch. Counts and original values were unchanged:

| Table | Preserved rows |
| --- | ---: |
| users | 6 |
| organizations | 6 |
| memberships | 9 |
| events | 4 |
| participants | 4 |
| registrations | 7 |
| tasks | 2 |
| task_assignments | 3 |
| bulk_operations | 0 |
| organization_join_requests | 2 |
| onboarding_rate_limits | 6 |

No automated test wrote to the development database. All test fixtures, failure injection, concurrency tests, and historical migration tests used the explicitly labelled disposable PostgreSQL 17 cluster and separately named local `fieldops_day9_test_*` databases. The isolated API identity was checked before HTTP test writes. The disposable container and generated ignored connection file were removed after validation; `fieldops-db` remains running. No development database reset, truncation, downgrade, seed, secret replacement, or historical migration rewrite occurred.

## Additive migrations

The applied chain is `d92a6f31c047 → e95a01 → e95a02 → e95a03`.

| Migration | Change |
| --- | --- |
| `backend/alembic/versions/e95a01_custom_organization_type.py` | Nullable `organizations.organization_type_other VARCHAR(100)`. Existing enum and rows unchanged. |
| `backend/alembic/versions/e95a02_safe_organization_archiving.py` | Nullable `archived_at`, nullable `archived_by` user FK, and `organization_archive_events` with organization/actor FKs, action check, timestamp, and index. |
| `backend/alembic/versions/e95a03_owner_join_notifications.py` | `notifications` with recipient/organization/request FKs, read and update timestamps, recipient index, and unique `(recipient_id, join_request_id)`. |

Historical and repeated upgrades were tested. Only upgrades were applied to development. On another deployment, apply `alembic upgrade head` using its existing environment and virtual environment. The local development database is already upgraded.

## API contracts

All new routes require existing JWT bearer authentication.

| Method/path | New or changed behavior |
| --- | --- |
| `POST /auth/register` | New-account password policy above; `POST /auth/login` continues to accept historical passwords. |
| `POST /organizations` | Optional `organization_type_other`; explicitly choosing Other requires its value. Known country names/codes canonicalize to alpha-2. |
| `PATCH /organizations/{id}/settings` | Partial custom-type/country validation, stale custom-value clearing, and unchanged historical country support; existing Owner/Admin authorization retained. Archived organization writes return 409. |
| `GET /organizations`, `GET /organizations/{id}` | Include custom type and archive metadata; existing active-membership scope retained. |
| `GET /organizations/discover` | Includes custom public type metadata; excludes archived/private organizations; country names and codes compare canonically. |
| `POST /organizations/{id}/join-requests` | Notification created in the same transaction; pending replay is deduplicated. Archived or private organization remains unavailable to new applicants. |
| `PATCH /organizations/{id}/join-requests/{request_id}` | Existing approval/rejection transaction also updates notification state; archived organizations cannot be reviewed until restored. |
| `GET /organizations/{id}/join-requests?request_id=...` | Optional exact-request filter, still scoped to the organization and active Owner/Admin. |
| `GET /notifications?page=&page_size=` | Recipient-scoped `{items, unread_count, has_more}`. Recipient must still have an active Owner membership. |
| `PATCH /notifications/{id}` | Strict `{is_read:boolean}`; only authorized recipient can update; other recipients receive 404. |
| `POST /organizations/{id}/archive` | Active Owner only, `{confirmation_name}` matching the current name exactly. Repeated same-state requests do not create extra audit history. |
| `POST /organizations/{id}/restore` | Same authorization/confirmation, reverses archive while preserving history. |
| `GET /organizations/{id}/archive-history` | Active Owner-only history of archive/restore actor IDs and timestamps. |

Existing Event, Participant, Registration, Task, Assignment, member administration, bulk registration, and import mutation routes are protected by the shared archive guard without changing their successful active-workspace contracts.

## Security verification

- JWT verification, membership RBAC, and organization isolation remain server-enforced. Nonmembers do not gain discovery of private organizations through archive or notification responses.
- Notifications are selected by server-authenticated recipient plus current active Owner membership. Client recipient injection, other-recipient IDs, and cross-organization request filters were tested. Applicant emails and private descriptions are not included in the notification feed/discovery cards.
- Join creation and notification insertion commit atomically. Failure injection verified rollback. A unique key and the existing organization/request locking prevent duplicate pending alerts during retries and concurrent submissions. Reviewed request status is the notification status source of truth.
- Ordinary writes take the organization row lock before child locks, serializing archive against new work. Concurrent archive/event creation was tested. Archived writes were rejected across all current operational mutation families, including multipart import preview/apply and bulk registration.
- Canonical scope comes from the route's actual resource and the appropriate create-body field. Extra body/query organization IDs cannot redirect an archived-resource check. JSON detection matches FastAPI for omitted Content-Type, application vendor `+json`, and case/parameter variants; adversarial bypass tests pass.
- Only the active Owner can archive, restore, or read archive history; Admin, Member, Viewer, outsider, and inactive Owner cases were checked. Original memberships and child rows survive both transitions.
- No ownership transfer, destructive organization delete, email/push delivery, WebSocket, credential change, or fake production endpoint was introduced.

## Final executed verification

| Check | Result |
| --- | --- |
| `npm run build` | Passed TypeScript and Vite production build. |
| `npm run lint` | Passed. |
| `npm test` | 99/99 passed. |
| Backend `unittest discover -s tests -p "test_*integration.py" -v` | 99/99 passed: archive 16, bulk 31, original Day 9 9, notifications 6, onboarding 32, QA contracts 5. These counts include inherited Day 9 executions. |
| Backend `unittest discover -s tests -p "test_*migration.py" -v` | 3/3 passed: bulk preservation, onboarding preservation, and full QA migration chain/repeated upgrade. |
| `frontend/tests/day9.browser.mjs` | 18/18 real Chrome scenarios passed, including events, participants, tasks, attendance, authorization, CSV/XLSX import, and 100-person bulk registration/recovery. |
| `frontend/tests/onboarding.browser.mjs` | 12/12 real Chrome scenarios passed, including signup/create/join/review/reject, namesakes, privacy, session/selection races, and mobile navigation. |
| `frontend/tests/qa-improvements.browser.mjs` | 8/8 real Chrome scenarios passed, covering all six improvements, exact-ten-character signup, keyboard/mobile country selection, notification read/unread/deep links/status, archive/restore, and no runtime errors. |
| Development upgrade | Applied through `e95a03`; all historical values verified unchanged. |
| `git diff --check` | Passed; Git may print existing CRLF conversion notices on Windows. |

Failures encountered during implementation were corrected and the affected checks rerun: signup fixture policy, composite-primary-key migration snapshot ordering, repeated-run namesake suggestions, notification conflict expectation, new frontend dependency mocks, and browser return-navigation expectations. No known introduced failure remains.

To reproduce with Docker available, from the project root:

```powershell
.\backend\.venv\Scripts\python.exe -B backend/tests/qa_runtime.py start
.\backend\.venv\Scripts\python.exe -B backend/tests/qa_runtime.py test "test_*integration.py"
.\backend\.venv\Scripts\python.exe -B backend/tests/qa_runtime.py test "test_*migration.py"
.\backend\.venv\Scripts\python.exe -B backend/tests/qa_runtime.py browser tests/day9.browser.mjs
.\backend\.venv\Scripts\python.exe -B backend/tests/qa_runtime.py browser tests/onboarding.browser.mjs
.\backend\.venv\Scripts\python.exe -B backend/tests/qa_runtime.py browser tests/qa-improvements.browser.mjs
.\backend\.venv\Scripts\python.exe -B backend/tests/qa_runtime.py stop
```

Build the frontend before browser runs. Browser checks require an available Playwright/Chrome runtime; the helper discovers the existing Codex runtime, or `FIELDOPS_PLAYWRIGHT_MODULE` can identify another installation. No Playwright dependency was added to the application.

## Exact QA file inventory

Paths below are repository-relative. “Extended” includes files that were already uncommitted when this QA task began; this inventory does not attribute other preserved Day 9/bulk work to the QA task.

| File | QA change |
| --- | --- |
| `backend/alembic/versions/e95a01_custom_organization_type.py` | New additive migration. |
| `backend/alembic/versions/e95a02_safe_organization_archiving.py` | New additive migration. |
| `backend/alembic/versions/e95a03_owner_join_notifications.py` | New additive migration. |
| `backend/alembic/env.py` | Extended model imports. |
| `backend/app/main.py` | Extended router wiring and archive guard. |
| `backend/app/countries.py` | New canonical country helpers. |
| `backend/app/data/countries.json` | New bundled country mapping. |
| `backend/app/models/organization.py` | Extended custom/archive fields. |
| `backend/app/models/notification.py` | New notification persistence. |
| `backend/app/models/organization_archive_event.py` | New lifecycle history. |
| `backend/app/schemas/user.py` | Extended new-account password policy. |
| `backend/app/schemas/organization.py` | Extended metadata validation/response contracts. |
| `backend/app/schemas/notification.py` | New notification contracts. |
| `backend/app/schemas/archive.py` | New confirmation/history contracts. |
| `backend/app/routers/organizations.py` | Extended settings/country/custom-type behavior. |
| `backend/app/routers/onboarding.py` | Extended exact-request filter. |
| `backend/app/routers/notifications.py` | New recipient-scoped endpoints. |
| `backend/app/routers/archive.py` | New lifecycle endpoints. |
| `backend/app/services/onboarding.py` | Extended discovery, archive exclusions, atomic notification integration. |
| `backend/app/services/notifications.py` | New transactional notification writes. |
| `backend/app/services/archive.py` | New canonical mutation guard and lifecycle service. |
| `backend/tests/day9_server.py` | Extended isolated app wiring. |
| `backend/tests/test_day9_integration.py` | Updated strong-password fixtures. |
| `backend/tests/test_bulk_integration.py` | Updated strong-password fixtures. |
| `backend/tests/test_onboarding_integration.py` | Updated fixtures and public-card contract. |
| `backend/tests/test_archive_integration.py` | New lifecycle/preservation/security/concurrency tests. |
| `backend/tests/test_notifications_integration.py` | New recipient/dedupe/rollback tests. |
| `backend/tests/test_qa_improvements_integration.py` | New password/custom/country/namesake tests. |
| `backend/tests/test_qa_migration.py` | New full-chain historical preservation test. |
| `backend/tests/qa_runtime.py` | New labelled disposable test runtime helper. |
| `backend/tests/qa_development_upgrade.py` | New read-only audit/additive migration utility. |
| `frontend/package.json` | Extended test scripts. |
| `frontend/src/components/layout/AppLayout.tsx` | Extended bell, archived labels, scoped navigation. |
| `frontend/src/components/ui/ConfirmationDialog.tsx` | Extended confirmation-disabled support. |
| `frontend/src/components/ui/CountrySelect.tsx` | New accessible searchable selector. |
| `frontend/src/data/countries.json` | New bundled country mapping. |
| `frontend/src/data/countries.ts` | New name/code/search helpers. |
| `frontend/src/data/README.md` | New provenance and update guidance. |
| `frontend/src/features/notifications/NotificationBell.tsx` | New polling feed and controls. |
| `frontend/src/features/notifications/api.ts` | New validated API adapters. |
| `frontend/src/features/onboarding/types.ts` | Extended custom metadata types. |
| `frontend/src/features/onboarding/schemas.ts` | Extended password/custom/country validation. |
| `frontend/src/features/onboarding/api.ts` | Extended canonical payload/response checks and UUID deduplication. |
| `frontend/src/features/onboarding/CreateOrganizationForm.tsx` | Extended custom/country form controls. |
| `frontend/src/features/onboarding/JoinOrganizationPanel.tsx` | Extended country filter. |
| `frontend/src/features/onboarding/OrganizationMatchList.tsx` | Extended distinguishable cards. |
| `frontend/src/features/organizations/OrganizationProvider.tsx` | Extended archive-aware selection/capabilities. |
| `frontend/src/features/organizations/OrganizationGate.tsx` | Extended archived workspace gate. |
| `frontend/src/features/organizations/admin/types.ts` | Extended metadata types. |
| `frontend/src/features/organizations/admin/policies.ts` | Extended custom/legacy profile validation. |
| `frontend/src/features/organizations/admin/api.ts` | Extended profile/request validation and exact filter. |
| `frontend/src/features/organizations/admin/OrganizationProfilePanel.tsx` | Extended custom/country editing. |
| `frontend/src/features/organizations/admin/JoinRequestsPanel.tsx` | Extended exact notification request view. |
| `frontend/src/features/organizations/admin/OrganizationArchivePanel.tsx` | New confirmed archive/restore controls. |
| `frontend/src/pages/SignupPage.tsx` | Extended password requirements. |
| `frontend/src/pages/OrganizationSettingsPage.tsx` | Extended deep-link selection/archive controls. |
| `frontend/src/types/api.ts` | Extended custom/archive response metadata. |
| `frontend/tests/onboarding.test.mjs` | Extended policy/country/namesake tests. |
| `frontend/tests/onboarding-admin.test.mjs` | Extended legacy/profile/exact-request tests. |
| `frontend/tests/notifications.test.mjs` | New notification adapter tests. |
| `frontend/tests/day9.browser.mjs` | Updated strong-password fixtures. |
| `frontend/tests/onboarding.browser.mjs` | Updated password fixtures/country selection. |
| `frontend/tests/qa-improvements.browser.mjs` | New all-six browser acceptance suite. |
| `frontend/README.md` | Extended current QA behavior/handover link. |
| `docs/day-9.5-onboarding.md` | Link preserving the original report while identifying superseding contracts. |
| `docs/day-9.5-qa-improvements.md` | This handover report. |

## Boundaries, Git status, and Day 10

Notifications poll every 30 seconds and on refresh/focus; delivery is in-app only. Pre-existing pending requests are not mass-backfilled during migration; safe submission replay can create their missing Owner alert. The repository has no password-change/reset workflow; any future such flow must reuse the new-account policy. Unknown historical countries are preserved rather than guessed. Country bundles require coordinated maintenance. Existing bounded discovery matching and unverified-account identity limitations from the original onboarding report still apply.

Archiving blocks new operational mutations while preserving authorized historical reads; it does not deactivate memberships. Pending requests and previous discovery preference remain intact for restoration. Future Day 10 mutation routers must use the shared archive guard and existing membership isolation.

Final branch is `main`, with 24 tracked modified paths and 100 untracked files, including the preserved earlier work and this report. Nothing is staged, committed, or pushed. No dependency lockfile or historical migration was changed by this QA task. Ready for Day 10 Inventory development with no known blocking QA regression; this is development readiness, not a claim of production security certification.
