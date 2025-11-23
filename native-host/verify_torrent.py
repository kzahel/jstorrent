import sys
import json
import struct
import subprocess
import time
import os
import requests
import shutil
import base64

# Configuration
HOST_BINARY = "./target/debug/jstorrent-host"
STUB_BINARY = "./target/debug/jstorrent-link-handler"
CONFIG_DIR = os.path.expanduser("~/.config/jstorrent-native")
TEST_TORRENT_FILE = "test.torrent"

def setup():
    # Clean config dir
    if os.path.exists(CONFIG_DIR):
        shutil.rmtree(CONFIG_DIR)
    os.makedirs(CONFIG_DIR, exist_ok=True)
    
    # Create dummy torrent file
    with open(TEST_TORRENT_FILE, "wb") as f:
        f.write(b"d8:announce35:udp://tracker.openbittorrent.com:8013:creation datei1327049827e4:infod6:lengthi12345e4:name10:test.files12:piece lengthi262144e6:pieces20:01234567890123456789ee")

def cleanup():
    if os.path.exists(TEST_TORRENT_FILE):
        os.remove(TEST_TORRENT_FILE)

def read_message(proc):
    raw_length = proc.stdout.read(4)
    if not raw_length:
        return None
    msg_length = struct.unpack('=I', raw_length)[0]
    msg = proc.stdout.read(msg_length)
    return json.loads(msg)

def test_torrent_flow():
    print("Starting Host...")
    host_proc = subprocess.Popen(
        [HOST_BINARY],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=sys.stderr,
        bufsize=0
    )

    try:
        # Wait for host to initialize and write discovery file
        time.sleep(2)
        
        # Verify discovery file exists
        files = os.listdir(CONFIG_DIR)
        rpc_files = [f for f in files if f.startswith("rpc-info-")]
        if not rpc_files:
            print("FAIL: No discovery file found")
            return False
        
        print(f"Found discovery file: {rpc_files[0]}")
        
        with open(os.path.join(CONFIG_DIR, rpc_files[0]), 'r') as f:
            info = json.load(f)
            
        port = info['port']
        token = info['token']
        print(f"RPC Server running on port {port} with token {token}")
        
        # Test Health Check
        resp = requests.get(f"http://127.0.0.1:{port}/health?token={token}")
        if resp.status_code != 200:
            print(f"FAIL: Health check failed: {resp.status_code}")
            return False
        print("Health check passed")
        
        # Test Stub with .torrent file
        print(f"Running stub with torrent file: {TEST_TORRENT_FILE}")
        
        stub_proc = subprocess.run(
            [STUB_BINARY, TEST_TORRENT_FILE],
            capture_output=True,
            text=True
        )
        
        if stub_proc.returncode != 0:
            print(f"FAIL: Stub failed with code {stub_proc.returncode}")
            print("Stderr:", stub_proc.stderr)
            return False
            
        print("Stub executed successfully")
        
        # Verify Host received the event
        print("Waiting for event from host...")
        msg = read_message(host_proc)
        print("Received message:", msg)
        
        if msg and msg.get('event') == 'TorrentAdded':
            payload = msg.get('payload', {})
            if payload.get('name') == TEST_TORRENT_FILE:
                print("SUCCESS: Host received torrent file!")
                # Verify contents
                with open(TEST_TORRENT_FILE, "rb") as f:
                    expected_contents = base64.b64encode(f.read()).decode('utf-8')
                
                if payload.get('contentsBase64') == expected_contents:
                     print("SUCCESS: Contents match!")
                     return True
                else:
                     print("FAIL: Contents mismatch")
                     return False
            else:
                print(f"FAIL: Name mismatch. Expected {TEST_TORRENT_FILE}, got {payload.get('name')}")
                return False
        else:
            print("FAIL: Unexpected message or no message")
            return False

    finally:
        host_proc.terminate()
        host_proc.wait()

if __name__ == "__main__":
    setup()
    try:
        if test_torrent_flow():
            sys.exit(0)
        else:
            sys.exit(1)
    finally:
        cleanup()
