# Testing HTTP RPC Layer

To run the verification script for the HTTP RPC layer, use the following command from the `packages/engine` directory:

```bash
pnpm exec tsx ../../scripts/test-rpc.ts
```

This script will:
1. Start the HTTP RPC server on port 3001.
2. Start the BtEngine on port 6881.
3. Perform a sequence of API calls (`start`, `status`, `add`, `stop`).
4. Verify the responses.
5. Shut down the server.

## Running Python Tests

To run the Python verification script (which simulates an external controller):

```bash
python3 packages/engine/tests/python/test_btengine_http_rpc.py
```

This script requires `requests` to be installed (`pip install requests`).

## Python JSTEngine Adapter

A high-level Python adapter is available in `packages/engine/tests/python/jst`. It provides an idiomatic interface for controlling the engine.

Example usage:

```python
from jst import JSTEngine

# JSTEngine automatically spawns the process and starts the engine
engine = JSTEngine(port=3002)

tid = engine.add_magnet("magnet:?xt=...")
engine.wait_for_state(tid, "downloading")

# Cleanup happens automatically on exit, or explicitly:
engine.close()
```

To run the adapter verification test:

```bash
python3 packages/engine/tests/python/test_jst_adapter.py
```