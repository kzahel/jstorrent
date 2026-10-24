# Tactical 374: Android Transfer Status Presentation

Status: Implemented and installed on the physical Pixel, 2026-10-16.
Controlled presentation validation passes; physical visual reinspection is
evidence-limited because the user returned to another application.

Topic: `client-surfaces`

## Trigger, scope and stopping condition

Physical Android screenshots show completed seeds with download speed and ETA,
a metadata-only Sintel add as `Starting · Queue 1`, and its ongoing notification
as `Ready`. Repair these presentation decisions and diagnose the existing
Sintel add without changing its durable state.

Completed cards show uploaded payload total and share ratio from the existing
torrent lifetime view. Metadata acquisition uses its existing activity label;
only actually queued torrents show a queue position. Ongoing notifications use
the existing operational work classifier, covering metadata acquisition,
starting, checking and foreground seeding as well as downloading.

Stop after Android JVM tests, lint, APK/instrumentation packaging, localization
validation, controlled notification/card evidence and a data-preserving Pixel
development-app update. Attempt physical notification/card reinspection when
the device remains available for that observation; record any evidence limit.
No production publication is authorized.

Non-goals: engine/discovery changes, HTTP metadata or webseed implementation,
new application fields/subscriptions, per-torrent upload-speed telemetry,
replacing user torrents, protocol-support claims and public-swarm experiments.

## Ownership, invariants and limits

Read `client-surfaces`, `web-ui-design`, `application-view-api`, Tactical 319
and the engine investigation/live-evidence guides. Existing Compose cards own
their rendering; the notification's pure message policy owns its text and the
existing service collector/throttle owns posting and cancellation. Use the
same bounded torrent collection and lifetime classifier already used by the
lifecycle policy. No new task, timer, dependency, durable field or subscription.

Keep reset/error/network precedence and notification throttling. Do not infer
upload speed from cumulative bytes or present metadata acquisition as a queue
hold. Preserve all installed torrents, settings, grants and payloads on update.

## Sintel investigation

The installed development app reports `AWAITING_METADATA`, available storage,
`ACQUIRING_METADATA`, zero verified pieces and a UDP tracker connect timeout.
This is before payload transfer. Its debug shortcut is a magnet assembled in
`ui/TestTorrents.kt`. The protocol magnet parser recognizes identities, names,
length, peer hints, trackers and file selection, but not `xs` or `ws`; no HTTP
metadata or webseed fallback is implemented for those parameters.

A bounded HTTP request to the shortcut's public WebTorrent `.torrent` URL
returns 200 and 20,792 bytes. Independently hashing the verbatim info dictionary
matches the shortcut's expected v1 identity. Thus the metadata URL and identity
are valid; this build is relying on native peer metadata instead of using that
URL. This observation does not establish why every individual peer attempt
fails, that the swarm has no seeds, or that payload download would succeed
after supplying metainfo. Engine support for those magnet parameters needs a
separate source-first tactical; this slice only fixes misleading presentation.

## Validation

Completed with `scripts/dev-env.sh` sourced for toolchain commands:

- `clients/android/gradlew -p clients/android testDebugUnitTest lintDebug
  assembleDebug assembleDebugAndroidTest`: all 208 JVM cases, lint and both
  APK packages pass. Two regressions cover metadata with completed seeds,
  foreground seeding, ordinary starting/checking and archived exclusion.
- `python3 clients/android/scripts/run-localization-matrix.py --api 35
  --class
  org.rstorrent.bootstrap.ProductNavigationTest#libraryCompletedSeedAndMetadataRowsShowRelevantProgress`:
  the owned Android 15 ARM64 emulator proves uploaded total/ratio without
  download speed/ETA for a complete seed, a non-idle seeding header, and
  explicit metadata labels without a false queue hold. The first attempt
  failed because the new test left storage startup enabled and did not scroll
  its card into view; correcting those fixture assumptions passes. The runner
  removes its emulator and AVD after both attempts.
- `node scripts/check-localization.mjs` and `git diff --check`: pass.
- Machine Control's explicit handheld adapter installs with replace semantics
  under the matching local debug key. No uninstall, data clear or grant reset.
  A temporary read-only copy of the stopped session database retains all five
  torrents and passes SQLite `quick_check`; the copy is removed immediately.

The Pixel returned to another application during the post-update visual
attempt. With default background admission, its service joined idle shutdown;
no final physical notification/card frame was verified. Controlled UI and
message-policy results above are the presentation evidence. The temporary
capture is removed. An idle-shutdown warning reports suppressed UPnP mapping
cleanup; that existing runtime cleanup behavior is outside this Kotlin-only
presentation slice and is not repaired or qualified here.

No Rust, application contract, persistence schema or peer behavior changed.
The Sintel peer-metadata stall remains diagnosed, not repaired by these UI
changes. No production build or release was published.
