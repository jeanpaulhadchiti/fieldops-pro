import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.organization_join_request import OrganizationJoinRequest
from app.models.user import User
from app.schemas.onboarding import (
    JoinRequestCreate, JoinRequestReview, JoinRequestStatus, MyJoinRequest, ReviewedJoinRequest,
)
from app.services.onboarding import create_join_request, request_response, require_reviewer, review_join_request


router = APIRouter(tags=["Organization onboarding"])


def atomic_call(db, operation):
    try:
        return operation()
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Membership or join-request state changed concurrently. Refresh before trying again.")
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(500, "The join request could not be saved. No partial membership change was committed.")


@router.get("/organization-join-requests/mine", response_model=list[MyJoinRequest])
def my_join_requests(
    status: JoinRequestStatus | None = None,
    page: int = Query(default=1, ge=1, le=10000),
    page_size: int = Query(default=50, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = select(OrganizationJoinRequest).where(OrganizationJoinRequest.user_id == current_user.id)
    if status:
        query = query.where(OrganizationJoinRequest.status == status)
    requests = db.scalars(query.order_by(OrganizationJoinRequest.created_at.desc(), OrganizationJoinRequest.id)
                          .offset((page - 1) * page_size).limit(page_size)).all()
    return [request_response(db, request) for request in requests]


@router.post("/organizations/{organization_id}/join-requests", response_model=MyJoinRequest, status_code=201)
def submit_join_request(
    organization_id: uuid.UUID,
    data: JoinRequestCreate,
    response: Response,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    result, created = atomic_call(db, lambda: create_join_request(db, current_user, organization_id, data))
    response.status_code = 201 if created else 200
    return result


@router.get("/organizations/{organization_id}/join-requests", response_model=list[ReviewedJoinRequest])
def organization_join_requests(
    organization_id: uuid.UUID,
    status: JoinRequestStatus | None = None,
    request_id: uuid.UUID | None = None,
    page: int = Query(default=1, ge=1, le=10000),
    page_size: int = Query(default=50, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_reviewer(db, organization_id, current_user.id)
    query = select(OrganizationJoinRequest).where(OrganizationJoinRequest.organization_id == organization_id)
    if request_id is not None:
        query = query.where(OrganizationJoinRequest.id == request_id)
    if status:
        query = query.where(OrganizationJoinRequest.status == status)
    requests = db.scalars(query.order_by(OrganizationJoinRequest.created_at.desc(), OrganizationJoinRequest.id)
                          .offset((page - 1) * page_size).limit(page_size)).all()
    return [request_response(db, request, reviewer=True) for request in requests]


@router.patch("/organizations/{organization_id}/join-requests/{request_id}", response_model=ReviewedJoinRequest)
def review_request(
    organization_id: uuid.UUID,
    request_id: uuid.UUID,
    data: JoinRequestReview,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return atomic_call(db, lambda: review_join_request(db, current_user, organization_id, request_id, data))
