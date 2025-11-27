# Python Integration Tests

## Setup

1. Create a virtual environment and install dependencies:
   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -e .
   ```

   Or with `uv` (faster):
   ```bash
   uv venv .venv
   source .venv/bin/activate
   uv pip install -e .
   ```

   *Note: `libtorrent` might require system-level installation or building from source if a wheel is not available for your platform.*

## Running Tests

```bash
pytest
```

## Debugging the Node.js Engine

The `JSTEngine` class supports Node.js inspector flags for debugging with Chrome DevTools.

### Environment Variables

| Variable | Description |
|----------|-------------|
| `NODE_INSPECT=true` | Enable Node.js inspector with auto-assigned port |
| `NODE_INSPECT=9229` | Enable inspector on specific port (1024-65535) |
| `NODE_INSPECT_BRK=true` | Enable inspector and pause on first line (waits for debugger to attach) |
| `NODE_INSPECT_BRK=9229` | Same as above, but on a specific port |

### Usage

```bash
# Run a single test with inspector on default port (recommended for single test)
NODE_INSPECT=9229 pytest test_recheck.py -v

# Run with auto-assigned port (for multiple tests)
NODE_INSPECT=true pytest .

# Pause execution until debugger attaches (useful for debugging startup)
NODE_INSPECT_BRK=9229 pytest test_recheck.py -v
```

### Connecting Chrome DevTools

**Recommended: Use a fixed port (9229)**

1. Run with `NODE_INSPECT=9229` or `NODE_INSPECT_BRK=9229`
2. Open Chrome and navigate to `chrome://inspect`
3. You should see the Node.js target automatically (Chrome polls port 9229 by default)
4. Click **"inspect"** to attach

**Alternative: Auto-assigned ports**

When using `NODE_INSPECT=true` (auto-port), Chrome won't auto-discover the target:
1. Look for "Debugger listening on ws://127.0.0.1:**PORT**/..." in the test output
2. In `chrome://inspect`, click **"Configure..."** 
3. Add `localhost:<PORT>` to the list
4. Or click **"Open dedicated DevTools for Node"** which may auto-discover local processes

**Tip:** Use `NODE_INSPECT_BRK=9229` if tests complete too quickly to attach. This pauses the engine on the first line of execution, giving you time to set breakpoints before continuing.
