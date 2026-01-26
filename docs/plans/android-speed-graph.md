# Android Speed Graph Implementation Plan

## Overview

Add a speed history graph to the Android native standalone app, showing download/upload speeds over the last 1-30 minutes. This is useful for debugging what happened while the screen was off (e.g., when the app goes to sleep).

The extension already has this feature using uPlot with an RRD (Round Robin Database) backend. For Android, we'll:
- Reuse the existing JS RRD data collection (already running in QuickJS)
- Add a query API to fetch speed samples from JS
- Build a native Compose Canvas chart component (no WebView)

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    SpeedHistoryScreen                        │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              SpeedChart (Compose Canvas)             │    │
│  │  - Two filled area series (download/upload)          │    │
│  │  - Time axis with relative labels (-30s, -1m, etc)   │    │
│  │  - Auto-scaling Y-axis with speed labels             │    │
│  └─────────────────────────────────────────────────────┘    │
│  ┌─────────────────┐  ┌─────────────────────────────────┐   │
│  │ Time Window     │  │ Current Rates Display           │   │
│  │ [1m] [10m] [30m]│  │ ↓ 1.5 MB/s  ↑ 256 KB/s          │   │
│  └─────────────────┘  └─────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ Poll every 1-2s while visible
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    SpeedHistoryViewModel                     │
│  - Calls repository.getSpeedSamples(from, to, maxPoints)    │
│  - Manages time window state                                 │
│  - Exposes StateFlow<SpeedHistoryUiState>                   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    TorrentRepository                         │
│  - getSpeedSamplesAsync(direction, from, to, maxPoints)     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    EngineController                          │
│  - getSpeedSamplesAsync(direction, categories, from, to)    │
│  - Calls __jstorrent_query_speed_samples                    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              QuickJS Engine (controller.ts)                  │
│  __jstorrent_query_speed_samples(direction, categories,     │
│                                   fromTime, toTime, maxPts) │
│  - Calls bandwidth.getSamplesWithMeta(...)                  │
│  - Returns JSON with samples, bucketMs, latestBucketTime    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  RrdHistory (already exists)                 │
│  - Tier 0: 100ms × 300 = 30 sec                             │
│  - Tier 1: 500ms × 240 = 2 min                              │
│  - Tier 2: 2000ms × 240 = 8 min                             │
│  (Automatic tier selection based on time range)             │
└─────────────────────────────────────────────────────────────┘
```

## Phases

### Phase 1: JS Query API

**Goal**: Expose speed sample data from JS engine to Kotlin.

**Files to modify**:
- `packages/engine/src/adapters/native/controller.ts`

**Tasks**:
1. Add `__jstorrent_query_speed_samples` function:
   ```typescript
   __jstorrent_query_speed_samples = (
     direction: 'down' | 'up',
     categoriesJson: string,  // JSON array or "all"
     fromTime: number,
     toTime: number,
     maxPoints: number
   ): string => {
     // Returns JSON: { samples: [{time, value}], bucketMs, latestBucketTime }
   }
   ```

2. Wire it to `engine.bandwidth.getSamplesWithMeta()`

**Testing**:
- Use debug broadcast receiver to call evaluate and test the query
- Verify samples are returned with correct structure

**Estimated scope**: ~30 lines of TypeScript

---

### Phase 2: Kotlin Bridge

**Goal**: Add Kotlin API to query speed samples from the engine.

**Files to modify**:
- `android/quickjs-engine/src/main/kotlin/com/jstorrent/quickjs/model/EngineModels.kt`
- `android/quickjs-engine/src/main/kotlin/com/jstorrent/quickjs/EngineController.kt`
- `android/app/src/main/java/com/jstorrent/app/viewmodel/TorrentRepository.kt`
- `android/app/src/main/java/com/jstorrent/app/viewmodel/EngineServiceRepository.kt`

**Tasks**:
1. Add data models:
   ```kotlin
   @Serializable
   data class SpeedSample(val time: Long, val value: Float)

   @Serializable
   data class SpeedSamplesResult(
       val samples: List<SpeedSample>,
       val bucketMs: Long,
       val latestBucketTime: Long
   )
   ```

2. Add to `EngineController`:
   ```kotlin
   suspend fun getSpeedSamplesAsync(
       direction: String,  // "down" or "up"
       categories: String, // "all" or JSON array
       fromTime: Long,
       toTime: Long,
       maxPoints: Int = 300
   ): SpeedSamplesResult?
   ```

3. Add to `TorrentRepository` interface and `EngineServiceRepository` implementation

**Testing**:
- Unit test with mock engine
- Integration test calling through to JS

**Estimated scope**: ~80 lines of Kotlin

---

### Phase 3: SpeedChart Compose Component

**Goal**: Create a reusable Canvas-based line chart for speed data.

**Files to create**:
- `android/app/src/main/java/com/jstorrent/app/ui/components/SpeedChart.kt`

**Features**:
- Two filled area series (download: `#22c55e`, upload: `#3b82f6`)
- Time axis with relative labels ("-30s", "-1m", "-5m", etc.)
- Y-axis with auto-scaling and speed labels (B/s, KB/s, MB/s)
- Smooth rendering with proper anti-aliasing
- Handle empty data gracefully

**API**:
```kotlin
@Composable
fun SpeedChart(
    downloadSamples: List<SpeedSample>,
    uploadSamples: List<SpeedSample>,
    bucketMs: Long,
    timeWindowMs: Long,
    modifier: Modifier = Modifier
)
```

**Implementation details**:
- Use `Canvas` composable with `drawPath` for filled areas
- Calculate Y scale from max value across both series
- Draw grid lines for readability
- Time labels at regular intervals
- Y-axis labels on the left

**Testing**:
- Preview composables with sample data
- Test with various data sizes (empty, sparse, dense)

**Estimated scope**: ~200-250 lines of Kotlin

---

### Phase 4: SpeedHistoryScreen & ViewModel

**Goal**: Create the screen and wire up data flow.

**Files to create**:
- `android/app/src/main/java/com/jstorrent/app/ui/screens/SpeedHistoryScreen.kt`
- `android/app/src/main/java/com/jstorrent/app/viewmodel/SpeedHistoryViewModel.kt`
- `android/app/src/main/java/com/jstorrent/app/model/SpeedHistoryUiState.kt`

**Screen layout**:
- Top app bar with back button and title "Speed History"
- Time window selector chips (1m, 10m, 30m)
- SpeedChart component
- Current rates display below chart (download/upload)

**ViewModel**:
- `timeWindowMs: StateFlow<Long>` (default 60_000)
- `uiState: StateFlow<SpeedHistoryUiState>`
- Poll every 1.5 seconds while screen is active
- Stop polling on `onCleared()`

**UiState**:
```kotlin
sealed class SpeedHistoryUiState {
    object Loading : SpeedHistoryUiState()
    data class Loaded(
        val downloadSamples: List<SpeedSample>,
        val uploadSamples: List<SpeedSample>,
        val bucketMs: Long,
        val currentDownloadRate: Long,
        val currentUploadRate: Long
    ) : SpeedHistoryUiState()
    data class Error(val message: String) : SpeedHistoryUiState()
}
```

**Testing**:
- Preview with mock data
- Manual testing on device

**Estimated scope**: ~200 lines of Kotlin

---

### Phase 5: Navigation & Menu Integration

**Goal**: Wire up navigation and add menu entry.

**Files to modify**:
- `android/app/src/main/java/com/jstorrent/app/ui/navigation/Navigation.kt`
- `android/app/src/main/java/com/jstorrent/app/ui/screens/TorrentListScreen.kt`

**Tasks**:
1. Add route `Routes.SPEED_HISTORY = "speed_history"`

2. Add composable to NavHost:
   ```kotlin
   composable(Routes.SPEED_HISTORY) {
       val viewModel: SpeedHistoryViewModel = viewModel(...)
       SpeedHistoryScreen(
           viewModel = viewModel,
           onNavigateBack = { navController.popBackStack() }
       )
   }
   ```

3. Add menu item in TorrentListScreen overflow menu:
   ```kotlin
   DropdownMenuItem(
       text = { Text("Speed") },
       leadingIcon = { Icon(Icons.Default.Speed, ...) },
       onClick = {
           showMenu = false
           onSpeedClick()  // navigate to SPEED_HISTORY
       }
   )
   ```

4. Add `onSpeedClick` callback to TorrentListScreen and wire in TorrentNavHost

**Testing**:
- Verify navigation works
- Verify menu item appears and navigates correctly

**Estimated scope**: ~40 lines of Kotlin

---

## Summary

| Phase | Description | Files | Est. Lines |
|-------|-------------|-------|------------|
| 1 | JS Query API | 1 | ~30 |
| 2 | Kotlin Bridge | 4 | ~80 |
| 3 | SpeedChart Component | 1 | ~200-250 |
| 4 | Screen & ViewModel | 3 | ~200 |
| 5 | Navigation & Menu | 2 | ~40 |
| **Total** | | **11** | **~550-600** |

## Future Enhancements (Out of Scope)

- Traffic category filtering (peer/tracker/DHT breakdown)
- Per-torrent speed graphs
- Persist speed history across app restarts
- Export speed data for analysis
- Landscape orientation optimization

## Reference Files

**Extension implementation** (for reference):
- `packages/engine/src/utils/rrd-history.ts` - RRD data structure
- `packages/engine/src/core/bandwidth-tracker.ts` - Bandwidth tracking wrapper
- `packages/ui/src/components/SpeedTab.tsx` - React UI component

**Android patterns to follow**:
- `android/app/src/main/java/com/jstorrent/app/ui/components/PieceMap.kt` - Canvas drawing
- `android/app/src/main/java/com/jstorrent/app/ui/screens/DhtInfoScreen.kt` - Debug screen pattern
- `android/app/src/main/java/com/jstorrent/app/viewmodel/DhtViewModel.kt` - ViewModel pattern
