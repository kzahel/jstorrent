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
        files = glob.glob(os.path.join(config_dir, "rpc-info-*.json"))
        if not files:
            print("Error: No rpc-info file found")
            sys.exit(1)
            
        latest_file = max(files, key=os.path.getctime)
        print(f"Found info file: {latest_file}")
        
        with open(latest_file, 'r') as f:
            info = json.load(f)
            
        print("RPC Info:", json.dumps(info, indent=2))
        
        browser_binary = info.get('browser', {}).get('binary', '')
        browser_name = info.get('browser', {}).get('name', '')
        
        print(f"Detected Browser Binary: {browser_binary}")
        print(f"Detected Browser Name: {browser_name}")

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
