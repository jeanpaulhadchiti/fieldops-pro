"""Bundled ISO 3166-1 codes with English Unicode CLDR display names.

Historical free-text values are read unchanged. New selections use alpha-2;
known legacy names/codes are compared canonically without rewriting records.
"""
import json
from pathlib import Path

from app.organization_names import clean_text, normalize_organization_name

COUNTRIES = json.loads((Path(__file__).parent / 'data/countries.json').read_text(encoding='utf-8'))
_LOOKUP = {normalize_organization_name(value): code for code, name in COUNTRIES.items() for value in (code, name)}
_LOOKUP.update({normalize_organization_name(alias): code for alias, code in {
    'United States of America': 'US', 'USA': 'US', 'UK': 'GB', 'Great Britain': 'GB',
    'Turkey': 'TR', 'Türkiye': 'TR', 'Czech Republic': 'CZ', 'Russian Federation': 'RU',
    'Korea, Republic of': 'KR', 'Republic of Korea': 'KR', 'Viet Nam': 'VN',
    'Iran, Islamic Republic of': 'IR', 'Syrian Arab Republic': 'SY',
    'Holy See': 'VA', 'Vatican': 'VA', 'Palestine': 'PS',
}.items()})


def country_code(value):
    return _LOOKUP.get(normalize_organization_name(value or ''))


def normalize_country(value, *, allow_legacy=False):
    if value is None:
        return None
    cleaned = clean_text(value)
    if not cleaned:
        return None
    code = country_code(cleaned)
    if code:
        return code
    if allow_legacy:
        return cleaned
    raise ValueError('Select a valid ISO 3166-1 country')


def countries_match(first, second):
    return (country_code(first) or normalize_organization_name(first or '')) == (country_code(second) or normalize_organization_name(second or ''))
