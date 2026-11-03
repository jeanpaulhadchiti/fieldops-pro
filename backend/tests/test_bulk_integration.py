"""Real PostgreSQL/HTTP regression coverage for atomic bulk operations.

Uses the same mandatory isolated database gate as test_day9_integration.py.
Run with unittest discovery targeting this file; nine inherited Day 9 tests
also exercise backward compatibility. No development database is disposable.
"""

import io
import secrets
import threading
import uuid
import zipfile
from concurrent.futures import ThreadPoolExecutor

import httpx
from openpyxl import Workbook
from sqlalchemy import create_engine, event as sqlalchemy_event, func, select
from sqlalchemy.orm import Session

import test_day9_integration as day9


class BulkPostgreSQLIntegration(day9.Day9PostgreSQLIntegration):
    def import_payload(self, names, event_id=None, key=None):
        return {
            "organization_id": self.organization["id"],
            "rows": [{"row_number": index, "full_name": name} for index, name in enumerate(names, start=2)],
            "event_id": event_id, "fee_required": False,
            "idempotency_key": key or str(uuid.uuid4()),
        }

    def import_people(self, names, event_id=None):
        return self.expect("POST", "/api/v1/participants/import", payload=self.import_payload(names, event_id))

    def new_names(self, count):
        prefix = uuid.uuid4().hex[:12]
        return [f"Bulk {prefix} participant {index}" for index in range(count)]

    def bulk_payload(self, event_id, ids, key=None):
        return {"event_id": event_id, "participant_ids": ids, "idempotency_key": key or str(uuid.uuid4()), "fee_required": False}

    def directory_count(self):
        return len(self.expect("GET", f"/api/v1/participants?organization_id={self.organization['id']}"))

    def registrations_for(self, event_id):
        return self.expect("GET", f"/api/v1/registrations?event_id={event_id}")

    def preview(self, content, filename="participants.csv", role="owner", expected=200):
        response = self.client.post(
            "/api/v1/participants/import/preview",
            headers={"Authorization": f"Bearer {self.accounts[role]['token']}"},
            data={"organization_id": self.organization["id"]},
            files={"file": (filename, content, "application/octet-stream")},
        )
        self.assertEqual(response.status_code, expected, response.text[:400])
        return response.json()

    def race(self, requests):
        barrier = threading.Barrier(len(requests))

        def invoke(request):
            with httpx.Client(base_url=self.client.base_url, timeout=20, trust_env=False) as client:
                barrier.wait(timeout=10)
                return client.post(request[0], json=request[1], headers={"Authorization": f"Bearer {self.accounts['owner']['token']}"})

        with ThreadPoolExecutor(max_workers=len(requests)) as executor:
            return list(executor.map(invoke, requests))

    def test_bulk_success_for_one_ten_and_one_hundred_participants(self):
        for count in (1, 10, 100):
            with self.subTest(count=count):
                event = self.event()
                imported = self.import_people(self.new_names(count))
                ids = [participant["id"] for participant in imported["participants"]]
                result = self.expect("POST", "/api/v1/registrations/bulk", payload=self.bulk_payload(event["id"], ids))
                self.assertEqual(result["created_count"], count)
                self.assertFalse(result["replayed"])
                self.assertEqual({row["participant_id"] for row in result["registrations"]}, set(ids))
                self.assertEqual(len(self.registrations_for(event["id"])), count)

    def test_bulk_duplicate_ids_rejected_without_registration_or_receipt(self):
        event = self.event()
        participant = self.participant()
        payload = self.bulk_payload(event["id"], [participant["id"], participant["id"]])
        self.expect("POST", "/api/v1/registrations/bulk", expected=422, payload=payload)
        self.assertEqual(self.registrations_for(event["id"]), [])
        payload["participant_ids"] = [participant["id"]]
        result = self.expect("POST", "/api/v1/registrations/bulk", payload=payload)
        self.assertFalse(result["replayed"])

    def test_bulk_existing_and_cancelled_registration_conflicts_are_atomic(self):
        event = self.event()
        existing, available = self.import_people(self.new_names(2))["participants"]
        registration = self.registration(event["id"], existing["id"])
        payload = self.bulk_payload(event["id"], [existing["id"], available["id"]])
        result = self.expect("POST", "/api/v1/registrations/bulk", expected=409, payload=payload)
        self.assertTrue(any(issue.get("participant_id") == existing["id"] for issue in result["detail"]))
        self.assertEqual(len(self.registrations_for(event["id"])), 1)
        self.expect("PATCH", f"/api/v1/registrations/{registration['id']}/cancel")
        self.expect("POST", "/api/v1/registrations/bulk", expected=409, payload=payload)
        self.assertEqual(len(self.registrations_for(event["id"])), 1)

    def test_bulk_foreign_or_missing_participant_rolls_back_entire_selection(self):
        event = self.event()
        local = self.participant()
        foreign = self.participant(role="outsider", organization_id=self.other_organization["id"])
        for unavailable_id in (foreign["id"], str(uuid.uuid4())):
            with self.subTest(unavailable_id=unavailable_id):
                self.expect("POST", "/api/v1/registrations/bulk", expected=409,
                            payload=self.bulk_payload(event["id"], [local["id"], unavailable_id]))
                self.assertEqual(self.registrations_for(event["id"]), [])

    def test_bulk_capacity_conflict_leaves_existing_and_requested_rows_unchanged(self):
        event = self.event(capacity=2)
        participants = self.import_people(self.new_names(3))["participants"]
        self.registration(event["id"], participants[0]["id"])
        result = self.expect("POST", "/api/v1/registrations/bulk", expected=409,
                             payload=self.bulk_payload(event["id"], [row["id"] for row in participants[1:]]))
        self.assertTrue(any("remaining" in issue["msg"] for issue in result["detail"]))
        self.assertEqual(len(self.registrations_for(event["id"])), 1)

    def test_bulk_identical_key_replay_is_order_independent_and_survives_archival(self):
        event = self.event(capacity=2)
        participants = self.import_people(self.new_names(2))["participants"]
        payload = self.bulk_payload(event["id"], [row["id"] for row in participants])
        first = self.expect("POST", "/api/v1/registrations/bulk", payload=payload)
        self.expect("PATCH", f"/api/v1/events/{event['id']}/status", payload={"status": "active"})
        self.expect("PATCH", f"/api/v1/events/{event['id']}/status", payload={"status": "completed"})
        self.expect("PATCH", f"/api/v1/events/{event['id']}/archive")
        replay = self.expect("POST", "/api/v1/registrations/bulk", payload={**payload, "participant_ids": list(reversed(payload["participant_ids"]))})
        self.assertTrue(replay["replayed"])
        self.assertEqual(replay["operation_id"], first["operation_id"])
        self.assertEqual(replay["registrations"], first["registrations"])

    def test_bulk_key_reuse_with_changed_payload_or_operation_is_a_conflict(self):
        event = self.event()
        participants = self.import_people(self.new_names(2))["participants"]
        payload = self.bulk_payload(event["id"], [participants[0]["id"]])
        self.expect("POST", "/api/v1/registrations/bulk", payload=payload)
        self.expect("POST", "/api/v1/registrations/bulk", expected=409,
                    payload={**payload, "participant_ids": [participants[1]["id"]]})
        self.expect("POST", "/api/v1/participants/import", expected=409,
                    payload=self.import_payload(self.new_names(1), key=payload["idempotency_key"]))
        self.assertEqual(len(self.registrations_for(event["id"])), 1)

    def test_bulk_member_viewer_and_other_organization_are_not_authorized(self):
        event = self.event()
        participant = self.participant()
        payload = self.bulk_payload(event["id"], [participant["id"]])
        for role, code in (("member", 403), ("viewer", 403), ("outsider", 404)):
            self.expect("POST", "/api/v1/registrations/bulk", role=role, expected=code, payload=payload)
        self.assertEqual(self.registrations_for(event["id"]), [])

    def test_bulk_replay_revalidates_current_membership_and_permissions(self):
        account_name = f"receipt-admin-{uuid.uuid4().hex[:8]}"
        email = f"{account_name}@example.com"
        password = "A!" + secrets.token_urlsafe(24)
        user_response = self.client.post("/auth/register", json={"name": account_name, "email": email, "password": password})
        self.assertEqual(user_response.status_code, 201)
        token = self.client.post("/auth/login", json={"email": email, "password": password}).json()["access_token"]
        self.accounts[account_name] = {"id": user_response.json()["id"], "email": email, "token": token}
        membership = self.expect("POST", f"/organizations/{self.organization['id']}/members", expected=201,
                                 payload={"email": email, "role": "Admin"})
        event = self.event()
        participant = self.participant()
        payload = self.bulk_payload(event["id"], [participant["id"]])
        self.expect("POST", "/api/v1/registrations/bulk", role=account_name, payload=payload)
        self.expect("PATCH", f"/organizations/{self.organization['id']}/members/{membership['id']}/role", payload={"role": "Viewer"})
        self.expect("POST", "/api/v1/registrations/bulk", role=account_name, expected=403, payload=payload)
        # No membership-deactivation endpoint exists; fixture administration is
        # confined to the already validated isolated PostgreSQL database.
        from app.models.membership import Membership
        engine = create_engine(self.database_url)
        try:
            with Session(engine) as db:
                db.get(Membership, uuid.UUID(membership["id"])).status = "inactive"
                db.commit()
        finally:
            engine.dispose()
        self.expect("POST", "/api/v1/registrations/bulk", role=account_name, expected=404, payload=payload)

    def test_bulk_concurrent_batches_never_exceed_capacity(self):
        event = self.event(capacity=1)
        participants = self.import_people(self.new_names(2))["participants"]
        responses = self.race([
            ("/api/v1/registrations/bulk", self.bulk_payload(event["id"], [participant["id"]]))
            for participant in participants
        ])
        self.assertEqual(sorted(response.status_code for response in responses), [200, 409])
        self.assertEqual(len(self.registrations_for(event["id"])), 1)

    def test_bulk_concurrent_identical_key_creates_one_persistent_receipt(self):
        event = self.event(capacity=2)
        participants = self.import_people(self.new_names(2))["participants"]
        payload = self.bulk_payload(event["id"], [row["id"] for row in participants])
        responses = self.race([("/api/v1/registrations/bulk", payload)] * 2)
        self.assertEqual([response.status_code for response in responses], [200, 200])
        results = [response.json() for response in responses]
        self.assertEqual(sorted(row["replayed"] for row in results), [False, True])
        self.assertEqual(results[0]["operation_id"], results[1]["operation_id"])
        self.assertEqual(results[0]["registrations"], results[1]["registrations"])
        self.assertEqual(len(self.registrations_for(event["id"])), 2)

    def test_bulk_and_single_registration_share_capacity_lock(self):
        event = self.event(capacity=1)
        participants = self.import_people(self.new_names(2))["participants"]
        responses = self.race([
            ("/api/v1/registrations/bulk", self.bulk_payload(event["id"], [participants[0]["id"]])),
            ("/api/v1/registrations", {"event_id": event["id"], "participant_id": participants[1]["id"]}),
        ])
        self.assertEqual(sum(response.status_code in {200, 201} for response in responses), 1)
        self.assertEqual(sum(response.status_code == 409 for response in responses), 1)
        self.assertEqual(len(self.registrations_for(event["id"])), 1)

    def test_import_preview_csv_reports_names_blank_rows_and_both_duplicate_types(self):
        existing = self.participant()
        unique = self.new_names(1)[0]
        content = f"\ufefffull_name\n{existing['full_name'].upper()}\n{unique}\n  {unique.upper()}  \n\n{'x' * 151}\n".encode("utf-8")
        result = self.preview(content)
        self.assertEqual(result["total_rows"], 5)
        self.assertEqual(result["valid_rows"], 1)
        self.assertEqual(result["invalid_rows"], 4)
        self.assertEqual(result["rows"][0]["existing_participant_id"], existing["id"])
        self.assertEqual(result["rows"][2]["duplicate_of_row"], 3)
        self.assertTrue(result["rows"][3]["errors"])
        self.assertTrue(result["rows"][4]["errors"])

    def test_import_preview_xlsx_preserves_interior_blank_and_rejects_formulas(self):
        workbook = Workbook()
        sheet = workbook.active
        sheet.append(["full_name"])
        sheet.append([self.new_names(1)[0]])
        sheet.append([None])
        sheet.append(["=SUM(1,2)"])
        output = io.BytesIO()
        workbook.save(output)
        workbook.close()
        result = self.preview(output.getvalue(), "participants.xlsx")
        self.assertEqual(result["total_rows"], 3)
        self.assertEqual(result["valid_rows"], 1)
        self.assertTrue(result["rows"][1]["errors"])
        self.assertTrue(any("Formula" in error for error in result["rows"][2]["errors"]))

    def test_import_preview_rejects_bad_headers_encoding_extensions_and_file_limits(self):
        for content, filename, expected in (
            (b"name\nAlex\n", "participants.csv", 400),
            (b"full_name,full_name\nA,B\n", "participants.csv", 400),
            (b"full_name\n\xff\xfe\n", "participants.csv", 400),
            (b"full_name\nAlex\n", "participants.txt", 400),
            (b"x" * (5 * 1024 * 1024 + 1), "participants.csv", 413),
            (("full_name\n" + "Alex\n" * 1001).encode(), "participants.csv", 413),
        ):
            with self.subTest(filename=filename, expected=expected, size=len(content)):
                self.preview(content, filename, expected=expected)
        expanded = io.BytesIO()
        with zipfile.ZipFile(expanded, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("large.xml", b"x" * (20 * 1024 * 1024 + 1))
        self.preview(expanded.getvalue(), "expanded.xlsx", expected=413)

    def test_import_preview_rejects_missing_header_in_empty_xlsx_and_unauthorized_users(self):
        workbook = Workbook()
        output = io.BytesIO()
        workbook.save(output)
        workbook.close()
        self.preview(output.getvalue(), "empty.xlsx", expected=400)
        for role, code in (("member", 403), ("viewer", 403), ("outsider", 404)):
            self.preview(b"full_name\nAlex\n", role=role, expected=code)

    def test_import_apply_is_atomic_for_invalid_existing_and_repeated_names(self):
        existing = self.participant()
        before = self.directory_count()
        fresh = self.new_names(1)[0]
        for names, expected in (([fresh, "   "], 422), ([fresh, fresh.upper()], 409), ([fresh, existing["full_name"].upper()], 409)):
            self.expect("POST", "/api/v1/participants/import", expected=expected, payload=self.import_payload(names))
            self.assertEqual(self.directory_count(), before)

    def test_import_optional_registration_and_replay_preserve_all_created_ids(self):
        event = self.event(capacity=3)
        payload = self.import_payload(self.new_names(3), event["id"])
        first = self.expect("POST", "/api/v1/participants/import", payload=payload)
        self.assertEqual((first["created_count"], first["registered_count"]), (3, 3))
        self.assertEqual({row["participant_id"] for row in first["registrations"]}, {row["id"] for row in first["participants"]})
        self.expect("PATCH", f"/api/v1/events/{event['id']}/status", payload={"status": "active"})
        self.expect("PATCH", f"/api/v1/events/{event['id']}/status", payload={"status": "completed"})
        replay = self.expect("POST", "/api/v1/participants/import", payload={**payload, "rows": list(reversed(payload["rows"]))})
        self.assertTrue(replay["replayed"])
        self.assertEqual(replay["operation_id"], first["operation_id"])
        self.assertEqual(replay["participants"], first["participants"])
        self.assertEqual(replay["registrations"], first["registrations"])
        self.assertEqual(len(self.registrations_for(event["id"])), 3)

    def test_import_capacity_or_foreign_event_failure_does_not_create_directory_rows(self):
        local_event = self.event(capacity=1)
        foreign_event = self.event(role="outsider", organization_id=self.other_organization["id"])
        before = self.directory_count()
        for event_id, code in ((local_event["id"], 409), (foreign_event["id"], 404)):
            self.expect("POST", "/api/v1/participants/import", expected=code,
                        payload=self.import_payload(self.new_names(2), event_id))
            self.assertEqual(self.directory_count(), before)
        self.assertEqual(self.registrations_for(local_event["id"]), [])

    def test_import_and_bulk_registration_concurrently_share_event_capacity(self):
        event = self.event(capacity=1)
        participant = self.participant()
        before = self.directory_count()
        responses = self.race([
            ("/api/v1/participants/import", self.import_payload(self.new_names(1), event["id"])),
            ("/api/v1/registrations/bulk", self.bulk_payload(event["id"], [participant["id"]])),
        ])
        self.assertEqual(sorted(response.status_code for response in responses), [200, 409])
        self.assertEqual(len(self.registrations_for(event["id"])), 1)
        expected_created = 1 if responses[0].status_code == 200 else 0
        self.assertEqual(self.directory_count(), before + expected_created)

    def test_import_concurrent_identical_names_are_serialized_by_organization(self):
        names = self.new_names(1)
        before = self.directory_count()
        responses = self.race([
            ("/api/v1/participants/import", self.import_payload(names)),
            ("/api/v1/participants/import", self.import_payload(names)),
        ])
        self.assertEqual(sorted(response.status_code for response in responses), [200, 409])
        self.assertEqual(self.directory_count(), before + 1)

    def test_import_receipt_database_failure_rolls_back_previously_flushed_people_and_registrations(self):
        # The listener corrupts only this test receipt so PostgreSQL itself
        # raises a NOT NULL violation at commit, after participant/registration
        # INSERTs have already flushed. The actual atomic route wrapper must
        # roll back every row. There is no test endpoint or production hook.
        from fastapi import HTTPException
        from app.models.bulk_operation import BulkOperation
        from app.models.participant import Participant
        from app.models.registration import Registration
        from app.models.user import User
        from app.routers.bulk import atomic_call
        from app.schemas.bulk import ParticipantImportCreate
        from app.services.bulk import apply_import

        target = self.event(capacity=2)
        payload = self.import_payload(self.new_names(2), target["id"])
        data = ParticipantImportCreate.model_validate(payload)
        engine = create_engine(self.database_url)

        def corrupt_receipt(_mapper, _connection, receipt):
            if receipt.idempotency_key == data.idempotency_key:
                receipt.operation_type = None

        sqlalchemy_event.listen(BulkOperation, "before_insert", corrupt_receipt)
        try:
            with Session(engine, autoflush=False) as db:
                before = db.scalar(select(func.count(Participant.id)).where(Participant.organization_id == data.organization_id))
                owner = db.get(User, uuid.UUID(self.accounts["owner"]["id"]))
                with self.assertRaises(HTTPException) as failure:
                    atomic_call(db, lambda: apply_import(db, owner, data))
                self.assertEqual(failure.exception.status_code, 409)
                after = db.scalar(select(func.count(Participant.id)).where(Participant.organization_id == data.organization_id))
                self.assertEqual(after, before)
                self.assertEqual(db.scalar(select(func.count(Registration.id)).where(Registration.event_id == uuid.UUID(target["id"]))), 0)
                self.assertEqual(db.scalar(select(func.count(BulkOperation.id)).where(BulkOperation.idempotency_key == data.idempotency_key)), 0)
        finally:
            sqlalchemy_event.remove(BulkOperation, "before_insert", corrupt_receipt)
            engine.dispose()


if __name__ == "__main__":
    import unittest
    unittest.main(verbosity=2)
