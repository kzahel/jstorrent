# Extension Debug Tools

Tools for debugging the JSTorrent extension service worker. Designed for both human developers and AI agents.

## Prerequisites

Chrome must be running with remote debugging enabled. Use the provided script:

```bash
./start-chrome-with-tmp-and-debug.sh
```

This:
- Starts Chrome with `--remote-debugging-port=9222`
- Uses `/tmp/chrome-debug` as user data dir (clean profile)
- Symlinks native messaging host manifest so extension can connect to native host

After Chrome starts, load the extension manually from `chrome://extensions` → Load unpacked → select `extension/dist/`.

## Tools

### sw-log-stream.py

Streams service worker console output to terminal and `/tmp/sw-logs.txt`. Auto-reconnects when extension reloads.

```bash
# Install deps (one time)
cd extension/tools
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Run
python sw-log-stream.py
```

Output:
```
[sw-log] Connecting to ws://localhost:9222/devtools/...
[log] Service Worker loaded
[log] [SW] IO Bridge started, platform: desktop
[error] [DesktopAdapter] Probe failed: ...
```

The script polls Chrome's debug endpoint every 2 seconds to detect extension reloads and reconnects automatically.

### reload-extension.py

Triggers `chrome.runtime.reload()` via CDP. Use after rebuilding the extension.

```bash
python reload-extension.py
```

Typical workflow:
```bash
# Terminal 1: watch logs
python sw-log-stream.py

# Terminal 2: edit, build, reload
cd extension
pnpm build
cd tools
python reload-extension.py
```

## Native Host Install/Uninstall

The extension requires the native host to be installed for full functionality.

### Install

```bash
cd native-host
./scripts/install-local-linux.sh
```

This builds and installs to `~/.local/lib/jstorrent-native/`.

### Uninstall

```bash
~/.local/lib/jstorrent-native/uninstall.sh
```

## Agent Workflow

For AI agents debugging extension issues:

1. **Start Chrome** (if not running):
   ```bash
   cd extension/tools
   ./start-chrome-with-tmp-and-debug.sh
   ```

2. **Start log streaming** (in background or separate terminal):
   ```bash
   python sw-log-stream.py
   ```

3. **Make code changes**, then:
   ```bash
   cd extension && pnpm build
   cd tools && python reload-extension.py
   ```

4. **Check logs** for errors:
   ```bash
   # Recent logs
   tail -50 /tmp/sw-logs.txt
   
   # Search for errors
   grep -i "exception\|error" /tmp/sw-logs.txt
   ```

5. **Test native host detection**:
   - With native host installed: should see `CONNECTED` state
   - After uninstall (`~/.local/lib/jstorrent-native/uninstall.sh`): should see `INSTALL_PROMPT` state
   - After reinstall: should auto-detect and reconnect

## Troubleshooting

**"Extension not found" in sw-log-stream.py**
- Extension not loaded in Chrome
- Wrong extension ID in script (check `EXTENSION_ID` constant)

**No logs appearing**
- Service worker may be idle (interact with extension to wake it)
- Check Chrome is running with `--remote-debugging-port=9222`

**Native host not connecting**
- Verify symlink exists: `ls -la /tmp/chrome-debug/NativeMessagingHosts/`
- Check native host is installed: `ls ~/.local/lib/jstorrent-native/`
- Rebuild native host: `cd native-host && cargo build --release`

## Extension ID

The unpacked extension ID is: `bnceafpojmnimbnhamaeedgomdcgnbjk`

This may change if you load from a different path. Check `chrome://extensions` for the actual ID and update `EXTENSION_ID` in the Python scripts if needed.
