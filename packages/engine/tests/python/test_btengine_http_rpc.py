#!/usr/bin/env python3
"""Test BtEngine HTTP RPC basic operations."""
import sys
from test_helpers import temp_directory, test_engine, fail, passed


def main() -> int:
    with temp_directory() as temp_dir:
        with test_engine(temp_dir) as engine:
            # Status should be running because JSTEngine starts the engine in __init__
            status = engine.status()
            if status.get("running") is not True:
                return fail("Expected running: true after JSTEngine init")

            # Add a magnet (fake hash, no trackers to avoid real network traffic)
            magnet = "magnet:?xt=urn:btih:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&dn=TestTorrent"
            tid = engine.add_magnet(magnet)
            if not tid:
                return fail("No torrent ID returned")

            # Fetch torrent status
            tstatus = engine.get_torrent_status(tid)
            if tstatus.get("id") != tid:
                return fail("Torrent ID mismatch")

            # Stop engine
            engine.stop_engine()
            status = engine.status()
            if status.get("running") is not False:
                return fail("Expected running: false after stop")

    return passed("BtEngine HTTP RPC tests passed")


if __name__ == "__main__":
    sys.exit(main())
