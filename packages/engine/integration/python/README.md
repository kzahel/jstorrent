# Python Integration Tests

## Prerequisites

- Python 3.10+
- [uv](https://docs.astral.sh/uv/) package manager
- `libtorrent` may require system-level installation or building from source if a wheel is not available for your platform

## Setup

Install dependencies with uv:

```bash
uv sync
```

## Running Tests

```bash
# Run all tests
uv run python run_tests.py

# Run specific test
uv run python test_download.py

# Run tests matching pattern
uv run python run_tests.py -k resume

# Run specific test with arguments (e.g., piece length)
uv run python test_download.py 32768
```

Each test is a standalone script that can be run directly.

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
# Run a single test with inspector on default port
NODE_INSPECT=9229 python test_recheck.py

# Pause execution until debugger attaches (useful for debugging startup)
NODE_INSPECT_BRK=9229 python test_recheck.py
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
