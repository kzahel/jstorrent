# Production store listings

`en.json` owns the English Play title/short/full descriptions and Chrome full
listing description. Other locale files are first-party translations, reviewed
through `scripts/localization.py store LOCALE`; source, terminology and actual
independent session identities are recorded under `localization/store`.
Repository licensing applies. No third-party translation is imported.

`locales.json` maps canonical catalog tags to store-specific language codes.
Store listing languages are independent of application UI language availability.
All existing Play listing locales are retained; Traditional Chinese is added.
Chrome locales match the nineteen shipping React locales. Extension summaries,
popup and setup text live under `clients/extension/locales`, with review records
under `localization/extension` and generated native Chrome `_locales` catalogs.

The dated baseline JSON files preserve the maintainer-owned production listing
text exported from the existing store accounts/public item before this campaign.
They are historical evidence, not translation input or review approval for the
replacement catalogs. The Play baseline came from Actions run 40848405954;
the Chrome baseline came from its public version 1.1.8 listing.

Historical `clients/android/play/listing` belongs to the retired Canary listing.
It must never be used to publish production JSTorrent metadata.

## Commands

```bash
python3 scripts/store-listings.py generate
python3 scripts/store-listings.py check
python3 scripts/store-listings.py chrome-text --out .local/chrome-listing-text.json
python3 -m unittest discover -s scripts -p test_store_listings.py
```

Remote operations require a short-lived `PLAY_ACCESS_TOKEN`. They are normally
run by the **Store listings** Actions workflow, which shares `android-play`
concurrency with all release and rollout edits. Its app-scoped keyless identity
needs read-only app information and Manage store presence, with no release,
financial or administration permission. Google may bundle related declaration
access with store presence; the publisher never calls declaration endpoints.

1. `export --out baseline.json` reads all Play listing fields and discards the
   temporary edit. Preserve/export production text before changing it.
2. `diff --out plan.json` compares reviewed catalogs with a fresh remote
   snapshot, includes exact before/after text and both fingerprints, then
   discards the edit. CI retains the artifact for inspection.
3. `apply --plan plan.json --out receipt.json` requires that exact remote and
   catalog state. Existing locales use PATCH to preserve promotional video;
   new locales use a complete three-field PUT. Saved values and untouched
   locales are read back before validation and a single protected commit.
   Apply never changes tracks, countries, pricing, privacy or image assets.

The workflow's apply operation takes a successful diff run ID at the exact
same main commit. It verifies the artifact's workflow/source before use. A
concurrent Console edit invalidates a transaction or changes its fingerprint;
export and inspect a fresh diff rather than replaying it. A commit with an
unknown result is never retried or deleted. Reconcile it in Play Console.
API acceptance is not proof of completed Google review or public availability.

Chrome's supported v2 API uploads packages and submits review but cannot write
long descriptions or screenshots. Upload the localized package using the
existing extension release workflow, synchronize the matching reviewed
`chrome_full` values through the developer dashboard, verify each saved value,
and submit the combined change. Do not add private dashboard RPCs or browser
cookies to CI. The default icon and graphics remain valid fallbacks for locales
without their own images; image replacement is an explicit separate operation.
