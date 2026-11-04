"""Inventory input failures use real authentication and isolated PostgreSQL."""

import json
import unittest
import uuid

from sqlalchemy import create_engine, text

import test_day9_integration as day9
import test_onboarding_integration as onboarding


ITEMS = "/api/v1/inventory/items"
MOVEMENTS = "/api/v1/inventory/movements"


class InventoryInputPostgreSQLIntegration(unittest.TestCase):
    setUpClass = classmethod(day9.Day9PostgreSQLIntegration.setUpClass.__func__)
    shutdown_server = classmethod(day9.Day9PostgreSQLIntegration.shutdown_server.__func__)
    expect = classmethod(day9.Day9PostgreSQLIntegration.expect.__func__)
    actor = onboarding.OnboardingPostgreSQLIntegration.actor
    call = onboarding.OnboardingPostgreSQLIntegration.call
    workspace = onboarding.OnboardingPostgreSQLIntegration.workspace

    def snapshot(self, organization):
        engine = create_engine(self.database_url)
        try:
            with engine.connect() as connection:
                self.assertEqual(connection.scalar(text("SELECT current_database()")), self.database_url.database)
                return {
                    table: list(connection.scalars(text(
                        f"SELECT to_jsonb(t)::text FROM {table} t "
                        "WHERE organization_id=:organization ORDER BY id"
                    ), {"organization": uuid.UUID(organization["id"])}))
                    for table in ("inventory_items", "inventory_movements")
                }
        finally:
            engine.dispose()

    def stock(self, owner, organization):
        return self.call(owner, "POST", ITEMS, {
            "organization_id": organization["id"], "name": f"Input fixture {uuid.uuid4().hex}",
        }, 201)

    def test_raw_and_quoted_nonfinite_values_reject_without_stock_or_history_changes(self):
        owner, organization = self.workspace()
        item = self.stock(owner, organization)
        headers = {"Authorization": f"Bearer {owner['token']}", "Content-Type": "application/json"}
        scenarios = (
            ("POST", ITEMS, {"organization_id": organization["id"], "name": "Rejected item"}, "minimum_quantity"),
            ("PATCH", f"{ITEMS}/{item['id']}?organization_id={organization['id']}", {}, "minimum_quantity"),
            ("POST", MOVEMENTS, {"organization_id": organization["id"], "item_id": item["id"], "movement_type": "receive"}, "quantity_delta"),
        )
        before = self.snapshot(organization)
        for method, path, base, field in scenarios:
            for token in ("NaN", "Infinity", "-Infinity"):
                for raw in (True, False):
                    with self.subTest(method=method, path=path, token=token, raw=raw):
                        payload = {**base, field: float(token) if raw else token}
                        response = self.client.request(method, path, content=json.dumps(payload), headers=headers)
                        self.assertEqual(response.status_code, 422, response.text[:300])
                        errors = response.json()["detail"]
                        self.assertTrue(any(error["loc"] == ["body", field] for error in errors))
                        field_error = next(error for error in errors if error["loc"] == ["body", field])
                        self.assertEqual(field_error["input"], token)
                        self.assertEqual(self.snapshot(organization), before)

    def test_protected_and_unknown_item_fields_reject_entire_request(self):
        owner, organization = self.workspace()
        item = self.stock(owner, organization)
        before = self.snapshot(organization)
        for field, value in (
            ("current_quantity", "999"), ("archived", True), ("id", str(uuid.uuid4())),
            ("unexpected", "value"),
        ):
            for method, path, payload in (
                ("POST", ITEMS, {"organization_id": organization["id"], "name": "Rejected", field: value}),
                ("PATCH", f"{ITEMS}/{item['id']}?organization_id={organization['id']}", {"name": "Must remain unchanged", field: value}),
            ):
                with self.subTest(field=field, method=method):
                    response = self.client.request(method, path, json=payload,
                        headers={"Authorization": f"Bearer {owner['token']}"})
                    self.assertEqual(response.status_code, 422)
                    self.assertTrue(any(error["type"] == "extra_forbidden" and error["loc"] == ["body", field]
                                        for error in response.json()["detail"]))
                    self.assertEqual(self.snapshot(organization), before)

    def test_valid_numeric_strings_and_json_numbers_preserve_decimal_behavior(self):
        owner, organization = self.workspace()
        for minimum in ("1.25", 1.25):
            with self.subTest(minimum=minimum):
                item = self.call(owner, "POST", ITEMS, {
                    "organization_id": organization["id"], "name": f"Valid {uuid.uuid4().hex}",
                    "minimum_quantity": minimum,
                }, 201)
                self.assertEqual(item["minimum_quantity"], "1.25")
                self.assertEqual(item["current_quantity"], "0.00")
                item = self.call(owner, "PATCH", f"{ITEMS}/{item['id']}?organization_id={organization['id']}",
                                 {"name": "Normal update", "minimum_quantity": "2.50"})
                self.assertEqual(item["minimum_quantity"], "2.50")
                for quantity in ("0.25", 0.25):
                    movement = self.call(owner, "POST", MOVEMENTS, {
                        "organization_id": organization["id"], "item_id": item["id"],
                        "movement_type": "receive", "quantity_delta": quantity,
                    }, 201)
                    self.assertEqual(movement["quantity_delta"], "0.25")
                    self.assertEqual(movement["actor_id"], owner["id"])
                saved = self.call(owner, "GET", f"{ITEMS}/{item['id']}?organization_id={organization['id']}")
                self.assertEqual(saved["current_quantity"], "0.50")

    def test_ordinary_invalid_inputs_keep_standard_error_details_and_authentication(self):
        owner, organization = self.workspace()
        response = self.client.post(ITEMS, json={"organization_id": organization["id"], "name": "Invalid", "minimum_quantity": -1},
                                    headers={"Authorization": f"Bearer {owner['token']}"})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["detail"][0]["loc"], ["body", "minimum_quantity"])
        self.assertEqual(response.json()["detail"][0]["input"], -1)
        self.assertEqual(response.json()["detail"][0]["ctx"], {"ge": 0})
        response = self.client.post("/auth/login", json={"email": "invalid", "password": "Provided password"})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["detail"][0]["loc"], ["body", "email"])
        self.assertEqual(response.json()["detail"][0]["input"], "invalid")
        response = self.client.post("/api/v1/participants", json={"organization_id": "invalid", "full_name": "Person"},
                                    headers={"Authorization": f"Bearer {owner['token']}"})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["detail"][0]["loc"], ["body", "organization_id"])
        self.assertEqual(response.json()["detail"][0]["input"], "invalid")
        self.call(None, "POST", ITEMS, {"organization_id": organization["id"], "name": "No auth", "current_quantity": 1}, 401)


if __name__ == "__main__":
    unittest.main(verbosity=2)
