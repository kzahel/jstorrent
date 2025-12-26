# Flud Android App - Feature & UI Catalog

**Purpose:** Reference for building JSTorrent Android standalone app with Jetpack Compose + QuickJS  
**Date:** December 26, 2025  
**Source:** 24 screenshots from Flud torrent client

---

## Executive Summary

Flud is a mature, feature-rich Android torrent client that serves as the gold standard for mobile torrent UI. This document catalogs every screen and feature to inform JSTorrent's Android UI development.

**Key Takeaways:**
- Clean Material Design with dark theme (teal accent color)
- Tab-based navigation for torrent details (6 tabs)
- Comprehensive settings organized into 9+ categories
- Strong focus on power/battery management (Android-specific)
- RSS feed support for automated downloads

---

## 1. Main Torrent List Screen

### Layout
- **App bar:** App name ("Flud"), search icon, add link icon, sort icon, overflow menu
- **Tab bar:** ALL | QUEUED | FINISHED (filter tabs)
- **Status banner:** Network status warnings (e.g., "Wifi is unavailable. All torrents have been paused.")
- **FAB:** "+ Add torrent" button (bottom right, magenta/pink accent)

### Torrent Card Components
| Element | Description |
|---------|-------------|
| Play/Pause button | Circular teal button on left |
| Torrent name | Primary text, truncated with ellipsis |
| Status line | "Paused • 100%" or "Downloading • 45%" |
| Size/Speed line | "2.0 GB/2.0 GB • 0.0 KB/s ↑" |
| Progress bar | Thin horizontal bar under name (teal) |

### Overflow Menu Options
| Option | Icon | Notes |
|--------|------|-------|
| Feeds | RSS icon | RSS/Atom feed subscriptions |
| Resume all | Play icon | Global resume |
| Pause all | Pause icon | Global pause |
| Modify queue | Sliders icon | Reorder torrents |
| Session status | Chart icon | Global statistics |
| Settings | Gear icon | App settings |
| Rate this app | Thumbs up | Play Store rating |
| Get ad-free version | Cart icon | IAP |
| Shutdown | Power icon | Stop all and exit |

### Sort Options Dialog
- Queue number (default)
- Name
- Date added
- Date finished
- Download speed
- Upload speed
- ETA

---

## 2. Torrent Detail Screen

### Navigation
- **Back arrow** returns to list
- **Title bar:** Torrent name (truncated)
- **Action icons:** Play/Pause, Recheck, Overflow menu
- **Tab bar:** Horizontally scrollable tabs

### Tab Structure (6 tabs)

#### 2.1 DETAILS Tab
| Field | Value Example | Editable |
|-------|---------------|----------|
| NAME | ubuntu-22.04.5-live-server-amd64.iso | ✏️ Yes |
| STORAGE PATH | /storage/emulated/0/Download/Flud | ✏️ Yes |
| Free space indicator | "14.9 GB free" | — |
| TOTAL SIZE | 2.0 GB | — |
| NUMBER OF FILES | 1 | — |

**TORRENT SETTINGS section:**
- [ ] Enable sequential download
- [ ] Download first and last pieces first

**Timestamps (bottom):**
- Added: 12/25 5:20:03 AM
- Completed: 12/25 1:33:29 PM

#### 2.2 STATUS Tab
| Metric | Value | Layout |
|--------|-------|--------|
| Torrent name | Full name | Header |
| Status badge | "Paused" / "Downloading" | Below name |
| Progress | "100%" | Right of status |
| Progress bar | Full width, teal | Below status |
| Download speed | "0.0 KB/s ↓" | Left column |
| Upload speed | "0.0 KB/s ↑" | Right column |
| DOWNLOADED | "2.0 GB/2.0 GB" | Left |
| ETA | "∞" or time remaining | Right |
| LEECHERS | "0 (31)" - connected (total) | Left |
| SEEDERS | "0 (1,341)" | Right |
| UPLOADED | "5.4 MB" | Left |
| SHARE RATIO | "0.003" | Right |
| ACTIVE TIME | "22 h 33 m" | Left |
| SEEDING TIME | "16 h 31 m" | Right |
| AVAILABILITY | "1.00" | Left |
| PIECES | "8,152/8,152 (256.0 KB)" | Right |

#### 2.3 FILES Tab
**Filter bar:**
- 🔍 Search (expandable)
- Finished (chip/toggle)
- Not finished (chip/toggle)

**Header:** "SELECT FILES TO DOWNLOAD" (teal text)

**File row:**
| Element | Description |
|---------|-------------|
| File icon | Document icon (left) |
| File name | Truncated if long |
| Progress bar | Below name, teal |
| Size info | "2.0 GB/2.0 GB • Finished" |
| Checkbox | Right side, for selection |

#### 2.4 TRACKERS Tab
**Built-in sources (bold with asterisks in Flud):**
| Source | Status |
|--------|--------|
| \*\*DHT\*\* | OK (green) |
| \*\*LSD\*\* | OK (green) |
| \*\*PeX\*\* | OK (green) |

**Tracker URLs:**
| URL | Status |
|-----|--------|
| https://torrent.ubuntu.com/announce | OK (green) |
| https://ipv6.torrent.ubuntu.com/announce | Not contacted yet |

**Action:** "+ Add trackers" button (teal, centered)

#### 2.5 PEERS Tab
**Empty state:**
- Centered text: "This torrent has not connected to any peers yet."
- Button: "+ Add peers" (teal)

**Peer row (when populated):**
- IP:Port
- Client name
- Download/Upload speeds
- Progress percentage
- Flags (encryption, etc.)

#### 2.6 PIECES Tab
| Metric | Value |
|--------|-------|
| PIECES | 8,152/8,152 |
| PIECE SIZE | 256.0 KB |

**PIECE MAP:**
- Visual grid/bars showing piece completion
- Solid teal = complete
- Empty = missing

### Torrent Overflow Menu
| Option | Icon | Description |
|--------|------|-------------|
| Force reannounce | Download arrow | Re-contact trackers |
| Share magnet link | Share icon | Copy/share magnet URI |
| Save torrent file | Floppy icon | Export .torrent |
| Remove torrent | Trash icon | Delete from app |
| Torrent settings | Gear icon | Per-torrent settings |

### Torrent Settings Dialog
- Edit trackers
- Maximum download speed
- Maximum upload speed

---

## 3. Settings Screens

### Settings Categories (Main Menu)
1. Storage
2. Bandwidth
3. Torrent
4. Interface
5. Network
6. Privacy & Security
7. Power management
8. Feeds
9. Scheduling
10. Advanced
11. About

---

### 3.1 Storage Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| **Storage path** | Path picker | /storage/emulated/0/Download/Flud | Download location |
| **Move after download** | | | *Section header* |
| Move after download | Toggle | Off | Auto-move completed |
| Move completed to location | Path picker | (same as above) | Destination |
| **Copy torrent files** | | | *Section header* |
| Copy torrent files | Toggle | Off | Save .torrent for magnets |
| Copy torrent files to location | Path picker | (same) | Destination |
| **Watch incoming directory** | | | *Section header* |
| Watch incoming directory | Toggle | Off | Auto-add .torrent files |
| Directory to watch | Path picker | — | Source folder |

---

### 3.2 Bandwidth Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| **Bandwidth** | | | *Section header* |
| Maximum download speed | Number input | 0 (unlimited) | KB/s |
| Maximum upload speed | Number input | 0 (unlimited) | KB/s |
| **Connection settings** | | | *Section header* |
| Maximum number of connections | Number input | 200 | Global limit |

---

### 3.3 Torrent Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| **Queue** | | | *Section header* |
| Maximum active downloads | Number | 3 | Concurrent downloads |
| Maximum active uploads | Number | 3 | Concurrent seeds |
| Maximum active torrents | Number | 5 | Total active |
| Add new torrents on top of queue | Toggle | ✓ On | Queue position |
| **Default settings** | | | *Section header* |
| Default trackers | Text area | — | Added to all torrents |
| Sequential download | Toggle | Off | Default for new |
| Download first and last pieces first | Toggle | Off | For media preview |

---

### 3.4 Interface Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| Theme | Picker | Dark | Light/Dark/System |
| Piece map style | Picker | Lines | Visual style |
| **Notification settings** | | | *Section header* |
| Torrent finish notification | Toggle | ✓ On | Notify on complete |
| Play notification sound | Toggle | Off | Audio alert |

---

### 3.5 Network Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| **Port settings** | | | *Section header* |
| Use random port | Toggle | ✓ On | Range: 49152-65535 |
| Set a port number | Number | 55623 | Fixed port option |
| **Network extras** | | | *Section header* |
| Enable DHT | Toggle | ✓ On | Distributed hash table |
| Enable LSD | Toggle | ✓ On | Local peer discovery |
| Enable UPnP | Toggle | ✓ On | Auto port forward |
| Enable NAT-PMP | Toggle | ✓ On | Apple port mapping |
| Enable peer exchange | Toggle | ✓ On | PeX |
| Contact all trackers | Toggle | Off | Multi-tracker |
| Enable uTP | Toggle | Off | UDP transport |

---

### 3.6 Privacy & Security Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| VPN only | Toggle | Off | Require VPN connection |
| **Encryption** | | | *Section header* |
| Incoming connections | Picker | Enabled | Disabled/Enabled/Forced |
| Outgoing connections | Picker | Enabled | Disabled/Enabled/Forced |
| Encryption level | Picker | Both | Full/Both |
| **Proxy settings** | | | *Section header* |
| Proxy settings | Picker | None | SOCKS4/SOCKS5/HTTP |
| **IP filtering** | | | *Section header* |
| Enable IP filtering | Toggle | Off | Block IP ranges |
| IP filter file | File picker | — | .dat, .p2p, .p2b formats |
| **Privacy settings** | | | *Section header* |
| Help make Flud better... | Toggle | Off | Usage statistics |
| Personalized ads | Toggle | — | Ad targeting |

---

### 3.7 Power Management Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| WiFi only | Toggle | ✓ On | No mobile data |
| Shutdown when downloads complete | Toggle | Off | Auto-exit app |
| Keep running in background | Toggle | Off | Even when paused |
| Keep CPU awake | Toggle | Off | Prevent sleep |
| **Battery settings** | | | *Section header* |
| Download/upload only when charging | Toggle | Off | Charger required |
| Enable battery limit | Toggle | Off | Pause at threshold |
| Battery level limit | Slider | 25% | Pause threshold |

---

### 3.8 Feeds Settings (RSS)

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| Feed refresh interval | Number | 60 | Minutes |
| Remove old items | Toggle/Number | 5 days | Auto-cleanup |

---

### 3.9 Scheduling Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| Scheduled start time | Time picker | Disabled | Auto-start |
| Scheduled shutdown time | Time picker | Disabled | Auto-stop |
| Run only once | Toggle | Off | Single occurrence |
| Resume all | Toggle | Off | Resume on start |

---

### 3.10 Advanced Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| Network interface | Picker | Any interface | Bind to specific NIC |

**Interface options:** Any interface, dummy0, lo, rmnet16, rmnet17, etc.

---

### 3.11 About Screen

| Item | Type |
|------|------|
| About | Info dialog |
| Help in translation | Link |
| Get ad-free version | IAP link |
| Legal | Legal info |
| Privacy policy | Link |

---

## 4. JSTorrent Priority Matrix

### Phase 1: MVP (Must Have)

| Screen/Feature | Complexity | Notes |
|----------------|------------|-------|
| Main torrent list | Medium | Card layout, play/pause |
| Add torrent (magnet/file) | Medium | Intent handlers exist |
| Torrent detail - Status tab | Low | Display stats |
| Torrent detail - Files tab | Medium | File selection UI |
| Basic settings (storage path) | Low | SAF picker exists |
| Pause/Resume controls | Low | Engine supports |

### Phase 2: Core Features

| Screen/Feature | Complexity | Notes |
|----------------|------------|-------|
| Torrent detail - Trackers tab | Low | Display + add |
| Torrent detail - Peers tab | Low | Display only |
| Torrent detail - Pieces tab | Medium | Visual piece map |
| Bandwidth settings | Low | Speed limits |
| Network settings | Medium | DHT/LSD/UPnP toggles |
| Notifications | Medium | Android notification API |

### Phase 3: Polish

| Screen/Feature | Complexity | Notes |
|----------------|------------|-------|
| Sort/Filter torrents | Low | List manipulation |
| Search torrents | Low | Filter list |
| Torrent detail - Details tab | Low | Editable fields |
| Interface settings (theme) | Medium | Dynamic theming |
| Power management | Medium | Android battery APIs |
| Session statistics | Low | Global stats display |

### Phase 4: Advanced (Defer)

| Screen/Feature | Complexity | Notes |
|----------------|------------|-------|
| RSS Feeds | High | Full subsystem |
| Scheduling | Medium | Android WorkManager |
| IP filtering | High | Filter file parsing |
| Proxy support | High | Network config |
| Watch directory | Medium | FileObserver |
| Move after download | Medium | File operations |

---

## 5. Android-Specific Considerations

### Battery & Power
Flud has extensive battery management because torrenting is power-hungry:
- WiFi-only mode (pause on mobile data)
- Battery level threshold
- Download only when charging
- Keep CPU awake option
- Shutdown when complete

**JSTorrent approach:** Start with WiFi-only toggle, add others based on user feedback.

### Background Execution
- Foreground service with notification (already implemented in JSTorrent)
- "Keep running in background" option
- Scheduled start/stop times

### Storage
- SAF (Storage Access Framework) for user-selected folders
- Move/copy completed files
- Watch directory for auto-add

### Network
- VPN detection (pause if no VPN)
- Network interface binding
- Random vs. fixed port

---

## 6. UI Component Library Needs

### Jetpack Compose Components Required

| Component | Usage |
|-----------|-------|
| `LazyColumn` | Torrent list, settings lists |
| `Card` | Torrent cards |
| `TabRow` + `HorizontalPager` | Detail screen tabs |
| `TopAppBar` | Screen headers |
| `FloatingActionButton` | Add torrent |
| `ModalBottomSheet` | Dialogs, pickers |
| `LinearProgressIndicator` | Progress bars |
| `Checkbox` | File selection, toggles |
| `Switch` | Settings toggles |
| `Slider` | Battery threshold |
| `TextField` | Number inputs |
| `DropdownMenu` | Overflow menus |
| `AlertDialog` | Confirmations |
| `IconButton` | Action buttons |

### Custom Components Needed

| Component | Description |
|-----------|-------------|
| `TorrentCard` | Composite card with play button, progress, stats |
| `PieceMap` | Visual grid showing piece completion |
| `SpeedIndicator` | Formatted speed with arrow |
| `StatRow` | Label + value pair |
| `FileTreeItem` | File with checkbox and progress |
| `TrackerItem` | URL with status badge |
| `PeerItem` | Peer info row |

---

## 7. Color Scheme Reference

**Flud's palette (Dark theme):**

| Element | Color | Hex (approx) |
|---------|-------|--------------|
| Background | Near black | #121212 |
| Surface/Cards | Dark gray | #1E1E1E |
| Primary accent | Teal/Cyan | #00BCD4 |
| Secondary accent | Magenta/Pink | #E91E63 |
| Success/OK | Green | #4CAF50 |
| Text primary | White | #FFFFFF |
| Text secondary | Gray | #B3B3B3 |
| Dividers | Dark gray | #2A2A2A |
| Section headers | Teal | #00BCD4 |

---

## 8. Navigation Structure

```
Main List
├── [FAB] Add Torrent → Add dialog/sheet
├── [Overflow] Settings → Settings screen
│   ├── Storage
│   ├── Bandwidth
│   ├── Torrent
│   ├── Interface
│   ├── Network
│   ├── Privacy & Security
│   ├── Power management
│   ├── Feeds
│   ├── Scheduling
│   ├── Advanced
│   └── About
├── [Overflow] Feeds → Feed list
├── [Overflow] Session status → Stats dialog
└── [Tap torrent] → Torrent Detail
    ├── Details tab
    ├── Status tab
    ├── Files tab
    ├── Trackers tab
    ├── Peers tab
    └── Pieces tab
```

---

## Appendix: Screenshot Index

| # | File | Content |
|---|------|---------|
| 1 | 084612 | Torrent settings dialog |
| 2 | 084610 | Torrent overflow menu |
| 3 | 084606 | Pieces tab |
| 4 | 084603 | Peers tab (empty) |
| 5 | 084600 | Trackers tab |
| 6 | 084558 | Files tab |
| 7 | 084555 | Details tab |
| 8 | 084552 | Status tab |
| 9 | 084537 | Main list + overflow menu |
| 10 | 084529 | Sort dialog |
| 11 | 084518 | Main torrent list |
| 12 | 084511 | About screen |
| 13 | 084336 | Power management (top) |
| 14 | 084352 | Storage settings |
| 15 | 084344 | Power management (scrolled) |
| 16 | 084356 | Bandwidth settings |
| 17 | 084400 | Torrent settings |
| 18 | 084404 | Interface settings |
| 19 | 084409 | Network settings |
| 20 | 084429 | Privacy & Security (top) |
| 21 | 084444 | Privacy & Security (scrolled) |
| 22 | 084458 | Feeds settings |
| 23 | 084505 | Advanced - Network interface dialog |
| 24 | 084453 | Scheduling settings |
