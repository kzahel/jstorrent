#!/usr/bin/env python3
"""Test RPC methods of JSTEngine."""
import sys
import time
from test_helpers import temp_directory, test_engine, fail, passed

MAGNET_LINK = "magnet:?xt=urn:btih:d69f9033168037e9d75e4e38d722282803112e41&dn=test_torrent"


def main() -> int:
    with temp_directory() as temp_dir:
        with test_engine(temp_dir) as engine:
            # Add torrent
            tid = engine.add_magnet(MAGNET_LINK)

            # Wait for it to be added
            time.sleep(1)

            # Test get_peer_info
            peers = engine.get_peer_info(tid)
            if not peers.get("ok"):
                return fail("get_peer_info failed")
            if not isinstance(peers.get("peers"), list):
                return fail("get_peer_info didn't return peers list")

            # Test get_piece_availability
            avail = engine.get_piece_availability(tid)
            if not avail.get("ok"):
                return fail("get_piece_availability failed")
            if not isinstance(avail.get("availability"), list):
                return fail("get_piece_availability didn't return availability list")

            # Test set_max_peers
            res = engine.set_max_peers(tid, 10)
            if not res.get("ok"):
                return fail("set_max_peers failed")

            # Test get_download_rate
            rate = engine.get_download_rate(tid)
            if not isinstance(rate, (int, float)):
                return fail("get_download_rate didn't return number")

            # Test get_logs
            logs = engine.get_logs()
            if not logs.get("ok"):
                return fail("get_logs failed")
            if not isinstance(logs.get("logs"), list):
                return fail("get_logs didn't return logs list")
            # We should have some logs from startup
            if len(logs.get("logs", [])) == 0:
                return fail("get_logs returned empty logs")

            # Test force_disconnect_peer (mock call since we might not have peers)
            # Just check if it doesn't crash
            res = engine.force_disconnect_peer(tid, "1.2.3.4", 1234)
            if not res.get("ok"):
                return fail("force_disconnect_peer failed")

    return passed("All RPC method tests passed")


if __name__ == "__main__":
    sys.exit(main())
