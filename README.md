# FieldOps Pro

**A full-stack operations workspace for organizations that run events, coordinate people, and manage shared resources.**

**Status:** Actively developed · **Source:** [Backend](backend/) · [Frontend](frontend/) · [Architecture](docs/architecture.md)

FieldOps Pro is a portfolio project built for the everyday coordination challenges of scout groups, sports clubs, NGOs, and event teams. It replaces scattered spreadsheets and message threads with a single organization-aware application for events, participants, and task ownership.

> **Project maturity:** The public repository contains working event, participant, task, onboarding, and organization-management flows. Inventory, budgeting, offline sync, and analytics remain on the roadmap; they are **not** presented here as delivered features.

## What the application does today

| Area | Implemented functionality |
| --- | --- |
| Accounts and access | Sign-up/sign-in, JWT authentication, active-membership checks, and organization-scoped role-based permissions |
| Organizations | Workspace creation, profile settings, discoverability, join-request review, member administration, and safe archive/restore |
| Notifications | Owner-facing in-app join-request alerts, unread indicators, and request deep links |
| Events | Event creation, searchable lists, detail pages, lifecycle status changes, and protected management actions |
| Participants | Organization directories, participant profiles, event registrations, attendance check-in, and cancellation flows |
| Tasks | Event-linked tasks, priorities and due dates, assignee management, and permission-aware status updates |
| Bulk operations | Multi-participant registration and CSV/XLSX import with preview, validation, duplicate checks, and atomic application |
| Quality and isolation | Frontend regression tests, backend integration tests, tenant-boundary checks, and documented migration/QA work |

The frontend includes responsive navigation, protected routes, loading and error states, and a workspace switcher. Server-side authorization remains the source of truth rather than relying on hidden UI controls.

## Technology

| Layer | Tools |
| --- | --- |
| Frontend | React, TypeScript, Vite, Tailwind CSS, React Router, TanStack Query, React Hook Form, Zod |
| API | Python, FastAPI, Pydantic |
| Persistence | PostgreSQL 17, SQLAlchemy, Alembic |
| Data workflows | CSV/XLSX imports, openpyxl |
| Local infrastructure | Docker Compose |
| Validation and testing | TypeScript/ESLint, frontend Node test suites, Python integration tests |

## How the pieces fit together

```text
React + TypeScript (browser)
          |
          | JSON / REST via Vite dev proxy
          v
     FastAPI (Python)
     Authentication • RBAC • business rules
          |
          v
    SQLAlchemy + Alembic
          |
          v
       PostgreSQL
```

Each organization has its own membership and data scope. Operations involving registrations and participant imports are validated by the backend, including duplicate and capacity checks. For the deeper design, see [Architecture](docs/architecture.md) and [Database](docs/database.md).

## Repository guide

```text
fieldops-pro/
├── backend/          # FastAPI application, models, routers, migrations, tests
├── frontend/         # React application, features, pages, frontend tests
├── docs/             # Architecture, requirements, QA and feature handovers
├── compose.yaml      # Local PostgreSQL service
└── README.md
```

Start with [frontend/README.md](frontend/README.md) for verified frontend routes, permissions, testing commands, and environment-specific setup notes.

## Local development

**Prerequisites:** Docker Compose, a supported Node.js version for the included Vite release, Python, and an installed backend Python environment.

The current repository does **not yet contain a consolidated backend dependency manifest or a turnkey fresh-machine bootstrap**. These steps are suitable once the backend environment has been provisioned; do not treat them as a complete one-command installation.

1. Create a **local, uncommitted** root `.env` with strong `POSTGRES_PASSWORD` and `JWT_SECRET_KEY` values. Never commit credentials.
2. Start PostgreSQL from the repository root:

   ```bash
   docker compose up -d db
   ```

3. From `backend/`, using your configured Python environment, apply migrations and start the API:

   ```bash
   alembic upgrade head
   python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
   ```

4. From `frontend/`, install the locked dependencies and launch the web app:

   ```bash
   npm ci
   npm run dev
   ```

Open the URL printed by Vite (typically [http://localhost:5173](http://localhost:5173)). API documentation is available locally at [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs). The Vite `/backend` proxy forwards requests to FastAPI.

### Checks

From `frontend/`:

```bash
npm run build
npm run lint
npm test
```

The backend also has integration tests in [backend/tests](backend/tests/). Some require a **separate disposable test PostgreSQL database**; see the linked QA documents before running them. Do not point integration tests at your development database.

## Roadmap

- [x] Authentication, organization access, events, and member roles
- [x] Participants, registrations, attendance, tasks, and assignments
- [x] Join requests, notifications, safe organization archiving, and bulk imports
- [ ] Inventory and equipment movements
- [ ] Budgeting and expense tracking
- [ ] Analytics and reporting
- [ ] Offline-first workflows and synchronization
- [ ] Repeatable clean-machine setup, CI, screenshots, and public deployment

**Roadmap items represent planned work, not released capabilities.** Public documentation will be updated as each milestone is completed and pushed.

## Documentation

- [System architecture](docs/architecture.md)
- [Software requirements](docs/requirements.md)
- [Bulk registration and spreadsheet import](docs/bulk-participant-registration.md)
- [Frontend functionality and API behavior](docs/day-9-frontend.md)
- [Secure organization onboarding](docs/day-9.5-onboarding.md)
- [QA improvements, notifications, and organization archiving](docs/day-9.5-qa-improvements.md)

## Author

**Jean Paul Hadchiti** — Full-stack development, APIs, databases, and practical operations software.

[GitHub profile](https://github.com/jeanpaulhadchiti)

*This project is under active development. No license has been selected yet.*
