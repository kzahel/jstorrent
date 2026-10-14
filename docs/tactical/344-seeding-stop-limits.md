# Tactical 344: Seeding Stop Limits

Status: Draft, 2026-10-14. Maintainer-requested; reference survey complete.
Implementation is not yet authorized; the decisions under **Maintainer
Decisions** are open.
Topics: `incoming-reachability-and-seeding`, `client-persistence`,
`application-control`, `web-ui-design`, `android-jstorrent-replacement`,
`capability-readiness`.

## Problem

Tactical [201](201-durable-seeding-goals-and-seed-admission.md) added
libtorrent's three seed goals. They only rank the seed queue: a torrent that
meets a goal keeps seeding whenever it wins a slot, and nothing ever stops it.
Users expect the common client control, "stop seeding at ratio X or after time
Y", and RSTorrent has none. Tactical 201 deliberately deferred this
(`Non-Goals`: hard stop-on-ratio/time, automatic durable Pause, per-torrent
overrides) and required a separate tactical with escalation for it.

The current Settings presentation compounds the confusion. The goal group
looks like limits, the absolute time goal is edited in raw seconds, and its
wide unit label misaligns the input against the other right-aligned rows.

## Decision And Desired Outcome

Add **stop limits** as a feature separate from the seed goals:

- A finished torrent stops when its uploaded ratio reaches the ratio limit
  **or** its seeding time reaches the time limit, whichever comes first.
- Limits are global, with a per-torrent override: **Use global**, **No limit**
  or a custom value, each limit independently.
- Reaching a limit durably stops the torrent with a recorded reason, shown as
  **Seeding limit reached**, not as an ordinary user pause.
- Resuming a limit-stopped torrent means **keep seeding**: it sets that
  torrent's limits to No limit so it is not stopped again on the next check.
- Seed goals are unchanged: they still only rank the seed queue. Settings show
  stop limits first and move the goals into a secondary "Seeding priority"
  group, with durations edited through a preset picker.

## Reference Survey

### libtorrent `7d7fc38fac61177fa5e02148f791b2f65250b09d` (v2.0.13)

- `src/torrent.cpp::torrent::seed_rank` (9500-9532) is the only reader of
  `share_ratio_limit`, `seed_time_ratio_limit` and `seed_time_limit`; they set
  the `seed_ratio_not_met` rank flag. `settings_pack.hpp` (1427-1430,
  1849-1857) and `docs/manual.rst` (370-384) state that torrents past the
  limits still seed, without priority. libtorrent has no stop action; the
  ChangeLog's only removed "ratio" feature is the unrelated per-peer
  `set_ratio()` (deprecated 0.16, removed 1.0).
- `all_time_upload`/`all_time_download` and `finished_duration` accumulate as
  RSTorrent's accounting already does (`torrent.cpp` 9722-9740, 10285-10316,
  10442-10443); finished time stops while paused or queued. Resume data
  carries them (`read_resume_data.cpp` 243-248, `write_resume_data.cpp`
  85-91), clamped on load (`torrent.cpp` 429-436).
- Tests: only resume round trips (`test/test_read_resume.cpp` 60-110,
  `test/test_resume.cpp` 92-107, 211-230). Nothing tests `seed_rank` or the
  limits.

### qBittorrent `release-5.2.4` (`a1e4649cb8ae581925acc161dbab5cbc6584c542`)

- Three limits: ratio, seeding minutes and inactive seeding minutes, with
  sentinels `-2` use-default and `-1` no-limit (`base/bittorrent/sharelimits.h`
  36-57). Per-torrent → category → parent category → global resolution
  (`torrentimpl.cpp` 1484-1514, `sessionimpl.cpp` 978-1032). Global defaults
  are no limit; the default action is Stop.
- Actions: Stop, Remove, Remove with content, Enable super seeding; one
  action for all three limits, overridable per torrent.
- Ratio is `all_time_upload / all_time_download`, falling back to
  `total_done` when downloaded is under 1% of it; zero downloaded with any
  upload is infinite (`torrentimpl.cpp::realRatio` 1516-1531). Seeding time is
  libtorrent `finished_duration` in whole minutes.
- `SessionImpl::processTorrentShareLimits` (2376-2430) runs from a 10-second
  timer and once at download completion (5488-5502). Eligible: finished and
  not force-started, including stopped and queued torrents. OR, first match
  wins; every comparison is `>=`.
- No stopped-by-limit state: Stop sets the same flag as a user stop
  (`torrentimpl.cpp` 1937). `TorrentImpl::start` (1956) does nothing special,
  so a torrent resumed past its limit is stopped again within 10 seconds unless
  force-started or its limit is raised.
- Gaps observed: the timer is enabled only when a global or per-torrent limit
  exists, so category-only limits apply only at completion
  (`updateSeedingLimitTimer` 5227-5240); Remove actions run even on torrents
  the user already stopped.
- No tests (`test/` has only utility tests). Changelog: 4.6.2 "Do not apply
  share limit if the previous one was applied"; 5.0.0 applies limits
  immediately at completion and adds per-torrent action override.

### Transmission `4.1.3` (`838877323facc4cc2b677fe817e203779c437bb1`)

- Session ratio limit (default 2.0, off) and idle seeding limit (default 30
  minutes, off) (`libtransmission/session.h` 426-451). Per-torrent modes
  Global, Single, Unlimited for each (`transmission.h` 979-1013). No absolute
  seeding-time limit.
- Ratio goal is `size_when_done * ratio` against bytes uploaded ever
  (`torrent.cc::tr_torrentGetSeedRatioBytes` 200-226), so a torrent added
  complete must upload its size times the ratio, like any other.
- `tr_torrent::stop_if_seed_limit_reached` (`torrent.cc` 462-490) runs every
  10 seconds from the rechoke pulse for running, done torrents; ratio first,
  then idle; it stops, never removes. macOS alone offers remove-after-seeding.
  A done-seeding script and callbacks fire.
- Restart: `tr_torrent::start` (651-656) logs "Restarted manually -- disabling
  its seed ratio" and persistently sets the torrent to Unlimited when the
  ratio is already met. Idle resets because the start time resets.
- `tr_stat.finished` / RPC `is_finished` distinguishes a limit stop from a
  user pause; clients show "Finished" (`gtk/Torrent.cc` 428,
  `web/src/torrent.js` 296). The idle flag is not persisted.
- No behavioral tests; only setting and RPC plumbing tests.

### JSTorrent

`../jstorrent-typescript` at `211fd65bd056a4287e61c27162533407d9131d49` and
its archived Chrome app have no ratio or seeding-time limit. Android's "When
downloads complete: stop and close / keep seeding"
(`android/app/.../settings/SettingsStore.kt` 94-97) only controls whether
seeding keeps the service alive; RSTorrent's equivalent is the separate
lifetime opt-in recorded in
[`android-jstorrent-replacement`](../topics/android-jstorrent-replacement.md).
There is no JSTorrent behavior to migrate.

### Adopted and intentionally different

| Question | qBittorrent | Transmission | RSTorrent |
| --- | --- | --- | --- |
| Limits | ratio, seeding time, inactive time | ratio, idle | ratio, seeding time; inactive deferred |
| Ratio base | downloaded, fallback to done | size | `max(downloaded, size)`, the existing seed-goal and display formula |
| Seeding time | finished, unpaused | none | `finished_seconds`, accrued only while admitted as a full seed |
| Comparison | `>=`, OR | `>=`, OR | `>=`, OR |
| Action | stop/remove/delete/super-seed | stop | stop only |
| Stopped-by-limit state | none | in-memory flag plus ratio recomputation | durable pause reason |
| Resume past limit | re-stopped within 10 s | ratio set to unlimited | limits set to No limit ("Keep seeding") |
| Lowered limit | stops at next check | stops at next check | stops at next check |
| Raised limit | no auto-resume | no auto-resume | no auto-resume |
| Defaults | off | off | off |

The `max(downloaded, size)` base gives a finite, meaningful ratio for
torrents added complete and avoids qBittorrent's infinite-ratio case, and it
matches the share ratio RSTorrent already displays.

## Maintainer Decisions

These change accepted contracts or product policy and need explicit answers
before implementation. Recommendations are marked.

1. **First in-place schema migration.** Stop limits need durable columns.
   Every earlier schema change used the disposable profile reset, but
   JSTorrent production users now run schema 26, and a reset would discard
   their torrent lists. *Recommended:* an additive, transactional 26 → 27
   migration that preserves every existing row, with reset still applying to
   recognized pre-26 incubation catalogs. This is the first migration reader
   and should be recorded in `client-persistence` and the release baseline.
2. **Resume semantics.** *Recommended:* resuming a limit-stopped torrent sets
   both of its limits to No limit, and the action reads **Keep seeding**. Bulk
   Resume applies the same rule to each selected limit-stopped torrent.
   Alternative: clear only the met limit, so the other can still stop it.
3. **Android presentation.** Engine semantics and generated bindings land
   here regardless. *Recommended:* Compose gets the global limits, the
   Seeding-limit-reached state and Keep seeding; the per-torrent override
   joins the existing Compose torrent settings sheet beside rate limits.
4. **Queued seeds.** *Recommended:* evaluate every desired-running complete
   torrent, including queued ones, so lowering a limit drains the queue
   instead of leaving over-limit torrents to win slots later.

## Scope

### Engine and application

- Pure predicate beside `seed_policy.rs::assess_seed_goals`: resolve each
  limit (global, override, off), compare `total_uploaded * 100 >=
  max(total_downloaded, total_size) * ratio_percent` and `finished_seconds >=
  time_limit_seconds`, and report which limit was reached. No runtime,
  clock or storage dependency.
- The application evaluates eligible torrents at each accounting checkpoint
  and immediately at the downloaded-completion transition, using the current
  in-memory accounting rather than only the last flushed values.
- Reaching a limit commits `desired_state = 'paused'`, `pause_reason =
  'seed_limit'` and the accounting snapshot in one transaction, then follows
  the ordinary pause path. Completion notification and milestone still fire
  for a torrent that stops at completion.
- User Pause records `pause_reason = 'user'`. Any Resume clears the reason;
  resuming a `seed_limit` pause also commits the per-torrent No-limit
  override in the same transaction.
- Session settings: `seed_stop_ratio_limit_percent` and
  `seed_stop_time_limit_seconds`, each `Off` or a bounded value, default
  `Off`. Torrent settings extend `TorrentSettingsPatch` with
  `UseGlobal | Off | Value` per limit, following per-torrent rate limits.
- Views: the operational state stays `Paused`, plus a typed pause reason;
  `TorrentView` carries effective limits and progress toward each so the UI
  can show "1.42 / 2.00" and "18 h / 1 day".

### Persistence

- Schema 27 per decision 1: `client_settings` gains the two global limits;
  `torrents` gains `pause_reason` and the two override modes and values.
  Every pre-existing paused torrent migrates as `user`.
- Exact-version validation remains; the migration is the only accepted path
  from 26.

### Clients

- React Settings: a **Stop seeding** group first, then the existing goals in
  a secondary **Seeding priority** group whose copy keeps saying goals do not
  stop seeding. Both duration fields use one preset picker (Off where
  applicable, 1 hour, 6 hours, 1 day, 3 days, 1 week, 30 days, Custom with
  minutes/hours/days), following `RateLimitPicker`. Ratio limit presets
  (Off, 1.0, 2.0, 3.0, 5.0, Custom). All controls share one right-aligned
  column, fixing the current misalignment.
- React torrent settings: per-torrent override per limit. Torrent list and
  detail show **Seeding limit reached** and offer **Keep seeding**.
- Compose and generated Kotlin/Swift per decision 3.

## Non-Goals And Deferrals

- Remove, remove-with-files or super-seeding actions; scripts; a new
  notification for limit reached.
- Inactive or idle seeding limits, categories or labels, schedules.
- Force start. It remains deferred from Tactical 201. qBittorrent couples it
  to limits (forced torrents skip share-limit checks), which makes it the only
  escape from its re-stop loop; Transmission's Start Now bypasses only the
  queue. Here Keep seeding is the explicit limit escape, so a future force
  start should bypass only active-slot admission, not stop limits.
- Changing seed-goal semantics, defaults or rank (Tactical 201 contract).
- Stopping partial (selected-finished) torrents: they have no upload runtime
  yet, so they are never eligible.
- Auto-resuming limit-stopped torrents when a limit is raised or removed.
- Applying a limit while a torrent is still downloading; a ratio reached
  during download stops the torrent at completion.

## Invariants And Edge Cases

- `>=` at exactly the limit stops; one byte or second below does not.
- A limit of 0 stops at completion; with both Off nothing is ever stopped.
- Torrents added complete or adopted from existing content use the same
  `max(downloaded, size)` base and start from their stored finished time.
- A limit stop is idempotent across crash and restart: a stop not yet
  committed is re-evaluated after reopen from durable accounting; a committed
  one is not reapplied.
- A limit stop never rewrites a user pause, archive, removal or quarantine,
  and an archived or removing torrent is never eligible.
- Recheck that finds a limit-stopped torrent incomplete keeps it paused;
  Resume then follows the existing incomplete-resume repair path and clears
  the reason.
- Counter saturation keeps comparisons monotonic; no overflow in `* 100`
  (u128 arithmetic as in `assess_seed_goals`).
- Commands from several connected clients keep application revision
  semantics; Keep seeding on an already running torrent is a no-op.

## Ownership, Cancellation And Bounds

The application actor owns evaluation; it adds no task, channel or timer
beyond the existing accounting checkpoint and auto-manage tick. Evaluation is
O(torrents) per checkpoint under the fixed catalog bounds and allocates no
per-peer state. The pure predicate lives in `rstorrent-session` policy code;
storage and runtime depend on it, not the reverse.

## Validation

- Predicate unit tests: boundary just below and at each limit, Off, zero
  limits, zero downloaded, added-complete, override resolution, saturation.
- Store tests: fresh 27, migration from a populated 26 fixture preserving
  every row and pause, rejection of unknown versions, transaction atomicity of
  stop and Keep seeding.
- Application tests with deterministic clock and scripted peers: ratio
  crossing stops with reason; time crossing stops; lowering a global limit
  stops running and queued seeds; Keep seeding persists No limit and survives
  restart; user pause unaffected; stop-at-completion keeps completion
  milestone.
- Controlled interop: a pinned-libtorrent loopback leecher drives a real
  upload across a ratio limit.
- `npm run generate`, `typecheck` and `test` for `clients/web`; generated
  Kotlin and Swift builds; Android unit tests and dual-ABI build.
- Workspace `fmt`, `clippy` and `test`.

## Stopping Condition

Complete when global and per-torrent stop limits are enforced by the
application with durable reasons and Keep-seeding semantics, schema 27
migrates schema-26 profiles in place, React and the agreed Android surface
present them, the validation above passes, and `incoming-reachability-and-seeding`,
`client-persistence`, `application-control`, `capability-readiness` and
`android-jstorrent-replacement` record the result.
