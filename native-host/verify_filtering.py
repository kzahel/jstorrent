import subprocess
import json
import os
import sys
import time
import glob
import tempfile

def main():
    # Build binaries
    print("Building binaries...")
    subprocess.check_call(["cargo", "build", "--workspace"])
    
    with tempfile.TemporaryDirectory() as temp_dir:
        print(f"Using temp config dir: {temp_dir}")
        env = os.environ.copy()
        env["JSTORRENT_CONFIG_DIR"] = temp_dir
        
        # Start native host
        host_bin = "./target/debug/jstorrent-host"
        print("Starting native host...")
        proc = subprocess.Popen(
            [host_bin, "chrome-extension://test-extension-id/"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=sys.stderr,
            env=env
        )
        
        try:
            # Wait for rpc-info.json
            config_dir = os.path.join(temp_dir, "jstorrent-native")
            rpc_file = os.path.join(config_dir, "rpc-info.json")
            
            print("Waiting for rpc-info.json...")
            for _ in range(50):
                if os.path.exists(rpc_file):
                    break
                time.sleep(0.1)
                
            if not os.path.exists(rpc_file):
                print("Error: rpc-info.json not found")
                sys.exit(1)
                
            with open(rpc_file, 'r') as f:
                info = json.load(f)
                
            print(f"Current rpc-info browser: {info.get('browser', {}).get('binary')}")
            
            # Run link handler with a magnet link.
            print("Running link handler...")
            cmd = ["./target/debug/jstorrent-link-handler", "magnet:?xt=urn:btih:1234567890abcdef1234567890abcdef12345678"]
            
            # We expect it to NOT use python.
            try:
                link_handler_proc = subprocess.run(cmd, capture_output=True, text=True, timeout=5, env=env)
                print("Stdout:", link_handler_proc.stdout)
                print("Stderr:", link_handler_proc.stderr)
                
                if "python" in link_handler_proc.stderr.lower():
                     print("FAILURE: It seems to have tried to use python?")
                     sys.exit(1)
                else:
                     print("SUCCESS: Did not see python errors.")
                     
            except subprocess.TimeoutExpired:
                print("Timed out.")
                sys.exit(1)
                
        finally:
            proc.terminate()
            proc.wait()

if __name__ == "__main__":
    main()
