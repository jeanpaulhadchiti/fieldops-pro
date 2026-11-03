# Day 9.5 — Secure organization onboarding

This document records the original Day 9.5 implementation. The subsequent [QA improvements report](day-9.5-qa-improvements.md) supersedes the password-policy and organization-form contracts below and documents Owner notifications and reversible organization archiving.

## Repository audit and migration strategy

The working tree already contains uncommitted Day 9 and bulk-registration work. This enhancement preserves those files and makes no commits, resets, or pushes. The existing security design uses JWT bearer authentication, active organization memberships, the `uq_user_organization` membership constraint, and backend-assigned Owner membership when creating an organization. Existing member-management endpoints let Owners/Admins add registered accounts directly; they are not email invitations and provide no token lifecycle.

The planned additive migration is `d92a6f31c047`, following bulk-receipt revision `b891e225d419`. It adds organization type, country, city, description, discoverability, and a derived normalized-name search value; creates organization join requests with foreign keys, status checks, indexes, and a partial unique index for pending user/organization pairs; and adds persistent per-user onboarding rate-limit counters. Existing organization names, users, membership roles/uniqueness, event/participant/registration/task/assignment records, and receipt data are retained. Existing organizations default to private. Only the new derived search field is backfilled; no organizations are merged and no ownership is reassigned.

Discovery requires authentication, a bounded search term, limited results, and a database-backed request allowance. Only explicitly discoverable organization cards are returned. Private matches never influence a visible duplicate warning. Distinct organizations may share a name after explicit acknowledgement of a discoverable match. The server always assigns creation ownership and join approvals only activate ordinary Member access.

Migration, API, UI, and regression tests will use a separate disposable local PostgreSQL database with the existing test URL safety guard. The new migration will be verified against seeded historical records before any development migration is considered. No test will treat the existing development database as disposable. Secrets and `.env` files remain unchanged.

## Delivery status

Core implementation is complete. Public signup reuses the existing account API and JWT login. A user without organizations enters `/onboarding`, chooses create or join, and receives no existing membership automatically. Existing members can use **Manage organizations** to create or join another workspace.

Creation collects name, type, country, city/area, optional description, and explicit discoverability consent. The server assigns Owner only in the new organization. Exact and similar discoverable matches produce a reviewable warning; explicit confirmation permits a genuinely distinct namesake. Creation never grants access to the matching organization, changes its Owner, or merges records. Existing name-only API clients remain supported with Other/private defaults and optional location metadata.

Discovery uses case, whitespace, and accent normalization, bounded fuzzy suggestions, type/location comparisons, and a card containing only name, type, country, city, ID, and match category. The description, member list, reviewer identity, account email, and business records are excluded. Private organizations do not influence warning responses. Search needs an authenticated session and at least three normalized characters, returns up to ten results, and has no public total or paging API.

Applicants can submit a message, see pending/approved/rejected history, refresh it, and open a workspace only after actual active membership is verified. Owners/Admins use **Settings → Join requests** to view applicants and confirm decisions; **Members** provides the existing direct-account access and role-management APIs; **Organization profile** manages metadata and discoverability. Members/Viewers cannot open administration data or review requests. Email addresses are explicitly described as unverified to reviewers.

## API changes

All organization/discovery/join endpoints require the existing JWT bearer authentication. Resource IDs are UUIDs. Discovery and duplicate warnings never substitute for authorization.

| Method and path | Contract and permission |
| --- | --- |
| `POST /auth/register` (existing) | `{name,email,password}`; trimmed/normalized name 1–120, email validation and existing case-insensitive duplicate handling, password 12–128 and not all whitespace. No role or identity injection. Existing login accepts historical passwords unchanged. |
| `POST /organizations` (extended) | `{name,organization_type?,country?,city?,description?,is_discoverable?,allow_possible_duplicate?}`. Type is Scout Group, Sports Club, NGO, or Other. Name max 150; location fields max 100; description max 2,000 with multiline content preserved. The server creates an active Owner membership in the same transaction. |
| `GET /organizations`, `GET /organizations/{id}` (extended response) | Existing membership-scoped reads now include metadata and discoverability. Nonmembers cannot use the detail route for discovery. |
| `GET /organizations/discover?q=&organization_type=&country=&city=` | `{matches:[{id,name,organization_type,country,city,match_kind}]}`; authenticated, bounded search, only discoverable cards. Match category is exact/similar. |
| `PATCH /organizations/{id}/settings` | Partial metadata/discoverability update for active Owner/Admin only. Ownership and membership fields are forbidden. At least one field is required. |
| `POST /organizations/{id}/join-requests` | `{message?:string|null}`, max 1,000. The applicant comes only from JWT. HTTP 201 for new pending, 200 for replay of an existing pending request. Private/absent targets both return 404. |
| `GET /organization-join-requests/mine?status=&page=&page_size=` | Only current user's history. Rows include request ID, organization ID/name, status/message/timestamps, and current `membership_active`. No applicant list or reviewer identity. |
| `GET /organizations/{id}/join-requests?status=&page=&page_size=` | Active Owner/Admin only. Adds applicant name/email/user ID and reviewer ID to the request data. |
| `PATCH /organizations/{id}/join-requests/{request_id}` | `{decision:"approve"|"reject"}`; active Owner/Admin only, exact organization/request scope, no self-review or arbitrary role assignment. Same decision replay is 200; conflicting completed decision is 409. |

Organization creation returns HTTP 409 with `detail:{code:"possible_duplicate",message,matches}` when an unacknowledged discoverable match exists. Setting `allow_possible_duplicate:true` explicitly confirms a distinct workspace; it does not grant membership in any match. Private matches never appear in this response.

Rate limits are durable PostgreSQL counters shared across workers: discovery 30 per 60 seconds, creation 20 per 600 seconds, and join submission 10 per 600 seconds per authenticated user. Counters are consumed before business writes and remain consumed on rejected operations. Limits return HTTP 429 and `Retry-After`. Anonymous discovery is unavailable. No new package or PostgreSQL extension was needed.

## Transactions and security

- Organization creation and its backend-assigned Owner membership commit together. A normalized-name advisory lock serializes duplicate checks and creation while leaving names nonunique.
- Pending requests have a partial unique `(organization_id,user_id)` index. Reviewed states require reviewer/time fields, and a database check forbids self-review.
- Approval/rejection takes the organization `FOR NO KEY UPDATE` lock and the request `FOR UPDATE` lock. Direct member additions and role updates coordinate through the same organization lock and recheck authorization after waiting.
- Approval creates one ordinary Member membership or reactivates an inactive Member/Viewer as Member, preserving the existing membership ID. An inactive privileged membership requires separate Owner review and receives a conflict rather than automatic restoration. Existing active roles, including Owner/Admin, are preserved if independently granted before a request is resolved.
- Membership and request review commit together. A real PostgreSQL insert failure was tested to leave the request pending, reviewer fields unset, and no new access. Repeated/concurrent approvals cannot duplicate memberships; competing approval/rejection yields one final decision.
- Rejection grants no new access and does not revoke a separately granted membership. A rejected applicant may submit a new pending request while the organization remains discoverable, subject to the limit.
- JWT/session identity supplies all actors. Unknown role/user/status fields are rejected in create/join/review schemas. Existing membership uniqueness and Owner-only Admin assignment remain intact; no ownership-transfer API was added.
- Late login responses cannot replace newer sign-in/sign-out actions. Organization refreshes cannot override a newer selection. Queries and mutation callbacks use session/user/organization scope, with real API refreshes after writes.
- The legacy `/dev/*` endpoints were an independent directory-disclosure path. They now require explicit `FIELDOPS_ENABLE_DEV_ENDPOINTS=true`, an operator UUID in `FIELDOPS_DEV_USER_IDS`, and a valid JWT; demo membership reads additionally require active membership. No environment file was changed.

## Migration and data preservation

Migration `d92a6f31c047_secure_organization_onboarding.py` follows `b891e225d419`. It adds six organization columns and a nonunique partial discovery index/type check, creates `organization_join_requests`, and creates `onboarding_rate_limits`. Historical display names are retained exactly; only the new derived normalized search value is backfilled. Existing organizations receive Other type, null optional metadata, and private discoverability.

The migration preservation test builds historical schemas from Alembic migrations in a second disposable PostgreSQL database, seeds all eight Day 9 domains and a bulk-operation receipt, includes duplicate/accented historical organization names, then upgrades. Original rows, columns, constraints, roles, and receipts were preserved; the pending-request unique index and repeated upgrade were verified.

The migration was also applied to the existing development database. Before/after comparisons verified every original column value and row in users, organizations, memberships, events, participants, registrations, tasks, task assignments, and bulk operations. Existing organizations remained private. No development seed/test records, deletes, truncations, resets, merges, owner changes, downgrades, or secret changes were performed.

For another deployment, use the existing environment and virtual environment from `backend`:

```powershell
.\.venv\Scripts\python.exe -m alembic upgrade head
```

Local development is already upgraded. Existing same-origin `/backend` proxy, JWT storage, and CORS settings remain in use.

## Exact Day 9.5 file inventory

Paths below are relative to `C:\Projects\FieldOps-Pro`. Previously uncommitted Day 9/bulk files are preserved; this inventory identifies the files changed for this enhancement.

| File | Status / purpose |
| --- | --- |
| `backend/app/organization_names.py` | New normalization helpers. |
| `backend/app/models/organization_join_request.py` | New constrained request model. |
| `backend/app/models/onboarding_rate_limit.py` | New durable allowance model. |
| `backend/app/schemas/onboarding.py` | New identity-safe join/review contracts. |
| `backend/app/services/onboarding.py` | New discovery, limits, locks, and transactions. |
| `backend/app/routers/onboarding.py` | New applicant/reviewer endpoints. |
| `backend/alembic/versions/d92a6f31c047_secure_organization_onboarding.py` | New additive migration. |
| `backend/app/models/organization.py` | Metadata and nonunique discovery index. |
| `backend/app/schemas/organization.py` | Extended create/read and partial settings contracts. |
| `backend/app/schemas/user.py` | Signup validation; login contract retained. |
| `backend/app/routers/organizations.py` | Creation warnings, discovery/settings, membership-write coordination. |
| `backend/app/main.py` | Router wiring and legacy debug access restrictions. |
| `backend/alembic/env.py` | New metadata imports. |
| `backend/tests/day9_server.py` | Isolated real-router/model test wiring. |
| `backend/tests/test_onboarding_integration.py` | New real API/PostgreSQL tests plus inherited Day 9 checks. |
| `backend/tests/test_onboarding_migration.py` | New historical-data migration verification. |
| `frontend/src/features/onboarding/types.ts` | New typed contracts. |
| `frontend/src/features/onboarding/schemas.ts` | New RHF/Zod form validation. |
| `frontend/src/features/onboarding/api.ts` | New runtime-validated real API adapters. |
| `frontend/src/features/onboarding/queryKeys.ts` | New user/search/history query keys. |
| `frontend/src/features/onboarding/OrganizationMatchList.tsx` | New public-card comparison display. |
| `frontend/src/features/onboarding/CreateOrganizationForm.tsx` | New creation, duplicate acknowledgement, and uncertain-outcome recovery. |
| `frontend/src/features/onboarding/JoinOrganizationPanel.tsx` | New discovery and confirmed request workflow. |
| `frontend/src/features/onboarding/MyJoinRequests.tsx` | New actual request history and membership refresh. |
| `frontend/src/features/auth/loginAttempt.ts` | New superseded-session guard. |
| `frontend/src/pages/SignupPage.tsx` | New public signup. |
| `frontend/src/pages/OnboardingPage.tsx` | New create/join experience. |
| `frontend/src/pages/OrganizationSettingsPage.tsx` | New scoped administration workspace. |
| `frontend/src/features/organizations/admin/types.ts` | New administration contracts. |
| `frontend/src/features/organizations/admin/policies.ts` | New role policies, profile validation, and cache keys. |
| `frontend/src/features/organizations/admin/api.ts` | New verified administration adapters. |
| `frontend/src/features/organizations/admin/JoinRequestsPanel.tsx` | New request review/filter/pagination interface. |
| `frontend/src/features/organizations/admin/MembersPanel.tsx` | New confirmed direct-account and role interface. |
| `frontend/src/features/organizations/admin/OrganizationProfilePanel.tsx` | New metadata/discovery settings. |
| `frontend/src/App.tsx` | Signup/onboarding/settings routes. |
| `frontend/src/components/layout/AppLayout.tsx` | Settings and Manage organizations navigation. |
| `frontend/src/features/auth/AuthProvider.tsx` | Safe concurrent/aborted sign-in handling. |
| `frontend/src/features/auth/authContext.ts` | Optional sign-in cancellation. |
| `frontend/src/features/organizations/OrganizationProvider.tsx` | Actual refresh/selection with session and selection-generation guards. |
| `frontend/src/features/organizations/organizationContext.ts` | Refresh API. |
| `frontend/src/features/organizations/OrganizationGate.tsx` | Onboarding redirect for no active organizations. |
| `frontend/src/pages/LoginPage.tsx` | Signup link and safe async navigation. |
| `frontend/src/types/api.ts` | Backward-compatible optional organization metadata. |
| `frontend/tests/onboarding.test.mjs` | New 11 production-source form/API/session tests. |
| `frontend/tests/onboarding-admin.test.mjs` | New 9 production-source role/API tests. |
| `frontend/tests/onboarding.browser.mjs` | New real-service/browser acceptance. |
| `frontend/package.json` | Includes new regression suites and browser command. |
| `frontend/README.md` | New routes and validation/setup documentation. |
| `docs/day-9.5-onboarding.md` | This audit, implementation, and verification record. |
| `docs/invitation-security-plan.md` | Deferred secure invitation/verification design. |

## Validation record

| Check | Result |
| --- | --- |
| `npm run build` | Passed strict TypeScript and Vite production build. |
| `npm run lint` | Passed. |
| `npm test` | 90 passed: existing 70 plus 11 onboarding and 9 administration tests. |
| `test_onboarding_integration.py` | All 32 passed, including multiline description round trips, historical short-password login, signup/duplicates, private discovery, RBAC, approval races, inactive memberships, and rollback. |
| `test_bulk_integration.py` | All 31 passed, including 1/10/100 registration, import, concurrency, idempotency, and inherited Day 9 behavior. |
| `test_onboarding_migration.py` | Passed historical migration/data/schema/constraint preservation and repeated upgrade. |
| `tests/onboarding.browser.mjs` | All 12 real-browser scenarios passed: signup, creation with multiline description, private defaults, public discovery, pending denial, review, rejection, namesakes, refresh, async selection/login races, privacy settings, and mobile navigation; no runtime errors. |
| `tests/day9.browser.mjs` | All 18 existing scenarios passed, including real operations/task/attendance/organization isolation and 100-person import/registration/recovery. |
| Development migration | Applied and original data verified unchanged; no tests used the development database. |

All real data-changing tests used a labelled disposable PostgreSQL 17 container with a randomized local port/database and generated credentials. The shared test guard requires an explicit local `fieldops_day9_test_*` URL and checks the API database identity before test writes. Migration testing used separate databases within that disposable cluster. The verified test container and ignored connection file were removed after validation; the existing development container remains running. No test URL, password, or token is published here.

From `frontend`, rerun build, lint, and `npm test`. With a separate disposable database configured through `FIELDOPS_TEST_DATABASE_URL`, run from `backend`:

```powershell
.\.venv\Scripts\python.exe -B -m unittest discover -s tests -p test_onboarding_integration.py -v
.\.venv\Scripts\python.exe -B -m unittest discover -s tests -p test_bulk_integration.py -v
.\.venv\Scripts\python.exe -B -m unittest discover -s tests -p test_onboarding_migration.py -v
```

With the same isolated test URL and available optional Playwright/Chrome runtime, run from `frontend`:

```powershell
npm run test:browser:onboarding
npm run test:browser
```

`FIELDOPS_PLAYWRIGHT_MODULE` may point to an existing installation, as with the Day 9 runner. No new frontend/test dependency was installed for Day 9.5. Synthetic test screenshots contain no development records or credentials.

## Acceptance and limits

The definition of done is satisfied: a new user can register, create a distinct organization, discover and request membership in an eligible organization, receive an authorized Member approval, and enter only the authorized organization. No signup, duplicate match, pending request, rejected request, or client role claim grants existing workspace access or ownership.

All 18 requested acceptance areas are covered by the integration and/or real-browser suites, including unchanged Day 9 workflows and persisted request/membership status after refresh. There are no known blocking implementation errors. Invitation delivery and ownership verification are explicitly deferred, as permitted by the request.

Known boundaries:

- Email verification and ownership/affiliation proof are not implemented. Names and emails are account claims; reviewers must verify identity using a trusted channel. Discovery cards and namesake acknowledgement do not certify identity.
- Matching uses a bounded 200-candidate suggestion window and returns ten cards. It is not exhaustive phonetic, transliteration, or confusable-character matching. Search terms need at least three normalized characters. Refine the name/location when needed.
- Organization creation retains the existing non-idempotent API. The UI blocks repeated dispatch and freezes an uncertain creation outcome until real organizations are refreshed and reviewed; it does not blindly resend a potentially committed creation. Join submission and review have safe replay semantics.
- Existing inactive privileged memberships cannot be self-restored through joining; they require a separate authorized Owner/support process. No ownership transfer, organization merge, or privileged reactivation shortcut was introduced.
- Request history refreshes on focus, manual refresh, and 30-second polling while open. No email or push notifications are fabricated or delivered.
- Rate limits cover authenticated discovery/create/join per user across workers. Account verification, signup/login edge abuse controls, and production perimeter controls remain separate deployment work.

The working tree remains on branch `main`, with 24 tracked modified paths and 71 untracked files at handover; these totals include preserved earlier Day 9/bulk work and this enhancement. Nothing is staged, committed, or pushed by this task. No secrets or historical migration files were rewritten. The inventory above distinguishes this enhancement from the prior uncommitted files.

## Deferred invitations and next steps

The existing **Add an existing account** operation grants immediate access after confirmation; it is not an invitation and sends no email. The separate [invitation security plan](invitation-security-plan.md) specifies verified-email prerequisites, email delivery, cryptographic single-use tokens with hashed storage, expiry, account matching, transactional acceptance, revocation, rate limits, and audit controls. All proposed invitation APIs in that document are future work.

Recommended next work: implement email verification and trusted delivery infrastructure first, then the tested invitation lifecycle; add a formal ownership/dispute-verification process and restricted membership audit trail; measure discovery behavior with a larger real directory before expanding matching or retention policies. Production hosting still needs the existing HTTPS, SPA fallback, API proxy, and explicit CORS configuration.
