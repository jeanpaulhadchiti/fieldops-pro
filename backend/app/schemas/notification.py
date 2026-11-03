import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, StrictBool


class NotificationResponse(BaseModel):
    id: uuid.UUID
    organization_id: uuid.UUID
    organization_name: str
    join_request_id: uuid.UUID
    applicant_name: str
    status: Literal["pending", "approved", "rejected"]
    created_at: datetime
    updated_at: datetime
    read_at: datetime | None


class NotificationPage(BaseModel):
    items: list[NotificationResponse]
    unread_count: int
    has_more: bool


class NotificationReadUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    is_read: StrictBool
