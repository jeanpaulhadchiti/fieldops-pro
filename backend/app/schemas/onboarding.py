import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


JoinRequestStatus = Literal["pending", "approved", "rejected"]


class JoinRequestCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    message: str | None = Field(default=None, max_length=1000)

    @field_validator("message", mode="before")
    @classmethod
    def clean_message(cls, value):
        if isinstance(value, str):
            if "\x00" in value:
                raise ValueError("Null characters are not allowed")
            return value.strip() or None
        return value


class JoinRequestReview(BaseModel):
    model_config = ConfigDict(extra="forbid")
    decision: Literal["approve", "reject"]


class MyJoinRequest(BaseModel):
    id: uuid.UUID
    organization_id: uuid.UUID
    organization_name: str
    status: JoinRequestStatus
    message: str | None
    created_at: datetime
    reviewed_at: datetime | None
    membership_active: bool


class ReviewedJoinRequest(MyJoinRequest):
    user_id: uuid.UUID
    applicant_name: str
    applicant_email: str
    reviewed_by: uuid.UUID | None
