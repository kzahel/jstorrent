#!/usr/bin/env python3
"""Test connection limit enforcement."""
import sys
import os
import shutil
import time
from test_helpers import (
    temp_directory, test_engine, wait_for_seeding,
    fail, passed
)
from libtorrent_utils import LibtorrentSession


def test_global_connection_limit() -> bool:
    """Test that engine respects global max connection limits."""
    print("\n=== Testing Global Connection Limit ===")

    with temp_directory() as temp_dir:
        seeder_base_dir = os.path.join(temp_dir, "seeders")
        leecher_dir = os.path.join(temp_dir, "leecher")
        os.makedirs(seeder_base_dir)
        os.makedirs(leecher_dir)

        # 1. Start Multiple Libtorrent Seeders
        num_seeders = 10
        max_connections = 5

        piece_length = 16384
        file_size = 50 * 1024 * 1024  # 50MB

        # Create one torrent file shared by all
        dummy_session = LibtorrentSession(seeder_base_dir, port=0)
        torrent_path, info_hash = dummy_session.create_dummy_torrent(
            "test_payload.bin", size=file_size, piece_length=piece_length
        )
        dummy_session.stop()

        seeders = []
        for i in range(num_seeders):
            s_dir = os.path.join(seeder_base_dir, f"s{i}")
            os.makedirs(s_dir)
            # Copy payload to seeder dir
            shutil.copy(
                os.path.join(seeder_base_dir, "test_payload.bin"),
                os.path.join(s_dir, "test_payload.bin")
            )

            session = LibtorrentSession(s_dir, port=0)
            handle = session.add_torrent(torrent_path, s_dir, seed_mode=True)
            seeders.append((session, handle))

        # Wait for seeders to be ready
        print("Waiting for seeders...")
        for session, handle in seeders:
            if not wait_for_seeding(handle):
                print("FAIL: Seeder didn't enter seeding state")
                return False

        # 2. Start JSTEngine with limit
        with test_engine(leecher_dir, maxConnections=max_connections, verbose=True) as engine:
            # Add torrent file
            tid = engine.add_torrent_file(torrent_path)

            # 3. Connect to ALL Libtorrent peers
            print(f"Adding {num_seeders} peers to engine...")
            for session, handle in seeders:
                port = session.listen_port()
                engine.add_peer(tid, "127.0.0.1", port)

            # 4. Verify Connections
            max_seen = 0
            start_time = time.time()
            while time.time() - start_time < 15:
                status = engine.get_torrent_status(tid)
                peers_connected = status.get("peers", 0)
                print(f"Engine reported peers: {peers_connected}")
                max_seen = max(max_seen, peers_connected)

                if peers_connected > max_connections:
                    print(f"FAIL: Connected to {peers_connected} peers, exceeded max {max_connections}")
                    return False

                if status.get("progress", 0) >= 1.0:
                    print("Download complete early")
                    break

                time.sleep(0.5)

            print(f"Max peers seen: {max_seen}")

            if max_seen == 0:
                print("FAIL: Should have connected to some peers")
                return False
            if max_seen > max_connections:
                print(f"FAIL: Max peers seen {max_seen} exceeded limit {max_connections}")
                return False
            if max_seen != max_connections:
                print(f"FAIL: Should have reached limit {max_connections}, got max {max_seen}")
                return False

    print("OK: Global connection limit test passed")
    return True


def test_per_torrent_connection_limit() -> bool:
    """Test that engine respects per-torrent max peer limits."""
    print("\n=== Testing Per-Torrent Connection Limit ===")

    with temp_directory() as temp_dir:
        seeder_base_dir = os.path.join(temp_dir, "seeders_pt")
        leecher_dir = os.path.join(temp_dir, "leecher_pt")
        os.makedirs(seeder_base_dir)
        os.makedirs(leecher_dir)

        # 1. Start Multiple Libtorrent Seeders
        num_seeders = 8
        max_peers = 4

        piece_length = 16384
        file_size = 50 * 1024 * 1024  # 50MB

        dummy_session = LibtorrentSession(seeder_base_dir, port=0)
        torrent_path, info_hash = dummy_session.create_dummy_torrent(
            "test_payload_pt.bin", size=file_size, piece_length=piece_length
        )
        dummy_session.stop()

        seeders = []
        for i in range(num_seeders):
            s_dir = os.path.join(seeder_base_dir, f"s{i}")
            os.makedirs(s_dir)
            shutil.copy(
                os.path.join(seeder_base_dir, "test_payload_pt.bin"),
                os.path.join(s_dir, "test_payload_pt.bin")
            )

            session = LibtorrentSession(s_dir, port=0)
            handle = session.add_torrent(torrent_path, s_dir, seed_mode=True)
            seeders.append((session, handle))

        # Wait for seeders
        for session, handle in seeders:
            if not wait_for_seeding(handle):
                print("FAIL: Seeder didn't enter seeding state")
                return False

        # 2. Start JSTEngine with per-torrent limit
        with test_engine(leecher_dir, maxPeers=max_peers, maxConnections=100, verbose=True) as engine:
            # Add torrent file
            tid = engine.add_torrent_file(torrent_path)

            # 3. Connect to ALL Libtorrent peers
            for session, handle in seeders:
                port = session.listen_port()
                engine.add_peer(tid, "127.0.0.1", port)

            # 4. Verify Connections
            max_seen = 0
            start_time = time.time()
            while time.time() - start_time < 15:
                status = engine.get_torrent_status(tid)
                peers_connected = status.get("peers", 0)
                print(f"Engine reported peers: {peers_connected}")
                max_seen = max(max_seen, peers_connected)

                if peers_connected > max_peers:
                    print(f"FAIL: Connected to {peers_connected} peers, exceeded max {max_peers}")
                    return False

                if status.get("progress", 0) >= 1.0:
                    print("Download complete early")
                    break

                time.sleep(0.5)

            print(f"Max peers seen: {max_seen}")

            if max_seen == 0:
                print("FAIL: Should have connected to some peers")
                return False
            if max_seen > max_peers:
                print(f"FAIL: Max peers seen {max_seen} exceeded limit {max_peers}")
                return False
            if max_seen != max_peers:
                print(f"FAIL: Should have reached limit {max_peers}, got max {max_seen}")
                return False

    print("OK: Per-torrent connection limit test passed")
    return True


def main() -> int:
    if not test_global_connection_limit():
        return fail("Global connection limit test failed")

    if not test_per_torrent_connection_limit():
        return fail("Per-torrent connection limit test failed")

    return passed("All connection limit tests passed")


if __name__ == "__main__":
    sys.exit(main())
