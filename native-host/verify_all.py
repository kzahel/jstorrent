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
    
    failed = []
    for script in SCRIPTS:
        if not run_script(script):
            failed.append(script)
    
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
