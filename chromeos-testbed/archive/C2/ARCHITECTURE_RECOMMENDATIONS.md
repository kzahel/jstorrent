# C2 Architecture Improvement Recommendations

## Current Architecture

```
┌─────────────────┐     SSH      ┌─────────────────┐   shared    ┌─────────────────┐
│  Remote Machine │─────────────►│    Crostini     │────files───►│   VT2 (root)    │
│  (controller)   │              │  (Linux VM)     │   .c2/cmd   │   client.sh     │
│                 │◄─────────────│                 │◄────────────│                 │
│                 │  scp files   │                 │   .c2/out   │                 │
└─────────────────┘              └─────────────────┘             └─────────────────┘
```

**Pain points:**
- File-based polling adds ~100ms+ latency per command
- Screenshots require scp copy through Crostini
- Indirect path: remote → Crostini → shared folder → VT2
- Debugging is difficult (can't see real-time output)
- Bash client is fragile (hangs, no error handling)

## Proposed Architecture: Direct HTTP Connection

```
┌─────────────────┐                              ┌─────────────────┐
│  Remote Machine │◄────── HTTP/WebSocket ──────►│   VT2 (root)    │
│  (controller)   │         (reverse conn)       │   client.py     │
│                 │                              │                 │
│  - Command API  │                              │  - Input inject │
│  - Screenshot   │                              │  - Screenshot   │
│    receiver     │                              │    capture      │
└─────────────────┘                              └─────────────────┘
```

### Option A: VT2 Client Connects Out (Recommended)

The VT2 Python client initiates an outbound connection to a server on the remote machine. This is the "reverse shell" pattern and works well because:

1. **No inbound firewall issues** - VT2 connects out, not in
2. **Works behind NAT** - Chromebook can be anywhere
3. **Simple setup** - Just need the remote server's address

**Server (remote machine):**
```python
# Listens for VT2 client, sends commands, receives results
@app.websocket("/c2")
async def c2_endpoint(websocket):
    await manager.connect(websocket)
    while True:
        cmd = await command_queue.get()
        await websocket.send_json({"type": "command", "cmd": cmd})
        result = await websocket.receive_json()
        # Process result (screenshot bytes, command output, etc.)
```

**Client (VT2):**
```python
# Connects to server, executes commands, sends results
async def main():
    async with websockets.connect(f"ws://{SERVER}:{PORT}/c2") as ws:
        while True:
            msg = await ws.recv()
            cmd = json.loads(msg)
            if cmd["type"] == "command":
                result = execute(cmd["cmd"])
                await ws.send(json.dumps(result))
            elif cmd["type"] == "screenshot":
                img_bytes = take_screenshot()
                await ws.send(img_bytes)
```

### Option B: HTTP Long Polling

Simpler than WebSockets but higher latency:

```python
# Client polls server for commands
while True:
    resp = requests.get(f"{SERVER}/poll", timeout=30)
    if resp.json().get("cmd"):
        result = execute(resp.json()["cmd"])
        requests.post(f"{SERVER}/result", json=result)
```

### Option C: Keep Crostini, Add Direct Screenshot Path

Hybrid approach - keep file-based commands but add direct screenshot streaming:

```
Commands:  Remote → SSH → Crostini → .c2/cmd → VT2
Screenshots: Remote ← WebSocket ← VT2 (direct)
```

This is simpler to implement but still has command latency.

## Recommended Implementation

### Phase 1: Python VT2 Client

Rewrite `client.sh` as `client.py` with:

```python
#!/usr/bin/env python3
"""
VT2 C2 Client - Connects to remote server for commands.
Run on ChromeOS VT2 as root.
"""

import asyncio
import websockets
import json
import subprocess
import os
from input import Touchscreen, Keyboard, Mouse, take_screenshot_direct

SERVER = os.environ.get("C2_SERVER", "192.168.1.100:8080")

class C2Client:
    def __init__(self, server_url):
        self.server_url = server_url
        self.touchscreen = None
        self.keyboard = None

    async def connect(self):
        while True:
            try:
                async with websockets.connect(f"ws://{self.server_url}/c2") as ws:
                    print(f"[c2] Connected to {self.server_url}")
                    await self.handle_connection(ws)
            except Exception as e:
                print(f"[c2] Connection failed: {e}, retrying in 5s...")
                await asyncio.sleep(5)

    async def handle_connection(self, ws):
        while True:
            msg = json.loads(await ws.recv())
            result = await self.handle_message(msg)
            await ws.send(json.dumps(result))

    async def handle_message(self, msg):
        cmd_type = msg.get("type")

        if cmd_type == "shell":
            # Execute shell command
            try:
                proc = await asyncio.create_subprocess_shell(
                    msg["cmd"],
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=30)
                return {
                    "type": "shell_result",
                    "stdout": stdout.decode(),
                    "stderr": stderr.decode(),
                    "exit_code": proc.returncode
                }
            except asyncio.TimeoutError:
                return {"type": "error", "error": "Command timed out"}

        elif cmd_type == "tap":
            if not self.touchscreen:
                self.touchscreen = Touchscreen()
            self.touchscreen.tap(msg["x"], msg["y"])
            return {"type": "ok"}

        elif cmd_type == "screenshot":
            # Direct screenshot capture (see below)
            img_data = await self.capture_screenshot()
            return {"type": "screenshot", "data": img_data}  # base64 encoded

        elif cmd_type == "type":
            if not self.keyboard:
                self.keyboard = Keyboard()
            self.keyboard.type_text(msg["text"])
            return {"type": "ok"}

        return {"type": "error", "error": f"Unknown command: {cmd_type}"}

if __name__ == "__main__":
    client = C2Client(SERVER)
    asyncio.run(client.connect())
```

### Phase 2: Direct Screenshot Capture

Instead of pressing Search+F5 and copying files, capture directly:

**Option 2a: Framebuffer capture**
```python
def capture_framebuffer():
    """Read directly from /dev/fb0 or /dev/dri/card0"""
    # Requires DRM/KMS access - may need specific ChromeOS permissions
    pass
```

**Option 2b: Use `screenshot` command if available**
```python
def capture_screenshot():
    """Use ChromeOS screenshot tool if available"""
    subprocess.run(["screenshot", "/tmp/screen.png"], check=True)
    with open("/tmp/screen.png", "rb") as f:
        return base64.b64encode(f.read()).decode()
```

**Option 2c: Keep Search+F5 but watch for file**
```python
async def capture_screenshot(self):
    """Press Search+F5, wait for screenshot file, return contents"""
    # Get existing screenshots
    before = set(glob.glob("/home/chronos/user/MyFiles/Downloads/Screenshot*.png"))

    # Trigger screenshot
    keyboard = Keyboard()
    keyboard.press_keys([125, 63])  # Search+F5

    # Wait for new file (with timeout)
    for _ in range(50):  # 5 seconds
        await asyncio.sleep(0.1)
        after = set(glob.glob("/home/chronos/user/MyFiles/Downloads/Screenshot*.png"))
        new_files = after - before
        if new_files:
            screenshot_path = max(new_files, key=os.path.getctime)
            with open(screenshot_path, "rb") as f:
                return base64.b64encode(f.read()).decode()

    raise TimeoutError("Screenshot not captured")
```

### Phase 3: Server Implementation

Simple FastAPI server for the remote machine:

```python
# server.py - Run on remote machine
from fastapi import FastAPI, WebSocket
from fastapi.staticfiles import StaticFiles
import asyncio
import json

app = FastAPI()
clients = {}
command_queues = {}

@app.websocket("/c2")
async def c2_websocket(websocket: WebSocket):
    await websocket.accept()
    client_id = id(websocket)
    clients[client_id] = websocket
    command_queues[client_id] = asyncio.Queue()

    try:
        # Send pending commands, receive results
        while True:
            # Wait for either a command to send or a message from client
            recv_task = asyncio.create_task(websocket.receive_json())
            cmd_task = asyncio.create_task(command_queues[client_id].get())

            done, pending = await asyncio.wait(
                [recv_task, cmd_task],
                return_when=asyncio.FIRST_COMPLETED
            )

            for task in pending:
                task.cancel()

            for task in done:
                result = task.result()
                if task == recv_task:
                    # Got result from client
                    print(f"Result: {result}")
                else:
                    # Got command to send
                    await websocket.send_json(result)
    finally:
        del clients[client_id]
        del command_queues[client_id]

@app.post("/command/{client_id}")
async def send_command(client_id: int, cmd: dict):
    """API to queue a command for a client"""
    if client_id in command_queues:
        await command_queues[client_id].put(cmd)
        return {"status": "queued"}
    return {"error": "Client not connected"}

@app.get("/clients")
async def list_clients():
    """List connected clients"""
    return {"clients": list(clients.keys())}
```

## Network Considerations

### How VT2 Reaches Remote Machine

VT2 runs on the ChromeOS host, which has direct network access. Options:

1. **Direct IP** (if on same network): `C2_SERVER=192.168.1.100:8080`
2. **Tailscale/ZeroTier**: VPN mesh - works across NATs
3. **Reverse SSH tunnel**: `ssh -R 8080:localhost:8080 chromeos` (from remote)
4. **ngrok/cloudflared**: Public tunnel (security considerations)

### Recommended: Tailscale

```bash
# On Chromebook (in crosh shell or VT2)
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up

# On remote machine
tailscale up

# Now use Tailscale IP
C2_SERVER=100.x.y.z:8080 python3 client.py
```

## Migration Path

1. **Week 1**: Implement Python VT2 client with WebSocket connection
2. **Week 2**: Implement server with basic command/result handling
3. **Week 3**: Add direct screenshot streaming
4. **Week 4**: Add web UI for interactive control

## File Changes Summary

| Current | Proposed | Purpose |
|---------|----------|---------|
| client.sh | client.py | VT2 command executor |
| (none) | server.py | Remote command server |
| input.py | input.py | Keep, import from client.py |
| (none) | web_ui/ | Optional: browser-based control |

## Security Considerations

- **Authentication**: Add shared secret or TLS client certs
- **Encryption**: Use WSS (WebSocket Secure) in production
- **Command validation**: Whitelist allowed commands or use structured commands only
- **Rate limiting**: Prevent command flooding

## Quick Win: Hybrid Approach

If full rewrite is too much, a simpler improvement:

1. Keep file-based commands for now
2. Add a small Python watcher that streams screenshots directly:

```python
# screenshot_streamer.py - runs alongside client.sh
import asyncio
import websockets
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

class ScreenshotHandler(FileSystemEventHandler):
    def __init__(self, ws_queue):
        self.ws_queue = ws_queue

    def on_created(self, event):
        if "Screenshot" in event.src_path and event.src_path.endswith(".png"):
            asyncio.run(self.ws_queue.put(event.src_path))

# Stream new screenshots to remote server as they appear
```

This gives you real-time screenshots without rewriting the command infrastructure.
