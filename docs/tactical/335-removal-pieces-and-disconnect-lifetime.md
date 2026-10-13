# Tactical 335: Removal Pieces And Disconnect Lifetime

Status: Complete, locally validated on 2026-10-13.

Topics: `application-view-api`, `application-connection-architecture`,
`application-control`, `capability-readiness`, `oracle-driven-engine-campaign`

## Scope And Stopping Condition

Repair bulk removal with a subscribed Pieces view: deleting its torrent must
deliver a valid empty snapshot, and a browser disconnect must not interrupt an
already executing torrent removal. Stop after deterministic projection,
strict web decode/reduction, and real WebSocket disconnect regressions plus
proportional Rust/web and Android boundary validation pass.

No new wire types, persistence schema, deletion policy, protocol support,
client presentation, detached service, or public-swarm work. Other transient
application calls and native folder requests retain their existing lifetime.

## Report And Reference Review

The web launcher report on 2026-10-13 reproduced a Rust PieceActivity removal
patch with zero pieces and nonempty old-piece clear ranges. The strict web
validator rejects it with `cleared pieces are not canonical and bounded`,
closes the socket, and rejects the next bulk command. The saved job was still
pending although exact payload deletion had occurred. Gateway teardown aborts
its call JoinSet, dropping the removal future before finalization.

Normative local contracts: application-control's durable removal generation,
application-view-api's bounded ranges and ordered snapshots, and
application-connection-architecture's separation of application request
identity from physical connection identity. No BitTorrent wire behavior changes.

Pinned libtorrent 2.0.13, revision
`7d7fc38fac61177fa5e02148f791b2f65250b09d`, inspected locally:

- `src/session_impl.cpp::remove_torrent_impl`: remove catalog ownership and
  initiate deletion through the torrent owner.
- `src/torrent.cpp::delete_files`: disconnect peers, stop announcements and
  keep the torrent alive through asynchronous disk deletion completion.
- `test/test_remove_torrent.cpp::test_remove_torrent` and complete, partial,
  mid-download, double-removal and delete-files variants: wait for terminal
  detachment and check exact files, then join session shutdown.

Adopt completion ownership independent of a presentation and joined cleanup.
Retain our durable retry generation, safe metainfo-exact deletion and application
catalog finalization ordering rather than libtorrent's architecture. No source
or fixtures copied. The current JSTorrent report and Tactical 327 supply the
relevant product failure history: durable pending removal can outlive an
interrupted caller; inbound owners must be joined before deleting payload.
The legacy sibling at `211fd65bd056a4287e61c27162533407d9131d49` was also
inspected at `packages/engine/src/core/bt-engine.ts::{removeTorrent,
removeTorrentWithData}`: stop network first, await storage destruction and
persist removal, then emit the terminal event. Its JavaScript owner shape is
not adopted.

Edge cases: sparse/disjoint verified pieces, active attempts, coalesced updates
before removal, empty initial state, reconnect after removal, disconnect while
waiting for the service versus after acceptance, exact sibling preservation,
failed deletion, shutdown and bounded call admission.

## Owner And Cancellation Map

- ViewHub owns projection state. Pure snapshot selection stays task-free.
  Piece geometry changes use existing full snapshots so no old-geometry patch
  can invalidate the new bounds.
- ApplicationService owns durable removal, joins engine/storage owners and
  finalizes or records failure. Its existing Android SAF generation/confirmation
  remains unchanged.
- The gateway connection retains a bounded, separately joined removal-call
  set. Before entering the service, connection cancellation stops queued work.
  After entry, disconnect stops response delivery but joins removal completion.
  Transient calls remain abortable; connection permits remain held through join.
- Connection shutdown joins accepted removals before releasing its permit.
  Process death still uses existing durable pending-job recovery.

Runtime adapters depend inward on session contracts and pure projection logic.
No socket or task infrastructure enters protocol/domain values. Existing limits
of pending calls, response reservations and physical connections continue to
bound work; no unowned tasks or extra queue are introduced.

## Platform Applicability And Validation

The projection fix is shared by native/Android and browser views with unchanged
TypeScript, UniFFI/Kotlin and Swift types. Android's in-process removal remains
service-owned; the gateway fix applies to its companion connection too, while
SAF cleanup/confirmation continues under the existing platform owner.

Required: real hub removal with pending piece changes, strict web empty snapshot
decode/reduction, real WebSocket disconnect while exact path deletion is blocked,
pre-service cancellation, terminal jobs/owners and sibling preservation. Run
workspace formatting/clippy/tests, web typecheck/tests and proportional Android
build/boundary evidence. Record exact results and limitations below.

## Execution And Evidence

The shared snapshot-selection helper now treats Pieces geometry changes and
torrent appearance/disappearance as snapshot barriers for both subscription
APIs. Existing queue replacement discards old pending piece patches. No wire
type or generated contract changed; web validation remains strict.

The gateway keeps torrent removal and pending-add cancellation calls in a
separately joined JoinSet under the same pending-call and connection limits.
Cancellation fences reservation/service acquisition; executing calls finish
under the service lock. Response delivery selects connection cancellation, so
a departed or backpressured consumer cannot hold completion. Native pickers
and other transient calls still abort at disconnect.

Evidence:

- `cargo test -p rstorrent-session removed_torrent -- --nocapture`: both
  subscription regressions pass with disjoint verified ranges, an active
  attempt, queued updates, empty terminal snapshot, replay and reappearance.
- `cargo test -p rstorrent-gateway removal_ -- --nocapture`: both real
  WebSocket regressions pass. A single occupied blocking worker holds deletion
  until the server acknowledges Close; release then deletes only the exact
  fixture, preserves a sibling sentinel and finalizes the durable job. A second
  case holds the service lock and proves disconnect cancels queued removal
  without applying intent or deleting payload. Both observe one pending call
  and one connection at high water, zero terminal jobs and zero connections.
- `cargo fmt --all -- --check`, `cargo clippy --workspace -- -D warnings`,
  `cargo clippy -p rstorrent-session -p rstorrent-gateway --all-targets -- -D
  warnings`, and `cargo test --workspace`: pass. The first workspace attempt
  encountered the concurrently edited, unrelated native-host process fixture;
  the complete rerun passes against the updated tree. Existing ignored tests
  remain ignored. Common session cases retain failure/retry, pending-job
  restart and matching-generation platform removal coverage.
- `npm run typecheck --prefix clients/web` and `npm run test --prefix
  clients/web`: pass, 535 tests with two existing skips. The added test decodes
  and reduces the empty snapshot after verified/active state, and confirms the
  original malformed patch is still rejected.
- `clients/android/build.sh`: pass for x86_64/arm64-v8a, regenerated Kotlin
  bindings, debug APK, 153 JVM unit tests and packaged notice/native-library checks.
  Existing cross-target unused picker helpers and Android/Gradle deprecation
  warnings remain outside this slice. No APK was installed and no physical
  device or user profile was modified.
- Local links in changed documentation and `git diff --check`: pass.

The stopping condition is met. No shipping or new protocol claim follows from
these local checks. Abrupt process death still relies on durable pending-job
recovery; other mutating calls retain their prior transient lifetime and any
broader command-lifetime change requires a separate slice. No investigation
fixtures, temporary logs or test downloads remain.
