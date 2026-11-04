
import uuid

from decimal import Decimal

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    status,
)

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user

from app.models.user import User
from app.models.membership import Membership
from app.models.inventory_item import InventoryItem
from app.models.inventory_category import InventoryCategory
from app.models.storage_location import StorageLocation

from app.schemas.inventory_item import (
    InventoryItemCreate,
    InventoryItemRead,
    InventoryItemUpdate,
)


router = APIRouter(
    prefix="/api/v1/inventory/items",
    tags=["Inventory Items"]
)


# CHECK ORGANIZATION MEMBERSHIP
def require_item_membership(
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


# CHECK CATEGORY AND LOCATION REFERENCES
def validate_item_references(
    organization_id: uuid.UUID,
    category_id: uuid.UUID | None,
    location_id: uuid.UUID | None,
    db: Session
):
    if category_id is not None:
        category = db.scalar(
            select(InventoryCategory).where(
                InventoryCategory.id == category_id,
                InventoryCategory.organization_id == organization_id
            )
        )

        if category is None:
            raise HTTPException(
                status_code=404,
                detail="Category not found"
            )

    if location_id is not None:
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


# CREATE INVENTORY ITEM
@router.post(
    "",
    response_model=InventoryItemRead,
    status_code=status.HTTP_201_CREATED
)
def create_inventory_item(
    item_data: InventoryItemCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    require_item_membership(
        item_data.organization_id,
        current_user,
        db,
        write=True
    )

    validate_item_references(
        item_data.organization_id,
        item_data.category_id,
        item_data.location_id,
        db
    )

    item = InventoryItem(
        organization_id=item_data.organization_id,
        category_id=item_data.category_id,
        location_id=item_data.location_id,
        name=item_data.name,
        sku=item_data.sku,
        unit=item_data.unit,
        item_type=item_data.item_type,
        current_quantity=Decimal("0"),
        minimum_quantity=item_data.minimum_quantity,
        archived=False
    )

    try:
        db.add(item)
        db.commit()
        db.refresh(item)

    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Inventory item conflicts with existing data"
        )

    return item


# LIST INVENTORY ITEMS
@router.get(
    "",
    response_model=list[InventoryItemRead]
)
def list_inventory_items(
    organization_id: uuid.UUID,
    archived: bool = False,
    low_stock_only: bool = False,
    category_id: uuid.UUID | None = None,
    location_id: uuid.UUID | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    require_item_membership(
        organization_id,
        current_user,
        db
    )

    query = select(InventoryItem).where(
        InventoryItem.organization_id == organization_id,
        InventoryItem.archived == archived
    )

    if low_stock_only:
        query = query.where(
            InventoryItem.current_quantity
            < InventoryItem.minimum_quantity
        )

    if category_id is not None:
        query = query.where(
            InventoryItem.category_id == category_id
        )

    if location_id is not None:
        query = query.where(
            InventoryItem.location_id == location_id
        )

    items = db.scalars(
        query
        .order_by(
            InventoryItem.name.asc(),
            InventoryItem.id.asc()
        )
        .offset(offset)
        .limit(limit)
    ).all()

    return items


# GET INVENTORY ITEM BY ID
@router.get(
    "/{item_id}",
    response_model=InventoryItemRead
)
def get_inventory_item(
    item_id: uuid.UUID,
    organization_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    require_item_membership(
        organization_id,
        current_user,
        db
    )

    item = db.scalar(
        select(InventoryItem).where(
            InventoryItem.id == item_id,
            InventoryItem.organization_id == organization_id
        )
    )

    if item is None:
        raise HTTPException(
            status_code=404,
            detail="Inventory item not found"
        )

    return item


# UPDATE INVENTORY ITEM
@router.patch(
    "/{item_id}",
    response_model=InventoryItemRead
)
def update_inventory_item(
    item_id: uuid.UUID,
    organization_id: uuid.UUID,
    item_data: InventoryItemUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    require_item_membership(
        organization_id,
        current_user,
        db,
        write=True
    )

    item = db.scalar(
        select(InventoryItem)
        .where(
            InventoryItem.id == item_id,
            InventoryItem.organization_id == organization_id
        )
        .with_for_update()
    )

    if item is None:
        raise HTTPException(
            status_code=404,
            detail="Inventory item not found"
        )

    if item.archived:
        raise HTTPException(
            status_code=409,
            detail="Cannot update an archived inventory item"
        )

    updates = item_data.model_dump(exclude_unset=True)

    validate_item_references(
        organization_id,
        updates.get("category_id", item.category_id),
        updates.get("location_id", item.location_id),
        db
    )

    for field, value in updates.items():
        setattr(item, field, value)

    try:
        db.commit()
        db.refresh(item)

    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Inventory item update conflicts with existing data"
        )

    return item


# ARCHIVE INVENTORY ITEM
@router.delete(
    "/{item_id}",
    status_code=status.HTTP_204_NO_CONTENT
)
def archive_inventory_item(
    item_id: uuid.UUID,
    organization_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    require_item_membership(
        organization_id,
        current_user,
        db,
        write=True
    )

    item = db.scalar(
        select(InventoryItem)
        .where(
            InventoryItem.id == item_id,
            InventoryItem.organization_id == organization_id
        )
        .with_for_update()
    )

    if item is None:
        raise HTTPException(
            status_code=404,
            detail="Inventory item not found"
        )

    if item.archived:
        return None

    if item.current_quantity != Decimal("0"):
        raise HTTPException(
            status_code=409,
            detail="Item stock must be zero before archiving"
        )

    item.archived = True
    db.commit()

    return None


# RESTORE ARCHIVED INVENTORY ITEM
@router.post(
    "/{item_id}/restore",
    response_model=InventoryItemRead
)
def restore_inventory_item(
    item_id: uuid.UUID,
    organization_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    require_item_membership(
        organization_id,
        current_user,
        db,
        write=True
    )

    item = db.scalar(
        select(InventoryItem)
        .where(
            InventoryItem.id == item_id,
            InventoryItem.organization_id == organization_id
        )
        .with_for_update()
    )

    if item is None:
        raise HTTPException(
            status_code=404,
            detail="Inventory item not found"
        )

    item.archived = False
    db.commit()
    db.refresh(item)

    return item
