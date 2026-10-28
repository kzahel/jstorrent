# Localization

Tactical [388](../tactical/388-remaining-localization-campaign.md) is executing
the sixteen remaining legacy-language cohorts using local Sol/high/normal/
bypass workers. The [overnight runbook](../development/localization-overnight.md)
owns queue preparation, independent review, real qualification and resumption.
The planner starts no workers and never infers qualification from registration.

The October 28 German release qualification moves all 2,479 independently
reviewed German resources into shipping inputs for React, native desktop and
Android. This establishes the `en`, `de`, `fr` baseline; none requires a
preview flag. Android's German XML moves byte-for-byte into the main source
set. No translation, terminology or per-message review identity changes.
English remains the fallback and iOS remains English-only. No release/store
publication or installed production profile change is part of this promotion.

German release evidence:

- `node scripts/check-localization.mjs` and the full web unit suite pass
  (925 tests, three existing skips). The existing German System/
  formatting/persistence test now runs with previews explicitly disabled.
  The overnight bootstrap later found that the intentional unsupported-tag
  test needed an explicit TypeScript negative-case annotation; an earlier
  shell sequence had masked that error by continuing to unit tests. Tactical
  388 records its fix and the fail-on-error verification repeat.
- Ordinary, companion and remote Vite builds with previews disabled include
  German and French. The existing CSP guard passes 51 + one + 28 bundles.
  Remote reuses the existing Wasm artifact and a nonconnecting example relay;
  this does not claim a deployed remote-engine or relay qualification.
- All 14 German/French browser cases pass against the actual ordinary
  production assets, served by an owned ephemeral server. System matching,
  overrides, reload, focus, retained selection, plurals, destructive copy,
  390px/1440px layout and Axe checks pass; browser and server are stopped.
- `VITE_RSTORRENT_ENABLE_PREVIEW_LOCALES=0 cargo test -p rstorrent-desktop
  --lib` passes 91 cases; the native menu/IPC example with the same setting
  and `-- de` passes 17/17. The real desktop product smoke with `--locale de`
  and ordinary release assets passes 29/29 across live switching and restart,
  retaining host/profile/views and joining shutdown. The normal debug binary
  is restored. Release library compilation and workspace formatting pass.
- `clients/android/build.sh release`, debug assembly/instrumentation
  compilation/lint, and both debug/release unit suites pass (220 cases each).
  Signed APK/AAB validation confirms the existing identity/certificate,
  matching native ABIs, 16 KiB alignment and disabled language splits.
- The owned Android matrix with `--api 28 --api 35 --locale de` and the
  LanguageSelection, LanguageActivityRecreation, LocalizationCompose and
  LocalizationInstrumentation classes passes seven and nine cases. Both
  temporary AVDs are deleted. No attached production device is used.
- Shared workflow tests (55), Android adapter tests (13), registry/fast-CI
  routing tests (13), release-validator tests (five) and branding checks pass.

Exact reusable commands are in the [shared runbook](../../scripts/LOCALIZATION.md)
and [client guide](../development/clients.md). Runtime evidence here is macOS
and owned Android emulators; Windows/Linux runtime and actual Play delivery
are not claimed by this local promotion.

Tactical [387](../tactical/387-french-localization-with-local-codex.md) adds
complete reviewed French to release inputs for React (1,797 messages), native
desktop (20) and Android (662 resources). English remains the source/fallback,
German is also enabled for release inputs by the qualification follow-up above;
iOS remains English-only. The local
`scripts/localization-codex.py` runner uses the existing ChatGPT CLI login,
explicit model/effort, normal speed and independently verified permission
settings. Separate sessions translate and review frozen batches; deterministic
imports retain their actual identities. Completed outputs and imports are
revalidated on resume, and the owner cancels and joins its worker groups.
The maintainer selected Sol 6.1/high/normal with bypass for this campaign;
no YA pool or external provider routing is used. French platform qualification
and exact evidence are recorded in 387; no release or store update is published.
Android keeps all shipping catalogs in the base APK so offline language changes
also work before Android 13. Native tests cover French zero/one/million plurals,
notifications, recreation and retained service ownership. A formerly count-free
plural explanation is now one complete count-neutral string, independently
updated in French and German without suppressing lint.

The October 28 extraction follow-up closes the three desktop/React gaps
identified in Tactical 384: updater titles, version/download details and known
host-authored statuses; complete removal confirmations, plural warnings and
busy labels; and all six displayed peer connection states. The React catalog
now has 1,797 messages. All 32 new German messages were independently reviewed
and imported through the maintained workflow; eight obsolete removal fragments
were retired with their provenance, and all retained German messages and review
records are unchanged. Android and native desktop catalogs are unchanged.

Single-torrent confirmations retain safe, explicitly supplied bold markup
around the untrusted torrent name. Peer labels and their full-text tooltips
change with the locale, while sorting and diagnostic state values stay stable.
Existing host update statuses are recognized by their exact established text
at presentation time, including saved outcomes; unknown host text and technical
errors remain verbatim. Host wording changes need matching presentation updates
until a separately designed semantic status contract replaces this bridge.

Validation for this follow-up:

- `npm run typecheck --prefix clients/web` and
  `npm run test --prefix clients/web`: 924 tests pass, three existing skips.
  Regressions cover safe rich-text interpolation, removal plurals, pending
  intent, live peer labels, update progress and host-status fallback.
- `npm run test:e2e --prefix clients/web -- german-localization.spec.ts
  localization.spec.ts`: nine bundled-Chromium cases pass, including 1440/390px
  German removal layout/Axe and live peer-label switching.
- `npm run test:e2e --prefix clients/web -- inspection-demo.spec.ts --grep
  'removal keeps data by default|torrent and file rows expose exact accessible
  context actions'`: both English removal/context-action regressions pass.
- `python3 -m unittest discover -s scripts -p 'test_*localization*.py'`:
  46 tests; `python3 -m unittest discover -s clients/android/scripts
  -p test_localization.py`: 13 tests; `node --test
  scripts/test-localization-registry.mjs`: four tests pass.
- `npm exec --prefix clients/web -- vitest run --root clients/web
  scripts/generate-localization.test.mjs
  src/inspection/components/PeerTable.test.tsx`: five focused cases pass.
- `node scripts/check-localization.mjs` and `node scripts/check-branding.mjs`
  pass; all missing/stale/conflicting/invalid/unreviewed/terminology categories
  are empty. Branding checks 2,724 display values and 40 original assets.
- Vite production builds with the preview flag absent and enabled both pass.
  The existing `dynamicCodeViolations` CSP guard passes all 51 JavaScript
  bundles per build; German catalog text is excluded from release output and
  included in preview output. Build outputs use disposable ignored paths.

This is presentation extraction and translation maintenance. Shipping locale
lists and native/platform behavior are unchanged; release promotion remains
separate work.

The web catalog generator launches FormatJS's resolved JavaScript entry point
with the current Node executable, avoiding platform-specific npm shims. Desktop
CI runs generation, the compiler and catalog regression tests, and a generated
catalog drift check before native compilation on Windows, macOS and Linux.

Tactical [385](../tactical/385-configured-locale-registration.md) makes future
language registration data-driven. Platform shipping/preview lists and locale
direction come from one registry; React and native catalog tables are generated,
and Android already reads generated native LocaleConfig. Regional/script parent
fallback, preview exclusion and preference preservation are tested with synthetic
French and RTL locales. Worker prompts now use each exported locale's register
and require an explicit target. Existing German catalogs/review evidence and
English-only releases are unchanged. The maintained runbook lists configuration,
translation, generation, qualification and later promotion steps.

Tactical [384](../tactical/384-shared-translation-workflow-and-desktop-german.md)
extends the German preview to 1,773 shared React and 20 native desktop
messages, alongside Android's 662 translated resources. One offline
CLI exports platform-native catalogs with shared terminology, validates exact
ICU/native placeholders and imports independently reviewed translations.
Per-message source, translation and relevant terminology hashes detect stale
work without invalidating unrelated messages. Existing Android translations
retain their original review evidence; adopting shared terms requires a
separate content-bound terminology review.

The maintained YA runner resolves model aliases and private work-pool IDs at
runtime, bounds concurrent sessions, separates translation from review, and
resumes validated outputs before one importer writes catalogs. Task state and
account routing stay in ignored local files. Full and fast web CI validate
catalogs and all offline workflow tests; translation-only edits do not trigger
engine builds. See
[`scripts/LOCALIZATION.md`](../../scripts/LOCALIZATION.md).

Browser language selection is local presentation state. Desktop native code
owns the choice before creating menus and synchronizes React through events;
changing language does not restart the engine. Configured preview React assets
require `VITE_RSTORRENT_ENABLE_PREVIEW_LOCALES=1`; native previews require that
flag at compile time plus debug assertions. Both ordinary desktop debug launchers
pass it to the frontend and native builds together. English, German and French
are the initial shipping baseline and are available without the flag. Further
qualified cohorts and their evidence are recorded in Tactical 388; the locale
registry is authoritative for current availability.
System language is the default, with English fallback. React, desktop and
Android release inputs advertise only the registry's shipping locales;
additional locales require their own completed review and qualification.
The October 28 follow-up above completes the previously recorded updater,
removal and peer-state extraction cohort. Catalog coverage does not claim that
every possible host diagnostic or desktop sentence is translated.

Tactical [383](../tactical/383-android-translation-cohorts.md) implements
source-aware Android translation tooling and a complete German debug preview:
634 strings and 28 quantities, independently translated and reviewed by
separate sessions. No third-party translations are imported. Settings →
Language initially offered System language, English and Deutsch in debug with
English-only release resources; French and German are now shipping locales. Native
locale ownership, localized notifications,
saved settings drafts, playback position and exact decimal-comma rate input
support switching without changing engine settings. Platform qualification
and the requested Pixel 7a review build are recorded in 383.

The maintainer's October 25 direction replaces mandatory native-speaker
review with agent translation and independent agent review. Human review is
welcome where available, with German and French review planned, but is not a
prerequisite for other locales. English copy refinement produces individual
stale translations to update through the same checked workflow.

The October 17 hosted follow-up to 375 synchronizes Add-to-Settings UI tests
on sheet disappearance and the next button's hittability. A captured failed
run remained on the library after its immediate tap. Localization, navigation
and lower-row reachability assertions are retained; product behavior is unchanged.

Tactical [375](../tactical/375-ci-reconciliation-and-ui-regressions.md)
updates iOS pseudo-locale reachability checks to scroll through the expanded
Settings Form to the actual hittable background-notification switch, while
retaining the runtime-row existence assertion. New safety settings can move
these lazy rows below the fold. Existing localization and
mirrored-toolbar assertions remain; shipping locale policy is unchanged.

Tactical [367](../tactical/367-encrypted-short-links.md) adds four web
messages for encrypted short links, disclosure, expiry and fallback, and
renames the Share panel checkbox to **Include my IP address**. The separate
Worker open page is English-only, with no new localization runtime.

Tactical [357](../tactical/357-rich-share-links.md) adds 37 web messages
(1,499 total) and 27 Android strings (580 total) for share panels, the
address prompt, peer-hint results, file shares and sizes from the link.
Shipping locales remain English.

Tactical [350](../tactical/350-share-links-and-private-hint.md) adds the web
share-link action, toast and private-hint messages and six Android strings
for Copy share link and the private-torrent row and snackbars. Shipping
locales remain English.

Tactical [349](../tactical/349-general-tab-compact-header-and-links.md)
moves the compact General header, copy actions and merged metrics into the
catalog under the Tactical 333 plain-copy check: 10 messages removed, 16
added, 1,352 to 1,358. Shipping locales remain English.

Tactical [333](../tactical/333-web-settings-plain-copy.md) applies the
Tactical 331 cleanup to the shared React catalog: 1,357 to 1,336 messages,
with 184 removed and 163 added. Settings, the Torrent settings dialog and the
General tab no longer show "Effective" runtime lines, engine detail, enum
names or JSX-concatenated sentence fragments. The web catalog check now rejects
maintainer vocabulary and leading-punctuation fragments in those message
prefixes, and `replaceAll("_", " ")` enum display in their components.
Diagnostics tabs are not covered. Shipping locales remain English.

Tactical [331](../tactical/331-android-settings-plain-copy.md) rewrites
Android Settings and torrent Details/Status copy in user vocabulary, removing
48 resources (540 to 492). Settings rows no longer show engine application
state, engine-authored detail or enum names; a failure shows one localized
line. Sizes and rates display as KB/MB (1024-based) and the unmetered
preference is labelled Wi-Fi only. The Android catalog check now rejects
maintainer vocabulary (effective, applied, payload, root, KiB, ...) and raw
`enum.name.lowercase()` in settings/detail sources. Shipping locales remain
English; translations are a later tactical.

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
Android, and iOS. The foundation was English-only; current platform language
availability and qualification are recorded above and in the locale registry.

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

- `locales.json` is the authoritative per-platform shipping locale manifest,
  debug-preview locale list, pseudo-locale list and catalog path map;
- `glossary.json` owns shared product terminology and disambiguation;
- `provenance.json` records catalog source, license, and review state; and
- `source-classification.json` distinguishes presentation copy from user,
  protocol, persistence, diagnostic, fixture, and test text.

## Current Policy

- `en` is both the source locale and ultimate fallback. English source is
  maintained as normal product copy, not imported translation.
- `en-XA` and `ar-XB` are generated test-only pseudo-locales. They must never
  appear in a release locale manifest or product language picker.
- Locale defaults to browser/operating-system preferences. The Android
  in-app language picker offers **System language** by default and a remembered
  explicit override for this installation. Returning to System language clears
  the override and follows subsequent system-language changes. Android 13+
  in-app and system per-app language controls share the platform locale owner;
  older supported Android versions persist one local UI preference. Its
  one-time handoff on an OS upgrade to Android 13 preserves an existing native
  selection and never reapplies the old value after returning to System.
  Language
  selection is not synchronized or added to the engine/application contract.
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
- Agents translate and independently review every translated message with
  its UI context, terminology and argument meanings. Native-speaker review is
  optional additional feedback, not a shipping or ongoing support requirement.
  Record agent review and human review separately; never label agent review
  as native-speaker approval.

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
release resources advertise the manifest's shipping languages from the main
source set. Use the offline [translation workflow](../../clients/android/scripts/LOCALIZATION.md)
to export missing/stale messages, validate independently reviewed responses,
import corrections, check metadata and prune obsolete resources. The global
checker also checks Android locale configuration and all declared catalogs.
Run from the repository root:

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

1. Select a BCP 47 locale from audience evidence, maintenance capacity and
   supported fonts/input/layout. Assign translation and independent review
   agents; an available native reviewer is not required.
2. Add a provenance row naming the exact author/source, license, locale, and
   review state. Do not copy JSTorrent or third-party translations solely from
   their repository-level license.
3. Export the native platform catalogs with translator comments and screenshot
   context. Translation tools receive no runtime access and no private product
   data.
4. Have an independent agent review every translated message in context for
   meaning, terminology, placeholders and plural behavior, with focused review
   of destructive actions, permissions and privacy disclosures. Import the
   reviewed output and run placeholder/plural/catalog validation. Incorporate
   human feedback where available; German and French human review is planned.
5. Run long-text, RTL where applicable, accessibility, platform lifecycle,
   build, and installed/simulator evidence before adding the locale to
   `supportedLocales` or platform release metadata.
6. Update support/store/release disclosure only after the same locale is
   actually packaged in the relevant product.

Resolve material coverage or translation defects before publishing the
affected update; withdraw a locale if those defects cannot be resolved. Lack
of a native reviewer does not disqualify a locale. Never leave a selectable
locale that falls through to raw keys or materially incomplete English.

## Evidence And Open Work

The currently checked catalogs contain 1,797 React messages, 20 Tauri-native
messages, 643 Android strings plus 27 quantities (eight strings are
nontranslatable), 189 iOS product messages and six iOS Info.plist messages.
The German debug catalog covers all 662 translatable Android resources.
Tactical 204 records the foundation's exact
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

Tactical [`346`](../tactical/346-action-feedback-toasts.md) removes success
prose from React command results: accepted commands return typed facts and
each caller chooses catalog copy. Its toast, Undo, failure-list, magnet,
remote-access and settings-failure copy moves into the catalog under
`feedback.*` with ICU plurals, and 15 orphaned result strings are removed;
the checker reports 1,373 React messages. Remaining assembled English outside
those feedback paths, such as torrent-action disabled reasons and
confirmation prompts, is not yet extracted.

Tactical 387 completes the first shipping-input non-English cohort with French
provenance, independent review and platform qualification. Actual release/store
delivery remains a separate publication step. Website, store, marketing and
support-copy localization remain outside this owner until explicitly planned.

The 375 navigation synchronization passes all five UI tests in a fresh owned
iOS 26.5 simulator under Xcode 26.6; the simulator is deleted afterward.
