#!/usr/bin/env python3
"""Test piece recheck after corruption."""
import sys
import os
import time
from test_helpers import (
    test_dirs, test_engine, libtorrent_seeder,
    wait_for_seeding, wait_for_complete,
    fail, passed
)


def main() -> int:
    with test_dirs() as (seeder_dir, leecher_dir):
        with libtorrent_seeder(seeder_dir) as lt_session:
            file_size = 10 * 1024 * 1024  # 10MB
            piece_length = 16384  # 16KB pieces

            torrent_path, info_hash = lt_session.create_dummy_torrent(
                "recheck_payload.bin", size=file_size, piece_length=piece_length
            )

            # Add to libtorrent as seeder
            lt_handle = lt_session.add_torrent(torrent_path, seeder_dir, seed_mode=True)

            # Wait for seeding
            if not wait_for_seeding(lt_handle):
                return fail("Libtorrent didn't enter seeding state")

            port = lt_session.listen_port()

            with test_engine(leecher_dir) as engine:
                # Add torrent file
                tid = engine.add_torrent_file(torrent_path)

                # Connect to Peer
                engine.add_peer(tid, "127.0.0.1", port)

                # Wait for full download
                print("Waiting for download...")
                if not wait_for_complete(engine, tid, timeout=30):
                    return fail("Download failed")

                time.sleep(2)  # Wait for persistence

                # Corrupt a piece
                download_path = os.path.join(leecher_dir, "recheck_payload.bin")
                with open(download_path, "r+b") as f:
                    f.seek(0)
                    f.write(b"\x00" * 100)  # Overwrite first 100 bytes

                # Remove torrent from seeder to prevent re-download after recheck
                lt_session.remove_torrent(lt_handle)

                # Trigger recheck
                engine.recheck(tid)

                # Check progress immediately - recheck is synchronous
                status = engine.get_torrent_status(tid)
                progress = status.get("progress", 0)

                # Progress should be slightly less than 100% now (piece 0 is corrupted)
                if progress >= 1.0:
                    return fail("Piece 0 should be missing after corruption and recheck")

    return passed("Recheck test completed")


if __name__ == "__main__":
    sys.exit(main())
