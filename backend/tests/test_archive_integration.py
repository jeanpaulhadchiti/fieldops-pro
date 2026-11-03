"""Real PostgreSQL archive lifecycle, preservation, and mutation isolation checks."""

import secrets
import json
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor

import httpx

from sqlalchemy import create_engine, text

import test_day9_integration as day9


class ArchivePostgreSQLIntegration(day9.Day9PostgreSQLIntegration):
    def actor(self):
        suffix = uuid.uuid4().hex
        values = {"name": f"Archive {suffix[:8]}", "email": f"archive-{suffix}@example.com", "password": "Aa!" + secrets.token_urlsafe(24)}
        profile = self.call(None, "POST", "/auth/register", values, 201)
        login = self.call(None, "POST", "/auth/login", {"email": values["email"], "password": values["password"]})
        return {**values, "id": profile["id"], "token": login["access_token"]}

    def call(self, actor, method, path, payload=None, expected=200):
        response = self.client.request(method, path, json=payload, headers={"Authorization": f"Bearer {actor['token']}"} if actor else {})
        self.assertEqual(response.status_code, expected, f"{method} {path}: {response.text[:500]}")
        return None if response.status_code == 204 else response.json()

    def workspace(self):
        owner = self.actor()
        organization = self.call(owner, "POST", "/organizations", {"name": f"Archive workspace {uuid.uuid4().hex[:10]}", "organization_type": "NGO", "is_discoverable": True, "allow_possible_duplicate": True}, 201)
        return owner, organization

    def archive(self, owner, org, action="archive", expected=200):
        return self.call(owner, "POST", f"/organizations/{org['id']}/{action}", {"confirmation_name": org["name"]}, expected)

    def snapshot_records(self, organization_id):
        queries = {
            "memberships": "SELECT row_to_json(t)::text FROM memberships t WHERE organization_id=:organization_id ORDER BY id",
            "events": "SELECT row_to_json(t)::text FROM events t WHERE organization_id=:organization_id ORDER BY id",
            "participants": "SELECT row_to_json(t)::text FROM participants t WHERE organization_id=:organization_id ORDER BY id",
            "registrations": "SELECT row_to_json(t)::text FROM registrations t JOIN events e ON e.id=t.event_id WHERE e.organization_id=:organization_id ORDER BY t.id",
            "tasks": "SELECT row_to_json(t)::text FROM tasks t JOIN events e ON e.id=t.event_id WHERE e.organization_id=:organization_id ORDER BY t.id",
            "task_assignments": "SELECT row_to_json(t)::text FROM task_assignments t JOIN tasks task ON task.id=t.task_id JOIN events e ON e.id=task.event_id WHERE e.organization_id=:organization_id ORDER BY t.id",
            "organization_join_requests": "SELECT row_to_json(t)::text FROM organization_join_requests t WHERE organization_id=:organization_id ORDER BY id",
        }
        engine = create_engine(self.database_url)
        try:
            with engine.connect() as connection:
                return {table: connection.execute(text(sql), {"organization_id": uuid.UUID(organization_id)}).scalars().all() for table, sql in queries.items()}
        finally:
            engine.dispose()

    def test_archive_restoration_preserves_every_existing_record_and_audit_history(self):
        owner, org = self.workspace()
        event = self.call(owner, "POST", "/api/v1/events", {"organization_id": org["id"], "title": "Preserved event", "start_at": "2027-01-05T09:00:00+02:00", "end_at": "2027-01-05T17:00:00+02:00"}, 201)
        person = self.call(owner, "POST", "/api/v1/participants", {"organization_id": org["id"], "full_name": "Preserved participant"}, 201)
        self.call(owner, "POST", "/api/v1/registrations", {"event_id": event["id"], "participant_id": person["id"]}, 201)
        task = self.call(owner, "POST", "/api/v1/tasks", {"event_id": event["id"], "title": "Preserved task", "priority": "high"}, 201)
        self.call(owner, "POST", "/api/v1/task-assignments", {"task_id": task["id"], "user_id": owner["id"]}, 201)
        applicant = self.actor()
        self.call(applicant, "POST", f"/organizations/{org['id']}/join-requests", {}, 201)
        before = self.snapshot_records(org["id"])
        archived = self.archive(owner, org)
        self.assertIsNotNone(archived["archived_at"])
        self.assertEqual(archived["archived_by"], owner["id"])
        self.assertTrue(archived["is_discoverable"], "Saved visibility preference must be retained for restoration")
        self.assertEqual(self.snapshot_records(org["id"]), before)
        self.assertIn(org["id"], [item["id"] for item in self.call(owner, "GET", "/organizations")])
        self.call(owner, "GET", f"/api/v1/events/{event['id']}")
        matches = self.call(applicant, "GET", f"/organizations/discover?q={org['name']}")["matches"]
        self.assertNotIn(org["id"], [item["id"] for item in matches])
        self.call(applicant, "POST", f"/organizations/{org['id']}/join-requests", {}, 404)
        self.archive(owner, org)
        self.assertEqual(len(self.call(owner, "GET", f"/organizations/{org['id']}/archive-history")), 1)
        restored = self.archive(owner, org, "restore")
        self.assertIsNone(restored["archived_at"])
        self.assertIsNone(restored["archived_by"])
        self.assertEqual(self.snapshot_records(org["id"]), before)
        self.archive(owner, org, "restore")
        history = self.call(owner, "GET", f"/organizations/{org['id']}/archive-history")
        self.assertEqual([item["action"] for item in history], ["restore", "archive"])
        self.assertTrue(all(item["actor_id"] == owner["id"] for item in history))
        self.call(owner, "POST", "/api/v1/participants", {"organization_id": org["id"], "full_name": "Restored operations"}, 201)
        matches = self.call(applicant, "GET", f"/organizations/discover?q={org['name']}")["matches"]
        self.assertIn(org["id"], [item["id"] for item in matches])

    def test_archive_and_restore_require_active_owner_exact_confirmation_and_scope(self):
        owner, org = self.workspace()
        actors = {role: self.actor() for role in ("Admin", "Member", "Viewer", "outsider")}
        for role, actor in actors.items():
            if role != "outsider":
                self.call(owner, "POST", f"/organizations/{org['id']}/members", {"email": actor["email"], "role": role}, 201)
        self.call(None, "POST", f"/organizations/{org['id']}/archive", {"confirmation_name": org["name"]}, 401)
        self.call(owner, "POST", f"/organizations/{org['id']}/archive", {"confirmation_name": "Incorrect name"}, 422)
        self.call(owner, "POST", f"/organizations/{org['id']}/archive", {}, 422)
        for role, actor in actors.items():
            self.archive(actor, org, expected=404 if role == "outsider" else 403)
        self.archive(owner, org)
        for role, actor in actors.items():
            self.archive(actor, org, "restore", expected=404 if role == "outsider" else 403)
            self.call(actor, "GET", f"/organizations/{org['id']}/archive-history", expected=404 if role == "outsider" else 403)
        self.archive(owner, org, "restore")
        self.assertEqual(len(self.call(owner, "GET", f"/organizations/{org['id']}/archive-history")), 2)

    def test_archived_workspace_blocks_all_normal_mutation_families(self):
        owner, org = self.workspace()
        outsider = self.actor()
        event_payload = {"organization_id": org["id"], "title": "Archive guard event", "start_at": "2027-01-05T09:00:00+02:00", "end_at": "2027-01-05T17:00:00+02:00"}
        event = self.call(owner, "POST", "/api/v1/events", event_payload, 201)
        person = self.call(owner, "POST", "/api/v1/participants", {"organization_id": org["id"], "full_name": "Guard participant"}, 201)
        registration = self.call(owner, "POST", "/api/v1/registrations", {"event_id": event["id"], "participant_id": person["id"]}, 201)
        task = self.call(owner, "POST", "/api/v1/tasks", {"event_id": event["id"], "title": "Guard task", "priority": "high"}, 201)
        assignment = self.call(owner, "POST", "/api/v1/task-assignments", {"task_id": task["id"], "user_id": owner["id"]}, 201)
        join = self.call(outsider, "POST", f"/organizations/{org['id']}/join-requests", {}, 201)
        member = next(item for item in self.call(owner, "GET", f"/organizations/{org['id']}/members") if item["user_id"] == owner["id"])
        self.archive(owner, org)
        jobs = [
            ("POST", "/api/v1/events", event_payload),
            ("PATCH", f"/api/v1/events/{event['id']}", {"title": "Blocked"}),
            ("PATCH", f"/api/v1/events/{event['id']}/status", {"status": "active"}),
            ("PATCH", f"/api/v1/events/{event['id']}/archive", None),
            ("POST", "/api/v1/participants", {"organization_id": org["id"], "full_name": "Blocked"}),
            ("POST", "/api/v1/registrations", {"event_id": event["id"], "participant_id": person["id"]}),
            ("PATCH", f"/api/v1/registrations/{registration['id']}/attendance", None),
            ("PATCH", f"/api/v1/registrations/{registration['id']}/cancel", None),
            ("PATCH", f"/api/v1/registrations/{registration['id']}/payment", {"payment_status": "paid"}),
            ("POST", "/api/v1/registrations/bulk", {"event_id": event["id"], "participant_ids": [person["id"]], "idempotency_key": str(uuid.uuid4())}),
            ("POST", "/api/v1/participants/import", {"organization_id": org["id"], "rows": [{"row_number": 2, "full_name": "Blocked import"}], "idempotency_key": str(uuid.uuid4())}),
            ("POST", "/api/v1/tasks", {"event_id": event["id"], "title": "Blocked", "priority": "high"}),
            ("PATCH", f"/api/v1/tasks/{task['id']}", {"title": "Blocked"}),
            ("PATCH", f"/api/v1/tasks/{task['id']}/status", {"status": "done"}),
            ("POST", "/api/v1/task-assignments", {"task_id": task["id"], "user_id": owner["id"]}),
            ("DELETE", f"/api/v1/task-assignments/{assignment['id']}", None),
            ("PATCH", f"/organizations/{org['id']}/settings", {"city": "Blocked"}),
            ("POST", f"/organizations/{org['id']}/members", {"email": outsider["email"], "role": "Member"}),
            ("PATCH", f"/organizations/{org['id']}/members/{member['id']}/role", {"role": "Viewer"}),
            ("PATCH", f"/organizations/{org['id']}/join-requests/{join['id']}", {"decision": "approve"}),
        ]
        before = self.snapshot_records(org["id"])
        for method, path, payload in jobs:
            with self.subTest(method=method, path=path):
                self.call(owner, method, path, payload, 409)
        response = self.client.post("/api/v1/participants/import/preview", data={"organization_id": org["id"]}, files={"file": ("participants.csv", b"full_name\nBlocked preview\n", "text/csv")}, headers={"Authorization": f"Bearer {owner['token']}"})
        self.assertEqual(response.status_code, 409, response.text[:500])
        self.assertEqual(self.snapshot_records(org["id"]), before)
        self.call(outsider, "POST", "/api/v1/participants", {"organization_id": org["id"], "full_name": "Unauthorized"}, 404)

    def test_ignored_body_or_query_scope_cannot_bypass_archived_canonical_resources(self):
        owner, org = self.workspace()
        active = self.call(owner, "POST", "/organizations", {"name": f"Active scope {uuid.uuid4().hex[:10]}", "organization_type": "NGO"}, 201)
        event = self.call(owner, "POST", "/api/v1/events", {"organization_id": org["id"], "title": "Canonical archived event", "start_at": "2027-01-05T09:00:00+02:00", "end_at": "2027-01-05T17:00:00+02:00"}, 201)
        person = self.call(owner, "POST", "/api/v1/participants", {"organization_id": org["id"], "full_name": "Canonical participant"}, 201)
        registration = self.call(owner, "POST", "/api/v1/registrations", {"event_id": event["id"], "participant_id": person["id"]}, 201)
        task = self.call(owner, "POST", "/api/v1/tasks", {"event_id": event["id"], "title": "Canonical task", "priority": "high"}, 201)
        assignment = self.call(owner, "POST", "/api/v1/task-assignments", {"task_id": task["id"], "user_id": owner["id"]}, 201)
        self.archive(owner, org)
        spoof = {"organization_id": active["id"]}
        jobs = [
            ("POST", "/api/v1/registrations", {**spoof, "event_id": event["id"], "participant_id": person["id"]}),
            ("POST", "/api/v1/tasks", {**spoof, "event_id": event["id"], "title": "Spoofed", "priority": "high"}),
            ("POST", "/api/v1/task-assignments", {**spoof, "task_id": task["id"], "user_id": owner["id"]}),
            ("PATCH", f"/api/v1/events/{event['id']}", {**spoof, "title": "Spoofed"}),
            ("PATCH", f"/api/v1/registrations/{registration['id']}/payment", {**spoof, "payment_status": "paid"}),
            ("PATCH", f"/api/v1/tasks/{task['id']}/status", {**spoof, "status": "done"}),
            ("DELETE", f"/api/v1/task-assignments/{assignment['id']}", None),
        ]
        before = self.snapshot_records(org["id"])
        for method, path, payload in jobs:
            with self.subTest(method=method, path=path):
                self.call(owner, method, path + f"?organization_id={active['id']}", payload, 409)
        self.assertEqual(self.snapshot_records(org["id"]), before)

    def test_inactive_owner_cannot_restore_or_inspect_archive_history(self):
        owner, org = self.workspace()
        self.archive(owner, org)
        engine = create_engine(self.database_url)
        try:
            with engine.begin() as connection:
                connection.execute(text("UPDATE memberships SET status='inactive' WHERE organization_id=:org AND user_id=:actor"), {"org": uuid.UUID(org["id"]), "actor": uuid.UUID(owner["id"])})
            self.archive(owner, org, "restore", expected=404)
            self.call(owner, "GET", f"/organizations/{org['id']}/archive-history", expected=404)
            self.assertNotIn(org["id"], [item["id"] for item in self.call(owner, "GET", "/organizations")])
        finally:
            engine.dispose()

    def test_concurrent_event_write_and_archive_serialize_without_post_archive_mutations(self):
        for _ in range(3):
            owner, org = self.workspace()
            barrier = threading.Barrier(2)
            payload = {"organization_id": org["id"], "title": "Concurrent archive event", "start_at": "2027-01-05T09:00:00+02:00", "end_at": "2027-01-05T17:00:00+02:00"}
            def invoke(job):
                path, body = job
                with httpx.Client(base_url=self.client.base_url, timeout=20, trust_env=False) as client:
                    barrier.wait(timeout=10)
                    return client.post(path, json=body, headers={"Authorization": f"Bearer {owner['token']}"})
            with ThreadPoolExecutor(max_workers=2) as executor:
                write, archive = list(executor.map(invoke, [
                    ("/api/v1/events", payload),
                    (f"/organizations/{org['id']}/archive", {"confirmation_name": org["name"]}),
                ]))
            self.assertEqual(archive.status_code, 200, archive.text[:300])
            self.assertIn(write.status_code, {201, 409}, write.text[:300])
            final = self.call(owner, "GET", f"/organizations/{org['id']}")
            self.assertIsNotNone(final["archived_at"])
            events = self.call(owner, "GET", f"/api/v1/events?organization_id={org['id']}")
            self.assertEqual(len(events), 1 if write.status_code == 201 else 0)
            for _ in range(2):
                self.call(owner, "POST", "/api/v1/events", payload, 409)
            self.assertEqual(len(self.call(owner, "GET", f"/organizations/{org['id']}/archive-history")), 1)

    def test_json_media_types_cannot_bypass_archived_creation_guard(self):
        owner, org = self.workspace()
        event = self.call(owner, "POST", "/api/v1/events", {"organization_id": org["id"], "title": "JSON scope", "start_at": "2027-01-05T09:00:00+02:00", "end_at": "2027-01-05T17:00:00+02:00"}, 201)
        self.archive(owner, org)
        before = self.snapshot_records(org['id'])
        for media_type in (None, 'application/vnd.fieldops+json', 'Application/JSON; charset=utf-8'):
            for path, payload in (
                ('/api/v1/events', {'organization_id': org['id'], 'title': 'Blocked', 'start_at': '2027-01-05T09:00:00+02:00', 'end_at': '2027-01-05T17:00:00+02:00'}),
                ('/api/v1/participants', {'organization_id': org['id'], 'full_name': 'Blocked'}),
                ('/api/v1/tasks', {'event_id': event['id'], 'title': 'Blocked', 'priority': 'high'}),
            ):
                with self.subTest(media_type=media_type, path=path):
                    headers = {'Authorization': f"Bearer {owner['token']}"}
                    if media_type:
                        headers['Content-Type'] = media_type
                    response = self.client.post(path, content=json.dumps(payload), headers=headers)
                    self.assertEqual(response.status_code, 409, response.text[:300])
        self.assertEqual(self.snapshot_records(org['id']), before)
