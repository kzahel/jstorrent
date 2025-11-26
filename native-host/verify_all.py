#!/usr/bin/env python3
import subprocess
import sys
import time

import glob
import os

# Dynamically find all verify_*.py scripts in the current directory
SCRIPTS = [
    f for f in glob.glob("verify_*.py")
    if f != "verify_all.py"
]
SCRIPTS.sort()

def run_script(script_name):
    print(f"==================================================")
    print(f"Running {script_name}...")
    print(f"==================================================")
    start_time = time.time()
    try:
        subprocess.check_call([sys.executable, script_name])
        duration = time.time() - start_time
        print(f"✅ {script_name} PASSED ({duration:.2f}s)\n")
        return True
    except subprocess.CalledProcessError:
        duration = time.time() - start_time
        print(f"❌ {script_name} FAILED ({duration:.2f}s)\n")
        return False

def main():
    print("Starting all verification scripts...\n")
    
    # Check global config
    config_dir = os.path.expanduser("~/.config/jstorrent-native")
    rpc_file = os.path.join(config_dir, "rpc-info.json")
    
    initial_mtime = None
    if os.path.exists(rpc_file):
        initial_mtime = os.path.getmtime(rpc_file)
        print(f"Global config exists at {rpc_file}. mtime: {initial_mtime}")
    else:
        print(f"Global config does not exist at {rpc_file}")

    failed = []
    for script in SCRIPTS:
        if not run_script(script):
            failed.append(script)
    
    # Verify global config hasn't changed
    if os.path.exists(rpc_file):
        final_mtime = os.path.getmtime(rpc_file)
        if initial_mtime is None:
             print(f"❌ FAILURE: Global config was created during tests! ({rpc_file})")
             failed.append("GLOBAL_CONFIG_LEAK")
        elif final_mtime != initial_mtime:
             print(f"❌ FAILURE: Global config was modified during tests! ({rpc_file})")
             print(f"Initial: {initial_mtime}, Final: {final_mtime}")
             failed.append("GLOBAL_CONFIG_LEAK")
        else:
             print(f"✅ Global config was NOT modified.")
    elif initial_mtime is not None:
        print(f"❌ FAILURE: Global config was deleted during tests! ({rpc_file})")
        failed.append("GLOBAL_CONFIG_LEAK")
    else:
        print(f"✅ Global config still does not exist.")

    print("==================================================")
    if failed:
        print(f"❌ Verification FAILED. The following scripts failed:")
        for s in failed:
            print(f"  - {s}")
        sys.exit(1)
    else:
        print("✅ All verification scripts PASSED!")
        sys.exit(0)

if __name__ == "__main__":
    main()
