# Tactical 208: Installation Metrics And Feedback Parity

Status: **Implementation complete with release qualification pending as of
2026-09-01.** Native desktop and Android product state, crash-safe semantic
counters, disclosure/preferences/reset, previewed feedback, desktop updater
identity migration, and extension-local uninstall metrics have landed. The
hosted JSTorrent source is truthful, but it has not been deployed or publicly
verified; optional identifier/counter query fields therefore remain disabled
behind explicit fail-closed release constants. Physical ChromeOS and Apple
compile qualification also remain open.

Topics: `product-state-and-feedback`, `product-surfaces-and-migration`,
`client-persistence`, `application-control`, `client-surfaces`,
`beta-release-readiness`, `localization`, `capability-readiness`

Dependencies: active desktop updater Tactical
[`158`](158-desktop-signed-packaging-and-updater.md), completed desktop
lifecycle Tactical
[`162`](162-desktop-single-instance-and-tray-lifecycle.md), completed
ChromeOS Android extension Tactical
[`194`](194-chromeos-android-extension-control.md), completed Android product
lifecycle Tactical
[`200`](200-android-product-background-lifecycle.md), completed localization
Tactical [`204`](204-cross-product-localization-foundation.md), and completed
Android feedback Tactical
[`206`](206-android-jstorrent-feedback-handoff.md), and completed Android
clear-data Tactical [`207`](207-android-safe-reset-and-clear-data.md). The
implementation reconciles Tactical `207`: Reset engine settings preserves
product state, while either clear-data outcome removes the fixed no-backup
product-state root.

## Decision And Product Outcome

Implement one closed, low-frequency product-state capability rather than a
general telemetry system:

1. Native engine-owning products retain one random, resettable installation
   identity and a few exact semantic counters in installation-wide
   `product.db`, above every profile.
2. The existing desktop updater adopts that identity in place of its separate
   `cfu-id` file and continues using it only for disclosed active-install
   counting.
3. Shared React and Android Compose feedback actions preview the optional
   product context and require one visible confirmation before opening the
   existing JSTorrent feedback page.
4. The RSTorrent extension retains its own extension-install identity and
   small local usage summary, then maintains a bounded JSTorrent uninstall URL
   through `chrome.runtime.setUninstallURL()`.
5. A default-on **Include pseudonymous usage statistics** preference controls
   every transmission of stable identity or aggregate counters. The initial
   disclosure permits changing it before richer transmission begins, and a
   separate reset action rotates identity and clears statistics without
   touching torrents or payload.

This is intentional JSTorrent product continuity. It is not continuous
analytics, crash upload, advertising measurement, account identity, or a
third-party telemetry SDK. The implementation sends no background metric
events. Ordinary request metadata remains controlled by browsers, operating
systems, and servers rather than being described as anonymous.

## Stable Scenarios And Stopping Condition

### IMF-001: One Native Installation Identity

Fresh durable desktop and Android product data create one cryptographically
random UUIDv4 plus an exact creation time. Profile deletion, application-
service restart, update, repair, foreground/background transitions, webview
replacement, and ChromeOS extension reconnection preserve it. A desktop with
a valid existing `cfu-id` transactionally adopts that exact UUID before the
legacy file stops being an authority; malformed/missing input generates one
new UUID. No second native analytics UUID exists.

The store is not intentionally synchronized through an operating-system or
browser account. Android places it in app-private storage excluded from cloud
backup; Android uninstall, OS **Clear storage**, or Tactical `207` clear data
therefore creates a fresh identity. Desktop keeps it in the existing
application-config lifetime, so an explicit file-level backup/restore also
restores the disclosed identity and summary. The extension follows
`chrome.storage.local`: removal clears its record and a later reinstall is a
new extension installation.

The identity is never derived from a profile, peer, pairing, report, account,
path, package-install token, device property, or hardware fingerprint. It is
never accepted as authentication or torrent authority. The UI and privacy
copy call it a pseudonymous installation identifier, not an anonymous ID.

### IMF-002: Exact Crash-Safe Native Counters

`torrents_added` advances once when a new durable catalog incarnation is
created. Invalid input, rejected duplicate, replayed command receipt, and a
no-op do not advance it; removing and later creating another catalog record
does. `downloads_completed` advances once when an incarnation that began
incomplete first becomes complete because downloaded bytes were durably
verified. Restore, import of already complete data, startup reconciliation,
Force recheck, repeated completion notification, and complete-data adoption do
not advance it.

The authoritative profile transition and a sequenced product milestone enter
the profile database in the same transaction. An ordered bounded outbox and an
idempotent product-store watermark make every crash point converge without a
miss or double count. Product-state failure is observable but cannot reject,
roll back, pause, or invalidate the torrent transition.

`foreground_sessions` advances only on these adapter-owned intentional
activation epochs:

- desktop: a cold visible launch or a hidden/no-window to visible transition,
  excluding updater-only, headless-service, diagnostic, duplicate-focus, and
  already-visible activation;
- Android: the process lifecycle's transition into foreground, which suppresses
  activity recreation and configuration changes; extension-only attachment
  does not count a Compose session; and
- extension: creation of one user-visible popup or application document,
  counted once for that document despite reconnects or rerenders.

If a maintained platform cannot prove that boundary, it omits the counter and
marks it unsupported rather than silently substituting process starts or
transport reconnects.

### IMF-003: Disclosure, Disable, And Reset

The first version that can transmit richer context shows a localized,
versioned disclosure before that transmission. Its statistics checkbox is on
by default and can be turned off before continuing. Existing installations
that have not acknowledged the new disclosure keep the richer feedback and
uninstall fields disabled; the desktop updater may retain only its already
disclosed preexisting `cfu-id` behavior until acknowledgement. New installs
record the choice during first-use presentation. Headless or otherwise
noninteractive configurations default to no stable-ID transmission.

Turning the preference off is durable and immediately:

- removes `X-CFU-Id` from later desktop update checks;
- makes feedback navigation omit installation ID, age, and counters; and
- clears the extension uninstall URL's stable ID and usage values while
  retaining the survey destination.

Local counters may continue while disabled. **Reset usage statistics and
identifier** creates a new UUID and creation time and zeroes counters in one
transaction. Reset does not remove profiles, torrents, roots, payload,
settings, pairing, prompts unrelated to the statistics generation, or server
records already received. Either Tactical `207` clear-data outcome resets the
identity and statistics; **Reset engine settings** preserves them.

### IMF-004: Previewed Feedback Context

The shared React product and Android Advanced Settings expose a localized
feedback confirmation that names the external JSTorrent page and visibly
lists every value about to enter the URL. A checkbox initially follows the
durable statistics preference and may omit pseudonymous context for this one
navigation without changing the preference. Cancel opens nothing and changes
nothing.

The URL uses the smallest applicable subset of this closed allowlist:

| Field | Meaning |
| --- | --- |
| `platform`, `v` | Product surface and application version |
| `id` | Resettable pseudonymous installation UUID |
| `days` | Whole nonnegative days since product-state creation |
| `added` | Saturating successfully-added counter |
| `completed` | Saturating completed-through-download counter |
| `sessions` | Supported intentional foreground-session counter |
| `connected` | Whether an extension has ever attached successfully |
| `android`, `device` | Existing Android OS release and manufacturer/model context |

The confirmation explains that navigating can disclose included values to
browser history, website logs/referrers, the embedded Google Form, and the
page's Cloudflare analytics before any form is submitted. Installation and
usage fields are omitted when disabled or unchecked; version/platform and the
existing Android environment fields remain visible and may still be sent.
Construction remains strict HTTPS, deterministic, normally ordered, UTF-8
encoded, and bounded to 2 KiB. Over-bound input fails visibly rather than
truncating or dropping an arbitrary field.

### IMF-005: Extension Uninstall Survey

The MV3 extension stores one strict versioned record in
`chrome.storage.local`, never `chrome.storage.sync`. It contains its random
UUID, creation time, current/first version, saturating extension-session
counter, ever-connected bit, disclosure/preference version, and an optional
last-selected-backend aggregate summary. It never stores a pairing credential,
backend installation ID, torrent identity, path, peer, tracker, endpoint,
diagnostic, or error as metrics state.

After successful attachment, the extension may replace its cached backend
aggregate only when both the extension and backend statistics preferences
permit it. Disabling either preference erases the cached aggregate. A backend
switch replaces rather than merges the cache, avoiding double counting across
Android, Crostini, desktop, or restored profiles. The extension ID remains the
only `id` in the uninstall URL.

On install/startup, record change, preference change, reset, successful
connection, backend-summary change, and version change, one serial owner
rebuilds:

```text
https://jstorrent.com/uninstall.html
    ?v=<extension-version>
    [&id=<extension-install-id>]
    [&days=<days-since-first-use>]
    [&connected=<0-or-1>]
    [&downloads=<last-backend-completed>]
    [&added=<last-backend-added>]
    [&sessions=<extension-sessions>]
```

The bracketed values appear only when the disclosure is acknowledged and
statistics are enabled; cached backend values additionally require the backend
permission above. The exact final URL is at most Chrome's 1,023-character API
limit. Unknown/future/malformed state resets locally and produces the bare
survey URL. `setUninstallURL()` failure is observable and nonfatal. Removal
cannot prompt after the fact, so the last successfully installed URL is the
entire uninstall boundary.

### IMF-006: Privacy And Platform Truth

Before richer feedback or uninstall fields are enabled, the hosted JSTorrent
privacy, feedback, and uninstall presentation accurately names the fields,
purposes, recipients, retention/control limits, pseudonymous correlation, and
reset/disable behavior. A privacy-policy link is reachable from each in-app
statistics disclosure and feedback confirmation. Release notes identify the
new behavior. No UI says that RSTorrent collects no analytics/usage data, that
the identifier is anonymous, or that feedback context remains local until
final form submission.

Desktop/shared React, Android/Compose, and the MV3 extension pass their exact
product gates. Generated TypeScript, Kotlin, and Swift consumers remain
current. iOS receives no new visible statistics or feedback surface in this
slice but must compile against any shared typed boundary. The stateless
foreground downloader uses ephemeral product state and sends nothing;
headless updating remains anonymous unless a later interactive product policy
explicitly changes it.

### IMF-007: Bounds And Cleanup

The native product database retains one installation row, at most 128 source
watermarks, no arbitrary event rows, and no per-torrent or per-peer metric
history. Each profile outbox is capped at 1,024 pending semantic milestones;
overflow degrades metrics with one bounded diagnostic instead of blocking the
authoritative torrent transition. Counters saturate at unsigned 64-bit maximum.
At most one low-priority outbox drain and one serialized extension URL update
run at a time. Database/WAL, pending rows, write rate, URL length, task count,
and shutdown latency high-water marks are recorded.

All test profiles, browser storage, extensions, URLs, logs, virtual devices,
website fixtures, and product-state files created for validation are removed
or restored. No feedback form, issue, public website change, store update, or
production release is submitted without its separately authorized action.

This tactical stops only when IMF-001 through IMF-007 pass, the hosted privacy
presentation is truthful for every enabled transmission, all first-party
generated consumers and declared platform gates pass, the owning topics and
release checklist record exact evidence, and no temporary task or artifact
remains.

## Native Product-State Contract

### Closed schema

The first `product.db` schema is typed rather than key/value or event-based:

| State | Contract |
| --- | --- |
| Installation row | schema version, UUIDv4, creation time, first/current version, disclosure version, statistics-enabled value, last start, last clean shutdown |
| Counters | unsigned saturating additions, download completions, and supported foreground sessions |
| Source watermarks | bounded profile source epoch plus last applied ordered milestone |
| Reset generation | changes atomically with identity/counters so stale readers and extension caches are rejected |

Use the same SQLite durability, migration, hostile-state bounds, busy handling,
and explicit owner conventions as the profile store, but do not make
`product.db` a second catalog, settings authority, transfer-history store,
prompt framework, diagnostics log, or profile registry. Corruption may offer
the specific statistics reset; it cannot imply that the torrent profile is
corrupt or authorize payload deletion.

Desktop migration performs this ordered transition:

1. validate any current `cfu-id` as one canonical UUID;
2. create and durably commit `product.db`, adopting that UUID when valid or
   generating one otherwise;
3. make the product-state owner the updater's only identity source; and
4. remove the legacy file only after successful adoption, with interrupted
   migration converging to the committed product database.

The unsupported `0.1.x` rollback policy does not justify dual writable
identity authorities. Tests cover legacy-valid, missing, empty, malformed,
future-product-schema, busy, read-only, crash at every phase, and repeated
open.

### Semantic milestone bridge

Each durable profile owns a random source epoch and strictly increasing
milestone sequence in `session.db`. The same SQLite transaction that commits
the exact addition or first download-completion transition appends the small
typed milestone. A product-owner drain reads in order and applies only the
next sequence for that source. One `product.db` transaction advances the
counter and source watermark. The profile then deletes all outbox rows through
that acknowledged watermark.

Crash before the profile transaction changes neither transition nor counter.
Crash after it leaves the milestone to drain. Crash after product apply but
before profile acknowledgement replays below/equal to the watermark as a
no-op. Product-store unavailability leaves a bounded pending row. Out-of-order
sequence, changed source epoch, overflow, or an unknown milestone kind is a
typed degraded-metrics condition, never authority to guess, skip ahead, or
fail the torrent.

Completion causality is recorded where durable verified-piece state first
crosses incomplete to complete because of ordinary download work. Recheck and
existing-content adoption use different typed causes and cannot emit the
milestone. A completion event observed by a UI is not counter authority.

## Transmission Matrix

| Surface | Trigger | Always permitted | Optional when enabled and acknowledged |
| --- | --- | --- | --- |
| Desktop updater | Existing automatic/manual update schedule | normal update request and version | native installation ID only |
| Shared React feedback | User confirms browser navigation | platform and version | native ID, days, counters |
| Android feedback | User confirms browser navigation | platform, version, Android release, manufacturer/model | native ID, days, counters |
| Extension uninstall | Browser removes extension after URL was set | uninstall survey navigation and extension version | extension ID, days, sessions, connected, permitted cached backend counters |

No timer, torrent event, startup, shutdown, reset, or preference change sends
an analytics request. Those triggers only update local state or the browser's
locally registered uninstall URL. A new recipient, endpoint, field, automatic
request, crash payload, or event stream is outside this tactical and requires
a product/privacy decision.

## Owner, Task, Cancellation, And Data Map

```text
platform application-data adapter
    -> ProductStateOwner -> product.db
           ^       |          |-> typed summary/preference/reset
           |       |          `-> desktop updater optional X-CFU-Id
           |       |
profile session.db |       React / Compose feedback confirmation
  durable outbox --'          `-> strict jstorrent.com feedback URL

MV3 extension ProductMetricsOwner -> chrome.storage.local
    |-> extension activation / successful connection
    |-> optional permitted backend-summary cache
    `-> serialized chrome.runtime.setUninstallURL
```

- One native product-lifetime owner opens/migrates/closes `product.db`; profile
  application services never open it and presentations never open SQLite.
- The profile application owner emits only the two typed semantic milestones.
  One bounded low-priority drain is canceled and joined with that profile; its
  pending durable rows survive cancellation.
- Foreground lifecycle adapters call one idempotent product command. WebSocket
  reconnect, projection reset, UI rerender, updater timer, and diagnostic
  attachment do not own sessions.
- Feedback construction is pure and task-free. Only an explicit presentation
  action hands the bounded URL to the existing browser launcher.
- The desktop updater keeps its existing task/schedule/cancellation owner and
  reads an optional header value; statistics state creates no network task.
- One extension owner serializes storage mutation and uninstall-URL updates.
  Event listeners wake it but do not spawn overlapping work; extension
  suspension is safe because the record and last registered URL are durable.
- Product-state commands and views are transport-neutral. Rust domain/schema
  types remain independent from Tauri, Android, Chrome, URLs, and browser APIs.

## Source-First Record

The design was reconciled on 2026-09-01 against these exact sources before
implementation:

### Current RSTorrent

- `clients/desktop/src-tauri/src/updater.rs` owns private atomic UUIDv4
  `cfu-id` create/repair and the update check;
- `clients/desktop/src-tauri/src/lib.rs` installs that value as
  `X-CFU-Id` on the current `desktop-update-v1` request;
- `crates/rstorrent-session/src/application.rs` owns durable add receipts,
  verified-piece persistence, completion transitions, `ApplicationService`,
  and durable/ephemeral application configuration;
- `clients/android/app/src/main/java/org/rstorrent/bootstrap/AndroidFeedback.kt`
  owns Tactical `206`'s strict four-field 2-KiB feedback URL;
- `clients/web/src/android-companion-client.ts` owns a pairing installation
  value that must not be repurposed as product identity; and
- `clients/extension/manifest.json` already declares `storage` but has no metrics
  record or uninstall URL.

Implementation inspection followed the add transactions in
`crates/rstorrent-session/src/store.rs` into the new typed outbox, and the
ordinary verified-piece completion transition at that file's downloaded-
completion branch. `downloaded_completion_emits_once_and_recheck_or_repair_cannot_reemit`
proves that only the downloaded transition emits completion; complete-data
adoption and `complete_recheck_generation` do not share that emission path.
`crates/rstorrent-session/src/application.rs` owns the one joined drain and
its final cancellation pass.

### JSTorrent product oracle

JSTorrent commit `0cad4dacf540f5be42ee53c4f1e1da27aa1b3685`
was inspected:

- `extension/src/lib/telemetry-id.ts` creates the extension UUID;
- `extension/src/lib/metrics.ts` records additions, completions, sessions,
  install age, connection/device context, and calls
  `chrome.runtime.setUninstallURL()`;
- `android/app/src/main/java/com/jstorrent/app/settings/MetricsStore.kt`
  retains the Android install UUID, counters, and review state;
- `website/public/feedback.html` reads environment and aggregate query values
  and prefills the external Google Form;
- `website/public/uninstall.html` renders the uninstall summary and prefilled
  survey; and
- `website/public/privacy.html` currently says JSTorrent does not collect
  analytics or usage data, which must be corrected before the new behavior is
  enabled.

Adopt observable product value and edge cases, not JSTorrent's Chrome sync
storage, arbitrary historical shape, JavaScript ownership, or source text.

### Browser contracts and disclosure gate

The official Chrome sources inspected on 2026-09-01 are:

- `https://developer.chrome.com/docs/extensions/reference/api/runtime`:
  Manifest V3 `setUninstallURL`, HTTP/HTTPS requirement, and 1,023-character
  maximum;
- `https://developer.chrome.com/docs/extensions/reference/api/storage`:
  extension-local storage behavior and quota; and
- `https://developer.chrome.com/docs/webstore/program-policies/disclosure-requirements`
  plus
  `https://developer.chrome.com/docs/webstore/program-policies/user-data-faq`:
  accurate prominent disclosure, privacy-policy, and consent obligations.

Treat store policy as a release gate. A privacy-policy edit alone is not a
substitute for the in-product disclosure when Chrome requires prominent
notice and affirmative continuation for the changed collection behavior.

## Implementation Record

The bounded slices landed on 2026-09-01:

- `228bfe6f` adds the closed native `product.db` schema, UUID/time validation,
  preference, reset, summary, and owner;
- `3858ca13` adds the profile-local 1,024-row semantic milestone outbox and
  `48ebb38a` joins its single idempotent drain to each application owner;
- `537b7051` adopts a valid legacy desktop `cfu-id`, removes that file only
  after committed adoption, and makes the product owner the updater's single
  optional-header authority;
- `57673f40` adds desktop lifecycle counting plus the shared React first-use
  disclosure, settings, reset, exact feedback preview, privacy link, and
  stale-preview-safe browser handoff;
- `68b046ee` adds the strict versioned extension-local record, one serialized
  uninstall-URL owner, popup disclosure/control/reset, and exact URL tests;
- `a9c9c237` adds Android no-backup product state, process-foreground epochs,
  generated Rust/Kotlin boundary, Compose disclosure/control/reset/preview,
  strict browser confirmation, and Tactical `207` clear-data reconciliation;
  and
- `8d418b60` records the persistent native-store resource high-water fixture.

Sibling JSTorrent website commit `af615ce5` corrects the privacy disclosure
and makes feedback/uninstall query handling use the same closed allowlists and
safe text presentation. That is source evidence only: no website was deployed
and no form was submitted.

Finish-line Tactical `259` reconciles this historical reference on 2026-10-07:
that commit is unavailable in the current sibling checkout, whose source and
live policy retain the old behavior. Replacement source preparation and its
independent security/visual checks are recorded there; the reference above
cannot establish deployable current source or public qualification.

The desktop and Android constants named `HOSTED_PRODUCT_CONTEXT_READY` and the
extension's equivalent hosted gate remain `false`. Consequently the shipped
code can collect and display local state, and base feedback retains only its
already accepted environment fields, but no UUID, age, or aggregate counter
can enter feedback or uninstall query strings until the public pages are
deployed and verified. The desktop updater is the separate disclosed boundary:
it may use the product ID after acknowledgement with statistics enabled, while
the pre-acknowledgement exception is retained only for a valid adopted legacy
`cfu-id`, exactly as IMF-003 requires.

## Edge-Case Checklist

- clock before creation, clock rollback, far-future timestamp, leap/day
  boundary, unavailable clock, and saturating day conversion;
- UUID generation failure, malformed legacy UUID, duplicate/missing singleton,
  interrupted legacy adoption, statistics reset during an updater read, and
  stale reset-generation cache;
- duplicate add command/receipt, remove then re-add, metadata-only add,
  initially complete import, selected-file completion, skipped files,
  completion during restart, completion/recheck race, repeated event, and
  source outbox overflow;
- product database busy/read-only/corrupt/future, profile database failure,
  crash before/after each outbox/apply/ack phase, source epoch change, sequence
  gap, and owner shutdown with pending work;
- desktop hidden/background/headless/updater-only launch, repeated focus,
  tray restore, deep-link activation, Android activity recreation/Home/reopen/
  process death, extension popup churn/suspend/reload/reconnect;
- disclosure never shown, declined statistics, preference toggled during URL
  preview, one-report checkbox override, reset between preview and launch,
  malformed/over-bound platform text, no browser handler, and double click;
- extension install/update/disable/enable/remove, storage unavailable or
  malformed, `setUninstallURL()` rejection, backend preference disabled,
  backend switch, stale/disconnected backend summary, and exact 1,023-byte
  acceptance/1,024-byte rejection; and
- browser history/referrer wording, embedded Google Form and Cloudflare
  recipient disclosure, privacy link failure, untranslated copy, reduced
  motion/keyboard/screen-reader behavior, and narrow phone presentation.

## Implementation Sequence And Intermediate Gates

1. Add pure product-state types, schema/migration, UUID/time validation,
   preference/reset semantics, and hostile-state/resource tests without a
   presentation or network consumer.
2. Add the profile milestone outbox and idempotent drain. Prove every
   add/completion/recheck/crash case before exposing counters to clients.
3. Adopt desktop `cfu-id`, route the updater through the single owner, and
   prove disabled/unacknowledged/anonymous checks plus migration crashes.
4. Add the minimal typed summary/preference/reset boundary and regenerate all
   first-party clients. Implement shared React and Compose disclosure,
   settings, reset, exact preview, and feedback confirmation.
5. Add the strict extension-local record, session/connection/cache semantics,
   serialized uninstall URL owner, and exact package tests without publishing
   an extension.
6. Update and validate the hosted-site source and product privacy wording,
   then enable richer fields only after the externally hosted presentation is
   actually truthful. Public deployment remains a separately authorized
   operation.
7. Run the complete platform/resource matrix, reconcile Tactical `207` if it
   has landed, update topics/readiness/evidence, and remove every artifact.

Each step keeps transmission disabled until its disclosure and recipient are
ready. Internal module/file names, conservative SQLite settings, and tighter
bounds may be chosen from repository evidence without changing the product
contract.

## Validation Matrix

### Pure state and persistence

- UUID, time/day, saturating counter, closed URL allowlist, encoding, reset,
  preference, and extension-record property/adversarial tests;
- fresh/migrated/repeated/corrupt/future/busy/read-only `product.db` cases;
- deterministic transition/outbox/apply/ack crash matrix for additions and
  download completions; and
- legacy `cfu-id` adoption and exact single-authority proof.

### Runtime and application contract

- scripted add/duplicate/re-add/import/recheck/download/restart campaigns with
  exact summary assertions and no torrent failure under product-store faults;
- desktop lifecycle and updater automatic/manual request capture with exact
  header presence/absence and zero new analytics requests;
- React and Compose reducers, preference convergence, preview/override/reset,
  stale revision, browser failure, accessibility, narrow viewport, and
  localization tests; and
- extension service-worker suspension/restart, connection/cache replacement,
  storage failure, and exact uninstall-URL registration tests.

### Platform and release evidence

- `cargo fmt --all -- --check`, `cargo clippy --workspace -- -D warnings`, and
  `cargo test --workspace`;
- generated-contract drift plus web typecheck/unit/build/E2E;
- desktop updater/package tests on maintained native targets in proportion to
  the migration and header change;
- Android dual-ABI build, lint/unit/instrumentation on API 28/35, and one
  physical ChromeOS Android/extension feedback-preference-reset-uninstall-URL
  campaign without actually uninstalling the installed production extension
  or submitting feedback;
- iOS simulator/archive compile for the generated boundary, with no visible
  iOS product claim; and
- source/static validation plus separately authorized public verification of
  privacy, feedback, and uninstall pages before release enablement.

Record exact commands, versions, high-water marks, artifacts, and unavailable
platform gates. Tests must inspect complete URLs/headers and assert every
prohibited field is absent; a visual preview alone is not privacy evidence.

## Implementation Evidence

The 2026-09-01 implementation pass recorded these green gates:

- `cargo fmt --all -- --check`, `cargo clippy --workspace -- -D warnings`, and
  `cargo test --workspace` pass. The workspace includes 14 Android Rust tests,
  44 desktop tests, and 345 session tests with two preexisting ignored
  resource/live cases. Focused product-state, updater migration, semantic
  outbox, completion-causality, replay, owner-shutdown, and fail-closed URL
  cases all run in that matrix.
- `npm run typecheck --prefix clients/web`, `npm run test --prefix
  clients/web`, and `npm run build --prefix clients/web` pass: 381 tests pass,
  two preexisting cases are skipped, and the production CSP scan finds no
  eval, function constructor, or CommonJS `require` in 12 bundles.
- `npm test --prefix clients/extension` passes all 21 service-worker,
  product-record, uninstall-URL, and package-validator tests. Fresh and
  malformed state register only `https://jstorrent.com/uninstall.html?v=0.4.0`
  while the hosted gate is closed.
- `node scripts/check-localization.mjs` validates 1,261 web, 17 desktop, 442
  Android, and 172 iOS English product messages plus the locale policy.
- `cargo test -p rstorrent-android --lib` passes all 14 tests and `cargo
  clippy -p rstorrent-android -- -D warnings` passes. `clients/android/build.sh`
  builds both release ABIs and regenerates the Kotlin boundary. From
  `clients/android`, `ANDROID_HOME=/home/kgraehl/Android/Sdk ./gradlew
  lintDebug testDebugUnitTest assembleDebugAndroidTest` completes all 63
  tasks. The instrumentation APK was assembled but not installed or run on an
  attached device.
- `cargo check -p rstorrent-ios` passes on the current Linux host. Xcode,
  simulator, generated Swift, and unsigned archive qualification are not
  available on this host and remain open rather than being inferred from the
  Rust check.
- sibling JSTorrent website commit `af615ce5` passes its Prettier source
  check. No production URL was changed, fetched as deployment evidence, or
  submitted.

The explicit resource fixture fills all 128 native source watermarks using
128 deliberately separate product transactions. It observes 4 x 4,096-byte
logical pages (16 KiB), a 4,096-byte live main database, and a 1,071,232-byte
live WAL; regression ceilings are 64 KiB logical/main and 4 MiB WAL. The
profile outbox admits at most 1,024 contiguous pending rows, and one product
drain applies an entire available batch in one transaction. A semantic add or
completion adds no separate profile write because its milestone shares the
authoritative transaction. Disclosure, preference, reset, foreground epoch,
startup, and clean shutdown each perform at most one product transaction per
explicit transition. There is one drain task per application owner and one
serialized extension mutation/URL owner; there is no metrics network task.
The joined-drain shutdown test completes in 0.03 seconds (0.21 seconds for the
complete warmed test command). Feedback URLs remain at most 2,048 bytes and
extension uninstall URLs at most 1,023 bytes. All fixtures use task-owned
temporary roots/storage and were removed by their harnesses.

## Remaining Release Qualification

The code slices are complete, but the tactical stopping condition remains
open for three explicit gates:

1. deploy sibling hosted commit `af615ce5` through a separately authorized
   website operation, publicly verify privacy/feedback/uninstall recipients
   and allowlists, then flip the desktop, Android, and extension hosted-context
   constants in a reviewed release change;
2. run the selected physical ChromeOS Android/extension disclosure,
   preference, reset, feedback, and registered-uninstall-URL campaign without
   removing the production extension or submitting a form; and
3. run the iOS simulator/generated-Swift and unsigned archive compile on a
   maintained macOS host, making no iOS presentation claim.

Until all three pass, no release may claim the optional richer fields and the
fail-closed constants must remain `false`.

## Non-Goals

- Google Analytics, Cloudflare analytics integration, Sentry, crash upload, a
  metrics backend/dashboard, remote feature flags, accounts, cohorts,
  advertising identifiers, fingerprinting, or arbitrary events.
- Torrent names, hashes, magnets, paths, roots, trackers, peers, addresses,
  payload, speed/history, settings, errors, logs, diagnostics, user prose, or
  credentials in product metrics or URLs.
- `chrome.storage.sync`, cross-device identity merge, backend-ID copying into
  the extension, pairing-ID reuse, server-side deletion claims, or migration
  of historical JSTorrent metric values.
- A review prompt campaign, crash/support bundle, report ID, application-owned
  form submission/backend, email transport, or new website framework.
- Desktop installer uninstall callbacks, Android package-uninstall callbacks,
  Apple feedback UI, headless telemetry, or stateless-downloader persistence.
- JSTorrent production identity graduation, store publication, website
  deployment, release/tag/push, or any submitted feedback/uninstall form.

## Escalation Contract

Ordinary schema/module naming, internal refactoring, stricter validation,
tighter bounds, generated-client repair, deterministic browser fixtures, and
bugs within these owners do not require further direction. Stop for human
direction if evidence requires a new recipient or transmitted field, changes
the default-on disclosed preference, weakens the per-report override/reset,
introduces a telemetry dependency or generic event API, copies a backend
identity into the extension, changes torrent-completion semantics, requires
production store/website publication, or expands destructive clear-data
behavior. Physical-device use, external website deployment, release, store
submission, tag, push, and real form submission remain separate explicit
authorizations.
