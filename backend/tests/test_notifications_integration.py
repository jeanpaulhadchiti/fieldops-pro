"""Real notification API tests, restricted to the shared disposable PG guard."""

import unittest
import uuid

from sqlalchemy import create_engine, text

import test_day9_integration as day9
import test_onboarding_integration as onboarding


class NotificationPostgreSQLIntegration(unittest.TestCase):
    # Reuse the isolated real-server fixture without repeating inherited tests.
    setUpClass = classmethod(day9.Day9PostgreSQLIntegration.setUpClass.__func__)
    shutdown_server = classmethod(day9.Day9PostgreSQLIntegration.shutdown_server.__func__)
    expect = classmethod(day9.Day9PostgreSQLIntegration.expect.__func__)
    actor = onboarding.OnboardingPostgreSQLIntegration.actor
    call = onboarding.OnboardingPostgreSQLIntegration.call
    workspace = onboarding.OnboardingPostgreSQLIntegration.workspace
    join = onboarding.OnboardingPostgreSQLIntegration.join
    review = onboarding.OnboardingPostgreSQLIntegration.review
    race = onboarding.OnboardingPostgreSQLIntegration.race

    def notification(self, owner):
        return self.call(owner, "GET", "/notifications")["items"][0]

    def test_new_request_notifies_only_active_owner_and_hides_other_tenants(self):
        owner, organization = self.workspace()
        applicant, admin, outsider = self.actor(), self.actor(), self.actor()
        self.call(owner, "POST", f"/organizations/{organization['id']}/members", {"email": admin["email"], "role": "Admin"}, 201)
        request = self.join(applicant, organization)
        feed = self.call(owner, "GET", "/notifications")
        self.assertEqual(feed["unread_count"], 1)
        item = feed["items"][0]
        self.assertEqual((item["organization_id"], item["organization_name"], item["join_request_id"], item["applicant_name"], item["status"]),
                         (organization["id"], organization["name"], request["id"], applicant["name"], "pending"))
        self.assertNotIn(applicant["email"], str(feed))
        self.assertNotIn("recipient_id", item)
        linked = self.call(owner, "GET", f"/organizations/{organization['id']}/join-requests?request_id={request['id']}")
        self.assertEqual([row["id"] for row in linked], [request["id"]])
        self.assertEqual(self.call(owner, "GET", f"/organizations/{organization['id']}/join-requests?request_id={uuid.uuid4()}"), [])
        for actor in (applicant, admin, outsider):
            self.assertEqual(self.call(actor, "GET", "/notifications"), {"items": [], "unread_count": 0, "has_more": False})
            self.call(actor, "PATCH", f"/notifications/{item['id']}", {"is_read": True}, 404)
            self.call(actor, "PATCH", f"/notifications/{uuid.uuid4()}", {"is_read": True}, 404)
        self.call(None, "GET", "/notifications", expected=401)
        self.call(None, "PATCH", f"/notifications/{item['id']}", {"is_read": True}, 401)

    def test_read_unread_state_is_persisted_idempotent_and_validated(self):
        owner, organization = self.workspace()
        self.join(self.actor(), organization)
        item = self.notification(owner)
        path = f"/notifications/{item['id']}"
        marked = self.call(owner, "PATCH", path, {"is_read": True})
        self.assertIsNotNone(marked["read_at"])
        self.assertEqual(self.call(owner, "PATCH", path, {"is_read": True})["read_at"], marked["read_at"])
        self.assertEqual(self.call(owner, "GET", "/notifications")["unread_count"], 0)
        self.assertIsNone(self.call(owner, "PATCH", path, {"is_read": False})["read_at"])
        self.assertEqual(self.call(owner, "GET", "/notifications")["unread_count"], 1)
        for data in ({"is_read": "false"}, {"is_read": 1}, {"is_read": True, "recipient_id": owner["id"]}, {}):
            self.call(owner, "PATCH", path, data, 422)
        self.call(owner, "GET", "/notifications?page_size=101", expected=422)
        self.call(owner, "GET", "/notifications?page=0", expected=422)

    def test_pending_replay_and_concurrent_submission_do_not_duplicate_notifications(self):
        owner, organization = self.workspace()
        applicant = self.actor()
        path = f"/organizations/{organization['id']}/join-requests"
        responses = self.race([(applicant, "POST", path, {}), (applicant, "POST", path, {})])
        self.assertEqual(sorted(response.status_code for response in responses), [200, 201])
        request = responses[0].json()
        self.assertEqual(self.join(applicant, organization, expected=200)["id"], request["id"])
        feed = self.call(owner, "GET", "/notifications")
        self.assertEqual(len(feed["items"]), 1)
        self.assertEqual(feed["unread_count"], 1)

    def test_admin_review_updates_existing_notification_and_rejected_resubmission_is_distinct(self):
        owner, organization = self.workspace()
        applicant, admin = self.actor(), self.actor()
        self.call(owner, "POST", f"/organizations/{organization['id']}/members", {"email": admin["email"], "role": "Admin"}, 201)
        request = self.join(applicant, organization)
        original = self.notification(owner)
        self.call(owner, "PATCH", f"/notifications/{original['id']}", {"is_read": True})
        self.review(admin, organization, request, "reject")
        updated = self.notification(owner)
        self.assertEqual((updated["id"], updated["status"], updated["read_at"]), (original["id"], "rejected", None))
        self.assertGreaterEqual(updated["updated_at"], original["updated_at"])
        self.review(admin, organization, request, "reject")
        self.assertEqual(len(self.call(owner, "GET", "/notifications")["items"]), 1)
        new_request = self.join(applicant, organization)
        self.review(owner, organization, new_request, "approve")
        items = self.call(owner, "GET", "/notifications")["items"]
        self.assertEqual(len(items), 2)
        self.assertEqual({item["status"] for item in items}, {"approved", "rejected"})
        self.assertEqual(len({item["id"] for item in items}), 2)

    def test_revoked_owner_access_hides_notifications_immediately(self):
        owner, organization = self.workspace()
        self.join(self.actor(), organization)
        item = self.notification(owner)
        engine = create_engine(self.database_url)
        try:
            with engine.begin() as connection:
                connection.execute(text("UPDATE memberships SET status='inactive' WHERE organization_id=:org AND user_id=:owner"),
                                   {"org": organization["id"], "owner": owner["id"]})
            self.assertEqual(self.call(owner, "GET", "/notifications")["items"], [])
            self.call(owner, "PATCH", f"/notifications/{item['id']}", {"is_read": True}, 404)
        finally:
            engine.dispose()

    def test_notification_write_failure_rolls_back_join_request(self):
        owner, organization = self.workspace()
        applicant = self.actor()
        engine = create_engine(self.database_url)
        constraint = "ck_notification_test_" + uuid.uuid4().hex
        try:
            with engine.begin() as connection:
                connection.execute(text(f"ALTER TABLE notifications ADD CONSTRAINT {constraint} CHECK (recipient_id <> '{owner['id']}'::uuid)"))
            self.join(applicant, organization, expected=409)
            self.assertEqual(self.call(owner, "GET", f"/organizations/{organization['id']}/join-requests"), [])
            self.assertEqual(self.call(applicant, "GET", "/organization-join-requests/mine"), [])
            self.assertEqual(self.call(owner, "GET", "/notifications")["items"], [])
        finally:
            with engine.begin() as connection:
                connection.execute(text(f"ALTER TABLE notifications DROP CONSTRAINT IF EXISTS {constraint}"))
            engine.dispose()
