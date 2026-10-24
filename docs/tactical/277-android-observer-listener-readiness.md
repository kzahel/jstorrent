# Tactical 277: Android Observer Listener Readiness

Status: Complete locally, 2026-10-08. Finish-line source-CI follow-up.

Topics: `application-view-api`, `incoming-reachability-and-seeding`.

## Scope and stopping condition

Make the existing Android incoming-peer projection test observe actual listener
readiness within a fixed deadline after its settings command. Source8c CI fails
at the immediate optional snapshot; the same exact test fails locally. This is
a qualification-only correction, with no engine, listener, protocol, generated
boundary, dependency or product behavior change. Stop after the focused test,
full Android Rust boundary tests, formatting/clippy and documentation pass.
Preserve the original CI failure; a later pass cannot rename it successful.

## Contract, ownership and evidence

Tactical269 owns the bounded projection contract. The application settings
command schedules convergence; `SessionNetworkRuntime::incoming_peer_snapshot`
returnsNone until the owned listener is active. The test owns a five-second
readiness deadline and yields between short read-only samples. Actual errors
still fail. Retain the six real unknown-hash handshakes, exact rejection counts,
truncation, absence of peer addresses and joined shutdown assertions unchanged.
No network task or cancellation path changes, so no protocol oracle behavior
is adopted. Inspect the exact application settings reconciliation and listener
active flag before editing the test. A timeout must fail instead of sleeping
and assuming readiness.

## Restart checkpoint

Original hosted failure: source8c, run37735034162, Rust and loopback interop
job113172532774. The immediate snapshot isNone at lib.rs2502. Focused local
reproduction fails identically. Fix and repeat the bounded assertion next.

## Completed local evidence

Reviewed AndroidApplicationClient::open/dispatch/incoming_peer_snapshot,
ApplicationService::dispatch settings submission and maintenance ownership,
and SessionNetworkRuntime::incoming_peer_snapshot/listener_active publication.
The bounded test now samples the actual active listener for at most five
seconds, yielding ten milliseconds between samples. All15 Android Rust boundary
cases, focused all-target warning-denying clippy and workspace formatting pass.
All six handshakes, bounded rejection assertions and joined shutdown remain.
The generated contract and shipping binaries are unchanged by this test edit.
The original hosted source8c CI failure remains recorded; revised source has
not been pushed and hosted full source validation remains open.
