# Tactical 328: Android Add Before Download Folder

Status: Complete 2026-10-13. Lint, JVM tests, the instrumentation build and
the localization catalog pass; the flow was exercised on the Pixel 9. No
release is authorized by this tactical.

## Trigger

On Android, adding a torrent before choosing a download folder only showed
`Select a download folder first.` The Add dialog also disabled Browse,
Download all and Choose files until a folder was ready. The user had to pick
a folder and then find and add the torrent again. The debug test-torrent menu
reached the same rejection through `addMagnets`.

External intake (Tactical `197`) already held an item in `AWAITING_ROOT`,
offered Select or Repair folder, and returned to the Add torrent confirmation
once the folder became ready.

## Decision

- In-app adds made without a usable folder are held in the existing intake
  queue instead of rejected. One queue keeps the bounds, ordering,
  coalescing, cancellation and root-ready transitions of Tactical `197`.
- While no folder is ready the intake dialog is a call to action: the body
  explains that downloads are saved to the chosen folder, the primary button
  is `Select folder` (or `Repair folder` for an unavailable folder), and
  `Cancel` drops the item. It no longer shows a disabled `Download all` or
  `Download folder: Download folder`.
- After the folder is chosen a held in-app add submits on its own with the
  choice it was made with (Download all, Choose files, or the file selection
  setting for test torrents and Browse), so the user sees exactly what the
  same add shows with a folder ready, such as file selection. A first version
  returned to the external Add torrent confirmation instead; on the device
  that read as a different dialog from an ordinary add and was replaced.
- A held add reports like other in-app adds: no `Torrent added.` snackbar,
  and a match already in the session uses the Tactical `318` notice.
- External items keep their explicit confirmation after a folder is chosen.
- The Add dialog no longer requires a ready folder, only a ready engine.

## Scope

- `ProductEngineService.holdForStorageRoot` admits magnets and in-app picked
  `.torrent` URIs as `heldInApp` records carrying `awaitFileSelection`.
  `ExternalIntakeController.takeHeldSubmission` starts the current held
  record once the root is ready; the service calls it after admission,
  metadata admission, root changes, cancellation and each submission, so a
  batch submits in order. A held record being submitted is not presented.
  A picked document goes through the existing metadata admission with
  `pickedInApp` eligibility so its display name is shown in the folder
  dialog; the metainfo parser still decides validity.
- Adds that cannot be represented by an intake record keep the existing
  rejection: `startContent = false`, explicit `skipFiles`, debug byte adds,
  and sources over the 16 KiB intake limit.
- The intake log records `awaiting_root` instead of `presented ready` for a
  magnet admitted without a folder.
- Strings: `intake_folder_required` reworded, `intake_folder_repair_required`
  added, unused `add_folder_required` removed.

Non-goals: a magnet display name (Kotlin does not parse BEP fields, per
Tactical `197`); persisting held adds across process death; engine, command
or generated-contract changes; web, desktop and iOS.

## Validation

- `./gradlew lintDebug testDebugUnitTest assembleDebugAndroidTest` passes,
  including `heldInAppAddSubmitsWithItsChoiceOnceTheRootIsReady`.
  `ProductNavigationTest.externalTorrentWaitsForRootAndOffersCancel` now
  asserts the call-to-action text and the absence of Download all; it was
  compiled, not run, because no owned emulator was available.
- `node scripts/check-localization.mjs` passes.
- Pixel 9 (`org.rstorrent.bootstrap`, empty root registry): the Add dialog
  enabled Browse without a folder; `Add test: Big Buck Bunny` opened the
  folder dialog (`external_intake ... phase=awaiting_root`); Select folder →
  system picker → Allow submitted it without another prompt
  (`phase=success disposition=added`) and opened Big Buck Bunny file
  selection with `Download folder: Jstorrent`.

## Stopping condition

Stop when in-app adds without a folder reach the folder dialog, a chosen
folder continues them as an ordinary add, and the checks above pass.
