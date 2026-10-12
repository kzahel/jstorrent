# Tactical 314: Android Presentation Shutdown Race

Status: Complete locally, 2026-10-12. Store delivery remains separate.

Topics: `client-surfaces`, `android-jstorrent-replacement`,
`application-view-api`, `product-surfaces-and-migration`.

## Trigger, scope and stopping condition

Play Console's October 12 version-28 production snapshot reports one foreground
`IllegalStateException` in generated `AndroidApplicationClient.subscribe`,
through `AndroidPresentationRepository.presentTorrent`. The sample is a Google
Pixelbook running Android 13; the report has one affected user and one event.
The exception message is absent, so exact customer actions are unknown.

Investigate the generated binding and presentation/shutdown ordering. Fence
presentation requests after repository closure, contain active subscription
setup failures, and retain ownership of partially acquired subscriptions.
Complete when deterministic JVM regressions reproduce the unsafe ordering
before the repair and pass afterward, Android unit/lint/build checks pass,
and owning topics record evidence and delivery limits.

Non-goals: no engine, protocol, storage, network/background policy, generated
application contract, dependency, package version, production installation,
store submission or rollout changes. A local repair does not prove the exact
customer race or production recovery.

## Source dossier and diagnosis

Reviewed exact shipped source `ff632f4588a474d7b169de3cea228bd406e6982d`:
`AndroidPresentationRepository::{presentTorrent,subscribe,close}` and
`ProductEngineService::{withPresentation,closeClientForDataReset,shutdown}`.
Also inspected locally generated UniFFI `AndroidApplicationClient` handle
counter, `destroy`, and async `subscribe`, and native
`AndroidApplicationClient::subscribe` in `crates/rstorrent-android/src/lib.rs`.
Native subscription failures are typed `AndroidClientException`. Disassembling
the retained compiled generated class with `javap -p -c -l` binds the reported
line **7308** in `subscribe$suspendImpl` to bytecode offset **21**, the
already-destroyed-client guard. The distinct overflow guard maps to line 7311.
This identifies the failure even though Play omits the exception message.
The no-handle generated-client regression independently obtains
`AndroidApplicationClient object has already been destroyed` without native I/O.
The precise customer lifecycle trigger remains unknown.

The repository does not record terminal closure. `close()` invalidates existing
request epochs and drains subscriptions, but a later request increments an
epoch again and accesses the destroyed client. The service wrapper catches
only its own coroutine; repository-launched children escape that handler.
Initial acquisition also precedes the subscription reader's error handler.
Multi-subscription `map` can lose earlier acquired owners if a later call fails.

This is a Kotlin client ownership repair, not an engine/protocol feature.
Normative BitTorrent specifications and libtorrent internals are inapplicable;
the exact generated bindings and shipped adapter own this invariant. No
external source, fixture or reference implementation is imported.

## Owners, invariants and resource limits

The product service still owns its coroutine scope and native client. The
presentation repository owns its existing mutex, request epochs and bounded
subscription groups; it becomes terminally closed under that same mutex before
the service releases the client. An in-flight acquisition remains serialized
with close; requests admitted afterward cannot call the client. No new task,
queue, retry or resource budget is introduced.

Every launched presentation mutation reports active failures through existing
`onError`; cancellation keeps its coroutine semantics. Partially acquired
groups remain owned and are released on failed setup. Subscription readers
retain existing cancellation and join paths. Tests use generated no-handle
fake objects and a deterministic dispatcher, without Android devices, JNA
native calls, timing sleeps or new dependencies.

## Validation and restart checkpoint

Source review, local repair and required build/lint evidence complete.
The initial eight-case suite fails five assertions before implementation:
destroyed-client access, post-close routes, stop gating, active setup error
reporting and partial-group cleanup. The same eight cases pass after repair.
Five further cases cover the real generated guard, a post-close queued request,
partial-group cancellation, unexpected setup errors and ordinary reselection.
Required cases: request queued across close, request submitted after native
client destruction, stop gate, active setup failure, partial-group failure,
in-flight acquisition serialized with close, cancellation and ordinary
reselection/retry. All 13 regression cases pass in debug and release; every
fixture closes its owned subscriptions and cancels its scope. The fence adds
one mutex-owned boolean and does not increase subscription counts or budgets.

Commands executed (toolchain commands sourced `~/.profile`):

- From `clients/android`, `./gradlew :app:testDebugUnitTest --tests
  org.rstorrent.bootstrap.AndroidPresentationRepositoryTest`: original eight
  cases fail five assertions before the repair, then all eight pass afterward.
  The initial custom-dispatcher test run stalled while draining close
  continuations and was terminated; the corrected deterministic pump precedes
  the recorded complete failing-before run.
- `clients/android/build.sh`: fresh ARM64/x86_64 Rust libraries, regenerated
  Kotlin bindings, isolated debug APK, all 136 JVM cases, exact notice/native
  library inventory pass. Native libraries and contracts are unchanged by this
  repair; existing cross-target dead-code, NDK-environment and Kotlin Android
  deprecation warnings remain.
- From `clients/android`, `./gradlew :app:lintDebug :app:compileReleaseKotlin
  :app:testReleaseUnitTest :app:lintRelease` initially refuses the repository's
  `UPLOAD_KEYSTORE_PATH` signing requirement. No release package is produced.
- The same compile/test/lint-only command with
  `-x :app:requireReleaseSigning` passes debug/release lint and all 136 release
  JVM cases, with zero failures/errors/skips in both variants. Skipping the
  signing precondition is limited to these local compiler/test/lint tasks;
  no release APK/AAB packaging, signing configuration change or publication
  occurs.
- `cargo fmt --all -- --check` and `git diff --check` pass. No Rust source or
  shared web/application contract changed, so Rust clippy/tests and web suites
  were not rerun for this Kotlin-only repair.

No physical device, public swarm, installed production package or rollout is
changed. There are no new temporary captures/downloads/logs outside normal
ignored build outputs. The next release work must create a new signed Android
candidate, qualify installed shutdown/reopen/detail navigation, and observe
version-specific production vitals; do not relabel frozen version28 artifacts.
The exact customer lifecycle trigger and population failure rate remain unknown.
