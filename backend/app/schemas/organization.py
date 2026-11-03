
import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.organization_names import clean_text
from app.countries import normalize_country


OrganizationType = Literal["Scout Group", "Sports Club", "NGO", "Other"]


class OrganizationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=150)
    organization_type: OrganizationType = "Other"
    organization_type_other: str | None = Field(default=None, max_length=100)
    country: str | None = Field(default=None, max_length=100)
    city: str | None = Field(default=None, max_length=100)
    description: str | None = Field(default=None, max_length=2000)
    is_discoverable: bool = False
    allow_possible_duplicate: bool = False

    @field_validator("country")
    @classmethod
    def canonical_country(cls, value):
        return normalize_country(value)

    @field_validator("name", "country", "city", "organization_type_other", mode="before")
    @classmethod
    def clean_strings(cls, value):
        if isinstance(value, str):
            if "\x00" in value:
                raise ValueError("Null characters are not allowed")
            return clean_text(value)
        return value

    @model_validator(mode="after")
    def validate_custom_type(self):
        # Older clients omitted the type entirely. Preserve that name-only
        # contract; choosing Other explicitly requires a meaningful label.
        if self.organization_type == "Other":
            if "organization_type" in self.model_fields_set and not self.organization_type_other:
                raise ValueError("Specify organization type when selecting Other")
        else:
            self.organization_type_other = None
        return self

    @field_validator("description", mode="before")
    @classmethod
    def clean_description(cls, value):
        if isinstance(value, str):
            if "\x00" in value:
                raise ValueError("Null characters are not allowed")
            return value.strip()
        return value


class OrganizationSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(default=None, min_length=1, max_length=150)
    organization_type: OrganizationType = Field(default=None)
    organization_type_other: str | None = Field(default=None, max_length=100)
    country: str | None = Field(default=None, max_length=100)
    city: str | None = Field(default=None, max_length=100)
    description: str | None = Field(default=None, max_length=2000)
    is_discoverable: bool = Field(default=None)

    @field_validator("name", "country", "city", "organization_type_other", mode="before")
    @classmethod
    def clean_strings(cls, value):
        return OrganizationCreate.clean_strings(value)

    @field_validator("description", mode="before")
    @classmethod
    def clean_description(cls, value):
        return OrganizationCreate.clean_description(value)

    @model_validator(mode="after")
    def require_changes(self):
        if not self.model_fields_set:
            raise ValueError("Provide at least one organization setting to update")
        return self


class OrganizationResponse(BaseModel):
    id: uuid.UUID
    name: str
    created_at: datetime
    organization_type: OrganizationType
    organization_type_other: str | None = None
    country: str | None
    city: str | None
    description: str | None
    is_discoverable: bool
    archived_at: datetime | None = None
    archived_by: uuid.UUID | None = None

    model_config = ConfigDict(from_attributes=True)


class OrganizationDiscoveryCard(BaseModel):
    id: uuid.UUID
    name: str
    organization_type: OrganizationType
    organization_type_other: str | None = None
    country: str | None
    city: str | None
    match_kind: Literal["exact", "similar"]


class OrganizationDiscoveryResult(BaseModel):
    matches: list[OrganizationDiscoveryCard]
