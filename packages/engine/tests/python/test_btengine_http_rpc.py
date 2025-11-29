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

            # Add a magnet
            magnet = (
                "magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&dn=Sintel&"
                "tr=udp%3A%2F%2Ftracker.leechers-paradise.org%3A6969&"
                "tr=udp%3A%2F%2Ftracker.coppersurfer.tk%3A6969&"
                "tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&"
                "tr=udp%3A%2F%2Fexplodie.org%3A6969&"
                "tr=udp%3A%2F%2Ftracker.empire-js.us%3A1337"
            )
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
