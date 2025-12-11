#!/usr/bin/env python3
"""
MCP server for Chrome extension debugging via CDP.

Supports multiple Chrome instances via config file.

Config file locations (in priority order):
1. ./ext-debug.json (current directory)
2. ~/.config/ext-debug/config.json (user config)

Example config:
{
  "connections": {
    "local": { "port": 9223, "extension_id": "dbokmlpefliilbjldladbimlcfgbolhk" },
    "chromebook": { "port": 9222, "extension_id": "dbokmlpefliilbjldladbimlcfgbolhk" }
  },
  "default": "local"
}

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
from datetime import datetime
from pathlib import Path
from typing import Any

import aiohttp
import websockets
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import TextContent, Tool

# Configuration
DEFAULT_HOST = "localhost"
DEFAULT_PORT = 9222
DEFAULT_EXTENSION_ID = "dbokmlpefliilbjldladbimlcfgbolhk"
LOG_BUFFER_SIZE = 500

server = Server("chrome-extension-debug")


@dataclass
class LogEntry:
    timestamp: float
    level: str
    text: str
    source: str = "sw"  # "sw" for service worker, "page" for extension pages
    connection: str = ""  # which connection this log came from
    stack: str | None = None


@dataclass
class ConnectionState:
    """State for a single Chrome connection."""
    name: str
    host: str = DEFAULT_HOST
    port: int = DEFAULT_PORT
    extension_id: str = DEFAULT_EXTENSION_ID
    log_buffer: deque = field(default_factory=lambda: deque(maxlen=LOG_BUFFER_SIZE))
    # Service worker log collector
    sw_log_collector_task: asyncio.Task | None = None
    sw_log_collector_connected: bool = False
    sw_log_collector_ws_url: str | None = None
    # Extension page log collector
    page_log_collector_task: asyncio.Task | None = None
    page_log_collector_connected: bool = False
    page_log_collector_ws_url: str | None = None


@dataclass
class GlobalState:
    """Global state managing all connections."""
    connections: dict[str, ConnectionState] = field(default_factory=dict)
    default_connection: str = ""
    config_path: str | None = None  # Where config was loaded from


state = GlobalState()


# =============================================================================
# Config Loading
# =============================================================================

def find_config_file() -> Path | None:
    """Find config file in priority order."""
    # 1. Current directory
    local_config = Path("ext-debug.json")
    if local_config.exists():
        return local_config

    # 2. User config directory
    user_config = Path.home() / ".config" / "ext-debug" / "config.json"
    if user_config.exists():
        return user_config

    return None


def load_config() -> dict:
    """Load configuration from file or return defaults."""
    config_path = find_config_file()

    if config_path:
        try:
            with open(config_path) as f:
                config = json.load(f)
                state.config_path = str(config_path)
                return config
        except Exception as e:
            print(f"Warning: Failed to load config from {config_path}: {e}", file=sys.stderr)

    # Default config - single connection for backward compatibility
    return {
        "connections": {
            "default": {
                "host": DEFAULT_HOST,
                "port": DEFAULT_PORT,
                "extension_id": DEFAULT_EXTENSION_ID,
            }
        },
        "default": "default",
    }


def init_connections():
    """Initialize connection states from config."""
    config = load_config()

    connections_config = config.get("connections", {})
    if not connections_config:
        # Fallback to single default connection
        connections_config = {
            "default": {
                "host": DEFAULT_HOST,
                "port": DEFAULT_PORT,
                "extension_id": DEFAULT_EXTENSION_ID,
            }
        }

    for name, conn_config in connections_config.items():
        state.connections[name] = ConnectionState(
            name=name,
            host=conn_config.get("host", DEFAULT_HOST),
            port=conn_config.get("port", DEFAULT_PORT),
            extension_id=conn_config.get("extension_id", DEFAULT_EXTENSION_ID),
        )

    state.default_connection = config.get("default", next(iter(state.connections.keys())))


def get_connection(name: str | None) -> ConnectionState | None:
    """Get a connection by name, or default if name is None."""
    if name is None or name == "":
        name = state.default_connection
    return state.connections.get(name)


def get_connections(name: str | None) -> list[ConnectionState]:
    """Get connection(s) by name. Returns all if name is 'all'."""
    if name == "all":
        return list(state.connections.values())
    conn = get_connection(name)
    return [conn] if conn else []


# =============================================================================
# CDP Helpers
# =============================================================================

async def cdp_get_targets(conn: ConnectionState) -> list[dict] | None:
    """Fetch all debuggable targets from Chrome."""
    try:
        async with aiohttp.ClientSession() as session:
            url = f"http://{conn.host}:{conn.port}/json"
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                return await resp.json()
    except Exception:
        return None


async def cdp_find_extension_targets(conn: ConnectionState) -> list[dict]:
    """Find all targets belonging to an extension."""
    targets = await cdp_get_targets(conn)
    if not targets:
        return []
    return [t for t in targets if conn.extension_id in t.get("url", "")]


async def cdp_find_service_worker(conn: ConnectionState) -> dict | None:
    """Find the service worker target for an extension."""
    targets = await cdp_find_extension_targets(conn)
    for t in targets:
        if t.get("type") == "service_worker":
            return t
    return None


async def cdp_find_extension_page(conn: ConnectionState) -> dict | None:
    """Find an extension page (popup, options, app page)."""
    targets = await cdp_find_extension_targets(conn)
    for t in targets:
        if t.get("type") == "page" and conn.extension_id in t.get("url", ""):
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

async def sw_log_collector_loop(conn: ConnectionState):
    """Background task that maintains persistent connection to SW and collects logs."""
    while True:
        try:
            sw = await cdp_find_service_worker(conn)
            if not sw:
                conn.sw_log_collector_connected = False
                conn.sw_log_collector_ws_url = None
                await asyncio.sleep(2)
                continue

            ws_url = sw.get("webSocketDebuggerUrl")
            if not ws_url:
                await asyncio.sleep(2)
                continue

            conn.sw_log_collector_ws_url = ws_url

            async with websockets.connect(ws_url) as ws:
                # Enable console and runtime events
                await ws.send(json.dumps({"id": 1, "method": "Runtime.enable"}))
                await ws.send(json.dumps({"id": 2, "method": "Console.enable"}))
                conn.sw_log_collector_connected = True

                # Add connection marker to buffer
                conn.log_buffer.append(LogEntry(
                    timestamp=datetime.now().timestamp() * 1000,
                    level="info",
                    text=f"[SW LogCollector] Connected to service worker",
                    source="sw",
                    connection=conn.name,
                ))

                # Read events
                while True:
                    try:
                        message = await asyncio.wait_for(ws.recv(), timeout=2.0)
                    except asyncio.TimeoutError:
                        # Check if SW URL changed (extension reloaded)
                        current_sw = await cdp_find_service_worker(conn)
                        current_url = current_sw.get("webSocketDebuggerUrl") if current_sw else None
                        if current_url != ws_url:
                            conn.log_buffer.append(LogEntry(
                                timestamp=datetime.now().timestamp() * 1000,
                                level="info",
                                text="[SW LogCollector] Service worker restarted, reconnecting...",
                                source="sw",
                                connection=conn.name,
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

                        conn.log_buffer.append(LogEntry(
                            timestamp=params.get("timestamp", datetime.now().timestamp() * 1000),
                            level=params.get("type", "log"),
                            text=" ".join(parts),
                            source="sw",
                            connection=conn.name,
                        ))

                    elif method == "Runtime.exceptionThrown":
                        params = data.get("params", {})
                        exc = params.get("exceptionDetails", {})
                        text = exc.get("text", "Unknown exception")
                        stack = None
                        if "exception" in exc:
                            stack = exc["exception"].get("description")

                        conn.log_buffer.append(LogEntry(
                            timestamp=params.get("timestamp", datetime.now().timestamp() * 1000),
                            level="error",
                            text=text,
                            source="sw",
                            connection=conn.name,
                            stack=stack,
                        ))

        except websockets.exceptions.ConnectionClosed:
            pass
        except Exception as e:
            conn.log_buffer.append(LogEntry(
                timestamp=datetime.now().timestamp() * 1000,
                level="error",
                text=f"[SW LogCollector] Error: {type(e).__name__}: {e}",
                source="sw",
                connection=conn.name,
            ))

        conn.sw_log_collector_connected = False
        await asyncio.sleep(1)


async def page_log_collector_loop(conn: ConnectionState):
    """Background task that maintains persistent connection to extension pages and collects logs."""
    while True:
        try:
            page = await cdp_find_extension_page(conn)
            if not page:
                conn.page_log_collector_connected = False
                conn.page_log_collector_ws_url = None
                await asyncio.sleep(2)
                continue

            ws_url = page.get("webSocketDebuggerUrl")
            if not ws_url:
                await asyncio.sleep(2)
                continue

            conn.page_log_collector_ws_url = ws_url

            async with websockets.connect(ws_url) as ws:
                # Enable console and runtime events
                await ws.send(json.dumps({"id": 1, "method": "Runtime.enable"}))
                await ws.send(json.dumps({"id": 2, "method": "Console.enable"}))
                conn.page_log_collector_connected = True

                page_url = page.get("url", "unknown")
                # Add connection marker to buffer
                conn.log_buffer.append(LogEntry(
                    timestamp=datetime.now().timestamp() * 1000,
                    level="info",
                    text=f"[Page LogCollector] Connected to extension page: {page_url}",
                    source="page",
                    connection=conn.name,
                ))

                # Read events
                while True:
                    try:
                        message = await asyncio.wait_for(ws.recv(), timeout=2.0)
                    except asyncio.TimeoutError:
                        # Check if page URL changed (popup closed/reopened)
                        current_page = await cdp_find_extension_page(conn)
                        current_url = current_page.get("webSocketDebuggerUrl") if current_page else None
                        if current_url != ws_url:
                            conn.log_buffer.append(LogEntry(
                                timestamp=datetime.now().timestamp() * 1000,
                                level="info",
                                text="[Page LogCollector] Extension page changed, reconnecting...",
                                source="page",
                                connection=conn.name,
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

                        conn.log_buffer.append(LogEntry(
                            timestamp=params.get("timestamp", datetime.now().timestamp() * 1000),
                            level=params.get("type", "log"),
                            text=" ".join(parts),
                            source="page",
                            connection=conn.name,
                        ))

                    elif method == "Runtime.exceptionThrown":
                        params = data.get("params", {})
                        exc = params.get("exceptionDetails", {})
                        text = exc.get("text", "Unknown exception")
                        stack = None
                        if "exception" in exc:
                            stack = exc["exception"].get("description")

                        conn.log_buffer.append(LogEntry(
                            timestamp=params.get("timestamp", datetime.now().timestamp() * 1000),
                            level="error",
                            text=text,
                            source="page",
                            connection=conn.name,
                            stack=stack,
                        ))

        except websockets.exceptions.ConnectionClosed:
            pass
        except Exception as e:
            conn.log_buffer.append(LogEntry(
                timestamp=datetime.now().timestamp() * 1000,
                level="error",
                text=f"[Page LogCollector] Error: {type(e).__name__}: {e}",
                source="page",
                connection=conn.name,
            ))

        conn.page_log_collector_connected = False
        await asyncio.sleep(1)


def ensure_sw_log_collector(conn: ConnectionState):
    """Start service worker log collector if not already running."""
    if conn.sw_log_collector_task is None or conn.sw_log_collector_task.done():
        conn.sw_log_collector_task = asyncio.create_task(sw_log_collector_loop(conn))


def ensure_page_log_collector(conn: ConnectionState):
    """Start extension page log collector if not already running."""
    if conn.page_log_collector_task is None or conn.page_log_collector_task.done():
        conn.page_log_collector_task = asyncio.create_task(page_log_collector_loop(conn))


# =============================================================================
# MCP Tools
# =============================================================================

CONNECTION_PARAM = {
    "type": "string",
    "description": "Connection name (uses default if not specified, or 'all' for all connections)",
}


@server.list_tools()
async def list_tools() -> list[Tool]:
    return [
        Tool(
            name="ext_status",
            description="Check CDP connectivity and extension state for one or all connections. Also starts log collectors.",
            inputSchema={
                "type": "object",
                "properties": {
                    "connection": CONNECTION_PARAM,
                },
            },
        ),
        Tool(
            name="ext_list_connections",
            description="List all configured connections and their status.",
            inputSchema={"type": "object", "properties": {}},
        ),
        Tool(
            name="ext_set_extension_id",
            description="Set the extension ID for a connection.",
            inputSchema={
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Extension ID (32 characters)"},
                    "connection": CONNECTION_PARAM,
                },
                "required": ["id"],
            },
        ),
        Tool(
            name="ext_reload",
            description="Reload the extension via chrome.runtime.reload(). Triggers service worker restart. By default, re-opens any extension tabs that were open.",
            inputSchema={
                "type": "object",
                "properties": {
                    "connection": CONNECTION_PARAM,
                    "restore_tabs": {
                        "type": "boolean",
                        "description": "Re-open extension tabs after reload (default: true)",
                    },
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
                    "connection": CONNECTION_PARAM,
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
                    "connection": CONNECTION_PARAM,
                },
            },
        ),
        Tool(
            name="ext_start_logs",
            description="Start log collection from extension. Call BEFORE performing actions you want to capture. Workflow: start_logs -> do actions -> get_logs.",
            inputSchema={
                "type": "object",
                "properties": {
                    "target": {
                        "type": "string",
                        "enum": ["sw", "page", "all"],
                        "description": "What to collect from: 'sw' (service worker), 'page' (extension UI), 'all' (default: all)",
                    },
                    "clear": {
                        "type": "boolean",
                        "description": "Clear existing log buffer before starting (default: false)",
                    },
                    "connection": CONNECTION_PARAM,
                },
            },
        ),
        Tool(
            name="ext_get_logs",
            description="Get collected console logs. Use ext_start_logs first to begin collection.",
            inputSchema={
                "type": "object",
                "properties": {
                    "limit": {"type": "integer", "description": "Max entries to return per connection (default: 50)"},
                    "level": {
                        "type": "string",
                        "enum": ["all", "error", "warn", "log", "info", "debug"],
                        "description": "Filter by log level (default: all)",
                    },
                    "source": {
                        "type": "string",
                        "enum": ["sw", "page", "all"],
                        "description": "Filter by source: 'sw' (service worker), 'page' (extension UI), 'all' (default: all)",
                    },
                    "connection": CONNECTION_PARAM,
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
                    "connection": CONNECTION_PARAM,
                },
            },
        ),
    ]


async def get_connection_status(conn: ConnectionState) -> dict:
    """Get status for a single connection."""
    targets = await cdp_get_targets(conn)
    if targets is None:
        return {
            "name": conn.name,
            "host": conn.host,
            "port": conn.port,
            "cdp_reachable": False,
            "error": f"CDP not reachable at {conn.host}:{conn.port}",
        }

    sw = await cdp_find_service_worker(conn)
    page = await cdp_find_extension_page(conn)

    # Get target browser's OS from userAgent
    target_os = None
    ws_url = (sw or page or {}).get("webSocketDebuggerUrl")
    if ws_url:
        try:
            result = await cdp_evaluate(ws_url, "navigator.userAgent")
            ua = result.get("result", {}).get("result", {}).get("value", "")
            import re
            match = re.search(r'\(([^)]+)\)', ua)
            if match:
                target_os = match.group(1)
        except Exception:
            pass

    return {
        "name": conn.name,
        "host": conn.host,
        "port": conn.port,
        "target_os": target_os,
        "cdp_reachable": True,
        "extension_id": conn.extension_id,
        "service_worker": {
            "active": sw is not None,
            "url": sw.get("url") if sw else None,
        },
        "extension_page": {
            "active": page is not None,
            "url": page.get("url") if page else None,
        },
        "log_collectors": {
            "sw_connected": conn.sw_log_collector_connected,
            "page_connected": conn.page_log_collector_connected,
            "buffer_size": len(conn.log_buffer),
        },
    }


@server.call_tool()
async def call_tool(name: str, arguments: dict[str, Any]) -> list[TextContent]:
    conn_name = arguments.get("connection")

    # --- ext_list_connections ---
    if name == "ext_list_connections":
        result = {
            "config_path": state.config_path or "(using defaults)",
            "default_connection": state.default_connection,
            "connections": {},
        }

        for conn in state.connections.values():
            result["connections"][conn.name] = {
                "host": conn.host,
                "port": conn.port,
                "extension_id": conn.extension_id,
                "sw_collector_connected": conn.sw_log_collector_connected,
                "page_collector_connected": conn.page_log_collector_connected,
                "log_buffer_size": len(conn.log_buffer),
            }

        return [TextContent(type="text", text=json.dumps(result, indent=2))]

    # --- ext_status ---
    if name == "ext_status":
        connections = get_connections(conn_name or "all")
        if not connections:
            return [TextContent(type="text", text=f"Connection '{conn_name}' not found")]

        # Start log collectors for queried connections
        for conn in connections:
            ensure_sw_log_collector(conn)
            ensure_page_log_collector(conn)

        # Get status for all connections concurrently
        statuses = await asyncio.gather(*[get_connection_status(conn) for conn in connections])

        if len(statuses) == 1:
            result = statuses[0]
        else:
            result = {"connections": {s["name"]: s for s in statuses}}

        return [TextContent(type="text", text=json.dumps(result, indent=2))]

    # --- ext_set_extension_id ---
    elif name == "ext_set_extension_id":
        new_id = arguments.get("id", "")
        if len(new_id) != 32:
            return [TextContent(type="text", text=f"Invalid extension ID: must be 32 characters, got {len(new_id)}")]

        connections = get_connections(conn_name)
        if not connections:
            return [TextContent(type="text", text=f"Connection '{conn_name}' not found")]

        results = []
        for conn in connections:
            old_id = conn.extension_id
            conn.extension_id = new_id

            # Clear log buffer and stop collectors for new extension
            conn.log_buffer.clear()
            if conn.sw_log_collector_task:
                conn.sw_log_collector_task.cancel()
                conn.sw_log_collector_task = None
            if conn.page_log_collector_task:
                conn.page_log_collector_task.cancel()
                conn.page_log_collector_task = None

            results.append(f"{conn.name}: {old_id} -> {new_id}")

        return [TextContent(type="text", text="Extension ID changed:\n" + "\n".join(results))]

    # --- ext_reload ---
    elif name == "ext_reload":
        restore_tabs = arguments.get("restore_tabs", True)
        connections = get_connections(conn_name)
        if not connections:
            return [TextContent(type="text", text=f"Connection '{conn_name}' not found")]

        async def reload_one(conn: ConnectionState) -> dict:
            sw = await cdp_find_service_worker(conn)
            if not sw:
                return {"connection": conn.name, "error": f"Extension not found or service worker not active"}

            # Capture extension page URLs before reload
            extension_page_urls = []
            if restore_tabs:
                targets = await cdp_find_extension_targets(conn)
                for t in targets:
                    if t.get("type") == "page":
                        url = t.get("url", "")
                        if url.startswith(f"chrome-extension://{conn.extension_id}/"):
                            extension_page_urls.append(url)

            ws_url = sw.get("webSocketDebuggerUrl")
            if not ws_url:
                return {"connection": conn.name, "error": "Service worker has no debugger URL"}
            reload_result = "triggered"
            try:
                async with websockets.connect(ws_url) as ws:
                    await ws.send(json.dumps({
                        "id": 1,
                        "method": "Runtime.evaluate",
                        "params": {"expression": "chrome.runtime.reload()"}
                    }))
            except Exception as e:
                reload_result = f"triggered (connection closed: {type(e).__name__})"

            # Restore tabs if requested
            restored_tabs = []
            if restore_tabs and extension_page_urls:
                for _ in range(10):
                    await asyncio.sleep(0.5)
                    new_sw = await cdp_find_service_worker(conn)
                    if new_sw and new_sw.get("webSocketDebuggerUrl"):
                        break
                else:
                    return {
                        "connection": conn.name,
                        "reload": reload_result,
                        "restore_tabs": "failed - extension did not restart in time",
                        "urls_to_restore": extension_page_urls,
                    }

                new_sw = await cdp_find_service_worker(conn)
                new_ws_url = new_sw.get("webSocketDebuggerUrl") if new_sw else None
                if new_ws_url:
                    for url in extension_page_urls:
                        try:
                            url_json = json.dumps(url)
                            await cdp_evaluate(new_ws_url, f"chrome.tabs.create({{url: {url_json}}})")
                            restored_tabs.append(url)
                        except Exception as e:
                            restored_tabs.append(f"{url} (failed: {e})")

            result: dict[str, Any] = {
                "connection": conn.name,
                "reload": reload_result,
                "extension_id": conn.extension_id,
            }
            if restore_tabs:
                result["restored_tabs"] = restored_tabs if restored_tabs else ["none (no extension pages were open)"]

            return result

        results = await asyncio.gather(*[reload_one(conn) for conn in connections])

        if len(results) == 1:
            return [TextContent(type="text", text=json.dumps(results[0], indent=2))]
        return [TextContent(type="text", text=json.dumps({"results": results}, indent=2))]

    # --- ext_evaluate ---
    elif name == "ext_evaluate":
        expression = arguments.get("expression", "")
        target_type = arguments.get("target", "sw")
        connections = get_connections(conn_name)
        if not connections:
            return [TextContent(type="text", text=f"Connection '{conn_name}' not found")]

        async def evaluate_one(conn: ConnectionState) -> dict:
            if target_type == "sw":
                target = await cdp_find_service_worker(conn)
                if not target:
                    return {"connection": conn.name, "error": f"Service worker not active"}
            else:
                target = await cdp_find_extension_page(conn)
                if not target:
                    return {"connection": conn.name, "error": f"No extension page found"}

            ws_url = target.get("webSocketDebuggerUrl")
            if not ws_url:
                return {"connection": conn.name, "error": "Target has no debugger URL"}
            try:
                result = await cdp_evaluate(ws_url, expression)

                if "error" in result:
                    return {"connection": conn.name, "error": f"CDP error: {result['error']}"}

                eval_result = result.get("result", {})
                if "exceptionDetails" in eval_result:
                    exc = eval_result["exceptionDetails"]
                    return {"connection": conn.name, "error": f"Exception: {exc.get('text', 'Unknown error')}"}

                value = eval_result.get("result", {}).get("value")
                return {"connection": conn.name, "result": value}

            except Exception as e:
                return {"connection": conn.name, "error": f"Evaluation failed: {type(e).__name__}: {e}"}

        results = await asyncio.gather(*[evaluate_one(conn) for conn in connections])

        if len(results) == 1:
            r = results[0]
            if "error" in r:
                return [TextContent(type="text", text=r["error"])]
            return [TextContent(type="text", text=json.dumps(r["result"], indent=2, default=str))]

        return [TextContent(type="text", text=json.dumps({"results": results}, indent=2, default=str))]

    # --- ext_get_storage ---
    elif name == "ext_get_storage":
        area = arguments.get("area", "local")
        keys = arguments.get("keys")
        connections = get_connections(conn_name)
        if not connections:
            return [TextContent(type="text", text=f"Connection '{conn_name}' not found")]

        async def get_storage_one(conn: ConnectionState) -> dict:
            sw = await cdp_find_service_worker(conn)
            if not sw:
                return {"connection": conn.name, "error": "Service worker not active"}

            ws_url = sw.get("webSocketDebuggerUrl")
            if not ws_url:
                return {"connection": conn.name, "error": "Service worker has no debugger URL"}

            if keys:
                keys_json = json.dumps(keys)
                expression = f"chrome.storage.{area}.get({keys_json})"
            else:
                expression = f"chrome.storage.{area}.get()"

            try:
                result = await cdp_evaluate(ws_url, expression)
                eval_result = result.get("result", {})
                value = eval_result.get("result", {}).get("value", {})

                return {"connection": conn.name, "area": area, "data": value}
            except Exception as e:
                return {"connection": conn.name, "error": f"Storage read failed: {e}"}

        results = await asyncio.gather(*[get_storage_one(conn) for conn in connections])

        if len(results) == 1:
            return [TextContent(type="text", text=json.dumps(results[0], indent=2))]
        return [TextContent(type="text", text=json.dumps({"results": results}, indent=2))]

    # --- ext_start_logs ---
    elif name == "ext_start_logs":
        target = arguments.get("target", "all")
        clear = arguments.get("clear", False)
        connections = get_connections(conn_name or "all")
        if not connections:
            return [TextContent(type="text", text=f"Connection '{conn_name}' not found")]

        results = []
        for conn in connections:
            if clear:
                conn.log_buffer.clear()

            started = []
            if target in ("sw", "all"):
                ensure_sw_log_collector(conn)
                started.append("sw")
            if target in ("page", "all"):
                ensure_page_log_collector(conn)
                started.append("page")

            results.append({
                "connection": conn.name,
                "started": started,
                "cleared": clear,
            })

        # Give collectors a moment to connect
        await asyncio.sleep(0.5)

        # Update results with connection status
        for r in results:
            conn = state.connections[r["connection"]]
            r["sw_collector"] = {
                "running": conn.sw_log_collector_task is not None and not conn.sw_log_collector_task.done(),
                "connected": conn.sw_log_collector_connected,
            }
            r["page_collector"] = {
                "running": conn.page_log_collector_task is not None and not conn.page_log_collector_task.done(),
                "connected": conn.page_log_collector_connected,
            }
            r["buffer_size"] = len(conn.log_buffer)

        if len(results) == 1:
            return [TextContent(type="text", text=json.dumps(results[0], indent=2))]
        return [TextContent(type="text", text=json.dumps({"results": results}, indent=2))]

    # --- ext_get_logs ---
    elif name == "ext_get_logs":
        limit = arguments.get("limit", 50)
        level_filter = arguments.get("level", "all")
        source_filter = arguments.get("source", "all")
        connections = get_connections(conn_name or "all")
        if not connections:
            return [TextContent(type="text", text=f"Connection '{conn_name}' not found")]

        all_results = []
        for conn in connections:
            logs = list(conn.log_buffer)

            # Filter by level
            if level_filter != "all":
                logs = [l for l in logs if l.level == level_filter]

            # Filter by source
            if source_filter != "all":
                logs = [l for l in logs if l.source == source_filter]

            logs = logs[-limit:]

            formatted = []
            for log in logs:
                entry = {
                    "timestamp": log.timestamp,
                    "level": log.level,
                    "source": log.source,
                    "text": log.text,
                }
                if log.stack:
                    entry["stack"] = log.stack
                formatted.append(entry)

            all_results.append({
                "connection": conn.name,
                "logs": formatted,
                "buffer_total": len(conn.log_buffer),
                "sw_collector_connected": conn.sw_log_collector_connected,
                "page_collector_connected": conn.page_log_collector_connected,
            })

        if len(all_results) == 1:
            return [TextContent(type="text", text=json.dumps(all_results[0], indent=2))]
        return [TextContent(type="text", text=json.dumps({"results": all_results}, indent=2))]

    # --- ext_list_targets ---
    elif name == "ext_list_targets":
        extension_only = arguments.get("extension_only", False)
        connections = get_connections(conn_name or "all")
        if not connections:
            return [TextContent(type="text", text=f"Connection '{conn_name}' not found")]

        async def list_targets_one(conn: ConnectionState) -> dict:
            targets = await cdp_get_targets(conn)
            if targets is None:
                return {"connection": conn.name, "error": f"CDP not reachable at {conn.host}:{conn.port}"}

            if extension_only:
                targets = [t for t in targets if conn.extension_id in t.get("url", "")]

            formatted = []
            for t in targets:
                formatted.append({
                    "id": t.get("id"),
                    "type": t.get("type"),
                    "title": t.get("title"),
                    "url": t.get("url"),
                })

            return {"connection": conn.name, "targets": formatted}

        results = await asyncio.gather(*[list_targets_one(conn) for conn in connections])

        if len(results) == 1:
            return [TextContent(type="text", text=json.dumps(results[0], indent=2))]
        return [TextContent(type="text", text=json.dumps({"results": results}, indent=2))]

    return [TextContent(type="text", text=f"Unknown tool: {name}")]


# =============================================================================
# Main
# =============================================================================

async def main():
    init_connections()
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


if __name__ == "__main__":
    asyncio.run(main())
