import requests
import time
import base64
import subprocess
import os
import sys
import atexit
import re
from .errors import (
    EngineNotRunning, EngineAlreadyRunning,
    TorrentNotFound, RPCError
)

class JSTEngine:
    def __init__(self, port=0, config=None, **kwargs):
        self.port = port
        self.rpc_port = None  # Will be set after server starts
        self.base = None  # Will be set after we know the port
        self.session = requests.Session()
        self.proc = None
        
        # Normalize config - translate Python-style keys to JS-style keys
        final_config = config.copy() if config else {}
        final_config.update(kwargs)
        
        # Translate download_dir to downloadPath
        if 'download_dir' in final_config:
            final_config['downloadPath'] = final_config.pop('download_dir')
        
        # Spawn the process
        self._spawn_process()
        
        # Wait for RPC server to be ready (this also discovers the port)
        self._wait_for_rpc()
        
        # Start the engine
        self.start_engine(final_config)
        
        # Ensure cleanup on exit
        atexit.register(self.close)

    def _spawn_process(self):
        # Determine paths
        # This file is in packages/engine/tests/python/jst/engine.py
        current_dir = os.path.dirname(os.path.abspath(__file__))
        # engine root is packages/engine
        engine_root = os.path.abspath(os.path.join(current_dir, "../../../"))
        rpc_script = os.path.join(engine_root, "src/cmd/run-rpc.ts")
        
        if not os.path.exists(rpc_script):
             raise RuntimeError(f"Could not find run-rpc.ts at {rpc_script}")

        cmd = ["pnpm", "exec", "tsx", rpc_script]
        
        env = os.environ.copy()
        env["PORT"] = str(self.port)

        # Capture stdout to parse the port, but also forward to our stdout
        self.proc = subprocess.Popen(
            cmd,
            cwd=engine_root,
            env=env,
            stdout=subprocess.PIPE,
            stderr=sys.stderr,
            text=True,
            bufsize=1  # Line buffered
        )

    def _wait_for_rpc(self, timeout=10):
        start = time.time()
        
        # First, read stdout to get the actual port
        while time.time() - start < timeout:
            if self.proc.poll() is not None:
                raise RuntimeError(f"RPC server process exited early with code {self.proc.returncode}")
            
            line = self.proc.stdout.readline()
            if line:
                print(line, end='')  # Forward to our stdout
                match = re.match(r'RPC_PORT=(\d+)', line)
                if match:
                    self.rpc_port = int(match.group(1))
                    self.base = f"http://localhost:{self.rpc_port}"
                    break
        
        if self.rpc_port is None:
            raise RuntimeError("Failed to discover RPC port from server output")
        
        # Now wait for the server to actually respond
        while time.time() - start < timeout:
            try:
                self._req("GET", "/engine/status")
                # Start a thread to forward remaining stdout
                import threading
                def forward_stdout():
                    for line in self.proc.stdout:
                        print(line, end='')
                threading.Thread(target=forward_stdout, daemon=True).start()
                return
            except (requests.exceptions.ConnectionError, RPCError):
                time.sleep(0.1)
        
        # If we get here, we timed out
        if self.proc.poll() is not None:
             raise RuntimeError(f"RPC server process exited early with code {self.proc.returncode}")
        raise RuntimeError("Timed out waiting for RPC server to start")

    def close(self):
        if self.proc:
            try:
                # Stop engine logic
                try:
                    self._req("POST", "/engine/stop")
                except:
                    pass
                
                # Shutdown server
                try:
                    self._req("POST", "/shutdown")
                except:
                    pass
                
                # Wait for process
                try:
                    self.proc.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    self.proc.kill()
            except:
                # Best effort cleanup
                pass
            finally:
                self.proc = None

    # -----------------------------
    # Helpers
    # -----------------------------
    def _req(self, method, path, **kwargs):
        url = f"{self.base}{path}"
        try:
            r = self.session.request(method, url, **kwargs)
        except requests.exceptions.ConnectionError:
             raise RPCError(f"Connection failed to {url}")

        try:
            data = r.json()
        except Exception:
            raise RPCError(f"Invalid JSON from RPC at {url}: {r.text}")

        if not data.get("ok", False):
            code = data.get("code", "RPCError")
            msg = data.get("error", "")
            if msg == "EngineNotRunning": 
                 raise EngineNotRunning(msg)
            if msg == "EngineAlreadyRunning":
                 raise EngineAlreadyRunning(msg)
            if msg == "TorrentNotFound":
                 raise TorrentNotFound(msg)
            
            if code == "EngineNotRunning":
                raise EngineNotRunning(msg)
            if code == "EngineAlreadyRunning":
                raise EngineAlreadyRunning(msg)
            if code == "TorrentNotFound":
                raise TorrentNotFound(msg)
                
            raise RPCError(f"{code}: {msg}")

        return data

    # -----------------------------
    # Engine lifecycle
    # -----------------------------
    def start_engine(self, config=None):
        # Renamed from start to start_engine to be explicit, 
        # but user might expect 'start' if mimicking previous API.
        # However, user said "JSTEngine(opts) ... rpc_client.POST('/engine/start', opts)"
        # So the engine is started in __init__.
        # But we might want to restart it?
        # Let's keep this as internal or explicit method.
        # User example: engine.start() was called in previous version.
        # New requirement: JSTEngine(opts) does it automatically.
        # But we might want to re-start if we stopped?
        # For now, __init__ calls this.
        self._req("POST", "/engine/start", json={"config": config or {}})

    def stop_engine(self):
        self._req("POST", "/engine/stop")

    def status(self):
        try:
            return self._req("GET", "/engine/status")
        except RPCError:
             return {"ok": True, "running": False}

    # -----------------------------
    # Torrent management
    # -----------------------------
    def add_torrent_file(self, path, storage_key="default"):
        with open(path, "rb") as f:
            file_content = f.read()
            data_b64 = base64.b64encode(file_content).decode('utf-8')
        
        res = self._req("POST", "/torrent/add", json={
            "type": "file",
            "data": data_b64,
            "storagePath": storage_key 
        })
        return res["id"]

    def add_magnet(self, magnet, storage_key="default"):
        res = self._req("POST", "/torrent/add", json={
            "type": "magnet",
            "data": magnet,
            "storagePath": storage_key
        })
        return res["id"]

    def get_torrent_status(self, tid):
        return self._req("GET", f"/torrent/{tid}/status")

    def pause(self, tid):
        self._req("POST", f"/torrent/{tid}/pause")

    def resume(self, tid):
        self._req("POST", f"/torrent/{tid}/resume")

    def remove(self, tid):
        self._req("POST", f"/torrent/{tid}/remove")

    def add_peer(self, tid, ip, port):
        """Connect to a specific peer by IP and port."""
        self._req("POST", f"/torrent/{tid}/add-peer", json={"ip": ip, "port": port})

    def recheck(self, tid):
        """Trigger piece recheck for a torrent."""
        self._req("POST", f"/torrent/{tid}/recheck")

    # -----------------------------
    # Test helpers
    # -----------------------------
    def wait_for_download(self, tid, timeout=300, poll=0.2):
        start = time.time()
        while True:
            st = self.get_torrent_status(tid)
            if st["progress"] >= 1.0:
                return True
            if time.time() - start > timeout:
                raise TimeoutError("Download did not complete in time.")
            time.sleep(poll)

    def wait_for_state(self, tid, state, timeout=60, poll=0.2):
        start = time.time()
        while True:
            st = self.get_torrent_status(tid)
            if st["state"] == state:
                return True
            if time.time() - start > timeout:
                raise TimeoutError(
                    f"Torrent {tid} did not reach state '{state}' in time."
                )
            time.sleep(poll)
