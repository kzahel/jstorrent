#!/usr/bin/env python3
"""Test verbose logging flag for JSTEngine."""
import sys
import time
import io
from contextlib import redirect_stdout
from jst.engine import JSTEngine
from test_helpers import temp_directory, fail, passed


def test_logging_default_silent() -> bool:
    """Verify that by default (verbose=False), no logs are printed to stdout."""
    print("Testing default silent mode...")

    with temp_directory() as temp_dir:
        # Capture stdout during engine creation and operation
        captured = io.StringIO()
        with redirect_stdout(captured):
            engine = JSTEngine(download_dir=temp_dir, verbose=False)
            try:
                time.sleep(1)
            finally:
                engine.close()

        output = captured.getvalue()
        # With verbose=False, we should NOT see RPC_PORT in captured output
        # Note: JSTEngine may still print some startup info, but RPC_PORT
        # is specifically controlled by verbose flag
        if "RPC_PORT=" in output:
            print(f"FAIL: Found RPC_PORT in silent mode output: {output[:200]}")
            return False

    print("OK: Silent mode works")
    return True


def test_logging_verbose() -> bool:
    """Verify that with verbose=True, logs are printed to stdout."""
    print("Testing verbose mode...")

    with temp_directory() as temp_dir:
        # Capture stdout during engine creation and operation
        captured = io.StringIO()
        with redirect_stdout(captured):
            engine = JSTEngine(download_dir=temp_dir, verbose=True)
            try:
                time.sleep(1)
            finally:
                engine.close()

        output = captured.getvalue()
        # With verbose=True, we should see RPC_PORT in output
        if "RPC_PORT=" not in output:
            print(f"FAIL: RPC_PORT not found in verbose output: {output[:200]}")
            return False

    print("OK: Verbose mode works")
    return True


def main() -> int:
    if not test_logging_default_silent():
        return fail("Silent logging test failed")

    if not test_logging_verbose():
        return fail("Verbose logging test failed")

    return passed("All verbose logging tests passed")


if __name__ == "__main__":
    sys.exit(main())
