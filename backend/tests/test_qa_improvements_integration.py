"""QA01/02/03/05 acceptance using real isolated PostgreSQL and HTTP."""
import unittest
import uuid

from sqlalchemy import create_engine, text

import test_day9_integration as day9
import test_onboarding_integration as onboarding


class QAImprovementsIntegration(unittest.TestCase):
    setUpClass = classmethod(day9.Day9PostgreSQLIntegration.setUpClass.__func__)
    shutdown_server = classmethod(day9.Day9PostgreSQLIntegration.shutdown_server.__func__)
    expect = classmethod(day9.Day9PostgreSQLIntegration.expect.__func__)
    actor = onboarding.OnboardingPostgreSQLIntegration.actor
    call = onboarding.OnboardingPostgreSQLIntegration.call
    workspace = onboarding.OnboardingPostgreSQLIntegration.workspace

    def test_password_policy_boundaries_unicode_specials_and_unchanged_hashing(self):
        for password in ("abcdefgh!1", "Abcdefghij", "Abcdefg!1", " " * 10, "A!" + "x" * 127, "Abcdefgh 1"):
            with self.subTest(length=len(password)):
                self.call(None, "POST", "/auth/register", {"name": "Policy test", "email": f"qa-invalid-{uuid.uuid4().hex}@example.com", "password": password}, 422)
        for password in ("Abcdefgh!1", "A!" + "x" * 126, "Abcdefgh€1", "  Abcdef!1  "):
            with self.subTest(length=len(password)):
                email = f"qa-valid-{uuid.uuid4().hex}@example.com"
                profile = self.call(None, "POST", "/auth/register", {"name": "Policy test", "email": email, "password": password}, 201)
                self.assertNotIn("password_hash", profile)
                self.assertIn("access_token", self.call(None, "POST", "/auth/login", {"email": email, "password": password}))
                engine = create_engine(self.database_url)
                try:
                    with engine.connect() as connection:
                        hashed = connection.scalar(text("SELECT password_hash FROM users WHERE id=:id"), {"id": profile["id"]})
                    self.assertTrue(hashed.startswith("$argon2"))
                    self.assertNotEqual(hashed, password)
                finally:
                    engine.dispose()

    def test_custom_other_type_required_normalized_saved_and_cleared(self):
        owner = self.actor()
        base = {"name": f"Custom type {uuid.uuid4().hex}", "organization_type": "Other"}
        for value in (None, "", "   ", "x" * 101, "x\x00y"):
            self.call(owner, "POST", "/organizations", {**base, "organization_type_other": value}, 422)
        organization = self.call(owner, "POST", "/organizations", {**base, "organization_type_other": "  Community\t  association  "}, 201)
        self.assertEqual(organization["organization_type_other"], "Community association")
        path = f"/organizations/{organization['id']}/settings"
        self.assertEqual(self.call(owner, "GET", f"/organizations/{organization['id']}")["organization_type_other"], "Community association")
        self.call(owner, "PATCH", path, {"organization_type_other": " "}, 422)
        updated = self.call(owner, "PATCH", path, {"organization_type": "NGO", "organization_type_other": "stale hidden value"})
        self.assertIsNone(updated["organization_type_other"])
        self.call(owner, "PATCH", path, {"organization_type": "Other"}, 422)
        self.call(self.accounts["outsider"], "PATCH", path, {"organization_type": "Other", "organization_type_other": "Forbidden"}, 404)

    def test_name_only_legacy_other_can_update_unrelated_settings(self):
        owner = self.actor()
        organization = self.call(owner, "POST", "/organizations", {"name": f"Legacy {uuid.uuid4().hex}"}, 201)
        self.assertIsNone(organization["organization_type_other"])
        result = self.call(owner, "PATCH", f"/organizations/{organization['id']}/settings", {"city": "Beirut"})
        self.assertEqual(result["city"], "Beirut")

    def test_distinct_namesake_uuids_preserved_and_search_ids_unique(self):
        name = f"Groupe Sainte Rita Di Cascia {uuid.uuid4().hex[:10]}"
        owner, first = self.workspace(name=name, city="Beirut")
        _, second = self.workspace(name=name, city="Jounieh")
        _, private = self.workspace(name=name, is_discoverable=False)
        visitor = self.actor()
        rows = self.call(visitor, "GET", f"/organizations/discover?q={name}")["matches"]
        ids = [row["id"] for row in rows]
        self.assertEqual(len(ids), len(set(ids)))
        exact_rows = [row for row in rows if row["name"] == name]
        self.assertEqual({row['id'] for row in exact_rows}, {first["id"], second["id"]})
        self.assertNotIn(private["id"], ids)
        self.assertEqual({row["city"] for row in exact_rows}, {"Beirut", "Jounieh"})
        self.assertEqual(self.call(owner, "GET", f"/organizations/{first['id']}")["name"], name)

    def test_country_codes_and_historical_names_remain_searchable_and_editable(self):
        from app.countries import COUNTRIES
        self.assertEqual(len(COUNTRIES), 249)
        self.assertEqual(COUNTRIES['LB'], 'Lebanon')
        owner, organization = self.workspace(country=' Lebanon ')
        self.assertEqual(organization['country'], 'LB')
        path = f"/organizations/{organization['id']}/settings"
        self.assertEqual(self.call(owner, 'PATCH', path, {'country': 'fr'})['country'], 'FR')
        self.call(owner, 'PATCH', path, {'country': 'Atlantis'}, 422)
        self.call(owner, 'POST', '/organizations', {'name': 'Invalid country', 'country': 'XX'}, 422)
        engine = create_engine(self.database_url)
        try:
            with engine.begin() as connection:
                connection.execute(text('UPDATE organizations SET country=:country WHERE id=:id'), {'country': 'Lebanon', 'id': organization['id']})
            visitor = self.actor()
            matches = self.call(visitor, 'GET', f"/organizations/discover?q={organization['name']}&country=LB")['matches']
            self.assertIn(organization['id'], [row['id'] for row in matches])
            self.assertEqual(self.call(owner, 'GET', f"/organizations/{organization['id']}")['country'], 'Lebanon')
            with engine.begin() as connection:
                connection.execute(text('UPDATE organizations SET country=:country WHERE id=:id'), {'country': 'Historical region label', 'id': organization['id']})
            updated = self.call(owner, 'PATCH', path, {'city': 'Byblos', 'country': 'Historical region label'})
            self.assertEqual(updated['country'], 'Historical region label')
            self.assertEqual(updated['city'], 'Byblos')
        finally:
            engine.dispose()


if __name__ == '__main__':
    unittest.main(verbosity=2)
