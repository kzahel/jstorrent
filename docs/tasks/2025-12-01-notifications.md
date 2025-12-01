# Notification System Implementation

## Overview

Implement Chrome notifications for JSTorrent to alert users of download events and optionally show persistent progress when the UI is backgrounded.

## Background

Chrome MV3 extensions have full access to `chrome.notifications` API. The manifest already includes the `"notifications"` permission.

### Key API Features

```typescript
chrome.notifications.create(id, options)  // create or replace notification
chrome.notifications.update(id, options)  // update existing (silent fail if dismissed)
chrome.notifications.clear(id)            // remove notification
chrome.notifications.onClicked            // handle user clicks
chrome.notifications.onClosed             // handle dismiss

// Useful options:
// - requireInteraction: true  → stays until user dismisses
// - silent: true              → no sound on this notification
```

### Platform Notes

- macOS: Progress bar shows as percentage in title instead of actual progress bar
- macOS: Images not displayed  
- Windows/Linux/Mac: Notifications auto-dismiss after ~5-10 seconds unless `requireInteraction: true`
- Updating a dismissed notification silently fails

---

## Feature Specification

### Notification Modes

#### Mode 1: Event Notifications (default behavior)

When UI is visible OR persistent progress setting is disabled, individual event notifications fire and can stack (multiple visible at once).

| Event | Notification ID | Title | Message Example |
|-------|-----------------|-------|-----------------|
| Torrent complete | `jstorrent-complete-{infoHash}` | "Download Complete" | "Ubuntu 24.04.iso" |
| Torrent error | `jstorrent-error-{infoHash}` | "Download Error" | "Ubuntu 24.04.iso: Disk full" |
| All complete | `jstorrent-all-complete` | "JSTorrent" | "All downloads complete" |

Options:
- `type: 'basic'`
- `requireInteraction: false`
- `silent: false` (play sound)

#### Mode 2: Persistent Progress Notification

When UI is backgrounded AND setting is enabled AND downloads are active, show a single persistent notification that updates in place.

| State | Message Example |
|-------|-----------------|
| Single torrent | "Ubuntu 24.04.iso • ↓ 2.4 MB/s • ETA 23m" |
| Multiple torrents | "3 downloading • ↓ 2.4 MB/s • ETA 23m" |
| With errors | "3 downloading, 1 error • ↓ 2.4 MB/s • ETA 23m" |
| Unknown ETA | "3 downloading • ↓ 2.4 MB/s" |

Notification ID: `jstorrent-progress`

Options:
- `type: 'basic'`
- `requireInteraction: true`
- `silent: true` (no sound on updates)

**Important:** When persistent progress notification is active, suppress individual event notifications (torrent complete, errors). Errors are folded into the progress message. When all downloads complete, replace progress notification with "All downloads complete" message.

### User Settings

```typescript
interface NotificationSettings {
  onTorrentComplete: boolean;        // default: true
  onAllComplete: boolean;            // default: true
  onError: boolean;                  // default: true
  progressWhenBackgrounded: boolean; // default: false (opt-in)
}
```

Store in `chrome.storage.sync` under key `'notificationSettings'`.

### Click Behavior

Clicking any JSTorrent notification should:
1. Focus the existing JSTorrent UI tab if open
2. OR create a new tab with the UI if not open
3. Clear the clicked notification

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  UI Thread (app.tsx / EngineContext)                        │
│                                                             │
│  Responsibilities:                                          │
│  - Track document.visibilityState                           │
│  - Listen to engine events (progress, complete, error)      │
│  - Debounce/throttle progress updates                       │
│  - Send messages to SW via chrome.runtime.sendMessage()     │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ Messages:
                            │ - { type: 'notification:visibility', visible: boolean }
                            │ - { type: 'notification:progress', stats: ProgressStats }
                            │ - { type: 'notification:torrent-complete', infoHash, name }
                            │ - { type: 'notification:torrent-error', infoHash, name, error }
                            │ - { type: 'notification:all-complete' }
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Service Worker (sw.ts)                                     │
│                                                             │
│  Imports NotificationManager from notifications.ts          │
│  Routes messages to NotificationManager methods             │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  NotificationManager (extension/src/lib/notifications.ts)   │
│                                                             │
│  - Loads/saves settings from chrome.storage.sync            │
│  - Tracks state: uiVisible, activeDownloads, errors         │
│  - Decides which notifications to show                      │
│  - Handles click events                                     │
└─────────────────────────────────────────────────────────────┘
```

---

## Implementation Tasks

### Task 1: Create NotificationManager Class

**File:** `extension/src/lib/notifications.ts`

```typescript
export interface NotificationSettings {
  onTorrentComplete: boolean;
  onAllComplete: boolean;
  onError: boolean;
  progressWhenBackgrounded: boolean;
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  onTorrentComplete: true,
  onAllComplete: true,
  onError: true,
  progressWhenBackgrounded: false,
};

export interface ProgressStats {
  activeCount: number;
  errorCount: number;
  downloadSpeed: number;      // bytes per second
  eta: number | null;         // seconds, null if unknown
  // For single-torrent display:
  singleTorrentName?: string; // set when activeCount === 1
}

export class NotificationManager {
  private settings: NotificationSettings = DEFAULT_NOTIFICATION_SETTINGS;
  private uiVisible: boolean = true;
  private progressNotificationActive: boolean = false;
  private lastProgressStats: ProgressStats | null = null;

  constructor() {
    this.loadSettings();
    this.setupClickHandler();
  }

  // ... methods below
}
```

**Methods to implement:**

```typescript
// Settings
async loadSettings(): Promise<void>
async saveSettings(settings: Partial<NotificationSettings>): Promise<void>
getSettings(): NotificationSettings

// State updates from UI
setUiVisibility(visible: boolean): void
updateProgress(stats: ProgressStats): void

// Event handlers (called when UI sends events)
onTorrentComplete(infoHash: string, name: string): void
onTorrentError(infoHash: string, name: string, error: string): void
onAllComplete(): void

// Internal helpers
private shouldShowPersistentProgress(): boolean
private showProgressNotification(stats: ProgressStats): void
private clearProgressNotification(): void
private showEventNotification(id: string, title: string, message: string): void
private setupClickHandler(): void
private async focusOrOpenUI(): Promise<void>

// Formatting helpers
private formatSpeed(bytesPerSec: number): string   // "2.4 MB/s"
private formatEta(seconds: number): string          // "23m" or "1h 5m"
private formatProgressMessage(stats: ProgressStats): string
```

**Key logic for `setUiVisibility`:**

```typescript
setUiVisibility(visible: boolean): void {
  const wasVisible = this.uiVisible;
  this.uiVisible = visible;

  if (visible && !wasVisible) {
    // UI came to foreground - clear persistent notification
    this.clearProgressNotification();
  } else if (!visible && wasVisible) {
    // UI went to background - maybe show persistent notification
    if (this.shouldShowPersistentProgress() && this.lastProgressStats) {
      this.showProgressNotification(this.lastProgressStats);
    }
  }
}
```

**Key logic for `updateProgress`:**

```typescript
updateProgress(stats: ProgressStats): void {
  this.lastProgressStats = stats;

  if (this.progressNotificationActive) {
    // Update the existing notification
    this.showProgressNotification(stats);
  } else if (this.shouldShowPersistentProgress() && stats.activeCount > 0) {
    // Start showing persistent notification
    this.showProgressNotification(stats);
  }

  // Check if all downloads just completed
  if (stats.activeCount === 0 && this.progressNotificationActive) {
    this.onAllComplete();
  }
}
```

**Key logic for event notifications:**

```typescript
onTorrentComplete(infoHash: string, name: string): void {
  // Suppress if persistent progress is active
  if (this.progressNotificationActive) return;
  if (!this.settings.onTorrentComplete) return;

  this.showEventNotification(
    `jstorrent-complete-${infoHash}`,
    'Download Complete',
    name
  );
}

onTorrentError(infoHash: string, name: string, error: string): void {
  // Suppress if persistent progress is active (errors shown in progress message)
  if (this.progressNotificationActive) return;
  if (!this.settings.onError) return;

  this.showEventNotification(
    `jstorrent-error-${infoHash}`,
    'Download Error',
    `${name}: ${error}`
  );
}

onAllComplete(): void {
  if (!this.settings.onAllComplete) {
    this.clearProgressNotification();
    return;
  }

  // Replace progress notification with completion message
  // Use same ID so it replaces in place
  if (this.progressNotificationActive) {
    chrome.notifications.create('jstorrent-progress', {
      type: 'basic',
      iconUrl: '/icons/js-128.png',
      title: 'JSTorrent',
      message: 'All downloads complete',
      requireInteraction: false,
      silent: false,
    });
    this.progressNotificationActive = false;
  } else {
    this.showEventNotification(
      'jstorrent-all-complete',
      'JSTorrent',
      'All downloads complete'
    );
  }
}
```

**Click handler:**

```typescript
private setupClickHandler(): void {
  chrome.notifications.onClicked.addListener((notificationId) => {
    if (notificationId.startsWith('jstorrent')) {
      this.focusOrOpenUI();
      chrome.notifications.clear(notificationId);
    }
  });
}

private async focusOrOpenUI(): Promise<void> {
  const tabs = await chrome.tabs.query({
    url: chrome.runtime.getURL('ui/app.html')
  });

  if (tabs.length > 0 && tabs[0].id !== undefined) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    if (tabs[0].windowId !== undefined) {
      await chrome.windows.update(tabs[0].windowId, { focused: true });
    }
  } else {
    await chrome.tabs.create({
      url: chrome.runtime.getURL('ui/app.html')
    });
  }
}
```

**Formatting helpers:**

```typescript
private formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec < 1024) {
    return `${bytesPerSec} B/s`;
  } else if (bytesPerSec < 1024 * 1024) {
    return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  } else {
    return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
  }
}

private formatEta(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  } else if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m`;
  } else {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }
}

private formatProgressMessage(stats: ProgressStats): string {
  const { activeCount, errorCount, downloadSpeed, eta, singleTorrentName } = stats;

  let parts: string[] = [];

  // Count or name
  if (activeCount === 1 && singleTorrentName) {
    parts.push(singleTorrentName);
  } else {
    let countPart = `${activeCount} downloading`;
    if (errorCount > 0) {
      countPart += `, ${errorCount} error${errorCount !== 1 ? 's' : ''}`;
    }
    parts.push(countPart);
  }

  // Speed
  parts.push(`↓ ${this.formatSpeed(downloadSpeed)}`);

  // ETA
  if (eta !== null && eta > 0) {
    parts.push(`ETA ${this.formatEta(eta)}`);
  }

  return parts.join(' • ');
}
```

---

### Task 2: Integrate NotificationManager into Service Worker

**File:** `extension/src/sw.ts`

Add to the service worker:

```typescript
import { NotificationManager } from './lib/notifications';

const notificationManager = new NotificationManager();

// Add message handler for notification-related messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type?.startsWith('notification:')) {
    handleNotificationMessage(message);
    sendResponse({ ok: true });
    return true;
  }
  // ... existing message handling
});

function handleNotificationMessage(message: any): void {
  switch (message.type) {
    case 'notification:visibility':
      notificationManager.setUiVisibility(message.visible);
      break;
    case 'notification:progress':
      notificationManager.updateProgress(message.stats);
      break;
    case 'notification:torrent-complete':
      notificationManager.onTorrentComplete(message.infoHash, message.name);
      break;
    case 'notification:torrent-error':
      notificationManager.onTorrentError(message.infoHash, message.name, message.error);
      break;
    case 'notification:all-complete':
      notificationManager.onAllComplete();
      break;
  }
}
```

---

### Task 3: Create UI-side Notification Bridge

**File:** `extension/src/ui/lib/notification-bridge.ts`

This module runs in the UI context and sends events to the service worker.

```typescript
import type { ProgressStats } from '../../lib/notifications';

class NotificationBridge {
  private lastProgressMessage: string = '';
  private throttleTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingStats: ProgressStats | null = null;

  constructor() {
    this.setupVisibilityTracking();
  }

  private setupVisibilityTracking(): void {
    // Send initial state
    this.sendVisibility(document.visibilityState === 'visible');

    // Track changes
    document.addEventListener('visibilitychange', () => {
      this.sendVisibility(document.visibilityState === 'visible');
    });
  }

  private sendVisibility(visible: boolean): void {
    chrome.runtime.sendMessage({
      type: 'notification:visibility',
      visible,
    });
  }

  /**
   * Call this from the engine's progress event handler.
   * Throttles updates to avoid spamming the SW.
   */
  updateProgress(stats: ProgressStats): void {
    this.pendingStats = stats;

    // Throttle to every 2 seconds
    if (this.throttleTimer === null) {
      this.sendProgressUpdate();
      this.throttleTimer = setTimeout(() => {
        this.throttleTimer = null;
        if (this.pendingStats) {
          this.sendProgressUpdate();
        }
      }, 2000);
    }
  }

  private sendProgressUpdate(): void {
    if (!this.pendingStats) return;

    chrome.runtime.sendMessage({
      type: 'notification:progress',
      stats: this.pendingStats,
    });
  }

  onTorrentComplete(infoHash: string, name: string): void {
    chrome.runtime.sendMessage({
      type: 'notification:torrent-complete',
      infoHash,
      name,
    });
  }

  onTorrentError(infoHash: string, name: string, error: string): void {
    chrome.runtime.sendMessage({
      type: 'notification:torrent-error',
      infoHash,
      name,
      error,
    });
  }

  onAllComplete(): void {
    chrome.runtime.sendMessage({
      type: 'notification:all-complete',
    });
  }
}

// Singleton instance
export const notificationBridge = new NotificationBridge();
```

---

### Task 4: Hook Bridge into Engine Events

**File:** `extension/src/ui/context/EngineContext.tsx` (or wherever engine events are handled)

Add imports and wire up events:

```typescript
import { notificationBridge } from '../lib/notification-bridge';
import type { ProgressStats } from '../../lib/notifications';

// In the component/hook that manages the engine:

useEffect(() => {
  if (!engine) return;

  // Track for all-complete detection
  let previousActiveCount = 0;

  const handleProgress = () => {
    const torrents = engine.torrents;
    const activeTorrents = torrents.filter(t => t.userState === 'active' && !t.isComplete);
    const errorTorrents = torrents.filter(t => t.hasError); // Adjust based on actual API

    const stats: ProgressStats = {
      activeCount: activeTorrents.length,
      errorCount: errorTorrents.length,
      downloadSpeed: torrents.reduce((sum, t) => sum + (t.downloadSpeed || 0), 0),
      eta: calculateCombinedEta(activeTorrents), // implement this helper
      singleTorrentName: activeTorrents.length === 1 ? activeTorrents[0].name : undefined,
    };

    // Detect transition to all complete
    if (previousActiveCount > 0 && stats.activeCount === 0) {
      notificationBridge.onAllComplete();
    }
    previousActiveCount = stats.activeCount;

    notificationBridge.updateProgress(stats);
  };

  const handleTorrentComplete = (torrent: Torrent) => {
    notificationBridge.onTorrentComplete(
      toHex(torrent.infoHash),
      torrent.name || 'Unknown'
    );
  };

  const handleTorrentError = (error: Error, torrent?: Torrent) => {
    if (torrent) {
      notificationBridge.onTorrentError(
        toHex(torrent.infoHash),
        torrent.name || 'Unknown',
        error.message
      );
    }
  };

  // Subscribe to engine events
  engine.on('torrent-complete', handleTorrentComplete);
  // engine.on('error', handleTorrentError); // wire up as appropriate

  // Poll for progress updates
  const progressInterval = setInterval(handleProgress, 1000);

  return () => {
    engine.off('torrent-complete', handleTorrentComplete);
    clearInterval(progressInterval);
  };
}, [engine]);

// Helper function for combined ETA calculation
function calculateCombinedEta(activeTorrents: Torrent[]): number | null {
  // Return the maximum ETA among all active torrents
  // (i.e., when will all torrents be done)
  let maxEta: number | null = null;
  
  for (const torrent of activeTorrents) {
    const eta = torrent.eta; // Adjust based on actual API
    if (eta !== null && eta !== undefined) {
      if (maxEta === null || eta > maxEta) {
        maxEta = eta;
      }
    }
  }
  
  return maxEta;
}
```

---

### Task 5: Add Settings UI (Optional, can be deferred)

Create a settings section in the UI to toggle notification preferences. Load from and save to `chrome.storage.sync` with key `'notificationSettings'`.

This can be deferred - the defaults are sensible for initial testing.

---

## Testing Checklist

### Event Notifications (progressWhenBackgrounded: false)

- [ ] Start a download, complete it → "Download Complete" notification appears
- [ ] Multiple downloads complete rapidly → Multiple notifications stack (each has unique ID)
- [ ] Torrent errors → "Download Error" notification appears
- [ ] All torrents finish → "All downloads complete" notification
- [ ] Click notification → UI tab focused/created, notification cleared

### Persistent Progress (progressWhenBackgrounded: true)

- [ ] Enable setting, start downloads, background UI tab
- [ ] → Persistent notification appears with count, speed, ETA
- [ ] Notification updates as progress changes (silently, no repeated sounds)
- [ ] Error occurs → Notification shows error count folded in
- [ ] Complete a torrent → No separate notification (suppressed by persistent)
- [ ] All complete → Notification changes to "All downloads complete"
- [ ] Foreground UI tab → Persistent notification clears
- [ ] Click notification → UI focused, notification cleared

### Settings Respect

- [ ] Disable onTorrentComplete → No notifications on complete
- [ ] Disable onError → No notifications on error
- [ ] Disable onAllComplete → No "all complete" notification

### Edge Cases

- [ ] UI tab closed entirely (not just backgrounded) → Notifications still work
- [ ] Multiple UI tabs (shouldn't happen, but don't crash)
- [ ] Very long torrent names → Truncated gracefully in notification

---

## File Summary

| File | Purpose |
|------|---------|
| `extension/src/lib/notifications.ts` | NotificationManager class - all notification logic |
| `extension/src/sw.ts` | Service worker - instantiate manager, route messages |
| `extension/src/ui/lib/notification-bridge.ts` | UI-side bridge - visibility tracking, event forwarding |
| `extension/src/ui/context/EngineContext.tsx` | Hook bridge into engine events |

---

## Notes for Implementer

1. **Check actual Torrent API:** The code samples reference `torrent.name`, `torrent.downloadSpeed`, `torrent.eta`, `torrent.isComplete`, `torrent.hasError`. Verify these exist or adjust to match actual API.

2. **Engine error events:** The engine emits errors but may not always have a torrent context. Handle gracefully.

3. **Icon path:** Verify `/icons/js-128.png` is correct relative path from service worker context. May need `chrome.runtime.getURL()`.

4. **Type imports:** The `ProgressStats` and `NotificationSettings` types should be exported from `notifications.ts` and imported where needed.

5. **Lint/TypeScript:** Run `pnpm lint` and `pnpm tsc` in the extension directory after implementation.

---

## Future Enhancements

- Action buttons on notifications (e.g., "Open Folder" on complete)  
- Notification sound customization
- Per-torrent notification preferences
- Offscreen document support (engine runs in background, SW has direct access to events)
