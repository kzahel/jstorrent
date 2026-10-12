# Localization

Tactical [320](../tactical/320-chromeos-android-owned-extension-setup.md) adds
English setup, direct launch, permission and attach-only retry messages to the
shared compiled catalog and Android resources. Android explains why notifications
are required for Chrome without opting into standalone background preferences.
Localization checks, full web validation and physical setup/recovery pass on
both cohorts; shipping locales remain English.


Tactical [310](../tactical/310-concise-first-use-and-background-setup.md)
adds plain first-use statistics labels and Android background setup copy.
Technical statistics controls and detailed feedback-recipient explanations
remain in their focused settings/feedback surfaces. English-only shipping and
all platform locale policies are unchanged.

Tactical [302](../tactical/302-desktop-external-links.md) adds one shared
English message for external-link opening failure and retry. Raw plugin errors
are not shown; shipping locale policy and native catalogs remain unchanged.

Tactical [291](../tactical/291-companion-shutdown-recovery-copy.md) locally
clarifies normal Android launch before attach-only Retry after Shutdown and
fixes dim companion troubleshooting links with the existing foreground token.
Full web typecheck/481 cases,56 extension cases, localization, companion/CSP
build and exact local production1.1.3 packaging pass. Six320/390/1100 source
renderer captures reproduce before contrast and pass after accessibility,
keyboard/overflow/cleanup checks; transport/view dependencies are injected.
Slice055 verifies actual managed27 Shutdown guidance/readable links, stopped
service after Retry and normal app-launch retained reconnect. Exact package/
grants/notification preference and scoped cleanup/zero tabs/windows pass; four
report checks reap their browser/server. Slice057 uploads the exact1.1.3 to the
existing draft; native Reload verifies draft1.1.3/public1.1.1. Listing/screenshots/
privacy remain. Submission and installed-store delivery remain under259; signed
desktop/Android retain their source bindings.

Tactical [283](../tactical/283-companion-update-recovery-guidance.md) adds
component-specific recovery links and plain connection guidance in the
packaged extension, preserving attach-only retries and existing discovery/
pairing authority. The local source/render checkpoint remains separate from
actual store delivery and installed mixed-version acceptance under259. The
new production payload supersedes the prior source13dde build and source03e
extension upload proposals for final qualification; historical evidence stays
bound to its own bytes. No new build/store publication occurs.

Topic: `localization`

Tactical [268](../tactical/268-android-visible-error-fallback.md) replaces
message-less/blank Android exception class-name fallbacks with catalog-owned
product copy. Meaningful messages and complete technical logs remain. Portable
formatting regression, 122 debug JVM cases, lint and all localization catalogs
pass; normal original-signed packaging and independent package checks also
pass. Latest-source physical delivery remains separately pending.
This is a source-level leak prevention, not a reproduced runtime exception.

Tactical [262](../tactical/262-android-network-status-presentation.md) removes
actual Android Network Settings class-name leaks through exhaustive localized
listener/router descriptions, retaining endpoints, ports, failure and uncertain
lease facts. Message-less feedback failures use product copy. Actual owned
API-35 before/after captures and all 24 navigation cases pass, including the new
status regression. Internal namespaces, generated ABI and network policy remain
unchanged. Original-key production release from `37673687` passes 121 JVM
cases, lint and independent APK/AAB checks; its actual production APK also
passes the corrected native screen capture. Source-184's Android capsule is
superseded. Store/physical delivery gates remain Tactical 259.

Tactical [258](../tactical/258-cross-surface-branding-and-design-audit.md)
finishes remaining iOS product/system display names and auxiliary first-party
labels as JSTorrent. The iOS lifecycle label becomes **App is active**, replacing
Android-specific foreground-service wording. Three cataloged headless command-copy
messages are added; semantic IDs, placeholders, internal identities and supported
locale policy remain. All four catalog checks pass (1,331 web, 17 desktop, 445
Android, 172 iOS product and six Info.plist values). A separate CI branding guard
checks 2,013 display values and 40 original asset checksums. See the
[audit execution record](../tactical/258-cross-surface-branding-and-design-audit.md) for source/rendered/native limits.

Tactical 253 adds twelve cataloged shared connection/recovery messages, preserving
English-only shipping and the unchanged native catalogs. All four catalog
checks pass. Static extension setup remains an offline English document under
the existing extension-source classification.

Tactical [249](../tactical/249-jstorrent-brand-and-extension-refresh.md) changes
shared React and Android presentation to JSTorrent, retaining semantic message
IDs and all persistence/wire names. Two obsolete text lettermarks are replaced
by the original icon and their messages removed. All four platform catalog
checks pass; supported locales and the separate iOS branding remain unchanged.


The signed-candidate guest rehearsal in [252](../tactical/252-jstorrent-opt-in-upgrade-rehearsal.md) exposes stale RSTorrent copy in the native Tauri catalog.
The follow-up changes tray labels/tooltips, notifications, power text and error
dialogs to JSTorrent, preserving all 17 semantic keys and placeholders. All four
catalog checks and the focused Rust catalog test pass. The previously signed CI
candidate predates this correction; a fresh signed package remains required.

Tactical `216` adds thirteen English messages for the local support preview,
copy/download and public-report guidance. Machine-readable report keys remain
verbatim diagnostics. All web, desktop, Android and iOS catalog checks pass;
no shipping locale or translation provenance changes.

Status: **Foundation complete as of 2026-09-01.** Tactical
[`204`](../tactical/204-cross-product-localization-foundation.md) completed
English extraction and qualification across the shared React product, Tauri,
Android, and iOS. English is the only supported locale. No multilingual
product claim is currently authorized.

## Scope And Owners

This topic owns supported-locale policy, fallback, terminology, translation
provenance, review expectations, and the repeatable catalog workflow. Product
copy stays in the platform catalog that presents it:

- React and Tauri use the packaged React message catalog and locale owner;
- Android Compose and platform integration use Android string and quantity
  resources; and
- iOS SwiftUI and platform integration use an Xcode String Catalog.

The typed Rust application contract remains language-neutral. It carries
semantic facts and stable error codes, never a selected locale, translated
sentence, or platform message key.

Machine-readable policy lives under `localization/`:

- `locales.json` is the authoritative shipping/test locale manifest and
  catalog path map;
- `glossary.json` owns shared product terminology and disambiguation;
- `provenance.json` records catalog source, license, and review state; and
- `source-classification.json` distinguishes presentation copy from user,
  protocol, persistence, diagnostic, fixture, and test text.

## Current Policy

- `en` is both the source locale and ultimate fallback. English source is
  maintained as normal product copy, not imported translation.
- `en-XA` and `ar-XB` are generated test-only pseudo-locales. They must never
  appear in a release locale manifest or product language picker.
- Locale follows browser/operating-system preferences. The application has no
  stored or synchronized language setting.
- Stable keys describe semantic intent rather than copying English or encoding
  screen position. User values are interpolation data, never keys or format
  templates.
- Product numbers, dates, times, durations, lists, plurals, and percentages use
  locale-aware platform formatting. Protocol values, hashes, endpoints,
  persisted values, exact byte geometry, and machine-readable timestamps keep
  their canonical forms.
- Rich text is exceptional. React messages may receive only explicitly
  supplied safe elements; platform catalogs do not embed arbitrary markup.
- Product UI may show a bounded verbatim technical detail beside a localized
  summary. Logs and diagnostic records remain stable technical evidence.

## Catalog Workflow

Run the repository checker before and after catalog work:

```bash
node scripts/check-localization.mjs
```

For React, edit semantic English source messages under
`clients/web/src/localization/messages`, regenerate the compiled AST catalog,
and run the source/catalog checker:

```bash
npm run generate:localization --prefix clients/web
npm run typecheck --prefix clients/web
node scripts/check-localization.mjs
```

The ordinary, companion, and remote builds all compile the same packaged
catalog. `VITE_RSTORRENT_ENABLE_PSEUDO_LOCALES=1` enables generated `en-XA`
and `ar-XB` only for tests; production builds cannot select them.

For Android, edit
`clients/android/app/src/main/res/values/strings.xml` and use quantities for
count-dependent copy. Android's debug build generates platform pseudo-locales;
release resources advertise only English. Run from the repository root:

```bash
clients/android/build.sh
clients/android/gradlew -p clients/android lintDebug \
  assembleDebugAndroidTest assembleRelease
clients/android/scripts/run-localization-matrix.py
```

The matrix creates and removes its own Pixel 6 API 28 and Pixel Tablet API 35
AVDs. It must not target an arbitrary attached ADB device.

For iOS, edit `clients/ios/App/Localization/Localizable.xcstrings` or
`clients/ios/App/Localization/InfoPlist.xcstrings`, preserve translator
comments and placeholder/plural shape, regenerate the Xcode project, and run
from the repository root:

```bash
clients/ios/scripts/generate-project.sh
clients/ios/scripts/check-localization-roundtrip.sh
clients/ios/scripts/run-localization-matrix.sh
clients/ios/scripts/archive.sh --unsigned /absolute/task/path/RSTorrent.xcarchive
```

The round-trip command uses Xcode to export English as `en.xcloc`, rejects any
extraction-time rewrite, imports into an isolated copy, and compares both
catalogs byte-for-byte. The simulator matrix creates and removes its own
iPhone and iPad. To hand a real locale to a translator, use Xcode's
`-exportLocalizations`/`-importLocalizations` flow and retain the reviewed
`.xcloc` provenance outside the product runtime; do not add translation
service code.

## Translation Cohort Workflow

A future translation cohort follows this sequence:

1. Select a BCP 47 locale from audience evidence, maintenance capacity,
   supported fonts/input/layout, and an identified native reviewer.
2. Add a provenance row naming the exact author/source, license, locale, and
   review state. Do not copy JSTorrent or third-party translations solely from
   their repository-level license.
3. Export the native platform catalogs with translator comments and screenshot
   context. Translation tools receive no runtime access and no private product
   data.
4. Import into a branch, run placeholder/plural/catalog validation, and review
   every message in context with a native speaker.
5. Run long-text, RTL where applicable, accessibility, platform lifecycle,
   build, and installed/simulator evidence before adding the locale to
   `supportedLocales` or platform release metadata.
6. Update support/store/release disclosure only after the same locale is
   actually packaged in the relevant product.

If a locale later loses complete coverage or native review, remove it from the
release manifest before removing its catalog. Never leave a selectable locale
that falls through to raw keys or materially incomplete English.

## Evidence And Open Work

The currently checked catalogs contain 1,261 React messages, 17 Tauri-native
messages, 442 Android strings plus 7 quantities, 172 iOS product messages,
and 6 iOS Info.plist messages. Tactical 204 records the foundation's exact
FormatJS pins and licenses, artifact deltas, API 28/35 and iPhone/iPad pseudo
matrices, archive evidence, and repository gates. Completed Tactical
[`206`](../tactical/206-android-jstorrent-feedback-handoff.md) adds three
context-commented Android feedback strings; the checker, lint, Android build,
focused API-35 route, and physical ChromeOS presentation pass without adding
a production locale.

Implementation-complete Tactical
[`207`](../tactical/207-android-safe-reset-and-clear-data.md) adds the Android
reset/clear confirmation, progress, failure, retry, and explicit keep-
remaining-files copy to this existing English catalog with translator comments.
The 421-resource checker, lint, all 20 Compose navigation cases on owned API
28/35 AVDs, and both service reset/recovery cases on those APIs pass. The
controlled destructive gate also passes without changing the catalog. It does
not select a production locale; physical ChromeOS qualification remains
independent of this catalog evidence and open.

Implementation-complete Tactical
[`208`](../tactical/208-installation-metrics-and-feedback-parity.md) adds the
English React and Android disclosure, pseudonymous-statistics controls, reset,
field preview, recipient explanation, privacy link, and hosted-gate status
copy through the existing catalogs. The 1,261/17/442/172 catalog checker,
React tests/typecheck, Android lint/unit/instrumentation assembly, and dual-ABI
generated build pass. It selects no production locale; physical ChromeOS and
Apple compile qualification remain open.

A separate tactical is required to choose and ship the first real
non-English cohort. Android replacement localization remains open until that
cohort passes provenance, native review, lifecycle, layout, accessibility,
and release disclosure. Website, store, marketing, and support-copy
localization remain outside this owner until explicitly planned.
