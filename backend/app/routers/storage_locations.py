
import uuid

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    status
)

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user

from app.models.user import User
from app.models.membership import Membership
from app.models.storage_location import StorageLocation
from app.models.inventory_item import InventoryItem

from app.schemas.storage_location import (
    StorageLocationCreate,
    StorageLocationRead,
    StorageLocationUpdate
)


router = APIRouter(
    prefix="/api/v1/inventory/locations",
    tags=["Inventory Locations"]
)


# VERIFY ORGANIZATION ACCESS
def require_location_membership(
    organization_id: uuid.UUID,
    current_user: User,
    db: Session,
    write: bool = False
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

    if write and membership.role not in ("Owner", "Admin"):
        raise HTTPException(
            status_code=403,
            detail="Permission denied"
        )

    return membership


# CREATE STORAGE LOCATION
@router.post(
    "",
    response_model=StorageLocationRead,
    status_code=status.HTTP_201_CREATED
)
def create_storage_location(
    location_data: StorageLocationCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    require_location_membership(
        location_data.organization_id,
        current_user,
        db,
        write=True
    )

    location = StorageLocation(
        organization_id=location_data.organization_id,
        name=location_data.name,
        description=location_data.description
    )

    try:
        db.add(location)
        db.commit()
        db.refresh(location)

    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Storage location conflicts with existing data"
        )

    return location


# LIST STORAGE LOCATIONS
@router.get(
    "",
    response_model=list[StorageLocationRead]
)
def list_storage_locations(
    organization_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    require_location_membership(
        organization_id,
        current_user,
        db
    )

    locations = db.scalars(
        select(StorageLocation)
        .where(
            StorageLocation.organization_id == organization_id
        )
        .order_by(StorageLocation.name.asc())
    ).all()

    return locations


# GET STORAGE LOCATION BY ID
@router.get(
    "/{location_id}",
    response_model=StorageLocationRead
)
def get_storage_location(
    location_id: uuid.UUID,
    organization_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    require_location_membership(
        organization_id,
        current_user,
        db
    )

    location = db.scalar(
        select(StorageLocation).where(
            StorageLocation.id == location_id,
            StorageLocation.organization_id == organization_id
        )
    )

    if location is None:
        raise HTTPException(
            status_code=404,
            detail="Storage location not found"
        )

    return location


# UPDATE STORAGE LOCATION
@router.patch(
    "/{location_id}",
    response_model=StorageLocationRead
)
def update_storage_location(
    location_id: uuid.UUID,
    organization_id: uuid.UUID,
    location_data: StorageLocationUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    require_location_membership(
        organization_id,
        current_user,
        db,
        write=True
    )

    location = db.scalar(
        select(StorageLocation).where(
            StorageLocation.id == location_id,
            StorageLocation.organization_id == organization_id
        )
    )

    if location is None:
        raise HTTPException(
            status_code=404,
            detail="Storage location not found"
        )

    update_data = location_data.model_dump(
        exclude_unset=True
    )

    for field, value in update_data.items():
        setattr(location, field, value)

    try:
        db.commit()
        db.refresh(location)

    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Storage location update conflicts with existing data"
        )

    return location


# DELETE UNUSED STORAGE LOCATION
@router.delete(
    "/{location_id}",
    status_code=status.HTTP_204_NO_CONTENT
)
def delete_storage_location(
    location_id: uuid.UUID,
    organization_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    require_location_membership(
        organization_id,
        current_user,
        db,
        write=True
    )

    location = db.scalar(
        select(StorageLocation).where(
            StorageLocation.id == location_id,
            StorageLocation.organization_id == organization_id
        )
    )

    if location is None:
        raise HTTPException(
            status_code=404,
            detail="Storage location not found"
        )

    existing_item = db.scalar(
        select(InventoryItem.id).where(
            InventoryItem.location_id == location_id,
            InventoryItem.organization_id == organization_id
        ).limit(1)
    )

    if existing_item is not None:
        raise HTTPException(
            status_code=409,
            detail="Cannot delete a location containing inventory items"
        )

    try:
        db.delete(location)
        db.commit()

    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Storage location is still referenced by inventory items"
        )

    return None
