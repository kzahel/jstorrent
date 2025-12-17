#!/usr/bin/env python3
"""
Test that quick disconnect backoff prevents connection spam.

Scenario: libtorrent is listening but doesn't have the torrent our engine wants.
libtorrent will accept the TCP connection but close it after handshake (unknown infohash).
Our engine should apply exponential backoff, NOT spam 1000s of connections.

Expected behavior:
- First reconnect attempt: ~1s delay
- Second reconnect attempt: ~2s delay
- Third reconnect attempt: ~4s delay
- Total connection attempts in 10s should be ~4-5, not hundreds
"""
import sys
import os
import time
import re
from test_helpers import (
    temp_directory, test_engine,
    fail, passed
)
from libtorrent_utils import LibtorrentSession


def count_connection_attempts(logs: list, peer_ip: str, peer_port: int) -> int:
    """Count how many times we attempted to connect to a specific peer."""
    count = 0
    # Look for connection attempt patterns in logs
    # These are logged when we try to connect
    connect_pattern = re.compile(
        rf"(Connecting to|→ connecting|markConnecting).*{re.escape(peer_ip)}.*{peer_port}",
        re.IGNORECASE
    )
    for log in logs:
        msg = log.get("message", "") + " " + str(log.get("args", []))
        if connect_pattern.search(msg):
            count += 1
    return count


def count_quick_disconnects(logs: list) -> int:
    """Count quickDisconnects mentions in logs."""
    count = 0
    for log in logs:
        msg = log.get("message", "") + " " + str(log.get("args", []))
        # Look for quickDisconnects in disconnect messages
        match = re.search(r"quickDisconnects=(\d+)", msg)
        if match:
            count = max(count, int(match.group(1)))
    return count


def test_quick_disconnect_backoff() -> bool:
    """
    Test that connection attempts are throttled when peer disconnects immediately.

    We connect to a libtorrent peer that doesn't have our torrent. It will
    accept TCP connections but close after handshake (unknown infohash).

    Without backoff: Would see 100s-1000s of connection attempts in 10 seconds
    With backoff: Should see ~4-5 attempts (1s + 2s + 4s delays)
    """
    print("\n=== Testing Quick Disconnect Backoff ===")

    with temp_directory() as temp_dir:
        lt_dir = os.path.join(temp_dir, "lt_peer")
        engine_dir = os.path.join(temp_dir, "engine")
        os.makedirs(lt_dir)
        os.makedirs(engine_dir)

        # Create libtorrent session WITHOUT adding any torrent
        # It will listen for connections but reject unknown infohashes
        lt_session = LibtorrentSession(lt_dir, port=0)
        lt_port = lt_session.listen_port()
        print(f"Libtorrent listening on port {lt_port} (no torrents)")

        # Create a magnet with a fake infohash that libtorrent doesn't have
        # Also add peer hint pointing to our libtorrent session
        fake_infohash = "a" * 40  # libtorrent won't have this
        magnet = f"magnet:?xt=urn:btih:{fake_infohash}&x.pe=127.0.0.1:{lt_port}"
        print(f"Magnet: {magnet}")

        # Start our engine with this magnet
        with test_engine(engine_dir) as engine:
            print("Adding magnet to engine...")
            tid = engine.add_magnet(magnet)

            # Manually trigger a connection to the peer hint
            # (The engine might not immediately connect to peer hints)
            engine.add_peer(tid, "127.0.0.1", lt_port)

            # Wait for 10 seconds to observe connection behavior
            print("Waiting 10 seconds to observe connection attempts...")
            time.sleep(10)

            # Get logs and count connection attempts
            logs = engine.get_logs(level="debug", limit=1000).get("logs", [])

            # Count connection attempts to the libtorrent peer
            connect_count = count_connection_attempts(logs, "127.0.0.1", lt_port)
            quick_disconnect_count = count_quick_disconnects(logs)

            print(f"\nResults after 10 seconds:")
            print(f"  Connection attempts: {connect_count}")
            print(f"  Max quickDisconnects counter: {quick_disconnect_count}")

            # Print some relevant logs for debugging
            print("\nRelevant log entries:")
            for log in logs:
                msg = log.get("message", "") + " " + str(log.get("args", []))
                if "127.0.0.1" in msg or "quickDisconnect" in msg.lower() or "backoff" in msg.lower():
                    print(f"  [{log.get('level', '?')}] {msg[:100]}")

            # Verify backoff is working
            # With exponential backoff starting at 1s, in 10 seconds we should see:
            # - Initial connection
            # - Retry at ~1s (quickDisconnects=1, backoff=2^1=2s)
            # - Retry at ~3s (quickDisconnects=2, backoff=2^2=4s)
            # - Retry at ~7s (quickDisconnects=3, backoff=2^3=8s)
            # Total: ~4 attempts in 10 seconds
            #
            # Without backoff we'd see hundreds of attempts
            MAX_EXPECTED_ATTEMPTS = 10  # Allow some margin for timing variations

            if connect_count > MAX_EXPECTED_ATTEMPTS:
                print(f"\nFAIL: Too many connection attempts ({connect_count} > {MAX_EXPECTED_ATTEMPTS})")
                print("Backoff may not be working correctly!")
                return False

            if quick_disconnect_count < 2:
                print(f"\nWARN: quickDisconnects counter seems low ({quick_disconnect_count})")
                print("This might indicate the connection/disconnect cycle isn't being tracked")
                # Don't fail on this - the main check is connection count

            print(f"\nOK: Connection attempts ({connect_count}) within expected range")

    print("OK: Quick disconnect backoff test passed")
    return True


def main() -> int:
    if not test_quick_disconnect_backoff():
        return fail("Quick disconnect backoff test failed")

    return passed("Quick disconnect backoff test passed")


if __name__ == "__main__":
    sys.exit(main())
