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

from sqlalchemy import create_engine, event, text
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

    from sqlalchemy.orm import Session
    from app.database import get_db, engine as development_engine
    from app.main import app
    from app.models.base import Base

    engine = create_engine(url, pool_pre_ping=True)

    # Check the real connection identity before schema creation or HTTP writes.
    with engine.connect() as connection:
        if connection.scalar(text("SELECT current_database()")) != url.database:
            engine.dispose()
            raise RuntimeError("Disposable database identity mismatch; no writes performed")
    Base.metadata.create_all(engine)

    if not event.contains(development_engine, "do_connect", _forbid_development_connection):
        event.listen(development_engine, "do_connect", _forbid_development_connection)

    production_lifespan = app.router.lifespan_context

    @asynccontextmanager
    async def lifespan(_app):
        try:
            async with production_lifespan(_app):
                yield
        finally:
            engine.dispose()

    app.router.lifespan_context = lifespan
    app.state.test_engine = engine
    app.state.test_database_name = url.database

    def isolated_db():
        with Session(engine, autoflush=False) as db:
            if db.scalar(text("SELECT current_database()")) != url.database:
                raise RuntimeError("Disposable database identity mismatch")
            yield db

    app.dependency_overrides[get_db] = isolated_db
    # Production owns every route, dependency and exception handler. Only the
    # public health probe adds database identity for the pre-write test check.
    return _IsolatedHealthApp(app, engine, url.database)


def _forbid_development_connection(*_args, **_kwargs):
    raise AssertionError("The isolated API must never connect to the development engine")


class _IsolatedHealthApp:
    def __init__(self, application, engine, database_name):
        self.application = application
        self.engine = engine
        self.database_name = database_name

    def __getattr__(self, name):
        return getattr(self.application, name)

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope["method"] == "GET" and scope["path"] == "/health":
            from starlette.concurrency import run_in_threadpool
            from starlette.responses import JSONResponse

            def health():
                with self.engine.connect() as connection:
                    actual = connection.scalar(text("SELECT current_database()"))
                if actual != self.database_name:
                    raise RuntimeError("Disposable database identity mismatch")
                return {
                    "status": "ok", "application": "FieldOps Pro",
                    "test_database": actual, "database_type": "postgresql",
                }

            response = JSONResponse(await run_in_threadpool(health))
            await response(scope, receive, send)
            return
        await self.application(scope, receive, send)
