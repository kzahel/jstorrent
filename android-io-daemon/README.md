# android-io-daemon

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
cd android-io-daemon
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

```
┌─────────────────────────────────────────┐
│  MainActivity                           │
│  - Pairing UI                           │
│  - Start/stop service                   │
│  - Status display                       │
└─────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────┐
│  DaemonService (Foreground Service)     │
│  - Ktor HTTP server                     │
│  - WebSocket endpoint /io               │
│  - Manages socket/file state            │
└─────────────────────────────────────────┘
                    │
        ┌───────────┼───────────┐
        ▼           ▼           ▼
   SocketManager  FileManager  HashManager
   (TCP/UDP)      (read/write) (SHA1)
```

## Key Files

```
app/src/main/java/com/jstorrent/
├── MainActivity.kt       # UI, pairing, service control
├── DaemonService.kt      # Foreground service, Ktor server
├── SocketManager.kt      # TCP/UDP socket multiplexing
├── FileManager.kt        # File read/write operations
├── HashManager.kt        # SHA1 hashing
└── Protocol.kt           # WebSocket frame parsing, opcodes
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
