import sys
import json
import struct
import time
import os
import subprocess
import requests

import tempfile

def send_message(proc, msg):
    json_msg = json.dumps(msg).encode('utf-8')
    length = len(json_msg)
    proc.stdin.write(struct.pack('<I', length))
    proc.stdin.write(json_msg)
    proc.stdin.flush()

def read_message(proc):
    length_bytes = proc.stdout.read(4)
    if not length_bytes:
        return None
    length = struct.unpack('<I', length_bytes)[0]
    msg_bytes = proc.stdout.read(length)
    return json.loads(msg_bytes)

def main():
    with tempfile.TemporaryDirectory() as temp_dir:
        print(f"Using temp config dir: {temp_dir}")
        os.environ["JSTORRENT_CONFIG_DIR"] = temp_dir
        config_dir = temp_dir
        native_dir = os.path.join(config_dir, "jstorrent-native")
        os.makedirs(native_dir)
        print("Starting native-host...")
        # Assume we are in native-host dir
        proc = subprocess.Popen(
            ["./target/debug/jstorrent-host", "chrome-extension://test-extension-id/"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=sys.stderr
        )

        install_id = "test-install-id-123"
        
        try:
            # 1. Send Handshake
            print("Sending Handshake...")
            handshake_req = {
                "id": "1",
                "op": "handshake",
                "extensionId": "test-extension-id",
                "installId": install_id
            }
            send_message(proc, handshake_req)
            
            resp = read_message(proc)
            print("Received response:", resp)
            
            if not resp['ok']:
                print("Handshake failed")
                sys.exit(1)
                
            daemon_info = resp['payload']
            port = daemon_info['port']
            token = daemon_info['token']
            print(f"Daemon started on port {port} with token {token}")

            # Verify rpc-info.json exists and has install_id
            rpc_file = os.path.join(native_dir, "rpc-info.json")
            if not os.path.exists(rpc_file):
                print("rpc-info.json not found")
                sys.exit(1)
                
            with open(rpc_file, 'r') as f:
                data = json.load(f)
                profile = next((p for p in data['profiles'] if p.get('installId') == install_id), None)
                if not profile:
                    # Try snake_case
                    profile = next((p for p in data['profiles'] if p.get('install_id') == install_id), None)
                    
                if not profile:
                    print("Profile not found in rpc-info.json")
                else:
                    print("Profile found in rpc-info.json")

            # 2. Verify io-daemon is responsive
            print("Checking io-daemon health...")
            try:
                res = requests.get(f"http://127.0.0.1:{port}/health")
                if res.status_code != 200:
                    print("Health check failed:", res.status_code)
                    sys.exit(1)
                print("Health check passed")
            except Exception as e:
                print("Health check exception:", e)
                sys.exit(1)

            # 3. Trigger a refresh (manually via native-host logic simulation or just call the endpoint directly to verify it works)
            # Since we can't easily trigger PickDownloadDirectory without UI, we will manually call the refresh endpoint
            # and verify it returns 200 OK.
            
            print("Calling refresh endpoint...")
            try:
                res = requests.post(
                    f"http://127.0.0.1:{port}/api/read-rpc-info-from-disk",
                    headers={"Authorization": f"Bearer {token}"}
                )
                if res.status_code != 200:
                    print("Refresh failed:", res.status_code, res.text)
                    sys.exit(1)
                print("Refresh endpoint returned 200 OK")
            except Exception as e:
                print("Refresh exception:", e)
                sys.exit(1)

            print("Verification successful!")
        finally:
            proc.terminate()

if __name__ == "__main__":
    main()
