# android

Kotlin I/O daemon for JSTorrent on ChromeOS (and experimental Android standalone).

Provides TCP/UDP sockets, file I/O, and hashing over HTTP/WebSocket. The BitTorrent engine runs in the browser; this app only handles low-level I/O.

## Requirements

- Android Studio (Arctic Fox or later)
- Android SDK 26+ (minSdk)
- ADB (comes with Android Studio)
- A ChromeOS device with Android container, or Android device/emulator

## Project Setup

```bash
# Clone and open in Android Studio
git clone <repo>
cd android
# Open in Android Studio: File → Open → select this folder
```

Sync Gradle when prompted.

## Building

### Debug Build

```bash
./gradlew assembleDebug
```

APK output: `app/build/outputs/apk/debug/app-debug.apk`

### Release Build

```bash
./gradlew assembleRelease
```

Requires signing config in `app/build.gradle.kts`.

## Installing

```bash
# Debug build to connected device
./gradlew installDebug

# Or manually
adb install app/build/outputs/apk/debug/app-debug.apk
```

## Running

Launch the app from the device. It starts an HTTP/WebSocket server on port 7800.

On ChromeOS, the extension connects to `http://100.115.92.2:7800`.

On Android standalone, open `http://localhost:7800` in a browser.

## Logging

### View all app logs

```bash
adb logcat -s JSTorrent:V
```

### Filter by tag

```bash
# WebSocket only
adb logcat -s JSTorrent.WS:V

# HTTP only  
adb logcat -s JSTorrent.HTTP:V

# Sockets only
adb logcat -s JSTorrent.Socket:V
```

### Clear and follow

```bash
adb logcat -c && adb logcat -s JSTorrent:V
```

### Save to file

```bash
adb logcat -s JSTorrent:V > debug.log
```

## Log Tags

| Tag | Component |
|-----|-----------|
| `JSTorrent` | General / startup |
| `JSTorrent.WS` | WebSocket server |
| `JSTorrent.HTTP` | HTTP endpoints |
| `JSTorrent.Socket` | TCP/UDP socket operations |
| `JSTorrent.File` | File read/write |
| `JSTorrent.Hash` | SHA1 hashing |

## Testing with curl

Once the app is running:

```bash
# Check if daemon is up (from device or adb shell)
curl http://localhost:7800/status

# Hash some bytes
echo -n "hello" | curl -X POST --data-binary @- http://localhost:7800/hash/sha1 | xxd
```

From ChromeOS Chrome DevTools:

```javascript
// Test connection
fetch('http://100.115.92.2:7800/status').then(r => r.text()).then(console.log)
```

## Pairing with Extension

The extension initiates pairing by opening:

```
intent://pair?token=<random>#Intent;scheme=jstorrent;package=com.jstorrent;end
```

The app receives the token via intent filter and stores it. Subsequent WebSocket connections must send this token in the AUTH handshake.

## Architecture

The codebase is split into three Gradle modules:

```
┌──────────────────────────────────────────────────────────────────┐
│  app module (com.jstorrent.app)                                  │
│  ├── Activities: MainActivity, StandaloneActivity, AddRoot...   │
│  ├── Service: IoDaemonService (foreground service)              │
│  ├── Mode: ModeDetector (companion vs standalone routing)       │
│  ├── Auth: TokenStore (SharedPreferences)                       │
│  ├── Storage: RootStore, DownloadRoot                           │
│  └── Bridges: KVBridge, RootsBridge (WebView JS interfaces)     │
└──────────────────────────────────────────────────────────────────┘
                         │ depends on
          ┌──────────────┴──────────────┐
          ▼                              ▼
┌─────────────────────────┐    ┌─────────────────────────────────┐
│  companion-server       │    │  io-core                         │
│  (HTTP/WebSocket layer) │    │  (Pure I/O, no HTTP deps)        │
│                         │    │                                   │
│  • CompanionHttpServer  │    │  • TcpSocketService               │
│  • IoWebSocketHandler   │    │  • UdpSocketManagerImpl           │
│  • ControlWebSocketHandler│  │  • FileManagerImpl                │
│  • FileRoutes           │    │  • Protocol (opcodes, framing)    │
│  • SocketManagerFactory │    │  • Hasher (SHA1/SHA256)           │
└─────────────────────────┘    └─────────────────────────────────┘
          │ depends on                    │
          └───────────────────────────────┘
```

### Module Responsibilities

- **io-core**: Pure I/O library with zero HTTP dependencies. Contains TCP/UDP socket services, file manager, protocol definitions, and hashing utilities. Designed for reuse with future Hermes JS engine integration.

- **companion-server**: HTTP/WebSocket adapter layer using Ktor. Wraps io-core operations and exposes them over WebSocket for the Chrome extension.

- **app**: Android-specific code including Activities, Services, storage, and authentication.

## Key Files

```
app/src/main/java/com/jstorrent/app/
├── MainActivity.kt           # Companion mode UI, mode routing
├── StandaloneActivity.kt     # Standalone WebView app
├── service/
│   └── IoDaemonService.kt    # Foreground service, starts server
├── mode/
│   └── ModeDetector.kt       # ChromeOS vs Android detection
├── auth/
│   └── TokenStore.kt         # Pairing token storage
├── storage/
│   ├── RootStore.kt          # Download roots persistence
│   └── DownloadRoot.kt       # Root data class
└── CompanionServerDepsImpl.kt # Wires app deps to companion-server

companion-server/src/main/java/com/jstorrent/companion/server/
├── CompanionHttpServer.kt    # Ktor HTTP/WS server
├── IoWebSocketHandler.kt     # Socket multiplexing over WS
├── ControlWebSocketHandler.kt# Control plane (events, roots)
├── FileRoutes.kt             # /read, /write endpoints
└── SocketManagerFactory.kt   # Creates per-session socket services

io-core/src/main/java/com/jstorrent/io/
├── protocol/Protocol.kt      # Opcodes, framing
├── socket/
│   ├── TcpSocketService.kt   # TCP connection management
│   ├── UdpSocketManagerImpl.kt# UDP socket management
│   └── *Callback.kt          # Event callbacks
├── file/
│   ├── FileManager.kt        # Interface
│   └── FileManagerImpl.kt    # SAF file I/O
└── hash/Hasher.kt            # Hashing utilities
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | HTML shell (Android standalone) |
| GET | `/status` | Daemon status JSON |
| WS | `/io` | TCP/UDP multiplexing |
| GET | `/read/{root}` | Read file bytes |
| POST | `/write/{root}` | Write file bytes |
| POST | `/hash/sha1` | SHA1 hash bytes |

See `chromeos-strategy.md` for full protocol details.

## Troubleshooting

### Can't connect from Chrome on ChromeOS

1. Check app is running: `adb shell ps | grep jstorrent`
2. Check port is listening: `adb shell netstat -tlnp | grep 7800`
3. Check extension has `host_permissions` for `http://100.115.92.2/*`

### Connection refused

Port 7800 may be in use. Check logcat for actual port:

```bash
adb logcat -s JSTorrent:V | grep "listening"
```

### WebSocket disconnects immediately

Check AUTH token matches. The extension and app must have paired first.

### Daemon dies in background

On some devices, battery optimization kills the service. Either:
- Show a foreground notification (recommended)
- Request user to disable battery optimization for the app

## Local Emulator Development (No Android Studio)

### Quick Start

```bash
# One-time setup (downloads SDK, creates phone + tablet AVDs)
./scripts/setup-emulator.sh

# Add to ~/.zshrc (setup script prints the exact lines)
export ANDROID_HOME="$HOME/.android-sdk"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"

# Start phone emulator (default)
./scripts/emu-start.sh

# Or start tablet emulator
AVD_NAME=jstorrent-tablet ./scripts/emu-start.sh

# Build and install APK
./scripts/emu-install.sh

# Watch logs
./scripts/emu-logs.sh
```

### Shell Integration

Source the environment script for convenience aliases:

```bash
source scripts/android-env.sh

# Now you can use:
emu start     # Start emulator
emu stop      # Stop emulator
emu install   # Build and install
emu logs      # Watch logs
emu phone     # Start phone emulator
emu tablet    # Start tablet emulator
```

### Phone vs Tablet

Two AVDs are created by setup:

| AVD Name | Device | Use Case |
|----------|--------|----------|
| `jstorrent-dev` | Pixel 6 (phone) | Default, quick iteration |
| `jstorrent-tablet` | Pixel Tablet | ChromeOS-like form factor |

Switch between them:

```bash
# Using env var
AVD_NAME=jstorrent-tablet ./scripts/emu-start.sh

# Or with shell integration (source android-env.sh first)
emu phone    # Start phone
emu tablet   # Start tablet
```

Only one emulator runs at a time. `emu-stop.sh` stops whichever is running.

### Disk Usage

Approximate sizes:
- Command-line tools: ~150MB
- Platform tools: ~50MB
- Emulator: ~400MB
- System image: ~1.2GB
- AVD phone (created): ~2-4GB
- AVD tablet (created): ~2-4GB

Total: ~6-10GB

### Known Emulator Limitations

**UDP does not work in the Android emulator.** This is a known Android emulator limitation. DHT and UDP trackers will not function when running in the emulator.

While Linux has a workaround using host TAP network interfaces, the setup is complex and not recommended. For testing UDP functionality (DHT, UDP trackers), use a real Android device or ChromeOS with the Android container.

## UI Mode (Standalone Full vs Light)

The app supports two UI modes:

| Mode | HTML Path | Description |
|------|-----------|-------------|
| `standalone` (default) | `standalone/standalone.html` | Lightweight UI |
| `full` | `standalone_full/standalone_full.html` | Full-featured UI |

The last used mode is saved and restored automatically on next launch.

### Switching UI Mode

Pass `ui_mode` as an intent extra:

```bash
# Full UI (saves preference)
adb shell am start -n com.jstorrent.app/.StandaloneActivity --es ui_mode full

# Light UI (saves preference)
adb shell am start -n com.jstorrent.app/.StandaloneActivity --es ui_mode standalone

# Use last saved mode
adb shell am start -n com.jstorrent.app/.StandaloneActivity
```

With shell integration:

```bash
source scripts/android-env.sh
emu start
emu install
adb shell am start -n com.jstorrent.app/.StandaloneActivity --es ui_mode full
```
