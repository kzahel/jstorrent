# 390 — Localized store listings and extension entry points

Status: **Complete; Play submitted and verified; Chrome 1.1.9 submitted
for review (October 29, 2026).** The maintainer authorizes planning,
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

The original Chrome dashboard blocker was a macOS keychain dialog for
Google Chrome for Testing. The maintainer cleared it. The resumed session
exposed the nineteen-language listing form but then encountered inconsistent
native action/readback and a Machine Control guardian failure, detailed below.
The supported Chrome API cannot save long descriptions, so do not call a staged
package a completed localized listing submission.

### Play delivery (October 29)

Implementation commit `96c1a27ff9ca11420ba180bb2083bd0d6ccb6ed6` is pushed to
main. Diff run [40854246101](https://github.com/kzahel/jstorrent/actions/runs/40854246101)
matched the exported baseline exactly and proposed 61 owned-field changes in
30 locales, including new `zh-TW`. Apply run
[40854376828](https://github.com/kzahel/jstorrent/actions/runs/40854376828)
validated, read back and committed the single edit successfully. A fresh
read-only export in
[40854495072](https://github.com/kzahel/jstorrent/actions/runs/40854495072)
matches all 30 reviewed catalogs exactly. The receipt is retained under
`distribution/store-listings/receipts/2026-10-29-play.json`. Google review and
public availability remain unverified; the public Play pages were inaccessible
to the web checker.

### Initial Chrome staging

The initial Chrome staging attempt 40854251913 failed before upload on an existing
web test's one-second canvas-render lookup (970 tests passed, one failed,
three skipped). The same complete suite passed locally, and no React source
changed here. The failed-job rerun passed all package gates and successfully
uploaded version 1.1.9 in
[40854251913, attempt 2](https://github.com/kzahel/jstorrent/actions/runs/40854251913/attempts/2).
The downloaded CI artifact has `sourceDirty: false`, source commit
`96c1a27ff9ca11420ba180bb2083bd0d6ccb6ed6`, and verified SHA-256
`462b09c1cc608f309f034b248559e3bb15f1bb268e7378ab6bbfd3d8be36ece6`.
The receipt explicitly says `staged-upload` / `reviewSubmitted: false`; 1.1.8
remains published. A durable receipt is retained alongside the Play receipt.
Full CI [40855333497](https://github.com/kzahel/jstorrent/actions/runs/40855333497)
and Fast CI [40855333476](https://github.com/kzahel/jstorrent/actions/runs/40855333476)
both passed for evidence commit `5e3af4fdaac41200173ca18fea13a049d7903d08`.

After desktop control is healthy, continue from the staged 1.1.9 dashboard
item. Regenerate `chrome-text`, save and reload-verify all
nineteen `chrome_full` descriptions against their mapped Chrome locales, then
run `scripts/release-extension.sh 1.1.9` from clean/current main. The normal
tag workflow runs the live compatibility matrix and submits review. Record
the actual submitted source in `compat/deliveries.json` and capture its client
with `scripts/compat-capture.mjs`. Do not claim completion, submit the package
ahead of those descriptions, or cancel an unrelated review. Public availability
must be checked separately after Google's review.

### Historical blocked resume after keychain dismissal

The maintainer reported the prompt resolved, and native observation confirmed
it was absent. The staged package exposes the expected nineteen language
choices. Native AX `set_value` and Save draft delivery were acknowledged, but
immediate Machine Control readback still showed old English copy. Separate
native Computer Use AX inspection later showed the desired English description
and disabled Save draft; captured pixels still showed old content. English
persistence has not been verified by a reload. No other locale description has
been written or verified, and no review submission or release tag was created.

The subsequent bounded desktop session ended with
`guardian_safety_unavailable` and `lockObserved: true`. Machine Control reported
`recovering` / `watchdog_interrupted` and refused further desktop input with
`desktop_locked_browser_only`; saved browser access remained available. This
is the current blocker, separate from the cleared keychain prompt. Private
Machine Control usage note 269 records the commands, inconsistent observations
and failure. No Machine Control code or security settings were changed. Resume
only through its normal healthy desktop-control admission, recheck English
from the server, and complete all nineteen exact catalog comparisons before
submission.

### Historical partial progress (October 29, 12:15 UTC)

The next authorized resume established a working input sequence: native paste
into the field updates the form model, followed by the native Save draft
accessibility action. Direct native `set_value` and acknowledged pointer
delivery were insufficient evidence. The English description was observed
matching the reviewed source after a complete reload. German was normalized
to the exact 1,399-character catalog value, read back exactly, and saved; native
readback then showed Save draft disabled and Submit for review enabled. Its
final reload verification remains pending. The other seventeen descriptions
remain pending. French was selected, but its edit did not start.

The bounded session then ended with `guardian_safety_unavailable` and an
observed lock. Desktop status reports `paused`; no automatic rearm or review
submission followed. The maintainer was asked to restore normal desktop
control. The partial receipt
`distribution/store-listings/receipts/2026-10-29-chrome-descriptions.json`
records the catalog fingerprint, German readback hash and remaining locales.
Continue from this state, verify English and German again, and finish the
seventeen remaining descriptions plus full reload comparisons before tagging.

The supported Chrome v2 reference was rechecked: its methods remain upload,
fetchStatus, publish, cancelSubmission and setPublishedDeployPercentage, with
no listing-text endpoint. Play text, Chrome package summaries, package upload
and review submission already have API/CI paths; only Chrome long descriptions
require this local dashboard step. No private RPC or browser credential copy
is introduced.

### Dashboard synchronization complete

All nineteen `chrome_full` values are now saved. The dashboard was fully
reloaded, then every locale was selected and its server-loaded description
compared exactly with the reviewed Git catalog. The current catalog generator
and per-locale SHA-256 checks confirm the same values after fast-forwarding
the other product-release documentation. The complete receipt replaces the
partial one at
`distribution/store-listings/receipts/2026-10-29-chrome-descriptions.json`.
There are no pending descriptions. At this pre-submission checkpoint, version
1.1.9 remained staged until the normal tagged workflow below succeeded.

Recovery used one mutation followed by clean completion and healthy
re-admission before accepting the next readback. All 125 intentionally short
600-second owner sessions ended cleanly with an observed lock; the maximum
owner wall duration was 168,668 ms. Normal lifecycle transitions produced
26 status-generation races and 13 status-interruption races, handled only by
fresh read-only inspection before further admission. A sanitized gap report
and proposed diagnostic probes are recorded in Machine Control; detailed
private session/state evidence is retained by its usage journal. No runtime,
watchdog, helper or security setting was changed. Desktop owners, debugger
sessions and the target claim were released before CI publication.

### Tagged Chrome submission complete

Tag `extension-v1.1.9` names clean source
`3f00e522c4907bf21ae6dd212bed6f39194f32e1`. Release workflow
[40883865810](https://github.com/kzahel/jstorrent/actions/runs/40883865810)
passes web typecheck/tests, all 75 extension tests, packaging and the 21-pair
live compatibility matrix (including the explicitly recorded legacy failures).
The downloaded package contains all nineteen native catalogs and its verified
SHA-256 is `462b09c1cc608f309f034b248559e3bb15f1bb268e7378ab6bbfd3d8be36ece6`.
It is byte-identical to the staged candidate; the clean build record now names
the actual tagged source. Read-only preflight run 40883654791 reported
1.1.8 published and no active submitted revision before tagging.

Google accepted 1.1.9 at 14:16 UTC with `PENDING_REVIEW`. The immutable package,
build record, checksum and original API receipt are attached to the
[GitHub release](https://github.com/kzahel/jstorrent/releases/tag/extension-v1.1.9).
The maintained submission receipt is
`distribution/store-listings/receipts/2026-10-29-chrome-submission.json`;
the separate dashboard receipt retains all nineteen exact description hashes.
The public unauthenticated Chrome update endpoint still serves 1.1.8 at the
submission checkpoint. Google review and public delivery are therefore pending.
A fresh independent read-only authentication/status run
[40889936649](https://github.com/kzahel/jstorrent/actions/runs/40889936649)
confirms published 1.1.8 and submitted 1.1.9 / `PENDING_REVIEW`.

The append-only delivery ledger records 1.1.9 as submitted, with no first-public
date. Its exact client decoder/schema capture is retained at
`compat/captures/3f00e522c4907bf21ae6dd212bed6f39194f32e1/`. This changes no host
contract, capabilities, strict-client policy or compatibility horizon.
Play's thirty catalogs remain API-verified after their separate submission.
The final ledger check accepts all 24 deliveries and required captures; 58
focused old-client, support-window and released-host cases pass with the new
client capture. Store-catalog checks and `git diff --check` pass. These records
meet this tactical's submission stopping condition.
