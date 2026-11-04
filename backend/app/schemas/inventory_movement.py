
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)


MovementType = Literal[
    "opening",
    "receive",
    "issue",
    "return",
    "adjustment",
]


class InventoryMovementCreate(BaseModel):
    organization_id: uuid.UUID
    item_id: uuid.UUID

    movement_type: MovementType

    quantity_delta: Decimal = Field(
        max_digits=12,
        decimal_places=2,
        allow_inf_nan=False
    )

    notes: str | None = Field(
        default=None,
        max_length=1000
    )

    @field_validator("notes", mode="before")
    @classmethod
    def validate_notes(cls, value):
        if not isinstance(value, str):
            return value

        if "\x00" in value:
            raise ValueError(
                "Notes cannot contain NUL characters"
            )

        return value.strip() or None

    @model_validator(mode="after")
    def validate_movement(self):
        delta = self.quantity_delta
        movement = self.movement_type

        if delta == 0:
            raise ValueError(
                "Quantity change cannot be zero"
            )

        if movement in (
            "opening",
            "receive",
            "return"
        ) and delta <= 0:
            raise ValueError(
                f"{movement} requires a positive quantity"
            )

        if movement == "issue" and delta >= 0:
            raise ValueError(
                "Issue requires a negative quantity"
            )

        if movement == "adjustment" and not self.notes:
            raise ValueError(
                "Adjustment requires a reason in notes"
            )

        return self


class InventoryMovementRead(BaseModel):
    id: uuid.UUID
    organization_id: uuid.UUID
    item_id: uuid.UUID
    sequence_number: int

    movement_type: MovementType

    quantity_delta: Decimal
    quantity_before: Decimal
    quantity_after: Decimal

    actor_id: uuid.UUID | None
    notes: str | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
