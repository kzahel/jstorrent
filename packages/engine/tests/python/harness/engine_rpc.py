import subprocess
import json
import os
import time
from typing import Any, Dict, Optional

class EngineRPC:
    def __init__(self, engine_path: str = "dist/cmd/repl.js"):
        # We assume the engine is built or we run via tsx
        # For now, let's try running via npm run repl if possible, or direct tsx
        # But subprocess needs a command.
        # Let's assume we run from packages/engine root.
        self.process: Optional[subprocess.Popen] = None
        
    def start(self):
        # Use npx tsx to run the repl directly from source for dev speed
        cmd = ["npx", "tsx", "src/cmd/repl.ts"]
        # Ensure we are in the right directory
        cwd = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../"))
        
        self.process = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=None, # Inherit stderr
            cwd=cwd,
            text=True,
            bufsize=1  # Line buffered
        )

    def send_command(self, cmd: str, params: Dict[str, Any] = {}) -> Dict[str, Any]:
        if not self.process or self.process.poll() is not None:
            raise RuntimeError("Engine process is not running")

        req = {"cmd": cmd, "params": params}
        json_req = json.dumps(req)
        
        if self.process.stdin:
            self.process.stdin.write(json_req + "\n")
            self.process.stdin.flush()
        
        if self.process.stdout:
            line = self.process.stdout.readline()
            if not line:
                # Check stderr
                # err = self.process.stderr.read() if self.process.stderr else ""
                raise RuntimeError(f"Engine process exited unexpectedly. Check engine.stderr.log")
            
            try:
                return json.loads(line)
            except json.JSONDecodeError:
                raise RuntimeError(f"Invalid JSON response: {line}")
        
        raise RuntimeError("No stdout available")

    def stop(self):
        if self.process:
            self.process.terminate()
            try:
                self.process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self.process.kill()
            self.process = None
            
        if hasattr(self, 'stderr_file') and self.stderr_file:
            self.stderr_file.close()
