# Engine Lifecycle and Notification Architecture Research

## Overview

This document explores the architectural tensions between engine lifecycle management, Android foreground service requirements, and user experience goals for the JSTorrent Android app.

## User Experience Goals

1. **No useless notifications** - Don't show "No active torrents" when there's nothing to do
2. **Useful notifications only** - Show status when actively downloading/seeding
3. **Instant resume** - User shouldn't wait for engine startup when resuming a torrent
4. **Resource efficiency** - Engine should suspend/shutdown when not needed
5. **User control** - Options to control background downloading behavior

## Current Architecture

### Component Coupling

```
┌─────────────────────────────────────────────────────────────────┐
│                        EngineService                             │
│  ┌──────────────┐    ┌──────────────┐    ┌───────────────────┐  │
│  │ QuickJsEngine│ ←→ │EngineController│ ←→ │ForegroundNotification│ │
│  │  (JS Thread) │    │  (StateFlows)  │    │     Manager        │ │
│  └──────────────┘    └──────────────┘    └───────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              ↕
                    Foreground Notification
                    (Required by Android)
```

**Key coupling:** Engine, Controller, and Notification are all owned by `EngineService`. When service stops, all are destroyed.

### Lifecycle Flow

```
App Launch → Activity.onCreate() → EngineService.start()
                                          ↓
                               startForeground(notification)
                                          ↓
                               initializeEngine() [2-3 seconds]
                                          ↓
                               startNotificationUpdates() [every 1s]
```

### Auto-Stop Logic (Current Implementation)

Located in `EngineService.kt:checkAllComplete()`:

```kotlin
// Runs every 1 second in notification update loop
private fun checkAllComplete(torrents: List<TorrentSummary>) {
    // Guards
    if (settingsStore.whenDownloadsComplete != "stop_and_close") return
    if (_serviceState.value == ServiceState.PAUSED_WIFI) return
    if (timeSinceLoad < STARTUP_GRACE_PERIOD_MS) return  // 5 seconds
    if (isActivityInForeground) return

    // Auto-stop conditions
    if (torrents.isEmpty()) stopSelf()
    if (torrents.all { it.status == "stopped" }) stopSelf()  // All paused
    if (torrents.all { it.progress >= 1.0 }) stopSelf()      // All complete
}
```

## Platform Constraints (Android)

### Foreground Service Requirements

1. **Notification is mandatory** - Android requires `startForeground(id, notification)` within 5 seconds of `startForegroundService()`
2. **Notification must be visible** - Cannot be PRIORITY_MIN or silent for foreground services
3. **Service type declaration** - Must declare `FOREGROUND_SERVICE_TYPE_DATA_SYNC` in manifest
4. **Battery optimization** - System may kill services not actively doing work

### Background Execution Limits

- Android 8+: Background services killed within minutes unless foreground
- Android 12+: Stricter foreground service launch restrictions
- Android 13+: Users can dismiss foreground notifications (but service continues)
- Doze mode: Network access restricted when screen off for extended periods

### Bound vs Started Services

| Type | Notification Required | Lifecycle |
|------|----------------------|-----------|
| Started + Foreground | Yes | Lives until stopSelf() or system kill |
| Started (background) | No | Killed quickly by system |
| Bound | No | Lives while clients bound |

## Architectural Tensions

### Tension 1: Notification Visibility vs Resource Efficiency

**Want:** No notification when idle
**Constraint:** Android requires notification for foreground service
**Current behavior:** Shows "No active torrents" to keep service alive

**Options:**
- Accept the notification (current)
- Stop service entirely when idle (lose instant resume)
- Find way to run without foreground service (risky - may be killed)

### Tension 2: Instant Resume vs Resource Efficiency

**Want:** User doesn't wait for engine startup
**Want:** Engine shuts down when not needed
**Constraint:** Engine startup takes 2-3 seconds

**Options:**
- Keep engine always alive (wastes resources)
- Accept startup delay (poor UX)
- Pre-warm engine in background (may still show notification)
- Persist state and load quickly (requires architectural change)

### Tension 3: Activity Foreground Guard vs Background Control

**Current:** Service won't auto-stop while activity is visible
**Issue:** When user foregrounds app with service stopped, it restarts immediately
**Result:** Notification spam cycle

**Options:**
- Don't restart on foreground (user waits for engine)
- Track "intentional stop" flag (complex state)
- Only restart when user takes action (delayed startup)

### Tension 4: State Persistence vs Simplicity

**Current:** All torrent state lives in engine memory (JS runtime)
**Issue:** When engine stops, state is lost; must reload from storage
**Impact:** Cold start requires full engine initialization

**Options:**
- Keep current (accept startup delay)
- Persist to SQLite (duplicated state, sync complexity)
- Keep engine in memory without service (may be killed)

## Possible Architectural Options

### Option A: Quieter Notification (Minimal Change)

**Approach:** Keep engine alive, make notification less intrusive

**Changes:**
- Don't auto-stop when paused (only when truly empty)
- Use low-priority notification channel
- Minimal notification content when idle

**Pros:**
- Simple implementation
- Instant resume
- No architectural changes

**Cons:**
- Notification still exists (Android requirement)
- Uses resources when idle
- Doesn't fully address "useless notification" concern

### Option B: Delayed Restart (Current Direction + Fix)

**Approach:** Auto-stop when idle, don't restart on foreground, restart on user action

**Changes:**
- Track `stoppedDueToNoActivity` flag
- Don't restart in `onResume()` if flag set
- Clear flag and start service on user action (add/resume torrent)

**Pros:**
- No notification when truly idle
- Resource efficient

**Cons:**
- 2-3 second delay when resuming
- Complex flag management
- Need to intercept all "user action" points

### Option C: Application-Scoped Engine (Medium Refactor)

**Approach:** Keep engine in Application class, service only for notification

```kotlin
class JSTorrentApplication : Application() {
    val engineController: EngineController  // Lives as long as app process
}

class EngineService : Service() {
    // Only manages foreground notification
    // Engine accessed via (application as JSTorrentApplication).engineController
}
```

**Pros:**
- Engine survives service stops
- Instant resume (engine already loaded)
- Service only needed during active downloads

**Cons:**
- Engine still killed if app process dies
- Memory overhead when app backgrounded
- Refactoring required

### Option D: Persistent State Layer (Major Refactor)

**Approach:** Persist torrent state to database, lazy-load engine

```
┌────────────┐     ┌──────────────┐     ┌────────────┐
│  UI Layer  │ ←→  │ Repository   │ ←→  │  Database  │
│            │     │ (cached data)│     │  (SQLite)  │
└────────────┘     └──────────────┘     └────────────┘
                          ↕
                   ┌──────────────┐
                   │   Engine     │  ← Started only when needed
                   │ (on-demand)  │
                   └──────────────┘
```

**Pros:**
- UI works without engine
- Fast cold start (load from DB)
- Engine only started for actual work

**Cons:**
- Major architectural change
- State sync complexity
- Duplicate source of truth

### Option E: Bound Service Model

**Approach:** Use bound service instead of started foreground service when UI visible

**Flow:**
1. Activity binds to service → No notification needed
2. When activity unbinds (backgrounded):
   - If active downloads → Promote to foreground (show notification)
   - If idle → Service stops (no notification)

**Pros:**
- No notification when user is viewing app
- Notification only during background downloads
- Natural lifecycle binding

**Cons:**
- Complex service mode switching
- Risk of service killed between unbind and foreground promotion
- May need WorkManager for reliability

### Option F: WorkManager + On-Demand Engine

**Approach:** Use WorkManager for background downloads, engine only in foreground

**Flow:**
1. UI active → Engine runs normally
2. UI backgrounded:
   - Active downloads → Enqueue as WorkManager job
   - Engine can stop, WorkManager handles background
3. UI returns → Resume with engine

**Pros:**
- System manages background work
- Battery-efficient
- Works with Doze mode

**Cons:**
- Major refactoring
- WorkManager has its own constraints
- May need different download strategy

## Recommendation Matrix

| Goal | Option A | Option B | Option C | Option D | Option E | Option F |
|------|----------|----------|----------|----------|----------|----------|
| No useless notification | Partial | Yes | Yes | Yes | Yes | Yes |
| Instant resume | Yes | No | Yes | Yes | Yes | Partial |
| Resource efficient | No | Yes | Partial | Yes | Yes | Yes |
| Implementation effort | Low | Low | Medium | High | Medium | High |
| Platform compliance | Yes | Yes | Yes | Yes | Yes | Yes |

## Current State

### Changes Already Made

1. `EngineService.kt:checkAllComplete()` now auto-stops when:
   - Torrent list is empty
   - All torrents are paused (status == "stopped")

2. Tests added for new behavior in `ServiceLifecycleTest.kt`

### Discovered Issue

When service auto-stops and user foregrounds app, `NativeStandaloneActivity.onResume()` unconditionally restarts service:

```kotlin
if (EngineService.instance == null) {
    EngineService.start(this, storageMode = testStorageMode.value)
}
```

This causes notification spam cycle: stop → foreground → restart → background → stop → repeat

## Open Questions

1. **Acceptable startup delay?** Is 2-3 seconds acceptable for a "cold resume" scenario?
2. **Notification dismissal?** On Android 13+, users can dismiss foreground notifications. Should we detect this?
3. **Background download priority?** Should active downloads take precedence over resource savings?
4. **Settings granularity?** What level of control should users have over background behavior?

## Files Reference

| File | Purpose |
|------|---------|
| `android/app/src/main/java/com/jstorrent/app/service/EngineService.kt` | Service lifecycle, auto-stop logic |
| `android/app/src/main/java/com/jstorrent/app/NativeStandaloneActivity.kt` | Activity lifecycle, service restart |
| `android/app/src/main/java/com/jstorrent/app/notification/ForegroundNotificationManager.kt` | Notification building |
| `android/quickjs-engine/src/main/kotlin/com/jstorrent/quickjs/EngineController.kt` | Engine state management |
| `android/app/src/main/java/com/jstorrent/app/viewmodel/EngineServiceRepository.kt` | UI-Service bridge |
