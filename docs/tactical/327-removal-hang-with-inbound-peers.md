# Tactical 327: Removal Hang With Inbound Peers

Status: Complete locally, 2026-10-13. Release delivery remains separate.

Topics: `incoming-reachability-and-seeding`, `application-control`

## Scope and stopping condition

Removing torrents while they download can freeze the whole Android engine.
The removed torrent stays at `Removing…` showing its last download rate,
the rest of a multi-select removal is never applied, and queued torrents
never start. Only a process restart recovers it.

Stop when the active-download teardown can no longer wait on inbound peer
tasks that are blocked on a queue nobody reads. Required: a deterministic
engine regression that fails before the fix and passes after it, plus
device evidence. Then record the evidence and commit.

Non-goals:
- Moving removal off the global `ApplicationService` lock.
- A general join timeout.
- The intermittent SAF `SecurityException` noted below.

## Physical evidence (Pixel 9, `org.rstorrent.qualification253` 1.0.29)

First occurrence, 2026-10-12, from a maintainer report:
- Big Buck Bunny was removing at a frozen ↓21.6 MiB/s and Cosmos
  Laundromat was also `Removing…`. The other three were stalled.
- In the copied session database, Big Buck Bunny had removal job
  `pending` with desired state `paused`. So `drive_removal` never got
  past `pause`.
- Cosmos Laundromat was `awaiting_platform`. Its
  `saf_removal_begin` had no matching confirm, because `safRemovalPlan`
  was waiting for the service lock.
- Every OS thread was parked on a futex or epoll, with no blocking-pool
  threads. This rules out a stuck syscall and means a pure async wait.
- Big Buck Bunny's view stream kept reporting DHT lookups and
  `mse_handshake_failed unknown_torrent`. So its incoming registration
  was gone but discovery had not been stopped.

Scripted reproduction, 2026-10-13, over wireless ADB:
- Each round ran the debug menu `Add all test torrents`, waited 10–50 s,
  then did select all, Remove and Delete data.
- It hung on about the tenth round. Big Buck Bunny stayed `Removing…` at
  ↓11.6 MiB/s, and the four torrents after it stayed `running` with no
  removal job.
- Just before that removal there were two downloads at 17–23 MiB/s and
  `observe_incoming` reported 8 established inbound peers.
- During the hang, `observe_incoming`, which only needs the service
  lock, hit its 10 s timeout. Before the hang it answered at once.
- Rounds where nothing was actively downloading always completed.
- Force-stop and relaunch recovered both times. Startup reran the pending
  removal and confirmed the platform deletions within a second.

## Cause

1. Android serializes every engine call through one
   `Arc<AsyncMutex<ApplicationService>>` (`rstorrent-android`). The
   `RemoveTorrent` command calls `drive_removal`, then `pause`, then
   `join_active_content`, which awaits the active download task while
   holding that lock.
2. The download's teardown in `download_content_swarm` calls
   `unregister_active_route()`. That reaches
   `RegistrationRuntime::shutdown`, which cancels the registration and
   joins every inbound peer task with no time limit.
3. Inbound peers attached to an active download forward Piece, Have and
   similar messages through `IncomingContentBridge::forward` (and
   `attach`). Both do a plain `send().await` into the driver's 64-slot
   `incoming_events` channel, not raced against cancellation.
4. The driver is that channel's only reader. It stops polling it under
   storage backpressure, and permanently once the swarm loop exits on
   cancellation. The receiver stays alive and open until the function
   returns, so a peer task blocked on a full channel never wakes, and the
   join in step 2 never completes.
5. The lock from step 1 is never released, so every later engine
   command, subscription refresh and SAF removal confirmation blocks.

The same unregister also holds the incoming service's `mutations` lock, so
every other registration change in the session blocks as well.

## Oracle

Pinned libtorrent `7d7fc38f`:
- `torrent::abort()` (`src/torrent.cpp`) disconnects every peer itself on
  the network thread. It never waits for peer code to cooperate.
- `test/test_remove_torrent.cpp` covers removing mid-download with a
  connected peer (`remove_torrent_mid_download`,
  `remove_torrent_and_files_mid_download`).

Adopted invariant: tearing down an active download must not depend on a
peer task making progress through a queue the teardown has stopped
draining.

## Fix

`download_content_swarm` closes `incoming_events` before awaiting
`unregister_active_route()`. Tokio's `Receiver::close` fails pending and
future sends, so a blocked `forward` or `attach` returns an error. The
peer task then drops its bridge and exits on the registration
cancellation that the unregister issues. No new task, channel or bound is
added; the existing route removal and inbound shutdown stay in place.

## Separate finding (not fixed here)

In 3 of about 11 rounds, one torrent showed `Removal failed`.
`ProductSafDocuments.deleteData` hit
`SecurityException: Document primary:Download/FilesTabTest/… is not a
descendant of primary:Download/FilesTabTest`. Once the child ID came
back as `primary:download/…`, and once with matching case.
`ExternalStorageProvider` appears to compare canonical paths on its
case-insensitive storage layer. Removing again always succeeded. A
bounded retry in the platform delete step would hide it from users; it
belongs in a separate Android slice.

## Validation

- Engine regression in `driver/tests/recheck_direct.rs`:
  `cancelling_backpressured_download_does_not_wait_on_incoming_peer`.
  - A scripted source serves a 32-piece torrent to an active download
    with a 400 ms storage write delay, which keeps storage backpressured.
  - An accepted peer sends Have messages at 32 per 2 ms, under the
    1024-message per-read bound.
  - Once storage is backpressured and four queue capacities of Haves have
    been sent, the test cancels the download. The task must return
    `Cancelled` within 15 s, leaving no registration behind.
- Emulator: local libtorrent seeders reached through `x.pe` and
  `adb forward`, plus a scripted inbound peer, with removal mid-download.
- Run `cargo fmt --all -- --check`,
  `cargo clippy --workspace -- -D warnings` and `cargo test --workspace`,
  plus the Android debug build and its JVM tests.

## Evidence

Local gates, 2026-10-13 (shell profile sourced):

- The regression timed out in 3 of 3 runs with the close removed (15.25 s
  each). With the fix it passed 10 of 10 runs in about 0.4 s.
- `cargo fmt --all -- --check` and `cargo clippy --workspace -- -D
  warnings` pass. `cargo test --workspace`: 1,596 passed, 18 ignored,
  none failed.
- `clients/android/build.sh` passes, including `testDebugUnitTest`. A
  `chromeosQualificationTestPackage=org.rstorrent.qualification253` debug
  APK was built from the same native libraries.

Emulator (`jstorrent-dev`, API AVD, unfixed then fixed debug APK):
- The hang was not reproduced. With a scripted inbound peer attached
  (`established=1`), the app drained more than 300,000 Haves per round
  and removal completed in 3 s. That held even with three background
  `dd … conv=fsync` writers loading storage.
- Network ingest into the emulator (8–14 MiB/s) never exceeded what its
  SAF storage could absorb, so the driver was never backpressured at
  removal time. The deterministic engine regression stands in for that
  reproduction.
- With the fixed APK, three removal rounds with the inbound peer attached
  each completed in 3 s.
- Harness observations, not investigated here:
  - A freshly added magnet download does not register for inbound peers
    until it is restarted from resume data. Plaintext handshakes were
    rejected as `UnknownTorrent` before a pause and resume and accepted
    after it.
  - libtorrent's MSE-first connections were rejected as
    `UnknownTorrent:none`.
  - libtorrent closed one inbound link as an upload-to-upload connection.

Pixel 9 (fixed QA APK installed over 1.0.29 with its data):
- Two full rounds of add all test torrents, select all and Remove with
  Delete data completed with no hang. In the first, two downloads were at
  21 MiB/s and two registrations were active. The session database was
  left with no torrents and no removal jobs.
- The soak stopped there because the phone was then in use. Before the
  fix the hang had taken about ten rounds to appear, so these two rounds
  are a smoke result, not a soak.
