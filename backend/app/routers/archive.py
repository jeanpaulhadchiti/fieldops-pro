import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.organization_archive_event import OrganizationArchiveEvent
from app.models.user import User
from app.schemas.archive import ArchiveConfirmation, ArchiveHistoryEntry
from app.schemas.organization import OrganizationResponse
from app.services.archive import change_archive_state, require_owner


router = APIRouter(prefix="/organizations", tags=["Organization archiving"])


def atomic_change(db, user, organization_id, data, archive):
    try:
        return change_archive_state(db, user, organization_id, data, archive)
    except HTTPException:
        db.rollback()
        raise
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(500, "The organization state could not be saved. Refresh before retrying.")


@router.post("/{organization_id}/archive", response_model=OrganizationResponse)
def archive_organization(organization_id: uuid.UUID, data: ArchiveConfirmation,
                         user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return atomic_change(db, user, organization_id, data, True)


@router.post("/{organization_id}/restore", response_model=OrganizationResponse)
def restore_organization(organization_id: uuid.UUID, data: ArchiveConfirmation,
                         user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return atomic_change(db, user, organization_id, data, False)


@router.get("/{organization_id}/archive-history", response_model=list[ArchiveHistoryEntry])
def archive_history(organization_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_owner(db, organization_id, user.id)
    return db.scalars(select(OrganizationArchiveEvent).where(OrganizationArchiveEvent.organization_id == organization_id)
        .order_by(OrganizationArchiveEvent.created_at.desc(), OrganizationArchiveEvent.id)).all()
