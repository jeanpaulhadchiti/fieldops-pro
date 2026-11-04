
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


def clean_required_text(value):
    if not isinstance(value, str):
        return value

    if "\x00" in value:
        raise ValueError("NUL characters are not allowed")

    value = value.strip()

    if not value:
        raise ValueError("Value cannot be blank")

    return value


def clean_optional_sku(value):
    if not isinstance(value, str):
        return value

    if "\x00" in value:
        raise ValueError("NUL characters are not allowed")

    return value.strip() or None


class InventoryItemCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    organization_id: uuid.UUID

    category_id: uuid.UUID | None = None
    location_id: uuid.UUID | None = None

    name: str = Field(min_length=1, max_length=150)
    sku: str | None = Field(default=None, max_length=50)

    unit: str = Field(
        default="piece",
        min_length=1,
        max_length=20
    )

    item_type: Literal[
        "consumable",
        "reusable"
    ] = "reusable"

    minimum_quantity: Decimal = Field(
        default=Decimal("0"),
        ge=0,
        max_digits=12,
        decimal_places=2,
        allow_inf_nan=False
    )

    @field_validator("name", "unit", mode="before")
    @classmethod
    def validate_text(cls, value):
        return clean_required_text(value)

    @field_validator("sku", mode="before")
    @classmethod
    def validate_sku(cls, value):
        return clean_optional_sku(value)


class InventoryItemRead(BaseModel):
    id: uuid.UUID
    organization_id: uuid.UUID

    category_id: uuid.UUID | None
    location_id: uuid.UUID | None

    name: str
    sku: str | None

    unit: str
    item_type: str

    current_quantity: Decimal
    minimum_quantity: Decimal

    archived: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class InventoryItemUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category_id: uuid.UUID | None = None
    location_id: uuid.UUID | None = None

    name: str | None = Field(
        default=None,
        min_length=1,
        max_length=150
    )

    sku: str | None = Field(default=None, max_length=50)

    unit: str | None = Field(
        default=None,
        min_length=1,
        max_length=20
    )

    item_type: Literal[
        "consumable",
        "reusable"
    ] | None = None

    minimum_quantity: Decimal | None = Field(
        default=None,
        ge=0,
        max_digits=12,
        decimal_places=2,
        allow_inf_nan=False
    )

    @field_validator("name", "unit", mode="before")
    @classmethod
    def validate_text(cls, value):
        return clean_required_text(value)

    @field_validator("sku", mode="before")
    @classmethod
    def validate_sku(cls, value):
        return clean_optional_sku(value)

    @model_validator(mode="after")
    def validate_required_fields(self):
        required = (
            "name",
            "unit",
            "item_type",
            "minimum_quantity",
        )

        for field in required:
            if (
                field in self.model_fields_set
                and getattr(self, field) is None
            ):
                raise ValueError(
                    f"{field} cannot be null"
                )

        return self
