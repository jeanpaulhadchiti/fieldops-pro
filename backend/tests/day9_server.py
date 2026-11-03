"""Isolated PostgreSQL app for Day 9 integration checks and browser verification.

Run from backend with FIELDOPS_TEST_DATABASE_URL set, for example:
    python -m uvicorn day9_server:create_app --factory --app-dir tests --port 8001

The URL must target an explicitly named local fieldops_day9_test_* database.
This module never drops data, changes .env, or calls the development engine.
"""

import os
import re
import secrets
from contextlib import asynccontextmanager

from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL, make_url


def validated_database_url(value: str | None) -> URL:
    """Refuse an absent, remote, SQLite, or development database before imports."""
    if not value:
        raise RuntimeError("FIELDOPS_TEST_DATABASE_URL is required; development database fallback is forbidden")
    try:
        url = make_url(value)
    except Exception as error:
        raise RuntimeError("FIELDOPS_TEST_DATABASE_URL is not a valid PostgreSQL URL") from error
    if url.get_backend_name() != "postgresql":
        raise RuntimeError("Integration tests require PostgreSQL")
    if url.host not in {"localhost", "127.0.0.1", "::1"} or url.port is None:
        raise RuntimeError("Integration tests require an explicit local PostgreSQL host and port")
    if not re.fullmatch(r"fieldops_day9_test_[a-z0-9_]+", url.database or ""):
        raise RuntimeError("Integration database name must begin with fieldops_day9_test_ and contain a suffix")
    # Do not accept libpq service/host overrides that could redirect a safe URL.
    if url.query:
        raise RuntimeError("Integration database URL query overrides are forbidden")
    return url.set(drivername="postgresql+psycopg")


def create_app():
    url = validated_database_url(os.environ.get("FIELDOPS_TEST_DATABASE_URL"))

    # These defaults exist only in this test process. The application's .env is
    # never modified, and its development engine is never used for any query.
    os.environ.setdefault("JWT_SECRET_KEY", secrets.token_urlsafe(48))
    os.environ.setdefault("POSTGRES_PASSWORD", secrets.token_urlsafe(24))

    from fastapi import FastAPI, Depends
    from sqlalchemy.orm import Session
    from app.database import get_db
    from app.models.base import Base
    from app.routers.auth import router as auth_router
    from app.routers.organizations import router as organizations_router
    from app.routers.events import router as events_router
    from app.routers.participants import router as participants_router
    from app.routers.registrations import router as registrations_router
    from app.routers.tasks import router as tasks_router
    from app.routers.task_assignments import router as assignments_router
    from app.routers.bulk import router as bulk_router
    from app.routers.onboarding import router as onboarding_router
    from app.routers.archive import router as archive_router
    from app.services.archive import guard_workspace_mutation
    from app.routers.notifications import router as notifications_router

    engine = create_engine(url, pool_pre_ping=True)
    Base.metadata.create_all(engine)

    @asynccontextmanager
    async def lifespan(_app):
        yield
        engine.dispose()

    app = FastAPI(title="FieldOps Pro isolated Day 9 test API", lifespan=lifespan)
    app.state.test_engine = engine
    app.state.test_database_name = url.database

    def isolated_db():
        with Session(engine, autoflush=False) as db:
            yield db

    app.dependency_overrides[get_db] = isolated_db
    for router in (
        auth_router, organizations_router, events_router, participants_router,
        registrations_router, tasks_router, assignments_router, bulk_router, onboarding_router, notifications_router,
    ):
        app.include_router(router, dependencies=[] if router is auth_router else [Depends(guard_workspace_mutation)])
    app.include_router(archive_router)

    @app.get("/health")
    def health():
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        return {
            "status": "ok", "application": "FieldOps Pro",
            "test_database": url.database, "database_type": "postgresql",
        }

    return app
