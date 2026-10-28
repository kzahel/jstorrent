# 384 — Shared translation workflow and desktop German

Status: **Complete — German previews and shared workflow committed.**

## Outcome And Scope

Extend the proven Android workflow to the shared React UI and native desktop
catalog. Complete a German preview with System language / English / Deutsch
selection, matching tray/dialog/notification language, independently reviewed
translations, shared terminology and resumable YA translation/review jobs.
Keep release locale support English until a separate promotion. French and
other locales follow through the same tooling; they are not this slice.

Native Android XML, React ICU JSON and native desktop JSON stay authoritative.
The Rust engine and authenticated application contract remain language-neutral.
No engine behavior, external host API, runtime catalog fetching, new runtime
translation dependency, release publication or installed-user-data reset.

## Current Evidence And Reference Study

Tactical 383 supplies Android export/validate/import/check/prune, per-message
source/review hashes and a complete independently reviewed German catalog.
At the start, the shared React catalog had 1,632 messages, including 46 ICU plurals, and the
native desktop catalog has 20 messages. A trimmed case-insensitive text scan
finds 326 React entries with Android candidates (205 distinct texts). These
are suggestions requiring meaning/argument/context review, not automatic
approval. React has 1,448 distinct exact English texts; duplicate IDs remain
separate when context or grammatical role differs.

Consulted sources:

- `clients/android/scripts/localization.py`, its tests and locale guidance;
- `localization/glossary.json`, Android German XML and per-message metadata;
- `clients/web/src/localization/{runtime.tsx,messages/en.json}`;
- `clients/desktop/src-tauri/src/{desktop_localization,desktop_lifecycle}.rs`
  and its English catalog/comments;
- pinned qBittorrent `src/gui/optionsdialog.cpp` language list/save behavior
  and Transmission `qt/Application.cc` locale loading (from 383): native
  language names and English fallback are adopted; platform ownership differs;
- FormatJS ICU syntax and Android string-resource documentation for separate
  placeholder/plural validators. No reference source or translations copied.

Initial gaps: the React runtime supports only English/pseudo-locales; native
desktop uses a single English OnceLock. German terms are Android-only guidance.
Glossary changes do not invalidate prior translation review. The successful YA
orchestration was task-local and is not yet a reusable command.

## Ownership And Invariants

- Shared offline tooling owns source snapshots, glossary/terminology revision
  evidence, jobs, independent review provenance, validation and atomic imports.
  Platform adapters own format-specific parsing and serialization.
- One importer owns catalog writes; concurrent agents write isolated job
  outputs. Jobs bind source/translation/terminology revisions. A stale result
  cannot overwrite a current translation or reviewed manual correction.
- Review every German message independently. Reuse existing German as context,
  harmonize terms and preserve each platform's actual semantics. No native
  speaker is a shipping gate; optional maintainer feedback remains welcome.
- Keep UI-only language preferences local and per-field tolerant. Browser UI
  preferences use local storage. Native desktop owns a small presentation-only
  preference store so startup tray/dialogs and React use the same override;
  this store contains no lifecycle switches, consent, library or engine data.
  Preserve unknown fields, never rewrite on read or reset malformed data, and
  atomically update only an explicit user change. No SQLite schema change or
  engine/application locale setting is needed for this presentation preference.
- Native startup resolves the locale before tray/dialog creation. Locale changes
  relabel menus and future notifications without restarting the engine. React
  updates through one locale owner and rebuilds labels cached at module scope.
  System clears the override; English is the ultimate fallback.
- German is enabled for development/test previews only. Production web/remote/
  companion and desktop builds retain English-only support. Translation assets
  and preview flags do not authorize unqualified release-language claims.
- YA discovery resolves private pool IDs dynamically. Public code contains no
  account IDs, credentials, machine paths or private endpoint inventory. Model
  aliases resolve to catalog IDs; record actual model/effort/session evidence.

## Implementation Sequence

1. Add shared locale terminology and revision tracking; keep Android behavior
   and existing catalog/review evidence intact. Report terminology conflicts
   and review the affected entries rather than blindly rewriting all copy.
2. Add one offline command front door with Android, React ICU and native desktop
   adapters. Export coherent 40–80-message batches with context, matched German
   suggestions and shared terminology; validate exact keys, ICU argument/tag/
   plural structure and native placeholders before deterministic imports.
3. Add resumable bounded YA translation and independent-review orchestration.
   Persist only task state in ignored directories; permit restart/retry after
   validated output, reject stale snapshots, and cleanly terminate owned jobs.
4. Add preview German runtime/selection to React and the native desktop shell,
   ensuring native and rendered controls share the same local choice.
5. Translate and independently review complete German catalogs. Cross-review
   shared actions, states, folders, sharing and destructive/privacy wording.
6. Run static, unit, responsive/keyboard/accessibility, packaging and actual
   native desktop evidence; retain release separation and update living topics.

## Resource Limits And Validation

Reuse existing bounded JSON/message/source limits; batch at most 100 messages
and default to 60–80. Default YA concurrency is two or three. Imports and model
results are finite local files, not a runtime network feature. New worker tasks
have explicit session/process ownership, cancellation and resumable output.

Required proportional checks:

- Android tooling regressions plus shared adapter/terminology/runner tests;
- the repository localization checker, deterministic generation and clean diff;
- web typecheck, complete unit tests, browser English/German/pseudo checks with
  bundled test Chromium, ordinary/companion/remote builds and release separation;
- Rust formatting, desktop clippy/tests and relevant persistence/format tests;
  broaden to workspace checks where native integration requires them;
- a separately identified desktop development build, actual locale selection,
  native tray/dialog/notification matching, restart persistence, unchanged
  engine/session ownership and visual evidence. Use existing scripted headed
  facilities before interactive control; do not alter the user's production
  profile or native-host registration for this localization test.

Stopping condition: complete reviewed German previews on Android and desktop/
React, shared terminology with change detection, one reproducible resumable
translation workflow, passing required checks, recorded native evidence and
clean task-owned process/artifact cleanup. Commit completed work; do not ship
or publish a release as part of this task.

## Implementation And Evidence

The React source cohort grew from 1,632 to 1,773: four language-picker
messages, 46 previously unextracted torrent actions/pending states, selection
reasons and speed-chart labels, and 91 computed table/status/age descriptions. Existing English entries did not
change. Declarative metadata now resolves labels at render time rather than
retaining the startup locale. Number/date/count formatting, including exact
BigInt byte calculations, follows the selected app language.

Shared German terminology has 19 concepts and an informal du register.
The Android audit reviewed all 662 entries and proposed 17 corrections,
including Verhältnis, seeden, pairing approval and explicit App-Daten versus
downloaded-file deletion. Those corrections completed a separate translation
and independent review before import. A second audit reviewed the remaining
645 unchanged messages, adopted its 644 approved rows and sent one queued
filter label through a final separate translation/review import (18 corrected
Android entries total). Original source/content evidence for
unchanged Android messages remains intact.

YA jobs used the requested work pool, weekly-pace policy, concrete
`claude-opus-5-5`, high effort and authorized bypass mode. The runner resolved
pool/account routing privately at runtime and checked model/effort/mode
metadata. Catalog provenance contains model/session identities, never private
account or pool IDs. Translation/review sessions were separate, bounded and
stopped after their files validated.

Native desktop owns a bounded presentation-only JSON preference, resolves the
system language before menus, and propagates one locale into picker children,
notification title/body/action and the renderer. Debug launchers enable both
frontend and native preview gates together; direct Cargo builds without that
flag do not advertise German, and release builds cannot enable native German.
The missing/corrupt/future/unknown-field/nonregular-path cases never overwrite
existing preferences on read.

Validation completed so far:

- Python shared18, runner20 and Android13 cases pass (51 total), including
  branch/tag/plural-pound ICU contracts, stale/corrupt output rejection,
  cancellation routing, resumption and terminology attestation.
- `cargo clippy --workspace -- -D warnings` and `cargo test --workspace` pass.
  Later native hardening receives focused locale/clippy checks too.
- Android `assembleDebug` compiles the revised resources. Machine Control's
  handheld doctor passed, the explicitly verified Pixel 7a received only the
  existing JSTorrent Dev debug package, and its German override survived.
  The unchanged Play/QA packages and their data were not targeted.
- Native locale/persistence tests (8 with each preview-gate setting) and the
  real Tauri example pass; the example
  verifies actual menu/check-menu labels, formatted message content and events
  in an isolated WKWebView without posting notifications or dialogs.

Native release compilation also passes with the preview flag explicitly
enabled: `VITE_RSTORRENT_ENABLE_PREVIEW_LOCALES=1 cargo check --release
-p rstorrent-desktop --lib`. Release still reports English-only support.

The global `node scripts/check-localization.mjs` passes with 1,773 React,
20 native desktop, 670 Android source resources (662 translatable) and the
unchanged iOS catalogs; every German missing/stale/conflict/invalid/unreviewed/
terminology category is empty.

Final browser/build/native-product evidence:

- `npm exec --prefix clients/web -- tsc --noEmit -p clients/web/tsconfig.json`
  and `npm exec --prefix clients/web -- vitest run --root clients/web` pass on
  final source: 112 files / 907 cases, three existing skips. The ordinary npm
  typecheck/test entry points also passed during implementation.
- Six English browser regressions and six German/pseudo cases pass using bundled
  Playwright Chromium. These cover live language/nav/selection persistence,
  browser System negotiation, desktop/phone Axe and overflow, expanded LTR/RTL,
  focus restoration and Escape after a language save. Native recovery tests
  assert locale initialization precedes recovery without engine dispatch.
- Reviewed German captures at 1440 and 390 pixels are readable and fit controls.
  The Pixel 7a remains in German on the updated JSTorrent Dev package.
- Ordinary, companion and remote frontend builds pass CSP checks (80 combined
  JavaScript bundles). Builds use Vite directly for ordinary/preview and remote,
  `npm run build:companion`, remote finalization and the CSP checker. German
  markers occur in preview output and are absent from every release output.
  A browser gate with a German browser and preserved German
  preference still renders English release UI, offers no German choice and
  does not rewrite the preference on read.
  Remote frontend uses the existing unchanged Wasm artifact; no Wasm-source
  or remote engine behavior changed in this slice.
- The actual macOS product passes **29/29** isolated checks (16 live + 13 after
  restart), using production IPC, renderer/native event synchronization and
  real WKWebView input. English/German/System radio focus survives saves;
  German restores after restart, System removes the override, unknown fields
  survive and the existing application view/profile remains usable. Both
  application shutdowns join cleanly. Native menu/notification/dialog content
  is separately covered by the 17-case native example without showing OS
  notifications or dialogs. No Windows/Linux runtime qualification is claimed.
- The maintained product runner copies preview assets, uses a short isolated
  data/socket root and separate identity/incognito webview, then restores the
  ordinary debug binary. Production profile/registration were never changed.
- Full and fast web CI now run the global catalog checker plus all 51 offline
  authoring/runner tests. Translation-only inputs select this lane without
  rebuilding the engine or unrelated products; nine fast-CI routing tests and
  `go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.9` pass. The branding
  guard passes 2,700 display values and 40 original assets.

All owned translation workers, product/browser/server processes and temporary
captures, job files and asset snapshots were cleaned up. The normal Pixel
review app is intentionally retained. Production language support remains
English; no release was published.

### Deliberate Follow-ups

German preview coverage is measured against the checked catalogs, not a claim
that every possible desktop sentence has been extracted. The bounded source
audit also found updater `statusDetail` version/download templates and the
multi-selection Remove dialog title/busy templates and engine-authored Peer
connection-state display outside the catalog. These
formed the next extraction cohort, completed by the October 28 follow-up in
[Localization](../topics/localization.md) with 32 reviewed additions and eight
retired fragments (1,797 current React messages). Raw host errors, log content,
protocol identifiers and unknown future diagnostic enum values stay verbatim.
Same-locale catalog hot edits can retain memoized table column labels until a
reload; shipped locale changes invalidate them correctly. No further wording
perfection or native-speaker review is a prerequisite for additional cohorts.

The completed 21-job React base run was resumed with the maintained runner:
all exact imports revalidated, no new workers started, and SHA-256 comparisons
showed zero changes to the German source catalog or provenance bytes. All 26
owned YA sessions were complete with no live process after output validation.
