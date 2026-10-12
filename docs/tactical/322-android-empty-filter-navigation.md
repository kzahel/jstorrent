# Tactical 322: Android Empty Filter Navigation

Status: Complete locally, 2026-10-12. Release delivery remains separate.

Topic: `client-surfaces`

## Scope and stopping condition

Replace the empty filtered library's passive hint with an accent-colored
`View all torrents` text button when All contains torrents. Select All,
clear selection and let the existing scrollable tab row reveal the tab.
When the entire library is empty, show `No torrents yet` and the existing
Add guidance even on a filtered tab. Keep the filter hint when only archived
torrents exist and All would be empty.

Dependencies: Tactical 316's filters and the existing Compose library.
Non-goals: engine, archive semantics, generated contracts, other clients,
device deployment and release delivery.

## Invariants, ownership and limits

- All continues to exclude archived torrents. Offer the button only when it
  leads to a populated view.
- Filter and selection remain local saveable Compose state; no engine
  commands, background tasks, dependencies or durable preferences are added.
- Use the standard Material text button and its touch target. The existing
  tab row owns the selected-tab scroll animation and its cancellation.
- Availability is a bounded scan of the existing torrent summary collection.

## Validation

Completed checks (shell profile sourced, local JDK 17):

- `./gradlew lintDebug testDebugUnitTest assembleDebugAndroidTest` in
  `clients/android`: lint, all 152 JVM cases and instrumentation packaging
  pass.
- `node scripts/check-localization.mjs`: all catalogs pass.
- `python3 clients/android/scripts/run-localization-matrix.py --api 35
  --class` with the three focused `ProductNavigationTest` methods:
  `emptyLibraryFiltersReturnToAllAndRevealItsTab`,
  `emptyLibraryShowsAddGuidanceOnFilteredTab` and
  `archiveOnlyLibraryDoesNotOfferAnEmptyAllView`: all three pass.
  The first exercises Active, Queued, Finished and Archived at 360 dp,
  tapping the action and checking that All is selected and visible with
  the torrent row. The owned headless AVD and its temporary log are removed.
- Documentation links and `git diff --check` pass.

Stopping condition met locally; no engine or generated types changed and
no production application was installed or published.
