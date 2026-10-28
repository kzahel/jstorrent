# 388 — Remaining localization campaign

Status: **Active.** Preparation passed; the maintainer authorized supervised
overnight execution on October 28. Local glossary and platform work follows.

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

| Locale | Terminology | React / desktop / Android | Qualification / release |
| --- | --- | --- | --- |
| es | Reviewed | Queued | Pending |
| it | Reviewed | Pending | Pending |
| pt-BR | Reviewed | Pending | Pending |
| nl | Reviewed | Pending | Pending |
| sv | Reviewed | Pending | Pending |
| da | Reviewed | Pending | Pending |
| cs | Reviewed | Pending | Pending |
| pl | Reviewed | Pending | Pending |
| ro | Reviewed | Pending | Pending |
| ru | Reviewed | Pending | Pending |
| uk | Reviewed | Pending | Pending |
| tr | Reviewed | Pending | Pending |
| ja | Reviewed | Pending | Pending |
| ko | Reviewed | Pending | Pending |
| zh-CN | Reviewed | Pending | Pending |
| zh-TW | Reviewed | Pending | Pending |
