# ChromeOS MCP Server

Remote control ChromeOS via MCP (Model Context Protocol) from Claude.

## Architecture

```
Laptop                           Chromebook VT2 (root)
┌─────────────────┐              ┌─────────────────┐
│ Claude/Agent    │              │                 │
│     │           │              │                 │
│     │ MCP       │              │                 │
│     ▼           │              │                 │
│ mcp_chromeos.py │───SSH stdin/─│ client.py       │
│                 │   stdout     │  - tap          │
│                 │              │  - swipe        │
│                 │              │  - type         │
│                 │              │  - key          │
│                 │              │  - screenshot   │
└─────────────────┘              └─────────────────┘
```

## Quick Start

### 1. Setup Laptop (uv)

```bash
cd chromeos-testbed/chromeos-mcp
uv sync
```

### 2. Deploy client.py to Chromebook

```bash
# Create directory on Chromebook
ssh chromeroot "mkdir -p /mnt/stateful_partition/c2"

# Copy client.py
scp client.py chromeroot:/mnt/stateful_partition/c2/
```

### 3. Test client.py directly

```bash
# Test ping
echo '{"cmd": "ping"}' | ssh chromeroot "LD_LIBRARY_PATH=/usr/local/lib64 python3 /mnt/stateful_partition/c2/client.py"
# Should return: {"pong": true}

# Test info
echo '{"cmd": "info"}' | ssh chromeroot "LD_LIBRARY_PATH=/usr/local/lib64 python3 /mnt/stateful_partition/c2/client.py"
# Returns: {"screen": [1600, 900], "touch_max": [3492, 1968], "device": "/dev/input/event6"}
```

### 4. Register MCP server with Claude

```bash
claude mcp add chromeos "uv run --directory $(pwd) python mcp_chromeos.py"
```

Or manually edit `~/.claude.json`:
```json
{
  "mcpServers": {
    "chromeos": {
      "command": "uv",
      "args": ["run", "--directory", "/path/to/chromeos-mcp", "python", "mcp_chromeos.py"]
    }
  }
}
```

## MCP Tools

| Tool | Args | Description |
|------|------|-------------|
| `screenshot` | - | Capture screen, return image |
| `tap` | x, y | Tap at screen coordinates |
| `swipe` | x1, y1, x2, y2, duration_ms? | Swipe gesture |
| `type_text` | text | Type text on keyboard |
| `press_keys` | keys[] | Press key combination by keycodes |
| `set_resolution` | x, y | Set screen resolution for coordinate mapping |
| `chromeos_info` | - | Get device info |

## Key Codes Reference

| Key | Code | Key | Code |
|-----|------|-----|------|
| Search/Meta | 125 | F5 | 63 |
| Ctrl | 29 | Alt | 56 |
| Shift | 42 | Tab | 15 |
| Enter | 28 | Space | 57 |
| Esc | 1 | Backspace | 14 |
| Left | 105 | Right | 106 |
| Up | 103 | Down | 108 |

Screenshot = Search+F5 = `[125, 63]`

## JSON Protocol

Commands are JSON lines over stdin/stdout:

```json
{"cmd": "ping"}
{"cmd": "tap", "x": 500, "y": 300}
{"cmd": "swipe", "x1": 100, "y1": 500, "x2": 800, "y2": 500, "duration_ms": 300}
{"cmd": "key", "keys": [125, 63]}
{"cmd": "type", "text": "hello"}
{"cmd": "screenshot"}
{"cmd": "resolution", "x": 1600, "y": 900}
{"cmd": "info"}
```

## Files

- `client.py` - Runs on Chromebook VT2 (root), handles input injection and screenshots
- `mcp_chromeos.py` - MCP server running on laptop
- `pyproject.toml` - Python project configuration (dependencies managed by uv)

## Notes

- ChromeOS Python requires `LD_LIBRARY_PATH=/usr/local/lib64`
- Default screen resolution is 1600x900
- Touchscreen coordinates are auto-detected from `/dev/input/event*`
- Screenshots use Search+F5 keyboard shortcut
