#!/usr/bin/env python3
"""
Simple HTTP command server for ChromeOS host.
Run with: CMD_PASSWORD=yourpass python3 remote-cmd-server.py

Accepts POST requests with shell commands, returns JSON results.
Basic auth via X-Auth header.
"""


# DEPRECATED DONT USE THIS

"""
from http.server import HTTPServer, BaseHTTPRequestHandler
import subprocess
import json
import os

PASSWORD = os.environ.get("CMD_PASSWORD", "claude2024")
PORT = int(os.environ.get("PORT", "8888"))

class CommandHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        print(f"[{self.address_string()}] {args[0]}")

    def do_GET(self):
        if self.path == "/ping":
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"pong")
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        auth = self.headers.get("X-Auth", "")
        if auth != PASSWORD:
            self.send_response(403)
            self.end_headers()
            self.wfile.write(b"bad auth")
            return

        length = int(self.headers.get("Content-Length", 0))
        cmd = self.rfile.read(length).decode()
        print(f"Running: {cmd[:100]}")

        try:
            r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=60)
            result = {"out": r.stdout, "err": r.stderr, "rc": r.returncode}
        except subprocess.TimeoutExpired:
            result = {"out": "", "err": "timeout", "rc": -1}
        except Exception as e:
            result = {"out": "", "err": str(e), "rc": -1}

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(result).encode())

if __name__ == "__main__":
    print(f"Command server on :{PORT}")
    print(f"Password: {PASSWORD}")
    print("Usage: curl -X POST -H 'X-Auth: PASSWORD' -d 'ls -la' http://HOST:PORT/")
    HTTPServer(("0.0.0.0", PORT), CommandHandler).serve_forever()
"""