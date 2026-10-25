# Tactical 204: Cross-Product Localization Foundation

Status: **Complete as of 2026-09-01.** The shared React product, Android
Compose/platform owners, and iOS SwiftUI/platform owners now have complete
checked English catalogs, locale-aware presentation, native fallback, and
long-LTR/RTL pseudo evidence. English remains the only supported production
locale. No translation, publication, store metadata, production identity, or
release operation occurred.

Policy follow-up, 2026-10-25: the maintainer replaces this tactical's historical
native-speaker review requirement with agent translation and independent agent
review. Human review is optional additional feedback. The current policy lives
in the [localization topic](../topics/localization.md), with the Android
translation workflow in [383](383-android-translation-cohorts.md). The same
follow-up includes an Android in-app language picker with a remembered local
override and System language as the default. References below to mandatory
native review or exclusion of an in-app picker/local language preference
describe the foundation's original scope and policy.

Topics: `localization`, `client-surfaces`, `web-ui-design`,
`android-jstorrent-replacement`, `capability-readiness`

Dependencies: completed React product foundation Tactical
[`034`](034-responsive-demo-inspection-ui.md), completed Android product
Tactical [`117`](117-jstorrent-shaped-android-product-ui.md), completed iOS
product-adaptation Tactical
[`148`](148-jstorrent-swiftui-product-surface.md), completed desktop and Android
notification Tacticals
[`164`](164-desktop-completion-and-attention-notifications.md) and
[`198`](198-android-completion-and-attention-notifications.md), and completed
cross-product file-selection Tactical
[`203`](203-jstorrent-shaped-add-time-file-selection.md).

## Product Outcome

All maintained first-party product clients have a complete, testable English
source catalog and can add reviewed language catalogs without restructuring
screens or moving presentation text into the Rust application contract:

- the shared React application covers browser, Tauri, ChromeOS companion,
  configured-headless, and remote builds through one message owner;
- Android Compose, services, notifications, activities, accessibility, and
  system integration use Android string and plurals resources;
- iOS SwiftUI, notifications, lifecycle, storage, accessibility, and system
  integration use an Xcode String Catalog; and
- shared product concepts follow one reviewed terminology and translator-
  context glossary while each platform retains its native catalog format and
  platform-appropriate wording.

The first completed slice advertises English only. Test-only pseudo-locales
exercise long text, placeholder expansion, plural branches, Unicode, and both
left-to-right and right-to-left layout. A real language becomes supported only
in a later reviewed translation cohort with complete coverage, provenance,
native-speaker review, product evidence, and store/listing disclosure.

Locale follows the operating system and browser. Android 13+ and Apple
platforms expose their system per-app language controls once more than one
reviewed locale ships; older Android follows the device locale. React follows
the ordered browser locale list. This tactical adds no RSTorrent application-
contract language preference and no cross-device language synchronization.

## Completion Record

The implementation landed as these reviewable checkpoints:

- `105dddd` planned the bounded cross-product slice;
- `22ccb98` established terminology, locale, classification, and provenance
  policy;
- `ce97c6d` localized the shared React and Tauri-native surfaces;
- `a953e21` localized Compose, Android services, activities, notifications,
  media, SAF, errors, and accessibility;
- `59a6204` qualified Android pseudo-localization on owned API 28/35 AVDs;
- `463172f` replaced the iOS JSON loader with native String Catalogs;
- `b05a1a5` qualified English, double-length, and RTL iOS UI on owned phone
  and tablet simulators;
- `3d7b55e` added an isolated Xcode XLIFF export/import gate; and
- `2300560` reconciled Xcode's native Info.plist extraction keys and made
  extraction-time catalog rewrites fail that gate.

The checked source inventory is 1,225 React messages, 17 Tauri-native
messages, 370 Android strings plus 7 quantities, 172 iOS product messages
including one plural, and 6 iOS Info.plist messages. The repository checker
requires English, comments/context, valid placeholders and plural branches,
zero referenced-key gaps, zero orphaned catalog entries, classified direct
product copy, an English-only release manifest, and absence of packaged
`en-XA`/`ar-XB` assets. Durable Android and iOS presentation state now stores
semantic values and resolves localized prose from the active configuration at
presentation time. No translation was imported; the provenance ledger records
all three English catalogs as maintainer-owned MIT source copy.

React pins `react-intl 10.1.25` (BSD-3-Clause),
`@formatjs/icu-messageformat-parser 3.5.17` (MIT),
`@formatjs/cli 6.16.22` (MIT), and `@babel/parser 8.0.4` (MIT). The lockfile
adds 17 package paths, including seven platform-specific optional FormatJS CLI
packages. The production dependency audit reports zero vulnerabilities. The
full development audit reports one high transitive `nanoid <3.3.18` advisory
(`GHSA-2v37-7h3g-55p8`) in tooling; it is not a production dependency or a
localization runtime path.

Artifact comparison uses pre-implementation commit `22ccb98` and the same
host toolchains:

| Artifact | Before | After | Change |
| --- | ---: | ---: | ---: |
| ordinary web `dist` | 1,932 KiB | 2,156 KiB | +224 KiB |
| remote web `dist` | 2,252 KiB | 2,480 KiB | +228 KiB |
| Android debug APK | 120,209,945 B | 120,503,329 B | +293,384 B |
| Android release APK | 102,953,814 B | 103,145,234 B | +191,420 B |
| iOS application bundle | 21,172 KiB | 21,180 KiB | +8 KiB |
| iOS unsigned archive | 39,012 KiB | 39,064 KiB | +52 KiB |

The ordinary web output splits a 195.66 kB/43.30 kB-gzip application chunk
beside a 1,852.42 kB/314.82 kB-gzip bootstrap. The baseline bootstrap was
1,811.80 kB/316.37 kB gzip. The remote main JavaScript grows from
1,784.06 kB/307.27 kB gzip to 2,016.97 kB/347.43 kB gzip. The accepted
roughly 40--42 kB gzip cost buys the offline ICU runtime and all 1,225 English
messages across every React mode; no catalog is fetched at runtime. The
Android release increase is 0.19%; debug additionally packages generated
pseudo resources. The iOS app replaces a 28 KiB JSON resource with 20 KiB of
native compiled English resources; the remaining binary/archive variation is
link and debug metadata.

### Qualification evidence

- `node scripts/check-localization.mjs` reports all four catalogs valid and
  only `en` shipping.
- React generation, TypeScript, 377 unit tests (2 skipped), ordinary,
  companion, and remote CSP-safe builds pass. Full Playwright reports 39
  passed and 14 opt-in live tests skipped. Its two localization cases cover
  `en-XA` and `ar-XB` at 1,440x900, 920x720, and 390x844, including a dialog,
  no horizontal overflow or raw keys, direction, focus/dismissal, and zero
  serious/critical Axe findings.
- Tauri-native localization unit coverage is included in the 42 passing
  desktop tests and the successful workspace clippy/test gates. The ordinary
  packaged React bundle is shared by browser, Tauri, demo, authenticated, and
  configured-headless runtime adapters rather than rebuilt per adapter.
- Android `build.sh`, 100 JVM tests, lint, debug/test/release APK assembly,
  and static catalog checks pass. A fresh Pixel 6 API 28 AVD passes all 31
  applicable instrumentation cases; a fresh Pixel Tablet API 35 AVD passes
  all 33. Both exercise English plus generated long/RTL pseudo resources,
  Activity recreation, configuration replacement, notification/platform
  owners, dialog/file-selection reachability, and cleanup. Release packaging
  contains no pseudo locale.
- iOS generation and unsigned archive pass. A fresh iPhone 17 Pro simulator
  on iOS 26.5 passes 30 unit and 4 UI tests; a fresh 13-inch iPad Pro passes
  both localization UI tests. Evidence covers English, double-length, RTL,
  huge Dynamic Type, dark appearance, landscape, Add/file selection,
  Settings, notification controls, stable accessibility names, and mirrored
  top-bar order. The archive contains only `en.lproj`.
- `clients/ios/scripts/check-localization-roundtrip.sh` exports `en.xcloc`,
  rejects extraction-time source changes, imports into an isolated project
  copy, and requires both catalogs to remain byte-identical.
- `cargo fmt --all -- --check`, `cargo clippy --workspace -- -D warnings`, and
  `cargo test --workspace` pass. The first workspace test attempt observed one
  transient parallel loopback-port reuse; the focused test passed three times
  and the complete default-parallel workspace rerun passed without a code
  change. Clippy was rerun after restoring the measured web `dist` required by
  Tauri's compile-time context.

The Android and iOS matrix runners remove their task-owned AVDs/simulators and
temporary results on every exit. Baseline checkouts, archives, web outputs,
and XLIFF copies were removed after measurement. Physical-device evidence was
optional and was not needed for this presentation-only foundation.

## Stopping Condition

This tactical is complete only when all of the following are true:

1. Every deliberate user-facing string in the maintained React, Tauri-native,
   Android, and iOS product paths is catalog-backed, including visible copy,
   accessibility names/descriptions, notifications, dialogs, validation,
   empty/loading/error states, menus, updater text, and platform handoff text.
2. A checked source audit distinguishes translatable product copy from user
   content, protocol values, paths, magnets, identifiers, logs, diagnostics,
   developer assertions, fixtures, and test text. The latter remain verbatim
   or separately typed rather than being hidden in translation catalogs.
3. React uses one root locale provider with ICU messages, typed/statically
   checked identifiers, explicit English fallback, locale negotiation, and
   `Intl` number/date/time/list/plural formatting. Every production React
   build mode uses the same catalogs without runtime network fetching.
4. Android uses `strings.xml`, plurals, formatted resources, and a checked
   supported-locale configuration path. Compose and non-Compose owners resolve
   text from the correct configuration after Activity/process recreation
   without caching a stale `Context` or formatted string.
5. iOS replaces the ad hoc English-only JSON loader with an Xcode
   `Localizable.xcstrings` owner using extractable SwiftUI/Foundation APIs,
   plural variants, translator comments, and ordinary Apple locale fallback.
6. Placeholder names/types, plural/select branches, markup policy, and
   required keys are validated before build or import. Missing English is a
   test/build failure; production fallback never renders a raw message key.
7. User-visible numbers, percentages, dates, times, durations, lists, and
   decimal separators are locale-aware where they are presentation values.
   Protocol syntax, hashes, endpoints, log timestamps, exact byte geometry,
   and serialized command values retain their specified canonical forms.
8. Pseudo-localized long-LTR and RTL runs cover representative wide, compact,
   phone, tablet, notification, dialog, settings, detail, empty/error, and
   file-selection states without clipped essential controls, reversed
   direction-neutral tokens, raw keys, broken focus order, or serious/critical
   accessibility findings.
9. A reproducible inventory/export/import/check workflow, translator context,
   glossary, locale manifest, coverage report, and provenance ledger are
   documented. Catalog drift is visible in presubmit rather than discovered
   manually during a release.
10. React unit/E2E/build gates, Android unit/lint/instrumentation/build gates,
    and iOS unit/UI/simulator/archive gates pass with English and applicable
    pseudo-locales. Installed API-28/API-35 evidence covers configuration and
    process replacement; physical UI use remains optional and authorized.

Passing this tactical makes all three clients localization-ready. It does not
claim multilingual support or close the Android replacement localization
disposition until at least one approved non-English release cohort is selected
and qualified.

## Scope

### Shared policy and inventory

- Define stable semantic message identifiers, an English source-copy catalog,
  translator comments, and one glossary for shared terms such as torrent,
  tracker, peer, seeding, download root, Normal/Skip/High, checking, paused,
  completed, published, and remove versus delete data.
- Inventory every product entry point and produce checked counts by platform,
  catalog, and classification. Heuristic literal scans aid review but are not
  accepted as proof of complete extraction.
- Establish locale tags, fallback order, placeholder conventions, plural and
  select policy, rich-text policy, punctuation ownership, capitalization,
  units, direction-neutral technical tokens, and translator context rules.
- Add a repository-owned validation command that reports missing, orphaned,
  malformed, placeholder-incompatible, and unclassified messages without
  depending on a hosted translation service.
- Record every imported translation's author/source, license, review state,
  and exact locale. Existing JSTorrent strings are reference material; no
  translation is copied merely because both repositories are maintained by
  the same person or carry a permissive top-level license.

### Shared React product and desktop adapter

- Add one current React-19-compatible pinned `react-intl`/FormatJS runtime and
  the minimum extraction/validation tooling needed for ICU MessageFormat.
  Record the selected versions, transitive footprint, licenses, CSP behavior,
  build-size change, and why built-in `Intl` alone does not parse messages.
- Mount one locale/message provider above every shared application entry and
  negotiate supported locales from ordered browser preferences with canonical
  BCP 47 matching and explicit English fallback.
- Extract product copy from components, controller-visible errors, tables,
  settings, Add/file selection, media, remote access, diagnostics presentation,
  accessibility attributes, page metadata, and all responsive destinations.
- Route Tauri-native menus, tray, updater, notifications, file/open errors,
  and shell dialogs through packaged desktop catalogs or a deliberate bridge
  from the same locale decision. Native startup must have safe English before
  the React bundle is ready.
- Keep browser, desktop, companion, configured-headless, demo, authenticated,
  and remote artifacts deterministic and CSP-safe. Catalogs are compiled or
  bundled assets, never fetched from a translator or CDN at runtime.
- Add test-only pseudo-catalog generation and strict missing-message handling;
  production retains bounded English fallback with a diagnostic that contains
  the message identifier but no private interpolation values.

### Android Compose and platform owners

- Create the default English `values/strings.xml`, plurals, and translator
  comments, then replace inline product strings across Compose and non-Compose
  activities, services, notifications, Media3 presentation, SAF/root flows,
  external intake, companion lifecycle, errors, and accessibility semantics.
- Configure English as the ultimate fallback and make future reviewed locales
  generate Android's per-app language manifest/configuration. The English-only
  release may omit that advertised list; no empty picker, pseudo-locale, or
  false multilingual control is added inside the application.
- Resolve resources at composition or operation time from the current
  configuration. Durable state stores semantic enum/value intent, never a
  previously formatted localized sentence.
- Use quantity resources and locale-aware platform formatters. Audit fixed
  width, truncation, row height, notification limits, TalkBack order, and
  direction handling under `en-XA` and `ar-XB`-style pseudo evidence.
- Preserve established bounded diagnostic/log text as technical evidence.
  User-facing summaries map typed state/error codes to resources and may show
  a bounded verbatim technical detail separately when useful.

### iOS SwiftUI and platform owners

- Migrate the current `App/Localization/en.json` and `L10n` wrapper to an
  Xcode String Catalog that participates in normal extraction, XLIFF export/
  import, plural variants, translation status, and build validation.
- Extract remaining direct SwiftUI, model, storage, notification, Quick Look,
  background-lifecycle, intake, error, accessibility, and settings copy.
- Prefer `LocalizedStringResource`, localized SwiftUI initializers, and
  Foundation format styles. Keep a small typed facade only where it adds
  placeholder safety or testability; do not retain a parallel JSON authority.
- Use Apple's system language selection/fallback rather than an unsupported
  in-app bundle-swizzling mechanism. Preserve iPhone/iPad layouts, Dynamic
  Type, VoiceOver ordering, and directionality under long and RTL pseudo runs.
- Keep generated UniFFI files and Rust/application values language-neutral.
  Localized platform errors remain presentation details and never become
  durable engine state.

### Translation workflow and documentation

- Add a living localization topic or equivalent durable owner for supported
  locales, fallback, terminology, provenance, review, and release claims.
- Document catalog extraction, validation, pseudo-localization, XLIFF/export,
  translator handoff, import, review, screenshot context, and removal of a
  locale that falls below policy.
- Define the candidate follow-up locale cohort only from product audience,
  translation provenance, maintenance capacity, font/input/layout support,
  and native review. JSTorrent's 19 Android locale directories are evidence
  of prior product breadth, not an automatic RSTorrent launch commitment.
- Update privacy/support/release documents only to describe what actually
  ships. English-only readiness must not appear as multilingual support.

## Non-Goals

- Shipping or advertising any non-English production translation in this
  tactical.
- Automatically copying JSTorrent, libtorrent, Transmission, qBittorrent,
  machine-generated, community, or third-party translations without exact
  provenance, license compatibility, and native-speaker review.
- Localizing `website/`, store listings, release notes, privacy-policy hosting,
  support articles, screenshots, or marketing assets.
- Translating torrent names, file paths, tracker responses, peer client names,
  URLs, magnets, hashes, IP addresses, protocol/debug logs, diagnostic keys,
  or user-supplied labels.
- Adding an application-level language setting, cross-device preference,
  translation service, account, network catalog fetch, or remote feature flag.
- Rewriting product information architecture, adding new product features, or
  changing engine, storage, networking, lifecycle, security, or release policy.
- Full bidirectional-text security policy for arbitrary hostile user content;
  existing escaping and bounds remain authoritative. This tactical still
  prevents product copy from concatenating unsafe directional assumptions.
- Claiming every platform, font, script, locale, or OEM layout works based only
  on pseudo-localization.

## Invariants And Resource Limits

- Rust protocol/domain/application contracts carry typed facts, identifiers,
  bounded technical detail, and stable error codes; they do not carry locale,
  translated copy, catalog keys chosen by a platform, or formatted numbers.
- English source is complete and reviewable. Missing English, placeholder
  mismatch, invalid ICU/XML/String Catalog structure, or duplicate semantic
  ownership fails validation instead of falling through silently.
- Catalog fallback is deterministic, packaged, offline, and bounded. No
  locale choice can trigger network access, code loading, or an unbounded
  cache; at most the selected catalog and English fallback are live.
- Message formatting treats interpolation values as data. React messages do
  not introduce arbitrary HTML; links and emphasis use explicitly supplied
  safe components. Android/iOS format specifiers must match validated types.
- User-controlled strings remain escaped and are never used as message IDs or
  format templates. Diagnostics for missing localization omit private values.
- Stable keys describe meaning, not transient English wording or screen
  coordinates. A semantic change creates or deliberately revises a key;
  obsolete keys are removed through checked catalog maintenance.
- Locale-aware sorting is used only for presentation ordering where accepted.
  Torrent queue order, IDs, protocol ordering, request receipts, persistence,
  and deterministic tests never depend on the display locale.
- Exact technical units and canonical command input remain unambiguous.
  Locale-aware parsing must round-trip through typed validation before a
  command; it cannot silently reinterpret a decimal separator or unit.
- Pseudo-locales are test assets and cannot appear in release locale manifests
  or application language settings.
- Catalog and dependency size changes are measured for ordinary web, remote,
  Android, and iOS artifacts. A material remote/bootstrap regression requires
  an explicit tradeoff rather than silently shipping every locale eagerly.

## Source Study

### Current RSTorrent surfaces

The planning audit on 2026-08-31 found:

- React 19.2.8 has no localization/message dependency. A broad heuristic scan
  finds roughly 1,293 likely string literals in `clients/web/src/inspection`;
  this is an inventory lead, not an exact translatable count.
- Android has no `values/strings.xml` or locale configuration and a heuristic
  scan finds 137 obvious inline Compose/accessibility-style string sites.
- iOS has one 461-line English JSON catalog, a custom fallback loader, 92
  explicit `L10n` call sites, and roughly 99 remaining direct SwiftUI literal
  sites. It has no reviewed non-English catalog.

Exact implementation inventory must classify every current source rather than
using these heuristic counts as a completion metric.

### JSTorrent product reference

The inspected local JSTorrent revision is
`25e4b701433fd815398ba89526546f5e4f072e3f`. Relevant paths include:

- `android/app/src/main/res/values/strings.xml` and 19 translated
  `values-*` directories;
- `android/app/src/main/res/xml/locales_config.xml`;
- `SettingsViewModel.setAppLocale` and the Advanced Settings language UI; and
- `android/scripts/translate/`, including source matching, prompt generation,
  merge, escaping, and locale validation.

RSTorrent adopts the lessons that locale tags, fallback, plurals, compact
mobile copy, system integration, and repeatable merge checks must be explicit.
It deliberately does not inherit JSTorrent's locale list, translation quality,
in-app picker, scripts, or third-party string provenance without a fresh audit.
The JSTorrent checkout's MIT license is necessary but not sufficient evidence
for translations its scripts may have matched from other projects.

### Platform and web references

- Android Developers, **Per-app language preferences** and `LocaleConfig`:
  <https://developer.android.com/guide/topics/resources/app-languages> and
  <https://developer.android.com/reference/android/app/LocaleConfig>.
- Apple Developer, **Localizing and varying text with a string catalog** and
  **Exporting localizations**:
  <https://developer.apple.com/documentation/xcode/localizing-and-varying-text-with-a-string-catalog>
  and <https://developer.apple.com/documentation/xcode/exporting-localizations>.
- FormatJS source and current React integration notes:
  <https://github.com/formatjs/formatjs>. The implementation records the exact
  pin, license set, React-19/TypeScript-7 compatibility, and bundle evidence.
- W3C Web Accessibility Initiative, **Accessibility Principles**:
  <https://www.w3.org/WAI/fundamentals/accessibility-principles/>.

These references guide platform integration and validation. They do not
authorize network translation services or establish translation quality.

## Owner And Dependency Map

```text
typed application facts and stable error/status codes
                 |
        platform presentation adapters
          /             |             \
 React locale owner  Android resources  Apple String Catalog
 browser/desktop     Compose/services    SwiftUI/platform owners
          \             |             /
       shared English terminology and provenance policy
```

- Rust/application owners remain unaware of locale and translated copy.
- Each client owns locale negotiation, its packaged catalogs, formatting, and
  platform-native lifecycle. Locale changes do not restart the engine.
- The shared React provider owns browser/Tauri product messages; native Tauri
  startup owners consume packaged desktop messages without waiting for React.
- Android resources are configuration-scoped; services and notifications
  resolve from the active application locale at operation time.
- Apple bundles and String Catalogs own iOS fallback and system selection.
- Repository validation owns catalog shape, shared terminology, coverage, and
  provenance. It performs finite file work and starts no runtime task.

The concrete boundary improvement is removal of localized prose from durable
or long-lived presentation state. Owners retain typed values and format them
late through the current locale.

## Validation Plan

### Static catalog and source gates

- exact catalog parse, key uniqueness, English completeness, unused-key and
  unclassified-literal reports;
- placeholder name/type equality, plural/select completeness, rich-text
  allowlist, translator comments, locale tags, fallback, and pseudo exclusion;
- deterministic extraction/export/import round trips with no network access;
- source rules covering JSX/TS, Kotlin/Compose/non-Compose, Swift/SwiftUI,
  Android XML, Apple String Catalogs, manifests, notifications, and adapters;
- dependency/license/advisory inventory and measured build/artifact deltas.

### React

- unit tests for negotiation, canonical tags, English fallback, missing keys,
  placeholders, plural/select branches, number/date/list formatting, RTL
  direction, safe rich text, and diagnostic redaction;
- component coverage of navigation, tables, detail tabs, Settings, Add/file
  selection, media, remote access, notifications/updater, and errors;
- Playwright English, long-LTR pseudo, and RTL pseudo at wide, compact, and
  phone sizes with keyboard/focus behavior and serious/critical Axe checks;
- ordinary, companion, remote, demo, Tauri, and configured-headless builds,
  including CSP and remote bootstrap/bundle-size checks.

### Android

- JVM tests for resource mappings, quantities, formatters, semantic error
  mapping, and absence of localized sentences in durable presentation state;
- lint plus source/catalog checks for inline product strings and malformed
  resource formatting;
- Compose instrumentation under English, long pseudo-LTR, and pseudo-RTL for
  Library/detail, Settings, Add/file selection, dialogs, notifications,
  playback, SAF repair, external intake, TalkBack semantics, and rotation;
- installed API 28 and API 35 locale/configuration, Activity recreation,
  process replacement, notification tap, service reconnect, and cleanup.

### iOS

- String Catalog validation, extraction, XLIFF export/import round trip,
  placeholder/plural tests, English fallback, and missing-key failure;
- Swift unit/UI tests under English, double-length, and RTL pseudo settings for
  iPhone and iPad layouts, Dynamic Type, VoiceOver labels, notifications,
  intake, root repair, file selection, Quick Look handoff, and errors;
- generated project drift, simulator build/tests, and unsigned archive with no
  parallel JSON localization authority.

### Repository gates

After sourcing the configured profile:

```text
cargo fmt --all -- --check
cargo clippy --workspace -- -D warnings
cargo test --workspace
npm run generate --prefix clients/web
npm run typecheck --prefix clients/web
npm run test --prefix clients/web
npm run test:e2e --prefix clients/web
npm run build --prefix clients/web
npm run build:companion --prefix clients/web
npm run build:remote --prefix clients/web
./clients/android/build.sh
./clients/android/gradlew -p clients/android lintDebug \
  assembleDebugAndroidTest
clients/ios/scripts/generate-project.sh
clients/ios/scripts/archive.sh --unsigned <task-owned-archive-path>
```

Run connected Android tests and iOS simulator tests through their documented
commands. Remove generated screenshots, reports, archives, packages, profiles,
and temporary localization exports before completion.

## Implementation Sequence

1. Land shared terminology, classification, locale/fallback policy, checked
   inventory, provenance shape, and validation harness before bulk extraction.
2. Pin and audit FormatJS, add the React provider/catalog, convert one complete
   vertical slice, then extract all shared and native-desktop product copy.
3. Add Android English resources and locale configuration, then convert
   Compose and non-Compose/platform owners with pseudo instrumentation.
4. Migrate iOS JSON to an Apple String Catalog, remove the parallel loader,
   and convert remaining SwiftUI/platform copy with pseudo simulator evidence.
5. Reconcile shared terminology and formatting behavior without forcing one
   catalog format or identical platform phrasing.
6. Run cross-product static, responsive, accessibility, process/lifecycle,
   installed/simulator, archive, and full repository gates; record artifact
   size and catalog coverage.
7. Update living topics and readiness without claiming a supported
   non-English locale. Create a separate reviewed translation-cohort tactical
   when provenance, reviewers, and target locales are selected.

## Escalation Contract

Implementation may add the one pinned FormatJS runtime and minimum extraction
tooling described above, platform-native catalog files, validation scripts,
test-only pseudo catalogs, and proportionate presentation refactors without
further direction once this tactical is approved for implementation.

Stop for maintainer direction if evidence requires:

- shipping or advertising a real non-English locale;
- importing translations whose provenance, license, or review is incomplete;
- a hosted translation service, runtime catalog fetch, account, API key, or
  generated network code;
- a second React runtime dependency beyond the selected bounded FormatJS set,
  Android AppCompat solely for an in-app picker, or iOS bundle swizzling;
- an application-contract locale setting or synchronization across clients;
- translating or restructuring protocol, diagnostic, user-content, security,
  persistence, or engine semantics;
- excluding a maintained first-party product mode from the English catalog;
- accepting raw-key fallback, placeholder mismatch, inaccessible truncation,
  or a production pseudo-locale; or
- publication, signing, store/listing mutation, or physical-device use not
  already authorized.

Ordinary copy review, extraction volume, layout repair, catalog drift, build
failure, and pseudo-localization defects remain within this tactical.

## Documentation Completion

Before marking complete:

- record commits, exact catalog/inventory counts, FormatJS pin/licenses and
  artifact deltas, platform commands, pseudo-locale matrices, failures, and
  cleanup here;
- update `client-surfaces` and `web-ui-design` with the final owner, fallback,
  formatting, and validation behavior;
- update the Android localization disposition without claiming translations;
- update `capability-readiness` and the tactical index; and
- leave actual translation cohorts, website/store copy, JAR-004/JAR-005/
  JAR-010, release, and production identity work separate.
