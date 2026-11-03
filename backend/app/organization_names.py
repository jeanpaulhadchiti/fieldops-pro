"""Canonical organization matching; display names remain human-readable."""

import re
import unicodedata


def clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def normalize_organization_name(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", clean_text(value).casefold())
    return "".join(character for character in decomposed if not unicodedata.combining(character))
