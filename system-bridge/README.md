# system-bridge

Native subsystem for the JSTorrent Chrome extension on **Windows, macOS, and Linux**. Provides filesystem access, network sockets, and system integration (magnet links, .torrent file handling) that the browser cannot perform directly.

For **ChromeOS**, see [android](../android/) which provides similar functionality.

## Architecture

```
Chrome Extension
       ↓ Native Messaging
jstorrent-host ──→ manages rpc-info.json
       ↓ spawns
jstorrent-io-daemon ←── HTTP/WebSocket ── Extension
       ↑
jstorrent-link-handler (OS-level magnet/torrent handler)
```

| Component | Description |
|-----------|-------------|
| **host** | Native messaging coordinator launched by Chrome. Manages io-daemon lifecycle and download roots. |
| **io-daemon** | High-performance I/O process providing file and socket APIs via HTTP/WebSocket. |
| **link-handler** | OS-level handler for magnet: links and .torrent files. |
| **common** | Shared data structures and utilities. |

See [DESIGN.md](DESIGN.md) for detailed architecture documentation.

## Prerequisites

- Rust toolchain (stable) - install via [rustup](https://rustup.rs/)
- Python 3.9+ with [uv](https://docs.astral.sh/uv/) (for testing)

## Building

```bash
# From system-bridge directory

# Debug build
cargo build

# Release build
cargo build --release

# Build single component
cargo build -p jstorrent-host
```

Binaries are output to `target/debug/` or `target/release/`.

## Local Development Installation

These scripts build and install in one step.

### macOS
```bash
./scripts/install-local-macos.sh
```
Installs to `~/Library/Application Support/JSTorrent` and `~/Applications/JSTorrent.app`.

### Linux
```bash
./scripts/install-local-linux.sh
```

### Windows
```cmd
scripts\install-local-windows.bat
```

## Testing

The project uses Python integration tests via `uv`:

```bash
# Run all verification tests
uv run verify_all.py

# Run individual tests
uv run verify_file_api_v2.py
uv run verify_magnet.py
uv run verify_hashing.py
```

## Building Installers

```bash
# macOS .pkg installer
./scripts/build-macos-installer.sh

# Linux installer
./scripts/build-linux-installer.sh

# Windows installer
scripts\build-windows-installer.bat
```

## Configuration

Config directory locations:
- **macOS:** `~/Library/Application Support/jstorrent-native/`
- **Linux:** `~/.config/jstorrent-native/`
- **Windows:** `%LOCALAPPDATA%\jstorrent-native\`

Key files:
- `rpc-info.json` - Discovery metadata (ports, tokens, download roots)
- `jstorrent-native.env` - Developer overrides (LAUNCH_URL, DEV_ORIGINS, LOGFILE)
- `native-host.log`, `io-daemon.log`, `link-handler.log` - Log files

### Enabling Logging

Copy the example env file to your config directory to enable logging:

```bash
# macOS
cp jstorrent-native.env.example ~/Library/Application\ Support/jstorrent-native/jstorrent-native.env

# Linux
cp jstorrent-native.env.example ~/.config/jstorrent-native/jstorrent-native.env

# Windows (cmd)
copy jstorrent-native.env.example %LOCALAPPDATA%\jstorrent-native\jstorrent-native.env
```

See `jstorrent-native.env.example` for available options.

## Workspace

Cargo workspace with shared dependencies (v0.1.5):
- `tokio` - Async runtime
- `axum` - HTTP/WebSocket server (io-daemon)
- `serde`/`serde_json` - Serialization
- `clap` - CLI argument parsing
