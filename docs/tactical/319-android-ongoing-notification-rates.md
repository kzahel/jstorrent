# Tactical 319: Android Ongoing Notification Rates

Status: Implemented on 2026-10-12; lint, JVM tests, the localization catalog
and the API 28/35 localization instrumentation class pass. A hands-on
device check of the live cadence is pending. No release is authorized by
this tactical.

## Trigger

The ongoing Android notification shown while JSTorrent downloads in the
background reads only `Downloading 2 torrents`. It shows neither download
nor upload speed, so a backgrounded download cannot be judged without opening
the app.

## Scope and stopping condition

Show session payload download and upload rates in the ongoing (foreground
service) notification, refreshed at most every two seconds, and make one
owner responsible for that notification's content. Stop after Android
compilation, lint, JVM tests, instrumentation packaging, the localization
catalog check and whitespace validation pass.

Non-goals: engine, session, subscription or generated-contract changes;
per-torrent rows, progress bars, percentages or ETA in the notification;
notification actions beyond the existing Stop; completion and attention
notifications; channel importance; the React UI; store publication.

## Existing behavior

- `ProductState.currentRates` is the session `SessionCurrentRates`
  subscription (500 ms delivery). `AndroidPresentationRepository` opens it
  with the torrent list and closes it only at service shutdown, so rates are
  current while the activity is backgrounded. The library status line already
  renders `PAYLOAD_RECEIVED`/`PAYLOAD_UPLOADED` through `status_rates`.
- `ProductEngineService.observePowerAndNotification` called
  `NotificationManager.notify` on every `ProductState` emission (torrent-list
  patches every 250 ms, rate patches every 500 ms, and all other state), even
  when the text was unchanged. Putting changing rates in that text would
  repost several times a second; Android sheds updates to an existing
  notification above roughly five per second per package.
- Data reset wrote its own `Clearing app data…` progress, `Ready` and
  `JSTorrent needs attention` text directly. The state collector did not
  consider data reset, so any concurrent state emission could replace the
  reset progress with ordinary status text.

## Decision

Content is a pure function of `ProductState`:
`productOngoingNotificationContent(product)` returns the existing status
message plus optional rates.

- A data reset in progress dominates: `Clearing app data… N of M torrents`
  while removing torrents, `Clearing app data…` in other phases, and
  `JSTorrent needs attention` when the reset records a failure. A completed
  reset falls through to ordinary status (`ready = true`, so `Ready`). The
  service's direct data-reset notification writes are removed.
- Rates are shown while downloading or seeding in the background, including
  a zero side. In the idle-ready and ChromeOS companion states they are shown
  only while either rate is nonzero. Opening, needs-attention,
  waiting-for-unmetered and data-reset states never show rates.
- Without rates the layout is unchanged: app name title, status text. With
  rates the status becomes the title and `↓ 1.2 MiB/s · ↑ 340 KiB/s` the
  text, reusing `status_rates` and `formatRate` so the notification matches
  the library status line.

Posting is gated by `ProductOngoingNotificationThrottle`, a pure
clock-injected policy:

- Identical content is never reposted.
- A status change, or rates appearing or disappearing, posts immediately.
- A change in rate values alone posts no sooner than two seconds after the
  previous post; the newest rates win, and the last change is still posted
  when rates stop changing.

The builder sets `setOnlyAlertOnce(true)` and `setShowWhen(false)`.

Screen-off suppression was considered and deferred. Skipping rate posts
while the display is off would need a screen-on receiver with its own
registration owner to avoid showing a stale rate when the screen returns,
and one notification post every two seconds is negligible next to the
transfer it describes.

## Owners, tasks and cancellation

`powerNotificationJob` remains the owner and now has two children: the
existing power-lock collector, unchanged, and a `collectLatest` notification
collector that owns the throttle. A newer state emission cancels a pending
delayed post; the throttle recomputes the remaining interval from the last
post, so cancellation does not starve updates. The job is cancelled and
joined at shutdown before `Finishing shutdown` is written, as before.

While the service is not in the foreground the collector posts nothing and
forgets the last post, so the first emission after `promoteForeground`
replaces the lifecycle text immediately. Initialization failure,
foreground promotion and shutdown keep their direct writes; each runs when
the collector is not running or is about to be replaced by the next
emission.

Dependency direction is unchanged: the content and throttle policies are
runtime-free and live beside the existing message policy in
`AndroidNotificationCoordinator.kt`; the service supplies the clock and the
coroutine.

## Validation

JVM tests cover content for each status, rate visibility for downloading,
background seeding, idle and active ready, and blocked states, data-reset
precedence and failure, and the throttle's immediate, coalesced, unchanged
and forgotten cases. Run Android debug build, JVM tests, lint,
instrumentation packaging, the localization catalog check and
`git diff --check`. Record actual outcomes below.

## Implementation and evidence

`AndroidNotificationCoordinator.kt` adds `ProductOngoingNotificationContent`,
`ProductOngoingNotificationRates`, `productOngoingNotificationContent`,
`ProductOngoingNotificationThrottle` and the two data-reset message kinds;
`ongoingNotification` and `updateOngoingNotification` take optional rate text.
`ProductEngineService.publishDataReset` and the reset completion and failure
paths no longer write the notification.

Known remaining edge: if persisting a data-reset failure itself fails, the
in-memory reset state keeps no failure, so the UI and now the notification
both continue to show the reset in progress. Changing that recovery path is
outside this tactical.

Passing commands (toolchain commands sourced `~/.profile`):

- `clients/android/gradlew -p clients/android assembleDebug testDebugUnitTest
  lintDebug assembleDebugAndroidTest`: debug and instrumentation packaging,
  148 JVM tests with zero failures/errors/skips (six in
  `ProductOngoingNotificationTest`), and lint pass. The working tree also
  carried Tactical `318`'s uncommitted changes; Rust is unchanged.
- `node scripts/check-localization.mjs`: all catalogs and locale policy pass;
  no resources were added.
- `python3 clients/android/scripts/run-localization-matrix.py --class
  org.rstorrent.bootstrap.LocalizationInstrumentationTest`, which now also
  asserts the rates layout: passes on freshly owned API 28 phone and API 35
  tablet AVDs, both removed by the runner.
- `git diff --check`: passes.

Not yet observed: the live two-second cadence during a real background
download on a device. The collector glue is not covered by a JVM test.
