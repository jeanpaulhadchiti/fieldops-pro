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
from app.models.inventory_category import InventoryCategory
from app.models.inventory_item import InventoryItem

from app.schemas.inventory_category import (
    InventoryCategoryCreate,
    InventoryCategoryRead,
    InventoryCategoryUpdate
)


router = APIRouter(
    prefix="/api/v1/inventory/categories",
    tags=["Inventory Categories"]
)


# CREATE INVENTORY CATEGORY
@router.post(
    "",
    response_model=InventoryCategoryRead,
    status_code=status.HTTP_201_CREATED
)
def create_inventory_category(
    category_data: InventoryCategoryCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):

    # Step 1: Check organization membership
    membership = db.scalar(
        select(Membership).where(
            Membership.organization_id == category_data.organization_id,
            Membership.user_id == current_user.id,
            Membership.status == "active"
        )
    )

    if membership is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organization not found"
        )

    # Step 2: Check user permissions
    if membership.role not in ("Owner", "Admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Permission denied"
        )

    # Step 3: Create inventory category
    category = InventoryCategory(
        organization_id=category_data.organization_id,
        name=category_data.name,
        description=category_data.description
    )

    # Step 4: Save to PostgreSQL
    try:
        db.add(category)
        db.commit()
        db.refresh(category)

    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Category already exists or violates a database constraint"
        )

    # Step 5: Return created category
    return category



# LIST INVENTORY CATEGORIES
@router.get(
    "",
    response_model=list[InventoryCategoryRead]
)
def list_inventory_categories(
    organization_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):

    # Step 1: Verify active organization membership
    membership = db.scalar(
        select(Membership).where(
            Membership.organization_id == organization_id,
            Membership.user_id == current_user.id,
            Membership.status == "active"
        )
    )

    if membership is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organization not found"
        )

    # Step 2: Retrieve organization categories
    categories = db.scalars(
        select(InventoryCategory)
        .where(
            InventoryCategory.organization_id == organization_id
        )
        .order_by(InventoryCategory.name.asc())
    ).all()

    # Step 3: Return the results
    return categories


# CHECK ORGANIZATION MEMBERSHIP
def require_category_membership(
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


# GET CATEGORY BY ID
@router.get(
    "/{category_id}",
    response_model=InventoryCategoryRead
)
def get_inventory_category(
    category_id: uuid.UUID,
    organization_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    require_category_membership(
        organization_id, current_user, db
    )

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

    return category


# UPDATE CATEGORY
@router.patch(
    "/{category_id}",
    response_model=InventoryCategoryRead
)
def update_inventory_category(
    category_id: uuid.UUID,
    organization_id: uuid.UUID,
    category_data: InventoryCategoryUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    require_category_membership(
        organization_id, current_user, db, write=True
    )

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

    update_data = category_data.model_dump(
        exclude_unset=True
    )

    for field, value in update_data.items():
        setattr(category, field, value)

    try:
        db.commit()
        db.refresh(category)
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Category update conflicts with existing data"
        )

    return category


# DELETE UNUSED CATEGORY
@router.delete(
    "/{category_id}",
    status_code=status.HTTP_204_NO_CONTENT
)
def delete_inventory_category(
    category_id: uuid.UUID,
    organization_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    require_category_membership(
        organization_id, current_user, db, write=True
    )

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

    # Do not delete categories containing inventory items
    existing_item = db.scalar(
        select(InventoryItem.id).where(
            InventoryItem.category_id == category_id,
            InventoryItem.organization_id == organization_id
        ).limit(1)
    )

    if existing_item is not None:
        raise HTTPException(
            status_code=409,
            detail="Cannot delete a category containing inventory items"
        )

    try:
        db.delete(category)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Category is still referenced by inventory items"
        )

    return None
