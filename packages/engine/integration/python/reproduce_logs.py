import sys
import os
import time

# Add current directory to path so we can import jst
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from jst.engine import JSTEngine

print("Starting engine...")
# Initialize engine - this should start the subprocess
engine = JSTEngine()
print(f"Engine started on port {engine.bt_port}")

print("Waiting for 2 seconds...")
time.sleep(2)

print("Stopping engine...")
engine.close()
