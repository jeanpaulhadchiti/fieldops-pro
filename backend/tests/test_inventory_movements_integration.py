"""Real stock transactions and authoritative history on isolated PostgreSQL."""
import threading
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal

import httpx
from sqlalchemy import create_engine, event, text

import test_day9_integration as day9
import test_onboarding_integration as onboarding

ITEMS = "/api/v1/inventory/items"
MOVES = "/api/v1/inventory/movements"


class InventoryMovementIntegration(unittest.TestCase):
    setUpClass = classmethod(day9.Day9PostgreSQLIntegration.setUpClass.__func__)
    shutdown_server = classmethod(day9.Day9PostgreSQLIntegration.shutdown_server.__func__)
    expect = classmethod(day9.Day9PostgreSQLIntegration.expect.__func__)
    actor = onboarding.OnboardingPostgreSQLIntegration.actor
    call = onboarding.OnboardingPostgreSQLIntegration.call
    workspace = onboarding.OnboardingPostgreSQLIntegration.workspace

    def item(self, owner, org):
        return self.call(owner, "POST", ITEMS, {"organization_id": org["id"], "name": "Stock " + uuid.uuid4().hex}, 201)

    def move(self, owner, org, item, kind, delta, expected=201, **values):
        return self.call(owner, "POST", MOVES, {
            "organization_id": org["id"], "item_id": item["id"],
            "movement_type": kind, "quantity_delta": str(delta), **values,
        }, expected)

    def snapshot(self, item):
        engine = create_engine(self.database_url)
        try:
            with engine.connect() as connection:
                self.assertEqual(connection.scalar(text("SELECT current_database()")), self.database_url.database)
                return {
                    "item": connection.scalar(text("SELECT to_jsonb(i)::text FROM inventory_items i WHERE id=:id"), {"id": uuid.UUID(item["id"])}),
                    "history": list(connection.scalars(text("SELECT to_jsonb(m)::text FROM inventory_movements m WHERE item_id=:id ORDER BY sequence_number"), {"id": uuid.UUID(item["id"])})),
                }
        finally:
            engine.dispose()

    def assert_chain(self, owner, org, item, quantity, count):
        history = self.call(owner, "GET", f"{MOVES}?organization_id={org['id']}&item_id={item['id']}")
        self.assertEqual([row["sequence_number"] for row in history], list(range(count, 0, -1)))
        balance = Decimal("0")
        for row in reversed(history):
            self.assertEqual(Decimal(row["quantity_before"]), balance)
            self.assertEqual(Decimal(row["quantity_after"]), balance + Decimal(row["quantity_delta"]))
            self.assertEqual(row["actor_id"], owner["id"])
            balance = Decimal(row["quantity_after"])
        self.assertEqual(balance, Decimal(str(quantity)))
        saved = self.call(owner, "GET", f"{ITEMS}/{item['id']}?organization_id={org['id']}")
        self.assertEqual(Decimal(saved["current_quantity"]), balance)

    def race(self, owner, jobs):
        barrier = threading.Barrier(len(jobs))
        def invoke(job):
            method, path, body = job
            with httpx.Client(base_url=self.client.base_url, timeout=20, trust_env=False) as client:
                barrier.wait(timeout=10)
                return client.request(method, path, json=body, headers={"Authorization": f"Bearer {owner['token']}"})
        with ThreadPoolExecutor(max_workers=len(jobs)) as pool:
            return list(pool.map(invoke, jobs))

    def move_job(self, org, item, kind, delta):
        return ("POST", MOVES, {"organization_id": org["id"], "item_id": item["id"], "movement_type": kind, "quantity_delta": str(delta)})

    def test_all_movement_types_exact_balances_and_immutable_actor_history(self):
        owner, org = self.workspace()
        item = self.item(owner, org)
        steps = (("opening", 20, 20), ("receive", 5, 25), ("issue", -10, 15),
                 ("return", 8, 23), ("adjustment", -2, 21), ("adjustment", 2, 23))
        for sequence, (kind, delta, after) in enumerate(steps, 1):
            row = self.move(owner, org, item, kind, delta, notes="Count correction" if kind == "adjustment" else None,
                            actor_id=str(uuid.uuid4()), quantity_before="999", quantity_after="999")
            self.assertEqual(row["sequence_number"], sequence)
            self.assertEqual(Decimal(row["quantity_after"]), after)
            self.assertEqual(row["actor_id"], owner["id"])
            self.assert_chain(owner, org, item, after, sequence)
        row = self.move(owner, org, item, "receive", "0.25")
        self.assert_chain(owner, org, item, "23.25", 7)
        before = self.snapshot(item)
        path = f"{MOVES}/{row['id']}?organization_id={org['id']}"
        self.assertEqual(self.call(owner, "GET", path)["sequence_number"], 7)
        for method in ("PATCH", "DELETE", "PUT"):
            self.call(owner, method, path, {"quantity_delta": 99}, 405)
        self.assertEqual(self.snapshot(item), before)

    def test_invalid_movements_opening_rules_precision_and_overflow_leave_no_changes(self):
        owner, org = self.workspace()
        item = self.item(owner, org)
        self.move(owner, org, item, "receive", "1")
        invalid = (("opening", 1, {}, 409), ("issue", -2, {}, 409), ("receive", 0, {}, 422),
                   ("receive", -1, {}, 422), ("issue", 1, {}, 422), ("return", -1, {}, 422),
                   ("adjustment", 1, {}, 422), ("adjustment", 1, {"notes": " "}, 422),
                   ("receive", "0.001", {}, 422), ("receive", "NaN", {}, 422),
                   ("receive", "Infinity", {}, 422), ("receive", "-Infinity", {}, 422),
                   ("receive", 1, {"notes": "x\x00y"}, 422))
        for kind, delta, values, status in invalid:
            with self.subTest(kind=kind, delta=delta, values=values):
                before = self.snapshot(item)
                self.move(owner, org, item, kind, delta, expected=status, **values)
                self.assertEqual(self.snapshot(item), before)
        other_owner, other = self.workspace()
        self.move(other_owner, other, item, "receive", 1, expected=404)
        self.move(owner, org, {"id": str(uuid.uuid4())}, "receive", 1, expected=404)
        self.move(owner, org, item, "issue", -1)
        self.call(owner, "DELETE", f"{ITEMS}/{item['id']}?organization_id={org['id']}", expected=204)
        before = self.snapshot(item)
        self.move(owner, org, item, "receive", 1, expected=409)
        self.assertEqual(self.snapshot(item), before)
        maximum = self.item(owner, org)
        self.move(owner, org, maximum, "opening", "9999999999.99")
        before = self.snapshot(maximum)
        self.move(owner, org, maximum, "receive", "0.01", expected=422)
        self.assertEqual(self.snapshot(maximum), before)

    def test_concurrent_stock_changes_have_unique_contiguous_order_without_lost_updates(self):
        owner, org = self.workspace()
        for kind in ("receive", "issue", "insufficient", "opening"):
            for iteration in range(3):
                with self.subTest(kind=kind, iteration=iteration):
                    item = self.item(owner, org)
                    if kind in ("issue", "insufficient"):
                        self.move(owner, org, item, "opening", 10)
                    movement_type = "issue" if kind in ("issue", "insufficient") else kind
                    delta = -7 if kind == "insufficient" else (-3 if kind == "issue" else 1)
                    responses = self.race(owner, [self.move_job(org, item, movement_type, delta)] * 2)
                    if kind in ("insufficient", "opening"):
                        self.assertEqual(sorted(r.status_code for r in responses), [201, 409])
                    else:
                        self.assertEqual([r.status_code for r in responses], [201, 201])
                    expected_quantity, expected_count = {"receive": (2, 2), "issue": (4, 3), "insufficient": (3, 2), "opening": (1, 1)}[kind]
                    self.assert_chain(owner, org, item, expected_quantity, expected_count)

    def test_history_order_uses_sequence_even_when_timestamps_run_backwards(self):
        owner, org = self.workspace()
        item = self.item(owner, org)
        other = self.item(owner, org)
        for stock in (item, other):
            self.move(owner, org, stock, "opening", 10)
            self.move(owner, org, stock, "issue", -3)
            self.move(owner, org, stock, "issue", -3)
        engine = create_engine(self.database_url)
        try:
            with engine.begin() as connection:
                self.assertEqual(connection.scalar(text("SELECT current_database()")), self.database_url.database)
                # Reproduce saved transaction-start timestamp inversions using
                # disposable fixtures; application history remains immutable.
                connection.execute(text("UPDATE inventory_movements SET created_at=TIMESTAMPTZ '2026-11-04 10:00:00+00' - sequence_number * INTERVAL '1 minute' WHERE organization_id=:org"), {"org": uuid.UUID(org["id"])})
        finally:
            engine.dispose()
        self.assert_chain(owner, org, item, 4, 3)
        history = self.call(owner, "GET", f"{MOVES}?organization_id={org['id']}")
        for stock in (item, other):
            self.assertEqual([r["sequence_number"] for r in history if r["item_id"] == stock["id"]], [3, 2, 1])
        page = self.call(owner, "GET", f"{MOVES}?organization_id={org['id']}&limit=2&offset=1")
        self.assertEqual([r["id"] for r in page], [r["id"] for r in history[1:3]])

    def test_item_and_organization_archive_races_preserve_lock_order_and_history(self):
        owner, org = self.workspace()
        for scope in ("item", "organization"):
            for iteration in range(3):
                with self.subTest(scope=scope, iteration=iteration):
                    item = self.item(owner, org)
                    archive = (("DELETE", f"{ITEMS}/{item['id']}?organization_id={org['id']}", None) if scope == "item" else
                               ("POST", f"/organizations/{org['id']}/archive", {"confirmation_name": org["name"]}))
                    write, archived = self.race(owner, [self.move_job(org, item, "receive", 1), archive])
                    if scope == "item":
                        self.assertIn((write.status_code, archived.status_code), ((201, 409), (409, 204)))
                    else:
                        self.assertEqual(archived.status_code, 200)
                        self.assertIn(write.status_code, (201, 409))
                    self.assert_chain(owner, org, item, 1 if write.status_code == 201 else 0, 1 if write.status_code == 201 else 0)
                    if scope == "organization":
                        before = self.snapshot(item)
                        self.move(owner, org, item, "receive", 1, expected=409)
                        self.assertEqual(self.snapshot(item), before)
                        self.call(owner, "POST", f"/organizations/{org['id']}/restore", {"confirmation_name": org["name"]})

    def test_real_insert_failure_rolls_back_stock_history_and_sequence_allocation(self):
        from fastapi.testclient import TestClient
        from day9_server import create_app
        from app.main import app
        from app.models import InventoryMovement
        previous_overrides = app.dependency_overrides.copy()
        previous_lifespan = app.router.lifespan_context
        wrapped = create_app()
        item_id = None
        def fail_insert(_mapper, _connection, movement):
            if str(movement.item_id) == item_id:
                movement.actor_id = uuid.uuid4()  # Real FK failure in this isolated fixture only.
        try:
            with TestClient(wrapped, raise_server_exceptions=False) as client:
                suffix = uuid.uuid4().hex
                email, password = f"atomic-{suffix}@example.com", "Atomic!" + suffix
                response = client.post("/auth/register", json={"name": "Atomic fixture", "email": email, "password": password})
                self.assertEqual(response.status_code, 201)
                login = client.post("/auth/login", json={"email": email, "password": password})
                self.assertEqual(login.status_code, 200)
                headers = {"Authorization": "Bearer " + login.json()["access_token"]}
                response = client.post("/organizations", json={"name": "Atomic " + suffix}, headers=headers)
                self.assertEqual(response.status_code, 201)
                org = response.json()
                response = client.post(ITEMS, json={"organization_id": org["id"], "name": "Atomic stock"}, headers=headers)
                self.assertEqual(response.status_code, 201)
                item = response.json(); item_id = item["id"]
                before = self.snapshot(item)
                event.listen(InventoryMovement, "before_insert", fail_insert)
                payload = {"organization_id": org["id"], "item_id": item_id, "movement_type": "receive", "quantity_delta": "1"}
                response = client.post(MOVES, json=payload, headers=headers)
                self.assertEqual(response.status_code, 409, response.text[:300])
                self.assertEqual(self.snapshot(item), before)
                event.remove(InventoryMovement, "before_insert", fail_insert)
                response = client.post(MOVES, json=payload, headers=headers)
                self.assertEqual(response.status_code, 201)
                self.assertEqual(response.json()["sequence_number"], 1)
                self.assertEqual(response.json()["quantity_after"], "1.00")
        finally:
            if event.contains(InventoryMovement, "before_insert", fail_insert):
                event.remove(InventoryMovement, "before_insert", fail_insert)
            wrapped.engine.dispose()
            app.dependency_overrides.clear(); app.dependency_overrides.update(previous_overrides)
            app.router.lifespan_context = previous_lifespan


if __name__ == "__main__":
    unittest.main(verbosity=2)
