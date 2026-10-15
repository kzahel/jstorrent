# Bounded host shutdown with progress and escalation

Status: complete. Topics: `runtime-configurations-and-headless-deployment`,
`tracker-discovery`, `incoming-reachability-and-seeding`.

## Scope and stopping condition

The maintainer asked on 2026-10-15 why Ctrl+C in `./scripts/webui` goes
quiet for about two seconds, and asked for shutdown to be fast, to report what
it is doing, to handle repeated Ctrl+C deliberately, and above all never to
corrupt the databases.

Today the launcher prints nothing until it finishes, and the gateway log that
might explain the wait is deleted during cleanup. An empty profile stops in
about 20 ms. With torrents, `ApplicationService::shutdown` joins the torrent
tasks, then sends tracker `stopped` announces (session deadline 5 s), then
deletes UPnP mappings and the IPv6 pinhole (5 s each, run concurrently). Only
after both does it save the DHT snapshot and the final accounting batch. A
second Ctrl+C kills only the launcher and leaves the gateway shutting down
unattended.

This slice:

1. Bounds application-shutdown network courtesy (tracker `stopped`
   announces and UPnP mapping/pinhole deletes) to one shared 2 s budget by
   default, and adds a hurry signal that ends that work immediately. Work cut
   short is reported, not treated as a shutdown failure.
2. Flushes accounting before the network courtesy phase, so a kill during it
   loses at most the DHT routing snapshot.
3. Reports shutdown phases through a progress callback. The gateway prints
   them as `shutdown:` lines with elapsed time.
4. Gives the gateway three signal tiers: the first Ctrl+C or SIGTERM stops
   gracefully, the second hurries, the third exits immediately with status
   130.
5. Runs the gateway and Vite in their own process groups under
   `./scripts/webui`, so the launcher alone interprets each Ctrl+C: it
   prints what is happening, relays the gateway's `shutdown:` lines, forwards
   the second press as hurry and SIGKILLs on the third.

Stop when a stalled tracker and a stalled UPnP delete cannot hold application
shutdown past the budget; hurry ends the phase within a few hundred
milliseconds; repeated signals behave as described at the process level; and
tests show the session database passes `PRAGMA integrity_check` and keeps the
torrent after graceful, hurried, third-signal and SIGKILL exits.

## Non-goals

- Changing per-torrent removal or pause `stopped` announces, which keep
  `TRACKER_STOP_TIMEOUT` (5 s).
- Bounding a settings reconcile already in flight when shutdown starts
  (`SessionNetworkRuntime::shutdown_inner` joins it first). That needs a
  settings change racing Quit and is deferred.
- Desktop, Android, iOS or headless signal and UI handling. Those hosts get
  the shorter default budget through `ApplicationService::shutdown()` but no
  new progress surface.
- Persisting uncertain UPnP leases across restarts.

## Design

### Budget and hurry

`ApplicationService::shutdown_with(ShutdownOptions)` takes a network cleanup
budget (default `DEFAULT_NETWORK_CLEANUP_BUDGET` = 2 s), a hurry
`CancellationToken`, and an optional progress callback.
`ApplicationService::shutdown()` uses the defaults. The budget starts when the
network courtesy phase starts; torrent joins and local persistence are not
budgeted, because they flush verified piece checkpoints.

- `DiscoveryAdvertisementService::shutdown_within(deadline, hurry)` replaces
  the fixed session deadline. Hurry moves the deadline to now; the owner loop
  already clears entries and aborts operations at the deadline. Owner counts
  report how many registrations still had unfinished `stopped` lanes.
  `shutdown()` keeps `TRACKER_STOP_TIMEOUT` and no hurry.
- `ReachabilityCoordinator` gains a cleanup cancellation token passed to each
  mapping and pinhole delete. `shutdown(cut_short)` cancels it when the
  shared deadline passes or hurry fires. A delete ended that way yields an
  uncertain lease whose detail names the budget; final shutdown returns those
  leases as data rather than as an error. Other delete failures stay errors.
- Tracker stops and UPnP deletes stay sequential (stopped is still sent before
  the mapping disappears) and share the one budget. Tracker stops end at three
  quarters of it, so a stalled tracker cannot leave a mapping open on the
  router for its full lease.

### Progress

`ShutdownProgress` is a small enum: stopping torrents (count), network
cleanup started (budget), tracker stops cut short (count), port mapping or
pinhole left (endpoint, remaining lease), network stopped, saving state,
finished. The callback is synchronous and must not block.

### Gateway signals

One signal task counts SIGINT and SIGTERM. The first cancels serving; the
second cancels hurry, which also stops waiting for HTTP connections to drain;
the third prints a notice and calls `std::process::exit(130)`. Each tier
prints a `shutdown:` line saying what the next press does.

### Launcher

`set -m` around each background launch gives the gateway and Vite their own
process groups (verified on bash 5.3 and macOS bash 3.2). The first INT or
TERM prints `Shutting down...`, stops Vite, sends INT to the gateway and
relays new `shutdown:` log lines while waiting. The second sends INT again
(hurry). The third sends KILL to both and exits 130. The 5 s INT-then-TERM
fallback remains for a gateway that ignores signals.

### Database safety

`session.db` and `product.db` use WAL with `synchronous=FULL`;
`metrics.db` uses WAL with `synchronous=NORMAL`. Every shutdown write is a
transaction, so ending the process at any point loses at most the
uncommitted transaction and cannot corrupt a database. Tests check this.

## Reference

Pinned libtorrent `7d7fc38f`:

- `include/libtorrent/settings_pack.hpp` `stop_tracker_timeout` (default 5 s
  in `src/settings_pack.cpp:253`): "usually shorter, to make the client quit
  faster"; 0 suppresses stopped announces. Used as the HTTP and UDP tracker
  timeout for stopped requests (`src/http_tracker_connection.cpp:239`,
  `src/udp_tracker_connection.cpp:130,176`).
- `test/test_tracker.cpp` `test_stop_tracker_timeout(1)` and `(0)`: a short
  timeout still sends `stopped`; zero sends none.
- `session_impl::abort` / `abort_stage2` close peers and listeners, then wait
  on trackers before the session object completes.

Adopted: stopped announces are still sent, and a non-responding tracker
cannot hold shutdown. Intentional difference: one 2 s budget shared across
all tracker stops and UPnP deletes on application shutdown, with an
operator-driven hurry that suppresses whatever has not completed, instead of a
per-request 5 s timeout.

## Owners and cancellation

- The gateway signal task owns the tier counter and the serve and hurry
  tokens. `main` owns the serve task and awaits it or abandons it on hurry,
  then owns `ApplicationService::shutdown_with`.
- The advertisement owner task still owns tracker operations and joins or
  aborts them before returning.
- The reachability task owns deletes; the coordinator owns the cleanup token
  and joins the task.
- `ShutdownOptions` lives in a new `application/shutdown.rs`, which depends
  on nothing outside `tokio_util` and `std`.

## Validation

- Engine: a stalled HTTP tracker cannot hold `shutdown_within` past its
  deadline; hurry ends it promptly; the counts report the unfinished stop.
- Reachability: a scripted gateway that stalls on delete is cut short by the
  cleanup token and returns an uncertain lease as data.
- Application: a stalled `stopped` tracker cannot hold
  `shutdown_with` past the budget; hurry ends it promptly; progress reports
  the cut-short stop; the store reopens with the torrent and accounting.
- Gateway process (Unix): with a stalled-stop tracker, one SIGINT exits 0
  within the budget and prints the phases; two exit promptly; three exit 130;
  SIGINT then SIGKILL during network cleanup. After each, `session.db`
  passes `PRAGMA integrity_check` and still lists the torrent.
- Launcher: `bash -n scripts/webui` and a recorded `--no-open` smoke with
  one, two and three INTs.
- Rust baseline: fmt, clippy, workspace tests.

## Evidence

Tests added:

- `rstorrent-engine` advertisement:
  `shutdown_deadline_bounds_a_stalled_stopped_announce` (300 ms deadline,
  stalled `stopped`, one stop cut short) and
  `hurry_ends_a_stalled_stopped_announce_before_its_deadline` (30 s deadline
  ended by hurry). The existing responsive-tracker lifecycle test asserts no
  stop is cut short.
- `rstorrent-session` reachability:
  `cleanup_cancellation_cuts_a_stalled_delete_short` (a scripted gateway that
  never answers `DeletePortMapping`; cancellation yields the cut-short lease
  without an error, well inside `DELETE_TIMEOUT`).
- `rstorrent-session` application:
  `shutdown_budget_bounds_a_stalled_stopped_announce` (500 ms budget; exact
  progress sequence; the reopened profile lists the torrent) and
  `shutdown_hurry_ends_a_stalled_stopped_announce`.
- `rstorrent-gateway` `tests/shutdown_signals.rs` (Unix, real binary, stalled
  `stopped` tracker): one SIGINT exits 0 in about 1.5 s with progress lines;
  a second SIGINT exits within a second; SIGINT then SIGINT+SIGTERM queued
  while SIGSTOPped (identical signals can coalesce) exits 130 without the
  `stopped` line; SIGKILL during network cleanup. After each, `session.db`
  passes `PRAGMA integrity_check` and holds the torrent. The tier mapping has
  a unit test.

The new shutdown tests passed five consecutive runs.

Launcher smoke (`--no-open`, isolated data root, loopback tracker that holds
`stopped`, Ctrl+C simulated with SIGINT to the launcher):

```
Shutting down RSTorrent web UI...
  stopping; press Ctrl+C again to skip tracker and port-mapping cleanup
  HTTP server stopped (+0 ms)
  stopping 1 torrent (+0 ms)
  announcing stop to trackers and removing port mappings (up to 2000 ms) (+0 ms)
  tracker stop announces for 1 torrent(s) did not finish; trackers will time them out (+1503 ms)
  network stopped (+1503 ms)
  saving state (+1503 ms)
  stopped (+1504 ms)
RSTorrent web UI stopped.
```

A second press at +715 ms printed the skip line and stopped at +718 ms. With
the gateway SIGSTOPped, the third press printed `Killing the application
gateway; saved state is kept.` and the launcher exited 130. Every run left an
intact `session.db` with the torrent and no leftover process. `--reload`
stopped Vite and released its port.

Validation: `cargo fmt --all -- --check`, `cargo clippy --workspace
--all-targets -- -D warnings`, `cargo test --workspace`, `bash -n
scripts/webui`.

Deferred: bounding a settings reconcile already in flight at shutdown; signal
escalation and progress in `rstorrent-headless`, desktop, Android and iOS.
