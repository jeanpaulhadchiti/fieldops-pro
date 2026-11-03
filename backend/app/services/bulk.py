"""Bounded import parsing and atomic, authorization-checked bulk writes."""

import csv
import hashlib
import io
import json
import uuid
import zipfile
from pathlib import PurePath, PurePosixPath

from fastapi import HTTPException
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.models.bulk_operation import BulkOperation
from app.models.event import Event
from app.models.membership import Membership
from app.models.organization import Organization
from app.models.participant import Participant
from app.models.registration import Registration
from app.schemas.bulk import (
    MAX_BATCH_ROWS, BulkRegistrationCreate, BulkRegistrationResult,
    ImportPreviewResult, ImportPreviewRow, ParticipantImportCreate,
    ParticipantImportResult, normalize_name,
)
from app.schemas.participant import ParticipantRead
from app.schemas.registration import RegistrationRead


MAX_FILE_BYTES = 5 * 1024 * 1024
MAX_XLSX_EXPANDED_BYTES = 20 * 1024 * 1024
MAX_COLUMNS = 64


def require_manager(db: Session, organization_id: uuid.UUID, user_id: uuid.UUID):
    membership = db.scalar(select(Membership).where(
        Membership.organization_id == organization_id,
        Membership.user_id == user_id, Membership.status == "active",
    ))
    if membership is None:
        raise HTTPException(404, "Organization not found")
    if membership.role not in {"Owner", "Admin"}:
        raise HTTPException(403, "Only an active Owner or Admin can perform bulk operations")


def request_hash(operation: str, payload: dict) -> str:
    canonical = json.dumps({"operation": operation, "payload": payload}, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def replay_receipt(db: Session, organization_id, user_id, key, operation, fingerprint):
    # Transaction-scoped and deterministic across workers/restarts. This also
    # serializes reuse of one key for different events or operation types before
    # either request takes organization/event row locks.
    identity = f"{organization_id}:{user_id}:{key}".encode("ascii")
    advisory_key = int.from_bytes(hashlib.sha256(identity).digest()[:8], "big", signed=True)
    db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": advisory_key})
    receipt = db.scalar(select(BulkOperation).where(
        BulkOperation.organization_id == organization_id,
        BulkOperation.user_id == user_id,
        BulkOperation.idempotency_key == key,
    ))
    if receipt is None:
        return None
    if receipt.operation_type != operation or receipt.request_hash != fingerprint:
        raise HTTPException(409, "This idempotency key was already used with a different request. Use a new key for a new operation.")
    return {**receipt.result, "replayed": True}


def save_receipt(db, organization_id, user_id, key, operation, fingerprint, result):
    db.add(BulkOperation(
        id=result.operation_id, organization_id=organization_id,
        user_id=user_id, idempotency_key=key, operation_type=operation,
        request_hash=fingerprint, result=result.model_dump(mode="json"),
    ))
    # Rows and receipt have one commit. No receipt exists for a rejected batch.
    db.commit()
    return result


def item_error(field, index, message, **extra):
    return {"loc": ["body", field, index], "msg": message, "type": "value_error", **extra}


def locked_event(db, event_id, organization_id=None):
    query = select(Event).where(Event.id == event_id)
    if organization_id is not None:
        query = query.where(Event.organization_id == organization_id)
    event = db.scalar(query.with_for_update().execution_options(populate_existing=True))
    if event is None or event.archived_at is not None:
        raise HTTPException(404, "Event not found")
    return event


def event_batch_errors(db, event, count):
    if event.status not in {"planned", "active"}:
        return "This event is not accepting registrations"
    registered_count = db.scalar(select(func.count(Registration.id)).where(
        Registration.event_id == event.id, Registration.status == "registered",
    )) or 0
    remaining = None if event.capacity is None else max(0, event.capacity - registered_count)
    if remaining is not None and count > remaining:
        return f"The event has {remaining} remaining place(s), but this atomic batch requires {count}"
    return None


def bulk_register(db: Session, current_user, data: BulkRegistrationCreate):
    # Resolve authorization even when the event was archived after a successful
    # first request; a valid replay does not depend on later mutable event state.
    initial_event = db.scalar(select(Event).where(Event.id == data.event_id))
    if initial_event is None:
        raise HTTPException(404, "Event not found")
    organization_id = initial_event.organization_id
    require_manager(db, organization_id, current_user.id)
    ids = sorted(data.participant_ids, key=str)
    fingerprint = request_hash("bulk_registration", {
        "event_id": str(data.event_id), "participant_ids": [str(value) for value in ids],
        "fee_required": data.fee_required,
    })
    replay = replay_receipt(db, organization_id, current_user.id, data.idempotency_key, "bulk_registration", fingerprint)
    if replay is not None:
        db.commit()  # Release the advisory lock before returning the saved result.
        return BulkRegistrationResult.model_validate(replay)

    event = locked_event(db, data.event_id, organization_id)
    participants = db.scalars(select(Participant).where(
        Participant.organization_id == organization_id, Participant.id.in_(ids),
    )).all()
    found_ids = {participant.id for participant in participants}
    existing = db.scalars(select(Registration).where(
        Registration.event_id == event.id, Registration.participant_id.in_(ids),
    )).all()
    existing_ids = {registration.participant_id for registration in existing}
    errors = []
    for index, participant_id in enumerate(data.participant_ids):
        if participant_id not in found_ids:
            errors.append(item_error("participant_ids", index, "Participant is not available in this organization", participant_id=str(participant_id)))
        elif participant_id in existing_ids:
            errors.append(item_error("participant_ids", index, "Participant already has a registration for this event, including any cancelled registration", participant_id=str(participant_id)))
    state_error = event_batch_errors(db, event, len(ids))
    if state_error:
        errors.extend(item_error("participant_ids", index, state_error, participant_id=str(participant_id))
                      for index, participant_id in enumerate(data.participant_ids))
    if errors:
        raise HTTPException(409, errors)

    registrations = [Registration(
        event_id=event.id, participant_id=participant_id, fee_required=data.fee_required,
        payment_status="unpaid" if data.fee_required else None,
    ) for participant_id in ids]
    db.add_all(registrations)
    db.flush()
    result = BulkRegistrationResult(
        operation_id=uuid.uuid4(), idempotency_key=data.idempotency_key,
        event_id=event.id, created_count=len(registrations),
        registrations=[RegistrationRead.model_validate(row) for row in registrations],
    )
    return save_receipt(db, organization_id, current_user.id, data.idempotency_key, "bulk_registration", fingerprint, result)


def _header_index(header):
    names = [normalize_name(str(value or "")).casefold() for value in header]
    if names.count("full_name") != 1:
        raise HTTPException(400, "The file must have exactly one full_name column in its first row")
    return names.index("full_name")


def _csv_rows(content: bytes):
    try:
        decoded = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(400, "CSV files must use UTF-8 encoding. Save the file as CSV UTF-8 and try again.")
    try:
        sample = decoded[:8192]
        try:
            dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
        except csv.Error:
            dialect = csv.excel
        reader = csv.reader(io.StringIO(decoded, newline=""), dialect, strict=True)
        header = next(reader, None)
        if header is None:
            raise HTTPException(400, "The file is empty")
        if len(header) > MAX_COLUMNS:
            raise HTTPException(400, f"Files may have at most {MAX_COLUMNS} columns")
        column = _header_index(header)
        rows = []
        for number, values in enumerate(reader, start=2):
            if number > MAX_BATCH_ROWS + 1:
                raise HTTPException(413, f"Import at most {MAX_BATCH_ROWS} data rows at a time")
            if len(values) > MAX_COLUMNS:
                raise HTTPException(400, f"Row {number} has more than {MAX_COLUMNS} columns")
            value = values[column] if column < len(values) else ""
            rows.append((number, value, []))
        return rows
    except csv.Error:
        raise HTTPException(400, "The CSV file is malformed. Check quoted fields and column separators.")


def _xlsx_rows(content: bytes):
    try:
        from openpyxl import load_workbook
        from openpyxl.xml import DEFUSEDXML
        from defusedxml.ElementTree import iterparse
    except ImportError:
        raise HTTPException(503, "XLSX import requires the backend import dependencies. Ask an administrator to install requirements-import.txt.")
    if not DEFUSEDXML:
        raise HTTPException(503, "Safe XML parsing must be enabled before XLSX imports can be used")
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            entries = archive.infolist()
            if len(entries) > 1000 or sum(entry.file_size for entry in entries) > MAX_XLSX_EXPANDED_BYTES:
                raise HTTPException(413, "The expanded workbook exceeds the safe 20 MiB import limit")
            if any(entry.flag_bits & 1 for entry in entries):
                raise HTTPException(400, "Encrypted workbooks are not supported")
            total_cells = 0
            for entry in entries:
                path = PurePosixPath(entry.filename)
                if path.is_absolute() or ".." in path.parts or "\\" in entry.filename:
                    raise HTTPException(400, "The workbook contains an unsafe archive path")
                if not entry.filename.startswith("xl/worksheets/") or not entry.filename.endswith(".xml"):
                    continue
                row_count = 0
                row_cells = 0
                for _event, element in iterparse(io.BytesIO(archive.read(entry)), events=("end",)):
                    tag = element.tag.rsplit("}", 1)[-1]
                    if tag == "c":
                        total_cells += 1
                        row_cells += 1
                        reference = element.get("r", "")
                        letters = "".join(character for character in reference if character.isalpha())
                        column = 0
                        for character in letters.upper():
                            column = column * 26 + ord(character) - ord("A") + 1
                        if column > MAX_COLUMNS or row_cells > MAX_COLUMNS or total_cells > (MAX_BATCH_ROWS + 1) * MAX_COLUMNS:
                            raise HTTPException(413, "The workbook exceeds the safe import column or cell limit")
                    elif tag == "row":
                        row_count += 1
                        row_cells = 0
                        number = int(element.get("r", row_count))
                        if row_count > MAX_BATCH_ROWS + 1 or number > MAX_BATCH_ROWS + 1:
                            raise HTTPException(413, f"The workbook may have at most {MAX_BATCH_ROWS} data rows per worksheet")
                    element.clear()
        workbook = load_workbook(io.BytesIO(content), read_only=True, data_only=False, keep_links=False)
        try:
            if not workbook.worksheets:
                raise HTTPException(400, "The workbook has no worksheets")
            sheet = workbook.worksheets[0]
            if sheet.max_row is not None and sheet.max_row > MAX_BATCH_ROWS + 1:
                raise HTTPException(413, f"The first worksheet may have at most {MAX_BATCH_ROWS} data rows")
            if sheet.max_column is not None and sheet.max_column > MAX_COLUMNS:
                raise HTTPException(400, f"The first worksheet may have at most {MAX_COLUMNS} columns")
            iterator = sheet.iter_rows(max_row=MAX_BATCH_ROWS + 1, max_col=MAX_COLUMNS)
            header = next(iterator, None)
            if not header:
                raise HTTPException(400, "The workbook is empty")
            column = _header_index([cell.value for cell in header])
            rows = []
            pending_empty = []
            for number, cells in enumerate(iterator, start=2):
                values = [cell.value for cell in cells]
                if all(value is None for value in values):
                    # Ignore only wholly empty trailing worksheet rows; interior
                    # empty rows remain visible validation errors in the preview.
                    pending_empty.append((number, "", []))
                    continue
                rows.extend(pending_empty)
                pending_empty = []
                cell = cells[column]
                errors = []
                if cell.data_type == "f":
                    errors.append("Formula cells are not accepted as participant names; replace the formula with plain text")
                elif cell.value is not None and not isinstance(cell.value, str):
                    errors.append("Participant names must be text")
                rows.append((number, "" if cell.value is None else str(cell.value), errors))
            return rows
        finally:
            workbook.close()
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(400, "The XLSX workbook could not be read. Upload a valid, unencrypted .xlsx file.")


def preview_import(db, current_user, organization_id, filename, content):
    require_manager(db, organization_id, current_user.id)
    if not content:
        raise HTTPException(400, "The file is empty")
    if len(content) > MAX_FILE_BYTES:
        raise HTTPException(413, "Upload a file no larger than 5 MiB")
    filename = PurePath(filename or "").name
    extension = PurePath(filename).suffix.casefold()
    if extension == ".csv":
        parsed = _csv_rows(content)
    elif extension == ".xlsx":
        parsed = _xlsx_rows(content)
    else:
        raise HTTPException(400, "Upload a .csv or .xlsx file with a full_name header")
    if not parsed:
        raise HTTPException(400, "The file has a header but no participant rows")
    existing = db.scalars(select(Participant).where(Participant.organization_id == organization_id).order_by(Participant.id)).all()
    directory = {}
    for participant in existing:
        directory.setdefault(normalize_name(participant.full_name).casefold(), participant.id)
    seen = {}
    rows = []
    for number, raw_name, initial_errors in parsed:
        name = normalize_name(raw_name)
        errors = list(initial_errors)
        if not name:
            errors.append("Enter a participant full name")
        elif len(name) > 150:
            errors.append("Use 150 characters or fewer")
        if "\x00" in name:
            errors.append("Participant names cannot contain null characters")
        normalized = name.casefold()
        duplicate_of_row = seen.get(normalized) if normalized else None
        existing_id = directory.get(normalized) if normalized else None
        if duplicate_of_row is not None:
            errors.append(f"Duplicate of source row {duplicate_of_row}")
        if existing_id is not None:
            errors.append("A participant with this normalized name already exists in this organization")
        if normalized:
            seen.setdefault(normalized, number)
        rows.append(ImportPreviewRow(
            row_number=number, full_name=name, errors=errors,
            duplicate_of_row=duplicate_of_row, existing_participant_id=existing_id,
        ))
    valid_rows = sum(not row.errors for row in rows)
    return ImportPreviewResult(
        organization_id=organization_id, filename=filename, rows=rows,
        total_rows=len(rows), valid_rows=valid_rows, invalid_rows=len(rows) - valid_rows,
    )


def apply_import(db: Session, current_user, data: ParticipantImportCreate):
    require_manager(db, data.organization_id, current_user.id)
    rows = sorted(data.rows, key=lambda row: row.row_number)
    fingerprint = request_hash("participant_import", {
        "organization_id": str(data.organization_id),
        "rows": [row.model_dump(mode="json") for row in rows],
        "event_id": str(data.event_id) if data.event_id else None,
        "fee_required": data.fee_required,
    })
    replay = replay_receipt(db, data.organization_id, current_user.id, data.idempotency_key, "participant_import", fingerprint)
    if replay is not None:
        db.commit()
        return ParticipantImportResult.model_validate(replay)
    # Serialize directory writes without blocking KEY SHARE checks on receipts'
    # organization foreign key. FOR UPDATE here could deadlock with a concurrent
    # event-locked registration while this import waits for that event.
    organization = db.scalar(select(Organization).where(Organization.id == data.organization_id).with_for_update(key_share=True))
    if organization is None:
        raise HTTPException(404, "Organization not found")
    event = locked_event(db, data.event_id, data.organization_id) if data.event_id else None
    existing = db.scalars(select(Participant).where(Participant.organization_id == data.organization_id)).all()
    directory_names = {normalize_name(participant.full_name).casefold() for participant in existing}
    seen = {}
    errors = []
    for index, row in enumerate(data.rows):
        normalized = row.full_name.casefold()
        if normalized in seen:
            errors.append(item_error("rows", index, f"Duplicate participant name from source row {seen[normalized]}", row_number=row.row_number))
        if normalized in directory_names:
            errors.append(item_error("rows", index, "A participant with this normalized name already exists in this organization", row_number=row.row_number))
        seen.setdefault(normalized, row.row_number)
    state_error = event_batch_errors(db, event, len(rows)) if event else None
    if state_error:
        errors.extend(item_error("rows", index, state_error, row_number=row.row_number) for index, row in enumerate(data.rows))
    if errors:
        raise HTTPException(409, errors)

    participants = [Participant(organization_id=data.organization_id, full_name=row.full_name) for row in rows]
    db.add_all(participants)
    db.flush()
    registrations = []
    if event is not None:
        registrations = [Registration(
            event_id=event.id, participant_id=participant.id, fee_required=data.fee_required,
            payment_status="unpaid" if data.fee_required else None,
        ) for participant in participants]
        db.add_all(registrations)
        db.flush()
    result = ParticipantImportResult(
        operation_id=uuid.uuid4(), idempotency_key=data.idempotency_key,
        organization_id=data.organization_id, event_id=data.event_id,
        created_count=len(participants), registered_count=len(registrations),
        participants=[ParticipantRead.model_validate(row) for row in participants],
        registrations=[RegistrationRead.model_validate(row) for row in registrations],
    )
    return save_receipt(db, data.organization_id, current_user.id, data.idempotency_key, "participant_import", fingerprint, result)
