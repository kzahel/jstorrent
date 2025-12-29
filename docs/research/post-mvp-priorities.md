## Summary: Android Standalone Mode - Service Lifecycle & Notifications

### Context
- Android native standalone MVP is complete (QuickJS + Compose UI, passing e2e tests)
- Companion mode (ChromeOS) now has comprehensive test coverage (just completed)
- Next priority: notifications, foreground service lifecycle, settings for standalone mode

### Current State of EngineService (Standalone)
- Basic foreground service with static "Engine running" notification
- `IMPORTANCE_LOW` channel (notification often hidden)
- `setOngoing(true)` but still swipe-dismissible on Android 14+
- No action buttons (Pause/Resume/Stop)
- No dynamic updates from engine state
- No completion notifications
- No notification permission request (Android 13+ needs POST_NOTIFICATIONS for completion notifications)

### Two Separate Services (Don't Confuse!)
| Service | Mode | Purpose |
|---------|------|---------|
| `IoDaemonService` | Companion (ChromeOS) | HTTP/WebSocket server for extension |
| `EngineService` | Standalone (Android) | QuickJS engine + foreground service |

Changes to standalone must NOT affect companion mode.

### Task Doc Created (On Hold)
`docs/tasks/2025-12-27-android-service-lifecycle-notifications.md` - 10 phases covering:
1. NotificationTextBuilder (pure function)
2. Dynamic notification updates
3. Pause All/Resume All buttons
4. Completion notifications
5. ServiceLifecycleManager (auto-stop state machine)
6. Wire lifecycle to EngineService
7. AppPreferences for WiFi-only
8. Settings UI toggle
9. NetworkMonitor
10. Wire network monitor to engine

### UX Decisions Needed Before Implementation

**Service Lifecycle:**
- When should foreground service run? (active transfers only? always? configurable?)
- What does "Stop" button do? (pause all? kill service? stop downloads but keep seeding?)
- Auto-stop when idle? After how long? What counts as idle?

**Notification Behavior:**
- Should swipe-dismiss stop service or just hide notification?
- Mandatory/prominent or user-hideable?
- Action buttons: Pause All, Resume All, Stop, Open App?

**Background Downloading:**
- Continue when app backgrounded? Indefinitely or time-limited?
- Setting to disable background downloads?

**WiFi-Only Setting:**
- Auto-pause on cellular or refuse new downloads?
- Auto-resume on WiFi?
- Apply to seeding or just downloads?

**Idle Behavior:**
- If all torrents complete/pause and app backgrounded, stop service after X minutes?
- Keep running for seeding?

### Files to Reference
- `android/app/src/main/java/com/jstorrent/app/service/EngineService.kt`
- `android/app/src/main/java/com/jstorrent/app/notification/TorrentNotificationManager.kt`
- `android/app/src/main/java/com/jstorrent/app/NativeStandaloneActivity.kt`
- `docs/tasks/2025-12-27-android-service-lifecycle-notifications.md`

### Recommendation
Decide on the UX questions first (user flow, notification prominence, idle behavior), then refine the task doc before agent execution.
