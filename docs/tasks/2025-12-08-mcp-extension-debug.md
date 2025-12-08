# MCP Extension Debug Server - Implementation Guide

## Overview

Create an MCP server for debugging the JSTorrent Chrome extension via Chrome DevTools Protocol (CDP). This enables agents to reload the extension, evaluate JavaScript in the service worker, inspect storage, and retrieve console logs.

**Location:** `extension/tools/mcp_extension_debug.py`

**Prerequisites:**
- Chrome running with `--remote-debugging-port=9222`
- Extension loaded in Chrome
- Python 3.10+ with `mcp`, `websockets`, `aiohttp` packages

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    mcp_extension_debug.py                    │
│                                                              │
│  ┌──────────────────┐     ┌──────────────────────────────┐  │
│  │  Tool Handlers   │     │  LogCollector (background)   │  │
│  │                  │     │                              │  │
│  │  ext_status      │     │  - Persistent WS to SW       │  │
│  │  ext_evaluate    │     │  - Buffers last 500 entries  │  │
│  │  ext_reload      │     │  - Auto-reconnects           │  │
│  │  ext_get_storage │     │                              │  │
│  │  ext_get_logs ───┼────►│                              │  │
│  │  ext_list_targets│     │                              │  │
│  │  ext_set_ext_id  │     │                              │  │
│  └──────────────────┘     └──────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
                  localhost:9222 (Chrome CDP)
```

## Phase 1: Core MCP Server

### 1.1 Create `extension/tools/mcp_extension_debug.py`

```python
#!/usr/bin/env python3
"""
MCP server for Chrome extension debugging via CDP.

Usage:
    python mcp_extension_debug.py

Register with Claude Code:
    claude mcp add ext-debug python3 /path/to/mcp_extension_debug.py
"""

import asyncio
import json
import sys
from collections import deque
from dataclasses import dataclass, field
from typing import Any
from datetime import datetime

import aiohttp
import websockets
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import TextContent, Tool

# Configuration
CDP_HOST = "localhost"
CDP_PORT = 9222
DEFAULT_EXTENSION_ID = "bnceafpojmnimbnhamaeedgomdcgnbjk"
LOG_BUFFER_SIZE = 500

server = Server("chrome-extension-debug")


@dataclass
class LogEntry:
    timestamp: float
    level: str
    text: str
    stack: str | None = None


@dataclass 
class ServerState:
    extension_id: str = DEFAULT_EXTENSION_ID
    log_buffer: deque = field(default_factory=lambda: deque(maxlen=LOG_BUFFER_SIZE))
    log_collector_task: asyncio.Task | None = None
    log_collector_connected: bool = False
    log_collector_ws_url: str | None = None


state = ServerState()


# =============================================================================
# CDP Helpers
# =============================================================================

async def cdp_get_targets() -> list[dict] | None:
    """Fetch all debuggable targets from Chrome."""
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(f"http://{CDP_HOST}:{CDP_PORT}/json", timeout=aiohttp.ClientTimeout(total=5)) as resp:
                return await resp.json()
    except Exception as e:
        return None


async def cdp_find_extension_targets(extension_id: str) -> list[dict]:
    """Find all targets belonging to an extension."""
    targets = await cdp_get_targets()
    if not targets:
        return []
    return [t for t in targets if extension_id in t.get("url", "")]


async def cdp_find_service_worker(extension_id: str) -> dict | None:
    """Find the service worker target for an extension."""
    targets = await cdp_find_extension_targets(extension_id)
    for t in targets:
        if t.get("type") == "service_worker":
            return t
    return None


async def cdp_find_extension_page(extension_id: str) -> dict | None:
    """Find an extension page (popup, options, app page)."""
    targets = await cdp_find_extension_targets(extension_id)
    for t in targets:
        if t.get("type") == "page" and extension_id in t.get("url", ""):
            return t
    return None


async def cdp_send_command(ws_url: str, method: str, params: dict | None = None, timeout: float = 10) -> dict:
    """Send a CDP command and wait for response."""
    msg_id = 1
    async with websockets.connect(ws_url) as ws:
        request = {"id": msg_id, "method": method}
        if params:
            request["params"] = params
        await ws.send(json.dumps(request))
        
        # Wait for response with matching id
        async with asyncio.timeout(timeout):
            while True:
                response = json.loads(await ws.recv())
                if response.get("id") == msg_id:
                    return response


async def cdp_evaluate(ws_url: str, expression: str, await_promise: bool = True) -> dict:
    """Evaluate JavaScript expression in target context."""
    params = {
        "expression": expression,
        "returnByValue": True,
        "awaitPromise": await_promise,
    }
    return await cdp_send_command(ws_url, "Runtime.evaluate", params)


# =============================================================================
# Log Collector (Background Task)
# =============================================================================

async def log_collector_loop():
    """Background task that maintains persistent connection to SW and collects logs."""
    while True:
        try:
            sw = await cdp_find_service_worker(state.extension_id)
            if not sw:
                state.log_collector_connected = False
                state.log_collector_ws_url = None
                await asyncio.sleep(2)
                continue
            
            ws_url = sw.get("webSocketDebuggerUrl")
            if not ws_url:
                await asyncio.sleep(2)
                continue
            
            state.log_collector_ws_url = ws_url
            
            async with websockets.connect(ws_url) as ws:
                # Enable console and runtime events
                await ws.send(json.dumps({"id": 1, "method": "Runtime.enable"}))
                await ws.send(json.dumps({"id": 2, "method": "Console.enable"}))
                state.log_collector_connected = True
                
                # Add connection marker to buffer
                state.log_buffer.append(LogEntry(
                    timestamp=datetime.now().timestamp() * 1000,
                    level="info",
                    text="[LogCollector] Connected to service worker",
                ))
                
                # Read events
                while True:
                    try:
                        message = await asyncio.wait_for(ws.recv(), timeout=2.0)
                    except asyncio.TimeoutError:
                        # Check if SW URL changed (extension reloaded)
                        current_sw = await cdp_find_service_worker(state.extension_id)
                        current_url = current_sw.get("webSocketDebuggerUrl") if current_sw else None
                        if current_url != ws_url:
                            state.log_buffer.append(LogEntry(
                                timestamp=datetime.now().timestamp() * 1000,
                                level="info", 
                                text="[LogCollector] Service worker restarted, reconnecting...",
                            ))
                            break
                        continue
                    
                    data = json.loads(message)
                    method = data.get("method", "")
                    
                    if method == "Runtime.consoleAPICalled":
                        params = data.get("params", {})
                        args = params.get("args", [])
                        parts = []
                        for a in args:
                            if "value" in a:
                                parts.append(str(a["value"]))
                            elif "description" in a:
                                parts.append(a["description"])
                            else:
                                parts.append(json.dumps(a))
                        
                        state.log_buffer.append(LogEntry(
                            timestamp=params.get("timestamp", datetime.now().timestamp() * 1000),
                            level=params.get("type", "log"),
                            text=" ".join(parts),
                        ))
                    
                    elif method == "Runtime.exceptionThrown":
                        params = data.get("params", {})
                        exc = params.get("exceptionDetails", {})
                        text = exc.get("text", "Unknown exception")
                        stack = None
                        if "exception" in exc:
                            stack = exc["exception"].get("description")
                        
                        state.log_buffer.append(LogEntry(
                            timestamp=params.get("timestamp", datetime.now().timestamp() * 1000),
                            level="error",
                            text=text,
                            stack=stack,
                        ))
                        
        except websockets.exceptions.ConnectionClosed:
            pass
        except Exception as e:
            state.log_buffer.append(LogEntry(
                timestamp=datetime.now().timestamp() * 1000,
                level="error",
                text=f"[LogCollector] Error: {type(e).__name__}: {e}",
            ))
        
        state.log_collector_connected = False
        await asyncio.sleep(1)


def ensure_log_collector():
    """Start log collector if not already running."""
    if state.log_collector_task is None or state.log_collector_task.done():
        state.log_collector_task = asyncio.create_task(log_collector_loop())


# =============================================================================
# MCP Tools
# =============================================================================

@server.list_tools()
async def list_tools() -> list[Tool]:
    return [
        Tool(
            name="ext_status",
            description="Check CDP connectivity and extension state. Also starts log collector if not running.",
            inputSchema={"type": "object", "properties": {}},
        ),
        Tool(
            name="ext_set_extension_id",
            description="Set the default extension ID for subsequent commands.",
            inputSchema={
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Extension ID (32 characters)"},
                },
                "required": ["id"],
            },
        ),
        Tool(
            name="ext_reload",
            description="Reload the extension via chrome.runtime.reload(). Triggers service worker restart.",
            inputSchema={
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Extension ID (uses default if not specified)"},
                },
            },
        ),
        Tool(
            name="ext_evaluate",
            description="Evaluate JavaScript in extension context. Use for inspecting state, calling functions, etc.",
            inputSchema={
                "type": "object",
                "properties": {
                    "expression": {"type": "string", "description": "JavaScript expression to evaluate"},
                    "target": {
                        "type": "string",
                        "enum": ["sw", "page"],
                        "description": "Target context: 'sw' for service worker (default), 'page' for extension page",
                    },
                    "id": {"type": "string", "description": "Extension ID (uses default if not specified)"},
                },
                "required": ["expression"],
            },
        ),
        Tool(
            name="ext_get_storage",
            description="Read from chrome.storage (local, sync, or session).",
            inputSchema={
                "type": "object",
                "properties": {
                    "area": {
                        "type": "string",
                        "enum": ["local", "sync", "session"],
                        "description": "Storage area (default: local)",
                    },
                    "keys": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Specific keys to retrieve (all if omitted)",
                    },
                    "id": {"type": "string", "description": "Extension ID (uses default if not specified)"},
                },
            },
        ),
        Tool(
            name="ext_get_logs",
            description="Get recent console logs from the service worker. Logs are collected by a background process.",
            inputSchema={
                "type": "object",
                "properties": {
                    "limit": {"type": "integer", "description": "Max entries to return (default: 50)"},
                    "level": {
                        "type": "string",
                        "enum": ["all", "error", "warn", "log", "info", "debug"],
                        "description": "Filter by log level (default: all)",
                    },
                },
            },
        ),
        Tool(
            name="ext_list_targets",
            description="List all debuggable targets (tabs, service workers, extension pages).",
            inputSchema={
                "type": "object",
                "properties": {
                    "extension_only": {
                        "type": "boolean",
                        "description": "Only show targets for current extension (default: false)",
                    },
                },
            },
        ),
    ]


@server.call_tool()
async def call_tool(name: str, arguments: dict[str, Any]) -> list[TextContent]:
    
    # --- ext_status ---
    if name == "ext_status":
        ensure_log_collector()
        
        targets = await cdp_get_targets()
        if targets is None:
            return [TextContent(type="text", text=f"CDP not reachable at {CDP_HOST}:{CDP_PORT}\n\nStart Chrome with: --remote-debugging-port={CDP_PORT}")]
        
        sw = await cdp_find_service_worker(state.extension_id)
        page = await cdp_find_extension_page(state.extension_id)
        
        status = {
            "cdp_reachable": True,
            "extension_id": state.extension_id,
            "service_worker": {
                "active": sw is not None,
                "url": sw.get("url") if sw else None,
            },
            "extension_page": {
                "active": page is not None,
                "url": page.get("url") if page else None,
            },
            "log_collector": {
                "connected": state.log_collector_connected,
                "buffer_size": len(state.log_buffer),
            },
        }
        
        return [TextContent(type="text", text=json.dumps(status, indent=2))]
    
    # --- ext_set_extension_id ---
    elif name == "ext_set_extension_id":
        new_id = arguments.get("id", "")
        if len(new_id) != 32:
            return [TextContent(type="text", text=f"Invalid extension ID: must be 32 characters, got {len(new_id)}")]
        
        old_id = state.extension_id
        state.extension_id = new_id
        
        # Clear log buffer and restart collector for new extension
        state.log_buffer.clear()
        if state.log_collector_task:
            state.log_collector_task.cancel()
            state.log_collector_task = None
        
        return [TextContent(type="text", text=f"Extension ID changed: {old_id} → {new_id}")]
    
    # --- ext_reload ---
    elif name == "ext_reload":
        ext_id = arguments.get("id", state.extension_id)
        
        sw = await cdp_find_service_worker(ext_id)
        if not sw:
            return [TextContent(type="text", text=f"Extension {ext_id} not found or service worker not active")]
        
        ws_url = sw.get("webSocketDebuggerUrl")
        try:
            # Don't await response - connection dies on reload
            async with websockets.connect(ws_url) as ws:
                await ws.send(json.dumps({
                    "id": 1,
                    "method": "Runtime.evaluate",
                    "params": {"expression": "chrome.runtime.reload()"}
                }))
            return [TextContent(type="text", text=f"Extension {ext_id} reload triggered")]
        except Exception as e:
            return [TextContent(type="text", text=f"Reload may have succeeded (connection closed): {e}")]
    
    # --- ext_evaluate ---
    elif name == "ext_evaluate":
        expression = arguments.get("expression", "")
        target_type = arguments.get("target", "sw")
        ext_id = arguments.get("id", state.extension_id)
        
        if target_type == "sw":
            target = await cdp_find_service_worker(ext_id)
            if not target:
                return [TextContent(type="text", text=f"Service worker not active for {ext_id}")]
        else:
            target = await cdp_find_extension_page(ext_id)
            if not target:
                return [TextContent(type="text", text=f"No extension page found for {ext_id}")]
        
        ws_url = target.get("webSocketDebuggerUrl")
        try:
            result = await cdp_evaluate(ws_url, expression)
            
            if "error" in result:
                return [TextContent(type="text", text=f"CDP error: {result['error']}")]
            
            eval_result = result.get("result", {})
            if "exceptionDetails" in eval_result:
                exc = eval_result["exceptionDetails"]
                return [TextContent(type="text", text=f"Exception: {exc.get('text', 'Unknown error')}")]
            
            value = eval_result.get("result", {}).get("value")
            return [TextContent(type="text", text=json.dumps(value, indent=2, default=str))]
            
        except Exception as e:
            return [TextContent(type="text", text=f"Evaluation failed: {type(e).__name__}: {e}")]
    
    # --- ext_get_storage ---
    elif name == "ext_get_storage":
        area = arguments.get("area", "local")
        keys = arguments.get("keys")
        ext_id = arguments.get("id", state.extension_id)
        
        sw = await cdp_find_service_worker(ext_id)
        if not sw:
            return [TextContent(type="text", text=f"Service worker not active for {ext_id}")]
        
        ws_url = sw.get("webSocketDebuggerUrl")
        
        if keys:
            keys_json = json.dumps(keys)
            expression = f"chrome.storage.{area}.get({keys_json})"
        else:
            expression = f"chrome.storage.{area}.get()"
        
        try:
            result = await cdp_evaluate(ws_url, expression)
            eval_result = result.get("result", {})
            value = eval_result.get("result", {}).get("value", {})
            
            return [TextContent(type="text", text=json.dumps({"area": area, "data": value}, indent=2))]
        except Exception as e:
            return [TextContent(type="text", text=f"Storage read failed: {e}")]
    
    # --- ext_get_logs ---
    elif name == "ext_get_logs":
        ensure_log_collector()
        
        limit = arguments.get("limit", 50)
        level_filter = arguments.get("level", "all")
        
        logs = list(state.log_buffer)
        
        if level_filter != "all":
            logs = [l for l in logs if l.level == level_filter]
        
        logs = logs[-limit:]
        
        formatted = []
        for log in logs:
            entry = {
                "timestamp": log.timestamp,
                "level": log.level,
                "text": log.text,
            }
            if log.stack:
                entry["stack"] = log.stack
            formatted.append(entry)
        
        result = {
            "logs": formatted,
            "buffer_total": len(state.log_buffer),
            "collector_connected": state.log_collector_connected,
        }
        
        return [TextContent(type="text", text=json.dumps(result, indent=2))]
    
    # --- ext_list_targets ---
    elif name == "ext_list_targets":
        extension_only = arguments.get("extension_only", False)
        
        targets = await cdp_get_targets()
        if targets is None:
            return [TextContent(type="text", text=f"CDP not reachable at {CDP_HOST}:{CDP_PORT}")]
        
        if extension_only:
            targets = [t for t in targets if state.extension_id in t.get("url", "")]
        
        formatted = []
        for t in targets:
            formatted.append({
                "id": t.get("id"),
                "type": t.get("type"),
                "title": t.get("title"),
                "url": t.get("url"),
            })
        
        return [TextContent(type="text", text=json.dumps({"targets": formatted}, indent=2))]
    
    return [TextContent(type="text", text=f"Unknown tool: {name}")]


# =============================================================================
# Main
# =============================================================================

async def main():
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


if __name__ == "__main__":
    asyncio.run(main())
```

### 1.2 Create `extension/tools/requirements-mcp.txt`

```
mcp>=1.0.0
websockets>=12.0
aiohttp>=3.9.0
```

## Phase 2: Update Existing Scripts

### 2.1 Add comment to `extension/tools/sw-log-stream.py`

Add at the top of the file, after the shebang:

```python
#!/usr/bin/env python3
# 
# NOTE: For agent workflows, consider using mcp_extension_debug.py instead.
# It provides the same log streaming plus additional debugging tools via MCP.
# This standalone script is useful for human developers who want a simple
# terminal log tail.
#
```

### 2.2 Add comment to `extension/tools/reload-extension.py`

Add at the top, after the docstring:

```python
#!/usr/bin/env python3
"""reload-extension.py - Reload extension via CDP

NOTE: For agent workflows, consider using mcp_extension_debug.py instead.
It provides ext_reload plus additional debugging tools via MCP.
This standalone script is useful for quick manual reloads.
"""
```

## Phase 3: Documentation

### 3.1 Update `extension/tools/README.md`

Add new section after the existing content:

```markdown
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
```

### 3.2 Update `CLAUDE.md` (or create agent instructions section)

Add to the relevant section for agent workflows:

```markdown
## Extension Debugging (MCP)

Use the `ext-debug` MCP server for extension debugging:

```
# Always start with status check
ext_status

# After code changes:
cd extension && pnpm build
ext_reload

# Check logs for errors
ext_get_logs level="error"

# Inspect engine state
ext_evaluate expression="globalThis.engine?.torrents?.length"
ext_evaluate expression="ioBridge.getState()"

# Check storage
ext_get_storage keys=["settings", "torrents"]
```

Default extension ID is `bnceafpojmnimbnhamaeedgomdcgnbjk` (unpacked from extension/dist/).
```

## Verification

### Test 1: Basic connectivity

```bash
# Start Chrome with debug port
cd extension/tools
./start-chrome-with-tmp-and-debug.sh

# Load extension in Chrome manually

# Test MCP server directly (not via Claude)
cd extension/tools
source .venv/bin/activate
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | python mcp_extension_debug.py
```

### Test 2: With Claude Code

```bash
# Register MCP
claude mcp add ext-debug ...

# In Claude Code conversation:
> ext_status
> ext_get_logs limit=10
> ext_evaluate expression="1+1"
> ext_reload
```

### Test 3: Log collection

```
# In Claude Code:
> ext_status  # starts collector
> ext_get_logs  # should show connection message
# Do something in extension that logs
> ext_get_logs  # should show new entries
> ext_reload
> ext_get_logs  # should show reconnection message + new logs
```

## Files Changed

| File | Action |
|------|--------|
| `extension/tools/mcp_extension_debug.py` | Create |
| `extension/tools/requirements-mcp.txt` | Create |
| `extension/tools/README.md` | Update |
| `extension/tools/sw-log-stream.py` | Add comment |
| `extension/tools/reload-extension.py` | Add comment |
| `CLAUDE.md` | Update (agent instructions) |
