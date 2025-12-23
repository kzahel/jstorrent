import subprocess
import json
import os
import sys
import time
import glob
import tempfile

def main():
    # Build first
    print("Building...")
    subprocess.check_call(["cargo", "build", "--workspace"])

    host_binary = "./target/debug/jstorrent-host"
    
    with tempfile.TemporaryDirectory() as temp_dir:
        print(f"Using temp config dir: {temp_dir}")
        os.environ["JSTORRENT_CONFIG_DIR"] = temp_dir
        
        config_dir = os.path.join(temp_dir, "jstorrent-native")
        
        print("Starting host...")
        # Start host directly
        proc = subprocess.Popen(
            [host_binary],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=sys.stderr,
            env=os.environ
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
                if p.get('pid') == my_pid: 
                     profile = p
                     break
            
            if not profile and info.get('profiles'):
                 profile = info['profiles'][0]
            
            if not profile:
                 print("Error: No profile found in rpc-info.json")
                 sys.exit(1)

            browser_binary = profile.get('browser', {}).get('binary', '')
            browser_name = profile.get('browser', {}).get('name', '')
            install_id = profile.get('install_id')
            
            print(f"Detected Browser Binary: {browser_binary}")
            print(f"Detected Browser Name: {browser_name}")
            print(f"Install ID: {install_id}")

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
