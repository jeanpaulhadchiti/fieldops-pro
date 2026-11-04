"""Keep rejected non-finite JSON inputs serializable in validation responses."""

from decimal import Decimal
import math

from fastapi.encoders import jsonable_encoder
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi import Request
from starlette.responses import JSONResponse


def _json_safe_nonfinite(value):
    """Replace only non-finite numbers, including those in nested error inputs."""
    if isinstance(value, float) and not math.isfinite(value):
        if math.isnan(value):
            return "NaN", True
        return "Infinity" if value > 0 else "-Infinity", True
    if isinstance(value, Decimal) and not value.is_finite():
        return str(value), True
    if isinstance(value, dict):
        result = {}
        changed = False
        for key, item in value.items():
            result[key], item_changed = _json_safe_nonfinite(item)
            changed = changed or item_changed
        return result, changed
    if isinstance(value, (list, tuple)):
        result = []
        changed = False
        for item in value:
            safe_item, item_changed = _json_safe_nonfinite(item)
            result.append(safe_item)
            changed = changed or item_changed
        return result, changed
    return value, False


async def safe_request_validation_handler(request: Request, exc: RequestValidationError):
    # Pydantic has already rejected the request. This changes only the error
    # representation, never the input accepted by a schema or an endpoint.
    errors, changed = _json_safe_nonfinite(exc.errors())
    if not changed:
        return await request_validation_exception_handler(request, exc)
    return JSONResponse(status_code=422, content={"detail": jsonable_encoder(errors)})
