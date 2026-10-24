# Monotonic Tracker View Deadlines

Status: Complete; source repair and proportional validation pass.

Topics: `application-view-api`, `tracker-discovery`, `web-ui-design`,
`capability-readiness`

## Scope And Stopping Condition

Repair the installed shared React tracker countdown oscillation and stale
reopen timing. Publish tracker deadlines and success/failure instants in one
application-owned monotonic clock domain, with current backend time in each
leased-view batch. Translate that reference into the frontend monotonic clock
once per view-set epoch. Stop after deterministic regressions, a controlled
real-gateway/browser countdown and reopen test, shared contract generation,
Android generated-boundary/build evidence, proportional Rust/web checks and
updated owning records. Installed release delivery remains separate.

## Invariants, Ownership And Limits

- The engine schedule remains the sole announce/retry authority. This changes
  inspection timing, not tracker requests, intervals, tiers or retry policy.
- ViewHub owns the application clock origin. The synchronous engine activity
  sink translates snapshot durations into stable application-clock instants.
  Protocol state stays independent of Instant, sockets and UI types.
- UpdateBatch carries current server time at delivery, including retained
  batch replay. The clock is meaningful only in the current application
  instance; reconnect/reset installs a fresh frontend clock reference.
- A retained row's deadline does not change when unrelated updates arrive,
  another tracker changes, a catalog page is opened, or delivery is delayed.
- The frontend uses performance.now(), not calendar time, for clock anchoring
  and display ticks. It clamps overdue waits to zero without initiating work.
- Existing tracker-row, queue, page, error and task bounds remain. Three
  nullable timing fields are replaced; one bounded decimal clock field is
  added per batch. No periodic backend task or new dependency is introduced.
- Native Compose/iOS do not render tracker countdowns. Their shared types and
  generated/build boundaries must remain valid; the Android browser surface
  receives the same application semantics. No new native tracker screen.
- No release replacement, production-profile mutation, public swarm, remote
  deployment, commit or publication is implied.

## Source Review And Edge Cases

Pinned libtorrent `7d7fc38fac61177fa5e02148f791b2f65250b09d`:
`include/libtorrent/announce_entry.hpp::announce_infohash` retains
next/min-announce time points; `src/announce_entry.cpp::{failed,can_announce,reset}`
uses current monotonic time with bounded retry and explicit lifecycle;
`test/test_tracker.cpp::parse_interval` and `test_stop_tracker_timeout` exercise
interval acceptance and clock-bounded stop observation. Adopt stable deadline
semantics, not its policy, architecture or source. The pinned
`reference/bittorrent.org/beps/bep_0015.rst` specifies response intervals and
transaction/retry timing; an application inspection clock is not a wire change.

Local JSTorrent at `e0cb8a3c2ff578f8ca65b1ee820321891789e5b7`,
`packages/engine/src/interfaces/tracker.ts::TrackerStats` and
`packages/ui/src/tables/TrackerTable.tsx::formatTimeUntil` expose an absolute
nextAnnounce and subtract Date.now(). Preserve the familiar countdown but use
monotonic clocks to avoid wall-clock adjustments. No source/fixture is copied.

Current input owners: Tactical043, TrackerViewModel, ViewHub/ViewSetInner,
the immutable view-set reducer, LiveApplication and TrackerTable. Engine
DownloadControl::emit invokes the activity sink synchronously. The current
model discards captured timing and retains durations; LiveApplication then
re-stamps every retained row with Date.now() on every application update.

Required edge cases: unrelated updates; partial tracker patches; actual new
retry deadline; old row on initial/reopened/paged snapshot; delayed/replayed
batch; epoch rotation; inactive/announcing/missing timing; overdue zero;
success/failure age progression; wall-clock jumps; invalid/missing decimal
clock fields and bounded allocation. Transport delay remains a small display
offset, not a scheduling authority; there is no clock synchronization claim.

## Validation And Restart Checkpoint

1. Record failing-before frontend countdown-reference regression.
2. Add deterministic backend stable-deadline/reopen/replay tests and frontend
   unrelated/partial update, new deadline, epoch and wall-clock cases.
3. Generate TypeScript/schema/fixtures; validate hostile timing input.
4. Run a permanent controlled loopback tracker + real gateway + bundled
   Chromium test. Sample countdown through unrelated rate updates, reopen
   Trackers and reload; assert monotonic decrease, save a reviewed screenshot.
5. Run Rust fmt/clippy/workspace tests, full web typecheck/unit tests and
   production build; regenerate Android Kotlin, build both ABIs and JVM tests.
6. Update evidence and topics; clean owned profiles/processes/transient output.

## Implementation And Evidence, 2026-10-11

The installed release was observed through native accessibility sampling:
all five selected torrent tracker countdowns oscillated across 14 samples in
five seconds, for example `34m 3s -> 34m 2s -> 34m 3s`. No torrent or settings
were changed. The frontend regression failed before the repair: an unrelated
update moved a retained observation reference from 100,000 to 105,000 ms.

TrackerViewModel now retains converted stable application-clock rows.
ViewHub owns the origin; the synchronous TrackerState callback captures
Instant before accounting/publication. UpdateBatch exposes current time at
delivery, including retained replay; replay reserves the full 20-character
clock width in its existing byte budget. LiveApplication installs one offset
per view-set epoch, and TrackerTable uses performance.now() for display ticks,
expiry and outcome ages. Generated schema/types/validators/trace use the same
contract. No engine schedule, recurring task or dependency changed.

Permanent deterministic tests cover runtime conversion/redaction, reopened
snapshots, refreshed replay clock with unchanged cursor/updates, unrelated and
partial updates, genuine rescheduling, epoch replacement, malformed/missing
clock input, expired/announcing/inactive rows and wall-clock jumps. The actual
React component's countdown is exercised with fake monotonic time.

`tests/interop/tracker_countdown_surface.py` and
`clients/web/tests/tracker-countdown.spec.ts` encode real Rust engine/sink/view
projection, WebSocket delivery, reducer/adapter and rendered React coverage.
The independently authored BEP 15 fixture returns no peers and a 600-second
interval with 37 seeds/11 leeches. One run sampled 39 values over six seconds:
600 to 595 seconds, zero increases, six unrelated current-rate batches;
tab reopen moved 594 to 592 seconds and page reload retained 592 seconds.
Three snapshots retained one identical deadline. Exactly one announce occurred;
gateway, web preview and tracker thread joined and temporary data was removed.
The second run rebuilt the gateway from source and reproduced the same receipt.
The screenshot was visually reviewed at 1440 x 900 and retained on request in
`.local/evidence/300-tracker-clock/tracker-countdown.png`.

Checks run successfully:

- `cargo fmt --all -- --check`
- `cargo clippy --workspace -- -D warnings`
- `cargo clippy -p rstorrent-gateway --bin export_types -- -D warnings`
  after trimming generator trailing whitespace around the new field comments
- `cargo test --workspace` (configured opt-in tests remain ignored)
- `npm run generate --prefix clients/web`
- `npm run typecheck --prefix clients/web`
- `npm run test --prefix clients/web` (486 passed, two skipped at this run)
- focused tracker, replay and actual TrackerTable component tests
- production web build and opt-in tracker browser runner above
- `clients/android/build.sh debug`: generated Kotlin/UniFFI, ARM64/x86_64
  native libraries, debug APK, 122 JVM unit tests and notice inspection pass.
  Existing platform dead-code/Android deprecation warnings remain.

Limits: this is real browser validation of the same shared React surface,
not a rebuilt or installed Tauri release. Android Compose has no tracker
countdown screen; its generated boundary/build is covered, without claiming
new native presentation or physical-device evidence. The small display offset
from transport/callback delay is not clock synchronization. Installed update,
commit and publication remain separate work.

Current checkpoint: stopping condition met; no implementation remains in this
slice. Release packaging/delivery requires its own requested action.

Pre-commit revalidation caught the gateway HTTP replay test's obsolete full
batch equality assertion. It now checks a nondecreasing delivery clock and
exact equality of every remaining batch field, preserving the replay contract.
