# Android Application-Scoped Engine Refactor

## Overview

Move the QuickJS engine from `EngineService` to `JSTorrentApplication` to eliminate notification spam and enable instant resume.

**Current problem:** Engine lives in `EngineService`. When service auto-stops (all torrents paused/complete), engine dies. When user foregrounds app, service restarts, showing notification briefly. This creates a stop→restart→stop cycle that spams notifications.

**Solution:** Engine lives in `Application` (process lifetime). Service becomes just a notification surface + "keep alive" signal. Service only runs during active background downloads.

**Result:**
- No notification when idle
- No notification when user is looking at app
- Instant resume (engine already in memory)
- Notification only when actively downloading/seeding in background

## Phase Summary

| Phase | Description | Tests Pass? | Safe Checkpoint? |
|-------|-------------|-------------|------------------|
| 1 | Move engine to Application | ✅ Yes | ✅ Yes - identical behavior |
| 2 | Decouple service from engine | ✅ Yes | ✅ Yes - still spammy but works |
| 3 | Smart service lifecycle | ✅ Yes | ✅ Yes - spam eliminated |
| 4 | Cleanup and edge cases | ✅ Yes | ✅ Yes - production ready |

## Phase 1: Move Engine to Application

Structural move only. Behavior should remain identical after this phase.

### 1.1 Create engine holder in JSTorrentApplication

File: `android/app/src/main/java/com/jstorrent/app/JSTorrentApplication.kt`

Add engine controller as Application-scoped singleton:

```kotlin
class JSTorrentApplication : Application() {
    
    // Existing notification channel code...
    
    // Engine controller - lives for process lifetime
    private var _engineController: EngineController? = null
    
    val engineController: EngineController?
        get() = _engineController
    
    /**
     * Initialize the engine. Called from Activity on first launch.
     * Idempotent - safe to call multiple times.
     */
    fun initializeEngine(storageMode: String? = null): EngineController {
        _engineController?.let { return it }
        
        val controller = EngineController(this, storageMode)
        _engineController = controller
        return controller
    }
    
    /**
     * Check if engine is initialized.
     */
    val isEngineInitialized: Boolean
        get() = _engineController != null
    
    /**
     * Shutdown engine. Called on explicit quit or for testing.
     */
    fun shutdownEngine() {
        _engineController?.shutdown()
        _engineController = null
    }
}
```

**Note:** Engine initialization is lazy (called from Activity) rather than in `Application.onCreate()`. This avoids 2-3 second startup delay when app is launched just for companion mode or to handle an intent.

### 1.2 Update EngineService to use Application engine

File: `android/app/src/main/java/com/jstorrent/app/service/EngineService.kt`

Change from owning the engine to referencing Application's engine:

```kotlin
class EngineService : Service() {
    
    // REMOVE: private var _controller: EngineController? = null
    
    // ADD: Access engine from Application
    private val app: JSTorrentApplication
        get() = application as JSTorrentApplication
    
    val controller: EngineController?
        get() = app.engineController
    
    // In onStartCommand, REMOVE engine initialization:
    // - Remove: initializeEngine()
    // - Remove: engineLoadedAtMs tracking
    // - Keep: notification startup
    // - Keep: notification update loop
    
    // In onDestroy, REMOVE engine shutdown:
    // - Remove: controller?.shutdown()
    // - Keep: notification cleanup
```

The service should now:
- Start notification immediately (no waiting for engine)
- Observe engine state from Application
- NOT initialize or destroy the engine

### 1.3 Update NativeStandaloneActivity to initialize engine

File: `android/app/src/main/java/com/jstorrent/app/NativeStandaloneActivity.kt`

```kotlin
class NativeStandaloneActivity : ComponentActivity() {
    
    private val app: JSTorrentApplication
        get() = application as JSTorrentApplication
    
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        // Initialize engine (idempotent)
        app.initializeEngine(storageMode = testStorageMode.value)
        
        // Start service for notification (still needed for now - Phase 3 changes this)
        EngineService.start(this, storageMode = testStorageMode.value)
        
        // ... rest of onCreate
    }
    
    // Update all EngineService.instance?.controller references:
    // BEFORE: EngineService.instance?.controller
    // AFTER:  app.engineController
```

### 1.4 Update EngineServiceRepository

File: `android/app/src/main/java/com/jstorrent/app/viewmodel/EngineServiceRepository.kt`

Update to get engine from Application instead of Service:

```kotlin
class EngineServiceRepository(private val application: Application) {
    
    private val app: JSTorrentApplication
        get() = application as JSTorrentApplication
    
    val engineController: EngineController?
        get() = app.engineController
    
    // Update any EngineService.instance references
}
```

### 1.5 Verification

After Phase 1:
- [ ] App launches, engine initializes, torrents load
- [ ] Notification appears (same as before)
- [ ] Downloads work
- [ ] Existing e2e tests pass
- [ ] `adb shell am force-stop com.jstorrent.app` → next launch is cold start (expected)

Behavior should be identical to before. This phase is pure refactoring.

---

## Phase 2: Decouple Service Lifecycle from Engine

Make engine survive service stop. Keep existing lifecycle behavior so tests pass.

### 2.1 Remove engine initialization from service

File: `android/app/src/main/java/com/jstorrent/app/service/EngineService.kt`

The service no longer initializes or owns the engine. Clean up `onStartCommand()`:

```kotlin
override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // Start foreground immediately
    val initialNotification = notificationManager.buildNotification(emptyList())
    startForeground(NOTIFICATION_ID, initialNotification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    
    // Start notification updates
    startNotificationUpdates()
    
    // Start network monitoring
    startNetworkMonitoring()
    
    // REMOVE: initializeEngine() call
    // REMOVE: engine loading state tracking
    // REMOVE: engineLoadedAtMs assignment
    
    return START_NOT_STICKY  // Don't auto-restart if killed
}
```

### 2.2 Clean up onDestroy

```kotlin
override fun onDestroy() {
    notificationUpdateJob?.cancel()
    wifiMonitorJob?.cancel()
    networkMonitor?.unregister()
    
    // REMOVE: controller?.shutdown()
    // Engine survives service death - it lives in Application
    
    instance = null
    super.onDestroy()
}
```

### 2.3 Simplify checkAllComplete guards

Remove engine-related guards that no longer make sense:

```kotlin
private fun checkAllComplete(torrents: List<TorrentSummary>) {
    // KEEP: settings check
    if (settingsStore.whenDownloadsComplete != "stop_and_close") return
    
    // KEEP: WiFi pause check
    if (_serviceState.value == ServiceState.PAUSED_WIFI) return
    
    // REMOVE: engineLoadedAtMs / STARTUP_GRACE_PERIOD_MS check
    // (engine startup is no longer tied to service startup)
    
    // KEEP: activity foreground check
    if (isActivityInForeground) return
    
    // REMOVE: hasSeenCompletionDuringSession check
    // (this was about engine cold start, not relevant anymore)
    
    // KEEP: auto-stop conditions (unchanged)
    if (torrents.isEmpty()) {
        stopSelf()
        return
    }
    if (torrents.all { it.status == "stopped" }) {
        stopSelf()
        return
    }
    if (torrents.all { it.progress >= 1.0 }) {
        stopSelf()
        return
    }
}
```

### 2.4 KEEP onResume service restart (for now)

File: `android/app/src/main/java/com/jstorrent/app/NativeStandaloneActivity.kt`

**Important:** Keep the existing `onResume` restart logic. This is the "spammy" behavior, but removing it without the new lifecycle manager would break things.

```kotlin
override fun onResume() {
    super.onResume()
    EngineService.isActivityInForeground = true
    
    // KEEP FOR NOW: Will be removed in Phase 3
    // This causes notification spam but keeps tests passing
    if (EngineService.instance == null) {
        Log.i(TAG, "Service not running, restarting from onResume")
        EngineService.start(this, storageMode = testStorageMode.value)
    }
    
    // ... rest unchanged
}
```

### 2.5 Remove dead code

Remove from `EngineService`:
- `engineLoadedAtMs` field
- `hasSeenCompletionDuringSession` field
- `STARTUP_GRACE_PERIOD_MS` constant

### 2.6 Verification

After Phase 2:
- [ ] App launches, engine initializes (from Application), service starts
- [ ] Notification appears (same as before)
- [ ] Downloads work
- [ ] All existing e2e tests pass
- [ ] Service stops → foreground app → service restarts (still spammy, but working)
- [ ] Key difference: engine survives service stop (verify torrent list persists)

**What's different:** Engine now outlives service. The spam still happens, but we've decoupled the pieces. Phase 3 fixes the spam.

---

## Phase 3: Smart Service Start/Stop

Replace the old lifecycle (spammy `onResume` restart + `checkAllComplete` auto-stop) with a clean `ServiceLifecycleManager`.

**This phase eliminates the notification spam.**

### 3.1 Define when service should run

Service needed when ALL of these are true:
- Active work: downloading OR seeding (not just paused/complete)
- User not looking: activity is not in foreground

Service NOT needed when:
- All torrents paused/stopped/complete
- OR user is looking at app (activity foreground)

### 3.2 Create service lifecycle manager

File: `android/app/src/main/java/com/jstorrent/app/service/ServiceLifecycleManager.kt` (new file)

```kotlin
package com.jstorrent.app.service

import android.content.Context
import android.util.Log
import com.jstorrent.quickjs.model.TorrentSummary
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

private const val TAG = "ServiceLifecycleMgr"

/**
 * Decides when EngineService should run.
 * 
 * Service runs when: active downloads/seeding AND user not in app
 * Service stops when: idle OR user in app
 */
class ServiceLifecycleManager(private val context: Context) {
    
    private val _isActivityForeground = MutableStateFlow(false)
    val isActivityForeground: StateFlow<Boolean> = _isActivityForeground
    
    private var hasActiveWork = false
    private var serviceRunning = false
    
    /**
     * Called from Activity.onStart()
     */
    fun onActivityStart() {
        _isActivityForeground.value = true
        updateServiceState()
    }
    
    /**
     * Called from Activity.onStop()
     */
    fun onActivityStop() {
        _isActivityForeground.value = false
        updateServiceState()
    }
    
    /**
     * Called when torrent state changes.
     */
    fun onTorrentStateChanged(torrents: List<TorrentSummary>) {
        hasActiveWork = torrents.any { torrent ->
            val isActive = torrent.status in listOf("downloading", "downloading_metadata", "checking", "seeding")
            val hasSpeed = torrent.downloadSpeed > 0 || torrent.uploadSpeed > 0
            isActive || hasSpeed
        }
        updateServiceState()
    }
    
    private fun updateServiceState() {
        val shouldRun = hasActiveWork && !_isActivityForeground.value
        
        if (shouldRun && !serviceRunning) {
            Log.i(TAG, "Starting service: active work in background")
            EngineService.start(context)
            serviceRunning = true
        } else if (!shouldRun && serviceRunning) {
            Log.i(TAG, "Stopping service: idle or user in app")
            EngineService.stop(context)
            serviceRunning = false
        }
    }
}
```

### 3.3 Integrate lifecycle manager

File: `android/app/src/main/java/com/jstorrent/app/JSTorrentApplication.kt`

```kotlin
class JSTorrentApplication : Application() {
    
    // ... existing code ...
    
    lateinit var serviceLifecycleManager: ServiceLifecycleManager
        private set
    
    override fun onCreate() {
        super.onCreate()
        serviceLifecycleManager = ServiceLifecycleManager(this)
        // ... existing notification channel code ...
    }
}
```

### 3.4 Update Activity lifecycle hooks

File: `android/app/src/main/java/com/jstorrent/app/NativeStandaloneActivity.kt`

Replace old lifecycle with new:

```kotlin
override fun onStart() {
    super.onStart()
    app.serviceLifecycleManager.onActivityStart()
    observeEngineForPendingMagnet()
}

override fun onStop() {
    super.onStop()
    app.serviceLifecycleManager.onActivityStop()
}

override fun onResume() {
    super.onResume()
    
    // REMOVE the spammy restart - this was the core problem:
    // if (EngineService.instance == null) {
    //     EngineService.start(this, ...)
    // }
    
    // REMOVE: EngineService.isActivityInForeground = true
    // (lifecycle manager handles this now via onStart/onStop)
    
    // KEEP: root syncing, etc.
    rootStore.reload()
    hasRoots.value = rootStore.listRoots().isNotEmpty()
    isAddingRoot.value = false
    lifecycleScope.launch(Dispatchers.IO) {
        syncRootsWithEngine()
    }
}

override fun onPause() {
    super.onPause()
    // REMOVE: EngineService.isActivityInForeground = false
    // (lifecycle manager handles this now)
}
```

### 3.5 Connect engine state to lifecycle manager

In `NativeStandaloneActivity.onCreate()` or wherever you observe engine state:

```kotlin
// Observe torrent list and notify lifecycle manager
lifecycleScope.launch {
    app.engineController?.torrents?.collect { torrents ->
        app.serviceLifecycleManager.onTorrentStateChanged(torrents)
    }
}
```

### 3.6 Simplify EngineService

Now that lifecycle is managed externally, `EngineService` becomes much simpler:

```kotlin
class EngineService : Service() {
    
    private val ioScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private lateinit var notificationManager: ForegroundNotificationManager
    private var notificationUpdateJob: Job? = null
    
    private val app: JSTorrentApplication
        get() = application as JSTorrentApplication
    
    val controller: EngineController?
        get() = app.engineController
    
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notification = notificationManager.buildNotification(getCurrentTorrents())
        startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        startNotificationUpdates()
        return START_NOT_STICKY
    }
    
    override fun onDestroy() {
        notificationUpdateJob?.cancel()
        instance = null
        super.onDestroy()
    }
    
    private fun startNotificationUpdates() {
        notificationUpdateJob = ioScope.launch {
            while (isActive) {
                delay(1000)
                val torrents = getCurrentTorrents()
                notificationManager.updateNotification(torrents)
                checkStateTransitions(torrents)  // For completion/error notifications
                // REMOVE: checkAllComplete() - lifecycle manager handles service stop
            }
        }
    }
    
    // REMOVE from companion object:
    // - isActivityInForeground (lifecycle manager tracks this)
    
    // REMOVE entirely:
    // - checkAllComplete() function
    // - ServiceState enum (if only used for auto-stop)
    // - _serviceState StateFlow (if only used for auto-stop)
}
```

### 3.7 Verification

After Phase 3:
- [ ] Launch app → no notification (activity foreground)
- [ ] Add torrent, start downloading → no notification (activity foreground)
- [ ] Background app while downloading → notification appears
- [ ] Foreground app → notification disappears
- [ ] Pause all torrents, background app → no notification
- [ ] Resume torrent while backgrounded → notification appears
- [ ] All torrents complete → notification disappears (after a moment)

---

## Phase 4: Cleanup and Edge Cases

### 4.1 Handle seeding setting

The lifecycle manager needs to respect "seed in background" setting:

```kotlin
class ServiceLifecycleManager(
    private val context: Context,
    private val settingsStore: SettingsStore
) {
    // ...
    
    fun onTorrentStateChanged(torrents: List<TorrentSummary>) {
        val seedInBackground = settingsStore.seedInBackground  // or however it's named
        
        hasActiveWork = torrents.any { torrent ->
            val isDownloading = torrent.status in listOf("downloading", "downloading_metadata", "checking")
            val isSeeding = torrent.status == "seeding" && seedInBackground
            isDownloading || isSeeding
        }
        updateServiceState()
    }
}
```

### 4.2 Handle WiFi-only mode

When WiFi-only is enabled and WiFi is lost, downloads pause. The lifecycle manager should detect this:

```kotlin
fun onTorrentStateChanged(torrents: List<TorrentSummary>) {
    // Don't count WiFi-paused torrents as "active work"
    hasActiveWork = torrents.any { torrent ->
        val isActive = torrent.status in listOf("downloading", "downloading_metadata", "checking", "seeding")
        // status will be "stopped" or similar when paused for WiFi, so this should work automatically
        isActive
    }
    updateServiceState()
}
```

If the engine has a separate "paused_wifi" status, handle it explicitly.

### 4.3 Handle engine crash recovery

If QuickJS crashes, `engineController` becomes invalid. Add recovery:

```kotlin
// In JSTorrentApplication
fun ensureEngine(storageMode: String? = null): EngineController {
    _engineController?.let { 
        if (it.isHealthy) return it  // Add health check to EngineController
    }
    return initializeEngine(storageMode)
}

// In Activity, when accessing engine for critical operations
val engine = app.ensureEngine()
```

### 4.4 Update tests

Tests in `ServiceLifecycleTest.kt` need updating for new architecture:

**Remove tests for:**
- `checkAllComplete()` behavior
- `engineLoadedAtMs` grace period
- `hasSeenCompletionDuringSession` logic

**Add tests for:**
- `ServiceLifecycleManager` state transitions
- Service starts when: active download + activity stopped
- Service stops when: idle OR activity started
- Engine survives service stop
- Engine initialized from Application

### 4.5 Clean up remaining dead code

Verify these are removed:
- [ ] `EngineService.isActivityInForeground` 
- [ ] `EngineService.checkAllComplete()`
- [ ] `EngineService.engineLoadedAtMs`
- [ ] `EngineService.hasSeenCompletionDuringSession`
- [ ] `EngineService.STARTUP_GRACE_PERIOD_MS`
- [ ] `EngineService.ServiceState` enum (if unused)
- [ ] `NativeStandaloneActivity` onResume service restart

### 4.6 Verification

Full test pass:
- [ ] All unit tests pass
- [ ] All e2e tests pass
- [ ] Manual testing of all notification scenarios:
  - [ ] Launch app → no notification
  - [ ] Download active, app visible → no notification
  - [ ] Download active, app backgrounded → notification
  - [ ] App foregrounded → notification gone
  - [ ] All paused, app backgrounded → no notification
  - [ ] Seeding (with setting on), app backgrounded → notification
  - [ ] Seeding (with setting off), app backgrounded → no notification
- [ ] Process death recovery: kill app, relaunch → cold start works
- [ ] Engine crash recovery: force exception, verify restart

---

## Files Changed Summary

| File | Phase | Change |
|------|-------|--------|
| `JSTorrentApplication.kt` | 1, 3 | Add engine holder; add lifecycle manager |
| `EngineService.kt` | 1, 2, 3 | Reference App engine; remove engine lifecycle; remove auto-stop logic |
| `NativeStandaloneActivity.kt` | 1, 3 | Initialize engine from App; use lifecycle manager hooks |
| `EngineServiceRepository.kt` | 1 | Get engine from Application |
| `ServiceLifecycleManager.kt` | 3 | New file - controls service start/stop |
| `ServiceLifecycleTest.kt` | 4 | Update tests for new architecture |

## Rollback Plan

If issues arise, revert to engine-in-service model. The phases are designed so Phase 1 alone is a safe stopping point (identical behavior, just different ownership).

## Future Considerations

- **Bound service hybrid:** Could use bound service when activity visible, foreground service when backgrounded. More complex, probably not needed.
- **WorkManager for reliability:** If Android kills the process during background download, WorkManager could restart it. Overkill for MVP.
