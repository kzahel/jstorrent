# Android shutdown, resources, and navigation crash follow-up

Status: all three signatures reproduced and fixed in source, November 19, 2026.

## Scope

- Android 1.0.39, Android 16 Xiaomi 17T:
  `ForegroundServiceDidNotStopInTimeException` after system quota expires.
  The product service joins cleanup before it stops. Reproduce the platform
  deadline with shortened quota and a deliberately slow owned cleanup job.
- Android 1.0.35, Android 16 Lenovo tablet: `LocaleContext.getResources`
  recursively re-enters from the OEM display-metrics calculation inside
  `createConfigurationContext`. Simulate the same callback in a wrapped
  Android context.
- Android 1.0.32, Android 16 Redmi: predictive back indexes -1 from
  `NavHost`. Verify against AndroidX issue 375343407 and reproduce the
  back-stack transition on the current dependency before upgrading.

Preserve the single product service and the existing quota fence, background
admission, download intent, checkpointing and joined shutdown. Locale
resources stay owned by the existing wrapper and Android's stored locale.
Preserve existing navigation routes, back behavior and Android toolchains.
Use disposable emulators, with no production data or store changes.

## Validation

Capture the baseline and fixed test results for each reproduced signature.
For shutdown, require prompt FGS release while cleanup still owns the
engine, no process crash, joined termination and successful future visible
launch. Re-run Android lint, JVM and relevant instrumentation tests.

## Baseline and fixes

- **Shutdown:** API 35 Android enforces a 5,000 ms dataSync quota and a
  1,000 ms crash grace in the disposable emulator. The instrumentation
  fixture holds the existing external-admission cleanup job across the
  grace period. Android invokes `onTimeout`, then kills the unpatched
  product process with `ForegroundServiceDidNotStopInTimeException`.
  The fix releases foreground status inside the timeout callback, then
  fences the generation and finishes the same joined teardown. Overlapping
  starts stay fenced and non-sticky. The test's held job models slow
  cleanup and does not identify the customer device's specific slow owner.
  [Android timeout contract](https://developer.android.com/develop/background-work/services/fgs/timeout)
- **Locale:** A ContextWrapper callback that requests the outer context's
  resources during configuration context creation reproduces
  `StackOverflowError` on API 35. Reentrant calls now receive the base
  resources until the outer lookup publishes the fully resolved resources.
  The locale test verifies that subsequent calls still use the cached
  projection.
- **Navigation:** At Navigation Compose 2.8.0, popping the details route
  and delivering a predictive-back event in the same frame throws
  `IndexOutOfBoundsException: Index -1 out of bounds for length 1` at
  `NavHost.kt:518`. This matches the Play signature and AndroidX issue
  375343407. The repository test independently drives that sequence using
  a two-route Compose host. Navigation Compose moves to 2.8.5, the first
  released fix, within the existing minor series.
  [AndroidX 2.8.5 notes](https://developer.android.com/jetpack/androidx/releases/navigation#2.8.5)

The real quota case is opt-in. On an owned API 35 emulator, save the
`activity_manager` DeviceConfig values for
`data_sync_fgs_timeout_duration` and `fgs_crash_extra_wait_duration`,
set them to 5000 and 1000 respectively, and run
`ProductServiceTimeoutTest#realQuotaDeadlineReleasesForegroundWhileCleanupIsStillRunning`
with instrumentation argument `shortProductQuota=true`. Restore the
original values afterward. Default test runs leave device settings alone.

## Validation results

- All three targeted cases fail before the fixes with their corresponding
  Play crash signatures and pass afterward on the owned API 35 emulator.
- After unbinding the service in the quota fixture, it releases foreground
  status 4 ms after the callback and keeps ownership until cleanup completes
  about 1.9 seconds later. Android's crash grace is one second. The process
  survives, the platform override values are restored, and a subsequent
  visible launch reaches ready.
- Android debug lint, both debug APK builds and 228 JVM tests pass. The
  60-case API 35 instrumentation run covers language selection and activity
  recreation, predictive back and product navigation, foreground lifecycle,
  timeout and external activity intake. The opt-in quota test runs separately.
- The exact OEM user sequences and a signed release remain unverified.
