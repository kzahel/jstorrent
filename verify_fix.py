import subprocess
import json
import os
import sys
import time
import glob
import shutil

def main():
    # Build host
    print("Building host...")
    subprocess.check_call(["cargo", "build", "--bin", "jstorrent-host"], cwd="native-host")
    host_binary = os.path.abspath("native-host/target/debug/jstorrent-host")

    # Create a wrapper script that mimics a "bad" parent
    # We'll call it "jstorrent-native-host-wrapper" to see if it gets picked up
    wrapper_path = os.path.abspath("jstorrent-native-host-wrapper.sh")
    with open(wrapper_path, "w") as f:
        f.write(f"#!/bin/sh\n{host_binary} \"$@\"\n")
    os.chmod(wrapper_path, 0o755)

    # Clean up old rpc-info
    config_dir = os.path.expanduser("~/.config/jstorrent-native")
    if os.path.exists(config_dir):
        for f in glob.glob(os.path.join(config_dir, "rpc-info-*.json")):
            os.remove(f)

    print("Launching host via wrapper...")
    # We launch the wrapper. The process tree will be:
    # python (this script) -> sh (wrapper) -> jstorrent-host
    #
    # Current behavior (bug): It might pick up "sh" or "jstorrent-native-host-wrapper.sh" as the browser because it's the immediate parent and not a "known browser".
    # Desired behavior: It should ignore the wrapper and find python (or at least not the wrapper).
    
    proc = subprocess.Popen(
        [wrapper_path],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=sys.stderr
    )

    try:
        time.sleep(2)
        
        files = glob.glob(os.path.join(config_dir, "rpc-info-*.json"))
        if not files:
            print("Error: No rpc-info file found")
            sys.exit(1)
            
        latest_file = max(files, key=os.path.getctime)
        with open(latest_file, 'r') as f:
            info = json.load(f)
            
        binary = info.get('browser', {}).get('binary', '')
        name = info.get('browser', {}).get('name', '')
        
        print(f"Detected Binary: {binary}")
        print(f"Detected Name: {name}")
        
        # We want to ensure it's NOT the wrapper
        if "wrapper" in binary or "sh" == name or "bash" == name:
             print("FAILURE: Detected wrapper or shell as browser.")
             # sys.exit(1) # Don't exit yet, let's see what it is
        elif "python" in binary.lower() or "python" in name.lower():
             print("SUCCESS: Detected python (grandparent) correctly.")
        else:
             print(f"WARNING: Detected {binary}. Is this what we want?")

    finally:
        proc.terminate()
        if os.path.exists(wrapper_path):
            os.remove(wrapper_path)

if __name__ == "__main__":
    main()
