#!/usr/bin/env python3
"""Private A/B fixture service and product observer, run inside a claimed VM.

This does not emulate installation or restart. It supplies HTTPS release bytes
and uses the real authenticated desktop application connection. Native focus
and keyboard routing are asserted by the outside Machine Control runner.
"""
import argparse
import base64
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import socket
import ssl
import struct
import sys
import time
import urllib.parse

IDENTIFIER = "com.jstorrent.qualification.update"


def config_root():
    if os.environ.get("RSTORRENT_DESKTOP_DATA_ROOT"):
        return Path(os.environ["RSTORRENT_DESKTOP_DATA_ROOT"]) / "config"
    if sys.platform == "darwin":
        return Path.home() / "Library/Application Support" / IDENTIFIER
    if sys.platform == "win32":
        return Path(os.environ["APPDATA"]) / IDENTIFIER
    return Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / IDENTIFIER


def exact_read(stream, size):
    data = bytearray()
    while len(data) < size:
        chunk = stream.recv(size - len(data))
        if not chunk:
            raise EOFError("Application connection closed")
        data.extend(chunk)
    return bytes(data)


class Application:
    """Minimal bounded independent websocket client; no third-party package."""
    def __init__(self):
        path = config_root() / "native-host/desktop-control-v1.sock"
        if os.name == "nt":
            import ctypes
            from ctypes import wintypes
            kernel = ctypes.windll.kernel32
            advapi = ctypes.windll.advapi32
            kernel.GetCurrentProcess.restype = wintypes.HANDLE
            kernel.CloseHandle.argtypes = [wintypes.HANDLE]
            kernel.LocalFree.argtypes = [ctypes.c_void_p]
            advapi.OpenProcessToken.argtypes = [wintypes.HANDLE, wintypes.DWORD, ctypes.POINTER(wintypes.HANDLE)]
            advapi.GetTokenInformation.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD)]
            advapi.ConvertSidToStringSidW.argtypes = [ctypes.c_void_p, ctypes.POINTER(wintypes.LPWSTR)]
            token = wintypes.HANDLE()
            if not ctypes.windll.advapi32.OpenProcessToken(ctypes.windll.kernel32.GetCurrentProcess(), 8, ctypes.byref(token)):
                raise OSError("OpenProcessToken")
            try:
                size = wintypes.DWORD()
                ctypes.windll.advapi32.GetTokenInformation(token, 1, None, 0, ctypes.byref(size))
                buffer = ctypes.create_string_buffer(size.value)
                if not ctypes.windll.advapi32.GetTokenInformation(token, 1, buffer, size, ctypes.byref(size)):
                    raise OSError("GetTokenInformation")
                sid = ctypes.cast(buffer, ctypes.POINTER(ctypes.c_void_p))[0]
                text = wintypes.LPWSTR()
                if not ctypes.windll.advapi32.ConvertSidToStringSidW(sid, ctypes.byref(text)):
                    raise OSError("ConvertSidToStringSidW")
                try:
                    sid_text = text.value
                finally:
                    ctypes.windll.kernel32.LocalFree(text)
            finally:
                ctypes.windll.kernel32.CloseHandle(token)
            fingerprint = hashlib.sha256(sid_text.encode() + str(path).encode("utf-16-le")).hexdigest()
            with open(r"\\.\pipe\rstorrent-desktop-v1-" + fingerprint, "r+b", buffering=0) as pipe:
                size = struct.unpack("<I", pipe.read(4))[0]
                if size > 4096:
                    raise ValueError("Oversized bootstrap")
                data = bytearray()
                while len(data) < size:
                    chunk = pipe.read(size - len(data))
                    if not chunk: raise EOFError("Bootstrap closed")
                    data.extend(chunk)
                ready = json.loads(data)
                pipe.write(b"\x01")
        else:
            with socket.socket(socket.AF_UNIX) as bootstrap:
                bootstrap.settimeout(3)
                bootstrap.connect(str(path))
                size = struct.unpack("<I", exact_read(bootstrap, 4))[0]
                if size > 4096:
                    raise ValueError("Oversized bootstrap")
                ready = json.loads(exact_read(bootstrap, size))
        endpoint = urllib.parse.urlsplit(ready["endpoint"])
        if endpoint.hostname != "127.0.0.1":
            raise ValueError("Unexpected bootstrap endpoint")
        self.socket = socket.create_connection((endpoint.hostname, endpoint.port), timeout=3)
        self.socket.settimeout(5)
        nonce = base64.b64encode(os.urandom(16)).decode()
        self.socket.sendall((f"GET /api/v1/connect HTTP/1.1\r\nHost: {endpoint.netloc}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: {nonce}\r\nOrigin: chrome-extension://dbokmlpefliilbjldladbimlcfgbolhk\r\n\r\n").encode())
        header = bytearray()
        while not header.endswith(b"\r\n\r\n"):
            if len(header) > 8192:
                raise ValueError("Oversized handshake")
            header.extend(exact_read(self.socket, 1))
        if not header.startswith(b"HTTP/1.1 101"):
            raise ValueError("Websocket refused")
        self.send({"type": "connect", "api_version": 1, "encoding": "json", "client_instance_id": os.urandom(16).hex(), "token": ready["credential"]})
        hello = self.receive()
        if hello.get("type") != "connected":
            raise ValueError("Application hello refused")
        self.hello = hello["hello"]
        self.sequence = 0

    def send(self, value):
        data = json.dumps(value).encode()
        if len(data) > 65536:
            raise ValueError("Oversized call")
        mask = os.urandom(4)
        header = bytes([0x81, 0x80 | len(data)]) if len(data) < 126 else bytes([0x81, 0x80 | 126]) + struct.pack("!H", len(data))
        self.socket.sendall(header + mask + bytes(byte ^ mask[index % 4] for index, byte in enumerate(data)))

    def receive(self):
        while True:
            first, second = exact_read(self.socket, 2)
            size = second & 127
            if size == 126:
                size = struct.unpack("!H", exact_read(self.socket, 2))[0]
            elif size == 127:
                size = struct.unpack("!Q", exact_read(self.socket, 8))[0]
            if size > 2 * 1024 * 1024 or second & 128:
                raise ValueError("Invalid server frame")
            data = exact_read(self.socket, size)
            if first & 15 == 8:
                raise EOFError("Application closed")
            if first & 15 != 1:
                continue
            return json.loads(data)

    def call(self, operation):
        self.sequence += 1
        identifier = str(self.sequence)
        self.send({"type": "call", "call_id": identifier, "operation": operation})
        result = self.receive()
        if result.get("call_id") != identifier or result.get("type") != "result":
            raise ValueError("Application call failed: " + str(result))
        return result["result"]

    def update(self, action):
        return self.call({"type": "product_update", "request": action})["snapshot"]

    def close(self):
        self.socket.close()


def serve(args):
    root = args.root.resolve()
    fixture = json.loads((root / "fixture.json").read_text())
    newer = root / "100.0.2"
    payloads = [path for path in newer.iterdir() if path.name.endswith((".tar.gz", ".AppImage", "-setup.exe")) and (sys.platform == "darwin" or "_100.0.2_" in path.name)]
    if len(payloads) != 1:
        raise ValueError("Expected one signed target payload")
    payload = payloads[0]
    signature = payload.with_name(payload.name + ".sig").read_text().strip()
    expected = next(item for item in fixture["packages"][1]["files"] if item["name"] == payload.name)
    if hashlib.sha256(payload.read_bytes()).hexdigest() != expected["sha256"]:
        raise ValueError("Fixture payload receipt mismatch")

    class Feed(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_GET(self):
            path = urllib.parse.urlsplit(self.path).path
            fault = (root / "fault").read_text().strip() if (root / "fault").exists() else "none"
            if path == "/channels":
                result = {"schemaVersion": 1, "channels": [{"id": "stable"}, {"id": "latest"}]}
            elif path == "/version":
                result = {"version": "100.0.2"}
            elif path.startswith("/tauri/"):
                if fault in ("withdrawn", "offline") and (root / "payload-served").exists():
                    self.send_response(204 if fault == "withdrawn" else 503)
                    self.end_headers()
                    return
                if not (root / "offer").exists() or self.path.split("/")[-1].split("?")[0] == "100.0.2":
                    self.send_response(204)
                    self.end_headers()
                    return
                result = {"version": "100.0.2", "url": "https://localhost:18443/payload", "signature": base64.b64encode(b"invalid signature").decode() if fault == "bad-signature" else signature, "notes": "Synthetic unattended-update rehearsal", "channel": "stable", "pub_date": "2026-10-16T00:00:00Z"}
            elif path == "/payload":
                self.send_response(200)
                self.send_header("Content-Length", str(512 * 1024 * 1024 + 1 if fault == "oversized" else payload.stat().st_size))
                self.end_headers()
                if fault == "oversized": return
                with payload.open("rb") as stream:
                    if fault == "interrupted":
                        self.wfile.write(stream.read(4096))
                        self.wfile.flush()
                        self.close_connection = True
                        return
                    while chunk := stream.read(65536):
                        self.wfile.write(chunk)
                (root / "payload-served").touch()
                return
            else:
                self.send_error(404)
                return
            data = json.dumps(result).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("X-Update-Channel", "stable")
            self.end_headers()
            self.wfile.write(data)

    server = ThreadingHTTPServer(("127.0.0.1", 18443), Feed)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(root / "server.pem", root / "server.key")
    server.socket = context.wrap_socket(server.socket, server_side=True)
    (root / "feed-ready").write_text("ready")
    server.serve_forever()


def watch(args):
    root = args.root.resolve()
    deadline = time.monotonic() + args.timeout
    connection = None
    observations = []
    next_activity = 0
    try:
        while time.monotonic() < deadline:
            try:
                if connection is None:
                    connection = Application()
                    observations.append({"version": connection.hello.get("product", {}).get("version"), "kind": "connected", "at": time.monotonic()})
                    next_activity = 0
                    if (root / "transfers.json").exists():
                        from transfers_guest import Transfers
                        transfers = Transfers(root, connection)
                        if connection.hello.get("product", {}).get("version") == "100.0.1":
                            transfers.start()
                        else:
                            transfers.finish()
                if time.monotonic() >= next_activity:
                    connection.update({"action": "activity", "interacted": False, "blocked": False})
                    next_activity = time.monotonic() + 15
                if (root / "offer").exists() and not (root / "check-requested").exists():
                    connection.update({"action": "check"})
                    (root / "check-requested").write_text("sent")
                status = connection.update({"action": "status"})
                version = connection.hello.get("product", {}).get("version")
                record = {"kind": "status", "at": time.monotonic(), "version": version, "phase": status["phase"], "candidate": status["version"], "message": status["message"], "restartInSeconds": status["restartInSeconds"]}
                if not observations or {k: v for k, v in observations[-1].items() if k != "at"} != {k: v for k, v in record.items() if k != "at"}:
                    observations.append(record)
                if version == "100.0.2":
                    (root / "updated").write_text("100.0.2")
                    return
            except (OSError, ValueError, EOFError) as error:
                if connection:
                    connection.close()
                connection = None
                (root / "last-error").write_text(str(error)[:1024])
            finally:
                temporary = root / "observations.tmp"
                temporary.write_text(json.dumps(observations, indent=2))
                os.replace(temporary, root / "observations.json")
            time.sleep(.5)
        raise TimeoutError("Synthetic update did not complete")
    finally:
        if connection:
            connection.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["serve", "watch"])
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--timeout", type=int, default=1200)
    args = parser.parse_args()
    try:
        (serve if args.action == "serve" else watch)(args)
    except Exception as error:
        (args.root / (args.action + "-error")).write_text(str(error)[:2048])
        raise


if __name__ == "__main__":
    main()
