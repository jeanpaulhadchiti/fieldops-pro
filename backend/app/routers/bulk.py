import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.schemas.bulk import (
    BulkRegistrationCreate, BulkRegistrationResult, ImportPreviewResult,
    ParticipantImportCreate, ParticipantImportResult,
)
from app.services.bulk import MAX_FILE_BYTES, apply_import, bulk_register, preview_import


router = APIRouter(prefix="/api/v1", tags=["Bulk operations"])


def atomic_call(db, operation):
    try:
        return operation()
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "The batch conflicts with a concurrent update. No rows were imported or registered; refresh and try again.")
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(500, "The batch could not be saved. No partial batch was committed. Retry with the same idempotency key.")


@router.post("/registrations/bulk", response_model=BulkRegistrationResult)
def register_batch(
    data: BulkRegistrationCreate,
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db),
):
    return atomic_call(db, lambda: bulk_register(db, current_user, data))


@router.post("/participants/import/preview", response_model=ImportPreviewResult)
def preview_participants(
    organization_id: uuid.UUID = Form(...), file: UploadFile = File(...),
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db),
):
    try:
        content = file.file.read(MAX_FILE_BYTES + 1)
        return preview_import(db, current_user, organization_id, file.filename, content)
    finally:
        file.file.close()


@router.post("/participants/import", response_model=ParticipantImportResult)
def import_participants(
    data: ParticipantImportCreate,
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db),
):
    return atomic_call(db, lambda: apply_import(db, current_user, data))
