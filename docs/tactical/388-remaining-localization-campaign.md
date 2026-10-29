# 388 — Remaining localization campaign

Status: **Complete (October 29, 2026).** All sixteen remaining locales are
independently reviewed, release-qualified and committed across React, native
desktop and Android: 39,664 resources and nineteen total release-input locales.
Final aggregate builds, packaged-language checks and runtime repeats pass.

## Scope and stopping condition

Run a supervised overnight campaign for the sixteen remaining locales in
the previous TypeScript Android client: `es`, `it`, `pt-BR`, `nl`, `sv`, `da`,
`cs`, `pl`, `ro`, `ru`, `uk`, `tr`, `ja`, `ko`, `zh-CN` and `zh-TW`. English,
German and French are the completed baseline. Each locale covers the shared
React UI, native desktop shell and Android; iOS, website/store/support copy,
release publication and changes to installed production applications are out
of scope.

Carry forward the maintainer's local subscription settings: `gpt-6.1-sol`, high
reasoning, normal speed and bypass permissions. Do not use a YA/work account,
API-key provider, cloud delegation or Fast tier. Reuse the maintained local
worker runner and checked importer rather than introducing another executor.

Preparation produces a reviewed locale inventory and register/plural profiles,
a source-bound campaign plan/status command, a reusable production-browser
qualification harness and a self-contained kickoff/resume runbook. No new
locale becomes selectable and no translation is launched by preparing or
inspecting a plan. The supervisor remains responsible for glossary preparation,
platform qualification, corrections and per-locale commits. Do not describe
translation completion as full product qualification.

Campaign completion means each locale's three current catalogs are complete
and independently reviewed, real locale checks pass, release registration and
Android resource packaging are verified, evidence is recorded and the locale
is committed. A failed locale remains pending while other independent locales
continue; never label preview-only work finished. Do not wait on remote CI
unless the maintainer asks again.

## Invariants and resource bounds

- Freeze English source/context hashes in the local plan. Changing those
  inputs invalidates the plan; never rewrite worker output hashes to conceal
  drift. Existing export/import checks own per-message freshness.
- At most three local model workers total. Run one platform/locale runner at a
  time with at most three workers, 80 resources per batch and three batches per
  worker. Translation and independent review always use different sessions.
- One importer per platform/locale, one native product smoke and one owned
  Android emulator session at a time. Reuse process ownership, cancellation,
  bounded logs and exact resumption from Tactical 387.
- Keep account routing, signing material, task logs, plans and response paths
  in ignored local state. Commit only source, catalogs, review provenance,
  tools and useful evidence summaries. Preserve existing user preferences and
  shipping translation/review records.
- Prepare language-specific register and terminology before exporting jobs.
  Android quantity profiles are checked against the runtime's CLDR categories
  and must additionally pass Android resource lint and API 28/35 execution.
  Never copy German examples or plural branches to another language.

## Qualification prerequisites

Chinese needs explicit region/script System probes. The bootstrap now resolves
`zh-Hans-CN` to `zh-CN`, `zh-Hant-TW` to `zh-TW`, and the relevant Hong Kong/
Singapore forms after existing exact/parent lookup. Synthetic tests cover all
three runtimes before real catalogs exist. Actual production and native
resource probes remain required for each cohort. Simplified and Traditional
stay separate; an unavailable script never silently selects the other one.

Brazilian Portuguese retains its regional identity, including a maximized
`pt-Latn-BR` System request. Slavic/Romanian/Czech
quantity categories and Chinese/Japanese/Korean single-category quantities
need real native-resource checks. A large language picker must keep its actions
reachable; do not rely solely on the earlier three-language layout evidence.

## Validation

Test stale-plan detection, exact legacy inventory, locale/path/quantity
validation, immutable model settings and status that cannot confuse reviewed
catalogs with qualified release inputs. Exercise the generic browser harness
against current German and French production assets, including actual System
selection, switching, persistence, focus, destructive copy and narrow layout.
Run existing catalog/registry/workflow checks and proportional client checks.
Record exact commands, preparation gaps and the final kickoff instructions.

## Execution checkpoints

German release qualification is committed as `582a0baf`; all 2,479 German
resources retain their exact translation and review records. The release
registry now exposes English, German and French across React, desktop and
Android. The earlier source count and first-party provenance remain unchanged.

The campaign plan matches all eighteen old translated Android locale files
and excludes the English/German/French baseline from new authoring. It binds
the three English source catalogs, native comments, English glossary and
sixteen-locale manifest, and reports 39,664 resources. Read-only environment
preflight found the local ChatGPT CLI login, Node, Rust, Java, ADB, emulator and
over 100 GiB free without starting a model session.

Preparation tests: six campaign regressions, all 61 shared workflow cases,
three browser-harness argument cases, thirteen registry/fast-CI routing checks,
and all 928 web unit cases pass (three existing skips). The reusable browser
harness passes seven cases each for German and French against actual ordinary
production assets with regional System probes, pseudo exclusion, exact shipping
picker membership, switching/persistence/focus and narrow destructive dialogs.
It closes its bundled Chromium and ephemeral server and writes hashed evidence.

On authorization, one owned local supervisor started at most three auxiliary
workers: regional-matching implementation plus terminology authors/reviewers.
Glossary jobs freeze all nineteen semantic concepts and each locale's register;
independent reviews bind the exact candidate and source hashes. Actual CLI
rollout settings are checked before acceptance. Completed future glossaries
remain ignored until that locale's active cohort, avoiding incomplete shipping
registration. No remote CI watching or release publication is part of the run.

Bootstrap recovery: one terminology reviewer rejected the ambiguous use of
"SHA-256" for canonical JSON fingerprints rather than raw file bytes. The
rejected report and interrupted attempts were retained, the exact canonical
serialization was specified, and a new independent review approved the same
frozen Portuguese inputs. Approved Spanish/Italian/Dutch outputs were reused;
no hashes or approval flags were stamped current. Local process groups were
joined before restart. Per-locale validation rejection now preserves its
evidence and retries independently instead of cancelling healthy sibling work.

The matching worker also found a TypeScript error in an intentional runtime
rejection test introduced during German promotion. The negative case is now
explicitly annotated, shipping-list expectations are data-driven for future
cohorts, and verification is repeated with fail-on-error commands. Earlier
shell sequences had continued past the typecheck error; their unit-test passes
remain valid but do not establish typecheck success.

Final bootstrap verification uses fail-on-error commands: web typecheck and all
958 web cases pass (three existing skips); `cargo fmt --all -- --check`, focused
desktop Clippy with warnings denied and all 94 desktop unit cases pass. Android
debug/release unit suites pass 225 cases each; debug/release lint and APK/test
compilation pass. The owned German matrix passes nine API 28 and eleven API 35
cases, including native count formatting and a 30-option choice dialog. The
first API 35 run exposed a lag between projected resources and `Locale` default;
refreshing formatting immediately after the platform language setter fixes the
race, and both API repeats pass without weakening the assertions. Regional
locale assertions retain both language and region rather than comparing a
language code to a full `pt-BR`-style tag. Both AVDs are removed afterward.

The rebuilt production frontend passes all seven generic browser cases for
each of German and French. Android's choice list now scrolls within its dialog,
keeping the final item and Cancel reachable. Unsupported stored Android tags
continue to follow System without rewriting their value, and the existing
OS-upgrade handoff transfers the original tag rather than a lossy normalization;
the migration ledger is updated in the same change.

Reference paths consulted: qBittorrent `src/base/preferences.cpp` and
`src/app/application.cpp` select System by default and retain English when no
catalog loads; Transmission `qt/Application.cc` delegates locale-aware loading
to Qt and explicitly retries English. We retain JSTorrent's existing System/
explicit-choice ownership and final English fallback, adding bounded equivalent
catalog matches in its three existing presentation runtimes rather than a Qt or
new locale dependency. Bare Chinese/unknown regions do not guess a script.
No reference source or third-party translation catalog is copied.

Spanish native qualification reproduced the earlier intermittent startup-focus
failure: all live checks passed, but reopening Settings and immediately choosing
System let the dialog's delayed autofocus move focus to Close. A deterministic
React regression reproduces that exact outcome before the fix. Initial dialog
focus now runs during layout, before later interaction, rather than as a passive
effect. The language-save focus guard is unchanged and still respects focus
moved elsewhere by the user. Strict typecheck, all 959 web cases and the full
isolated Spanish native product smoke (16 live + 13 restart) pass afterward;
normal frontend/binary restoration and joined shutdown remain intact. No focus
assertion or timeout was weakened. Reviewed translation outputs are retained
while the complete qualification is repeated against the corrected product.

Brazilian Portuguese passed production-browser regional probes and the native
product smoke, then Android lint rejected the count-free `remove_torrent_title`
`one` branch: Portuguese uses that category for both zero and one. The existing
importer permits the source count argument in every target branch, so no English
or argument-contract change is needed. Worker guidance now explicitly requires
counts in categories representing multiple numbers, including Portuguese and
Slavic `one`. A fresh, narrowly selected export and separate local author/review
sessions correct the resource; prior approved outputs remain intact. Full
qualification must repeat against the reviewed correction before promotion is
committed. Android lint is retained as a required gate.

Swedish's first API 35 matrix exposed a test-oracle race during return to System.
API 28 and the other API 35 cases passed. A ten-cycle diagnostic reproduced the
failure on cycle seven: `Resources.getSystem()` briefly reported Swedish, so
the test captured `Redo` as its expected value, while the actual app resources
and formatter had correctly returned to English (`Ready`). Five seconds later
the global resource configuration was English too, but the captured expectation
remained Swedish. This was a false failure rather than a locale-save failure.

The test now captures the underlying System locale before switching, using
[`LocaleManager.getSystemLocales()`](https://developer.android.com/reference/android/app/LocaleManager#getSystemLocales())
on API 33+, whose contract explicitly ignores app overrides. API 28 retains its
existing resource-based System lookup. Ten override/reset cycles retain every
resource, notification, channel, formatter and preference assertion and the
five-second convergence deadline. Failure messages include the actual resource
and locale state. The full owned matrix passes nine API 28 and eleven API 35
cases with this regression in place, and both AVDs are removed. Swedish's full
release qualification repeats after the test correction is committed.

| Locale | Terminology | React / desktop / Android | Qualification / release |
| --- | --- | --- | --- |
| es | Reviewed | 1,797 / 20 / 662 reviewed | Release qualified |
| it | Reviewed | 1,797 / 20 / 662 reviewed | Release qualified |
| pt-BR | Reviewed | 1,797 / 20 / 662 reviewed | Release qualified |
| nl | Reviewed | 1,797 / 20 / 662 reviewed | Release qualified |
| sv | Reviewed | 1,797 / 20 / 662 reviewed | Release qualified |
| da | Reviewed | 1,797 / 20 / 662 reviewed | Release qualified |
| cs | Reviewed | 1,797 / 20 / 662 reviewed | Release qualified |
| pl | Reviewed | 1,797 / 20 / 662 reviewed | Release qualified |
| ro | Reviewed | 1,797 / 20 / 662 reviewed | Release qualified |
| ru | Reviewed | 1,797 / 20 / 662 reviewed | Release qualified |
| uk | Reviewed | 1,797 / 20 / 662 reviewed | Release qualified |
| tr | Reviewed | 1,797 / 20 / 662 reviewed | Release qualified |
| ja | Reviewed | 1,797 / 20 / 662 reviewed | Release qualified |
| ko | Reviewed | 1,797 / 20 / 662 reviewed | Release qualified |
| zh-CN | Reviewed | 1,797 / 20 / 662 reviewed | Release qualified |
| zh-TW | Reviewed | 1,797 / 20 / 662 reviewed | Release qualified |

## Completed locale evidence

### Spanish (`es`)

All 2,479 resources are independently translated/reviewed with verified local
Sol 6.1/high/normal/bypass sessions. Shared terminology has separate author and
reviewer identities. All three platform lists advertise release support; the
Android catalog is in `main`, and preview registration is removed. English and
all previously shipping languages are retained.

Validation: source/catalog/provenance checks and typecheck; 959 web and
94 desktop unit cases; 8 production-browser cases with the profile's
System probes, exact shipping picker, pseudo exclusion, persistence/focus,
plural/destructive copy, narrow layout and Axe; native menu 17/17 and product
29/29 across restart; native release compilation and workspace formatting.
Android debug/release unit suites pass 225/225 cases, resource/Kotlin release
packaging and both lint variants pass, and signed APK/AAB identity, ABI,
16 KiB alignment and offline language packaging validate. Owned API 28/35
matrices pass 9/11 cases and remove both AVDs. Branding and all ordinary/companion/
remote frontend CSP checks pass. Android packaging reuses unchanged prequalified
Rust/JNI inputs; remote frontend reuses unchanged Wasm with a nonconnecting
example relay. Runtime evidence is macOS/owned Android, with no deployed relay,
Windows/Linux runtime or publication claim.

### Italian (`it`)

All 2,479 resources are independently translated/reviewed with verified local
Sol 6.1/high/normal/bypass sessions. Shared terminology has separate author and
reviewer identities. All three platform lists advertise release support; the
Android catalog is in `main`, and preview registration is removed. English and
all previously shipping languages are retained.

Validation: source/catalog/provenance checks and typecheck; 959 web and
94 desktop unit cases; 7 production-browser cases with the profile's
System probes, exact shipping picker, pseudo exclusion, persistence/focus,
plural/destructive copy, narrow layout and Axe; native menu 17/17 and product
29/29 across restart; native release compilation and workspace formatting.
Android debug/release unit suites pass 225/225 cases, resource/Kotlin release
packaging and both lint variants pass, and signed APK/AAB identity, ABI,
16 KiB alignment and offline language packaging validate. Owned API 28/35
matrices pass 9/11 cases and remove both AVDs. Branding and all ordinary/companion/
remote frontend CSP checks pass. Android packaging reuses unchanged prequalified
Rust/JNI inputs; remote frontend reuses unchanged Wasm with a nonconnecting
example relay. Runtime evidence is macOS/owned Android, with no deployed relay,
Windows/Linux runtime or publication claim.

### Brazilian Portuguese (`pt-BR`)

All 2,479 resources are independently translated/reviewed with verified local
Sol 6.1/high/normal/bypass sessions. Shared terminology has separate author and
reviewer identities. All three platform lists advertise release support; the
Android catalog is in `main`, and preview registration is removed. English and
all previously shipping languages are retained.

Validation: source/catalog/provenance checks and typecheck; 959 web and
94 desktop unit cases; 8 production-browser cases with the profile's
System probes, exact shipping picker, pseudo exclusion, persistence/focus,
plural/destructive copy, narrow layout and Axe; native menu 17/17 and product
29/29 across restart; native release compilation and workspace formatting.
Android debug/release unit suites pass 225/225 cases, resource/Kotlin release
packaging and both lint variants pass, and signed APK/AAB identity, ABI,
16 KiB alignment and offline language packaging validate. Owned API 28/35
matrices pass 9/11 cases and remove both AVDs. Branding and all ordinary/companion/
remote frontend CSP checks pass. Android packaging reuses unchanged prequalified
Rust/JNI inputs; remote frontend reuses unchanged Wasm with a nonconnecting
example relay. Runtime evidence is macOS/owned Android, with no deployed relay,
Windows/Linux runtime or publication claim.

### Dutch (`nl`)

All 2,479 resources are independently translated/reviewed with verified local
Sol 6.1/high/normal/bypass sessions. Shared terminology has separate author and
reviewer identities. All three platform lists advertise release support; the
Android catalog is in `main`, and preview registration is removed. English and
all previously shipping languages are retained.

Validation: source/catalog/provenance checks and typecheck; 959 web and
94 desktop unit cases; 8 production-browser cases with the profile's
System probes, exact shipping picker, pseudo exclusion, persistence/focus,
plural/destructive copy, narrow layout and Axe; native menu 17/17 and product
29/29 across restart; native release compilation and workspace formatting.
Android debug/release unit suites pass 225/225 cases, resource/Kotlin release
packaging and both lint variants pass, and signed APK/AAB identity, ABI,
16 KiB alignment and offline language packaging validate. Owned API 28/35
matrices pass 9/11 cases and remove both AVDs. Branding and all ordinary/companion/
remote frontend CSP checks pass. Android packaging reuses unchanged prequalified
Rust/JNI inputs; remote frontend reuses unchanged Wasm with a nonconnecting
example relay. Runtime evidence is macOS/owned Android, with no deployed relay,
Windows/Linux runtime or publication claim.

### Swedish (`sv`)

All 2,479 resources are independently translated/reviewed with verified local
Sol 6.1/high/normal/bypass sessions. Shared terminology has separate author and
reviewer identities. All three platform lists advertise release support; the
Android catalog is in `main`, and preview registration is removed. English and
all previously shipping languages are retained.

Validation: source/catalog/provenance checks and typecheck; 959 web and
94 desktop unit cases; 7 production-browser cases with the profile's
System probes, exact shipping picker, pseudo exclusion, persistence/focus,
plural/destructive copy, narrow layout and Axe; native menu 17/17 and product
29/29 across restart; native release compilation and workspace formatting.
Android debug/release unit suites pass 225/225 cases, resource/Kotlin release
packaging and both lint variants pass, and signed APK/AAB identity, ABI,
16 KiB alignment and offline language packaging validate. Owned API 28/35
matrices pass 9/11 cases and remove both AVDs. Branding and all ordinary/companion/
remote frontend CSP checks pass. Android packaging reuses unchanged prequalified
Rust/JNI inputs; remote frontend reuses unchanged Wasm with a nonconnecting
example relay. Runtime evidence is macOS/owned Android, with no deployed relay,
Windows/Linux runtime or publication claim.

### Danish (`da`)

All 2,479 resources are independently translated/reviewed with verified local
Sol 6.1/high/normal/bypass sessions. Shared terminology has separate author and
reviewer identities. All three platform lists advertise release support; the
Android catalog is in `main`, and preview registration is removed. English and
all previously shipping languages are retained.

Validation: source/catalog/provenance checks and typecheck; 959 web and
94 desktop unit cases; 7 production-browser cases with the profile's
System probes, exact shipping picker, pseudo exclusion, persistence/focus,
plural/destructive copy, narrow layout and Axe; native menu 17/17 and product
29/29 across restart; native release compilation and workspace formatting.
Android debug/release unit suites pass 225/225 cases, resource/Kotlin release
packaging and both lint variants pass, and signed APK/AAB identity, ABI,
16 KiB alignment and offline language packaging validate. Owned API 28/35
matrices pass 9/11 cases and remove both AVDs. Branding and all ordinary/companion/
remote frontend CSP checks pass. Android packaging reuses unchanged prequalified
Rust/JNI inputs; remote frontend reuses unchanged Wasm with a nonconnecting
example relay. Runtime evidence is macOS/owned Android, with no deployed relay,
Windows/Linux runtime or publication claim.

### Czech (`cs`)

All 2,479 resources are independently translated/reviewed with verified local
Sol 6.1/high/normal/bypass sessions. Shared terminology has separate author and
reviewer identities. All three platform lists advertise release support; the
Android catalog is in `main`, and preview registration is removed. English and
all previously shipping languages are retained.

Validation: source/catalog/provenance checks and typecheck; 959 web and
94 desktop unit cases; 7 production-browser cases with the profile's
System probes, exact shipping picker, pseudo exclusion, persistence/focus,
plural/destructive copy, narrow layout and Axe; native menu 17/17 and product
29/29 across restart; native release compilation and workspace formatting.
Android debug/release unit suites pass 225/225 cases, resource/Kotlin release
packaging and both lint variants pass, and signed APK/AAB identity, ABI,
16 KiB alignment and offline language packaging validate. Owned API 28/35
matrices pass 9/11 cases and remove both AVDs. Branding and all ordinary/companion/
remote frontend CSP checks pass. Android packaging reuses unchanged prequalified
Rust/JNI inputs; remote frontend reuses unchanged Wasm with a nonconnecting
example relay. Runtime evidence is macOS/owned Android, with no deployed relay,
Windows/Linux runtime or publication claim.

### Polish (`pl`)

All 2,479 resources are independently translated/reviewed with verified local
Sol 6.1/high/normal/bypass sessions. Shared terminology has separate author and
reviewer identities. All three platform lists advertise release support; the
Android catalog is in `main`, and preview registration is removed. English and
all previously shipping languages are retained.

Validation: source/catalog/provenance checks and typecheck; 959 web and
94 desktop unit cases; 7 production-browser cases with the profile's
System probes, exact shipping picker, pseudo exclusion, persistence/focus,
plural/destructive copy, narrow layout and Axe; native menu 17/17 and product
29/29 across restart; native release compilation and workspace formatting.
Android debug/release unit suites pass 225/225 cases, resource/Kotlin release
packaging and both lint variants pass, and signed APK/AAB identity, ABI,
16 KiB alignment and offline language packaging validate. Owned API 28/35
matrices pass 9/11 cases and remove both AVDs. Branding and all ordinary/companion/
remote frontend CSP checks pass. Android packaging reuses unchanged prequalified
Rust/JNI inputs; remote frontend reuses unchanged Wasm with a nonconnecting
example relay. Runtime evidence is macOS/owned Android, with no deployed relay,
Windows/Linux runtime or publication claim.

### Romanian (`ro`)

All 2,479 resources are independently translated/reviewed with verified local
Sol 6.1/high/normal/bypass sessions. Shared terminology has separate author and
reviewer identities. All three platform lists advertise release support; the
Android catalog is in `main`, and preview registration is removed. English and
all previously shipping languages are retained.

Validation: source/catalog/provenance checks and typecheck; 959 web and
94 desktop unit cases; 7 production-browser cases with the profile's
System probes, exact shipping picker, pseudo exclusion, persistence/focus,
plural/destructive copy, narrow layout and Axe; native menu 17/17 and product
29/29 across restart; native release compilation and workspace formatting.
Android debug/release unit suites pass 225/225 cases, resource/Kotlin release
packaging and both lint variants pass, and signed APK/AAB identity, ABI,
16 KiB alignment and offline language packaging validate. Owned API 28/35
matrices pass 9/11 cases and remove both AVDs. Branding and all ordinary/companion/
remote frontend CSP checks pass. Android packaging reuses unchanged prequalified
Rust/JNI inputs; remote frontend reuses unchanged Wasm with a nonconnecting
example relay. Runtime evidence is macOS/owned Android, with no deployed relay,
Windows/Linux runtime or publication claim.

### Russian (`ru`)

All 2,479 resources are independently translated/reviewed with verified local
Sol 6.1/high/normal/bypass sessions. Shared terminology has separate author and
reviewer identities. All three platform lists advertise release support; the
Android catalog is in `main`, and preview registration is removed. English and
all previously shipping languages are retained.

Validation: source/catalog/provenance checks and typecheck; 959 web and
94 desktop unit cases; 7 production-browser cases with the profile's
System probes, exact shipping picker, pseudo exclusion, persistence/focus,
plural/destructive copy, narrow layout and Axe; native menu 17/17 and product
29/29 across restart; native release compilation and workspace formatting.
Android debug/release unit suites pass 225/225 cases, resource/Kotlin release
packaging and both lint variants pass, and signed APK/AAB identity, ABI,
16 KiB alignment and offline language packaging validate. Owned API 28/35
matrices pass 9/11 cases and remove both AVDs. Branding and all ordinary/companion/
remote frontend CSP checks pass. Android packaging reuses unchanged prequalified
Rust/JNI inputs; remote frontend reuses unchanged Wasm with a nonconnecting
example relay. Runtime evidence is macOS/owned Android, with no deployed relay,
Windows/Linux runtime or publication claim.

### Ukrainian (`uk`)

All 2,479 resources are independently translated/reviewed with verified local
Sol 6.1/high/normal/bypass sessions. Shared terminology has separate author and
reviewer identities. All three platform lists advertise release support; the
Android catalog is in `main`, and preview registration is removed. English and
all previously shipping languages are retained.

Validation: source/catalog/provenance checks and typecheck; 959 web and
94 desktop unit cases; 7 production-browser cases with the profile's
System probes, exact shipping picker, pseudo exclusion, persistence/focus,
plural/destructive copy, narrow layout and Axe; native menu 17/17 and product
29/29 across restart; native release compilation and workspace formatting.
Android debug/release unit suites pass 225/225 cases, resource/Kotlin release
packaging and both lint variants pass, and signed APK/AAB identity, ABI,
16 KiB alignment and offline language packaging validate. Owned API 28/35
matrices pass 9/11 cases and remove both AVDs. Branding and all ordinary/companion/
remote frontend CSP checks pass. Android packaging reuses unchanged prequalified
Rust/JNI inputs; remote frontend reuses unchanged Wasm with a nonconnecting
example relay. Runtime evidence is macOS/owned Android, with no deployed relay,
Windows/Linux runtime or publication claim.

### Turkish (`tr`)

All 2,479 resources are independently translated/reviewed with verified local
Sol 6.1/high/normal/bypass sessions. Shared terminology has separate author and
reviewer identities. All three platform lists advertise release support; the
Android catalog is in `main`, and preview registration is removed. English and
all previously shipping languages are retained.

Validation: source/catalog/provenance checks and typecheck; 959 web and
94 desktop unit cases; 7 production-browser cases with the profile's
System probes, exact shipping picker, pseudo exclusion, persistence/focus,
plural/destructive copy, narrow layout and Axe; native menu 17/17 and product
29/29 across restart; native release compilation and workspace formatting.
Android debug/release unit suites pass 225/225 cases, resource/Kotlin release
packaging and both lint variants pass, and signed APK/AAB identity, ABI,
16 KiB alignment and offline language packaging validate. Owned API 28/35
matrices pass 9/11 cases and remove both AVDs. Branding and all ordinary/companion/
remote frontend CSP checks pass. Android packaging reuses unchanged prequalified
Rust/JNI inputs; remote frontend reuses unchanged Wasm with a nonconnecting
example relay. Runtime evidence is macOS/owned Android, with no deployed relay,
Windows/Linux runtime or publication claim.

### Japanese (`ja`)

All 2,479 resources are independently translated/reviewed with verified local
Sol 6.1/high/normal/bypass sessions. Shared terminology has separate author and
reviewer identities. All three platform lists advertise release support; the
Android catalog is in `main`, and preview registration is removed. English and
all previously shipping languages are retained.

Validation: source/catalog/provenance checks and typecheck; 959 web and
94 desktop unit cases; 7 production-browser cases with the profile's
System probes, exact shipping picker, pseudo exclusion, persistence/focus,
plural/destructive copy, narrow layout and Axe; native menu 17/17 and product
29/29 across restart; native release compilation and workspace formatting.
Android debug/release unit suites pass 225/225 cases, resource/Kotlin release
packaging and both lint variants pass, and signed APK/AAB identity, ABI,
16 KiB alignment and offline language packaging validate. Owned API 28/35
matrices pass 9/11 cases and remove both AVDs. Branding and all ordinary/companion/
remote frontend CSP checks pass. Android packaging reuses unchanged prequalified
Rust/JNI inputs; remote frontend reuses unchanged Wasm with a nonconnecting
example relay. Runtime evidence is macOS/owned Android, with no deployed relay,
Windows/Linux runtime or publication claim.

### Korean (`ko`)

All 2,479 resources are independently translated/reviewed with verified local
Sol 6.1/high/normal/bypass sessions. Shared terminology has separate author and
reviewer identities. All three platform lists advertise release support; the
Android catalog is in `main`, and preview registration is removed. English and
all previously shipping languages are retained.

Validation: source/catalog/provenance checks and typecheck; 959 web and
94 desktop unit cases; 7 production-browser cases with the profile's
System probes, exact shipping picker, pseudo exclusion, persistence/focus,
plural/destructive copy, narrow layout and Axe; native menu 17/17 and product
29/29 across restart; native release compilation and workspace formatting.
Android debug/release unit suites pass 225/225 cases, resource/Kotlin release
packaging and both lint variants pass, and signed APK/AAB identity, ABI,
16 KiB alignment and offline language packaging validate. Owned API 28/35
matrices pass 9/11 cases and remove both AVDs. Branding and all ordinary/companion/
remote frontend CSP checks pass. Android packaging reuses unchanged prequalified
Rust/JNI inputs; remote frontend reuses unchanged Wasm with a nonconnecting
example relay. Runtime evidence is macOS/owned Android, with no deployed relay,
Windows/Linux runtime or publication claim.

### Simplified Chinese (`zh-CN`)

All 2,479 resources are independently translated/reviewed with verified local
Sol 6.1/high/normal/bypass sessions. Shared terminology has separate author and
reviewer identities. All three platform lists advertise release support; the
Android catalog is in `main`, and preview registration is removed. English and
all previously shipping languages are retained.

Validation: source/catalog/provenance checks and typecheck; 959 web and
94 desktop unit cases; 9 production-browser cases with the profile's
System probes, exact shipping picker, pseudo exclusion, persistence/focus,
plural/destructive copy, narrow layout and Axe; native menu 17/17 and product
29/29 across restart; native release compilation and workspace formatting.
Android debug/release unit suites pass 225/225 cases, resource/Kotlin release
packaging and both lint variants pass, and signed APK/AAB identity, ABI,
16 KiB alignment and offline language packaging validate. Owned API 28/35
matrices pass 9/11 cases and remove both AVDs. Branding and all ordinary/companion/
remote frontend CSP checks pass. Android packaging reuses unchanged prequalified
Rust/JNI inputs; remote frontend reuses unchanged Wasm with a nonconnecting
example relay. Runtime evidence is macOS/owned Android, with no deployed relay,
Windows/Linux runtime or publication claim.

### Traditional Chinese (`zh-TW`)

All 2,479 resources are independently translated/reviewed with verified local
Sol 6.1/high/normal/bypass sessions. Shared terminology has separate author and
reviewer identities. All three platform lists advertise release support; the
Android catalog is in `main`, and preview registration is removed. English and
all previously shipping languages are retained.

Validation: source/catalog/provenance checks and typecheck; 959 web and
94 desktop unit cases; 9 production-browser cases with the profile's
System probes, exact shipping picker, pseudo exclusion, persistence/focus,
plural/destructive copy, narrow layout and Axe; native menu 17/17 and product
29/29 across restart; native release compilation and workspace formatting.
Android debug/release unit suites pass 225/225 cases, resource/Kotlin release
packaging and both lint variants pass, and signed APK/AAB identity, ABI,
16 KiB alignment and offline language packaging validate. Owned API 28/35
matrices pass 9/11 cases and remove both AVDs. Branding and all ordinary/companion/
remote frontend CSP checks pass. Android packaging reuses unchanged prequalified
Rust/JNI inputs; remote frontend reuses unchanged Wasm with a nonconnecting
example relay. Runtime evidence is macOS/owned Android, with no deployed relay,
Windows/Linux runtime or publication claim.

## Final aggregate qualification

The campaign completed every legacy Android locale in the frozen manifest.
All sixteen terminology sets have distinct author/reviewer identities. The
source/catalog/provenance audit verifies all 39,664 resource reviews, all sixteen
qualified commits and their exact catalog hashes. Replaying actual CLI rollout
evidence verifies 419 accepted local Sol 6.1/high/normal/bypass sessions: 384
catalog sessions, 32 terminology sessions, two Portuguese correction sessions
and one bootstrap matching implementation session. German/French catalogs,
terminology and per-message review ledgers remain byte-for-byte equal to the
qualified baseline; frozen English source/context inputs are unchanged.

One Simplified Chinese worker hit temporary selected-model capacity. Completed
outputs were retained, owned groups were joined and only unfinished work resumed
on the same local account/model/settings after a short backoff. The interrupted
review was rerun independently; neither cancelled attempt was accepted. No
alternate provider, model, account or speed tier was used.

Every locale passed 23 qualification gates, including strict React typecheck,
959 web unit cases (three existing skips), 94 desktop unit cases, ordinary/
companion/remote release frontend builds and CSP, production-browser probes,
17 native menu cases and 29 native product live/restart cases. Both Android
unit variants pass 225 cases, release/debug lint and package builds pass, and
the owned API 28/35 matrix passes nine/eleven cases per locale. The System-reset
case now additionally repeats ten override/reset cycles. Per-locale evidence
above records the actual profile probes and browser counts.

Final aggregate commands and evidence:

- `node scripts/check-localization.mjs` and
  `python3 scripts/localization-campaign.py verify --check-env` pass against all
  nineteen release registrations, with no preview registrations.
- `python3 -m unittest discover -s scripts -p 'test_*localization*.py'` passes
  61 cases; the Android adapter's `test_localization.py` passes thirteen.
  `npm run test --prefix clients/web -- scripts/qualify-localization.test.mjs`
  passes all three harness argument cases.
- The maintained production-browser harness passes 133 cases across all
  eighteen translated targets against the same final nineteen-locale ordinary
  release assets. It verifies the exact picker, script/region System probes,
  pseudo exclusion, persistence, focus, destructive/plural copy, narrow layout
  and Axe. Every bundled Chromium/server is closed on exit.
- `clients/android/build.sh release` completes the full locked Rust build for
  both Android ABIs, host binding generation and fresh Kotlin/resource release
  packaging, tests and lint. Final local Gradle runs use a 4 GiB heap and two
  workers after a 1.5 GiB daemon stopped for GC thrashing. The project default
  and global machine configuration are unchanged.
- `scripts/validate-android-release.py` validates the rebuilt signed APK/AAB,
  JSTorrent identity, both ABIs, notices, upload certificate and 16 KiB ELF/ZIP
  alignment. Compiled `notification_ready` values in both archives exactly
  match the first-party source for all nineteen locales. AAB language splitting
  is disabled, retaining offline base-package language selection.
- Fresh debug APK/test assembly, debug unit tests and debug lint pass after
  binding regeneration. The final owned API 28/35 matrix for `zh-TW` passes
  nine/eleven cases with the rebuilt JNI inputs; both AVDs are removed.
- `cargo fmt --all -- --check` and `git diff --check` pass. No engine behavior,
  application API or durable schema changes were needed.

Runtime evidence is macOS and owned Android API 28/35. Windows/Linux runtime,
iOS localization, deployed remote relay behavior, human linguistic approval
and publication are not claimed. iOS remains English-only. Checkpoint pushes
were made after four, eight and twelve qualified locales; remote CI was not
watched. The final push includes all sixteen cohorts and this completion record.
Task-owned temporary run state and the sleep inhibitor are removed at handoff;
preexisting tooling and persistent kernel lock files are retained.
