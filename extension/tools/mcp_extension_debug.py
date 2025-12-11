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
DEFAULT_EXTENSION_ID = "dbokmlpefliilbjldladbimlcfgbolhk"
LOG_BUFFER_SIZE = 500

server = Server("chrome-extension-debug")


@dataclass
class LogEntry:
    timestamp: float
    level: str
    text: str
    source: str = "sw"  # "sw" for service worker, "page" for extension pages
    stack: str | None = None


@dataclass
class ServerState:
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

async def sw_log_collector_loop():
    """Background task that maintains persistent connection to SW and collects logs."""
    while True:
        try:
            sw = await cdp_find_service_worker(state.extension_id)
            if not sw:
                state.sw_log_collector_connected = False
                state.sw_log_collector_ws_url = None
                await asyncio.sleep(2)
                continue

            ws_url = sw.get("webSocketDebuggerUrl")
            if not ws_url:
                await asyncio.sleep(2)
                continue

            state.sw_log_collector_ws_url = ws_url

            async with websockets.connect(ws_url) as ws:
                # Enable console and runtime events
                await ws.send(json.dumps({"id": 1, "method": "Runtime.enable"}))
                await ws.send(json.dumps({"id": 2, "method": "Console.enable"}))
                state.sw_log_collector_connected = True

                # Add connection marker to buffer
                state.log_buffer.append(LogEntry(
                    timestamp=datetime.now().timestamp() * 1000,
                    level="info",
                    text="[SW LogCollector] Connected to service worker",
                    source="sw",
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
                                text="[SW LogCollector] Service worker restarted, reconnecting...",
                                source="sw",
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
                            source="sw",
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
                            source="sw",
                            stack=stack,
                        ))

        except websockets.exceptions.ConnectionClosed:
            pass
        except Exception as e:
            state.log_buffer.append(LogEntry(
                timestamp=datetime.now().timestamp() * 1000,
                level="error",
                text=f"[SW LogCollector] Error: {type(e).__name__}: {e}",
                source="sw",
            ))

        state.sw_log_collector_connected = False
        await asyncio.sleep(1)


async def page_log_collector_loop():
    """Background task that maintains persistent connection to extension pages and collects logs."""
    while True:
        try:
            page = await cdp_find_extension_page(state.extension_id)
            if not page:
                state.page_log_collector_connected = False
                state.page_log_collector_ws_url = None
                await asyncio.sleep(2)
                continue

            ws_url = page.get("webSocketDebuggerUrl")
            if not ws_url:
                await asyncio.sleep(2)
                continue

            state.page_log_collector_ws_url = ws_url

            async with websockets.connect(ws_url) as ws:
                # Enable console and runtime events
                await ws.send(json.dumps({"id": 1, "method": "Runtime.enable"}))
                await ws.send(json.dumps({"id": 2, "method": "Console.enable"}))
                state.page_log_collector_connected = True

                page_url = page.get("url", "unknown")
                # Add connection marker to buffer
                state.log_buffer.append(LogEntry(
                    timestamp=datetime.now().timestamp() * 1000,
                    level="info",
                    text=f"[Page LogCollector] Connected to extension page: {page_url}",
                    source="page",
                ))

                # Read events
                while True:
                    try:
                        message = await asyncio.wait_for(ws.recv(), timeout=2.0)
                    except asyncio.TimeoutError:
                        # Check if page URL changed (popup closed/reopened)
                        current_page = await cdp_find_extension_page(state.extension_id)
                        current_url = current_page.get("webSocketDebuggerUrl") if current_page else None
                        if current_url != ws_url:
                            state.log_buffer.append(LogEntry(
                                timestamp=datetime.now().timestamp() * 1000,
                                level="info",
                                text="[Page LogCollector] Extension page changed, reconnecting...",
                                source="page",
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
                            source="page",
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
                            source="page",
                            stack=stack,
                        ))

        except websockets.exceptions.ConnectionClosed:
            pass
        except Exception as e:
            state.log_buffer.append(LogEntry(
                timestamp=datetime.now().timestamp() * 1000,
                level="error",
                text=f"[Page LogCollector] Error: {type(e).__name__}: {e}",
                source="page",
            ))

        state.page_log_collector_connected = False
        await asyncio.sleep(1)


def ensure_sw_log_collector():
    """Start service worker log collector if not already running."""
    if state.sw_log_collector_task is None or state.sw_log_collector_task.done():
        state.sw_log_collector_task = asyncio.create_task(sw_log_collector_loop())


def ensure_page_log_collector():
    """Start extension page log collector if not already running."""
    if state.page_log_collector_task is None or state.page_log_collector_task.done():
        state.page_log_collector_task = asyncio.create_task(page_log_collector_loop())


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
            description="Reload the extension via chrome.runtime.reload(). Triggers service worker restart. By default, re-opens any extension tabs that were open.",
            inputSchema={
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Extension ID (uses default if not specified)"},
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
            name="ext_start_logs",
            description="Start log collection from extension. Call BEFORE performing actions you want to capture. Workflow: start_logs → do actions → get_logs.",
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
                },
            },
        ),
        Tool(
            name="ext_get_logs",
            description="Get collected console logs. Use ext_start_logs first to begin collection.",
            inputSchema={
                "type": "object",
                "properties": {
                    "limit": {"type": "integer", "description": "Max entries to return (default: 50)"},
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
            "log_collectors": {
                "sw_connected": state.sw_log_collector_connected,
                "page_connected": state.page_log_collector_connected,
                "buffer_size": len(state.log_buffer),
            },
            "hint": "Use ext_start_logs to begin capturing logs before actions",
        }

        return [TextContent(type="text", text=json.dumps(status, indent=2))]

    # --- ext_set_extension_id ---
    elif name == "ext_set_extension_id":
        new_id = arguments.get("id", "")
        if len(new_id) != 32:
            return [TextContent(type="text", text=f"Invalid extension ID: must be 32 characters, got {len(new_id)}")]

        old_id = state.extension_id
        state.extension_id = new_id

        # Clear log buffer and stop collectors for new extension
        state.log_buffer.clear()
        if state.sw_log_collector_task:
            state.sw_log_collector_task.cancel()
            state.sw_log_collector_task = None
        if state.page_log_collector_task:
            state.page_log_collector_task.cancel()
            state.page_log_collector_task = None

        return [TextContent(type="text", text=f"Extension ID changed: {old_id} → {new_id}")]

    # --- ext_reload ---
    elif name == "ext_reload":
        ext_id = arguments.get("id", state.extension_id)
        restore_tabs = arguments.get("restore_tabs", True)

        sw = await cdp_find_service_worker(ext_id)
        if not sw:
            return [TextContent(type="text", text=f"Extension {ext_id} not found or service worker not active")]

        # Capture extension page URLs before reload
        extension_page_urls = []
        if restore_tabs:
            targets = await cdp_find_extension_targets(ext_id)
            for t in targets:
                if t.get("type") == "page":
                    url = t.get("url", "")
                    # Only restore top-level extension pages (not devtools, etc)
                    if url.startswith(f"chrome-extension://{ext_id}/"):
                        extension_page_urls.append(url)

        ws_url = sw.get("webSocketDebuggerUrl")
        reload_result = "triggered"
        try:
            # Don't await response - connection dies on reload
            async with websockets.connect(ws_url) as ws:
                await ws.send(json.dumps({
                    "id": 1,
                    "method": "Runtime.evaluate",
                    "params": {"expression": "chrome.runtime.reload()"}
                }))
        except Exception as e:
            reload_result = f"triggered (connection closed: {type(e).__name__})"

        # Restore tabs if requested and there were pages to restore
        restored_tabs = []
        if restore_tabs and extension_page_urls:
            # Wait for extension to come back up
            for _ in range(10):  # Try for up to 5 seconds
                await asyncio.sleep(0.5)
                new_sw = await cdp_find_service_worker(ext_id)
                if new_sw and new_sw.get("webSocketDebuggerUrl"):
                    break
            else:
                return [TextContent(type="text", text=json.dumps({
                    "reload": reload_result,
                    "restore_tabs": "failed - extension did not restart in time",
                    "urls_to_restore": extension_page_urls,
                }, indent=2))]

            # Re-open each extension page using the service worker
            new_sw = await cdp_find_service_worker(ext_id)
            new_ws_url = new_sw.get("webSocketDebuggerUrl") if new_sw else None
            if new_ws_url:
                for url in extension_page_urls:
                    try:
                        url_json = json.dumps(url)
                        await cdp_evaluate(new_ws_url, f"chrome.tabs.create({{url: {url_json}}})")
                        restored_tabs.append(url)
                    except Exception as e:
                        restored_tabs.append(f"{url} (failed: {e})")

        result = {
            "reload": reload_result,
            "extension_id": ext_id,
        }
        if restore_tabs:
            result["restored_tabs"] = restored_tabs if restored_tabs else "none (no extension pages were open)"

        return [TextContent(type="text", text=json.dumps(result, indent=2))]

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

    # --- ext_start_logs ---
    elif name == "ext_start_logs":
        target = arguments.get("target", "all")
        clear = arguments.get("clear", False)

        if clear:
            state.log_buffer.clear()

        started = []
        if target in ("sw", "all"):
            ensure_sw_log_collector()
            started.append("sw")
        if target in ("page", "all"):
            ensure_page_log_collector()
            started.append("page")

        # Give collectors a moment to connect
        await asyncio.sleep(0.5)

        result = {
            "started": started,
            "cleared": clear,
            "sw_collector": {
                "running": state.sw_log_collector_task is not None and not state.sw_log_collector_task.done(),
                "connected": state.sw_log_collector_connected,
            },
            "page_collector": {
                "running": state.page_log_collector_task is not None and not state.page_log_collector_task.done(),
                "connected": state.page_log_collector_connected,
            },
            "buffer_size": len(state.log_buffer),
        }

        return [TextContent(type="text", text=json.dumps(result, indent=2))]

    # --- ext_get_logs ---
    elif name == "ext_get_logs":
        limit = arguments.get("limit", 50)
        level_filter = arguments.get("level", "all")
        source_filter = arguments.get("source", "all")

        logs = list(state.log_buffer)

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

        result = {
            "logs": formatted,
            "buffer_total": len(state.log_buffer),
            "sw_collector_connected": state.sw_log_collector_connected,
            "page_collector_connected": state.page_log_collector_connected,
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
