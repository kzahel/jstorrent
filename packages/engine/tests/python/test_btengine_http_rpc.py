import subprocess
import time
import requests
import os
import sys
import signal
import json

def run_test():
    # Determine paths
    script_dir = os.path.dirname(os.path.abspath(__file__))
    engine_root = os.path.abspath(os.path.join(script_dir, "../../"))
    rpc_script = os.path.join(engine_root, "src/cmd/run-rpc.ts")
    
    print(f"Engine root: {engine_root}")
    print(f"RPC script: {rpc_script}")

    # Port for the RPC server
    port = 3002
    base_url = f"http://localhost:{port}"

    # Start the RPC server
    print("Starting RPC server...")
    # We use pnpm exec tsx to run the typescript file directly
    # We run from engine_root so that imports work and pnpm context is correct
    cmd = ["pnpm", "exec", "tsx", "src/cmd/run-rpc.ts"]
    
    env = os.environ.copy()
    env["PORT"] = str(port)

    proc = subprocess.Popen(
        cmd,
        cwd=engine_root,
        env=env,
        stdout=sys.stdout,
        stderr=sys.stderr
    )

    try:
        # Wait for server to come up
        print("Waiting for server to start...")
        connected = False
        for _ in range(20): # Try for 10 seconds
            try:
                requests.get(f"{base_url}/engine/status")
                connected = True
                break
            except requests.exceptions.ConnectionError:
                time.sleep(0.5)
        
        if not connected:
            raise RuntimeError("Could not connect to RPC server")

        print("Server started.")

        # Test GET /engine/status (should be not running)
        print("Testing GET /engine/status...")
        resp = requests.get(f"{base_url}/engine/status")
        resp.raise_for_status()
        data = resp.json()
        print(f"Status: {data}")
        if data.get("running") is not False:
            raise AssertionError("Expected running: false")

        # Test POST /engine/start
        print("Testing POST /engine/start...")
        resp = requests.post(f"{base_url}/engine/start", json={"config": {}})
        resp.raise_for_status()
        data = resp.json()
        print(f"Start: {data}")
        if not data.get("ok"):
            raise AssertionError("Failed to start engine")

        # Test GET /engine/status (should be running)
        print("Testing GET /engine/status...")
        resp = requests.get(f"{base_url}/engine/status")
        resp.raise_for_status()
        data = resp.json()
        print(f"Status: {data}")
        if data.get("running") is not True:
            raise AssertionError("Expected running: true")

        # Test POST /torrent/add (magnet)
        print("Testing POST /torrent/add...")
        magnet = 'magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&dn=Sintel&tr=udp%3A%2F%2Ftracker.leechers-paradise.org%3A6969&tr=udp%3A%2F%2Ftracker.coppersurfer.tk%3A6969&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&tr=udp%3A%2F%2Fexplodie.org%3A6969&tr=udp%3A%2F%2Ftracker.empire-js.us%3A1337'
        resp = requests.post(f"{base_url}/torrent/add", json={"type": "magnet", "data": magnet})
        resp.raise_for_status()
        data = resp.json()
        print(f"Add Torrent: {data}")
        if not data.get("ok"):
            raise AssertionError("Failed to add torrent")
        
        torrent_id = data.get("id")
        if not torrent_id:
            raise AssertionError("No torrent ID returned")

        # Test GET /torrent/:id/status
        print(f"Testing GET /torrent/{torrent_id}/status...")
        resp = requests.get(f"{base_url}/torrent/{torrent_id}/status")
        resp.raise_for_status()
        data = resp.json()
        print(f"Torrent Status: {data}")
        if data.get("id") != torrent_id:
            raise AssertionError("Torrent ID mismatch")

        # Test POST /engine/stop
        print("Testing POST /engine/stop...")
        resp = requests.post(f"{base_url}/engine/stop")
        resp.raise_for_status()
        data = resp.json()
        print(f"Stop: {data}")
        if not data.get("ok"):
            raise AssertionError("Failed to stop engine")

        # Test GET /engine/status (should be not running)
        print("Testing GET /engine/status...")
        resp = requests.get(f"{base_url}/engine/status")
        resp.raise_for_status()
        data = resp.json()
        print(f"Status: {data}")
        if data.get("running") is not False:
            raise AssertionError("Expected running: false")

        print("All tests passed!")

    except Exception as e:
        print(f"Test failed: {e}")
        sys.exit(1)
    finally:
        print("Shutting down server...")
        try:
            requests.post(f"{base_url}/shutdown")
        except:
            pass
        
        # Ensure process is dead
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=2)
            except subprocess.TimeoutExpired:
                proc.kill()

if __name__ == "__main__":
    run_test()
