import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.models.membership import Membership
from app.models.participant import Participant
from app.models.organization import Organization
from app.schemas.participant import ParticipantCreate, ParticipantRead


router = APIRouter(
    prefix="/api/v1/participants",
    tags=["Participants"]
)


@router.post(
    "",
    response_model=ParticipantRead,
    status_code=status.HTTP_201_CREATED
)
def create_participant(
    participant_data: ParticipantCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):

    membership = db.scalar(
        select(Membership).where(
            Membership.organization_id == participant_data.organization_id,
            Membership.user_id == current_user.id,
            Membership.status == "active"
        )
    )

    if membership is None:
        raise HTTPException(
            status_code=404,
            detail="Organization not found"
        )

    if membership.role not in ["Owner", "Admin"]:
        raise HTTPException(
            status_code=403,
            detail="Permission denied"
        )

    # Imports use the same organization lock while rechecking directory duplicates.
    db.scalar(select(Organization).where(Organization.id == participant_data.organization_id).with_for_update(key_share=True))

    new_participant = Participant(
        organization_id=participant_data.organization_id,
        full_name=participant_data.full_name
    )

    try:
        db.add(new_participant)
        db.commit()
        db.refresh(new_participant)

    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Could not create participant"
        )

    return new_participant


@router.get(
    "",
    response_model=list[ParticipantRead]
)
def get_participants(
    organization_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):

    membership = db.scalar(
        select(Membership).where(
            Membership.organization_id == organization_id,
            Membership.user_id == current_user.id,
            Membership.status == "active"
        )
    )

    if membership is None:
        raise HTTPException(
            status_code=404,
            detail="Organization not found"
        )

    participants = db.scalars(
        select(Participant)
        .where(
            Participant.organization_id == organization_id
        )
        .order_by(
            Participant.full_name.asc(),
            Participant.id.asc()
        )
    ).all()

    return participants
