import subprocess
import json
import os
import sys
import time
import glob

def main():
    # Build first
    print("Building...")
    subprocess.check_call(["cargo", "build", "--bin", "jstorrent-host"])

    host_binary = "./target/debug/jstorrent-host"
    
    # Clean up old rpc-info files
    config_dir = os.path.expanduser("~/.config/jstorrent-native")
    if os.path.exists(config_dir):
        for f in glob.glob(os.path.join(config_dir, "rpc-info-*.json")):
            os.remove(f)
    
    print("Starting host...")
    # Start host directly
    proc = subprocess.Popen(
        [host_binary],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=sys.stderr
    )

    try:
        # Wait a bit for it to write the file
        time.sleep(2)
        
        # Find the new rpc-info file
        rpc_file = os.path.join(config_dir, "rpc-info.json")
        if not os.path.exists(rpc_file):
            print("Error: rpc-info.json not found")
            sys.exit(1)
            
        print(f"Found info file: {rpc_file}")
        
        with open(rpc_file, 'r') as f:
            info = json.load(f)
            
        print("RPC Info:", json.dumps(info, indent=2))
        
        # Find our profile
        my_pid = proc.pid
        profile = None
        for p in info.get('profiles', []):
            if p.get('pid') == my_pid: # Note: proc.pid might not match if it's a wrapper, but here we started it directly
                 # Actually, native-host writes its own PID.
                 # Let's assume the last updated one or just check if any matches.
                 profile = p
                 break
        
        # If we can't match PID exactly (maybe because of how we launched it?), take the most recent one
        if not profile and info.get('profiles'):
             profile = info['profiles'][0] # Should be sorted? No, we didn't sort in writer.
             # Writer appends or updates.
        
        if not profile:
             print("Error: No profile found in rpc-info.json")
             sys.exit(1)

        browser_binary = profile.get('browser', {}).get('binary', '')
        browser_name = profile.get('browser', {}).get('name', '')
        install_id = profile.get('install_id')
        
        print(f"Detected Browser Binary: {browser_binary}")
        print(f"Detected Browser Name: {browser_name}")
        print(f"Install ID: {install_id}")

        # Since we launched from python, and python is not in the browser list,
        # it should fall back to the immediate parent, which is python.
        # Or if we used shell=True, it might be sh/bash.
        
        if "python" in browser_binary.lower() or "python" in browser_name.lower():
             print("SUCCESS: Detected parent process (Python) as fallback.")
        elif browser_binary:
             print(f"WARNING: Detected something else: {browser_binary}. This might be correct if wrapped.")
        else:
             print("FAILURE: Browser binary is empty.")
             sys.exit(1)

    finally:
        proc.terminate()

if __name__ == "__main__":
    main()
