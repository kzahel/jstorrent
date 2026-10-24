# Installation Product State And Feedback

## Maintainer policy, 2026-10-15

Maintainer direction supersedes the narrower transmission rules below where
they conflict. JSTorrent is open-source software in early release; the aim is
best-effort trustworthiness, not a consent-tracking system.

- **Opt-out statistics.** Basic usage and operational statistics are
  collected unless the user opts out. One clear choice, shown on first run
  (Android's first screen; desktop's first-run dialog), turns off all of it
  except the minimum an update check needs (version, platform, ordinary
  request metadata). The existing **Include usage statistics** preference is
  that choice. No versioned legal assent record is kept beyond what the
  preference already stores, and a disclosure text change does not require
  re-acknowledgement.
- **Opt-outs are counted.** Desktop update checks send `X-Statistics: on`,
  `off` or `unreviewed` with no identifier, so the opted-in sample (unique
  `X-CFU-Id` values) can be scaled to an estimated population. The update
  server logs the allowlisted header values after Tactical
  [371](../tactical/371-statistics-and-compatibility-rollout.md)'s steps 1–3
  deployed on 2026-10-15. The maintainer's reporting script separates
  choices and estimates the active header-reporting population using the
  unique explicitly-on sample and on/off check ratio. It states the
  equal-check-frequency assumption and reports unavailable until an
  identified on sample exists; desktop release delivery remains separate.
- **Compatibility reports** (Tactical
  [370](../tactical/370-version-handshake-and-compatibility-reports.md)):
  with statistics on, hosts and clients may send coarse version and
  mismatch counts, stored like update-server request logs, to help operate
  and fix the product.
- **Remote access.** Using the hosted remote controller and relay is using
  a website: the service may record basic operational data (product and
  controller versions, connection counts and outcomes, usage metadata) to
  operate the service and keep it reliable, regardless of the in-app
  statistics preference. Never torrent names, hashes, paths, peers or
  content.
- **Privacy policy.** `website/public/privacy.html` is kept current with what
  is collected; update it in the same change that adds collection.

Tactical [321](../tactical/321-android-feedback-statistics-checkbox.md) verifies
the deployed privacy, feedback, uninstall and bounded-parser source on
2026-10-12 and enables Android's hosted-context gate. The feedback checkbox
can include or omit the exact previewed statistics for one report, with proper
toggle semantics and no interaction while the preview refreshes. Disclosure
acknowledgement and the durable opt-out still control availability. Desktop
and extension gates remain disabled; release delivery is separate.

Tactical [310](../tactical/310-concise-first-use-and-background-setup.md)
replaces the long React/Android first-use disclosure with one concise paragraph,
a plain usage-statistics checkbox and the existing privacy link. It retains
random/resettable identifier and basic-count purpose, update/feedback use and
content exclusions. The detailed URL-recipient warning remains in the exact
feedback preview. Defaults, acknowledgement version and transmission gates
are unchanged; existing acknowledged installations are not prompted again.

## Current store checkpoint, 2026-10-10

Shipment295 saves the production Play privacy URL as
https://jstorrent.com/privacy.html and submits the Android28 update with managed
publishing on. The existing no-collection declaration is reconciled to optional
Diagnostics for the four environment fields sent by the user-opened HTTPS
feedback flow. The preview records non-ephemeral handling and Analytics purpose;
the public policy explicitly explains recipient exposure before form submission.
The provider/user-initiated transfer exemptions inform the no-shared-category
answer. This is a source-aligned best-faith classification, not legal clearance.
No account, automatic crash upload, new transmission or broader consent is added.
Tactical208's hosted identifier/counter gate remains release-disabled.

Separate078 owns actual saved/submission screenshots and official Play guidance;
074 owns exact managed28 lifecycle evidence, and084 owns store presentation.
The earlier proposal below is retained as dated history, not the current
submission status. Asynchronous review is not approval or public delivery.

Slice021 prepares exact extension1.1.2 permission/privacy field replacements
from a fresh authenticated read-only dashboard observation. Old raw-I/O and
browser-progress explanations remain; all nine data categories are unchecked.
The local proposal distinguishes pairing/session credentials, local counters/
content and the disabled hosted identifier/counter fields. Google guidance
includes local handling; category interpretation and certifications remain
account-owner review. No draft save, checkbox edit, submission or deployment
occurs. Slice019 separately prepares three visibly labeled demo image candidates;
actual installed connected/native screenshot selection remains open.

Topic: `product-state-and-feedback`

Tactical [`232`](../tactical/232-desktop-extension-control.md) keeps desktop
product state under its existing native owner. Native bootstrap carries no
product metrics or persistent browser credential, and the extension receives
no new metrics/reset bridge. Existing extension-local disclosures remain.

Tactical [`230`](../tactical/230-desktop-stable-latest-update-channels.md)
keeps update check identity under native `product.db` preference authority
while adding a selectable desktop channel. The native candidate removes
check-only headers before the public installer download, preserving the
existing disclosure boundary across both channels.

Completed local Tactical `216` adds a separate desktop/shared-browser support
report containing only allowlisted build/update facts. It exports no product
identifier, counters or feedback fields, sends nothing automatically, and
leaves the Tactical 208 hosted-context gates off. The frozen preview, generic
clipboard-denial fallback and exact download bytes pass browser evidence.
[User guidance](../user-support.md) explains local reporting versus network
and updater behavior without claiming the corrected hosted pages are deployed.

On 2026-10-15 the maintainer replaced Tactical 216's no-context report links.
About's **Report on GitHub** opens a new issue whose body carries the same
bounded diagnostics report, and **Send feedback** opens `feedback.html` with
platform, version, build, target, package and connection fields the page
accepts. The user reviews the prefilled page and submitting it is the
authorization; nothing is sent before then. **Help** opens the user-facing
`jstorrent.com/support/` page, and `docs/user-support.md`, still linked by
released builds, carries the same plain-language guidance.

Status: Direction accepted on 2026-08-03 and the first bounded implementation
landed on 2026-09-01 through Tactical
[`208`](../tactical/208-installation-metrics-and-feedback-parity.md).
Installation-wide identity, coarse engagement counters, and disclosed
feedback/update/uninstall context now share one product-state boundary above
every native profile; the extension retains its own installation-scoped local
record. No general analytics service or prompt campaign exists. Android's
optional feedback identifier/counter query transmission is enabled in source
after Tactical 321's hosted verification. Desktop feedback and extension
uninstall transmission remain release-disabled.
The separately disclosed updater boundary follows the acknowledged durable
preference. Completed Tactical
[`206`](../tactical/206-android-jstorrent-feedback-handoff.md) adds the one
narrow Android-only external feedback navigation baseline described below.
Tactical `208` widens the local preview and controls while its fail-closed
hosted gate preserved that baseline URL until Tactical 321. The desktop updater
now reads its
optional `desktop-update-v1` `X-CFU-Id` header from `product.db`; a valid
legacy `cfu-id` is transactionally adopted and the old file removed only
afterward, so no second identity authority remains. Tactical `162`'s versioned
`desktop-shell.json` is a separate shell policy whose version 1 contains only
**Run in Background**.
Completed desktop-notification Tactical
[`164`](../tactical/164-desktop-completion-and-attention-notifications.md) adds
an explicit version-2 migration that preserves that value while adding only
installation-wide desktop completion, attention, and focused-window
preferences. Those shell preferences do not widen the updater identifier or
preempt the accepted product-state database. Completed Tactical
[`165`](../tactical/165-cross-platform-active-download-sleep-inhibition.md)
advances the closed shell record to version 3 with one default-on desktop
power preference. The setting is installation-wide policy; live inhibitor
state remains derived and is never retained as product history.

## Scope

This topic owns:

- installation-wide local identity and first-run age;
- small monotonic product-usage counters useful for support context and local
  engagement decisions;
- durable state for a concrete review, feedback, migration, or companion-
  installation prompt once that prompt is designed;
- sparse installation lifecycle and version facts; and
- the privacy and consent boundary for including local context in update
  counting, feedback, bug reports, and the browser-extension uninstall survey.

[`client-persistence.md`](client-persistence.md) owns the correctness-critical
profile database and torrent restart state. Tactical
[`066`](../tactical/066-smooth-session-speed-history.md) owns transfer-rate
sampling and history. Those stores have different scope, write cadence,
retention, and failure consequences from the product facts here.

This topic does not authorize continuous analytics upload, a telemetry vendor,
an arbitrary event API, a generic prompt framework, or collection of torrent
names, hashes, paths, trackers, peers, endpoints, diagnostics, error text, or
payload content.

## Why Keep These Facts

A few coarse local facts can make voluntary feedback substantially more useful.
For example, knowing that a report came after twenty successful downloads over
ninety days is different from a report on first launch before any torrent was
accepted. The same facts can support restrained local milestones such as
asking an established successful user whether they want to leave a review.

Local collection and remote transmission remain separate decisions. Explicit
direction nevertheless accepts three closed transmission surfaces for these
facts: the developer-operated update check, a user-opened feedback page, and
the browser extension's uninstall survey. They are not permission for a
continuous event stream, a third-party analytics SDK, or unrelated reporting.

## Identity Vocabulary

Do not reuse one identifier across unrelated ownership boundaries:

| Identity | Scope and purpose | Persistence and transmission |
| --- | --- | --- |
| Installation ID | One product installation across profiles and application updates | Random resettable 128-bit value in installation product state; may be sent only through the disclosed update, feedback, and extension-uninstall boundaries |
| Profile ID | One torrent catalog, settings set, roots, and application-service instance | Stable beneath the profile root; never an analytics identity |
| Client instance ID | One attached client lifetime and its reconnect/takeover ownership | Ephemeral; not product history |
| Report ID | One user-submitted feedback or support case | Generated for that submission; may be sent with the visible report |
| Separate analytics ID | A second identity created only for remote measurement | Does not exist and is not needed by the accepted design; the installation ID is the sole disclosed pseudonymous product identity |

RSTorrent currently has stable profile identity, an ephemeral WebSocket
client-instance identity, and the desktop updater's random durable installation
ID. That updater ID is the seed for the accepted installation identity rather
than a reason to create another telemetry UUID. The installation ID is
pseudonymous, not anonymous: repeated allowed requests can be correlated until
the user resets it. It is never derived from a profile ID, pairing ID, device
serial, account, path, peer ID, or hardware fingerprint and is never an
authentication credential.

An installation's age is the elapsed time since its product state was first
created. Presentation should call this **days since first use** unless platform
backup, restore, uninstall, and reinstall behavior makes a stronger "days
installed" claim truthful. Reset-all-data creates a new installation identity;
ordinary profile deletion does not.

## Accepted Storage Boundary

Use an installation-wide, application-private `product.db` above profile
directories:

```text
application data/
  product.db
  profiles/
    <stable-profile-id>/
      session.db
```

Transfer-history storage may add a separate profile-local derived-data store;
it does not absorb installation product state. Conversely, `product.db` does
not become a transfer time-series database or a second torrent-catalog
authority.

One product-lifetime owner above application-service instances owns
`product.db`. Platform adapters supply the application-data root, current
product version, wall-clock observation, and foreground lifecycle facts.
Profile application services publish bounded semantic milestones upward only
after the authoritative profile transition succeeds. Clients read a
typed summary and record prompt disposition through that owner; they do not
open SQLite independently.

The initial store is local to one installation and does not sync through an
operating-system account or merge across devices. Tactical `208` selects
Android app-private backup exclusion, while a deliberate desktop file-level
backup/restore also restores `product.db` and therefore its identity, age,
prompt dispositions, and counters. A later platform must state its backup
behavior before enabling transmission.

`product.db` is durable product state, not disposable telemetry. Its corruption
or write failure must be observable and conservatively resettable, but it must
not establish torrent resume truth or prevent a download from running. Whether
the future installation-level profile registry shares this database requires a
separate failure-domain decision when that registry is designed.

## Initial Product Summary

The first schema should remain closed and typed. Candidate installation facts
are:

- installation ID and product-state creation time;
- first-seen and current product versions;
- last product start and last completed clean shutdown;
- total successfully added torrents;
- total downloads completed from an incomplete state; and
- foreground product sessions, if the platform-independent session boundary is
  defined precisely enough to count consistently.

Counters are unsigned, saturating, and monotonically increasing. They are
diagnostic and engagement context, not billing, protocol, or correctness
evidence. A write failure degrades the summary and local prompting without
rolling back the torrent command that produced the milestone.

Counter meanings must be based on semantic transitions rather than UI or
transport notifications:

- **Torrents added** advances once after creation of a new durable catalog
  record succeeds. Invalid input, a rejected duplicate, a no-op, and replay of
  the same request do not advance it. Removing and later adding a new catalog
  record is another addition.
- **Downloads completed** advances once when a torrent added incomplete first
  reaches complete through download work. Restart restoration, repeated
  completion notification, recheck of already complete content, and importing
  preexisting complete content do not advance it.
- **Foreground sessions** must mean an intentional product activation, not a
  WebSocket reconnect, webview reload, background-service restart, activity
  recreation, or diagnostic-client connection. Omit this counter until
  desktop and Android can share an honest definition.

The implementation may add a small number of similarly defined coarse facts
when a concrete feedback or prompt use requires them. It must not accept
arbitrary metric names or silently turn every application event into retained
history.

## Prompt Campaign State

Prompt state means the durable disposition of a specific in-product
solicitation, such as:

- asking a successful established user to leave a store review;
- offering the browser extension when the native product is already useful;
- requesting feedback after a meaningful milestone; or
- offering an explicit JSTorrent migration or successor handoff.

Usage counters exist independently from prompts. Do not add generic prompt
rows merely because the product store exists. When a concrete prompt is
accepted, give its code-defined campaign a stable versioned key and retain only
the state required to avoid nagging: first/last shown time, bounded shown count,
and a typed disposition such as `not_now`, `declined`, or `completed`.

Eligibility rules live in reviewed product code and use the local summary;
they are not remotely mutable analytics rules. A prompt records `shown` only
when it was actually visible. `Not now` permits a documented cooldown, while
`declined` and `completed` suppress that campaign permanently unless a future
campaign has materially different purpose and a new key.

## Operational Facts

Startup, clean-shutdown completion, detection of a previous unclean stop,
product-version change, and schema-migration outcome are sparse typed
installation facts rather than numeric transfer buckets. `product.db` is their
natural scope if a later tactical demonstrates a diagnostic or migration need.

That tactical must decide whether each fact needs only a latest value or a
bounded chronological record. It must define crash semantics, retention,
backup behavior, and payload limits before adding an event table. Error text,
paths, URLs, torrent identity, and arbitrary structured payloads do not belong
in a generic operational record.

## Feedback, Update Counting, And Uninstall Survey

The first implementation uses one default-on, plainly disclosed
**Include pseudonymous usage statistics** preference. Turning it off is
durable and suppresses the installation ID and usage summary from every
allowed transmission surface. Update checks then remain anonymous apart from
ordinary request metadata. Local counters may continue so that re-enabling the
preference and local engagement decisions retain an honest summary.

A separate **Reset usage statistics and identifier** action rotates the
installation ID and resets the coarse counters and first-use timestamp without
removing torrents, payload, roots, settings, profile state, pairing, or the
application. Full application-data clearing also resets them. Presentation
must not describe either operation as deleting server logs already received.

A feedback or bug-report surface builds its context snapshot locally, shows
the exact optional fields before browser navigation or submission, and lets
the user uncheck inclusion for that one report without changing the durable
preference. Appropriate context is closed to:

- product and platform version;
- days since first use;
- the closed aggregate counters;
- whether the product has ever successfully connected to its engine/host;
  and
- Android's already accepted OS release and manufacturer/model fields.

The current JSTorrent-hosted feedback and uninstall pages consume query
parameters before the embedded Google Form is submitted. That behavior is
accepted for replacement parity only after the confirmation names the fields
and recipients. The product privacy presentation must explain that query
values can reach browser history, website logs and referrers, the embedded
Google Form, and the page's existing Cloudflare analytics. Do not claim that
this flow is anonymous, local-only, or transmitted only on final form
submission.

The extension cannot ask for consent after it has been removed. While
installed it maintains a bounded uninstall URL from the last durable privacy
preference and cached summary. If statistics are disabled or state is
unavailable, uninstall may still open the survey but its URL contains no
stable ID or usage counters. The URL is always length-bounded and contains no
user prose or diagnostic text.

The exact cross-surface allowlist is product version, platform, installation
ID, days since first use, torrents added, downloads completed, foreground
sessions, and ever-connected state, plus the existing Android environment
fields. A surface uses only the subset it needs. Torrent identity/content,
paths, roots, trackers, peers, network addresses, credentials, account or
hardware identifiers, errors, logs, diagnostics, and arbitrary event payloads
are prohibited.

Earlier maintainer direction on 2026-09-01 selected the first closed
replacement-parity exception in completed Tactical
[`206`](../tactical/206-android-jstorrent-feedback-handoff.md). The Android
Advanced Settings action opens the existing JSTorrent feedback page with
exactly four current-JSTorrent environment fields in its query: literal
platform `android`, application version name, Android release, and device
manufacturer/model. Those fields are transmitted on navigation and may reach
browser history, website logs/referrers, the embedded Google Form, and the
page's existing analytics before form submission. No stable identifier,
counter, error, runtime diagnostic, lifecycle fact, torrent/peer/storage fact,
or user prose entered that original URL. Tactical `208` landed the accepted
preview, privacy presentation and controls. Tactical `321` verifies the hosted
pages and enables the richer Android product summary only when disclosure,
durable preference and per-report consent permit it. Opt-out retains Tactical
`206`'s exact four-field URL.

## JSTorrent Reference Evidence

The inspected JSTorrent revision is
`0cad4dacf540f5be42ee53c4f1e1da27aa1b3685`.

- `extension/src/lib/telemetry-id.ts` creates a random UUID in
  `chrome.storage.local` under `telemetryId`.
- `extension/src/lib/metrics.ts` keeps completed-download, torrent-add, and
  session counters plus per-platform/device aggregates in
  `chrome.storage.sync`, while the installation timestamp stays local.
- The extension's uninstall URL contains version, telemetry ID, days,
  connection status, downloads, additions, sessions, and device count.
- `android/app/src/main/java/com/jstorrent/app/settings/MetricsStore.kt` keeps a
  local install UUID, timestamp, counters, and review-prompt state in dedicated
  preferences. Its review rule requires three completed downloads and seven
  days, uses a thirty-day `not now` cooldown, and respects permanent decline
  or completion.
- `docs/archive/design/profile-system.md` later separates telemetry ID from
  profile ID explicitly, retaining the former only for metrics and the latter
  for session state and roots.

RSTorrent adopts the useful separation, local milestone behavior, and
disclosed feedback/uninstall product outcome. It does not adopt Chrome account
sync, the storage format, hardware-derived identity, a generic event API, or
silent transmission outside the exact allowlist.

JSTorrent makes the usage summary visible in its uninstall and feedback pages,
encodes context in the page URL, and uses it to load a pre-populated Google
Forms iframe. Form submission is optional, yet visiting the page can already
disclose the query and iframe parameters. RSTorrent preserves this product
behavior with truthful preview, disclosure, opt-out, and reset controls rather
than describing navigation as a private local preview.

## Invariants

- Product-state scope is one local installation, not one torrent profile,
  client, process, device account, or remote user.
- Profile and transport identities are never repurposed as analytics identity.
- The installation identity is pseudonymous, resettable, and never an
  authorization or hardware identity.
- Local measurement does not authorize transmission beyond the update,
  user-opened feedback, and extension-uninstall boundaries.
- Prompt eligibility is evaluated locally and prompt dismissal is durable.
- Counter and prompt writes are low-frequency and never enter peer, hashing,
  storage, or other engine hot paths.
- Derived product-state failure cannot establish or invalidate verified torrent
  state and cannot fail a download.
- Optional feedback context is visible before navigation, can be omitted for
  one report, and excludes sensitive torrent, endpoint, and diagnostic data.
- Disabling statistics suppresses stable identity and counters on every
  allowed transmission surface; reset rotates identity without touching
  torrent product state.
- Adding a counter, prompt campaign, operational event, submitted field, or
  identity use requires a named semantic purpose and bounded representation.

## Known Gaps And Next Work

- Finish-line Tactical [259](../tactical/259-jstorrent-finish-line-checks.md)
  finds the historical sibling commit `af615ce5` unavailable in the current
  checkout and its corrections absent from both source and the live policy.
  New sibling source preparation corrects privacy copy and closed, bounded
  text-only feedback/uninstall rendering. Eight parser/security cases, actual
  baseline XSS reproduction and corrected desktop/mobile rendering pass;
  all external requests are blocked or stubbed and no form is submitted.
  Deploy and publicly verify the reviewed sibling source through a separately
  authorized website operation, then qualify any change to the three reviewed
  hosted-context gates in one release-qualified change. Until then UUID, age,
  and counters remain absent from new feedback/uninstall traffic.
- Run Tactical `208`'s physical ChromeOS Android/extension campaign and Apple
  simulator/archive compile. Deterministic desktop/Android foreground
  boundaries and Android no-backup/clear-data behavior have landed; no iOS
  presentation was added.
- Preserve the implemented Tactical `207` reconciliation: Reset engine
  settings leaves `product.db` intact, while either clear-data outcome removes
  the fixed app-private no-backup product root without widening payload
  deletion.
- Design each review, feedback, extension, or migration prompt as an explicit
  campaign with its own eligibility, cooldown, and disposition behavior.
- Decide whether sparse lifecycle/version facts need latest values or a bounded
  event record.
- Decide whether the installation-level profile registry remains separate from
  `product.db` after evaluating failure recovery and backup as one unit.
- Define deletion and migration behavior when replacing JSTorrent while
  preserving or intentionally resetting historical product context.
