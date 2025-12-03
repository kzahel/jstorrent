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
| Extension E2E | Basic | Extension loads, daemon connects |
| Native host | Good | Python verify_*.py scripts |

### Skip List (Known Issues)

Currently no tests in skip list. All integration tests passing.

## UI Completeness

### Done
- Torrent list with virtualized table
- Detail pane (Peers, Pieces tabs)
- Multi-select with Shift+click
- Context menu (right-click)
- Column sorting, resizing
- Download root selection
- Settings persistence

### Remaining
- Tracker tab in detail pane
- Files tab in detail pane (file priority)
- Bandwidth limiting UI
- Preferences/settings dialog
- Polish and edge cases

## Release Checklist

### Pre-Release
- [ ] Windows testing complete
- [ ] macOS testing complete (need machine access)
- [ ] Code signing decision (signed vs soft launch unsigned)
- [ ] Chrome Web Store developer account
- [ ] Extension listing assets (screenshots, description)
- [ ] Observability/analytics integration

### Release
- [ ] Tag release (triggers GitHub Actions build)
- [ ] Verify installers in GitHub Releases
- [ ] Submit extension to Chrome Web Store
- [ ] Update website with install instructions

### Post-Release
- [ ] Monitor crash reports / analytics
- [ ] Handle user feedback on unsigned binary warnings (if applicable)
