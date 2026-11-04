"""Inventory request validation and seed behavior without database access."""

import importlib.util
import io
from contextlib import redirect_stdout
from pathlib import Path
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import Mock, patch
import uuid

from pydantic import ValidationError

from app.schemas.inventory_category import InventoryCategoryCreate, InventoryCategoryUpdate


class InventoryCategoryValidation(unittest.TestCase):
    def inputs(self, **values):
        return (
            (InventoryCategoryCreate, {"organization_id": uuid.uuid4(), **values}),
            (InventoryCategoryUpdate, values),
        )

    def test_create_and_update_trim_names_before_length_validation(self):
        for name in ("First Aid", "x" * 100):
            for schema, values in self.inputs(name=f" \t{name}\n "):
                with self.subTest(schema=schema.__name__, length=len(name)):
                    self.assertEqual(schema(**values).name, name)

    def test_create_and_update_reject_blank_and_overlong_names(self):
        for name in ("", " ", "\t\r\n", "\u2003\u00a0", "x" * 101):
            for schema, values in self.inputs(name=name):
                with self.subTest(schema=schema.__name__, name=repr(name)):
                    with self.assertRaises(ValidationError):
                        schema(**values)

    def test_create_and_update_reject_nul_in_names_and_descriptions(self):
        for field in ("name", "description"):
            for value in ("\x00", "before\x00after", "value\x00"):
                for schema, values in self.inputs(**{"name": "Valid", field: value}):
                    with self.subTest(schema=schema.__name__, field=field, value=repr(value)):
                        with self.assertRaises(ValidationError):
                            schema(**values)

    def test_case_and_description_whitespace_are_preserved(self):
        for schema, values in self.inputs(name="  First Aid  ", description="  Details\n"):
            with self.subTest(schema=schema.__name__):
                data = schema(**values)
                self.assertEqual(data.name, "First Aid")
                self.assertEqual(data.description, "  Details\n")
        self.assertNotEqual(
            InventoryCategoryUpdate(name="Tent").name,
            InventoryCategoryUpdate(name="tent").name,
        )

    def test_description_length_and_type_validation_are_retained(self):
        for description in ("x" * 501, 123):
            for schema, values in self.inputs(name="Valid", description=description):
                with self.subTest(schema=schema.__name__, description=repr(description)):
                    with self.assertRaises(ValidationError):
                        schema(**values)
        for description in (None, "", "x" * 500):
            for schema, values in self.inputs(name="Valid", description=description):
                with self.subTest(schema=schema.__name__, length=len(description or "")):
                    self.assertEqual(schema(**values).description, description)

    def test_create_requires_name_and_organization_and_rejects_invalid_types(self):
        for values in (
            {"organization_id": uuid.uuid4()},
            {"name": "Valid"},
            {"organization_id": "invalid", "name": "Valid"},
            {"organization_id": uuid.uuid4(), "name": None},
            {"organization_id": uuid.uuid4(), "name": 123},
        ):
            with self.subTest(values=values):
                with self.assertRaises(ValidationError):
                    InventoryCategoryCreate(**values)

    def test_update_allows_omitted_name_but_rejects_explicit_null(self):
        self.assertEqual(InventoryCategoryUpdate().model_fields_set, set())
        self.assertEqual(
            InventoryCategoryUpdate(description=None).model_fields_set,
            {"description"},
        )
        for name in (None, 123):
            with self.subTest(name=name):
                with self.assertRaises(ValidationError):
                    InventoryCategoryUpdate(name=name)


class InventoryMembershipSeed(unittest.TestCase):
    @staticmethod
    def load_seed():
        # Importing a seed must never open a session, including during a regression.
        database = ModuleType("app.database")
        database.SessionLocal = Mock(side_effect=AssertionError("Seed import attempted database access"))
        path = Path(__file__).resolve().parents[1] / "seed_test_membership.py"
        spec = importlib.util.spec_from_file_location("inventory_membership_seed_test", path)
        module = importlib.util.module_from_spec(spec)
        with patch.dict("sys.modules", {"app.database": database}):
            spec.loader.exec_module(module)
        return module, database.SessionLocal

    def test_import_does_not_open_a_database_session(self):
        _, session_factory = self.load_seed()
        session_factory.assert_not_called()

    def test_new_membership_uses_canonical_owner_role(self):
        module, _ = self.load_seed()
        user = SimpleNamespace(id=uuid.uuid4(), name="Seed user")
        organization = SimpleNamespace(id=uuid.uuid4(), name="Seed organization")
        session = Mock()
        session.scalar.side_effect = [user, organization, None]
        with redirect_stdout(io.StringIO()):
            module.seed_membership(session)
        session.add.assert_called_once()
        membership = session.add.call_args.args[0]
        self.assertEqual(membership.user_id, user.id)
        self.assertEqual(membership.organization_id, organization.id)
        self.assertEqual(membership.role, "Owner")
        session.commit.assert_called_once()

    def test_existing_legacy_role_is_not_rewritten(self):
        module, _ = self.load_seed()
        existing = SimpleNamespace(role="owner")
        session = Mock()
        session.scalar.side_effect = [SimpleNamespace(id=uuid.uuid4()), SimpleNamespace(id=uuid.uuid4()), existing]
        with redirect_stdout(io.StringIO()):
            module.seed_membership(session)
        self.assertEqual(existing.role, "owner")
        session.add.assert_not_called()
        session.commit.assert_not_called()

    def test_missing_user_or_organization_does_not_write(self):
        module, _ = self.load_seed()
        for results in ([None, SimpleNamespace(id=uuid.uuid4())], [SimpleNamespace(id=uuid.uuid4()), None]):
            with self.subTest(results=results):
                session = Mock()
                session.scalar.side_effect = results
                with redirect_stdout(io.StringIO()):
                    module.seed_membership(session)
                session.add.assert_not_called()
                session.commit.assert_not_called()


if __name__ == "__main__":
    unittest.main(verbosity=2)
