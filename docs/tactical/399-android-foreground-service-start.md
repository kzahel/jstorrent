# Android foreground-service startup crashes

Status: production timeout reproduced and startup hardened, November 19, 2026.

Play Vitals reports four events in three clusters. Release-mapped stacks
identify `MainActivity.startProductService` (one event, foreground) and
`ProductEngineService.onCreate` (two events, background) throwing
`ForegroundServiceStartNotAllowedException` on Android 17 / Galaxy A56.
The fourth event is a foreground-start acknowledgement timeout on an
Android 13 Chromebook. Its framework-only sample cannot identify which
service or caller triggered it. Across five versions the timeout cluster
has eight events and seven affected users in the 28-day view.

Scope: contain rejected Android platform starts and promotions, and check
the product service's startup deadline and foreground transition ordering.
Preserve the single in-process engine owner, the explicit background and
sticky admission policy, quota fencing, durable data, URI grant validation,
and the desktop/extension contracts. No store action or app-wide lifecycle
redesign. Never loop background start retries or log intent contents.

`MainActivity` owns the visible launch and its pending inputs. Android owns
the start/promotion deadline. `ProductEngineService` owns foreground state,
one lifecycle coordinator and joined engine shutdown. The coordinator can
publish decisions from worker threads while the main thread acknowledges
starts. Tactical 200 and commit `1e72aa2e` document the previous physical
ChromeOS repeated-start failure and the existing regression. Android's
[foreground-service troubleshooting](https://developer.android.com/develop/background-work/services/fgs/troubleshooting)
defines the two platform failures and the acknowledgement requirement.

Validation and stopping condition: exercise a real or injected denial and
later visible recovery, re-run external-intake and service-lifecycle coverage
on an owned Android runtime, check startup/idle cleanup, and run the Android
JVM suite, lint and builds. Record OS coverage and any customer timing case
that remains unverified.

## Reproduction and implementation

On an owned, offline Android 15 (API 35) Google APIs emulator, install the
signed Android 1.0.40 APK and verify its published SHA-256. Before ever
launching MainActivity, use the emulator's root ADB to seed
`shared_prefs/product_data_sync_quota.xml` in the app's private data with
`<map><boolean name="exhausted" value="true" /></map>` under the app UID.
An explicit `am start-foreground-service` for `ProductEngineService` is
accepted. The old service logs `product_quota_restart blocked=true`, then
ActivityManager logs that the service is being brought down while still
waiting for `startForeground`. The process dies with
`ForegroundServiceDidNotStartInTimeException`. The injected fence models
persisted state after quota exhaustion. Root shell supplies a controlled
start and doesn't establish how a production start was triggered.

AOSP's [Android 13 ActiveServices](https://android.googlesource.com/platform/frameworks/base/+/refs/tags/android-13.0.0_r1/services/core/java/com/android/server/am/ActiveServices.java)
and [Android 15 ActiveServices](https://android.googlesource.com/platform/frameworks/base/+/refs/tags/android-15.0.0_r1/services/core/java/com/android/server/am/ActiveServices.java)
cancel the pending acknowledgement on the foreground call and enforce it
even when the service is brought down before the nominal deadline.
Android 13 has no Android 15 dataSync quota callback. The customer timeout
may involve a different path. The prior ARC repro and a concurrent
promotion/demotion ordering gap justify keeping the transition fix separate
from the reproduced quota path.

- The resumed activity requests the product service and binds only once
  Android accepts. It retains a bounded set of external requests until
  binding confirms the service exists. Platform rejection leaves a visible
  retry or a subsequent resume. Pending sources stay in memory.
- A rejected initial promotion stops that generation before opening the
  catalog or starting background work. A null binding lets the activity
  release the unusable instance and offer retry.
- A fenced service acknowledges a platform-accepted foreground start and
  stops immediately, removing any temporary notification. It never opens
  the engine and the persisted fence stays set until a visible launch.
- Foreground transitions serialize the platform call, local state and
  notification updates. This also prevents an ongoing notification from
  reappearing after demotion. Engine startup waits for the first start
  acknowledgement.

## Validation

- The same owned API 35 quota fixture passes with the debug build. It records
  the foreground acknowledgement, leaves no running service or crash, and
  opens the engine on the next visible launch.
- Android debug lint, debug app and test APK assembly, and 228 JVM tests pass.
  Ten API 35 instrumentation cases pass twice, covering injected platform
  denials, an accepted fenced start, the timeout path, repeat promotion/
  demotion, and standard Android and ARC external intent routing.
- The owned API 35 `product-external-intake` profile passes with SAF,
  including cold and warm magnet intake, temporary content grants,
  cancellation and retries, verified controlled downloads, and exact
  cleanup. The debug APK contains both Android native ABIs.
- The release lint and JVM commands stop at the configured signing prerequisite
  because the upload keystore is unavailable in this environment.
