"""The application handler preserves standard finite-error response contracts."""

import unittest

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient

from app.schemas.inventory_item import InventoryItemCreate
from app.schemas.participant import ParticipantCreate
from app.schemas.user import UserCreate, UserLogin
from app.validation import safe_request_validation_handler


def validation_app(custom_handler):
    app = FastAPI()
    if custom_handler:
        app.add_exception_handler(RequestValidationError, safe_request_validation_handler)

    @app.post("/validate")
    def validate(data: InventoryItemCreate):
        return data

    @app.post("/register")
    def register(data: UserCreate):
        return data

    @app.post("/login")
    def login(data: UserLogin):
        return data

    @app.post("/participants")
    def participant(data: ParticipantCreate):
        return data

    return app


class ValidationErrorResponses(unittest.TestCase):
    def test_unrelated_authentication_and_participant_error_formats_are_unchanged(self):
        cases = (
            ("/register", {}),
            ("/register", {"name": "Person", "email": "invalid", "password": "Validpassword!"}),
            ("/register", {"name": "Person", "email": "person@example.com", "password": "lowercasewithoutpunctuation"}),
            ("/login", {"email": "invalid", "password": "Provided password"}),
            ("/participants", {"organization_id": "invalid", "full_name": "Person"}),
            ("/participants", {"organization_id": "5d2940a0-051e-4bad-8d0f-a1f49b12153a", "full_name": "  "}),
        )
        with TestClient(validation_app(False)) as standard, TestClient(validation_app(True)) as application:
            for path, payload in cases:
                with self.subTest(path=path, payload=payload):
                    expected = standard.post(path, json=payload)
                    actual = application.post(path, json=payload)
                    self.assertEqual(actual.status_code, 422)
                    self.assertEqual(actual.json(), expected.json())

    def test_ordinary_errors_match_fastapi_default_exactly(self):
        with TestClient(validation_app(False)) as standard, TestClient(validation_app(True)) as application:
            invalid = (
                {},
                {"organization_id": "invalid", "name": "Valid"},
                {"organization_id": "5d2940a0-051e-4bad-8d0f-a1f49b12153a", "name": "  "},
                {"organization_id": "5d2940a0-051e-4bad-8d0f-a1f49b12153a", "name": "Valid", "minimum_quantity": -1},
                {"organization_id": "5d2940a0-051e-4bad-8d0f-a1f49b12153a", "name": "Valid", "current_quantity": 1},
                {"organization_id": "5d2940a0-051e-4bad-8d0f-a1f49b12153a", "name": "Valid", "minimum_quantity": "NaN"},
            )
            for payload in invalid:
                with self.subTest(payload=payload):
                    expected = standard.post("/validate", json=payload)
                    actual = application.post("/validate", json=payload)
                    self.assertEqual(actual.status_code, expected.status_code)
                    self.assertEqual(actual.json(), expected.json())
                    self.assertEqual(actual.headers["content-type"], expected.headers["content-type"])
            expected = standard.post("/validate", content="{", headers={"Content-Type": "application/json"})
            actual = application.post("/validate", content="{", headers={"Content-Type": "application/json"})
            self.assertEqual(actual.status_code, 422)
            self.assertEqual(actual.json(), expected.json())

    def test_raw_nonfinite_nested_error_inputs_are_serializable_without_acceptance(self):
        with TestClient(validation_app(True)) as client:
            for token in ("NaN", "Infinity", "-Infinity"):
                with self.subTest(token=token):
                    # A nested protected extra exercises recursive error-input
                    # sanitization as well as the decimal field failure.
                    response = client.post("/validate", content=(
                        '{"organization_id":"5d2940a0-051e-4bad-8d0f-a1f49b12153a",'
                        '"name":"Valid","minimum_quantity":' + token + ',"unknown":{"nested":[' + token + ']}}'
                    ), headers={"Content-Type": "application/json"})
                    self.assertEqual(response.status_code, 422)
                    errors = response.json()["detail"]
                    self.assertEqual(next(error["input"] for error in errors if error["loc"] == ["body", "minimum_quantity"]), token)
                    self.assertEqual(next(error["input"] for error in errors if error["loc"] == ["body", "unknown"]), {"nested": [token]})


if __name__ == "__main__":
    unittest.main(verbosity=2)
