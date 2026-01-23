#!/usr/bin/env python3
"""
ChromeOS C2 MCP Server
Exposes ChromeOS control tools to Claude via MCP protocol.

Usage:
    python3 mcp_chromeos.py

Register with Claude:
    claude mcp add chromeos python3 /path/to/mcp_chromeos.py
"""

import asyncio
import json
import base64
import aiohttp
from io import BytesIO
from typing import Any, Optional

from PIL import Image
import pytesseract
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import TextContent, ImageContent, Tool

try:
    import websockets
except ImportError:
    websockets = None

# SSH connection details
SSH_HOST = "chromeroot"
CLIENT_PATH = "/mnt/stateful_partition/c2/client.py"
SSH_ENV = "LD_LIBRARY_PATH=/usr/local/lib64"

# CDP connection details (via SSH tunnel)
CDP_HOST = "localhost"
CDP_PORT = 9222

server = Server("chromeos")


class ChromeOSConnection:
    """Manages SSH subprocess to Chromebook."""

    def __init__(self):
        self.process = None
        self._lock = asyncio.Lock()

    async def connect(self):
        """Start SSH subprocess."""
        if self.process is not None and self.process.returncode is None:
            return  # Already connected

        self.process = await asyncio.create_subprocess_exec(
            "ssh", SSH_HOST,
            f"{SSH_ENV} python3 {CLIENT_PATH}",
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            limit=50 * 1024 * 1024,  # 50MB buffer for large screenshots
        )

    async def send_command(self, cmd: dict, timeout: float = 30) -> dict:
        """Send command, wait for response."""
        async with self._lock:
            if self.process is None or self.process.returncode is not None:
                await self.connect()

            line = json.dumps(cmd) + "\n"
            self.process.stdin.write(line.encode())
            await self.process.stdin.drain()

            try:
                response_line = await asyncio.wait_for(
                    self.process.stdout.readline(),
                    timeout=timeout
                )
                if not response_line:
                    # Connection closed, try to reconnect
                    self.process = None
                    return {"error": "Connection closed"}
                return json.loads(response_line.decode())
            except asyncio.TimeoutError:
                return {"error": "Command timed out"}
            except json.JSONDecodeError as e:
                return {"error": f"Invalid response: {e}"}

    async def close(self):
        """Close SSH connection."""
        if self.process:
            self.process.terminate()
            await self.process.wait()
            self.process = None


# Global connection instance
connection = ChromeOSConnection()

# Track screenshot scaling for coordinate mapping
# Screenshots are captured at physical resolution - we scale back to physical for touch input
class ScreenState:
    def __init__(self):
        self.screenshot_width = None  # Width after scaling for display
        self.screenshot_height = None
        self.physical_width = None  # Physical screen resolution (what touchscreen maps to)
        self.physical_height = None

    @property
    def scale_factor(self) -> float:
        """Returns scale factor to convert screenshot coords to physical screen coords."""
        if self.physical_width and self.screenshot_width:
            return self.physical_width / self.screenshot_width
        return 1.0

screen_state = ScreenState()


class CDPInput:
    """Handles input injection via Chrome DevTools Protocol."""

    def __init__(self):
        self._msg_id = 0

    async def _get_active_page_ws_url(self) -> Optional[str]:
        """Get the WebSocket debugger URL for the active/focused page."""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(f"http://{CDP_HOST}:{CDP_PORT}/json") as resp:
                    if resp.status != 200:
                        return None
                    targets = await resp.json()

            # Find a suitable page target (prefer non-extension pages)
            for target in targets:
                if target.get("type") == "page":
                    url = target.get("url", "")
                    # Skip extension and system pages
                    if not url.startswith("chrome-extension://") and not url.startswith("chrome://"):
                        return target.get("webSocketDebuggerUrl")

            # Fall back to any page
            for target in targets:
                if target.get("type") == "page":
                    return target.get("webSocketDebuggerUrl")

            return None
        except Exception:
            return None

    async def tap(self, x: int, y: int) -> dict:
        """Send a tap/click at the given coordinates via CDP."""
        if websockets is None:
            return {"error": "websockets module not available"}

        ws_url = await self._get_active_page_ws_url()
        if not ws_url:
            return {"error": "No CDP page target available"}

        try:
            async with websockets.connect(ws_url) as ws:
                self._msg_id += 1
                # Mouse pressed
                await ws.send(json.dumps({
                    "id": self._msg_id,
                    "method": "Input.dispatchMouseEvent",
                    "params": {
                        "type": "mousePressed",
                        "x": x,
                        "y": y,
                        "button": "left",
                        "clickCount": 1
                    }
                }))
                await ws.recv()

                await asyncio.sleep(0.05)

                self._msg_id += 1
                # Mouse released
                await ws.send(json.dumps({
                    "id": self._msg_id,
                    "method": "Input.dispatchMouseEvent",
                    "params": {
                        "type": "mouseReleased",
                        "x": x,
                        "y": y,
                        "button": "left",
                        "clickCount": 1
                    }
                }))
                await ws.recv()

            return {"ok": True, "method": "cdp"}
        except Exception as e:
            return {"error": f"CDP tap failed: {e}"}

    async def swipe(self, x1: int, y1: int, x2: int, y2: int, duration_ms: int = 300) -> dict:
        """Send a swipe/drag gesture via CDP."""
        if websockets is None:
            return {"error": "websockets module not available"}

        ws_url = await self._get_active_page_ws_url()
        if not ws_url:
            return {"error": "No CDP page target available"}

        try:
            async with websockets.connect(ws_url) as ws:
                steps = 20
                delay = (duration_ms / 1000) / steps

                self._msg_id += 1
                # Start drag
                await ws.send(json.dumps({
                    "id": self._msg_id,
                    "method": "Input.dispatchMouseEvent",
                    "params": {
                        "type": "mousePressed",
                        "x": x1,
                        "y": y1,
                        "button": "left",
                        "clickCount": 1
                    }
                }))
                await ws.recv()

                # Move through points
                for i in range(1, steps + 1):
                    t = i / steps
                    x = int(x1 + (x2 - x1) * t)
                    y = int(y1 + (y2 - y1) * t)

                    self._msg_id += 1
                    await ws.send(json.dumps({
                        "id": self._msg_id,
                        "method": "Input.dispatchMouseEvent",
                        "params": {
                            "type": "mouseMoved",
                            "x": x,
                            "y": y,
                            "button": "left"
                        }
                    }))
                    await ws.recv()
                    await asyncio.sleep(delay)

                self._msg_id += 1
                # Release
                await ws.send(json.dumps({
                    "id": self._msg_id,
                    "method": "Input.dispatchMouseEvent",
                    "params": {
                        "type": "mouseReleased",
                        "x": x2,
                        "y": y2,
                        "button": "left",
                        "clickCount": 1
                    }
                }))
                await ws.recv()

            return {"ok": True, "method": "cdp"}
        except Exception as e:
            return {"error": f"CDP swipe failed: {e}"}


# Global CDP input instance
cdp_input = CDPInput()


@server.list_tools()
async def list_tools() -> list[Tool]:
    """List available tools."""
    return [
        Tool(
            name="screenshot",
            description="Capture ChromeOS screenshot. Returns the image.",
            inputSchema={
                "type": "object",
                "properties": {},
            },
        ),
        Tool(
            name="tap",
            description="Tap at screen coordinates on ChromeOS. Coordinates are auto-scaled from screenshot space to actual screen space (e.g., if screenshot was scaled 2x, tap coords are scaled 2x).",
            inputSchema={
                "type": "object",
                "properties": {
                    "x": {"type": "integer", "description": "X coordinate (in screenshot space, auto-scaled to screen)"},
                    "y": {"type": "integer", "description": "Y coordinate (in screenshot space, auto-scaled to screen)"},
                },
                "required": ["x", "y"],
            },
        ),
        Tool(
            name="swipe",
            description="Swipe gesture on ChromeOS touchscreen. Coordinates are auto-scaled from screenshot space to actual screen space.",
            inputSchema={
                "type": "object",
                "properties": {
                    "x1": {"type": "integer", "description": "Start X coordinate (screenshot space)"},
                    "y1": {"type": "integer", "description": "Start Y coordinate (screenshot space)"},
                    "x2": {"type": "integer", "description": "End X coordinate (screenshot space)"},
                    "y2": {"type": "integer", "description": "End Y coordinate (screenshot space)"},
                    "duration_ms": {"type": "integer", "description": "Duration in milliseconds (default 300)"},
                },
                "required": ["x1", "y1", "x2", "y2"],
            },
        ),
        Tool(
            name="type_text",
            description="Type text on ChromeOS keyboard.",
            inputSchema={
                "type": "object",
                "properties": {
                    "text": {"type": "string", "description": "Text to type"},
                },
                "required": ["text"],
            },
        ),
        Tool(
            name="press_keys",
            description="""Press key combination by Linux keycodes.
Common keys: Enter=28, Space=57, Tab=15, Esc=1, Backspace=14
Modifiers: Ctrl=29, Alt=56, Shift=42, Search/Meta=125
Function: F1=59, F2=60, F3=61, F4=62, F5=63
Arrows: Left=105, Right=106, Up=103, Down=108
Screenshot: Search+F5 = [125, 63]""",
            inputSchema={
                "type": "object",
                "properties": {
                    "keys": {
                        "type": "array",
                        "items": {"type": "integer"},
                        "description": "Array of Linux keycodes to press simultaneously",
                    },
                },
                "required": ["keys"],
            },
        ),
        Tool(
            name="set_resolution",
            description="Set screen resolution for coordinate mapping. Default is 1600x900.",
            inputSchema={
                "type": "object",
                "properties": {
                    "x": {"type": "integer", "description": "Screen width"},
                    "y": {"type": "integer", "description": "Screen height"},
                },
                "required": ["x", "y"],
            },
        ),
        Tool(
            name="chromeos_info",
            description="Get ChromeOS device info including screen resolution, touchscreen details, and keyboard configuration (layout and modifier remappings).",
            inputSchema={
                "type": "object",
                "properties": {},
            },
        ),
        Tool(
            name="shortcut",
            description="""Execute a keyboard shortcut with automatic modifier key remapping.
This automatically handles the user's Ctrl↔Search swap and other modifier remappings.
Use this instead of press_keys when you want logical modifier behavior (e.g., "Ctrl+T" for new tab).
Modifiers: ctrl, alt, shift, search
Keys: a-z, 0-9, f1-f12, and symbols""",
            inputSchema={
                "type": "object",
                "properties": {
                    "modifiers": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Modifier keys: ctrl, alt, shift, search",
                    },
                    "key": {
                        "type": "string",
                        "description": "The main key (e.g., 't', 'f5', 'a')",
                    },
                },
                "required": ["key"],
            },
        ),
        Tool(
            name="reload_keyboard_config",
            description="Reload keyboard configuration from ChromeOS preferences. Call this if user changes keyboard settings during the session.",
            inputSchema={
                "type": "object",
                "properties": {},
            },
        ),
    ]


@server.call_tool()
async def call_tool(name: str, arguments: dict[str, Any]) -> list[TextContent | ImageContent]:
    """Handle tool calls."""

    if name == "screenshot":
        result = await connection.send_command({"cmd": "screenshot"}, timeout=15)

        if "error" in result:
            return [TextContent(type="text", text=f"Error: {result['error']}")]

        image_data = result.get("image")
        if not image_data:
            return [TextContent(type="text", text="Error: No image data returned")]

        # Resize large screenshots to max 1920px width
        image_bytes = base64.b64decode(image_data)
        img = Image.open(BytesIO(image_bytes))

        # Track physical dimensions (touchscreen is calibrated to physical display)
        screen_state.physical_width = img.width
        screen_state.physical_height = img.height

        max_width = 1920
        if img.width > max_width:
            ratio = max_width / img.width
            new_size = (max_width, int(img.height * ratio))
            img = img.resize(new_size, Image.LANCZOS)

        # Track scaled dimensions for coordinate mapping
        screen_state.screenshot_width = img.width
        screen_state.screenshot_height = img.height

        # Run OCR on resized image
        try:
            ocr_text = pytesseract.image_to_string(img)
        except Exception as e:
            ocr_text = f"OCR failed: {e}"

        # Re-encode as PNG
        output = BytesIO()
        img.save(output, format="PNG", optimize=True)
        resized_data = base64.b64encode(output.getvalue()).decode('ascii')

        scale_info = f"Screenshot: {screen_state.screenshot_width}x{screen_state.screenshot_height} (physical: {screen_state.physical_width}x{screen_state.physical_height}, scale: {screen_state.scale_factor:.2f}x)"

        return [
            ImageContent(type="image", data=resized_data, mimeType="image/png"),
            TextContent(type="text", text=f"{scale_info}\nOCR Text:\n{ocr_text}"),
        ]

    elif name == "tap":
        x = arguments.get("x")
        y = arguments.get("y")

        # Auto-scale coordinates from screenshot space to actual screen space
        scale = screen_state.scale_factor
        if scale != 1.0:
            orig_x, orig_y = x, y
            x = int(x * scale)
            y = int(y * scale)
            scale_msg = f" (scaled from {orig_x},{orig_y} by {scale:.2f}x)"
        else:
            scale_msg = ""

        # First check display state to decide method
        info_result = await connection.send_command({"cmd": "info"})
        display = info_result.get("display", {})
        internal_enabled = display.get("internal_enabled", True)

        # Use CDP when internal display is disabled (external monitor mode)
        if not internal_enabled and websockets is not None:
            result = await cdp_input.tap(x, y)
            if "error" not in result:
                return [TextContent(type="text", text=f"Tapped at ({x}, {y}){scale_msg} [method=CDP]")]
            # Fall through to SSH method if CDP fails

        # SSH-based method (works when internal display is enabled)
        result = await connection.send_command({"cmd": "tap", "x": x, "y": y})

        if "error" in result:
            return [TextContent(type="text", text=f"Error: {result['error']}")]
        device_type = result.get("device_type", "unknown")
        return [TextContent(type="text", text=f"Tapped at ({x}, {y}){scale_msg} [device={device_type}]")]

    elif name == "swipe":
        x1 = arguments.get("x1")
        y1 = arguments.get("y1")
        x2 = arguments.get("x2")
        y2 = arguments.get("y2")
        duration_ms = arguments.get("duration_ms", 300)

        # Auto-scale coordinates from screenshot space to actual screen space
        scale = screen_state.scale_factor
        if scale != 1.0:
            orig = (x1, y1, x2, y2)
            x1 = int(x1 * scale)
            y1 = int(y1 * scale)
            x2 = int(x2 * scale)
            y2 = int(y2 * scale)
            scale_msg = f" (scaled by {scale:.2f}x)"
        else:
            scale_msg = ""

        # First check display state to decide method
        info_result = await connection.send_command({"cmd": "info"})
        display = info_result.get("display", {})
        internal_enabled = display.get("internal_enabled", True)

        # Use CDP when internal display is disabled (external monitor mode)
        if not internal_enabled and websockets is not None:
            result = await cdp_input.swipe(x1, y1, x2, y2, duration_ms)
            if "error" not in result:
                return [TextContent(type="text", text=f"Swiped ({x1},{y1}) -> ({x2},{y2}){scale_msg} [method=CDP]")]
            # Fall through to SSH method if CDP fails

        # SSH-based method
        result = await connection.send_command({
            "cmd": "swipe",
            "x1": x1, "y1": y1,
            "x2": x2, "y2": y2,
            "duration_ms": duration_ms
        })

        if "error" in result:
            return [TextContent(type="text", text=f"Error: {result['error']}")]
        return [TextContent(type="text", text=f"Swiped ({x1},{y1}) -> ({x2},{y2}){scale_msg}")]

    elif name == "type_text":
        text = arguments.get("text", "")
        result = await connection.send_command({"cmd": "type", "text": text})

        if "error" in result:
            return [TextContent(type="text", text=f"Error: {result['error']}")]
        return [TextContent(type="text", text=f"Typed: {text}")]

    elif name == "press_keys":
        keys = arguments.get("keys", [])
        result = await connection.send_command({"cmd": "key", "keys": keys})

        if "error" in result:
            return [TextContent(type="text", text=f"Error: {result['error']}")]
        return [TextContent(type="text", text=f"Pressed keys: {keys}")]

    elif name == "set_resolution":
        x = arguments.get("x")
        y = arguments.get("y")
        result = await connection.send_command({"cmd": "resolution", "x": x, "y": y})

        if "error" in result:
            return [TextContent(type="text", text=f"Error: {result['error']}")]
        return [TextContent(type="text", text=f"Resolution set to {x}x{y}")]

    elif name == "chromeos_info":
        result = await connection.send_command({"cmd": "info"})

        if "error" in result:
            return [TextContent(type="text", text=f"Error: {result['error']}")]

        kb = result.get('keyboard', {})
        info_text = f"""ChromeOS Device Info:
  Screen: {result.get('screen', ['?', '?'])}
  Touch max: {result.get('touch_max', ['?', '?'])}
  Device: {result.get('device', '?')}
  Keyboard layout: {kb.get('layout', 'qwerty')}
  Modifier remappings: {kb.get('modifier_remappings', {})}
  Ctrl keycode: {kb.get('ctrl_keycode', 29)} (use shortcut tool for auto-remapping)
  Search keycode: {kb.get('search_keycode', 125)}"""
        return [TextContent(type="text", text=info_text)]

    elif name == "shortcut":
        modifiers = arguments.get("modifiers", [])
        key = arguments.get("key", "")
        result = await connection.send_command({
            "cmd": "shortcut",
            "modifiers": modifiers,
            "key": key
        })

        if "error" in result:
            return [TextContent(type="text", text=f"Error: {result['error']}")]

        keycodes = result.get("keycodes_sent", [])
        mod_str = "+".join(modifiers) + "+" if modifiers else ""
        return [TextContent(type="text", text=f"Executed shortcut: {mod_str}{key} (keycodes: {keycodes})")]

    elif name == "reload_keyboard_config":
        result = await connection.send_command({"cmd": "reload_config"})

        if "error" in result:
            return [TextContent(type="text", text=f"Error: {result['error']}")]

        kb = result.get('keyboard', {})
        return [TextContent(type="text", text=f"Keyboard config reloaded: layout={kb.get('layout')}, remappings={kb.get('modifier_remappings', {})}")]

    else:
        return [TextContent(type="text", text=f"Unknown tool: {name}")]


async def main():
    """Run the MCP server."""
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


if __name__ == "__main__":
    asyncio.run(main())
