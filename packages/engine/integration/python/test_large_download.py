#!/usr/bin/env python3
"""Test large file download (100MB)."""
import sys
import os
import time
from test_helpers import (
    test_dirs, test_engine, libtorrent_seeder,
    wait_for_seeding, wait_for,
    fail, passed, sha1_file
)


def main() -> int:
    with test_dirs() as (seeder_dir, leecher_dir):
        with libtorrent_seeder(seeder_dir) as lt_session:
            file_size = 100 * 1024 * 1024  # 100MB
            piece_length = 256 * 1024  # 256KB pieces

            print(f"Generating {file_size} bytes dummy file...")
            torrent_path, info_hash = lt_session.create_dummy_torrent(
                "large_payload.bin", size=file_size, piece_length=piece_length
            )

            print("Calculating expected hash...")
            source_file = os.path.join(seeder_dir, "large_payload.bin")
            expected_hash = sha1_file(source_file)

            # Add to libtorrent as seeder
            lt_handle = lt_session.add_torrent(torrent_path, seeder_dir, seed_mode=True)

            # Wait for libtorrent to be ready
            print("Waiting for Libtorrent seeder to be ready...")
            if not wait_for_seeding(lt_handle):
                return fail("Libtorrent didn't enter seeding state")
            print("Libtorrent seeder is ready.")

            port = lt_session.listen_port()

            with test_engine(leecher_dir) as engine:
                # Add torrent file
                tid = engine.add_torrent_file(torrent_path)

                # Connect to peer
                engine.add_peer(tid, "127.0.0.1", port)

                # Wait for Download (longer timeout for 100MB)
                print("Waiting for download to complete...")
                start_time = time.time()
                iteration = [0]  # Use list to allow mutation in closure

                def check_progress():
                    status = engine.get_torrent_status(tid)
                    progress = status.get("progress", 0)
                    peers = status.get("peers", 0)

                    iteration[0] += 1
                    if iteration[0] % 10 == 0:
                        print(f"Progress: {progress * 100:.1f}%, Peers: {peers}")
                        download_path = os.path.join(leecher_dir, "large_payload.bin")
                        if os.path.exists(download_path):
                            current_size = os.path.getsize(download_path)
                            print(f"File size: {current_size / (1024*1024):.2f} MB / {file_size / (1024*1024):.2f} MB")

                    return progress >= 1.0

                if not wait_for(check_progress, timeout=60, interval=0.5, description="download"):
                    return fail("Download failed or timed out")

                print(f"Download complete! Time: {time.time() - start_time:.2f}s")

                # Verify hash
                download_path = os.path.join(leecher_dir, "large_payload.bin")
                print("Verifying hash...")
                actual_hash = sha1_file(download_path)
                if actual_hash != expected_hash:
                    return fail(f"Hash mismatch: expected {expected_hash}, got {actual_hash}")

    return passed("Large download completed")


if __name__ == "__main__":
    sys.exit(main())
