# Tactical 369: Recovery Screen When The Torrent Catalog Will Not Open

Status: Complete, 2026-10-15. Maintainer-directed; implementation and
commits authorized.
Topics: `client-persistence`, `durable-data-migrations`, `web-ui-design`,
`android-jstorrent-replacement`.

## Problem

Tacticals [345](345-supported-catalog-migrations.md) and
[358](358-one-durable-store-and-migration-ledger.md) make a catalog that
cannot be opened fail closed and stay unchanged. What the user sees then is
poor:

- Desktop: the open error leaves Tauri setup, `.build(...).expect(...)`
  panics, and the app never shows a window.
- Android: a generic "operation failed" error with technical detail and a
  "needs attention" notification; nothing else can be done.
- Headless: the process prints the error and exits.

The reasons are a failed migration step (rolled back; an update fixes it), a
catalog newer than the app (an older version was installed), a retired
pre-baseline catalog, a corrupt or unreadable catalog, a catalog locked by
another running copy, or the product database failing the same ways.

## Decisions

Maintainer direction, 2026-10-15:

- Show a recovery screen instead of crashing or a generic error. It says the
  torrents and files are safe and unchanged, and offers **Check for updates**
  (Android opens the Play listing), **Export torrent list**, **Copy details**
  and **Quit**. There is no "start fresh" action.
- A catalog locked by another running copy gets its own short message: close
  the other JSTorrent window and try again.
- Export reads the catalog without migrating or writing it, from a private
  copy of the database and its write-ahead log.
- A debug-only switch fails a migration on purpose so the real apps can be
  dry-run against a temporary profile seeded from the released fixture.

## Scope

1. **Read-only exporter** (`rstorrent-session`): copies `session.db` and any
   `session.db-wal` into a temporary directory, opens the copy, accepts
   schema 26 and every later version (including versions newer than the app),
   checks which optional columns exist, and writes the Tactical 348 bundle.
   Older catalogs are refused. The original files are never opened for
   writing.
2. **Failure classification**: `StoreError`/`ApplicationError` map to a
   closed `CatalogRecoveryReason` (migration failed, newer, retired, locked,
   unreadable, product database) plus bounded details text for bug reports.
3. **Fault injection**: in debug builds only, `RSTORRENT_TEST_FAIL_MIGRATION=1`
   makes the catalog migration fail inside its transaction after running the
   steps, so the rollback path is exercised for real. Release builds compile
   no check.
4. **Desktop**: an open failure puts the app in recovery mode instead of
   returning an error from setup. The window loads the web UI, which asks
   `desktop_recovery_status` first and shows the recovery screen. Commands:
   status, export (native save dialog), and Quit; Check for updates uses the
   existing updater commands. Debug builds accept
   `RSTORRENT_DESKTOP_DATA_ROOT` so dry runs use a temporary profile.
5. **Android**: initialization failure shows a Compose recovery screen with
   the same actions; export uses a UniFFI function that takes the profile
   path and does not open the client.
6. **Headless**: `export-torrent-list --profile <dir> --output <file>` and a
   clearer startup error.

## Non-Goals

- Repairing or rewriting a catalog, or starting with an empty one.
- Restoring from `session.db.pre-migration`.
- Recovery for the remote web client or the extension; they connect to a
  host and show its errors.

## Invariants

- Nothing in recovery mode opens the catalog for writing or changes any file
  in the profile.
- The screen never claims data loss and never offers to discard data.
- Fault injection does not exist in release builds.

## Validation

- Session tests: read-only export of the v26 fixture, of a catalog with
  committed rows still in its WAL, and of a catalog newer than the app;
  refusal of a retired catalog; files byte-for-byte unchanged; a forced
  migration failure leaves the original version and contents.
- Desktop, web and Android unit tests for classification and the screen.
- Dry run: the debug desktop app against a temporary profile from the v26
  fixture with the failure switch shows the screen, exports a bundle and
  leaves the catalog unchanged; without the switch the same profile migrates
  and opens.

## Stopping Condition

Complete when desktop, Android and headless show or offer recovery instead of
crashing or a generic error, the exporter and fault injection are tested, the
dry run is recorded, and the owning topics and ledger are updated.

## Implementation Notes

- Classification is one read-only function, `diagnose_catalog(profile,
  failure_text)`, shared by desktop, Android and headless: it reads the stored
  version and the open error. A version between the baseline and the current
  one means a migration failed; above it, newer; below the baseline, retired;
  "database is locked"/"busy" in the error, locked; anything else,
  unreadable. Export is offered when the version is the baseline or later and
  the catalog is not locked.
- The exporter (`store::torrent_list_export_from`) now runs on any
  connection; the stop-limit columns are used only when present, so schema 26
  and newer catalogs export.
- Desktop manages the product database as `DesktopProduct` before the
  catalog opens, so the updater's check, the update generation and the
  post-install restart work in recovery. Tray and menu Quit exit directly
  when there is no running state.
- Debug-only switches: `RSTORRENT_TEST_FAIL_MIGRATION` (fails the migration
  after its steps, inside the transaction) and `RSTORRENT_DESKTOP_DATA_ROOT`
  (keeps config and data under one folder and skips the Chrome native-host
  registration).

## Evidence

- `cargo test -p rstorrent-session` (468): read-only export of the released v26
  catalog with every profile file byte-for-byte unchanged; rows still in the
  write-ahead log of a crash-copied profile are exported; a catalog marked
  newer than the app classifies as newer and exports; a retired catalog is
  refused; locked and missing catalogs classify without export.
- Headless: `rstorrent-headless export-torrent-list --output … --config …`
  against a profile seeded from the v26 fixture saved six entries and left
  `session.db` unchanged (same SHA-1). Service-mode startup only runs from an
  installed release layout, so its failure hint was not exercised.
- Desktop dry run (debug build, macOS, `RSTORRENT_DESKTOP_DATA_ROOT` on a
  temporary folder seeded from the v26 fixture):
  - With `RSTORRENT_TEST_FAIL_MIGRATION=1` the app entered recovery
    ("migration from schema 26 failed on purpose"); the catalog stayed at
    version 26 with contents identical to the fixture (`.dump` equal). Its
    bytes changed only because opening switched the fixture, written in
    rollback-journal mode by `VACUUM INTO`, to WAL; released catalogs are
    already WAL.
  - Without the switch the same profile migrated to 28, kept its torrents
    (the fixture's pending keep-data removal then completed as normal) and
    applied the quiet network defaults once.
  - The screen could not be captured from the native window because the Mac
    was locked. Playwright `tests/desktop-recovery.spec.ts` drives the real
    web bootstrap with the Tauri bridge stubbed to the same status: recovery
    is requested first, no application command is sent, Check for updates
    offers an available version, export reports success, and no console
    errors occur. That test found the update-generation command requiring the
    full desktop state, fixed above.
- Web: `npm run typecheck`, `npm run test` (804 passed, 4 skipped),
  `scripts/check-localization.mjs`.
- `cargo test -p rstorrent-desktop` (61), `-p rstorrent-headless`,
  `-p rstorrent-gateway`, `-p rstorrent-android`; workspace `clippy` and
  `fmt`.
- Android: an engine open failure stores `diagnoseCatalog` in product state;
  the activity then shows `CatalogRecoveryScreen` (same titles and actions;
  Check for updates opens the Play listing; export uses
  `exportTorrentListReadOnly` through its own create-document flow without
  the engine), unbinds the failed service and does not restart it, so the
  screen is not hidden by retries. `clients/android/build.sh debug` (204 JVM
  tests, 11 new), `compileDebugAndroidTestKotlin` (3 new Compose tests,
  compiled only) and `lintDebug` (no new errors) pass. Not run on a device or
  emulator.
- Known limit: Android shows recovery for every engine open failure, so a
  failure unrelated to the catalog with a current-version catalog reads
  "couldn't read its torrent list" (with export offered).

