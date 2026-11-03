# FieldOps Pro frontend

React 19, TypeScript, Vite, Tailwind CSS v4, React Router, TanStack Query, React Hook Form, Zod, and Lucide.

Day 9.5 QA improvements are implemented and verified. See [the QA handover report](../docs/day-9.5-qa-improvements.md) for migrations, endpoints, the exact file inventory, security checks, and test results.

New signups require 10–128 characters, an uppercase A–Z letter, and a special character; historical passwords still work at login. Selecting Other requires a custom organization type. Organization forms use a bundled searchable ISO country selector. The notification bell polls for Owner join-request notifications every 30 seconds. Organization settings provide confirmed, reversible Owner-only archiving and restoration; archived workspaces preserve their data and reject new operational writes.

## Run locally

Use the existing PostgreSQL database, root `.env`, backend virtual environment, and migrations. Do not replace secrets, seed accounts, reset volumes, or rerun migrations merely to start the frontend.

If the existing database container is stopped, start the existing Compose service from the project root:

```powershell
cd C:\Projects\FieldOps-Pro
docker compose up -d db
```

Start FastAPI in a separate terminal using the installed backend environment:

```powershell
cd C:\Projects\FieldOps-Pro\backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Start the frontend:

```powershell
cd C:\Projects\FieldOps-Pro\frontend
npm ci
npm run dev
```

`npm ci` uses the existing package lock. Use `npm install` instead when intentionally updating dependencies. Sign in with an existing account; no credentials are embedded in the frontend. An active organization membership is required to enter an organization workspace.

The default API base is `/backend`. Vite forwards `/backend/*` to `http://127.0.0.1:8000/*`, preserving the backend's actual paths. Open the URL Vite prints; the normal development URL is `http://localhost:5173`.

## Routes and permissions

- `/login`: sign in, validation, expired-session notice, and safe return navigation.
- `/signup`: public account creation using the existing API, password confirmation, and organization onboarding.
- `/onboarding`: create a distinct workspace, discover eligible organizations, request access, and check personal request status.
- `/dashboard`: selected organization, current membership role, a six-event schedule preview, and `/health` service status.
- `/events`: scoped event list with search, status filtering, pagination, and loading/empty/error handling.
- `/events/new`: validated event creation for active Owners and Admins.
- `/events/:eventId`: verified event details, status controls, registrations, attendance, tasks, and assignments.
- `/participants`: searchable organization directory and Owner/Admin participant creation.
- `/participants/:participantId`: participant profile and registration information for one explicitly selected event.
- `/tasks`: event-selected task workspace with create/edit, search/filtering, status, and assignments.
- `/settings/members`: Owner/Admin join-request review, direct existing-account membership administration, and organization discovery/profile settings.

Application routes require a verified `/auth/me` profile. Organizations come from active memberships returned by the API. The current role is resolved from `/organizations/{id}/members`; the backend remains responsible for authorization on every request.

Owners/Admins create participants and registrations, record attendance, edit tasks, and manage task assignments. Assigned active non-Viewer members can update their task statuses. Viewers remain read-only even when assigned. Participant editing/deletion, task deletion, attendance undo, and reactivation of cancelled registrations are not exposed because the existing API does not support them.

## API and session behavior

The frontend uses the existing JWT bearer security design:

| Operation | Existing backend endpoint |
| --- | --- |
| Sign in with JSON `{ email, password }` | `POST /auth/login` |
| Verify current profile | `GET /auth/me` |
| List accessible organizations | `GET /organizations` |
| Resolve active membership and role | `GET /organizations/{organization_id}/members` |
| Search/list events | `GET /api/v1/events?organization_id=...&page=...&page_size=...` |
| View event | `GET /api/v1/events/{event_id}` |
| Create event | `POST /api/v1/events` |
| Change event status | `PATCH /api/v1/events/{event_id}/status` |
| List/create participants | `GET /api/v1/participants?organization_id=...`; `POST /api/v1/participants` |
| List/create event registrations | `GET /api/v1/registrations?event_id=...`; `POST /api/v1/registrations` |
| Mark attendance / cancel registration | `PATCH /api/v1/registrations/{id}/attendance`; `PATCH /api/v1/registrations/{id}/cancel` |
| List/create event tasks | `GET /api/v1/tasks?event_id=...`; `POST /api/v1/tasks` |
| Edit task / change status | `PATCH /api/v1/tasks/{id}`; `PATCH /api/v1/tasks/{id}/status` |
| List/create/remove assignments | `GET /api/v1/task-assignments?task_id=...`; `POST /api/v1/task-assignments`; `DELETE /api/v1/task-assignments/{id}` |
| Check service | `GET /health` |

Requests send `Authorization: Bearer <token>` and omit cookies. Tokens live in memory and tab-scoped `sessionStorage`, survive reloads until expiry, and are removed on logout or a current-session HTTP 401. Storage-disabled browsers use an in-memory session. Browser storage is accessible to JavaScript; preventing XSS remains essential.

JWT expiry comes from the backend token's `exp` claim. Client decoding schedules sign-out; `/auth/me` and server-side JWT verification establish trust. There is no refresh-token or server logout endpoint. Signing out clears the current tab's token and query cache; it does not revoke an already issued token at the server or sign out other tabs. Expired sessions require a new sign-in.

Organization selection is saved per user in the tab and rechecked against the API. Query keys contain organization scope. Session changes cancel pending queries and clear caches; organization switching cancels scoped resource queries. The shared mutation guard blocks duplicate dispatch and discards callbacks belonging to an old organization/session.

## Validation

```powershell
npm run build
npm run lint
npm test
```

The build runs strict TypeScript checking and produces `dist/`, with pages loaded lazily. `npm test` runs 90 regression tests: 18 Day 8, 28 Day 9, 14 bulk registration, 10 participant import, 11 onboarding, and 9 organization administration tests. These exercise production validation, policies, session behavior, API contracts, and query isolation with browser/network boundaries isolated; separate real-service tests cover PostgreSQL integration.

The [bulk registration and CSV/XLSX import report](../docs/bulk-participant-registration.md) documents the searchable multi-select, atomic APIs, upload/preview/confirmation workflow, import dependency installation, additive migration, exact changed files, and validation results.

The [Day 9.5 onboarding report](../docs/day-9.5-onboarding.md) records the private-by-default organization migration, API contracts, secure join approval, exact changed files, and real PostgreSQL/browser results. It also links the deferred email-invitation plan. Existing organizations remain private until an Owner/Admin explicitly enables discovery. From an isolated test database with the existing optional Playwright runtime, `npm run test:browser:onboarding` verifies the complete new workflow.

See the [Day 9 delivery and validation report](../docs/day-9-frontend.md) for implementation, exact API/RBAC behavior, current acceptance status, and known limitations. The [Day 8 report](../docs/day-8-frontend.md) records the earlier validation baseline.

For real HTTP/PostgreSQL integration, provision a separate disposable local PostgreSQL database and supply `FIELDOPS_TEST_DATABASE_URL` through the test process environment. The test server requires an explicit local port and a database named `fieldops_day9_test_` plus a suffix; it refuses development-database fallback. Never point this variable at the existing development database or edit the project's `.env` for a test run. From `backend`:

```powershell
.\.venv\Scripts\python.exe -B -m unittest discover -s tests -p test_day9_integration.py -v
```

For real-browser acceptance, keep that isolated test-database configuration, build the frontend, then run from `frontend`:

```powershell
npm run build
npm run test:browser
```

The browser runner starts its own isolated API and Vite preview proxy and uses generated synthetic accounts. It requires an available Playwright installation and Chrome by default. Playwright is optional test tooling, not a new project dependency: `FIELDOPS_PLAYWRIGHT_MODULE` may supply a resolvable module specifier/file URL for an existing installation, and `FIELDOPS_BROWSER_CHANNEL` can select another installed channel. The report documents the remaining optional test-runtime settings and results.

`npm run preview` serves the local production build and has a local `/backend` proxy. It is a preview server, not production hosting.

## Deployment

For the default `/backend` base, configure the production web server to forward `/backend/*` to FastAPI with the prefix removed, and serve the frontend entry point for client-side routes.

Alternatively, set `VITE_API_BASE_URL` to the public API base before building. Vite embeds this public value in the frontend bundle; it must never contain a secret. The backend currently permits browser CORS only from `http://localhost:5173`. A cross-origin deployment therefore requires an explicit backend CORS origin configuration. The default same-origin proxy does not require a backend CORS change.

Use HTTPS in production. Keep the existing `.env` and secrets private. Day 9 added isolated backend test support while preserving application routers, models, migrations, authentication, secrets, and development data. Review the existing `/dev` endpoints before production deployment.
