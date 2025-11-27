import pytest
import sys
import os
from jst.engine import JSTEngine

def test_logging_default_silent(capsys):
    """Verify that by default (verbose=False), no logs are printed to stdout."""
    engine = JSTEngine(verbose=False)
    try:
        # Wait a bit to ensure some logs would have been produced
        import time
        time.sleep(1)
        
        captured = capsys.readouterr()
        # We expect NO output from the subprocess in stdout
        # Note: JSTEngine prints to stdout, so we check captured.out
        assert "RPC_PORT=" not in captured.out
        assert "BtEngine listening" not in captured.out
        
    finally:
        engine.close()

def test_logging_verbose(capsys):
    """Verify that with verbose=True, logs are printed to stdout."""
    engine = JSTEngine(verbose=True)
    try:
        # Wait a bit to ensure some logs would have been produced
        import time
        time.sleep(1)
        
        captured = capsys.readouterr()
        # We expect output from the subprocess in stdout
        assert "RPC_PORT=" in captured.out
        # The exact log message might vary, but RPC_PORT is always printed by the wrapper
        # when it detects it in the stream, IF verbose is on.
        
    finally:
        engine.close()
