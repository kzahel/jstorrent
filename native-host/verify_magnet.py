import sys
import json
import struct
import subprocess
import time
import os
import requests
import shutil
import tempfile

# Configuration
HOST_BINARY = "./target/debug/jstorrent-host"
STUB_BINARY = "./target/debug/jstorrent-link-handler"
# CONFIG_DIR will be set dynamically

def read_message(proc):
    raw_length = proc.stdout.read(4)
    if not raw_length:
        return None
    msg_length = struct.unpack('=I', raw_length)[0]
    msg = proc.stdout.read(msg_length)
    return json.loads(msg)

def send_message(proc, msg):
    msg_json = json.dumps(msg)
    msg_bytes = msg_json.encode('utf-8')
    header = struct.pack('=I', len(msg_bytes))
    proc.stdin.write(header + msg_bytes)
    proc.stdin.flush()

def test_magnet_flow(config_dir):
    print("Building binaries...")
    subprocess.check_call(["cargo", "build", "--workspace"])

    print("Starting Host...")
    host_proc = subprocess.Popen(
        [HOST_BINARY],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=sys.stderr,
        bufsize=0,
        env=os.environ
    )

    try:
        # Wait for host to initialize and write discovery file
        time.sleep(2)
        
        # Verify discovery file exists
        rpc_file = os.path.join(config_dir, "rpc-info.json")
        if not os.path.exists(rpc_file):
            print("FAIL: No discovery file found")
            return False
        
        print(f"Found discovery file: {rpc_file}")
        
        with open(rpc_file, 'r') as f:
            info = json.load(f)
            
        if not info.get('profiles'):
            print("FAIL: No profiles in discovery file")
            return False
            
        # Use the first profile
        profile = info['profiles'][0]
            
        port = profile['port']
        token = profile['token']
        print(f"RPC Server running on port {port} with token {token}")
        
        # Test Health Check
        resp = requests.get(f"http://127.0.0.1:{port}/health?token={token}")
        if resp.status_code != 200:
            print(f"FAIL: Health check failed: {resp.status_code}")
            return False
        print("Health check passed")
        
        # Test Stub
        magnet_link = "magnet:?xt=urn:btih:1234567890abcdef1234567890abcdef12345678&dn=Test"
        print(f"Running stub with magnet link: {magnet_link}")
        
        stub_proc = subprocess.run(
            [STUB_BINARY, magnet_link],
            capture_output=True,
            text=True,
            env=os.environ
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
        
        if msg and msg.get('event') == 'MagnetAdded':
            payload = msg.get('payload', {})
            if payload.get('link') == magnet_link:
                print("SUCCESS: Host received magnet link!")
                return True
            else:
                print(f"FAIL: Link mismatch. Expected {magnet_link}, got {payload.get('link')}")
                return False
        else:
            print("FAIL: Unexpected message or no message")
            return False

    finally:
        host_proc.terminate()
        host_proc.wait()

if __name__ == "__main__":
    with tempfile.TemporaryDirectory() as temp_dir:
        print(f"Using temp config dir: {temp_dir}")
        os.environ["JSTORRENT_CONFIG_DIR"] = temp_dir
        config_dir = os.path.join(temp_dir, "jstorrent-native")
        
        if test_magnet_flow(config_dir):
            sys.exit(0)
        else:
            sys.exit(1)
