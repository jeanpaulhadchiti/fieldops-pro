# Bundled country data

`countries.json` contains all 249 ISO 3166-1 alpha-2 assignments and English display names generated from Node's maintained ICU/Unicode CLDR region display names on 2026-11-02. It is bundled at build time; forms never call a country REST service.

Sources: [ISO country codes](https://www.iso.org/iso-3166-country-codes.html), [Unicode CLDR](https://cldr.unicode.org/), [Unicode data license](https://www.unicode.org/license.txt).

The same canonical mapping is included in `backend/app/data/countries.json`. When updating the dataset, keep both copies synchronized, retain exactly the ISO assignments, run the country tests, and review names/aliases. Historical strings are displayed unchanged when unrecognized; new selections store alpha-2 codes.
