# Tactical 260: Android Shutdown Failure Containment

Status: Complete locally, 2026-10-07. Bounded follow-up to finish-line Tactical 259.

Topics: `client-surfaces`, `android-jstorrent-replacement`,
`incoming-reachability-and-seeding`.

## Trigger, scope and stopping condition

Physical cohort B attempt 10 ends in an uncaught generated Android client
exception during shutdown. The Rust client has joined its owners but reports
an uncertain IPv6 pinhole lease. Android's standalone coroutine lets that
expected typed failure escape and crash the process.

Contain this typed native shutdown failure in the Android adapter, retain its
error for local presentation/logging, and always join/release the existing
client and SAF jobs. Preserve cancellation and unexpected failure propagation.
Complete when deterministic JVM cases, current Android build/tests and bounded
physical shutdown/restart evidence pass. The reason shutdown originally began
and the broader endurance gate remain separate investigations under 259.

Non-goals: no Rust/UPnP protocol, gateway, lease, advertisement, network policy,
background policy, persistence, generated contract, dependencies or store
publication changes. Do not suppress uncertainty or report successful gateway
cleanup. No additional tasks, queues, retries or resource budgets.

## Source and reference dossier

Reviewed `ProductEngineService::{requestStop,shutdown,onDestroy}`,
`AndroidApplicationClient::shutdown` in `crates/rstorrent-android/src/lib.rs`,
`ReachabilityCoordinator::shutdown` and the uncertain-create branch in
`crates/rstorrent-session/src/reachability.rs`. The Rust shutdown aggregates
errors only after attempting existing companion/application/media cleanup.
An uncertain external lease does not prove an unjoined local owner.

Retain Tactical 113's WANIPv6FirewallControl finite-lease/uncertain-response
contract unchanged. Pinned libtorrent revision
`7d7fc38fac61177fa5e02148f791b2f65250b09d` is verified locally; inspected
`src/upnp.cpp::{return_error,close}` and `test/test_upnp.cpp::run_upnp_test`.
Its mapping errors are reported through a callback; close schedules bounded
unmapping independently of ordinary peer ownership. Adopt the error-versus-
process-lifetime distinction, without copying source or changing our stricter
uncertain-lease reporting. JSTorrent's current Android adapter is independent;
this repair does not import legacy engine behavior or reference fixtures.

## Owners, invariants and validation

The service remains sole owner. One task-free suspend function wraps the
existing generated client shutdown and caller-provided release sequence.
Only `AndroidClientException` becomes a returned failure; cancellation and
other exceptions propagate after release. The service publishes the returned
error and distinguishes cleanup failure in its final shutdown log.

Tests exercise success, typed native failure, cancellation and unexpected
failure, with exactly one release after the shutdown attempt. Preserve actual
failed physical receipts. Build through the normal isolated qualification
identity with both native ABIs, generated Kotlin, JVM tests and notices;
physical checks preserve inherited production installation and bytes.

Restart checkpoint: source review and adapter implementation complete. Five
JVM cases cover release and failure/cancellation propagation. The normal isolated build passes both native ABIs, generated Kotlin, notice
inventory and all 121 JVM cases, including the five regressions. APK identity
is independently checked; installation on cohort B passes. Physical checks
are pending. The 259
runner now records package-filtered activity/service state during observations
and the separate crash buffer before failure cleanup.

## Bounded physical completion checkpoint, 2026-10-08

Both physical cohorts independently verify the installed source0aa isolated
APK SHA256 de4aea6fcb6ca0ecd3dc228e3bc3ead01633832175f96566d27045bb1d772b22.
Each serves all524289 bytes of an owned two-positive-file fixture in foreground,
background and reopened foreground; every leeched file is independently hashed.
Disable seeding through actual UI, detach, observe product_shutdown_complete
with cleanup_failed=false and absent service, then reopen the actual Live/owned
library. Retained SAF registry and payload SHA1
ad2d0afead4a97989b13253076ba99e020acf3df remain unchanged. Both owned cleanups
pass. This is bounded debug evidence, not managed Play delivery, a recreated
uncertain-router failure or large-metadata/hour qualification. Five typed
failure/cancellation release regressions and normal122-JVM/lint/original-signed
packaging evidence remain. Larger seeding refusal stays separate under267/269.
