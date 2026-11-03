"""Real HTTP/PostgreSQL onboarding security and concurrency acceptance tests.

Run from backend with the mandatory local FIELDOPS_TEST_DATABASE_URL. Inherits
the nine Day 9 checks. Accounts and organizations are synthetic and confined to
the safety-validated disposable database; development data is never modified.
"""

import secrets
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor

import httpx
from sqlalchemy import create_engine, text

import test_day9_integration as day9


class OnboardingPostgreSQLIntegration(day9.Day9PostgreSQLIntegration):
    def actor(self):
        suffix = uuid.uuid4().hex[:12]
        values = {"name": f"Onboarding {suffix}", "email": f"onboarding-{suffix}@example.com", "password": "A!" + secrets.token_urlsafe(24)}
        profile = self.call(None, "POST", "/auth/register", values, 201)
        auth = self.call(None, "POST", "/auth/login", {"email": values["email"], "password": values["password"]})
        return {**values, "id": profile["id"], "token": auth["access_token"]}

    def call(self, actor, method, path, payload=None, expected=200):
        response = self.client.request(method, path, json=payload,
            headers={"Authorization": f"Bearer {actor['token']}"} if actor else {})
        self.assertEqual(response.status_code, expected, f"{method} {path}: {response.text[:500]}")
        return None if response.status_code == 204 else response.json()

    def workspace(self, owner=None, **overrides):
        owner = owner or self.actor()
        values = {"name": f"Discovery {uuid.uuid4().hex[:12]}", "organization_type": "NGO",
                  "country": "Lebanon", "city": "Beirut", "description": "Internal description must not appear in search",
                  "is_discoverable": True, "allow_possible_duplicate": True, **overrides}
        return owner, self.call(owner, "POST", "/organizations", values, 201)

    def join(self, actor, organization, message="Please review my membership request", expected=201):
        return self.call(actor, "POST", f"/organizations/{organization['id']}/join-requests", {"message": message}, expected)

    def review(self, reviewer, organization, request, decision="approve", expected=200):
        return self.call(reviewer, "PATCH", f"/organizations/{organization['id']}/join-requests/{request['id']}", {"decision": decision}, expected)

    def race(self, jobs):
        barrier = threading.Barrier(len(jobs))
        def invoke(job):
            actor, method, path, payload = job
            with httpx.Client(base_url=self.client.base_url, timeout=20, trust_env=False) as client:
                barrier.wait(timeout=10)
                return client.request(method, path, json=payload, headers={"Authorization": f"Bearer {actor['token']}"})
        with ThreadPoolExecutor(max_workers=len(jobs)) as executor:
            return list(executor.map(invoke, jobs))

    def test_signup_has_no_automatic_organization_access_and_rejects_duplicate_email(self):
        actor = self.actor()
        self.assertEqual(self.call(actor, "GET", "/organizations"), [])
        self.call(actor, "GET", f"/organizations/{self.organization['id']}", expected=404)
        self.call(None, "POST", "/auth/register", {"name": "Another user", "email": actor["email"].upper(), "password": "A!" + secrets.token_urlsafe(24)}, 400)
        self.assertEqual(self.call(actor, "GET", "/auth/me")["name"], actor["name"])

    def test_signup_server_validates_required_name_and_password_bounds(self):
        for name, password in (("   ", "long enough password"), ("N" * 121, "long enough password"), ("Valid person", "short"), ("Valid person", "x" * 129), ("Valid person", " " * 12)):
            with self.subTest(name_length=len(name), password_length=len(password)):
                self.call(None, "POST", "/auth/register", {"name": name, "email": f"invalid-{uuid.uuid4().hex}@example.com", "password": password}, 422)
        # A stronger policy for new signups must not lock out a historical
        # account with a shorter password. Seed only this disposable database.
        from app.security import hash_password
        email = f"legacy-{uuid.uuid4().hex}@example.com"
        engine = create_engine(self.database_url)
        try:
            with engine.begin() as connection:
                connection.execute(text("INSERT INTO users (id,name,email,password_hash) VALUES (:id,:name,:email,:password_hash)"),
                    {"id": uuid.uuid4(), "name": "Historical test account", "email": email, "password_hash": hash_password("legacy1")})
            result = self.call(None, "POST", "/auth/login", {"email": email, "password": "legacy1"})
            self.assertEqual(result["token_type"], "bearer")
        finally:
            engine.dispose()

    def test_creation_assigns_owner_and_defaults_legacy_name_only_request_to_private(self):
        actor = self.actor()
        organization = self.call(actor, "POST", "/organizations", {"name": "  New   private workspace  "}, 201)
        self.assertEqual(organization["name"], "New private workspace")
        self.assertFalse(organization["is_discoverable"])
        self.assertEqual(organization["organization_type"], "Other")
        members = self.call(actor, "GET", f"/organizations/{organization['id']}/members")
        self.assertEqual([(member["user_id"], member["role"], member["status"]) for member in members], [(actor["id"], "Owner", "active")])
        self.call(actor, "POST", "/organizations", {"name": "Forged owner", "role": "Owner", "user_id": self.accounts["outsider"]["id"]}, 422)
        description = "First line.\n  Second line preserves spaces."
        saved = self.call(actor, "PATCH", f"/organizations/{organization['id']}/settings", {"description": "  " + description + "  "})
        self.assertEqual(saved["description"], description)
        created = self.call(actor, "POST", "/organizations", {"name": f"{uuid.uuid4().hex[:12]} multiline description", "description": description}, 201)
        self.assertEqual(created["description"], description)

    def test_discovery_normalizes_case_accents_and_whitespace_and_exposes_only_public_card(self):
        owner, organization = self.workspace(name=f"Groupe Sainte Ríta {uuid.uuid4().hex[:6]}")
        visitor = self.actor()
        search = "  GROUPE   SAINTE RITA " + organization["name"].split()[-1]
        result = self.call(visitor, "GET", "/organizations/discover?q=" + search)
        card = next(card for card in result["matches"] if card["id"] == organization["id"])
        self.assertEqual(card["match_kind"], "exact")
        self.assertEqual(set(card), {"id", "name", "organization_type", "organization_type_other", "country", "city", "match_kind"})
        self.assertNotIn(owner["email"], str(result))
        self.assertNotIn(organization["description"], str(result))
        self.call(visitor, "GET", f"/organizations/{organization['id']}/members", expected=404)

    def test_private_organizations_never_influence_discovery_or_duplicate_creation_warning(self):
        owner, organization = self.workspace(name=f"{uuid.uuid4().hex} Confidential staff unit", is_discoverable=False)
        visitor = self.actor()
        self.assertNotIn(organization["id"], [match["id"] for match in self.call(visitor, "GET", f"/organizations/discover?q={organization['name']}")["matches"]])
        self.call(visitor, "GET", f"/organizations/{organization['id']}", expected=404)
        self.call(visitor, "POST", f"/organizations/{organization['id']}/join-requests", {}, 404)
        distinct = self.call(visitor, "POST", "/organizations", {"name": organization["name"]}, 201)
        self.assertNotEqual(distinct["id"], organization["id"])
        self.assertEqual(self.call(owner, "GET", f"/organizations/{organization['id']}")["name"], organization["name"])

    def test_duplicate_warning_requires_explicit_acknowledgement_but_same_name_can_be_distinct(self):
        _, organization = self.workspace()
        visitor = self.actor()
        payload = {"name": organization["name"], "organization_type": "Sports Club", "country": "France", "city": "Paris"}
        warning = self.call(visitor, "POST", "/organizations", payload, 409)["detail"]
        self.assertEqual(warning["code"], "possible_duplicate")
        self.assertIn(organization["id"], [row["id"] for row in warning["matches"]])
        self.assertEqual(self.call(visitor, "GET", "/organizations"), [])
        distinct = self.call(visitor, "POST", "/organizations", {**payload, "allow_possible_duplicate": True}, 201)
        self.assertNotEqual(distinct["id"], organization["id"])
        self.assertEqual(distinct["organization_type"], "Sports Club")
        self.assertEqual(distinct["city"], "Paris")

    def test_similar_suggestions_and_concurrent_same_name_public_creation_are_safe(self):
        _, organization = self.workspace(name=f"Sainte Rita {uuid.uuid4().hex[:8]}")
        visitor = self.actor()
        similar = self.call(visitor, "GET", "/organizations/discover?q=" + organization["name"].replace("Rita", "Ritah"))
        self.assertIn(organization["id"], [match["id"] for match in similar["matches"]])
        normalized_variant = "  " + organization["name"].upper().replace("RITA", "RÍTA").replace(" ", "   ") + "  "
        self.call(visitor, "POST", "/organizations", {"name": normalized_variant}, 409)
        first, second = self.actor(), self.actor()
        payload = {"name": f"{uuid.uuid4().hex[:12]} simultaneous public group", "is_discoverable": True}
        responses = self.race([(first, "POST", "/organizations", payload), (second, "POST", "/organizations", payload)])
        self.assertEqual(sorted(response.status_code for response in responses), [201, 409])
        owners = sum(len(self.call(actor, "GET", "/organizations")) for actor in (first, second))
        self.assertEqual(owners, 1)

    def test_discovery_filters_bound_results_and_require_authenticated_nontrivial_search(self):
        _, organization = self.workspace()
        visitor = self.actor()
        self.call(None, "GET", f"/organizations/discover?q={organization['name']}", expected=401)
        self.call(visitor, "GET", "/organizations/discover?q=ab", expected=422)
        self.call(visitor, "GET", "/organizations/discover?q=" + "a" * 151, expected=422)
        filtered = self.call(visitor, "GET", f"/organizations/discover?q={organization['name']}&country=France")
        self.assertEqual(filtered["matches"], [])
        matched = self.call(visitor, "GET", f"/organizations/discover?q={organization['name']}&organization_type=NGO&country=Lebanon&city=Beirut")
        self.assertIn(organization["id"], [row["id"] for row in matched["matches"]])
        self.assertLessEqual(len(matched["matches"]), 10)
        self.assertNotIn("total", matched)

    def test_discovery_rate_limit_persists_between_http_clients_and_returns_retry_after(self):
        actor = self.actor()
        for _ in range(30):
            self.call(actor, "GET", "/organizations/discover?q=nonexistent-ratelimit")
        with httpx.Client(base_url=self.client.base_url, timeout=15, trust_env=False) as client:
            response = client.get("/organizations/discover?q=nonexistent-ratelimit", headers={"Authorization": f"Bearer {actor['token']}"})
        self.assertEqual(response.status_code, 429)
        self.assertGreater(int(response.headers.get("Retry-After", "0")), 0)

    def test_pending_request_retries_preserve_one_request_and_grant_no_access(self):
        owner, organization = self.workspace()
        applicant = self.actor()
        request = self.join(applicant, organization)
        replay = self.join(applicant, organization, "Changed message must not duplicate pending request", 200)
        self.assertEqual(replay["id"], request["id"])
        self.assertEqual(replay["status"], "pending")
        self.assertFalse(replay["membership_active"])
        self.assertEqual(len(self.call(owner, "GET", f"/organizations/{organization['id']}/join-requests")), 1)
        self.assertEqual(self.call(applicant, "GET", "/organizations"), [])
        for path in (f"/organizations/{organization['id']}", f"/organizations/{organization['id']}/members", f"/api/v1/participants?organization_id={organization['id']}", f"/api/v1/events?organization_id={organization['id']}"):
            self.call(applicant, "GET", path, expected=404)
        mine = self.call(applicant, "GET", "/organization-join-requests/mine")
        self.assertEqual([row["id"] for row in mine], [request["id"]])
        self.assertNotIn("applicant_email", mine[0])
        self.assertNotIn("reviewed_by", mine[0])

    def test_join_identity_and_role_are_not_accepted_from_client(self):
        _, organization = self.workspace()
        applicant = self.actor()
        for injected in ({"user_id": self.accounts["owner"]["id"]}, {"role": "Owner"}, {"status": "approved"}):
            self.call(applicant, "POST", f"/organizations/{organization['id']}/join-requests", {"message": "Please approve", **injected}, 422)
        self.call(applicant, "POST", f"/organizations/{organization['id']}/join-requests", {"message": "x" * 1001}, 422)
        self.assertEqual(self.call(applicant, "GET", "/organization-join-requests/mine"), [])

    def test_owner_approval_creates_member_and_is_idempotent_after_refresh(self):
        owner, organization = self.workspace()
        applicant = self.actor()
        request = self.join(applicant, organization)
        reviewed = self.review(owner, organization, request)
        self.assertEqual(reviewed["status"], "approved")
        self.assertEqual(reviewed["reviewed_by"], owner["id"])
        self.assertEqual(self.review(owner, organization, request)["id"], request["id"])
        memberships = self.call(owner, "GET", f"/organizations/{organization['id']}/members")
        matching = [row for row in memberships if row["user_id"] == applicant["id"]]
        self.assertEqual([(row["role"], row["status"]) for row in matching], [("Member", "active")])
        self.assertIn(organization["id"], [row["id"] for row in self.call(applicant, "GET", "/organizations")])
        mine = self.call(applicant, "GET", "/organization-join-requests/mine?status=approved")
        self.assertEqual(mine[0]["status"], "approved")
        self.assertTrue(mine[0]["membership_active"])
        self.join(applicant, organization, expected=409)
        self.review(owner, organization, request, "reject", 409)

    def test_admin_approves_only_member_access_and_member_viewer_outsider_cannot_review(self):
        owner, organization = self.workspace()
        roles = {role: self.actor() for role in ("Admin", "Member", "Viewer")}
        for role, actor in roles.items():
            self.call(owner, "POST", f"/organizations/{organization['id']}/members", {"email": actor["email"], "role": role}, 201)
        applicant = self.actor()
        outsider = self.actor()
        request = self.join(applicant, organization)
        for actor, code in ((roles["Member"], 403), (roles["Viewer"], 403), (outsider, 404)):
            self.call(actor, "GET", f"/organizations/{organization['id']}/join-requests", expected=code)
            self.review(actor, organization, request, expected=code)
        self.call(None, "PATCH", f"/organizations/{organization['id']}/join-requests/{request['id']}", {"decision": "approve"}, 401)
        self.review(roles["Admin"], organization, request)
        approved = next(row for row in self.call(owner, "GET", f"/organizations/{organization['id']}/members") if row["user_id"] == applicant["id"])
        self.assertEqual(approved["role"], "Member")
        admin = next(row for row in self.call(owner, "GET", f"/organizations/{organization['id']}/members") if row["user_id"] == roles["Admin"]["id"])
        self.call(roles["Admin"], "PATCH", f"/organizations/{organization['id']}/members/{approved['id']}/role", {"role": "Admin"}, 403)
        self.call(owner, "PATCH", f"/organizations/{organization['id']}/members/{approved['id']}/role", {"role": "Owner"}, 422)
        self.assertEqual(admin["role"], "Admin")

    def test_rejection_does_not_create_membership_and_resubmission_is_a_new_pending_request(self):
        owner, organization = self.workspace()
        applicant = self.actor()
        request = self.join(applicant, organization)
        result = self.review(owner, organization, request, "reject")
        self.assertEqual(result["status"], "rejected")
        self.assertEqual(self.review(owner, organization, request, "reject")["id"], request["id"])
        self.assertEqual(self.call(applicant, "GET", "/organizations"), [])
        self.call(applicant, "GET", f"/organizations/{organization['id']}/members", expected=404)
        retry = self.join(applicant, organization)
        self.assertNotEqual(retry["id"], request["id"])
        mine = self.call(applicant, "GET", "/organization-join-requests/mine")
        self.assertEqual({row["status"] for row in mine}, {"pending", "rejected"})

    def test_simultaneous_pending_submissions_and_approvals_do_not_duplicate_memberships(self):
        owner, organization = self.workspace()
        applicant = self.actor()
        join_path = f"/organizations/{organization['id']}/join-requests"
        responses = self.race([(applicant, "POST", join_path, {}), (applicant, "POST", join_path, {})])
        self.assertEqual(sorted(response.status_code for response in responses), [200, 201])
        self.assertEqual(responses[0].json()["id"], responses[1].json()["id"])
        request_id = responses[0].json()["id"]
        review_path = f"{join_path}/{request_id}"
        responses = self.race([(owner, "PATCH", review_path, {"decision": "approve"}), (owner, "PATCH", review_path, {"decision": "approve"})])
        self.assertEqual([response.status_code for response in responses], [200, 200])
        members = self.call(owner, "GET", f"/organizations/{organization['id']}/members")
        self.assertEqual(len([member for member in members if member["user_id"] == applicant["id"]]), 1)

    def test_competing_approve_and_reject_are_serialized_with_one_final_outcome(self):
        owner, organization = self.workspace()
        applicant = self.actor()
        request = self.join(applicant, organization)
        path = f"/organizations/{organization['id']}/join-requests/{request['id']}"
        results = self.race([(owner, "PATCH", path, {"decision": "approve"}), (owner, "PATCH", path, {"decision": "reject"})])
        self.assertEqual(sorted(response.status_code for response in results), [200, 409])
        final = self.call(applicant, "GET", "/organization-join-requests/mine")[0]
        members = self.call(owner, "GET", f"/organizations/{organization['id']}/members")
        self.assertEqual(any(member["user_id"] == applicant["id"] for member in members), final["status"] == "approved")

    def test_approval_and_existing_manual_add_coordinate_without_duplicate_membership(self):
        owner, organization = self.workspace()
        applicant = self.actor()
        request = self.join(applicant, organization)
        results = self.race([
            (owner, "PATCH", f"/organizations/{organization['id']}/join-requests/{request['id']}", {"decision": "approve"}),
            (owner, "POST", f"/organizations/{organization['id']}/members", {"email": applicant["email"], "role": "Member"}),
        ])
        self.assertTrue(all(response.status_code in {200, 201, 409} for response in results))
        members = self.call(owner, "GET", f"/organizations/{organization['id']}/members")
        self.assertEqual(len([row for row in members if row["user_id"] == applicant["id"]]), 1)

    def test_request_review_and_status_are_scoped_to_organization_and_applicant(self):
        owner, organization = self.workspace()
        other_owner, other = self.workspace()
        applicant, outsider = self.actor(), self.actor()
        request = self.join(applicant, organization)
        self.review(other_owner, organization, request, expected=404)
        self.call(other_owner, "PATCH", f"/organizations/{other['id']}/join-requests/{request['id']}", {"decision": "approve"}, 404)
        self.assertEqual(self.call(outsider, "GET", "/organization-join-requests/mine"), [])
        self.assertNotIn(applicant["email"], str(self.call(outsider, "GET", f"/organizations/discover?q={organization['name']}")))
        self.assertEqual(self.call(owner, "GET", f"/organizations/{organization['id']}/join-requests")[0]["applicant_email"], applicant["email"])

    def test_settings_require_manager_permission_and_hiding_org_removes_discovery_and_new_requests(self):
        owner, organization = self.workspace()
        viewer, visitor = self.actor(), self.actor()
        self.call(owner, "POST", f"/organizations/{organization['id']}/members", {"email": viewer["email"], "role": "Viewer"}, 201)
        path = f"/organizations/{organization['id']}/settings"
        self.call(viewer, "PATCH", path, {"is_discoverable": False}, 403)
        self.call(visitor, "PATCH", path, {"is_discoverable": False}, 404)
        saved = self.call(owner, "PATCH", path, {"is_discoverable": False, "city": "Jounieh"})
        self.assertFalse(saved["is_discoverable"])
        self.assertEqual(saved["city"], "Jounieh")
        self.assertNotIn(organization["id"], [match["id"] for match in self.call(visitor, "GET", f"/organizations/discover?q={organization['name']}")["matches"]])
        self.join(visitor, organization, expected=404)
        self.call(owner, "PATCH", path, {"owner_id": visitor["id"]}, 422)
        self.call(owner, "PATCH", path, {}, 422)
        for field in ("name", "organization_type", "is_discoverable"):
            self.call(owner, "PATCH", path, {field: None}, 422)
        members = self.call(owner, "GET", f"/organizations/{organization['id']}/members")
        self.assertEqual([member["user_id"] for member in members if member["role"] == "Owner"], [owner["id"]])

    def test_inactive_member_reactivation_preserves_membership_identity_and_never_restores_privileged_role(self):
        owner, organization = self.workspace()
        engine = create_engine(self.database_url)
        try:
            for old_role in ("Member", "Admin", "Owner"):
                applicant = self.actor()
                membership_id = uuid.uuid4()
                with engine.begin() as connection:
                    connection.execute(text("INSERT INTO memberships (id,user_id,organization_id,role,status) VALUES (:id,:user_id,:organization_id,:role,'inactive')"),
                        {"id": membership_id, "user_id": uuid.UUID(applicant["id"]), "organization_id": uuid.UUID(organization["id"]), "role": old_role})
                request = self.join(applicant, organization)
                self.review(owner, organization, request, expected=200 if old_role == "Member" else 409)
                with engine.connect() as connection:
                    rows = connection.execute(text("SELECT id,role,status FROM memberships WHERE user_id=:user_id AND organization_id=:organization_id"),
                        {"user_id": uuid.UUID(applicant["id"]), "organization_id": uuid.UUID(organization["id"])}).mappings().all()
                self.assertEqual(len(rows), 1)
                self.assertEqual(rows[0]["id"], membership_id)
                self.assertEqual(rows[0]["role"], old_role)
                self.assertEqual(rows[0]["status"], "active" if old_role == "Member" else "inactive")
        finally:
            engine.dispose()

    def test_own_request_cannot_be_approved_even_by_newly_added_reviewer(self):
        owner, organization = self.workspace()
        applicant = self.actor()
        request = self.join(applicant, organization)
        self.call(owner, "POST", f"/organizations/{organization['id']}/members", {"email": applicant["email"], "role": "Admin"}, 201)
        self.review(applicant, organization, request, expected=403)
        self.assertEqual(self.call(applicant, "GET", "/organization-join-requests/mine")[0]["status"], "pending")

    def test_failed_membership_insert_rolls_back_request_review_and_all_access(self):
        from fastapi import HTTPException
        from sqlalchemy import event as sqlalchemy_event
        from sqlalchemy.orm import Session
        from app.models.membership import Membership
        from app.models.organization_join_request import OrganizationJoinRequest
        from app.models.user import User
        from app.routers.onboarding import atomic_call
        from app.schemas.onboarding import JoinRequestReview
        from app.services.onboarding import review_join_request

        owner, organization = self.workspace()
        applicant = self.actor()
        request = self.join(applicant, organization)
        applicant_id = uuid.UUID(applicant["id"])
        organization_id = uuid.UUID(organization["id"])
        request_id = uuid.UUID(request["id"])
        engine = create_engine(self.database_url)
        def fail_insert(_mapper, _connection, membership):
            if membership.user_id == applicant_id and membership.organization_id == organization_id:
                membership.role = None  # Real PostgreSQL NOT NULL failure, only in this test process.
        sqlalchemy_event.listen(Membership, "before_insert", fail_insert)
        try:
            with Session(engine, autoflush=False) as db:
                reviewer = db.get(User, uuid.UUID(owner["id"]))
                with self.assertRaises(HTTPException) as failure:
                    atomic_call(db, lambda: review_join_request(db, reviewer, organization_id, request_id, JoinRequestReview(decision="approve")))
                self.assertEqual(failure.exception.status_code, 409)
                saved = db.get(OrganizationJoinRequest, request_id)
                self.assertEqual(saved.status, "pending")
                self.assertIsNone(saved.reviewed_at)
                self.assertIsNone(saved.reviewed_by)
            self.assertEqual(self.call(applicant, "GET", "/organizations"), [])
            self.assertEqual(self.call(applicant, "GET", "/organization-join-requests/mine")[0]["status"], "pending")
        finally:
            sqlalchemy_event.remove(Membership, "before_insert", fail_insert)
            engine.dispose()

    def test_development_debug_routes_are_closed_by_default(self):
        import os
        from unittest.mock import patch
        from fastapi.testclient import TestClient
        from app.main import app
        with patch.dict(os.environ, {"FIELDOPS_ENABLE_DEV_ENDPOINTS": "false"}):
            with TestClient(app) as client:
                for path in ("/dev/users/count", "/dev/users/test", "/dev/organizations/demo/members"):
                    response = client.get(path)
                    self.assertIn(response.status_code, {401, 404})
                    self.assertNotIn("members", response.json())
                    self.assertNotIn("total_users", response.json())


if __name__ == "__main__":
    import unittest
    unittest.main(verbosity=2)
