"""Complete inventory HTTP contracts through the isolated production app."""

import json
import threading
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal

import httpx
from sqlalchemy import create_engine, text

import test_day9_integration as day9
import test_onboarding_integration as onboarding
from test_inventory_registration import EXPECTED


PREFIX = "/api/v1/inventory"


class InventoryCRUDIntegration(unittest.TestCase):
    setUpClass = classmethod(day9.Day9PostgreSQLIntegration.setUpClass.__func__)
    shutdown_server = classmethod(day9.Day9PostgreSQLIntegration.shutdown_server.__func__)
    expect = classmethod(day9.Day9PostgreSQLIntegration.expect.__func__)
    actor = onboarding.OnboardingPostgreSQLIntegration.actor
    call = onboarding.OnboardingPostgreSQLIntegration.call
    workspace = onboarding.OnboardingPostgreSQLIntegration.workspace

    def create(self, actor, org, family, **values):
        return self.call(actor, "POST", f"{PREFIX}/{family}", {
            "organization_id": org["id"], "name": "Inventory " + uuid.uuid4().hex, **values,
        }, 201)

    def path(self, family, resource, org, suffix=""):
        return f"{PREFIX}/{family}/{resource['id']}{suffix}?organization_id={org['id']}"

    def add_member(self, owner, org, role):
        actor = self.actor()
        self.call(owner, "POST", f"/organizations/{org['id']}/members",
                  {"email": actor["email"], "role": role}, 201)
        return actor

    def archive(self, owner, org, action="archive"):
        return self.call(owner, "POST", f"/organizations/{org['id']}/{action}",
                         {"confirmation_name": org["name"]})

    def movement(self, actor, org, item, kind="receive", delta="1", **values):
        return self.call(actor, "POST", f"{PREFIX}/movements", {
            "organization_id": org["id"], "item_id": item["id"],
            "movement_type": kind, "quantity_delta": delta, **values,
        }, 201)

    def snapshot(self, org):
        engine = create_engine(self.database_url)
        try:
            with engine.connect() as connection:
                self.assertEqual(connection.scalar(text("SELECT current_database()")), self.database_url.database)
                return {
                    table: connection.execute(text(
                        f"SELECT to_jsonb(t)::text FROM {table} t WHERE organization_id=:org "
                        "ORDER BY to_jsonb(t)::text"
                    ), {"org": uuid.UUID(org["id"])}).scalars().all()
                    for table in ("inventory_categories", "storage_locations", "inventory_items", "inventory_movements")
                }
        finally:
            engine.dispose()

    def resources(self, owner, org):
        category = self.create(owner, org, "categories")
        location = self.create(owner, org, "locations")
        # Keep these category/location targets unused so archive-denial tests
        # cannot pass merely because a separate linked-item delete check fired.
        item = self.create(owner, org, "items")
        archived = self.create(owner, org, "items")
        self.call(owner, "DELETE", self.path("items", archived, org), expected=204)
        return category, location, item, archived

    def writes(self, org, category, location, item, archived):
        return (
            ("POST", f"{PREFIX}/categories", {"organization_id": org["id"], "name": "Category write"}, True),
            ("PATCH", self.path("categories", category, org), {"name": "Category edit"}, False),
            ("DELETE", self.path("categories", category, org), None, False),
            ("POST", f"{PREFIX}/locations", {"organization_id": org["id"], "name": "Location write"}, True),
            ("PATCH", self.path("locations", location, org), {"name": "Location edit"}, False),
            ("DELETE", self.path("locations", location, org), None, False),
            ("POST", f"{PREFIX}/items", {"organization_id": org["id"], "name": "Item write"}, True),
            ("PATCH", self.path("items", item, org), {"name": "Item edit"}, False),
            ("DELETE", self.path("items", item, org), None, False),
            ("POST", self.path("items", archived, org, "/restore"), None, False),
            ("POST", f"{PREFIX}/movements", {"organization_id": org["id"], "item_id": item["id"],
                                               "movement_type": "receive", "quantity_delta": "1"}, True),
        )

    def test_http_openapi_is_the_production_inventory_contract(self):
        response = self.client.get("/openapi.json")
        self.assertEqual(response.status_code, 200)
        operations = {
            (path, method.upper()) for path, methods in response.json()["paths"].items()
            if path.startswith(PREFIX + "/") for method in methods
            if method in {"get", "post", "patch", "delete"}
        }
        self.assertEqual(operations, EXPECTED)

    def test_categories_owner_admin_crud_and_referenced_deletion(self):
        owner, org = self.workspace()
        admin = self.add_member(owner, org, "Admin")
        category = self.create(owner, org, "categories", name="  First Aid  ", description="Original")
        self.assertEqual(category["name"], "First Aid")
        self.assertEqual(self.call(admin, "GET", self.path("categories", category, org))["id"], category["id"])
        self.assertEqual([row["id"] for row in self.call(owner, "GET", f"{PREFIX}/categories?organization_id={org['id']}")], [category["id"]])
        updated = self.call(admin, "PATCH", self.path("categories", category, org),
                            {"name": "  Medical  ", "description": "Updated"})
        self.assertEqual((updated["name"], updated["description"]), ("Medical", "Updated"))
        self.create(owner, org, "items", category_id=category["id"])
        for actor in (owner, admin):
            self.call(actor, "DELETE", self.path("categories", category, org), expected=409)
        for actor in (owner, admin):
            unused = self.create(actor, org, "categories")
            self.call(actor, "DELETE", self.path("categories", unused, org), expected=204)
            self.call(owner, "GET", self.path("categories", unused, org), expected=404)
        self.assertEqual(self.call(owner, "GET", self.path("categories", category, org))["name"], "Medical")

    def test_locations_owner_admin_crud_and_referenced_deletion(self):
        owner, org = self.workspace()
        admin = self.add_member(owner, org, "Admin")
        location = self.create(admin, org, "locations", name="  Main Store  ", description="Original")
        self.assertEqual(location["name"], "Main Store")
        updated = self.call(owner, "PATCH", self.path("locations", location, org),
                            {"name": "  Equipment Store ", "description": "Updated"})
        self.assertEqual((updated["name"], updated["description"]), ("Equipment Store", "Updated"))
        self.assertEqual(self.call(admin, "GET", self.path("locations", location, org))["id"], location["id"])
        self.assertEqual(len(self.call(owner, "GET", f"{PREFIX}/locations?organization_id={org['id']}")), 1)
        self.create(owner, org, "items", location_id=location["id"])
        self.call(admin, "DELETE", self.path("locations", location, org), expected=409)
        for actor in (owner, admin):
            unused = self.create(actor, org, "locations")
            self.call(actor, "DELETE", self.path("locations", unused, org), expected=204)
            self.call(owner, "GET", self.path("locations", unused, org), expected=404)

    def test_category_and_location_names_remain_case_sensitive_and_tenant_scoped(self):
        owner, org = self.workspace()
        other_owner, other = self.workspace()
        for family in ("categories", "locations"):
            with self.subTest(family=family):
                first = self.create(owner, org, family, name="Camping")
                second = self.create(owner, org, family, name="Other")
                self.call(owner, "POST", f"{PREFIX}/{family}", {"organization_id": org["id"], "name": " Camping "}, 409)
                self.call(owner, "PATCH", self.path(family, second, org), {"name": "Camping"}, 409)
                self.create(owner, org, family, name="camping")
                self.create(other_owner, other, family, name="Camping")
                self.call(owner, "GET", self.path(family, first, other), expected=404)
                self.call(other_owner, "GET", self.path(family, first, other), expected=404)
                for method, body in (("PATCH", {"name": "Foreign"}), ("DELETE", None)):
                    self.call(other_owner, method, self.path(family, first, org), body, 404)

    def test_category_and_location_validation_and_failed_update_preservation(self):
        owner, org = self.workspace()
        for family in ("categories", "locations"):
            resource = self.create(owner, org, family, name="Valid")
            before = self.snapshot(org)
            for payload in ({"name": " "}, {"name": "\t\n"}, {"name": "x\x00y"},
                            {"description": "x\x00y"}, {"name": "x" * 101},
                            {"description": "x" * 501}, {"name": None}):
                with self.subTest(family=family, payload=repr(payload)):
                    self.call(owner, "PATCH", self.path(family, resource, org), payload, 422)
                    self.call(owner, "POST", f"{PREFIX}/{family}",
                              {"organization_id": org["id"], "name": "New", **payload}, 422)
            self.call(owner, "GET", f"{PREFIX}/{family}/invalid?organization_id={org['id']}", expected=422)
            self.call(owner, "GET", f"{PREFIX}/{family}?organization_id=invalid", expected=422)
            self.assertEqual(self.snapshot(org), before)

    def test_every_inventory_write_enforces_auth_roles_and_tenant_membership(self):
        owner, org = self.workspace()
        category, location, item, archived = self.resources(owner, org)
        writes = self.writes(org, category, location, item, archived)
        before = self.snapshot(org)
        actors = [(None, 401), (self.actor(), 404)]
        actors.extend((self.add_member(owner, org, role), 403)
                      for role in ("Member", "Viewer", "Treasurer", "Logistics"))
        for actor, expected in actors:
            for method, path, body, _create in writes:
                with self.subTest(expected=expected, method=method, path=path):
                    self.call(actor, method, path, body, expected)
        self.assertEqual(self.snapshot(org), before)
        for actor, expected in actors:
            if actor is None:
                continue
            for family, resource in (("categories", category), ("locations", location), ("items", item)):
                self.call(actor, "GET", f"{PREFIX}/{family}?organization_id={org['id']}", expected=200 if expected == 403 else 404)
                self.call(actor, "GET", self.path(family, resource, org), expected=200 if expected == 403 else 404)
            self.call(actor, "GET", f"{PREFIX}/movements?organization_id={org['id']}", expected=200 if expected == 403 else 404)

    def test_items_full_update_filters_sku_and_cross_tenant_references(self):
        owner, org = self.workspace()
        admin = self.add_member(owner, org, "Admin")
        foreign_owner, foreign = self.workspace()
        cat = self.create(owner, org, "categories")
        loc = self.create(owner, org, "locations")
        foreign_cat = self.create(foreign_owner, foreign, "categories")
        foreign_loc = self.create(foreign_owner, foreign, "locations")
        item = self.create(owner, org, "items", name="  Default Item  ")
        self.assertEqual((item["name"], item["unit"], item["item_type"]), ("Default Item", "piece", "reusable"))
        self.assertEqual(Decimal(item["current_quantity"]), 0)
        updated = self.call(admin, "PATCH", self.path("items", item, org), {
            "name": "  Updated Item ", "category_id": cat["id"], "location_id": loc["id"],
            "unit": " meter ", "sku": " SKU-01 ", "item_type": "consumable", "minimum_quantity": "1.25",
        })
        self.assertEqual((updated["name"], updated["unit"], updated["sku"], updated["item_type"]),
                         ("Updated Item", "meter", "SKU-01", "consumable"))
        self.assertEqual(Decimal(updated["minimum_quantity"]), Decimal("1.25"))
        self.assertEqual((updated["category_id"], updated["location_id"]), (cat["id"], loc["id"]))
        self.call(owner, "POST", f"{PREFIX}/items", {"organization_id": org["id"], "name": "Duplicate", "sku": "SKU-01"}, 409)
        self.create(foreign_owner, foreign, "items", sku="SKU-01")
        for _ in range(2):
            self.create(owner, org, "items", sku=None)
        for field, reference in (("category_id", foreign_cat), ("location_id", foreign_loc)):
            self.call(owner, "POST", f"{PREFIX}/items", {"organization_id": org["id"], "name": "Invalid", field: reference["id"]}, 404)
            self.call(owner, "PATCH", self.path("items", item, org), {field: reference["id"]}, 404)
        query = f"{PREFIX}/items?organization_id={org['id']}"
        for filter_value in ("low_stock_only=true", f"category_id={cat['id']}", f"location_id={loc['id']}"):
            self.assertEqual([row["id"] for row in self.call(owner, "GET", query + "&" + filter_value)], [item["id"]])
        listed = self.call(owner, "GET", query)
        page = self.call(owner, "GET", query + "&limit=1&offset=1")
        self.assertEqual([row["id"] for row in page], [listed[1]["id"]])
        for suffix in ("&limit=0", "&limit=501", "&offset=-1"):
            self.call(owner, "GET", query + suffix, expected=422)
        self.assertEqual(self.call(admin, "GET", self.path("items", item, org))["id"], item["id"])

    def test_item_archive_restore_preserves_stock_history_and_blocks_edits(self):
        owner, org = self.workspace()
        admin = self.add_member(owner, org, "Admin")
        item = self.create(owner, org, "items")
        first = self.movement(owner, org, item)
        self.call(admin, "DELETE", self.path("items", item, org), expected=409)
        second = self.movement(admin, org, item, "issue", "-1")
        history_path = f"{PREFIX}/movements?organization_id={org['id']}&item_id={item['id']}"
        ids = {row["id"] for row in self.call(owner, "GET", history_path)}
        self.assertEqual(ids, {first["id"], second["id"]})
        self.call(admin, "DELETE", self.path("items", item, org), expected=204)
        self.assertTrue(self.call(owner, "GET", self.path("items", item, org))["archived"])
        self.assertEqual(self.call(owner, "GET", f"{PREFIX}/items?organization_id={org['id']}"), [])
        self.assertEqual([row["id"] for row in self.call(owner, "GET", f"{PREFIX}/items?organization_id={org['id']}&archived=true")], [item["id"]])
        self.call(owner, "PATCH", self.path("items", item, org), {"name": "Blocked"}, 409)
        self.call(owner, "POST", f"{PREFIX}/movements", {"organization_id": org["id"], "item_id": item["id"],
                  "movement_type": "receive", "quantity_delta": "1"}, 409)
        restored = self.call(admin, "POST", self.path("items", item, org, "/restore"))
        self.assertFalse(restored["archived"])
        self.call(owner, "PATCH", self.path("items", item, org), {"name": "Restored"})
        self.assertEqual({row["id"] for row in self.call(owner, "GET", history_path)}, ids)

    def test_every_archived_write_has_canonical_scope_and_unchanged_rows(self):
        owner, org = self.workspace()
        _, active = self.workspace(owner=owner)
        admin = self.add_member(owner, org, "Admin")
        member = self.add_member(owner, org, "Member")
        category, location, item, archived = self.resources(owner, org)
        self.archive(owner, org)
        before = self.snapshot(org)
        for method, path, body, create in self.writes(org, category, location, item, archived):
            for actor in (owner, admin):
                with self.subTest(method=method, path=path, actor=actor["id"]):
                    self.call(actor, method, path, body, 409)
            path_without_query = path.split("?")[0]
            query = active["id"] if create else org["id"]
            spoofed = body if create or body is None else {**body, "organization_id": active["id"]}
            for media in ("application/json", None, "application/vnd.fieldops+json"):
                headers = {"Authorization": f"Bearer {owner['token']}"}
                if media:
                    headers["Content-Type"] = media
                response = self.client.request(method, path_without_query + "?organization_id=" + query,
                    content=json.dumps(spoofed) if spoofed is not None else None, headers=headers)
                self.assertEqual(response.status_code, 409, response.text[:300])
            if not create:
                self.call(owner, method, path_without_query + "?organization_id=" + active["id"], body, 404)
                self.call(owner, method, path_without_query, body, 422)
                self.call(owner, method, path_without_query + "?organization_id=invalid", body, 422)
        self.assertEqual(self.snapshot(org), before)
        for family, resource in (("categories", category), ("locations", location), ("items", item)):
            self.call(member, "GET", f"{PREFIX}/{family}?organization_id={org['id']}")
            self.call(member, "GET", self.path(family, resource, org))
        self.call(member, "GET", f"{PREFIX}/movements?organization_id={org['id']}")
        self.archive(owner, org, "restore")
        self.call(admin, "PATCH", self.path("categories", category, org), {"name": "Restored category"})
        self.call(admin, "PATCH", self.path("locations", location, org), {"name": "Restored location"})
        self.call(admin, "PATCH", self.path("items", item, org), {"name": "Restored item"})
        self.call(admin, "POST", self.path("items", archived, org, "/restore"))
        self.movement(admin, org, item)

    def test_concurrent_category_and_location_duplicates_are_atomic(self):
        for family in ("categories", "locations"):
            owner, org = self.workspace()
            payload = {"organization_id": org["id"], "name": "Concurrent duplicate"}
            barrier = threading.Barrier(4)

            def invoke(_index):
                with httpx.Client(base_url=self.client.base_url, timeout=20, trust_env=False) as client:
                    barrier.wait(timeout=10)
                    return client.post(f"{PREFIX}/{family}", json=payload,
                                       headers={"Authorization": f"Bearer {owner['token']}"})

            with ThreadPoolExecutor(max_workers=4) as executor:
                responses = list(executor.map(invoke, range(4)))
            self.assertEqual(sorted(response.status_code for response in responses), [201, 409, 409, 409])
            self.assertEqual(len(self.call(owner, "GET", f"{PREFIX}/{family}?organization_id={org['id']}")), 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
