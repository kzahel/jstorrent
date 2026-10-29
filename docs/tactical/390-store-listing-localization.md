# 390 — Localized store listings and extension entry points

Status: **Active (October 29, 2026).** The maintainer authorizes planning,
implementation, translation, independent review, CI setup and delivery through
the existing production Google Play and Chrome Web Store identities.

## Scope and stopping condition

Own production listing text in Git, refresh all 29 existing Play listing
locales and add Traditional Chinese, and localize the extension's manifest,
popup and packaged setup/recovery pages in the nineteen shipping UI locales.
Reuse the source-bound translation/review workflow and keyless Google
authentication. Add a standalone Play metadata workflow with export, checks,
diff and apply; Chrome long descriptions use a verified dashboard sync because
the supported v2 API has no metadata endpoint. Localized release-note support
and reproducible screenshot delivery belong to the maintained publishing
tools; capture current localized screenshots where useful without replacing
accurate assets merely to change their language.

Finish when reviewed catalogs and tools are committed, relevant local and CI
checks pass, Play listing changes and a localized extension are submitted, and
Chrome's localized descriptions are saved and submitted. Record API acceptance,
Google review, staged publication and observed public availability separately.
An inaccessible permission or human-only authentication gate must be recorded
precisely; continue all independent work before reporting it.

## Invariants and limits

- Preserve production IDs, keys, permissions, privacy declarations, countries,
  pricing, rollout plans, installed user data and the existing release lanes.
- Listing-language availability does not enable application UI languages.
  Preserve all existing Play translations; add `zh-TW` explicitly.
- Git owns English source, locale mappings, first-party translations, source
  and terminology fingerprints, independent reviewer identities and delivery
  receipts without credentials or private account configuration.
- Use existing local translation workers and separate translation/review
  sessions, at most three workers total. Keep bounded, resumable task state
  under ignored `.local`; cancel and join task-owned processes.
- Play metadata operations share `android-play` concurrency with releases and
  rollouts. Export/diff discard their temporary edit. Apply validates and
  commits once with `ERROR_IF_IN_REVIEW`; never retry an uncertain commit.
  Never clear unowned fields, delete other locales, or alter tracks while
  applying listing text. Recheck the planned remote baseline before applying.
- Reuse OIDC/WIF. Grant only JSTorrent-scoped store-presence access as needed;
  no service-account keys, credentials in artifacts, or financial/admin access.
- Extension strings use Chrome's native i18n with English fallback. Preserve
  text/link semantics, safe DOM construction and mixed-version behavior.
- Chrome's existing upload/publish API remains authoritative for package
  delivery. Do not introduce private dashboard RPCs or session cookies in CI.

## Investigation and source evidence

Read-only Play Console inspection found 29 listing locales. English has the
current 918-character native-app/requirements description; German and French
still have the older description. Traditional Chinese is absent. The public
Chrome listing serves English descriptions under both English and German and
advertises English only. Its bundled React UI is translated, but the manifest,
popup and Crostini setup/connect pages are separate English surfaces.
`clients/android/play/listing` is historical Canary material, not production.

Official interfaces consulted (October 29):

- `https://developers.google.com/android-publisher/api-ref/rest/v3/edits.listings`
- `https://developers.google.com/android-publisher/api-ref/rest/v3/edits.images`
- `https://developers.google.com/android-publisher/api-ref/rest/v3/edits/commit`
- `https://developers.google.com/android-publisher/api-ref/rest/v3/grants`
- `https://developer.chrome.com/docs/webstore/api/reference/rest`
- `https://developer.chrome.com/docs/webstore/cws-dashboard-listing`
- `https://developer.chrome.com/docs/extensions/reference/api/i18n`

The discovery documents confirm Play listing/image methods and no Chrome v2
listing-text method. Chrome listing locales follow packaged `_locales`.
Play limits are 30/80/4,000 characters; release notes allow 500 per locale.
Existing Play publisher already uses transactional edits and review protection;
both stores already use short-lived Google credentials in Actions. Fastlane
adds no required capability and is not added.

## Ordered implementation and validation

1. Commit this plan. Export the actual production Play text and Chrome copy;
   retain a baseline with provenance and explicit store-locale mappings.
2. Add production source catalogs, checked translation adapters and extension
   native i18n extraction/runtime. Preserve inline markup using bounded named
   slots or existing DOM, never untrusted translated HTML.
3. Extend Play metadata and localized release-note tooling, add focused fake-API
   tests and CI checks/workflow. Verify WIF and app-scoped listing permission.
4. Translate and independently review store text (30 Play locales) and
   extension entry points (19 locales). Validate limits, placeholders, source
   freshness, packaged locales and English fallback.
5. Run extension tests/package checks, translation workflow tests, relevant
   web typecheck/tests and browser smoke checks on a separate test browser.
   Review representative German, French, Japanese, Chinese and long/RTL copy.
6. Commit and push verified implementation, configure the bounded metadata
   workflow, review its exact diff and apply the Play text. Preserve receipt
   and review state. Generate/capture localized screenshots proportionately.
7. Release the localized extension through the existing tag-driven workflow,
   synchronize Chrome descriptions in its dashboard and submit. Update this
   tactical and the localization/releasing documentation with actual evidence.

No engine, application-contract, database, app UI language-policy, website
localization, consent-policy or new release-platform changes are included.

## Execution evidence

The production baseline contains 29 Play locales and Chrome 1.1.8's English
copy. The new catalogs retain every Play locale and add `zh-TW`; the nineteen
extension locales match the shipping React language registry. All 175 extension
messages and four store fields use the existing source-bound translation and
independent review importer, with actual session identities in the per-message
ledgers. The initial campaign completed all 47 non-English platform/locale jobs
(3,284 resources before removing one non-display protocol token from each
extension catalog). A second store-only campaign completed all 29 review jobs
and updates both full descriptions
after checking the actual production version: Play still serves 1.0.33, while
native nineteen-language support starts with 1.0.34. Copy qualifies that version
and distinguishes the bundled browser library from installed native apps.

The separate Play listings service account has no user-managed keys. Its
GitHub environment is main-only and its WIF subject is limited to the manual
metadata workflow. Play access is app-scoped store presence plus the read and
related declaration permissions Google bundles with it; no release, financial
or administration access. Read-only Actions run 40848405954 successfully
exported production metadata. Managed publishing is off; this workflow never
publishes unrelated pending changes through Console controls.

Local qualification passes: 61 translation-workflow tests, 42 Play-publisher
tests, seven store transaction tests, 75 extension tests, ten fast-CI selection
tests, web typecheck and 971 web tests (three skipped), workflow actionlint,
branding and package validation. Chrome for Testing loads each of nineteen
native catalogs in an isolated profile, checks the reviewed summary, original
Play link, named slots and layout at 360px popup / 390px setup and connection
widths, and
records no page errors or horizontal overflow. German, Japanese and Traditional
Chinese captures were visually reviewed. This uses each exact catalog as the
native default/fallback; macOS retains `en-US` as its Chrome UI language, so
automatic OS language selection is not claimed. Existing store graphics remain
accurate fallbacks and are not replaced in a text localization transaction.

The Chrome dashboard is presently blocked by a macOS keychain dialog for
Google Chrome for Testing. Computer Use refuses SecurityAgent access. A human
has been asked to click Deny; no password or keychain grant is needed. Continue
Play delivery and CI package staging independently. The supported Chrome API
cannot save long descriptions, so do not call a staged package a completed
localized listing submission.
