# Tactical 323: Pre-Metadata Skip File Selection

Status: Complete locally, 2026-10-12. Release delivery remains separate.

Topics: `application-control`, `application-view-api`

## Scope and stopping condition

Android's pending file selection dialog shows `Don’t show file selection
again` only after the file list loads. While a magnet still waits for
metadata the dialog offers `Download all` but no way to skip next time.
Show the checkbox in both states and let pre-metadata `Download all` carry
it. Stop after the durable transition, generated boundaries, Android
presentation and focused regression evidence are recorded.

Dependencies: Tactical 308's `DownloadAllPendingAdd` and the existing
`ConfirmPendingFileSelection { disable_future }` preference write.
Non-goals: web or iOS presentation (web keeps confirm-only pending actions),
add-time `Add torrent` confirmation, queued pending adds already presented,
release delivery.

## Contract, ownership and bounds

`DownloadAllPendingAdd` gains `disable_future: bool`, serde-defaulted to
`false` so existing payloads keep their meaning. When true, the same profile
transaction that clears pending selection and admits the torrent also sets
`show_file_selection = 0`, sharing one helper with confirmation. A rejected
or failed add rolls back to the command savepoint and leaves the preference
unchanged; Cancel never applies it. This replaces Tactical 308's statement
that this per-add action always leaves the future preference untouched: it
still does unless the user opts in on the same screen.

The add-time `Download all` from the Add torrent confirmation passes
`false`; it has no checkbox. Compose owns the checkbox draft, keyed by
torrent, so a choice made while loading survives metadata arrival. No new
task, queue or resource bound is introduced.

Not an engine or protocol feature: the field governs a client preference,
so no libtorrent or BEP source study applies beyond Tactical 308's record.

## Validation

- Store: `download_all_pending_add_disables_future_selection_atomically`
  injects a failing preference write, proves the add, revision and
  preference roll back together, then commits on retry and survives reopen.
  The existing late-metadata case still proves `false` leaves the preference
  on.
- Android Compose: `pendingMagnetCanDownloadAllBeforeFileListArrives`
  checks the checkbox is displayed while loading and its value reaches
  Download all; `pendingFileSelectionKeepsSkipChoiceWhenFileListArrives`
  ticks it before metadata and confirms it is still set after the list
  arrives.
- Regenerate TypeScript/schema; Kotlin and Swift bindings are build outputs.
- Run fmt, clippy, workspace tests, web typecheck/tests, the Android build,
  lint and instrumentation assembly.

## Evidence

Passing local gates on 2026-10-12 (shell profile sourced):

- `cargo fmt --all -- --check` and `cargo clippy --workspace -- -D warnings`.
- `cargo test --workspace`: 1,187 passed, 13 ignored, none failed, including
  both store cases above and the application late-metadata case.
- `npm run generate --prefix clients/web` changed only the generated
  command type, schema and validators; `npm run typecheck` and `npm run
  test --prefix clients/web` pass (531 passed, two existing skips).
- `clients/android/build.sh`: both native ABIs, Kotlin bindings, debug APK
  and all 152 JVM tests pass.
- `clients/android/gradlew -p clients/android lintDebug
  assembleDebugAndroidTest` passes.
- `python3 clients/android/scripts/run-localization-matrix.py --api 35
  --class` with `pendingMagnetCanDownloadAllBeforeFileListArrives`,
  `pendingFileSelectionKeepsSkipChoiceWhenFileListArrives` and
  `pendingFileSelectionUsesNormalSkipAndExplicitConfirmation`: all three
  pass on an owned API 35 tablet AVD, which the runner deleted.

Swift bindings are not rebuilt: iOS does not reference this command and the
added field is serde-defaulted. No device install, release or live swarm.
