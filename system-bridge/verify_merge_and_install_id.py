import os
import sys
import json
import time
import shutil
import tempfile
import subprocess
import struct

def send_message(proc, message):
    json_msg = json.dumps(message)
    # Write length (4 bytes, little endian)
    proc.stdin.write(struct.pack('<I', len(json_msg)))
    # Write message
    proc.stdin.write(json_msg.encode('utf-8'))
    proc.stdin.flush()

def read_message(proc):
    # Read length
    len_bytes = proc.stdout.read(4)
    if not len_bytes:
        return None
    msg_len = struct.unpack('<I', len_bytes)[0]
    # Read message
    msg_bytes = proc.stdout.read(msg_len)
    return json.loads(msg_bytes.decode('utf-8'))

def verify():
    # Create temp config dir
    with tempfile.TemporaryDirectory() as temp_dir:
        print(f"Using temp config dir: {temp_dir}")
        
        # Set env var
        env = os.environ.copy()
        env["JSTORRENT_CONFIG_DIR"] = temp_dir
        
        # Path to rpc-info.json
        rpc_file = os.path.join(temp_dir, "jstorrent-native", "rpc-info.json")
        
        # Build binaries
        print("Building binaries...")
        subprocess.check_call(["cargo", "build", "--workspace"])

        # Start native host
        host_bin = "./target/debug/jstorrent-host"
        if not os.path.exists(host_bin):
            print("Error: jstorrent-host binary not found. Please build first.")
            sys.exit(1)
            
        print("Starting native host...")
        proc = subprocess.Popen(
            [host_bin, "chrome-extension://test-extension-id/"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=sys.stderr,
            env=env
        )
        
        try:
            # Wait for rpc-info.json to be created
            print("Waiting for rpc-info.json...")
            for _ in range(50):
                if os.path.exists(rpc_file):
                    break
                time.sleep(0.1)
            
            if not os.path.exists(rpc_file):
                print("Error: rpc-info.json not created.")
                sys.exit(1)
                
            # Verify initial state
            with open(rpc_file, 'r') as f:
                info = json.load(f)
            
            print("Initial RPC Info:", json.dumps(info, indent=2))
            
            if len(info['profiles']) != 1:
                print(f"Error: Expected 1 profile, found {len(info['profiles'])}")
                sys.exit(1)
                
            profile = info['profiles'][0]
            if profile.get('install_id') is not None:
                print("Error: Initial install_id should be None")
                sys.exit(1)
                
            if 'profile_dir' in profile:
                print("Error: profile_dir should not be present")
                sys.exit(1)
                
            if 'profile_id' in profile.get('browser', {}):
                print("Error: browser.profile_id should not be present")
                sys.exit(1)

            # Send Handshake
            print("Sending Handshake...")
            handshake = {
                "id": "1",
                "op": "handshake",
                "extensionId": "test-extension-id",
                "installId": "test-install-id-123"
            }
            send_message(proc, handshake)
            
            # Read response
            resp = read_message(proc)
            print("Handshake Response:", resp)
            
            if not resp:
                print("Error: No response")
                sys.exit(1)
                
            if not resp.get('ok'):
                if resp.get('error') == "Daemon not running":
                    print("Warning: Daemon not running, but checking if rpc-info was updated...")
                else:
                    print(f"Error: Handshake failed: {resp.get('error')}")
                    sys.exit(1)
                
            # Verify updated state
            # Give it a moment to write
            time.sleep(0.5)
            
            with open(rpc_file, 'r') as f:
                info = json.load(f)
                
            print("Updated RPC Info:", json.dumps(info, indent=2))
            
            if len(info['profiles']) != 1:
                print(f"Error: Expected 1 profile after merge, found {len(info['profiles'])}")
                sys.exit(1)
                
            profile = info['profiles'][0]
            if profile.get('install_id') != "test-install-id-123":
                print(f"Error: install_id mismatch. Expected 'test-install-id-123', got {profile.get('install_id')}")
                sys.exit(1)
                
            print("SUCCESS: Merge logic and install_id verification passed!")
            
        finally:
            proc.terminate()
            proc.wait()

if __name__ == "__main__":
    verify()
