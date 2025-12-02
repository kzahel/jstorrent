#!/usr/bin/env python3
"""Test multi-file torrent download."""
import sys
import os
import libtorrent as lt
from test_helpers import (
    test_dirs, test_engine, libtorrent_seeder,
    wait_for_seeding, wait_for_complete,
    fail, passed, sha1_file
)


def main() -> int:
    with test_dirs() as (seeder_dir, leecher_dir):
        with libtorrent_seeder(seeder_dir) as lt_session:
            files = [
                ("small.txt", 1024),          # 1KB
                ("medium.bin", 1024 * 512),   # 512KB
                ("large.bin", 1024 * 1024 * 2)  # 2MB
            ]
            piece_length = 16384
            torrent_name = "multi_test"

            torrent_path, info_hash = lt_session.create_multi_file_torrent(
                torrent_name, files, piece_length=piece_length
            )

            # Check files in torrent info
            info = lt.torrent_info(torrent_path)
            print("Torrent Files:")
            for i in range(info.num_files()):
                f = info.files().at(i)
                print(f"  {i}: {f.path} ({f.size} bytes)")

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

                # Wait for Download
                print("Waiting for download to complete...")
                if not wait_for_complete(engine, tid, timeout=30):
                    return fail("Download incomplete")

                # Verify all files
                for name, size in files:
                    src_path = os.path.join(seeder_dir, torrent_name, name)
                    dst_path = os.path.join(leecher_dir, torrent_name, name)

                    if not os.path.exists(dst_path):
                        return fail(f"File not found: {dst_path}")

                    if os.path.getsize(dst_path) != size:
                        return fail(f"Size mismatch for {name}")

                    if sha1_file(src_path) != sha1_file(dst_path):
                        return fail(f"Hash mismatch for {name}")

    return passed("Multi-file download completed")


if __name__ == "__main__":
    sys.exit(main())
