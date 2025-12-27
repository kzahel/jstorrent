# Android Standalone Polish: Service Lifecycle, Notifications & Settings

**Super-Task Document**  
**Date:** December 2025  
**Status:** Ready for sequential agent execution

---

## Overview

The Android standalone app (QuickJS + Compose UI) has core functionality working. This task adds production polish: proper foreground service notifications, settings UI, bandwidth controls, and service lifecycle management.

**Two separate services exist - do NOT confuse them:**
- `IoDaemonService` (Companion/ChromeOS): HTTP/WebSocket server for extension - NOT touched by this task
- `EngineService` (Standalone/Android): QuickJS engine + foreground service - THIS is what we're polishing

---

## Critical: Testing Requirements

**Every phase MUST have instrumented tests that run on the emulator.** You are not done with a phase until:

1. You have written instrumented tests covering the phase's functionality
2. You have run `./gradlew connectedAndroidTest` on the emulator
3. All tests pass

Use `android/scripts/emu-start.sh` to start the emulator if needed. Existing test patterns are in `android/app/src/androidTest/` - follow those conventions.

---

## Phase 1: Bandwidth Limiting + Rate Display

**Goal:** Add bandwidth limit settings to engine and display live rates in the UI.

### Requirements

1. **Engine bandwidth limits**: Wire config values (`maxDownloadRate`, `maxUploadRate` in bytes/sec, 0=unlimited) to the engine's existing `TokenBucket` rate limiting
2. **Top bar rate display**: Show aggregate download/upload rates in `TorrentListScreen` top bar, updating every second:
   ```
   JSTorrent            ↓ 12.5 MB/s  ↑ 1.2 MB/s
   ```

### Tests

- Set download limit to 100 KB/s, add torrent, verify rate stays under limit
- Change limit at runtime, verify it takes effect
- Verify UI shows correct rates

---

## Phase 2: Dynamic Foreground Notification

**Goal:** Replace static notification with live stats and action buttons.

### Requirements

1. **Notification channels** (create in Application.onCreate):
   - `service` (LOW importance): Foreground service, silent, persistent
   - `complete` (DEFAULT): Per-torrent completion, plays sound
   - `errors` (HIGH): Storage full, connection issues

2. **Live notification content** (update every 1 second):
   ```
   JSTorrent
   ↓ 2 downloading · ↑ 1 seeding
   12.5 MB/s down · 1.2 MB/s up
   ```

3. **Action buttons**:
   - **Pause All / Resume All**: Mutually exclusive, toggles based on state
   - **Quit**: Stops service immediately, dismisses notification, exits app

4. Clicking notification body opens `NativeStandaloneActivity`
5. Non-dismissible while running (`setOngoing(true)`)

### Tests

- Service start shows notification
- Pause All action pauses engine
- Resume All action resumes engine  
- Quit action stops service
- Notification content updates (verify text changes)

---

## Phase 3: Settings UI

**Goal:** Settings screen with download locations, bandwidth, network options.

### Settings Layout

```
DOWNLOAD LOCATIONS
  Default for new torrents: [📁 Download ▼]
  
  Configured folders:
  📁 Download              ★ Default
  📁 Movies                [Set Default] [✕]
  📁 SD Card/Torrents      [Set Default] [✕]
  [+ Add Folder]

WHEN DOWNLOADS COMPLETE
  ◉ Stop and close app
  ○ Keep seeding in background

BANDWIDTH
  Max download speed       [ Unlimited ▼ ]
  Max upload speed         [ Unlimited ▼ ]

NOTIFICATIONS
  Status: Enabled ✓  (or: Disabled ⚠️)
  [Enable Notifications] or [Open Notification Settings]

NETWORK
  WiFi-only                            [ OFF ]
  Protocol encryption           [ Allow ▼ ]
  DHT                                  [ ON ]
  PEX (Peer Exchange)                  [ ON ]
```

### Key Behaviors

- **Download locations**: List roots from `RootStore`, allow setting default, allow removing any non-default root (may cause torrents to error - that's fine), "Add Folder" opens SAF picker
- **Bandwidth presets**: Unlimited, 100 KB/s, 500 KB/s, 1 MB/s, 5 MB/s, 10 MB/s
- **Notification permission**: Smart detection - if can still request inline, show button that triggers permission dialog; if permanently denied, show button that opens system settings
- All settings persist via SharedPreferences

### Tests

- Settings screen opens from navigation
- Bandwidth dropdown changes and persists
- WiFi-only toggle persists
- Download location list shows roots
- Remove folder works
- Set default folder works

---

## Phase 4: Notification Permission Flow

**Goal:** Request notification permission on first launch with clear rationale.

### Requirements

1. **First launch only**: Track `hasShownNotificationPrompt` in prefs
2. **Rationale dialog** (if permission not granted and not yet prompted):
   ```
   Enable Notifications?
   
   JSTorrent needs notification permission to:
   • Download files in the background
   • Alert you when downloads complete
   
   [Not Now]  [Enable]
   ```
3. **"Enable"** triggers runtime permission request
4. **"Not Now"** dismisses, sets flag, never nags again
5. **Settings screen** shows status and appropriate action (inline request vs open system settings)

### Tests

- Dialog shows on first launch when permission not granted
- Dialog does NOT show on subsequent launches
- "Enable" triggers permission request
- "Not Now" dismisses and sets flag
- Settings shows correct permission status

---

## Phase 5: Completion & Error Notifications

**Goal:** Notify user when torrents complete or encounter errors.

### Requirements

1. **Completion notification** (when torrent reaches 100%):
   ```
   ✓ Download complete
   ubuntu-24.04.iso · 4.7 GB
   [Open Folder]
   ```
   - Use `complete` channel, dismissible, plays sound
   - "Open Folder" action opens containing folder in file manager

2. **Error notification** (when torrent enters error state):
   ```
   ⚠️ Storage full
   ubuntu-24.04.iso paused - free up space
   ```
   - Use `errors` channel, dismissible

3. Subscribe to engine events from `EngineService` to detect state changes

### Tests

- Torrent completion triggers notification
- Notification has correct content
- "Open Folder" action works (may need to verify intent)
- Error state triggers error notification

---

## Phase 6: Service Lifecycle Management

**Goal:** Auto-stop based on settings, WiFi-only pause behavior.

### Requirements

1. **"When downloads complete" setting**:
   - "Stop and close app" (default): Service stops when all torrents complete
   - "Keep seeding in background": Service runs until user quits via notification

2. **WiFi-only mode**:
   - Monitor network type via `ConnectivityManager.NetworkCallback`
   - When WiFi-only enabled and cellular detected: call `engine.pauseAll()`, show toast "Paused - waiting for WiFi"
   - When WiFi restored: call `engine.resumeAll()`
   - This is a global pause - all network activity stops including DHT

3. **Service state machine**:
   ```
   STOPPED → (App launched) → RUNNING
   RUNNING → (WiFi lost + WiFi-only) → PAUSED
   PAUSED → (WiFi restored) → RUNNING
   RUNNING → (All complete + "Stop" setting) → STOPPED
   Any → (User taps "Quit") → STOPPED
   ```

### Tests

- Auto-stop works with "stop and close" setting
- Service keeps running with "keep seeding" setting
- WiFi-only pauses engine when on cellular (may need to mock network state)
- WiFi-only resumes when WiFi restored

---

## Existing Infrastructure

**Test patterns**: See `E2EBaseTest.kt`, `DownloadE2ETest.kt` for engine integration test patterns

**Emulator scripts** in `android/scripts/`:
- `emu-start.sh` - start emulator
- `emu-install.sh` - build and install APK  
- `emu-logs.sh` - view logcat
- `emu-test-native.sh` - run native standalone tests

**Key existing files**:
- `EngineService.kt` - foreground service for QuickJS engine
- `TorrentNotificationManager.kt` - notification handling (may need significant changes)
- `RootStore.kt` - download folder management
- `SettingsScreen.kt` - may already exist, enhance it
- `NativeStandaloneActivity.kt` - main standalone activity

---

## Success Criteria

Phase is complete when instrumented tests pass on emulator for:
- [ ] Phase 1: Bandwidth limiting works, rates display in UI
- [ ] Phase 2: Dynamic notification with working actions
- [ ] Phase 3: Settings screen fully functional
- [ ] Phase 4: Permission flow works correctly  
- [ ] Phase 5: Completion and error notifications fire
- [ ] Phase 6: Service lifecycle behaves correctly
