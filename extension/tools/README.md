# Extension Debug Tools

Tools for debugging the JSTorrent extension service worker. Designed for both human developers and AI agents.

## Prerequisites

Chrome must be running with remote debugging enabled. Use the provided script:

### ChromeOS Remote Development

If developing on a laptop with Chromebook as test device:

1. Run CDP tunnel: `ssh -L 9222:127.0.0.1:9222 chromebook`
2. Use `./scripts/deploy-chromebook.sh` instead of `pnpm build`
3. All tools in this folder work via the tunnel (localhost:9222 forwards to Chromebook)

### Local Development

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

## MCP Server (for AI Agents)

`mcp_extension_debug.py` provides the same capabilities as the standalone scripts, plus additional tools, via the Model Context Protocol. This is the recommended approach for AI agent workflows.

### Setup

```bash
# Install deps (one time)
cd extension/tools
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-mcp.txt

# Register with Claude Code
claude mcp add ext-debug $(pwd)/.venv/bin/python3 $(pwd)/mcp_extension_debug.py
```

Or manually add to `~/.claude.json`:
```json
{
  "mcpServers": {
    "ext-debug": {
      "command": "/path/to/extension/tools/.venv/bin/python3",
      "args": ["/path/to/extension/tools/mcp_extension_debug.py"]
    }
  }
}
```

### Available Tools

| Tool | Description |
|------|-------------|
| `ext_status` | Check CDP connectivity, extension state, log collector status |
| `ext_set_extension_id` | Set default extension ID for session |
| `ext_reload` | Reload extension (triggers SW restart) |
| `ext_evaluate` | Run JavaScript in SW or extension page |
| `ext_get_storage` | Read chrome.storage.local/sync/session |
| `ext_get_logs` | Get recent console logs (from internal buffer) |
| `ext_list_targets` | List all debuggable targets |

### Agent Workflow Example

```
# 1. Check status
ext_status
→ CDP reachable, extension found, SW active, log collector connected

# 2. Make code changes, build
bash: cd extension && pnpm build

# 3. Reload extension
ext_reload
→ Extension reloaded

# 4. Check for errors
ext_get_logs level="error" limit=20
→ { "logs": [...] }

# 5. Inspect state
ext_evaluate expression="ioBridge.getState()"
→ { "name": "CONNECTED", ... }

# 6. Check storage
ext_get_storage keys=["settings"]
→ { "area": "local", "data": { "settings": {...} } }
```

### Notes

- The log collector runs as a background task within the MCP server
- Logs are buffered in memory (last 500 entries)
- When extension reloads, log collector auto-reconnects
- Multiple CDP connections (this MCP, sw-log-stream.py, DevTools) can run simultaneously
