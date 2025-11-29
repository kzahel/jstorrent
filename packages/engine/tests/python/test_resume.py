#!/usr/bin/env python3
"""Test session resume after engine restart."""
import sys
import os
import time
from test_helpers import (
    test_dirs, test_engine, libtorrent_seeder,
    wait_for_seeding, wait_for_progress, wait_for_complete,
    fail, passed, sha1_file
)


def main() -> int:
    with test_dirs() as (seeder_dir, leecher_dir):
        with libtorrent_seeder(seeder_dir) as lt:
            file_size = 10 * 1024 * 1024  # 10MB
            piece_length = 16384  # 16KB pieces

            torrent_path, info_hash = lt.create_dummy_torrent(
                "resume_payload.bin", size=file_size, piece_length=piece_length
            )

            # Add to libtorrent as seeder
            lt_handle = lt.add_torrent(torrent_path, seeder_dir, seed_mode=True)

            # Wait for seeding
            if not wait_for_seeding(lt_handle):
                return fail("Libtorrent didn't enter seeding state")

            expected_hash = sha1_file(os.path.join(seeder_dir, "resume_payload.bin"))
            port = lt.listen_port()

            # Run 1: Download partially
            print("\n--- Run 1: Partial download ---")
            with test_engine(leecher_dir) as engine:
                tid = engine.add_torrent_file(torrent_path)
                engine.add_peer(tid, "127.0.0.1", port)

                if not wait_for_progress(engine, tid, 0.1, timeout=30):
                    return fail("Didn't reach 10%")

                # Wait a bit to ensure persistence (debounce/async write)
                time.sleep(2)
                print("Stopping engine (simulating crash/shutdown)...")

            print("Resume data saved.")

            # Run 2: Resume and complete
            print("\n--- Run 2: Resume ---")
            with test_engine(leecher_dir) as engine:
                tid = engine.add_torrent_file(torrent_path)
                engine.add_peer(tid, "127.0.0.1", port)

                if not wait_for_complete(engine, tid, timeout=30):
                    return fail("Didn't complete after resume")

                actual = sha1_file(os.path.join(leecher_dir, "resume_payload.bin"))
                if actual != expected_hash:
                    return fail(f"Hash mismatch: expected {expected_hash}, got {actual}")

    return passed("Resume test completed")


if __name__ == "__main__":
    sys.exit(main())
