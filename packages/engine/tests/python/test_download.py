#!/usr/bin/env python3
"""Test download with various piece sizes."""
import sys
import os
from test_helpers import (
    test_dirs, test_engine, libtorrent_seeder,
    wait_for_seeding, wait_for_complete,
    fail, passed, sha1_file
)


def run_download_test(piece_length: int) -> bool:
    """Run download test with specific piece length. Returns True if passed."""
    print(f"\n{'='*50}")
    print(f"Testing piece_length = {piece_length}")
    print('='*50)

    with test_dirs() as (seeder_dir, leecher_dir):
        with libtorrent_seeder(seeder_dir) as lt:
            file_size = 1024 * 512  # 512KB
            torrent_path, info_hash = lt.create_dummy_torrent(
                "test_payload.bin", size=file_size, piece_length=piece_length
            )

            # Calculate expected hash
            source_file = os.path.join(seeder_dir, "test_payload.bin")
            expected_hash = sha1_file(source_file)

            # Add to libtorrent as seeder
            lt_handle = lt.add_torrent(torrent_path, seeder_dir, seed_mode=True)

            # Wait for libtorrent to be ready
            print("Waiting for Libtorrent seeder to be ready...")
            if not wait_for_seeding(lt_handle):
                print("FAIL: Libtorrent didn't seed")
                return False
            print("Libtorrent seeder is ready.")

            port = lt.listen_port()

            with test_engine(leecher_dir) as engine:
                # Add torrent file
                tid = engine.add_torrent_file(torrent_path)

                # Connect to peer
                engine.add_peer(tid, "127.0.0.1", port)

                # Wait for Download
                print("Waiting for download to complete...")
                if not wait_for_complete(engine, tid, timeout=30):
                    download_path = os.path.join(leecher_dir, "test_payload.bin")
                    if os.path.exists(download_path):
                        print(f"Final check: Size {os.path.getsize(download_path)}/{file_size}")
                        print(f"Final check: Hash {sha1_file(download_path)} vs {expected_hash}")
                    else:
                        print("Final check: File not found")
                    print("FAIL: Download incomplete")
                    return False

                # Verify hash
                download_path = os.path.join(leecher_dir, "test_payload.bin")
                actual_hash = sha1_file(download_path)
                if actual_hash != expected_hash:
                    print(f"FAIL: Hash mismatch - expected {expected_hash}, got {actual_hash}")
                    return False

    print(f"OK: piece_length={piece_length}")
    return True


def main() -> int:
    piece_lengths = [16384, 32768, 65536]

    # Allow command-line override
    if len(sys.argv) > 1:
        piece_lengths = [int(sys.argv[1])]

    for pl in piece_lengths:
        if not run_download_test(pl):
            return fail(f"Failed with piece_length={pl}")

    return passed(f"All piece lengths passed: {piece_lengths}")


if __name__ == "__main__":
    sys.exit(main())
