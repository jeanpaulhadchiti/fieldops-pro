
import uuid
import re
import unicodedata
from datetime import datetime

from pydantic import BaseModel, EmailStr, ConfigDict, Field, field_validator

from app.organization_names import clean_text


class UserCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    password: str = Field(min_length=10, max_length=128)

    @field_validator("password")
    @classmethod
    def meaningful_password(cls, value):
        if not value.strip():
            raise ValueError("Password cannot contain only whitespace")
        if not re.search(r"[A-Z]", value):
            raise ValueError("Password must contain at least one uppercase letter (A-Z)")
        if not any(unicodedata.category(character)[0] in {"P", "S"} for character in value):
            raise ValueError("Password must contain at least one special character")
        return value  # Never trim or otherwise alter a chosen password.

    @field_validator("name", mode="before")
    @classmethod
    def clean_name(cls, value):
        if isinstance(value, str):
            if "\x00" in value:
                raise ValueError("Null characters are not allowed")
            return clean_text(value)
        return value


class UserResponse(BaseModel):
    id: uuid.UUID
    name: str
    email: EmailStr
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class UserLogin(BaseModel):
    email: EmailStr
    password: str
