# Tactical 258: Cross-Surface JSTorrent Branding And Design Audit

Status: Complete, 2026-10-07. User-directed source/display cleanup and local
visual audit; distribution and installed-platform limits remain explicit.

Topics: [product-surfaces-and-migration](../topics/product-surfaces-and-migration.md),
[web-ui-design](../topics/web-ui-design.md), [client-surfaces](../topics/client-surfaces.md),
[localization](../topics/localization.md).

## Scope and stopping condition

Audit user-visible names, original brand assets, launcher/system labels,
onboarding, fallback/error/auth pages, support exports, mobile catalogs,
extension/Linux setup, website and staged store artwork across maintained
clients. Correct obsolete display branding and proportionate presentation bugs.
Collect retained, sanitized before/after captures and an illustrated report with
coverage, design observations, validation, and explicit untested delivery gates.
Stop when source display-copy/asset checks, affected builds/tests and available
isolated browser/native simulator checks pass and the report records the limits.

## Non-goals and invariants

No engine, protocol, data model, downloaded payload, persistence key/path,
permissions, pairing, consent, migration or updater trust changes. Preserve
incubation identifiers, signing/store lanes, endpoints and internal binary names.
No store publication, deployment, push, or global client redesign.
Existing UI structure, density, preferences, and platform conventions remain.
JSTorrent is the display brand on every surface, including development builds.
Technical paths/URLs, peer-supplied text and source/license attribution are not
product display names; do not silently rewrite their contracts.

## Ownership and evidence

Existing runtime/service/task owners and cancellation paths remain unchanged.
Static presentation and assets depend inward on existing application semantics;
no new runtime boundary. Audit runners own servers, bundled Chromium, temporary
profiles and disposable mobile simulators; join/reap them and remove scratch
artifacts. Retained report assets are intentional deliverables, not temporary logs.
Browser evidence covers real application rendering with named demo data and
mocked extension platform APIs, not an installed/store backend qualification.
Native simulator evidence covers compiled app UI; recorded Windows/Linux
candidate identities are audited in source unless separately exercised.

Reuse only established original JSTorrent assets from the recorded MIT source;
record checksums/provenance and include packaged notices. No AI-generated brand.
No protocol or runtime feature is introduced. The two engine-facing changes
are cosmetic display strings only; the focused oracle review below verifies
that their technical identities remain unchanged.

## Findings, changes and validation

The local report and offline gallery in `docs/evidence/258-brand-audit/`
own the detailed 15-finding ledger, eight design/coverage recommendations,
exact validation and 100 retained PNG assets (96 screenshots and four
icon/banner previews). The structured ledger and browser/native hierarchy
summaries are adjacent. At the maintainer's request, the entire directory,
including its report renderer, is gitignored and retained locally. This
execution record preserves the committed findings, validation and limits.

Corrections cover website identity/copy/metadata, extension and Linux guides,
actual gateway and bootstrap fallback styling, Android/iOS original headers,
iOS system/catalog/AppIcon/lifecycle wording, remote appearance/scrolling,
diagnostics export, exact-command clipboard actions, native preview labels,
artifact staging, router/peer display labels, generated notices and historical
canary artwork. A CI guard verifies 2,013 display values and 40 unchanged
original JSTorrent assets. No library/detail/navigation redesign is implied.

## Focused reference and dependency review

Original JSTorrent revision
`25e4b701433fd815398ba89526546f5e4f072e3f` supplies the recorded MIT original
brand images and license. Source/destination/SHA-256 records are retained in
`distribution/branding/jstorrent-assets.json`. Tactical 249's deliberate iOS/site
exclusion explained the partial rebrand; the existing SwiftUI and Compose
headers still used provisional/generic icons. No source was mechanically copied
from a protocol implementation.

For cosmetic peer/router labels, inspected pinned libtorrent
`7d7fc38fac61177fa5e02148f791b2f65250b09d`:

- `src/identify_client.cpp`, `identify_client_impl` and client-name table;
  `test/test_identify_client.cpp`, Azureus, Shadow, Mainline and unknown-client
  cases. `reference/bittorrent.org/beps/bep_0020.rst` distinguishes the wire
  fingerprint from its presentation. Adopted that distinction: keep RS bytes,
  show JSTorrent; unknown and hostile peer input behavior is unchanged.
- `src/upnp.cpp` around lines 772–803, AddPortMapping description/user-agent;
  `test/test_upnp.cpp`, IGD1/IGD2 Add/Delete responses. Only the mapping description
  changes to JSTorrent. Ownership, address/control authority, stale/retry/delete
  and cancellation behavior remain unchanged. Scripted exact-description fixtures
  and full workspace tests pass; no new protocol support claim.

No new background task or mutable-state owner is added. Gateway image/style
routes are immutable same-origin resources beneath the existing exact-host
handler. Setup JavaScript is a packaged, offline clipboard-only module; no
permissions, network access or service ownership changes. Existing generated
application contract types are unchanged.

## Validation and stopping condition

Rust format/clippy and the complete workspace pass (1,574 passed, 18 ignored).
Web typecheck/470 tests/two skips, 34 bundled-Chromium journeys, web and remote
CSP builds, all catalogs and the asset/display guard pass. Extension 54 tests and
both ZIP variants pass. Website check/build pass. Android dual-ABI APK/notices,
116 JVM tests, fresh-daemon lint and 11 native captures pass. iPhone 35 tests and
selected iPad three tests pass with retained screenshots. The actual macOS app
bundle builds/validates as JSTorrent Preview. Fourteen package/artifact tests and
release configuration validation pass. Notice tests pass; Linux-only installer
integrity runners explicitly skip on macOS, while shell syntax passes.

The report records resolved transient build/worker failures and distinguishes
fixtures/rendering from installed-platform qualification. The final 53 browser
states have no first-party obsolete display brand, page-wide horizontal
overflow, uncaught page errors or serious/critical Axe findings. Native captures
use only fresh owned targets; no user profile, library or physical device was
changed. Owned servers/targets and scratch evidence are removed; report images
remain intentional local deliverables. The maintainer subsequently authorized
a local commit excluding the report/evidence directory; no push or publication
was performed.

The bounded stopping condition is met. Windows/Linux installed packages,
physical ChromeOS, current store screenshot/copy publication, signing/update
continuity and populated native-client visual journeys remain separate gates.
Application IDs, protocols, binary/service names, persisted paths and current
technical URLs retain their existing compatibility contracts.


Tauri CLI 2.11.4 source confirms productName-derived Linux package names and
resource paths change for the preview, alongside artifact/installation display
paths. Report D08 records the installed-upgrade/file-ownership/resource-lookup
gate before preview publication; production productName remains JSTorrent.

## Remaining design and delivery attention

- Reduce the prominent iOS Runtime card, especially its wide iPad treatment.
- Improve discoverability of later phone settings categories in the shared UI.
- Shorten and organize dense offline Linux troubleshooting guidance.
- Replace historical Play placeholders with current native product screenshots
  before submission; original JavaScript screenshots are not Rust UI evidence.
- Expand the teaser website with support, migration and qualified downloads
  only as the existing delivery gates permit.
- Simplify Android's competing folder-required and empty-library hierarchy.
- Review populated native torrent/detail/repair/playback and system permission
  or notification states with controlled fixtures and physical evidence.
- Qualify preview Windows/Linux package-name, upgrade/file-ownership, uninstall
  and resource-path transitions before release. Production productName and
  identity/trust continuity remain unchanged.
