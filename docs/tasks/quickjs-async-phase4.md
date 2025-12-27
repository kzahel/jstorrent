# Phase 4: Fix Activity Call Sites

## Goal

Update all Activity code that calls engine/controller methods to use async variants properly, eliminating Main thread blocking.

## Problem Call Sites

### 1. NativeStandaloneActivity.kt

**`syncRootsWithEngine()`** (lines ~112-130)
- Called from `onResume()` on Main thread
- Loops through roots calling `controller.addRoot()` - multiple blocking calls
- Calls `controller.setDefaultRoot()` - blocking

**Fix:** Wrap in `lifecycleScope.launch(Dispatchers.IO)` using async methods

**`observeEngineForPendingMagnet()`** (lines ~197-212)
- Already in coroutine but calls `viewModel.addTorrent()` 
- After Phase 3, this should be fine (repository handles async internally)
- Verify no remaining blocking paths

### 2. AddRootActivity.kt

**SAF result handler** (lines ~88-93)
- Called when user selects folder
- Calls `controller.addRoot()` and `controller.setDefaultRoot()` - blocking

**Fix:** Wrap in `lifecycleScope.launch(Dispatchers.IO)` using async methods

## Changes

### NativeStandaloneActivity.kt

```kotlin
private fun syncRootsWithEngine() {
    val controller = EngineService.instance?.controller ?: return
    val currentRoots = rootStore.listRoots()
    val currentKeys = currentRoots.map { it.key }.toSet()

    lifecycleScope.launch(Dispatchers.IO) {
        for (root in currentRoots) {
            if (root.key !in knownRootKeys) {
                controller.addRootAsync(root.key, root.displayName, root.uri)
            }
        }
        if (knownRootKeys.isEmpty() && currentRoots.isNotEmpty()) {
            controller.setDefaultRootAsync(currentRoots.first().key)
        }
        knownRootKeys = currentKeys.toMutableSet()
    }
}
```

### AddRootActivity.kt

```kotlin
// In SAF result handler
lifecycleScope.launch(Dispatchers.IO) {
    controller.addRootAsync(root.key, root.displayName, root.uri)
    if (isFirstRoot) {
        controller.setDefaultRootAsync(root.key)
    }
}
```

## Instrumented Tests

Create `android/app/src/androidTest/java/com/jstorrent/app/ActivityAsyncTest.kt`

### Key Tests

1. **syncRootsWithEngine doesn't block Main**
   - Mock/setup roots, call sync, verify Main thread not blocked
   - Measure time on Main thread stays <50ms

2. **Adding root from SAF picker doesn't freeze UI**
   - Simulate SAF result callback
   - Verify activity remains responsive

3. **onResume with pending roots doesn't ANR**
   - Setup multiple roots to sync
   - Call onResume, verify no extended Main thread blocking

4. **Pending magnet added after engine loads**
   - Queue a magnet before engine ready
   - Verify it gets added once engine loads
   - Verify no blocking during the wait/add

```kotlin
@RunWith(AndroidJUnit4::class)
class ActivityAsyncTest {

    @get:Rule
    val activityRule = ActivityScenarioRule(NativeStandaloneActivity::class.java)

    @Test
    fun syncRoots_doesNotBlockMainThread() {
        // Setup: add some roots to RootStore
        // ...
        
        val elapsed = measureTimeMillis {
            activityRule.scenario.onActivity { activity ->
                // Trigger onResume path
                activity.onResume()
            }
        }
        assertTrue("onResume should return quickly, took ${elapsed}ms", elapsed < 100)
    }

    @Test
    fun addRoot_uiRemainsResponsive() {
        // Simulate SAF picker result
        // Verify UI thread not blocked
    }
}
```

## Verification

```bash
cd android
./gradlew :app:connectedAndroidTest --tests "*ActivityAsyncTest*"
```

## Depends On

Phase 3 complete (Repository layer updated)

## After This Phase

The app should be fully non-blocking on Main thread. Active torrent downloads should not cause UI freezes or ANRs.

## Optional Follow-up

- Add UI feedback for duplicate torrents via event/StateFlow (if desired)
- Profile on low-end device to verify improvement
- Consider background download notification updates
