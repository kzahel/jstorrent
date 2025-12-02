#!/usr/bin/env python3
"""
Test that download continues after peer disconnect.

This is the core test for the ActivePiece refactoring. The bug was:
- Peer A requests blocks for piece P
- Peer A disconnects before sending data
- Blocks marked as "requested" stay that way forever
- No other peer will request those blocks -> stall

The fix: Track which peer made each request. When peer disconnects,
clear only that peer's requests so blocks become available for other peers.
"""
import sys
import os
import time
import shutil
from test_helpers import (
    temp_directory, test_engine, wait_for_seeding, wait_for,
    fail, passed
)
from libtorrent_utils import LibtorrentSession


def test_peer_disconnect_allows_rerequest() -> bool:
    """
    Test that disconnecting a peer allows blocks to be re-requested from another peer.

    Strategy: Connect to two seeders, disconnect one mid-download, verify the
    download completes from the remaining seeder.
    """
    print("\n=== Testing Peer Disconnect Allows Re-request ===")

    with temp_directory() as temp_dir:
        seeder1_dir = os.path.join(temp_dir, "seeder1")
        seeder2_dir = os.path.join(temp_dir, "seeder2")
        leecher_dir = os.path.join(temp_dir, "leecher")
        os.makedirs(seeder1_dir)
        os.makedirs(seeder2_dir)
        os.makedirs(leecher_dir)

        # Use a larger file so we have time to disconnect mid-download
        piece_length = 16384
        file_size = 1024 * 1024  # 1MB = 64 pieces

        # Create seeder1 with the data
        lt_session1 = LibtorrentSession(seeder1_dir, port=0)
        torrent_path, info_hash = lt_session1.create_dummy_torrent(
            "test_data.bin", size=file_size, piece_length=piece_length
        )
        lt_handle1 = lt_session1.add_torrent(torrent_path, seeder1_dir, seed_mode=True)

        # Wait for seeder1 to be ready
        if not wait_for_seeding(lt_handle1):
            print("FAIL: Seeder1 not ready")
            return False

        port1 = lt_session1.listen_port()

        # Create seeder2 with the same data (copy the file)
        shutil.copy(
            os.path.join(seeder1_dir, "test_data.bin"),
            os.path.join(seeder2_dir, "test_data.bin")
        )
        lt_session2 = LibtorrentSession(seeder2_dir, port=0)
        lt_handle2 = lt_session2.add_torrent(torrent_path, seeder2_dir, seed_mode=True)

        # Wait for seeder2 to be ready
        if not wait_for_seeding(lt_handle2):
            print("FAIL: Seeder2 not ready")
            return False

        port2 = lt_session2.listen_port()

        # Start JSTEngine leecher
        with test_engine(leecher_dir) as engine:
            tid = engine.add_torrent_file(torrent_path)

            # Connect to BOTH seeders
            engine.add_peer(tid, "127.0.0.1", port1)
            engine.add_peer(tid, "127.0.0.1", port2)

            # Wait for connections to establish
            time.sleep(0.3)

            # Disconnect seeder1 while download is in progress
            engine.force_disconnect_peer(tid, "127.0.0.1", port1)
            print("Disconnected seeder1")

            # Download should continue and complete from seeder2
            def check_complete():
                status = engine.get_torrent_status(tid)
                progress = status.get("progress", 0)
                print(f"Progress: {progress:.1%}")
                return progress >= 1.0

            if not wait_for(check_complete, timeout=10, interval=0.1, description="download"):
                final_status = engine.get_torrent_status(tid)
                print(f"FAIL: Download stalled at {final_status['progress']:.1%} after peer disconnect")
                return False

            print("Download complete!")

    print("OK: Peer disconnect re-request test passed")
    return True


def test_single_peer_disconnect_and_reconnect() -> bool:
    """
    Test the scenario where we have only one peer, disconnect it, reconnect it,
    and verify download continues.
    """
    print("\n=== Testing Single Peer Disconnect and Reconnect ===")

    with temp_directory() as temp_dir:
        seeder_dir = os.path.join(temp_dir, "seeder")
        leecher_dir = os.path.join(temp_dir, "leecher")
        os.makedirs(seeder_dir)
        os.makedirs(leecher_dir)

        piece_length = 16384
        file_size = 512 * 1024  # 512KB = 32 pieces

        # Create seeder
        lt_session = LibtorrentSession(seeder_dir, port=0)
        torrent_path, info_hash = lt_session.create_dummy_torrent(
            "test_data.bin", size=file_size, piece_length=piece_length
        )
        lt_handle = lt_session.add_torrent(torrent_path, seeder_dir, seed_mode=True)

        if not wait_for_seeding(lt_handle):
            print("FAIL: Seeder not ready")
            return False

        port = lt_session.listen_port()

        # Start leecher
        with test_engine(leecher_dir) as engine:
            tid = engine.add_torrent_file(torrent_path)

            # Connect and wait for some progress
            engine.add_peer(tid, "127.0.0.1", port)
            time.sleep(0.2)

            # Disconnect while download in progress
            engine.force_disconnect_peer(tid, "127.0.0.1", port)
            print("Disconnected peer")

            progress_at_disconnect = engine.get_torrent_status(tid).get("progress", 0)
            print(f"Progress at disconnect: {progress_at_disconnect:.1%}")

            # Reconnect to the same peer
            engine.add_peer(tid, "127.0.0.1", port)
            print("Reconnected peer")

            # Download should continue from where it left off
            def check_complete():
                status = engine.get_torrent_status(tid)
                progress = status.get("progress", 0)
                print(f"After reconnect: Progress: {progress:.1%}")
                return progress >= 1.0

            if not wait_for(check_complete, timeout=10, interval=0.1, description="download"):
                final_status = engine.get_torrent_status(tid)
                print(f"FAIL: Download stalled at {final_status['progress']:.1%} after reconnect")
                return False

            print("Download complete!")

    print("OK: Single peer disconnect/reconnect test passed")
    return True


def main() -> int:
    if not test_peer_disconnect_allows_rerequest():
        return fail("Peer disconnect re-request test failed")

    if not test_single_peer_disconnect_and_reconnect():
        return fail("Single peer disconnect/reconnect test failed")

    return passed("All peer disconnect tests passed")


if __name__ == "__main__":
    sys.exit(main())
