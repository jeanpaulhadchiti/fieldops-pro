import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ArchiveConfirmation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    confirmation_name: str = Field(min_length=1, max_length=150)


class ArchiveHistoryEntry(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    organization_id: uuid.UUID
    actor_id: uuid.UUID
    action: str
    created_at: datetime
