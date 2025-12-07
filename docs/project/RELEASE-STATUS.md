# JSTorrent Release Status

*Last updated: December 2025*

## Current State: Working Beta

The core functionality works end-to-end:
- ✅ Add torrents (magnet links, .torrent files)
- ✅ Download from peers
- ✅ Multi-file torrents
- ✅ Session persistence (survives browser restart)
- ✅ Recheck existing data
- ✅ Seeding to peers
- ✅ Multiple simultaneous torrents
- ✅ Connection limits and backoff
- ✅ Tracker announce (HTTP and UDP)
- ✅ IO Bridge state machine (multi-platform connection management)
- ✅ ChromeOS support via Android IO daemon

## Release Blockers

### 1. Code Signing (Medium Priority)

**Status:** Not started

Native binaries ideally should be signed:
- **Windows:** Authenticode signing. Without it, SmartScreen shows scary warning (user clicks "More info" → "Run anyway" to bypass)
- **macOS:** Developer ID signing. Without it, Gatekeeper blocks by default (user right-clicks → "Open" to bypass)

**Cost options:**
- EV certs: $200-400+/year (instant SmartScreen reputation)
- OV certs: $70-150/year (reputation builds over time)
- Budget providers (Certum, etc.): ~$30-50/year for open source

**Soft launch option:** Release unsigned initially. Technical users (BitTorrent audience) can bypass warnings. Add signing later if user friction is too high.

### 2. Windows Testing (High Priority)

**Status:** Not tested yet (machine available)

Need to:
- Test native-host builds and runs
- Test installer (NSIS script exists but untested)
- Test native messaging registration
- Test file paths (backslash handling)

### 3. macOS Testing (Medium Priority)

**Status:** Not tested

Need to:
- Test native-host builds
- Test installer (pkgbuild script exists)
- Test native messaging registration
- Test Gatekeeper behavior (right-click → Open bypasses)

**Blocker:** No macOS machine available

### 4. ChromeOS Storage Access (Medium Priority)

**Status:** Partially complete

Current state:
- ✅ Android IO daemon works
- ✅ Extension connects via HTTP to Android container
- ⏳ Files download to Android app private storage (not visible to user)

Need to:
- Implement Storage Access Framework (SAF) folder picker
- Allow user to select visible download location
- Or document workaround (file manager can access Android/data/...)

## Known Limitations (Not Blocking)

### Listening Socket

Engine doesn't bind a listening port for incoming peer connections. Only outgoing connections work.

**Impact:** Slightly reduced peer connectivity. Many clients work fine outgoing-only.

**Future:** Implement after initial release.

### DHT

No DHT support. Relies entirely on trackers for peer discovery.

**Impact:** Trackerless torrents won't work. Most public torrents have trackers.

**Future:** Nice to have, not blocking.

### uTP

No uTP (UDP-based transport). TCP only.

**Impact:** Some ISPs throttle TCP BitTorrent traffic. uTP can help avoid this.

**Future:** Nice to have, not blocking.

### Protocol Encryption

No MSE/PE (Message Stream Encryption).

**Impact:** Some ISPs or networks may block unencrypted BitTorrent.

**Future:** Nice to have, not blocking.

## Infrastructure

### IO Bridge

✅ **Complete.** The IO Bridge state machine handles:
- Desktop: Native messaging connection with auto-retry
- ChromeOS: HTTP connection to Android container with launch prompts
- Connection status indicator in toolbar
- System Bridge panel for configuration

### Observability

Need telemetry for crash reports and usage analytics.

**Approach:** Google Analytics (free). Must scrub sensitive info from stack traces - remove `.name`, `.infoHash`, file paths, and similar PII/content-identifying data before sending.

### Update Mechanism

Extension checks native-host version on startup. If outdated, prompts user to download and re-run the installer.

Lightweight initial approach - no auto-update daemon.

### Build & Release

Installers built on GitHub Actions (`.github/workflows/`). No manual upload needed.

## Test Coverage

### What's Tested

| Layer | Coverage | Notes |
|-------|----------|-------|
| Engine unit tests | Good | Core logic, protocol, utilities |
| Python integration | Good | Real downloads against libtorrent |
| IO Bridge unit tests | Good | State machine transitions |
| Extension E2E | Basic | Extension loads, daemon connects |
| Native host | Good | Python verify_*.py scripts |
| Android daemon | Basic | Throughput benchmarks |

### Skip List (Known Issues)

Currently no tests in skip list. All integration tests passing.

## UI Completeness

### Done
- ✅ Torrent list with virtualized table
- ✅ Detail pane with tabs (Peers, Pieces, Files, General, Logs)
- ✅ Multi-select with Shift+click
- ✅ Context menu (right-click)
- ✅ Column sorting, resizing, reordering
- ✅ Download root selection
- ✅ Settings persistence
- ✅ System Bridge indicator (connection status in toolbar)
- ✅ System Bridge panel (connection config dropdown)
- ✅ Log viewer tab

### Remaining
- Tracker tab in detail pane
- File priority selection (files tab exists but no priority control)
- Bandwidth limiting UI
- Preferences/settings dialog
- Polish and edge cases

## Platform Status

| Platform | Engine | I/O Daemon | Connection | Testing |
|----------|--------|------------|------------|---------|
| Linux | ✅ | ✅ Rust | ✅ Native messaging | ✅ Primary dev |
| Windows | ✅ | ✅ Rust | ✅ Native messaging | ⏳ Needs testing |
| macOS | ✅ | ✅ Rust | ✅ Native messaging | ⏳ Needs testing |
| ChromeOS | ✅ | ✅ Kotlin | ✅ HTTP to Android | ✅ Tested |

## Release Checklist

### Pre-Release
- [ ] Windows testing complete
- [ ] macOS testing complete (need machine access)
- [ ] Code signing decision (signed vs soft launch unsigned)
- [ ] Chrome Web Store developer account
- [ ] Extension listing assets (screenshots, description)
- [ ] Play Store listing for Android companion (unlisted beta)
- [ ] Observability/analytics integration

### Release
- [ ] Tag release (triggers GitHub Actions build)
- [ ] Verify installers in GitHub Releases
- [ ] Submit extension to Chrome Web Store
- [ ] Upload Android APK to Play Store (unlisted)
- [ ] Update website with install instructions

### Post-Release
- [ ] Monitor crash reports / analytics
- [ ] Handle user feedback on unsigned binary warnings (if applicable)
- [ ] Notify waitlist from Chrome App deprecation banner
