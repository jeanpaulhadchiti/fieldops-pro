
import uuid
from datetime import datetime

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)


class _InventoryCategoryInput(BaseModel):
    @field_validator("name", mode="before", check_fields=False)
    @classmethod
    def normalize_name(cls, value):
        if isinstance(value, str):
            if "\x00" in value:
                raise ValueError("name cannot contain NUL characters")
            value = value.strip()
            if not value:
                raise ValueError("name cannot be blank")
        return value

    @field_validator("description", mode="before", check_fields=False)
    @classmethod
    def validate_description(cls, value):
        if isinstance(value, str) and "\x00" in value:
            raise ValueError("description cannot contain NUL characters")
        return value


class InventoryCategoryCreate(_InventoryCategoryInput):
    organization_id: uuid.UUID
    name: str = Field(min_length=1, max_length=100)
    description: str | None = Field(
        default=None,
        max_length=500
    )


class InventoryCategoryRead(BaseModel):
    id: uuid.UUID
    organization_id: uuid.UUID
    name: str
    description: str | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class InventoryCategoryUpdate(_InventoryCategoryInput):
    name: str | None = Field(
        default=None,
        min_length=1,
        max_length=100
    )
    description: str | None = Field(
        default=None,
        max_length=500
    )

    @model_validator(mode="after")
    def validate_required_fields(self):
        if "name" in self.model_fields_set and self.name is None:
            raise ValueError("name cannot be null")
        return self
