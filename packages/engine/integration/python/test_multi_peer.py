#!/usr/bin/env python3
"""Test download from multiple peers."""
import sys
import os
import shutil
import time
from test_helpers import (
    temp_directory, test_engine, libtorrent_seeder,
    wait_for_seeding, wait_for_complete,
    fail, passed, sha1_file
)
from libtorrent_utils import LibtorrentSession


def main() -> int:
    with temp_directory() as temp_dir:
        leecher_dir = os.path.join(temp_dir, "leecher_multi_peer")
        os.makedirs(leecher_dir)

        # 1. Start 3 Libtorrent Seeders
        seeders = []
        file_size = 10 * 1024 * 1024  # 10MB
        piece_length = 16384  # 16KB pieces -> ~640 pieces

        # Create torrent once
        seeder0_dir = os.path.join(temp_dir, "seeder_0")
        os.makedirs(seeder0_dir)
        lt_session0 = LibtorrentSession(seeder0_dir, port=0)
        torrent_path, info_hash = lt_session0.create_dummy_torrent(
            "multi_peer_payload.bin", size=file_size, piece_length=piece_length
        )

        # Copy torrent and payload to other seeders
        num_seeders = 3
        for i in range(num_seeders):
            dir_path = os.path.join(temp_dir, f"seeder_{i}")
            if i > 0:
                os.makedirs(dir_path)
                # Copy payload
                shutil.copy(
                    os.path.join(seeder0_dir, "multi_peer_payload.bin"),
                    os.path.join(dir_path, "multi_peer_payload.bin")
                )
                # Copy torrent file
                shutil.copy(
                    torrent_path,
                    os.path.join(dir_path, "multi_peer_payload.bin.torrent")
                )

                lt_session = LibtorrentSession(dir_path, port=0)
            else:
                lt_session = lt_session0

            seeders.append(lt_session)

            # Add torrent
            t_path = os.path.join(dir_path, "multi_peer_payload.bin.torrent")
            lt_handle = lt_session.add_torrent(t_path, dir_path, seed_mode=True)

            # Wait for seeding
            if not wait_for_seeding(lt_handle):
                return fail(f"Seeder {i} didn't enter seeding state")
            print(f"Seeder {i} ready on port {lt_session.listen_port()}")

        expected_hash = sha1_file(os.path.join(seeder0_dir, "multi_peer_payload.bin"))

        # 2. Start JSTEngine
        with test_engine(leecher_dir) as engine:
            # Add torrent file
            tid = engine.add_torrent_file(torrent_path)

            # 3. Connect to all Peers
            for lt_session in seeders:
                port = lt_session.listen_port()
                engine.add_peer(tid, "127.0.0.1", port)

            # 4. Wait for Download
            print("Waiting for download to complete...")
            start_time = time.time()

            if not wait_for_complete(engine, tid, timeout=30):
                return fail("Download failed or timed out")

            print(f"Download complete! Time: {time.time() - start_time:.2f}s")

            # Verify hash
            download_path = os.path.join(leecher_dir, "multi_peer_payload.bin")
            actual_hash = sha1_file(download_path)
            if actual_hash != expected_hash:
                return fail(f"Hash mismatch: expected {expected_hash}, got {actual_hash}")

    return passed("Multi-peer download completed")


if __name__ == "__main__":
    sys.exit(main())
