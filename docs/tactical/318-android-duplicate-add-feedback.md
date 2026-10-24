# Tactical 318: Android Duplicate Add Feedback

Status: Committed 2026-10-13; lint, JVM tests and the localization catalog
pass. Installed on the Pixel 9; the hands-on check is pending. No release is
authorized by this tactical.

## Trigger

On Android, adding a debug test torrent that was already in the session as an
archived torrent produced no visible result. The test torrents also skipped
the add-time file selection dialog.

Cause:

- The debug test-torrent menu called `addMagnet(downloadAll = true)`, the
  quick-add path, which bypasses the `showFileSelection` setting. The React
  sample batch honors that setting.
- The engine matches an add by info hash and returns `AlreadyPresent` without
  changing the existing torrent, so an archived match stays archived and has
  no pending file selection to present.
- In-app adds (Add dialog magnet, Browse `.torrent`, test torrents) only
  logged the add disposition. Only external intake showed
  `Torrent already present.`, and an archived match is hidden from every
  library tab except Archived, so nothing changed on screen.

## Decision

- Test torrents follow the file selection setting like any other add. Users
  who want the quick path turn the setting off.
- Every in-app add reports a match already in the session once, as a
  snackbar. A batch reports one combined count.
- When any match is archived the snackbar says so and offers Restore, which
  restores the archived matches and resumes them if the add asked to start
  content. External intake uses the same archived notice; a visible duplicate
  keeps its existing external notice.
- The engine is unchanged: re-adding does not implicitly restore. Restore
  stays an explicit command so web and desktop semantics are not altered.

## Scope

- `ProductEngineService.addMagnets` adds magnets in order, isolates per-add
  failures and publishes one `AlreadyPresentNotice`. `addMagnet` delegates to
  it. `.torrent` adds publish the same notice.
- `ProductState.alreadyPresentNotice` carries the distinct match count, the
  archived match IDs and whether Restore resumes. The UI consumes it once so a
  recreated activity does not repeat it.
- New plurals `add_already_present_count` and `add_already_archived_count`.

Non-goals: engine, command or generated-contract changes; revealing or
scrolling to a visible duplicate; a combined summary of added and failed
items like the React sample batch; iOS.

## Validation

- `./gradlew lintDebug testDebugUnitTest`: lint clean, 143 JVM tests pass,
  including `alreadyPresentNoticeCountsDistinctMatchesAndKeepsArchivedOnes`.
- `node scripts/check-localization.mjs` passes.
- Pending: on a device, add the test torrents with file selection on and off,
  archive one, add it again, and use Restore.
- Pixel 9 review build: `org.rstorrent.bootstrap` on the device is signed by
  another machine's debug key and refused the update, so the build was
  installed side by side as `org.rstorrent.qualification253` (`JSTorrent QA`)
  over wireless debugging, as in Tactical `317`.

## Stopping condition

Stop when the checks above pass and the hands-on device check confirms the
file selection dialog, the combined notice and Restore.
