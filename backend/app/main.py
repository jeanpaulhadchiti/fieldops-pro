
from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from app.routers.participants import router as participants_router
from sqlalchemy import text, select, func
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from app.routers.events import router as events_router
from app.database import engine, get_db
from app.models.user import User
from app.models.organization import Organization
from app.models.membership import Membership
from app.routers.auth import router as auth_router
from app.routers.organizations import router as organizations_router
from app.routers.registrations import router as registrations_router
from app.routers.tasks import router as tasks_router
from app.routers.task_assignments import router as task_assignments_router
from app.routers.bulk import router as bulk_router
from app.routers.onboarding import router as onboarding_router
from app.routers.archive import router as archive_router
from app.services.archive import guard_workspace_mutation
from app.routers.notifications import router as notifications_router
from app.dependencies import get_current_user
import os




app = FastAPI(
    title="FieldOps Pro API",
    version="0.1.0"
)

app.include_router(auth_router)
app.include_router(organizations_router, dependencies=[Depends(guard_workspace_mutation)])
app.include_router(events_router, dependencies=[Depends(guard_workspace_mutation)])
app.include_router(participants_router, dependencies=[Depends(guard_workspace_mutation)])
app.include_router(registrations_router, dependencies=[Depends(guard_workspace_mutation)])
app.include_router(tasks_router, dependencies=[Depends(guard_workspace_mutation)])
app.include_router(task_assignments_router, dependencies=[Depends(guard_workspace_mutation)])
app.include_router(bulk_router, dependencies=[Depends(guard_workspace_mutation)])
app.include_router(onboarding_router, dependencies=[Depends(guard_workspace_mutation)])
app.include_router(archive_router)
app.include_router(notifications_router)


app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "application": "FieldOps Pro"
    }


@app.get("/health/db")
def database_health():
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))

        return {
            "status": "ok",
            "database": "connected"
        }

    except SQLAlchemyError:
        raise HTTPException(
            status_code=503,
            detail="Database unavailable"
        )

    
def require_dev_operator(current_user: User = Depends(get_current_user)):
    # Legacy debugging remains available only by explicit deployment opt-in and
    # a per-account operator allowlist. An ordinary signed-up account cannot use
    # debug routes to bypass private organization discovery or tenant checks.
    allowed = {value.strip() for value in os.getenv("FIELDOPS_DEV_USER_IDS", "").split(",") if value.strip()}
    if os.getenv("FIELDOPS_ENABLE_DEV_ENDPOINTS", "").lower() != "true" or str(current_user.id) not in allowed:
        raise HTTPException(404, "Not found")
    return current_user


@app.get("/dev/users/count")
def count_users(db: Session = Depends(get_db), current_user: User = Depends(require_dev_operator)):

    total = db.scalar(
        select(func.count(User.id))
    )

    return {
        "total_users": total
    }

@app.get("/dev/users/test")
def get_test_user(db: Session = Depends(get_db), current_user: User = Depends(require_dev_operator)):

    user = db.scalar(
        select(User).where(
            User.email == "testuser@example.com"
        )
    )

    if user is None:
        raise HTTPException(
            status_code=404,
            detail="Test user not found"
        )

    return {
        "name": user.name,
        "created_at": user.created_at
    }


@app.get("/dev/organizations/demo/members")
def get_organization_members(
    db: Session = Depends(get_db), current_user: User = Depends(require_dev_operator)
):

    organization = db.scalar(
        select(Organization).where(
            Organization.name == "Demo Scout Group"
        )
    )

    if organization is None:
        raise HTTPException(
            status_code=404,
            detail="Organization not found"
        )

    membership = db.scalar(select(Membership).where(
        Membership.organization_id == organization.id, Membership.user_id == current_user.id,
        Membership.status == "active",
    ))
    if membership is None:
        raise HTTPException(404, "Organization not found")

    members = db.execute(
        select(User.name, Membership.role)
        .join(
            Membership,
            User.id == Membership.user_id
        )
        .where(
            Membership.organization_id == organization.id
        )
    ).all()

    return {
        "organization": organization.name,
        "members": [
            {"name": name, "role": role}
            for name, role in members
        ]
    }

