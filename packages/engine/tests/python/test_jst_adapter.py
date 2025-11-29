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

            # Test add magnet
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
