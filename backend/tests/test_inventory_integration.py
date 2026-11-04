"""Inventory HTTP contracts against an explicitly isolated PostgreSQL database.

Authentication is exercised through real registration/login. The shared Day 9
runner validates the API database identity before any fixtures are written.
"""

import json
import threading
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

import httpx
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import Session

import test_day9_integration as day9
import test_onboarding_integration as onboarding


CATEGORIES = "/api/v1/inventory/categories"


class InventoryPostgreSQLIntegration(unittest.TestCase):
    setUpClass = classmethod(day9.Day9PostgreSQLIntegration.setUpClass.__func__)
    shutdown_server = classmethod(day9.Day9PostgreSQLIntegration.shutdown_server.__func__)
    expect = classmethod(day9.Day9PostgreSQLIntegration.expect.__func__)
    actor = onboarding.OnboardingPostgreSQLIntegration.actor
    call = onboarding.OnboardingPostgreSQLIntegration.call
    workspace = onboarding.OnboardingPostgreSQLIntegration.workspace

    def category_rows(self, organization_id):
        engine = create_engine(self.database_url)
        try:
            with engine.connect() as connection:
                return connection.execute(text(
                    "SELECT id, organization_id, name, description, created_at "
                    "FROM inventory_categories WHERE organization_id=:org ORDER BY name"
                ), {"org": uuid.UUID(organization_id)}).mappings().all()
        finally:
            engine.dispose()

    def category(self, owner, organization, name=None, expected=201, **overrides):
        return self.call(owner, "POST", CATEGORIES, {
            "organization_id": organization["id"],
            "name": name or f"Category {uuid.uuid4().hex}",
            **overrides,
        }, expected)

    def archive(self, owner, organization, action="archive"):
        return self.call(owner, "POST", f"/organizations/{organization['id']}/{action}",
                         {"confirmation_name": organization["name"]})

    def test_owner_admin_create_and_response_is_persisted(self):
        owner, organization = self.workspace()
        admin = self.actor()
        self.call(owner, "POST", f"/organizations/{organization['id']}/members",
                  {"email": admin["email"], "role": "Admin"}, 201)
        created = self.category(owner, organization, "  Camping equipment \t", description="Tents")
        self.assertEqual(set(created), {"id", "organization_id", "name", "description", "created_at"})
        uuid.UUID(created["id"])
        self.assertEqual(created["organization_id"], organization["id"])
        self.assertEqual(created["name"], "Camping equipment")
        self.assertEqual(created["description"], "Tents")
        self.assertIsNotNone(datetime.fromisoformat(created["created_at"]).tzinfo)
        admin_created = self.category(admin, organization, "Admin supplies")
        self.assertIsNone(admin_created["description"])
        rows = self.category_rows(organization["id"])
        self.assertEqual({str(row["id"]) for row in rows}, {created["id"], admin_created["id"]})

    def test_authentication_and_all_nonadministrative_roles_are_denied(self):
        owner, organization = self.workspace()
        payload = {"organization_id": organization["id"], "name": "Forbidden"}
        self.call(None, "POST", CATEGORIES, payload, 401)
        response = self.client.post(CATEGORIES, json=payload,
                                    headers={"Authorization": "Bearer invalid-token"})
        self.assertEqual(response.status_code, 401)
        for role in ("Member", "Viewer", "Treasurer", "Logistics"):
            with self.subTest(role=role):
                actor = self.actor()
                self.call(owner, "POST", f"/organizations/{organization['id']}/members",
                          {"email": actor["email"], "role": role}, 201)
                self.category(actor, organization, expected=403)
        self.assertEqual(self.category_rows(organization["id"]), [])

    def test_cross_organization_unknown_and_inactive_membership_are_hidden(self):
        owner, organization = self.workspace()
        outsider, other = self.workspace()
        self.category(outsider, organization, expected=404)
        self.category(owner, other, expected=404)
        self.category(owner, {"id": str(uuid.uuid4())}, expected=404)
        engine = create_engine(self.database_url)
        try:
            with engine.begin() as connection:
                connection.execute(text(
                    "UPDATE memberships SET status='inactive' "
                    "WHERE organization_id=:org AND user_id=:owner"
                ), {"org": uuid.UUID(organization["id"]), "owner": uuid.UUID(owner["id"])})
            self.category(owner, organization, expected=404)
        finally:
            engine.dispose()
        self.assertEqual(self.category_rows(organization["id"]), [])
        self.assertEqual(self.category_rows(other["id"]), [])

    def test_legacy_lowercase_role_is_not_implicitly_elevated(self):
        owner, organization = self.workspace()
        engine = create_engine(self.database_url)
        try:
            with engine.begin() as connection:
                connection.execute(text(
                    "UPDATE memberships SET role='owner' "
                    "WHERE organization_id=:org AND user_id=:owner"
                ), {"org": uuid.UUID(organization["id"]), "owner": uuid.UUID(owner["id"])})
            self.category(owner, organization, expected=403)
            with engine.connect() as connection:
                self.assertEqual(connection.scalar(text(
                    "SELECT role FROM memberships WHERE organization_id=:org AND user_id=:owner"
                ), {"org": uuid.UUID(organization["id"]), "owner": uuid.UUID(owner["id"])}), "owner")
        finally:
            engine.dispose()

    def test_duplicates_are_trimmed_but_case_sensitive_and_organization_scoped(self):
        owner, organization = self.workspace()
        other_owner, other = self.workspace()
        self.category(owner, organization, "Camping")
        self.category(owner, organization, "Camping", expected=409)
        self.category(owner, organization, " \tCamping\n", expected=409)
        self.category(owner, organization, "camping")
        self.category(other_owner, other, "Camping")
        self.assertEqual({row["name"] for row in self.category_rows(organization["id"])}, {"Camping", "camping"})
        self.assertEqual([row["name"] for row in self.category_rows(other["id"])], ["Camping"])

    def test_invalid_inputs_return_422_without_writing(self):
        owner, organization = self.workspace()
        valid = {"organization_id": organization["id"], "name": "Valid"}
        invalid = [
            {}, {"name": "Missing organization"}, {"organization_id": organization["id"]},
            {**valid, "organization_id": "invalid"}, {**valid, "organization_id": None},
            {**valid, "name": None}, {**valid, "name": ""}, {**valid, "name": "   "},
            {**valid, "name": "\t\n"}, {**valid, "name": "x" * 101},
            {**valid, "description": "x" * 501}, {**valid, "name": 5},
            {**valid, "name": {}}, {**valid, "description": 5},
            {**valid, "name": "bad\x00name"}, {**valid, "description": "bad\x00description"}, [],
        ]
        for index, payload in enumerate(invalid):
            with self.subTest(case=index):
                self.call(owner, "POST", CATEGORIES, payload, 422)
        response = self.client.post(CATEGORIES, content="{",
                                    headers={"Authorization": f"Bearer {owner['token']}",
                                             "Content-Type": "application/json"})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(self.category_rows(organization["id"]), [])
        self.category(owner, organization, " " + "x" * 100 + " ", description="d" * 500)

    def test_archived_creation_is_blocked_and_restore_reenables_creation(self):
        owner, organization = self.workspace()
        before = self.category(owner, organization, "Before archive")
        admin = self.actor()
        self.call(owner, "POST", f"/organizations/{organization['id']}/members",
                  {"email": admin["email"], "role": "Admin"}, 201)
        self.archive(owner, organization)
        self.category(owner, organization, "After archive", expected=409)
        self.category(admin, organization, "Admin after archive", expected=409)
        self.assertEqual([str(row["id"]) for row in self.category_rows(organization["id"])], [before["id"]])
        self.archive(owner, organization, "restore")
        self.category(owner, organization, "After restore")
        self.assertEqual(len(self.category_rows(organization["id"])), 2)

    def test_archived_canonical_body_scope_cannot_be_spoofed_by_query_or_media_type(self):
        owner, archived = self.workspace()
        _, active = self.workspace(owner=owner)
        self.archive(owner, archived)
        for media_type in (None, "application/json", "application/vnd.fieldops+json",
                           "Application/JSON; charset=utf-8"):
            with self.subTest(media_type=media_type):
                headers = {"Authorization": f"Bearer {owner['token']}"}
                if media_type:
                    headers["Content-Type"] = media_type
                response = self.client.post(CATEGORIES + f"?organization_id={active['id']}",
                    content=json.dumps({"organization_id": archived["id"], "name": "Blocked",
                                        "event_id": str(uuid.uuid4())}), headers=headers)
                self.assertEqual(response.status_code, 409, response.text[:300])
        self.assertEqual(self.category_rows(archived["id"]), [])
        response = self.client.post(CATEGORIES + f"?organization_id={archived['id']}",
            json={"organization_id": active["id"], "name": "Active body wins"},
            headers={"Authorization": f"Bearer {owner['token']}"})
        self.assertEqual(response.status_code, 201, response.text[:300])

    def test_concurrent_archive_and_category_creation_preserve_workspace_locking(self):
        for _ in range(3):
            owner, organization = self.workspace()
            barrier = threading.Barrier(2)
            payload = {"organization_id": organization["id"], "name": "Concurrent category"}

            def invoke(job):
                path, body = job
                with httpx.Client(base_url=self.client.base_url, timeout=20, trust_env=False) as client:
                    barrier.wait(timeout=10)
                    return client.post(path, json=body,
                                       headers={"Authorization": f"Bearer {owner['token']}"})

            with ThreadPoolExecutor(max_workers=2) as executor:
                write, archive = list(executor.map(invoke, [
                    (CATEGORIES, payload),
                    (f"/organizations/{organization['id']}/archive",
                     {"confirmation_name": organization["name"]}),
                ]))
            self.assertEqual(archive.status_code, 200, archive.text[:300])
            self.assertIn(write.status_code, {201, 409}, write.text[:300])
            rows = self.category_rows(organization["id"])
            self.assertEqual(len(rows), 1 if write.status_code == 201 else 0)
            self.category(owner, organization, "After completed archive", expected=409)
            self.assertEqual(len(self.category_rows(organization["id"])), len(rows))

    def test_concurrent_duplicate_creation_returns_one_201_and_one_409(self):
        owner, organization = self.workspace()
        barrier = threading.Barrier(2)
        payload = {"organization_id": organization["id"], "name": "Concurrent duplicate"}

        def invoke(_):
            with httpx.Client(base_url=self.client.base_url, timeout=20, trust_env=False) as client:
                barrier.wait(timeout=10)
                return client.post(CATEGORIES, json=payload,
                                   headers={"Authorization": f"Bearer {owner['token']}"})

        with ThreadPoolExecutor(max_workers=2) as executor:
            responses = list(executor.map(invoke, range(2)))
        self.assertEqual(sorted(response.status_code for response in responses), [201, 409])
        self.assertEqual(len(self.category_rows(organization["id"])), 1)

    def test_actual_application_registration_uses_shared_guard_and_real_authentication(self):
        from fastapi.testclient import TestClient
        from app.database import get_db, engine as development_engine
        from app.main import app

        # Exercise the registered application rather than inspecting FastAPI's
        # route list, which may contain lazily included router placeholders.
        engine = create_engine(self.database_url)
        previous_overrides = app.dependency_overrides.copy()

        def isolated_db():
            with Session(engine, autoflush=False) as db:
                yield db

        def forbid_development_connection(*_args, **_kwargs):
            raise AssertionError("Inventory tests must never connect to the development engine")

        try:
            with engine.connect() as connection:
                self.assertEqual(connection.scalar(text("SELECT current_database()")), self.database_url.database)
            app.dependency_overrides[get_db] = isolated_db
            event.listen(development_engine, "do_connect", forbid_development_connection)
            with TestClient(app) as client:
                suffix = uuid.uuid4().hex
                email = f"inventory-production-{suffix}@example.com"
                password = "Inventory!" + suffix
                response = client.post("/auth/register", json={"name": "Inventory production route",
                                                              "email": email, "password": password})
                self.assertEqual(response.status_code, 201)
                response = client.post("/auth/login", json={"email": email, "password": password})
                self.assertEqual(response.status_code, 200)
                headers = {"Authorization": f"Bearer {response.json()['access_token']}"}
                response = client.post("/organizations", json={"name": f"Inventory production {suffix}"},
                                       headers=headers)
                self.assertEqual(response.status_code, 201)
                organization = response.json()
                response = client.post(CATEGORIES, json={"organization_id": organization["id"],
                                                         "name": "Unauthenticated"})
                self.assertEqual(response.status_code, 401)
                response = client.post(CATEGORIES, json={"organization_id": organization["id"],
                                                         "name": "Production active"}, headers=headers)
                self.assertEqual(response.status_code, 201)
                response = client.post(f"/organizations/{organization['id']}/archive",
                                       json={"confirmation_name": organization["name"]}, headers=headers)
                self.assertEqual(response.status_code, 200)
                response = client.post(CATEGORIES, json={"organization_id": organization["id"],
                                                         "name": "Production archived"}, headers=headers)
                self.assertEqual(response.status_code, 409)
                self.assertEqual(len(self.category_rows(organization["id"])), 1)
        finally:
            app.dependency_overrides.clear()
            app.dependency_overrides.update(previous_overrides)
            if event.contains(development_engine, "do_connect", forbid_development_connection):
                event.remove(development_engine, "do_connect", forbid_development_connection)
            engine.dispose()


if __name__ == "__main__":
    unittest.main(verbosity=2)
