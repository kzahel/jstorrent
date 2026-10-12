# Tactical 317: Android Files Tab Rows And Multiselect

Status: Complete on 2026-10-12 after maintainer hands-on review on the
attached Pixel 9; committed and pushed at maintainer direction. The selection
rework that follows Tactical `316` is committed separately. No release is
authorized by this tactical.

## Scope and stopping condition

Replace the Android Compose Files tab's three-band rows with compact list
rows, make file priority an explicit three-way choice, and add multi-file
selection that follows the Library's existing selection mechanics. Stop after
Android compilation, lint, JVM tests, the localization catalog check and the
updated Compose navigation cases pass, and the debug build is installed on
the Pixel 9.

Non-goals: engine, session, command or generated-contract changes; folder
grouping or a tree view; sorting and filtering; changes to `Download now`,
play or open eligibility; the add-time selection dialog; the shared React
Files table; Trackers and Peers presentation; store publication.

## Observed problems

Captured on the Pixel 9 from a three-file completed torrent:

- Each file used three stacked bands (priority pill and name, full-width
  progress, right-aligned buttons), about 115dp per file.
- The button band held two or three buttons, so `Download now` started at a
  different horizontal position on video rows.
- The priority pill had no spacing or vertical alignment against the name and
  looked identical to `Open`, with no affordance that it opened a menu.
- `Download now` was drawn disabled on every completed file, and a full
  progress bar at 100% read as a divider.
- The summary printed the lowercased catalog state enum name.
- There was no way to change several files at once, although
  `SetFilePriority` and `DownloadFiles` already accept bounded index lists.

## Design

Row: file-type icon, file name with the parent directory on a dimmed line
when nested, one status line, at most one primary icon action, and an
overflow icon. The primary action is Play for a recognized video and Open for
any other completed file; an incomplete non-video file shows none. Progress
is a thin bar under the status line and only for an incomplete wanted file.
Normal priority shows nothing, High shows a primary-colored label, and a
skipped file is dimmed and labelled.

Actions sheet: tapping a row or its overflow opens a bottom sheet with a
Skip / Normal / High segmented control and Play (video only), Open and
`Download now` entries. Entries keep their existing eligibility rules and
remain present but disabled when ineligible. The sheet reads the live file
row, so a priority change is reflected without reopening it.

Selection follows the Library screen: long-press toggles a file and enters
selection mode, tap toggles while any file is selected, selected rows use the
primary container color and row actions are disabled. The first version used
a text-button bar with the count, `Select all` and `Done`, written against a
Library that had no select-all. Tactical `316` then gave the Library a
selection top bar and an icon bottom bar, so the Files selection was reworked
to use those same components: the torrent detail screen owns the file
selection, its app bar is replaced by the shared selection top bar (close,
selected count, and one toggle that selects every file and then offers to
deselect them all), and a bottom bar of labeled icon actions offers Skip,
Normal, High and `Download now`. Back clears the selection, and leaving the
Files tab clears it as changing Library tabs does. Rows show no checkbox,
matching torrent cards.

Summary: one line with the file count, the skipped count when nonzero, and a
localized state only when the catalog is not available.

## Invariants, ownership and bounds

Compose owns transient selection and sheet state; the engine remains the only
owner of durable priority and run intent. Selection is keyed by file id and
scoped to the presented catalog page. `Select all` selects the rows of that
page, and changing page clears the selection. A page holds at most
`MAX_CATALOG_PAGE_ROWS` (1024) rows, below the 4096-entry command bound, so
one batch action is one bounded command. Files without a selection value and
padding files are never command targets. Batch `Download now` targets only
selected files that are wanted and incomplete, matching the single-file rule.
No new tasks, channels or persistent state.

Rebased onto Tactical `316`, which landed first: an archived torrent shows
its restore hint under the summary and offers no `Download now`, in the sheet
or the selection bar. Priority changes stay available, as before.

## References and validation

Protocol and libtorrent study are inapplicable to this Android-only
presentation change. Tactical `176` owns High/Normal/Skip, `110` owns
`Download now`, and `085` records that Android intentionally lacked the
desktop multi-file presentation. No reference source or fixtures are
imported.

Update the two existing Files navigation cases for the new action placement
and add cases for the priority sheet and for multiselect batch commands. Run
Android debug build, JVM tests, lint, instrumentation packaging, the
localization catalog check and whitespace validation. Record actual outcomes
below.

## Implementation and evidence

`ui/FilesScreen.kt` now owns the Files tab; `ProductDetailScreens.kt` keeps
Trackers, Peers and the shared catalog pager. `ProductEngineService`
`setFilePriority` and `downloadFilesNow` take index lists and ignore an empty
list, so a batch is one `SetFilePriority` or `DownloadFiles` command. The
orphaned `catalog_showing` resource is removed.

Two details changed after seeing the build on the device: the priority label
is shown only on incomplete files, where it still affects scheduling, and the
primary-action slot is reserved when empty so names and progress bars align.

Passing commands (toolchain commands sourced `~/.profile`):

- `clients/android/gradlew -p clients/android assembleDebug testDebugUnitTest
  lintDebug assembleDebugAndroidTest`: debug and instrumentation packaging,
  136 JVM tests with zero failures/errors/skips, and lint pass. Existing
  generated Kotlin/native libraries were reused; Rust is unchanged.
- `node scripts/check-localization.mjs`: all four catalogs and locale policy
  pass; Android has 479 English resources.
- `python3 clients/android/scripts/run-localization-matrix.py --class` with
  the two updated and two new `ProductNavigationTest` Files cases
  (`streamableVideoExposesPlayButKeepsCompletedOpenDisabled`,
  `completedVideoRetainsOpenAndPendingLaunchDisablesPlay`,
  `filePrioritySheetOffersThreeExplicitChoices`,
  `fileMultiselectFollowsLibraryMechanicsAndBatchesCommands`): four cases each
  pass on freshly owned API 28 phone and API 35 tablet AVDs, both removed by
  the runner.
- `git diff --check`: passes.

Maintainer review on the Pixel 9 found the Files tab stuck on its loading
state after opening a completed file externally and returning. With no
qualifying work the service stops while the viewer is in front
(`stop_notification_ineligible`); the returning activity binds a new service
whose presentation repository was never told which torrent or tab is showing,
because the detail route selected the torrent once per torrent id and
presented a tab only on page change. The detail route now selects the torrent
and presents the current tab again whenever the bound service changes, and
clears through the current service on dispose. This predates this tactical
and affected every detail tab. Reproduced and confirmed fixed on the review
install: open `poster.jpg` in Photos, observe service shutdown and restart in
the product log, return, and the three file rows are presented. The same
review asked for the loading state to be top-aligned; detail pager pages are
now top-aligned like the populated tabs. After this change the Gradle
build/JVM/lint command above passes again with 136 JVM tests, and the four
Files cases plus `liveTorrentReachesAllDetailAndGlobalRoutes` pass on freshly
owned API 28 and API 35 AVDs.

That shutdown also logged `product_shutdown_complete ... cleanup_failed=true`
from an engine-side `UPnP mapping cleanup suppressed by application network
prerequisite` error. It is unrelated to presentation and is left for its
owning topic.

After rebasing onto Tactical `316` and the later remote Android fixes, the
full `clients/android/build.sh` native build and the Gradle JVM/lint command
pass with 142 JVM tests, and the same five navigation cases pass again on
freshly owned API 28 and API 35 AVDs. That rebase needed
two repairs to the remote state, committed separately: four instrumentation
test files still called the single-argument `setActivityVisible`, and the
unused `speed_transfer` resource failed the localization catalog check.

Selection rework: `SelectionTopBar` and `SelectionBarButton` in
`LibraryScreen.kt` are now shared rather than private, `FilesScreen` takes the
caller-owned selection, and `FileSelectionBottomBar` owns batch eligibility.
The Gradle build/JVM/lint command passes with 142 JVM tests and the
localization catalog check passes. The component-level multiselect case is
replaced by `fileSelectionReplacesDetailBarWithLibrarySelectionMechanics`,
which drives the real detail screen, and
`fileSelectionBarBatchesCommandsForEligibleFiles`; with the three other Files
cases and `liveTorrentReachesAllDetailAndGlobalRoutes`, six cases pass on
freshly owned API 28 and API 35 AVDs. On the Pixel 9 review install,
long-press showed the selection top bar and icon bottom bar, the toggle
selected all three files and changed to Deselect all, and Back cleared the
selection while staying on the detail screen.

Pixel 9 review build: the existing `org.rstorrent.bootstrap` install is a
debug build signed by a different machine's debug key, so an in-place update
was refused (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`) and that install was left
untouched. The build was instead installed side by side under the existing
debug-only `org.rstorrent.qualification253` identity, with usage statistics
declined, a new empty `Download/FilesTabTest` folder granted, and one public
Big Buck Bunny magnet added and paused part-way. On that install a sheet
priority change, the skipped summary, long-press selection, a two-file batch
High and `Done` were exercised by hand. This is an informal presentation
check, not physical qualification evidence; the review install, its folder
and its torrent are disposable.
