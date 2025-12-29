# Wire Up Service Lifecycle Manager

## Context

The Application-scoped engine refactor (Phase 1-4) is complete. The engine now lives in `JSTorrentApplication` and survives service stop/start cycles. 

However, no foreground service notifications are appearing. The `ServiceLifecycleManager` exists but isn't receiving the inputs it needs to decide when to start/stop the service.

## Goal

Make the foreground service notification appear when:
- Active downloads or seeding are happening AND
- User is not looking at the app (activity not visible)

No notification when:
- App is in foreground OR
- All torrents are idle/paused/complete

## What Needs Wiring

The `ServiceLifecycleManager` needs two inputs:

### 1. Activity Visibility

`NativeStandaloneActivity` must call:
- `app.serviceLifecycleManager.onActivityStart()` in `onStart()`
- `app.serviceLifecycleManager.onActivityStop()` in `onStop()`

### 2. Torrent State

Something must observe the engine's torrent list and notify the lifecycle manager when it changes:

```kotlin
// Observe torrent state and notify lifecycle manager
engineController.torrents.collect { torrents ->
    serviceLifecycleManager.onTorrentStateChanged(torrents)
}
```

This could live in:
- `NativeStandaloneActivity.onCreate()` 
- `JSTorrentApplication` after engine init
- A ViewModel

The key is it must run continuously while the engine exists, not just while the activity is visible.

## Debugging Steps

1. Add logging to `ServiceLifecycleManager.updateServiceState()` to see current values of `hasActiveWork` and `isActivityForeground`

2. Verify `onActivityStart/Stop` are being called by checking logs when foregrounding/backgrounding the app

3. Verify `onTorrentStateChanged` is being called by checking logs when adding/starting a torrent

4. If inputs are flowing but service isn't starting, check the logic in `updateServiceState()`

## Expected Behavior After Fix

1. Launch app → no notification
2. Add torrent, start downloading → no notification (app visible)
3. Press home / switch apps → notification appears within ~1 second
4. Return to app → notification disappears
5. Pause all torrents, background app → no notification
