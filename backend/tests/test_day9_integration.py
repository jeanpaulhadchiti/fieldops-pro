"""Real HTTP + PostgreSQL integration tests; no fake repositories or auth bypass.

From backend:
    .venv/Scripts/python.exe -B -m unittest discover -s tests -p test_day9_integration.py -v

FIELDOPS_TEST_DATABASE_URL is mandatory and safety-validated. By default this
suite starts/stops its own loopback uvicorn process. To reuse an already running
isolated server, set FIELDOPS_TEST_API_BASE_URL to its local HTTP address. Tests
verify the server's exact test database name before creating any records.
"""

import os
import secrets
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import uuid
from pathlib import Path
from urllib.parse import urlsplit

import httpx

from day9_server import validated_database_url


class Day9PostgreSQLIntegration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.database_url = validated_database_url(os.environ.get("FIELDOPS_TEST_DATABASE_URL"))
        cls.process = None
        cls.server_log = None
        cls.client = None
        cls.addClassCleanup(cls.shutdown_server)
        base_url = os.environ.get("FIELDOPS_TEST_API_BASE_URL")
        if base_url:
            parsed = urlsplit(base_url)
            if parsed.scheme != "http" or parsed.hostname not in {"localhost", "127.0.0.1", "::1"}:
                raise RuntimeError("Test API address must use local HTTP")
            if parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in {"", "/"}:
                raise RuntimeError("Test API address must contain only its local host and port")
        else:
            with socket.socket() as listener:
                listener.bind(("127.0.0.1", 0))
                port = listener.getsockname()[1]
            base_url = f"http://127.0.0.1:{port}"
            cls.server_log = tempfile.TemporaryFile(mode="w+b")
            cls.process = subprocess.Popen(
                [sys.executable, "-B", "-m", "uvicorn", "day9_server:create_app", "--factory",
                 "--app-dir", "tests", "--host", "127.0.0.1", "--port", str(port), "--log-level", "warning"],
                cwd=Path(__file__).resolve().parents[1],
                env=os.environ.copy(), stdout=cls.server_log, stderr=cls.server_log,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
            )
        cls.client = httpx.Client(base_url=base_url, timeout=15, trust_env=False)
        deadline = time.monotonic() + 30
        while True:
            try:
                response = cls.client.get("/health")
                response.raise_for_status()
                health = response.json()
                break
            except (httpx.HTTPError, ValueError):
                if cls.process is not None and cls.process.poll() is not None:
                    raise RuntimeError("The isolated test API exited before becoming ready")
                if time.monotonic() >= deadline:
                    raise RuntimeError("The isolated test API did not become ready within 30 seconds")
                time.sleep(0.1)
        if health.get("test_database") != cls.database_url.database or health.get("database_type") != "postgresql":
            raise RuntimeError("API is not connected to the explicitly configured isolated PostgreSQL database; no writes performed")

        cls.run_id = uuid.uuid4().hex[:12]
        cls.accounts = {}
        for role in ("owner", "member", "viewer", "outsider", "admin"):
            email = f"day9-{cls.run_id}-{role}@example.com"
            password = "A!" + secrets.token_urlsafe(24)
            response = cls.client.post("/auth/register", json={"name": f"Day 9 {role}", "email": email, "password": password})
            if response.status_code != 201:
                raise AssertionError(f"Synthetic account registration failed ({response.status_code})")
            profile = response.json()
            login = cls.client.post("/auth/login", json={"email": email, "password": password})
            if login.status_code != 200:
                raise AssertionError(f"Synthetic account login failed ({login.status_code})")
            cls.accounts[role] = {"id": profile["id"], "token": login.json()["access_token"], "email": email}

        cls.organization = cls.expect("POST", "/organizations", role="owner", expected=201,
                                      payload={"name": f"Day 9 integration {cls.run_id}"})
        cls.other_organization = cls.expect("POST", "/organizations", role="outsider", expected=201,
                                            payload={"name": f"Day 9 other {cls.run_id}"})
        for role, permission in (("member", "Member"), ("viewer", "Viewer"), ("admin", "Admin")):
            cls.expect("POST", f"/organizations/{cls.organization['id']}/members", expected=201,
                       payload={"email": cls.accounts[role]["email"], "role": permission})

    @classmethod
    def shutdown_server(cls):
        if cls.client is not None:
            cls.client.close()
        if cls.process is not None:
            cls.process.terminate()
            try:
                cls.process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                cls.process.kill()
                cls.process.wait(timeout=5)
        if cls.server_log is not None:
            cls.server_log.close()

    @classmethod
    def expect(cls, method, path, role="owner", expected=200, payload=None, client=None):
        response = (client or cls.client).request(
            method, path, json=payload,
            headers={"Authorization": f"Bearer {cls.accounts[role]['token']}"} if role else {},
        )
        if response.status_code != expected:
            # Requests and credentials are deliberately excluded from failures.
            raise AssertionError(f"{method} {path} returned {response.status_code}, expected {expected}: {response.text[:500]}")
        return None if response.status_code == 204 else response.json()

    def event(self, role="owner", organization_id=None, capacity=None):
        return self.expect("POST", "/api/v1/events", role=role, expected=201, payload={
            "organization_id": organization_id or self.organization["id"],
            "title": f"Integration event {uuid.uuid4().hex[:8]}",
            "description": "Isolated PostgreSQL integration fixture",
            "start_at": "2027-01-05T09:00:00+02:00", "end_at": "2027-01-05T17:00:00+02:00",
            "capacity": capacity,
        })

    def participant(self, role="owner", organization_id=None):
        return self.expect("POST", "/api/v1/participants", role=role, expected=201, payload={
            "organization_id": organization_id or self.organization["id"],
            "full_name": f"Integration participant {uuid.uuid4().hex[:8]}",
        })

    def task(self, event_id):
        return self.expect("POST", "/api/v1/tasks", expected=201, payload={
            "event_id": event_id, "title": "Prepare the venue", "priority": "high",
            "due_at": "2027-01-04T15:00:00+02:00",
        })

    def registration(self, event_id, participant_id, fee_required=False):
        return self.expect("POST", "/api/v1/registrations", expected=201, payload={
            "event_id": event_id, "participant_id": participant_id, "fee_required": fee_required,
        })

    def test_authentication_and_real_membership_scope(self):
        self.expect("GET", "/auth/me", role=None, expected=401)
        response = self.client.get("/auth/me", headers={"Authorization": "Bearer invalid-token"})
        self.assertEqual(response.status_code, 401)
        profile = self.expect("GET", "/auth/me")
        self.assertEqual(profile["id"], self.accounts["owner"]["id"])
        orgs = self.expect("GET", "/organizations", role="member")
        self.assertIn(self.organization["id"], [org["id"] for org in orgs])
        self.assertNotIn(self.other_organization["id"], [org["id"] for org in orgs])
        members = self.expect("GET", f"/organizations/{self.organization['id']}/members", role="member")
        self.assertTrue(any(member["user_id"] == self.accounts["member"]["id"] and member["role"] == "Member" for member in members))

    def test_participant_creation_validation_listing_and_rbac(self):
        participant = self.participant()
        listed = self.expect("GET", f"/api/v1/participants?organization_id={self.organization['id']}", role="viewer")
        self.assertIn(participant["id"], [row["id"] for row in listed])
        self.assertTrue(all(row["organization_id"] == self.organization["id"] for row in listed))
        for role in ("member", "viewer"):
            self.expect("POST", "/api/v1/participants", role=role, expected=403,
                        payload={"organization_id": self.organization["id"], "full_name": "Unauthorized"})
        self.expect("POST", "/api/v1/participants", expected=422,
                    payload={"organization_id": self.organization["id"], "full_name": "   "})
        self.expect("GET", f"/api/v1/participants?organization_id={self.organization['id']}", role="outsider", expected=404)

    def test_registration_duplicate_capacity_cancellation_and_payment(self):
        event = self.event(capacity=1)
        first = self.participant()
        second = self.participant()
        registration = self.registration(event["id"], first["id"], fee_required=True)
        self.assertEqual(registration["status"], "registered")
        self.assertEqual(registration["payment_status"], "unpaid")
        self.expect("POST", "/api/v1/registrations", expected=409,
                    payload={"event_id": event["id"], "participant_id": first["id"]})
        self.expect("POST", "/api/v1/registrations", expected=409,
                    payload={"event_id": event["id"], "participant_id": second["id"]})
        for status in ("partial", "paid"):
            paid = self.expect("PATCH", f"/api/v1/registrations/{registration['id']}/payment", payload={"payment_status": status})
            self.assertEqual(paid["payment_status"], status)
        self.expect("PATCH", f"/api/v1/registrations/{registration['id']}/cancel")
        self.expect("PATCH", f"/api/v1/registrations/{registration['id']}/cancel")
        self.expect("PATCH", f"/api/v1/registrations/{registration['id']}/payment", expected=409, payload={"payment_status": "unpaid"})
        self.expect("POST", "/api/v1/registrations", expected=409,
                    payload={"event_id": event["id"], "participant_id": first["id"]})
        next_registration = self.registration(event["id"], second["id"])
        self.assertIsNone(next_registration["payment_status"])
        self.expect("PATCH", f"/api/v1/registrations/{next_registration['id']}/payment", expected=409, payload={"payment_status": "paid"})

    def test_attendance_requires_active_event_and_cannot_cancel_attended_registration(self):
        event = self.event()
        participant = self.participant()
        registration = self.registration(event["id"], participant["id"])
        path = f"/api/v1/registrations/{registration['id']}/attendance"
        self.expect("PATCH", path, expected=409)
        self.expect("PATCH", f"/api/v1/events/{event['id']}/status", payload={"status": "active"})
        self.expect("PATCH", path, role="member", expected=403)
        checked_in = self.expect("PATCH", path)
        self.assertIsNotNone(checked_in["attended_at"])
        repeated = self.expect("PATCH", path)
        self.assertEqual(repeated["attended_at"], checked_in["attended_at"])
        self.expect("PATCH", f"/api/v1/registrations/{registration['id']}/cancel", expected=409)
        self.expect("PATCH", path, role="outsider", expected=404)

    def test_registration_rejects_cross_organization_participant_and_unauthorized_mutations(self):
        event = self.event()
        other_participant = self.participant(role="outsider", organization_id=self.other_organization["id"])
        payload = {"event_id": event["id"], "participant_id": other_participant["id"]}
        self.expect("POST", "/api/v1/registrations", expected=404, payload=payload)
        self.expect("POST", "/api/v1/registrations", role="member", expected=403, payload=payload)
        self.expect("GET", f"/api/v1/registrations?event_id={event['id']}", role="outsider", expected=404)
        participant = self.participant()
        registration = self.registration(event["id"], participant["id"], True)
        for suffix, body in (("cancel", None), ("payment", {"payment_status": "paid"})):
            self.expect("PATCH", f"/api/v1/registrations/{registration['id']}/{suffix}", role="viewer", expected=403, payload=body)

    def test_task_edit_assignment_status_permissions_and_removal(self):
        event = self.event()
        task = self.task(event["id"])
        self.assertEqual(task["status"], "todo")
        changed = self.expect("PATCH", f"/api/v1/tasks/{task['id']}", payload={
            "title": "Updated venue plan", "description": "Confirm the keys", "priority": "low", "due_at": None,
        })
        self.assertEqual(changed["title"], "Updated venue plan")
        self.assertIsNone(changed["due_at"])
        self.expect("PATCH", f"/api/v1/tasks/{task['id']}", role="member", expected=403, payload={"title": "Denied"})
        self.expect("PATCH", f"/api/v1/tasks/{task['id']}/status", role="member", expected=403, payload={"status": "in_progress"})
        assignment = self.expect("POST", "/api/v1/task-assignments", expected=201,
                                 payload={"task_id": task["id"], "user_id": self.accounts["member"]["id"]})
        self.expect("POST", "/api/v1/task-assignments", expected=409,
                    payload={"task_id": task["id"], "user_id": self.accounts["member"]["id"]})
        assignments = self.expect("GET", f"/api/v1/task-assignments?task_id={task['id']}", role="member")
        self.assertIn(assignment["id"], [row["id"] for row in assignments])
        for status in ("in_progress", "done"):
            updated = self.expect("PATCH", f"/api/v1/tasks/{task['id']}/status", role="member", payload={"status": status})
            self.assertEqual(updated["status"], status)
        mine = self.expect("GET", "/api/v1/tasks/my", role="member")
        self.assertIn(task["id"], [row["id"] for row in mine])
        self.expect("DELETE", f"/api/v1/task-assignments/{assignment['id']}", role="member", expected=403)
        self.expect("DELETE", f"/api/v1/task-assignments/{assignment['id']}", expected=204)
        self.expect("PATCH", f"/api/v1/tasks/{task['id']}/status", role="member", expected=403, payload={"status": "todo"})

    def test_task_assignment_eligibility_viewer_restriction_and_tenant_isolation(self):
        event = self.event()
        task = self.task(event["id"])
        for user_id in (self.accounts["outsider"]["id"], str(uuid.uuid4())):
            self.expect("POST", "/api/v1/task-assignments", expected=400, payload={"task_id": task["id"], "user_id": user_id})
        self.expect("POST", "/api/v1/task-assignments", role="member", expected=403,
                    payload={"task_id": task["id"], "user_id": self.accounts["member"]["id"]})
        self.expect("POST", "/api/v1/task-assignments", expected=201,
                    payload={"task_id": task["id"], "user_id": self.accounts["viewer"]["id"]})
        self.expect("PATCH", f"/api/v1/tasks/{task['id']}/status", role="viewer", expected=403, payload={"status": "done"})
        self.expect("GET", f"/api/v1/tasks?event_id={event['id']}", role="outsider", expected=404)
        self.expect("GET", f"/api/v1/task-assignments?task_id={task['id']}", role="outsider", expected=404)
        self.expect("PATCH", f"/api/v1/tasks/{task['id']}", role="outsider", expected=404, payload={"title": "Denied"})
        self.expect("POST", "/api/v1/tasks", role="viewer", expected=403, payload={"event_id": event["id"], "title": "Denied"})

    def test_admin_can_manage_day9_resources_and_completed_events_reject_registrations(self):
        event = self.event()
        participant = self.participant(role="admin")
        task = self.expect("POST", "/api/v1/tasks", role="admin", expected=201,
                           payload={"event_id": event["id"], "title": "Admin task"})
        self.expect("PATCH", f"/api/v1/tasks/{task['id']}", role="admin", payload={"priority": "high"})
        self.expect("PATCH", f"/api/v1/events/{event['id']}/status", payload={"status": "active"})
        self.expect("PATCH", f"/api/v1/events/{event['id']}/status", payload={"status": "completed"})
        self.expect("POST", "/api/v1/registrations", expected=409,
                    payload={"event_id": event["id"], "participant_id": participant["id"]})

    def test_saved_resources_survive_fresh_http_client_reads(self):
        event = self.event()
        participant = self.participant()
        registration = self.registration(event["id"], participant["id"])
        task = self.task(event["id"])
        assignment = self.expect("POST", "/api/v1/task-assignments", expected=201,
                                 payload={"task_id": task["id"], "user_id": self.accounts["member"]["id"]})
        with httpx.Client(base_url=self.client.base_url, timeout=15, trust_env=False) as fresh:
            loaded_event = self.expect("GET", f"/api/v1/events/{event['id']}", client=fresh)
            participants = self.expect("GET", f"/api/v1/participants?organization_id={self.organization['id']}", client=fresh)
            registrations = self.expect("GET", f"/api/v1/registrations?event_id={event['id']}", client=fresh)
            tasks = self.expect("GET", f"/api/v1/tasks?event_id={event['id']}", client=fresh)
            assignments = self.expect("GET", f"/api/v1/task-assignments?task_id={task['id']}", client=fresh)
        self.assertEqual(loaded_event["title"], event["title"])
        self.assertIn(participant["id"], [row["id"] for row in participants])
        self.assertIn(registration["id"], [row["id"] for row in registrations])
        self.assertIn(task["id"], [row["id"] for row in tasks])
        self.assertIn(assignment["id"], [row["id"] for row in assignments])


if __name__ == "__main__":
    unittest.main(verbosity=2)
