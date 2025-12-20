# JSTorrent Release Status

*Last updated: December 20, 2025*

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
- ✅ DHT (distributed hash table) for trackerless peer discovery
- ✅ Protocol encryption (MSE/PE)
- ✅ IO Bridge state machine (multi-platform connection management)
- ✅ ChromeOS support via Android IO daemon

## Release Blockers

### 1. Code Signing

**macOS:** ✅ Complete - Developer ID signing working, integrated into CI

**Windows:** ⏳ In progress - Using Azure Trusted Signing, but identity verification is failing repeatedly. Investigating.

### 2. Windows Testing

**Status:** ✅ Complete

Tested extensively. File associations working well. Basic flows solid.

### 3. macOS Testing

**Status:** ✅ Complete

Tested extensively. File associations working well. Basic flows solid. Code signing verified.

### 4. ChromeOS Storage Access (Complete)

**Status:** ✅ Complete

- ✅ Android IO daemon works
- ✅ Extension connects via HTTP to Android container
- ✅ Storage Access Framework (SAF) folder picker implemented
- ✅ Files download to user-selected folders (visible in ChromeOS Files app)
- ✅ Random access writes via ParcelFileDescriptor (O(write_size), not O(file_size))
- ✅ Cloud storage providers (Google Drive, Dropbox, etc.) rejected with user-friendly message
- ✅ Removable storage (SD cards, USB drives) supported with availability tracking

## Known Limitations (Not Blocking)

### uTP

No uTP (UDP-based transport). TCP only.

**Impact:** Some ISPs throttle TCP BitTorrent traffic. uTP can help avoid this.

**Future:** Deferred for initial release. Complex to implement correctly.

## Infrastructure

### IO Bridge

✅ **Complete.** The IO Bridge state machine handles:
- Desktop: Native messaging connection with auto-retry
- ChromeOS: HTTP connection to Android container with launch prompts
- Connection status indicator in toolbar
- System Bridge panel for configuration

### Secure ChromeOS Pairing

✅ **Complete.** The extension↔Android auth flow:
- HTTP-based pairing over trusted channel (100.115.92.2)
- Origin header validation (blocks local Android apps from spoofing)
- User approval dialog for new pairings
- Silent re-pairing for same extension reinstalls
- Unified AUTH format across desktop and ChromeOS (authType=0 + null-separated fields)
- Automatic 401 recovery (token mismatch triggers re-pairing flow)

### Observability

**Status:** Not implemented yet. Can be deferred for initial release.

Need telemetry for crash reports and usage analytics. Approach: Google Analytics (free). Must scrub sensitive info from stack traces.

### Update Mechanism

**Status:** Basic version check exists. No auto-update.

Extension checks native-host version on startup. If outdated, prompts user to download and re-run the installer.

**Future:** Would like better "please update native host" messaging. Can be deferred for initial release.

### Build & Release

Installers built on GitHub Actions (`.github/workflows/`). No manual upload needed.

## Test Coverage

### What's Tested

| Layer | Coverage | Notes |
|-------|----------|-------|
| Engine unit tests | Good | Core logic, protocol, utilities |
| Python integration | Good | Real downloads against libtorrent |
| IO Bridge unit tests | Good | State machine transitions |
| Session persistence | Good | Stop/resume lifecycle, JSON storage |
| Extension E2E | Basic | Extension loads, daemon connects |
| Native host | Good | Python verify_*.py scripts |
| Android daemon | Good | Unit tests + throughput benchmarks |


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
- File priority selection (files tab exists but no priority control)

## Platform Status

| Platform | Engine | I/O Daemon | Connection | Testing |
|----------|--------|------------|------------|---------|
| Linux | ✅ | ✅ Rust | ✅ Native messaging | ✅ Tested |
| Windows | ✅ | ✅ Rust | ✅ Native messaging | ✅ Tested |
| macOS | ✅ | ✅ Rust | ✅ Native messaging | ✅ Tested |
| ChromeOS | ✅ | ✅ Kotlin | ✅ HTTP to Android | ✅ Tested |

## Release Checklist

### Pre-Release
- [x] Windows testing complete
- [x] macOS testing complete
- [x] macOS code signing (Developer ID, CI integrated)
- [ ] Windows code signing (Azure Trusted Signing - identity verification blocked)
- [x] Chrome Web Store developer account
- [ ] Extension listing assets (screenshots, description)
- [ ] Observability/analytics integration (deferred)

### Release
- [x] Tag release (triggers GitHub Actions build)
- [ ] Verify installers in GitHub Releases
- [x] Submit extension to Chrome Web Store (unlisted)
- [x] Submit Android app to Play Store (in review)
- [ ] Update website with install instructions

### Post-Release
- [ ] Monitor crash reports / analytics
- [ ] Handle user feedback on unsigned Windows binary warnings
- [ ] Notify waitlist from Chrome App deprecation banner
