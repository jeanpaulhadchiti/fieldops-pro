
import uuid
from datetime import datetime

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)


def clean_location_name(value):
    if not isinstance(value, str):
        return value

    if "\x00" in value:
        raise ValueError("Name cannot contain NUL characters")

    value = value.strip()

    if not value:
        raise ValueError("Location name cannot be blank")

    return value


def validate_description(value):
    if isinstance(value, str) and "\x00" in value:
        raise ValueError(
            "Description cannot contain NUL characters"
        )

    return value


class StorageLocationCreate(BaseModel):
    organization_id: uuid.UUID
    name: str = Field(min_length=1, max_length=100)
    description: str | None = Field(
        default=None,
        max_length=500
    )

    @field_validator("name", mode="before")
    @classmethod
    def check_name(cls, value):
        return clean_location_name(value)

    @field_validator("description", mode="before")
    @classmethod
    def check_description(cls, value):
        return validate_description(value)


class StorageLocationRead(BaseModel):
    id: uuid.UUID
    organization_id: uuid.UUID
    name: str
    description: str | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class StorageLocationUpdate(BaseModel):
    name: str | None = Field(
        default=None,
        min_length=1,
        max_length=100
    )
    description: str | None = Field(
        default=None,
        max_length=500
    )

    @field_validator("name", mode="before")
    @classmethod
    def check_name(cls, value):
        return clean_location_name(value)

    @field_validator("description", mode="before")
    @classmethod
    def check_description(cls, value):
        return validate_description(value)

    @model_validator(mode="after")
    def validate_required_fields(self):
        if "name" in self.model_fields_set and self.name is None:
            raise ValueError("name cannot be null")

        return self
