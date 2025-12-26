# Android Native MVP Implementation Plan

**Goal:** Build a production-ready Android native app (Compose + Kotlin + JNI + QuickJS) with comprehensive test coverage from the start.

**Reference:** `docs/research/flud-ui-catalog.md` for UI patterns

## Current State

The Android standalone app is **functionally complete** but has **minimal UI**:

| Working | Missing |
|---------|---------|
| QuickJS engine + JNI | Torrent detail screens |
| All native bindings (TCP/UDP/File) | Proper torrent card design |
| EngineService + EngineController | Settings UI |
| Basic NativeStandaloneActivity | Notifications |
| SAF folder picker | Sort/filter |
| Session persistence | Polish/theming |
| Background service | |

## Testing Strategy

### Three-Layer Testing Pyramid

```
        ┌─────────────────────┐
        │   E2E/Integration   │  ← Emulator + Seeder
        │   (slow, thorough)  │
        ├─────────────────────┤
        │  Component/Screen   │  ← Compose Preview Tests
        │   (medium speed)    │
        ├─────────────────────┤
        │     Unit Tests      │  ← ViewModels, formatters
        │   (fast, isolated)  │
        └─────────────────────┘
```

### Testing Infrastructure to Leverage

1. **Python Seeder** (`packages/engine/integration/python/seed_for_test.py`)
   - Deterministic data with known info hashes
   - Full BitTorrent protocol via libtorrent
   - Use for E2E tests on emulator

2. **MockSeeder** (`android/app/src/test/java/.../benchmark/MockSeeder.kt`)
   - Simple TCP data blaster
   - Use for throughput/unit tests

3. **Compose Testing**
   - `createComposeRule()` for isolated component tests
   - Screenshot tests for visual regression

---

## Phase 1: Foundation (Testing + Architecture)

### 1.1 ViewModel Layer + State Management

**Scope:** Extract business logic from Activity into testable ViewModels

**Files to create:**
- `app/src/main/java/com/jstorrent/app/viewmodel/TorrentListViewModel.kt`
- `app/src/main/java/com/jstorrent/app/viewmodel/TorrentDetailViewModel.kt`
- `app/src/main/java/com/jstorrent/app/model/UiState.kt`

**Tests:**
```
Unit Tests (JVM):
├── TorrentListViewModelTest.kt
│   ├── test_initialStateIsLoading
│   ├── test_torrentsEmittedWhenEngineLoaded
│   ├── test_pauseTorrentUpdatesState
│   ├── test_removeTorrentRemovesFromList
│   └── test_filterByStatus
│
└── TorrentDetailViewModelTest.kt
    ├── test_loadsTorrentById
    ├── test_fileListUpdates
    ├── test_peerListUpdates
    └── test_toggleFileSelection
```

**Verification:** All tests pass with `./gradlew :app:test`

---

### 1.2 UI Component Library (Stateless Composables)

**Scope:** Reusable, stateless UI components matching Flud design

**Files to create:**
```
app/src/main/java/com/jstorrent/app/ui/components/
├── TorrentCard.kt           # Card with progress, speed, status
├── ProgressBar.kt           # Thin teal progress bar
├── SpeedIndicator.kt        # "1.2 MB/s ↓"
├── StatRow.kt               # Label + value pair
├── StatusBadge.kt           # "Downloading", "Paused", etc.
└── PlayPauseButton.kt       # Circular teal button
```

**Tests:**
```
Compose Tests (Instrumented):
└── ComponentsTest.kt
    ├── torrentCard_showsCorrectProgress
    ├── torrentCard_pausedState
    ├── torrentCard_downloadingState
    ├── speedIndicator_formatsCorrectly
    ├── statusBadge_colorsMatchState
    └── playPauseButton_togglesIcon
```

**Preview Tests:**
```
Each component has @Preview functions that can be screenshot-tested
```

**Verification:** `./gradlew :app:connectedAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=com.jstorrent.app.ui.components.ComponentsTest`

---

### 1.3 Formatting Utilities

**Scope:** Pure functions for formatting bytes, speed, time, etc.

**Files to create:**
- `app/src/main/java/com/jstorrent/app/util/Formatters.kt`

**Functions:**
```kotlin
fun formatBytes(bytes: Long): String        // "1.5 GB"
fun formatSpeed(bytesPerSec: Long): String  // "1.2 MB/s"
fun formatEta(seconds: Long): String        // "2h 30m" or "∞"
fun formatRatio(ratio: Double): String      // "1.234"
fun formatPercent(fraction: Double): String // "45%"
fun formatDate(epochMs: Long): String       // "12/25 5:20 PM"
```

**Tests:**
```
Unit Tests (JVM):
└── FormattersTest.kt
    ├── formatBytes_zero
    ├── formatBytes_bytes
    ├── formatBytes_kilobytes
    ├── formatBytes_megabytes
    ├── formatBytes_gigabytes
    ├── formatBytes_terabytes
    ├── formatSpeed_zero_showsZero
    ├── formatSpeed_bytesPerSec
    ├── formatEta_infinity
    ├── formatEta_seconds
    ├── formatEta_minutes
    ├── formatEta_hours
    ├── formatEta_days
    └── formatRatio_precision
```

**Verification:** `./gradlew :app:test --tests "*FormattersTest*"`

---

## Phase 2: Main Screen (Torrent List)

### 2.1 Torrent List Screen - Basic Layout

**Scope:** Replace minimal list with proper TorrentCard layout

**Files to modify:**
- `app/src/main/java/com/jstorrent/app/NativeStandaloneActivity.kt`

**Files to create:**
- `app/src/main/java/com/jstorrent/app/ui/screens/TorrentListScreen.kt`

**UI Elements:**
- TopAppBar with app name, search icon, overflow menu
- LazyColumn with TorrentCard items
- FAB for "Add torrent"
- Empty state when no torrents

**Tests:**
```
Compose Tests:
└── TorrentListScreenTest.kt
    ├── emptyState_showsMessage
    ├── torrentList_showsAllTorrents
    ├── torrentCard_tapNavigatesToDetail
    ├── fab_showsAddDialog
    └── searchIcon_filtersResults
```

**Verification:** Manual + automated compose tests

---

### 2.2 Add Torrent Dialog

**Scope:** Bottom sheet for adding magnet links

**Files to create:**
- `app/src/main/java/com/jstorrent/app/ui/dialogs/AddTorrentDialog.kt`

**UI Elements:**
- Text field for magnet link
- "Add" button
- Optional: paste from clipboard button

**Tests:**
```
Compose Tests:
└── AddTorrentDialogTest.kt
    ├── emptyInput_addButtonDisabled
    ├── validMagnet_addButtonEnabled
    ├── addButton_callsViewModel
    └── dismiss_closesDialog
```

**E2E Integration Test:**
```
AndroidTest:
└── AddTorrentE2ETest.kt
    ├── addMagnet_torrentAppearsInList
    └── addMagnet_connectsToSeeder
```

**Verification:** E2E test with local seeder (`seed_for_test.py`)

---

### 2.3 Pause/Resume Controls

**Scope:** Play/pause button on torrent cards + global pause/resume

**Modifications:**
- TorrentCard play/pause button wired to ViewModel
- Overflow menu with "Pause all" / "Resume all"

**Tests:**
```
Unit Tests:
└── TorrentListViewModelTest.kt
    ├── pauseTorrent_updatesState
    ├── resumeTorrent_updatesState
    ├── pauseAll_pausesAllTorrents
    └── resumeAll_resumesAllTorrents

E2E Tests:
└── PauseResumeE2ETest.kt
    ├── pauseTorrent_stopsDownload
    └── resumeTorrent_continuesDownload
```

**Verification:** E2E test showing download speed drops to 0 when paused

---

### 2.4 Tab Bar (ALL | QUEUED | FINISHED)

**Scope:** Filter tabs like Flud

**Files to modify:**
- `TorrentListScreen.kt`
- `TorrentListViewModel.kt`

**Tests:**
```
Unit Tests:
└── TorrentListViewModelTest.kt
    ├── filterAll_showsAllTorrents
    ├── filterQueued_showsOnlyActive
    └── filterFinished_showsOnlyCompleted
```

**Verification:** Unit tests pass

---

## Phase 3: Torrent Detail Screen

### 3.1 Detail Screen Shell + Navigation

**Scope:** Scaffold with tabs, navigation from list

**Files to create:**
- `app/src/main/java/com/jstorrent/app/ui/screens/TorrentDetailScreen.kt`
- `app/src/main/java/com/jstorrent/app/ui/navigation/Navigation.kt`

**UI Elements:**
- TopAppBar with back button, torrent name, play/pause, overflow
- TabRow: STATUS | FILES | TRACKERS | PEERS | PIECES
- HorizontalPager for tab content

**Tests:**
```
Compose Tests:
└── TorrentDetailScreenTest.kt
    ├── backButton_navigatesBack
    ├── tabs_switchContent
    ├── playPause_togglesState
    └── overflowMenu_showsOptions
```

**Verification:** Compose tests + manual navigation check

---

### 3.2 Status Tab

**Scope:** Display download stats (matching Flud STATUS tab)

**Files to create:**
- `app/src/main/java/com/jstorrent/app/ui/tabs/StatusTab.kt`

**UI Elements (from Flud catalog):**
| Field | Example |
|-------|---------|
| Progress bar | Full width, teal |
| Status badge | "Downloading" / "Paused" |
| Progress % | "45%" |
| Download speed | "1.2 MB/s ↓" |
| Upload speed | "256 KB/s ↑" |
| Downloaded | "500 MB / 2.0 GB" |
| ETA | "30m" |
| Seeders | "5 (1,341)" |
| Leechers | "2 (31)" |
| Uploaded | "100 MB" |
| Share ratio | "0.05" |
| Pieces | "500/8,152 (256 KB)" |

**Tests:**
```
Unit Tests:
└── StatusTabViewModelTest.kt
    ├── loadsStats_fromEngine
    ├── updatesStats_onInterval
    └── formatsStats_correctly

Compose Tests:
└── StatusTabTest.kt
    ├── allFieldsDisplayed
    ├── progressBar_matchesPercent
    └── etaInfinity_showsSymbol
```

**E2E Tests:**
```
└── StatusTabE2ETest.kt
    └── activeDownload_showsLiveStats
```

**Verification:** E2E with seeder showing real stats updating

---

### 3.3 Files Tab

**Scope:** File list with selection checkboxes

**Files to create:**
- `app/src/main/java/com/jstorrent/app/ui/tabs/FilesTab.kt`
- `app/src/main/java/com/jstorrent/app/ui/components/FileTreeItem.kt`

**UI Elements:**
- File icon
- File name
- Progress bar per file
- Size + status ("500 MB / 1 GB • Downloading")
- Checkbox for selection

**Tests:**
```
Unit Tests:
└── FilesTabViewModelTest.kt
    ├── loadsFileList
    ├── toggleFile_updatesSelection
    └── multiSelect_selectsRange

Compose Tests:
└── FilesTabTest.kt
    ├── filesDisplayed
    ├── checkbox_togglesSelection
    ├── progressBar_showsFileProgress
    └── filter_showsFinishedOnly
```

**Verification:** Unit tests + manual verification of file skipping

---

### 3.4 Trackers Tab

**Scope:** List of trackers with status

**Files to create:**
- `app/src/main/java/com/jstorrent/app/ui/tabs/TrackersTab.kt`

**UI Elements:**
- DHT/LSD/PeX status (with OK/Error badges)
- Tracker URLs with status
- "+ Add trackers" button

**Tests:**
```
Compose Tests:
└── TrackersTabTest.kt
    ├── dhtEnabled_showsOk
    ├── trackerError_showsRed
    └── addTracker_showsDialog
```

**Verification:** Compose tests

---

### 3.5 Peers Tab

**Scope:** List of connected peers

**Files to create:**
- `app/src/main/java/com/jstorrent/app/ui/tabs/PeersTab.kt`
- `app/src/main/java/com/jstorrent/app/ui/components/PeerItem.kt`

**UI Elements:**
- Empty state: "No peers connected"
- Peer row: IP:port, client, download/upload speed, progress, flags

**Tests:**
```
E2E Tests:
└── PeersTabE2ETest.kt
    ├── noPeers_showsEmptyState
    └── connectedPeer_showsInList
```

**Verification:** E2E with seeder, verify peer appears in list

---

### 3.6 Pieces Tab

**Scope:** Visual piece map

**Files to create:**
- `app/src/main/java/com/jstorrent/app/ui/tabs/PiecesTab.kt`
- `app/src/main/java/com/jstorrent/app/ui/components/PieceMap.kt`

**UI Elements:**
- Pieces count: "500/8,152"
- Piece size: "256 KB"
- Visual grid (teal = complete, empty = missing)

**Tests:**
```
Compose Tests:
└── PiecesTabTest.kt
    ├── pieceCount_correct
    ├── pieceMap_showsProgress
    └── completedTorrent_allTeal
```

**Verification:** Compose tests + visual verification

---

## Phase 4: Settings & Polish

### 4.1 Settings Screen - Storage

**Scope:** Basic settings (download folder)

**Files to create:**
- `app/src/main/java/com/jstorrent/app/ui/screens/SettingsScreen.kt`

**Settings (MVP):**
- Storage path (SAF picker - already exists)
- Clear all settings button

**Tests:**
```
Compose Tests:
└── SettingsScreenTest.kt
    ├── storagePath_showsCurrentRoot
    ├── changeFolder_opensPicker
    └── clearSettings_showsConfirmation
```

**Verification:** Compose tests + manual SAF picker flow

---

### 4.2 Notifications

**Scope:** Download complete notification

**Files to create:**
- `app/src/main/java/com/jstorrent/app/notification/TorrentNotificationManager.kt`

**Notifications:**
- Foreground service notification (already exists)
- Download complete notification
- Permission handling (Android 13+)

**Tests:**
```
Unit Tests:
└── TorrentNotificationManagerTest.kt
    ├── downloadComplete_createsNotification
    └── notificationPermission_requested
```

**Verification:** Unit tests + manual notification check

---

### 4.3 Sort & Filter

**Scope:** Sort torrents by various criteria

**Modifications:**
- TorrentListScreen: Sort icon in toolbar
- TorrentListViewModel: Sort state + comparators

**Sort Options (from Flud):**
- Queue order (default)
- Name
- Date added
- Download speed
- ETA

**Tests:**
```
Unit Tests:
└── TorrentListViewModelTest.kt
    ├── sortByName_alphabetical
    ├── sortByDate_newestFirst
    ├── sortBySpeed_fastestFirst
    └── sortByEta_shortestFirst
```

**Verification:** Unit tests

---

### 4.4 Remove Torrent

**Scope:** Delete torrent with confirmation

**UI Elements:**
- Context menu / overflow menu
- Confirmation dialog
- Option: Delete files

**Tests:**
```
Compose Tests:
└── RemoveTorrentDialogTest.kt
    ├── showsConfirmation
    ├── deleteFiles_checkbox
    └── confirm_removesTorrent

E2E Tests:
└── RemoveTorrentE2ETest.kt
    └── removeTorrent_deletesFiles
```

**Verification:** E2E test confirms files removed from filesystem

---

## Phase 5: E2E Test Infrastructure

### 5.1 Android Test Harness

**Scope:** Setup for emulator-based E2E tests with external seeder

**Files to create:**
```
android/app/src/androidTest/java/com/jstorrent/app/e2e/
├── E2ETestConfig.kt         # Seeder IP/port configuration
├── SeederClient.kt          # HTTP client to control Python seeder
├── E2EBaseTest.kt           # Base class with setup/teardown
└── TestMagnets.kt           # Known test magnet links
```

**Test Infrastructure:**
```kotlin
@Before
fun setup() {
    // Start Python seeder on host machine
    // Configure ADB port forwarding
    // Wait for engine to be ready
}

@After
fun teardown() {
    // Stop seeder
    // Clear test data
}
```

**Verification:** One passing E2E test that downloads from seeder

---

### 5.2 CI/CD Integration

**Scope:** GitHub Actions workflow for Android tests

**Files to create:**
- `.github/workflows/android-tests.yml`

**Steps:**
1. Start Android emulator
2. Start Python seeder on host
3. Setup ADB port forwarding
4. Run instrumented tests
5. Collect test results + screenshots

**Verification:** Green CI build

---

## Implementation Order

Recommended order for incremental, testable progress:

| Week | Phase | Deliverable | Tests |
|------|-------|-------------|-------|
| 1 | 1.1-1.3 | ViewModels + Formatters + Components | Unit tests pass |
| 2 | 2.1-2.2 | Torrent list screen + Add dialog | Compose + E2E |
| 3 | 2.3-2.4 | Pause/Resume + Tabs | Unit + E2E |
| 4 | 3.1-3.2 | Detail shell + Status tab | Compose + E2E |
| 5 | 3.3-3.4 | Files + Trackers tabs | Compose |
| 6 | 3.5-3.6 | Peers + Pieces tabs | Compose + E2E |
| 7 | 4.1-4.2 | Settings + Notifications | Unit + manual |
| 8 | 4.3-4.4 | Sort/Filter + Remove | Unit + E2E |
| 9 | 5.1-5.2 | E2E harness + CI | CI green |

---

## Test Commands

```bash
# Unit tests (fast, JVM)
./gradlew :app:test

# Specific test class
./gradlew :app:test --tests "*FormattersTest*"

# Compose/Instrumented tests (requires device/emulator)
./gradlew :app:connectedAndroidTest

# Specific instrumented test
./gradlew :app:connectedAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.class=com.jstorrent.app.e2e.DownloadE2ETest

# Full test suite
./gradlew test connectedAndroidTest
```

---

## Known Deterministic Test Data

For E2E tests, use the Python seeder:

```bash
# Start seeder on dev machine
cd packages/engine/integration/python
uv run python seed_for_test.py --size 100mb --quiet

# Known info hashes:
# 100MB: 67d01ece1b99c49c257baada0f760b770a7530b9
# 1GB:   18a7aacab6d2bc518e336921ccd4b6cc32a9624b
```

For emulator, use `10.0.2.2` (host loopback) or configure ADB reverse port forwarding.

---

## Success Criteria

MVP is complete when:

1. **Functional:**
   - [ ] Add torrent via magnet link
   - [ ] Download completes successfully
   - [ ] Pause/Resume works
   - [ ] Session persists across app restart
   - [ ] Detail screen shows live stats
   - [ ] File selection works
   - [ ] Remove torrent works

2. **Quality:**
   - [ ] All unit tests pass
   - [ ] All compose tests pass
   - [ ] E2E download test passes
   - [ ] No crashes in 10 typical usage sessions
   - [ ] Performance: 60fps scrolling in torrent list

3. **Test Coverage:**
   - [ ] ViewModel layer: 90%+ coverage
   - [ ] Formatters: 100% coverage
   - [ ] UI components: Screenshot tests for all
   - [ ] E2E: Download + pause/resume + remove flows
