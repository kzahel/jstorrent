#!/usr/bin/env python3
"""Test JSTEngine adapter lifecycle and basic operations."""
import sys
from jst import JSTEngine, EngineNotRunning, EngineAlreadyRunning
from test_helpers import temp_directory, fail, passed


def main() -> int:
    with temp_directory() as temp_dir:
        engine = JSTEngine(download_dir=temp_dir)
        try:
            # Test status (should be running)
            st = engine.status()
            if st.get("running") is not True:
                return fail("Expected running: true")

            # Test double start - should raise EngineAlreadyRunning
            try:
                engine.start_engine()
                return fail("Expected EngineAlreadyRunning exception")
            except EngineAlreadyRunning:
                pass  # Expected

            # Test add magnet (fake hash, no trackers to avoid real network traffic)
            magnet = "magnet:?xt=urn:btih:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&dn=TestTorrent"
            tid = engine.add_magnet(magnet)
            if not tid:
                return fail("No torrent ID returned")

            # Test get_torrent_status
            ts = engine.get_torrent_status(tid)
            if ts["id"] != tid:
                return fail("Torrent ID mismatch")

            # Test wait_for_state (downloading)
            engine.wait_for_state(tid, "downloading", timeout=5)

            # Test stop engine
            engine.stop_engine()

            # Test status (should be not running)
            st = engine.status()
            if st.get("running") is not False:
                return fail("Expected running: false")

            # Test double stop - should raise EngineNotRunning
            try:
                engine.stop_engine()
                return fail("Expected EngineNotRunning exception")
            except EngineNotRunning:
                pass  # Expected

        finally:
            engine.close()

    return passed("JSTEngine adapter tests passed")


if __name__ == "__main__":
    sys.exit(main())
