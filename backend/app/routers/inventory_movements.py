
import uuid
from decimal import Decimal

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    status,
)

from sqlalchemy import select, func
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user

from app.models.user import User
from app.models.membership import Membership
from app.models.inventory_item import InventoryItem
from app.models.inventory_movement import InventoryMovement

from app.schemas.inventory_movement import (
    InventoryMovementCreate,
    InventoryMovementRead,
)


router = APIRouter(
    prefix="/api/v1/inventory/movements",
    tags=["Inventory Movements"]
)

MAX_QUANTITY = Decimal("9999999999.99")


# CHECK ACTIVE ORGANIZATION MEMBERSHIP
def require_movement_membership(
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


# CREATE STOCK MOVEMENT
@router.post(
    "",
    response_model=InventoryMovementRead,
    status_code=status.HTTP_201_CREATED
)
def create_inventory_movement(
    movement_data: InventoryMovementCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # Step 1: Verify permissions
    require_movement_membership(
        movement_data.organization_id,
        current_user,
        db,
        write=True
    )

    # Step 2: Lock the inventory item
    item = db.scalar(
        select(InventoryItem)
        .where(
            InventoryItem.id == movement_data.item_id,
            InventoryItem.organization_id ==
            movement_data.organization_id
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
            detail="Cannot modify an archived item"
        )

    # Step 3: Validate opening stock
    if movement_data.movement_type == "opening":
        previous_movement = db.scalar(
            select(InventoryMovement.id).where(
                InventoryMovement.item_id == item.id,
                InventoryMovement.organization_id ==
                movement_data.organization_id
            ).limit(1)
        )

        if (
            previous_movement is not None
            or item.current_quantity != Decimal("0")
        ):
            raise HTTPException(
                status_code=409,
                detail="Opening stock is only allowed "
                       "before the first movement"
            )

    # Step 4: Calculate the new quantity
    quantity_before = item.current_quantity
    quantity_delta = movement_data.quantity_delta

    quantity_after = quantity_before + quantity_delta

    # Step 5: Prevent negative stock
    if quantity_after < Decimal("0"):
        raise HTTPException(
            status_code=409,
            detail="Insufficient inventory stock"
        )

    # Step 6: Prevent numeric overflow
    if quantity_after > MAX_QUANTITY:
        raise HTTPException(
            status_code=422,
            detail="Quantity exceeds storage limits"
        )

    # The item lock serializes allocation with every other stock change.
    last_sequence = db.scalar(
        select(func.max(InventoryMovement.sequence_number)).where(
            InventoryMovement.item_id == item.id,
            InventoryMovement.organization_id == movement_data.organization_id,
        )
    ) or 0

    # Step 7: Create the audit movement
    movement = InventoryMovement(
        organization_id=movement_data.organization_id,
        item_id=item.id,
        sequence_number=last_sequence + 1,
        movement_type=movement_data.movement_type,
        quantity_delta=quantity_delta,
        quantity_before=quantity_before,
        quantity_after=quantity_after,
        actor_id=current_user.id,
        notes=movement_data.notes
    )

    # Step 8: Update item and movement atomically
    item.current_quantity = quantity_after

    try:
        db.add(movement)
        db.commit()
        db.refresh(movement)

    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Stock movement violates a database constraint"
        )

    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Could not save the stock movement"
        )

    return movement


# LIST MOVEMENT HISTORY
@router.get(
    "",
    response_model=list[InventoryMovementRead]
)
def list_inventory_movements(
    organization_id: uuid.UUID,
    item_id: uuid.UUID | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    require_movement_membership(
        organization_id,
        current_user,
        db
    )

    query = select(InventoryMovement).where(
        InventoryMovement.organization_id == organization_id
    )

    if item_id is not None:
        query = query.where(
            InventoryMovement.item_id == item_id
        )

    # A running time maximum preserves cross-item recency while ensuring an
    # earlier transaction timestamp can never reverse an item's stock order.
    history_time = func.max(InventoryMovement.created_at).over(
        partition_by=(InventoryMovement.organization_id, InventoryMovement.item_id),
        order_by=InventoryMovement.sequence_number,
        rows=(None, 0),
    )
    ordering = (
        (InventoryMovement.sequence_number.desc(),)
        if item_id is not None else (
            history_time.desc(),
            InventoryMovement.item_id.asc(),
            InventoryMovement.sequence_number.desc(),
        )
    )
    movements = db.scalars(
        query
        .order_by(*ordering)
        .offset(offset)
        .limit(limit)
    ).all()

    return movements


# GET ONE MOVEMENT
@router.get(
    "/{movement_id}",
    response_model=InventoryMovementRead
)
def get_inventory_movement(
    movement_id: uuid.UUID,
    organization_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    require_movement_membership(
        organization_id,
        current_user,
        db
    )

    movement = db.scalar(
        select(InventoryMovement).where(
            InventoryMovement.id == movement_id,
            InventoryMovement.organization_id == organization_id
        )
    )

    if movement is None:
        raise HTTPException(
            status_code=404,
            detail="Inventory movement not found"
        )

    return movement
