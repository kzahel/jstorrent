import subprocess
import json
import os
import sys
import time
import glob

def main():
    # Build stub
    print("Building stub...")
    subprocess.check_call(["cargo", "build", "--bin", "jstorrent-link-handler"], cwd="native-host")

    # Ensure we have an rpc-info file with python as the browser
    config_dir = os.path.expanduser("~/.config/jstorrent-native")
    files = glob.glob(os.path.join(config_dir, "rpc-info-*.json"))
    if not files:
        print("Error: No rpc-info file found. Run verify_discovery.py first.")
        sys.exit(1)
        
    latest_file = max(files, key=os.path.getctime)
    with open(latest_file, 'r') as f:
        info = json.load(f)
        
    print(f"Current rpc-info browser: {info.get('browser', {}).get('binary')}")
    
    if "python" not in info.get('browser', {}).get('binary', '').lower():
        print("Warning: Current rpc-info does not have python as browser. Test might not be valid.")
        
    # Run stub with a magnet link. It should NOT try to launch python.
    # Since we can't easily check what it launched without mocking, 
    # we can check if it fails with "Could not launch browser" (which means it fell back to xdg-open and failed or succeeded)
    # OR we can check if it *doesn't* launch python.
    
    # Actually, if it falls back to xdg-open, that's good.
    # If it tries to launch python with the URL, python might error out or hang.
    
    print("Running stub...")
    env = os.environ.copy()
    # We can set LAUNCH_URL to something safe
    
    cmd = ["./native-host/target/debug/jstorrent-link-handler", "magnet:?xt=urn:btih:1234567890abcdef1234567890abcdef12345678"]
    
    # We expect it to NOT use python.
    # If it uses python, it would execute `python <url>`, which would fail with "No such file or directory" (as it treats url as script)
    # If it uses xdg-open, it might open a browser or fail if no browser.
    
    # Let's just run it and see output.
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
        print("Stdout:", proc.stdout)
        print("Stderr:", proc.stderr)
        
        if "python" in proc.stderr.lower():
             print("FAILURE: It seems to have tried to use python?")
        else:
             print("SUCCESS: Did not see python errors.")
             
    except subprocess.TimeoutExpired:
        print("Timed out.")

if __name__ == "__main__":
    main()
