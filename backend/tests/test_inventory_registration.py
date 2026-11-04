"""Production startup, OpenAPI and archive dependency contracts without DB IO."""

import json
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

from sqlalchemy.engine import Engine


BACKEND = Path(__file__).resolve().parents[1]
EXPECTED = {
    ("/api/v1/inventory/categories", "GET"),
    ("/api/v1/inventory/categories", "POST"),
    ("/api/v1/inventory/categories/{category_id}", "GET"),
    ("/api/v1/inventory/categories/{category_id}", "PATCH"),
    ("/api/v1/inventory/categories/{category_id}", "DELETE"),
    ("/api/v1/inventory/locations", "GET"),
    ("/api/v1/inventory/locations", "POST"),
    ("/api/v1/inventory/locations/{location_id}", "GET"),
    ("/api/v1/inventory/locations/{location_id}", "PATCH"),
    ("/api/v1/inventory/locations/{location_id}", "DELETE"),
    ("/api/v1/inventory/items", "GET"),
    ("/api/v1/inventory/items", "POST"),
    ("/api/v1/inventory/items/{item_id}", "GET"),
    ("/api/v1/inventory/items/{item_id}", "PATCH"),
    ("/api/v1/inventory/items/{item_id}", "DELETE"),
    ("/api/v1/inventory/items/{item_id}/restore", "POST"),
    ("/api/v1/inventory/movements", "GET"),
    ("/api/v1/inventory/movements", "POST"),
    ("/api/v1/inventory/movements/{movement_id}", "GET"),
}


def registered_routes(routes, prefix="", inherited=()):
    """Handle both eager APIRoute lists and lazily included FastAPI routers."""
    for route in routes:
        original = getattr(route, "original_router", None)
        if original is not None:
            context = route.include_context
            yield from registered_routes(
                original.routes, prefix + context.prefix,
                inherited + tuple(context.dependencies or ()),
            )
        elif getattr(route, "path", "").startswith("/api/v1/inventory/"):
            direct = tuple(getattr(route, "dependencies", ()))
            dependency_calls = {
                getattr(dependency, "dependency", None)
                for dependency in (*inherited, *direct)
            }
            dependency_calls.update(
                dependency.call for dependency in route.dependant.dependencies
            )
            for method in route.methods:
                yield prefix + route.path, method, dependency_calls


class InventoryProductionRegistration(unittest.TestCase):
    def test_fresh_production_import_and_openapi_include_every_inventory_operation(self):
        # A new interpreter catches missing imports even when another test has
        # already cached app.main. No import may open a database connection.
        script = """
import json
from unittest.mock import patch
from sqlalchemy.engine import Engine
with patch.object(Engine, 'connect', side_effect=AssertionError('Import accessed DB')), patch.object(Engine, 'raw_connection', side_effect=AssertionError('Import accessed DB')):
    from app.main import app
    schema = app.openapi()
    print(json.dumps([(path, method.upper()) for path, methods in schema['paths'].items() if path.startswith('/api/v1/inventory/') for method in methods if method in {'get','post','patch','delete'}]))
"""
        result = subprocess.run(
            [sys.executable, "-B", "-c", script], cwd=BACKEND,
            capture_output=True, text=True, timeout=20,
        )
        self.assertEqual(result.returncode, 0, result.stderr[-2000:])
        self.assertEqual({tuple(operation) for operation in json.loads(result.stdout)}, EXPECTED)

    def test_inventory_routes_have_no_conflicts_and_every_write_uses_shared_guard(self):
        with patch.object(Engine, "connect", side_effect=AssertionError("Import accessed DB")), \
             patch.object(Engine, "raw_connection", side_effect=AssertionError("Import accessed DB")):
            from app.main import app
            from app.services.archive import guard_workspace_mutation
            operations = list(registered_routes(app.routes))
        pairs = [(path, method) for path, method, _calls in operations]
        self.assertEqual(set(pairs), EXPECTED)
        self.assertEqual(len(pairs), len(set(pairs)), "Conflicting inventory method/path registration")
        for path, method, calls in operations:
            if method in {"POST", "PATCH", "DELETE"}:
                with self.subTest(method=method, path=path):
                    self.assertIn(guard_workspace_mutation, calls)


if __name__ == "__main__":
    unittest.main(verbosity=2)
