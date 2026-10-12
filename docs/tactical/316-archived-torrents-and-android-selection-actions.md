# Tactical 316: Archived Torrents And Android Selection Actions

Status: Complete locally, 2026-10-12. Release delivery remains separate.

Topics: `application-control`, `client-surfaces`, `web-ui-design`,
`android-jstorrent-replacement`.

## Trigger

On a Pixel 9 running Android 1.0.29, a torrent archived the previous day
from the library selection bar never left the list. Unskipping a file and
tapping Files > Download now failed twice with `archived torrent must be
restored before downloading files`. The failure appeared only as the sticky
library error card while Status said `Error: None`. A later Resume was
accepted: the torrent then showed Downloading/transferring pieces with zero
peers indefinitely because admission blocks archived torrents.

Tactical `040` defined archive as organizational and orthogonal to running
intent. In practice the engine already treats archived torrents as inactive
(admission, seeding, incoming and discovery skip them), so a running intent
on an archived torrent is a hidden, unreachable state. Android never
received an archived presentation: All and Finished include archived rows,
the selection bar offers an ambiguous `Archive/restore` toggle, and no
surface indicates the state.

## Decision

Maintainer direction on 2026-10-12 keeps archive and fixes its semantics and
presentation:

- **Archived means shelved and inactive.** Archiving persists paused intent
  and joins active work exactly like Pause. Restore leaves the torrent paused;
  the user starts it explicitly.
- Resume, Download now (`DownloadFiles`) and queue moves are rejected while
  archived with `InvalidTorrentState`. Force recheck, file priorities, export
  magnet and removal remain allowed.
- A torrent awaiting add-time file selection cannot be archived; the pending
  add must be confirmed or cancelled first.
- All excludes archived torrents on every surface. Archived torrents appear
  only in an Archived category.
- Removal keeps the `Remove` name.

## Scope

Engine (`rstorrent-session`):

- `Archive` writes `archived = 1` and `desired_state = 'paused'` in one
  revision and then performs the ordinary pause join. `RestoreArchive`
  changes only the archive flag.
- `Resume` rejects archived torrents; existing `DownloadFiles` and queue-move
  rejections remain. `Archive` rejects pending-selection torrents.
- Opening an existing profile normalizes rows that predate this rule in one
  transaction and one revision: archived running rows become paused, and
  archived pending-selection rows are restored. The schema version is not
  changed because a version change resets profiles.

Android Compose:

- Library tabs become All, Active, Queued, Finished, Archived. Archived rows
  appear only in Archived; their status reads Archived and they have no
  start/pause control. Resume all skips archived torrents.
- Selection mode replaces the top app bar with close, selected count and
  select all. Back exits selection; changing tabs clears it.
- The bottom selection bar uses full-height icon-and-label actions: Start,
  Pause, Archive (Restore in the Archived tab), Remove and More. More opens a
  bottom sheet with Move to top, Move to bottom, Force recheck and Copy magnet
  links. Actions apply only to applicable selected torrents and are disabled
  when none apply.
- Archive or Restore from the list shows a snackbar with Undo. Undo of an
  archive restores and resumes the torrents that were not paused before it.
- The torrent detail screen shows an Archived banner with Restore instead of
  the start/pause control. Its overflow menu contains Start or Pause, Move to
  top, Move to bottom, Force recheck, Archive or Restore, Copy magnet link and
  Remove, with inapplicable entries disabled. Files > Download now is disabled
  for archived torrents and explains that the torrent must be restored.
- Failures of per-torrent commands appear as a transient snackbar rather than
  the sticky library error card, which remains for storage and
  application-wide errors.
- Debug builds add Add all test torrents and one entry per public WebTorrent
  sample (Big Buck Bunny, Cosmos Laundromat, Sintel, Tears of Steel, WIRED CD)
  to the library menu, mirroring the web list. Release builds omit them.

React UI (desktop and ChromeOS extension over the same engine):

- Start, queue moves and file Download now are disabled for archived
  torrents with a restore explanation. Archived rows show an Archived status.
  The existing Archived category and All exclusion are retained.

## Non-goals

- No contract enum, generated binding or schema version change; `archived`
  remains the existing summary field.
- No change to removal semantics, the remove dialog choices or the React
  layout beyond the archived affordances above.
- No queue-position change on archive; an archived torrent keeps its paused
  queue position and moves only after Restore and Start.
- No archive-specific seeding policy: archived torrents do not seed.
- No release build, store submission or rollout.

## Reference review

Archive is application organization, not BitTorrent protocol behavior;
normative specifications and libtorrent have no equivalent state, so the
libtorrent oracle is inapplicable. Legacy JSTorrent has no archive concept.
The legacy Android selection bar (`android/app/src/main/java/com/jstorrent/
app/ui/components/SelectionActionBar.kt` in `jstorrent-typescript`) used a
bottom app bar with close, count and icon actions and a Back handler; this
slice keeps that ergonomic shape and adds labels and an overflow sheet.

## Owners, invariants and compatibility

- `SessionStore` owns archive and running intent; the invariant is
  `archived => paused and not awaiting file selection` for every committed
  revision after open.
- `ApplicationService` joins active work on Archive. Unlike Pause, a running
  checker is joined rather than parked, and the verification queue skips
  archived torrents, so an archived torrent never holds the single checker
  slot; its pending verification resumes after Restore. No task, queue or
  budget is added.
- Android `ProductEngineService` owns command dispatch. Torrent command
  batches run in order under one FIFO mutex, so Undo cannot interleave with
  the archive it reverses and multi-torrent queue moves keep list order.
- Android and the extension update independently. An older extension that
  sends Resume to an archived torrent on a newer Android engine receives the
  explicit rejection rather than a stuck running state. A newer extension on
  an older Android engine disables Start locally.

## Validation

- Rust: archive persists pause and joins active content; restore stays
  paused; resume, download-files and queue moves reject archived torrents;
  archive rejects pending selection; open-time normalization covers running
  and pending archived rows and is idempotent; existing archive and removal
  tests updated for the new semantics.
- Web: action availability for archived rows, file Download now, archived
  status label; typecheck and full suite.
- Android: JVM tests for library filters and selection action availability;
  dual-ABI build, unit tests and lint.
- Physical Pixel 9 debug installation with test torrents: archive from the
  selection bar, Archived tab, Undo, Restore staying paused, rejected start
  paths absent, detail banner and menu, and Files Download now gating.

## Stopping condition

Complete when the engine rule, Android and React presentation, tests and
physical evidence above are recorded, owning topics reflect the new archive
semantics, a review pass has been addressed and the slice is committed.

## Result and evidence

Implemented as scoped above. A review pass found and this slice fixed: an
Undo snackbar without a timeout that blocked later failure messages; Undo
racing the archive batch; archiving a verifying torrent parking its checker
in the only verification slot; a stale failure re-shown after UI
recreation; Undo resuming torrents that were not running; random order for
multi-torrent queue moves; React offering Archive for pending adds; an
instrumentation call broken by a new required parameter; and a store test
whose Download now case failed for an unrelated reason.

Commands run (Android with JDK 17 and the local SDK):

- `cargo fmt --all -- --check`, `cargo clippy --workspace -- -D warnings`,
  `cargo test --workspace`: 1591 passed, 0 failed before the review fixes;
  after them, the 25 archive/checker/recheck session cases and the full
  `rstorrent-session` suite pass.
- `npm run typecheck`, `npm run check:localization` and `npm run test` in
  `clients/web`: 77 files, all cases pass.
- `clients/android/build.sh debug`: dual-ABI native libraries, regenerated
  bindings, debug APK and 141 JVM cases pass; `:app:compileDebugAndroidTestKotlin`
  and `:app:lintDebug` pass.
- Physical Pixel 9 (Android API 37): the debug APK installs as the isolated
  `org.rstorrent.bootstrap` identity beside production; first run, folder
  grant, Archived tab, debug test-torrent entries adding all five samples,
  and the detail overflow order (Pause, Move to top/bottom, Force recheck,
  Archive, Copy magnet link, Remove) were observed. The maintainer took over
  interactive testing on the device; archive, undo and restore flows on
  hardware are left to that session.

The production package and its data were not changed; production users
receive the engine rule only with a future release build.

