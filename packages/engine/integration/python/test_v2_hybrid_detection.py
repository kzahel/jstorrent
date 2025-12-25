#!/usr/bin/env python3
"""
Test that JSTEngine logs appropriate warning when connecting with truncated v2 info hash.

Scenario:
1. Create a v2 hybrid torrent with libtorrent
2. Start seeding with libtorrent
3. Connect JSTEngine using the TRUNCATED v2 hash (simulating the bug)
4. Verify JSTEngine logs warning about metadata hash mismatch mentioning truncated v2
"""
import sys
import re
from test_helpers import test_dirs, test_engine, wait_for, fail, passed
from libtorrent_utils import LibtorrentSession, create_v2_hybrid_torrent


def test_truncated_v2_detection() -> bool:
    """Test that JSTEngine warns about potential truncated v2 hash."""
    print("\n=== Testing V2 Hybrid Truncated Hash Warning ===")

    with test_dirs() as (seeder_dir, leecher_dir):
        # 1. Create v2 hybrid torrent
        result = create_v2_hybrid_torrent(seeder_dir, "test.bin", size=64 * 1024)

        if result[0] is None:
            print("Skip: libtorrent doesn't support v2 hybrid torrents")
            return True

        torrent_path, v1_hash, truncated_v2_hash = result

        if v1_hash is None:
            print("Skip: libtorrent doesn't support v2 hybrid torrents")
            return True

        print(f"V1 hash:          {v1_hash}")
        print(f"Truncated v2:     {truncated_v2_hash}")

        if v1_hash == truncated_v2_hash:
            print("Skip: v1 and truncated v2 are same (not a hybrid torrent)")
            return True

        # 2. Start libtorrent seeder
        lt_session = LibtorrentSession(seeder_dir, port=0)
        handle = lt_session.add_torrent(torrent_path, seeder_dir, seed_mode=True)
        port = lt_session.listen_port()

        if not wait_for(lambda: handle.status().is_seeding, timeout=5, description="seeding"):
            print("FAIL: Seeder not ready")
            return False

        print(f"Seeding on port {port}")

        # 3. Connect JSTEngine using truncated v2 hash (the wrong hash)
        with test_engine(leecher_dir) as engine:
            magnet = f"magnet:?xt=urn:btih:{truncated_v2_hash}"
            tid = engine.add_magnet(magnet)

            # Add peer hint to connect directly
            engine.add_peer(tid, "127.0.0.1", port)

            # 4. Wait for the warning to appear in logs
            def check_for_warning():
                logs = engine.get_logs(level="warn", limit=500).get("logs", [])
                for log in logs:
                    msg = log.get("message", "")
                    if "Metadata hash mismatch" in msg and "truncated v2" in msg:
                        return True
                return False

            if wait_for(check_for_warning, timeout=10, interval=0.5, description="v2 warning"):
                logs = engine.get_logs(level="warn", limit=500).get("logs", [])
                for log in logs:
                    msg = log.get("message", "")
                    if "Metadata hash mismatch" in msg and "truncated v2" in msg:
                        print(f"Found warning: {msg[:150]}...")
                        break
            else:
                logs = engine.get_logs(level="warn", limit=500).get("logs", [])
                print("FAIL: Expected warning about metadata hash mismatch / truncated v2 not found")
                print(f"Got {len(logs)} warn logs:")
                for log in logs:
                    print(f"  [{log.get('level')}] {log.get('message')[:150]}")
                return False

    print("OK: Truncated v2 warning logged correctly")
    return True


def main() -> int:
    if not test_truncated_v2_detection():
        return fail("V2 hybrid detection test failed")
    return passed("V2 hybrid detection test passed")


if __name__ == "__main__":
    sys.exit(main())
