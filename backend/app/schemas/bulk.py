import re
import uuid

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.schemas.participant import ParticipantRead
from app.schemas.registration import RegistrationRead


MAX_BATCH_ROWS = 1000


def normalize_name(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


class BulkRegistrationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    event_id: uuid.UUID
    participant_ids: list[uuid.UUID] = Field(min_length=1, max_length=MAX_BATCH_ROWS)
    idempotency_key: uuid.UUID
    fee_required: bool = False

    @field_validator("participant_ids")
    @classmethod
    def unique_participants(cls, values):
        if len(set(values)) != len(values):
            raise ValueError("Choose each participant only once")
        return values


class BulkRegistrationResult(BaseModel):
    operation_id: uuid.UUID
    idempotency_key: uuid.UUID
    event_id: uuid.UUID
    created_count: int
    registrations: list[RegistrationRead]
    replayed: bool = False


class ImportPreviewRow(BaseModel):
    row_number: int
    full_name: str
    errors: list[str] = Field(default_factory=list)
    duplicate_of_row: int | None = None
    existing_participant_id: uuid.UUID | None = None


class ImportPreviewResult(BaseModel):
    organization_id: uuid.UUID
    filename: str
    rows: list[ImportPreviewRow]
    total_rows: int
    valid_rows: int
    invalid_rows: int


class ParticipantImportRow(BaseModel):
    model_config = ConfigDict(extra="forbid")
    row_number: int = Field(ge=2, le=MAX_BATCH_ROWS + 1)
    full_name: str = Field(min_length=1, max_length=150)

    @field_validator("full_name", mode="before")
    @classmethod
    def normalize_full_name(cls, value):
        if isinstance(value, str):
            value = normalize_name(value)
            if "\x00" in value:
                raise ValueError("Participant names cannot contain null characters")
        return value


class ParticipantImportCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    organization_id: uuid.UUID
    rows: list[ParticipantImportRow] = Field(min_length=1, max_length=MAX_BATCH_ROWS)
    event_id: uuid.UUID | None = None
    fee_required: bool = False
    idempotency_key: uuid.UUID

    @model_validator(mode="after")
    def unique_row_numbers(self):
        if len({row.row_number for row in self.rows}) != len(self.rows):
            raise ValueError("Each source row number must be unique")
        if self.fee_required and self.event_id is None:
            raise ValueError("A fee requirement needs a selected event")
        return self


class ParticipantImportResult(BaseModel):
    operation_id: uuid.UUID
    idempotency_key: uuid.UUID
    organization_id: uuid.UUID
    event_id: uuid.UUID | None
    created_count: int
    registered_count: int
    participants: list[ParticipantRead]
    registrations: list[RegistrationRead]
    replayed: bool = False
