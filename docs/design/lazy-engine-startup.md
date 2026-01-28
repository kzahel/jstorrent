# Lazy Engine Startup for Android

## Overview

Currently, the Android app initializes the QuickJS engine immediately when the activity starts (`NativeStandaloneActivity.onCreate()`). This means:

- Cold start requires loading and evaluating `engine.bundle.js`
- The JS tick loop starts running immediately
- Battery/CPU usage even when user just wants to glance at the torrent list

This design proposes **lazy engine startup**: show the torrent list from persisted data immediately, defer engine startup until the user actually needs it (e.g., starts a download).

## Current Architecture

```
App Launch
    │
    ▼
NativeStandaloneActivity.onCreate()
    │
    ├── app.initializeEngine()  ◄── QuickJS starts here
    │       │
    │       ├── Load engine.bundle.js
    │       ├── Evaluate JS
    │       ├── Start tick loop (100ms)
    │       └── Restore session from SharedPrefs
    │
    ▼
TorrentListViewModel observes EngineState
    │
    ▼
UI renders torrent list
```

## Proposed Architecture

```
App Launch
    │
    ▼
NativeStandaloneActivity.onCreate()
    │
    ├── TorrentSummaryCache.load()  ◄── Read SharedPrefs directly (fast)
    │
    ▼
TorrentListViewModel shows cached data
    │
    ▼
UI renders torrent list (instant)
    │
    ▼
User taps "Resume" or opens detail view
    │
    ├── app.initializeEngine()  ◄── QuickJS starts on demand
    │
    ▼
ViewModel transitions to live engine state
```

## Data Flow (Option B: Overlay Approach)

The ViewModel combines two data sources:

```kotlin
val uiState = combine(cachedSummaries, engineState) { cached, live ->
    when {
        live != null -> Loaded(live.torrents, ...)  // Engine running
        cached.isNotEmpty() -> Loaded(cached.map { it.toTorrentSummary() }, ...)  // Cached
        else -> Loading
    }
}
```

Key principle: **Engine state always wins when available.**

## Completed Work

### Stage 0: Foundation (DONE)

**Files created:**
- `app/bencode/BencodeDecoder.kt` - Bencode parser
- `app/bencode/TorrentMetadata.kt` - Extract name, size, files from torrents
- `app/cache/TorrentSummaryCache.kt` - Read persisted torrents without engine

**Tests:**
- `BencodeDecoderTest.kt` - 23 unit tests for bencode parsing
- `TorrentMetadataTest.kt` - 8 unit tests for torrent metadata extraction
- `TorrentSummaryCacheTest.kt` - 8 unit tests for bitfield progress calculation

---

## Implementation Stages

### Stage 1: Cache Integration in ViewModel

**Goal:** ViewModel uses cache as initial data source, but still starts engine immediately.

This is a **non-breaking change** - the engine still starts on launch, but UI may render faster if cache loads before engine pushes first state.

**Changes:**
1. Add `TorrentSummaryCache` to `TorrentListViewModel`
2. Load cache in `init` block
3. Combine cache + engine flows (engine wins)

**Files to modify:**
- `viewmodel/TorrentListViewModel.kt`
- `JSTorrentApplication.kt` (provide cache instance)

**Verification:**
- Unit test: ViewModel emits cached data before engine state arrives
- Unit test: ViewModel switches to engine data when available
- Instrumented test: Measure time-to-first-render with and without cache

**Test file:** `TorrentListViewModelCacheTest.kt`

```kotlin
@Test
fun `emits cached data before engine connects`() {
    // Given: cache has 2 torrents, engine not started
    // When: ViewModel initializes
    // Then: uiState emits Loaded with 2 cached torrents
}

@Test
fun `transitions to engine data when available`() {
    // Given: cache has 2 torrents (progress 50%)
    // When: engine starts and pushes state (progress 75%)
    // Then: uiState shows 75% progress (engine wins)
}
```

---

### Stage 2: Deferred Engine Initialization

**Goal:** Engine starts on demand, not in `onCreate()`.

**Changes:**
1. Remove `initializeEngine()` call from `NativeStandaloneActivity.onCreate()`
2. Add `ensureEngineStarted()` helper that starts engine if needed
3. Call `ensureEngineStarted()` at trigger points

**Trigger points (engine must start):**
- User taps play/resume on a torrent
- User opens torrent detail view
- User adds a new torrent (magnet link, .torrent file)
- Background download setting is enabled and there's pending work

**Files to modify:**
- `NativeStandaloneActivity.kt`
- `JSTorrentApplication.kt`
- `viewmodel/TorrentListViewModel.kt`
- `viewmodel/TorrentDetailViewModel.kt`

**Verification:**
- Instrumented test: App launches without starting engine
- Instrumented test: Engine starts when play button tapped
- Instrumented test: Engine starts when detail view opened
- E2E test: Full flow - launch → view list → tap play → download starts

**Test considerations:**
- Need to mock/verify engine initialization timing
- May need test hooks to check "is engine running?"

---

### Stage 3: UI Indicators for Cache vs Live State

**Goal:** User knows when viewing cached (stale) vs live data.

**Changes:**
1. Add `isLive: Boolean` to `TorrentListUiState.Loaded`
2. Show subtle indicator when cached (e.g., "Tap to refresh" or grayed speeds)
3. Speeds always show as "—" when cached (since they're 0)
4. **Engine status dot:** Small colored indicator near app icon/title bar
   - Green dot = engine running
   - Gray/hollow dot = engine not running (cached mode)
   - Useful for development debugging; may remove later

**Files to modify:**
- `model/UiState.kt`
- `viewmodel/TorrentListViewModel.kt`
- `ui/screens/TorrentListScreen.kt`
- `ui/components/TorrentListItem.kt`
- `ui/components/EngineStatusIndicator.kt` (new)

**Verification:**
- Unit test: `isLive` is false when showing cached data
- Unit test: `isLive` is true when engine is running
- Screenshot test: Visual difference between cached and live states
- Manual test: Status dot changes when engine starts/stops

---

### Stage 4: Background Service Coordination

**Goal:** Service lifecycle respects lazy engine.

**Current behavior:** `ServiceLifecycleManager` checks if engine has active work.

**New behavior:** If engine not started, service doesn't need to run. But if user enabled "background downloads" and has active torrents (from cache), engine should start.

**Changes:**
1. `ServiceLifecycleManager` checks cache for pending active torrents
2. If background downloads enabled + active torrents exist → start engine
3. Otherwise, don't start engine just because activity is foregrounded

**Files to modify:**
- `service/ServiceLifecycleManager.kt`
- `JSTorrentApplication.kt`

**Verification:**
- Instrumented test: App in background with no active torrents → engine doesn't start
- Instrumented test: App in background with active torrent + bg enabled → engine starts
- E2E test: Full background download scenario

---

### Stage 5: Handle Edge Cases

**Goal:** Robust handling of race conditions and error states.

**Edge cases to handle:**

1. **Cache/engine mismatch:** User deleted torrent files manually while engine was off
   - Solution: Engine session restore handles missing files gracefully (already does)

2. **Magnet without metadata:** Magnet URI contains `&dn=` (display name) parameter
   - Solution: Parse `dn` from stored `magnetUri` as fallback name. Show "—" for size/progress until engine fetches metadata. No auto-start.

3. **Engine crash during operation:** User tapped play, engine started but crashed
   - Solution: Existing crash handling should work; ViewModel shows error state

4. **Rapid engine start/stop:** User taps play then immediately backgrounds app
   - Solution: Debounce engine start, let ServiceLifecycleManager decide final state

**Files to modify:**
- `cache/TorrentSummaryCache.kt`
- `viewmodel/TorrentListViewModel.kt`
- Various error handling paths

**Verification:**
- Unit tests for each edge case
- Instrumented tests with simulated failures
- Manual testing with corrupted SharedPreferences

---

## Testing Strategy

### Unit Tests (JVM)

| Test Class | Coverage |
|------------|----------|
| `BencodeDecoderTest` | Bencode parsing edge cases |
| `TorrentMetadataTest` | Torrent file parsing |
| `TorrentSummaryCacheTest` | Bitfield progress, JSON parsing |
| `TorrentListViewModelCacheTest` | Cache/engine flow combination |

### Instrumented Tests (Android)

| Test Class | Coverage |
|------------|----------|
| `LazyEngineStartupTest` | Engine starts on demand, not onCreate |
| `CacheToEnginTransitionTest` | Smooth transition from cache to live |
| `BackgroundServiceLazyTest` | Service respects lazy engine |

### E2E Tests

| Scenario | Verification |
|----------|--------------|
| Cold start with cached torrents | List renders < 500ms, no engine log lines |
| Tap play on stopped torrent | Engine starts, download begins |
| Background download with lazy start | Engine starts when needed, service runs |

### Performance Benchmarks

| Metric | Current | Target |
|--------|---------|--------|
| Cold start to list visible | ~1500ms | < 500ms |
| Memory at idle (no engine) | N/A | < 50MB |
| Battery (idle, no engine) | N/A | Minimal |

---

## Risks and Mitigations

### Risk: Cache data inconsistency

**Scenario:** JS engine's session store has different data than what cache reads.

**Mitigation:** Both read from same SharedPreferences (`jstorrent_kv`). Cache is read-only; engine is source of truth for writes.

### Risk: User confusion about stale data

**Scenario:** User sees 50% progress (cached) but actual progress is 75% (needs engine).

**Mitigation:** Stage 3 adds visual indicators. Speeds show "—" when cached. Progress is accurate since it's persisted by engine on each piece completion.

### Risk: Complexity in ViewModel

**Scenario:** Combining two data sources adds complexity and potential bugs.

**Mitigation:** Clear state machine with engine-wins-always semantics. Comprehensive unit tests.

### Risk: Regression in existing flows

**Scenario:** Breaking existing background download, notification, or lifecycle behavior.

**Mitigation:** Staged rollout. Each stage is independently testable. Existing E2E tests must pass.

---

## Design Decisions

1. **Auto-start:** Engine starts only on explicit user action (tap play, open detail, add torrent). No auto-start after delay.

2. **Magnet handling:** Parse `&dn=` (display name) from magnet URI as fallback title. Show "—" for size/progress until metadata is fetched. Same treatment as other torrents.

3. **Settings access:** Settings like speed limits are only relevant when engine is running. No need to duplicate in Kotlin.

4. **Detail view:** Show placeholder/partial data from cache where available. If too complex to plumb through, can require engine for detail view (lower priority).

---

## Appendix: Key Files Reference

### Current Engine Startup Path

```
NativeStandaloneActivity.onCreate()
  → JSTorrentApplication.initializeEngine()
    → EngineController (creates QuickJsEngine)
      → QuickJsEngine.initialize()
        → Load engine.bundle.js from assets
        → Evaluate JS
        → Call __jstorrent_init() with config
        → SessionPersistence.restoreSession()
        → Start tick loop
```

### SharedPreferences Keys (jstorrent_session)

Keys are prefixed with `session:` and JSON values are prefixed with `json:`.

| Key Pattern | Content |
|-------------|---------|
| `session:torrents` | `json:{version, torrents: [{infoHash, source, magnetUri?, addedAt}]}` |
| `session:torrent:{hash}:state` | `json:{userState, bitfield?, uploaded, downloaded, ...}` |
| `session:torrent:{hash}:torrentfile` | Base64: Complete .torrent file (bencoded) |
| `session:torrent:{hash}:infodict` | Base64: Info dictionary only (bencoded, for magnets) |
