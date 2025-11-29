#!/usr/bin/env python3
"""Test seeding: JSTEngine seeds content to libtorrent leecher."""
import sys
import os
import shutil
from test_helpers import (
    temp_directory, test_engine, libtorrent_seeder,
    wait_for, fail, passed, sha1_file
)


def main() -> int:
    piece_length = 16384

    with temp_directory() as temp_dir:
        engine_dir = os.path.join(temp_dir, "engine_seeder")
        lt_leecher_dir = os.path.join(temp_dir, "lt_leecher")
        os.makedirs(engine_dir)
        os.makedirs(lt_leecher_dir)

        # 1. Generate Content (using Libtorrent helper)
        # We use a temporary session just to generate the file and torrent
        with libtorrent_seeder(temp_dir, port=0) as gen_session:
            file_size = 1024 * 512  # 512KB
            torrent_path, info_hash = gen_session.create_dummy_torrent(
                "test_payload.bin", size=file_size, piece_length=piece_length
            )

            # Copy the generated payload to the Engine's directory
            source_file = os.path.join(temp_dir, "test_payload.bin")
            engine_file = os.path.join(engine_dir, "test_payload.bin")
            shutil.copy(source_file, engine_file)

            expected_hash = sha1_file(source_file)
            gen_session.stop()

        # 2. Start JSTEngine (Seeder)
        with test_engine(engine_dir) as engine:
            # Add torrent file
            tid = engine.add_torrent_file(torrent_path)

            # Get engine's actual listening port
            engine_port = engine.bt_port
            if not engine_port or engine_port <= 0:
                return fail("Engine port should be assigned")

            # 3. Start Libtorrent (Leecher)
            with libtorrent_seeder(lt_leecher_dir, port=0) as lt_session:
                lt_port = lt_session.listen_port()

                # Add torrent to libtorrent (standard mode, it will check and find nothing)
                lt_handle = lt_session.add_torrent(torrent_path, lt_leecher_dir)

                # 4. Connect Peers
                # Connect Libtorrent to Engine
                print(f"Connecting Libtorrent to Engine at 127.0.0.1:{engine_port}")
                lt_handle.connect_peer(("127.0.0.1", engine_port))

                # Also try reverse connection for robustness
                engine.add_peer(tid, "127.0.0.1", lt_port)

                # 5. Wait for Download
                print("Waiting for Libtorrent to download...")

                def lt_finished():
                    s = lt_handle.status()
                    print(f"LT Status: {s.state}, Progress: {s.progress:.1%}, Peers: {s.num_peers}")
                    return s.is_seeding

                if not wait_for(lt_finished, timeout=30, interval=0.5, description="LT download"):
                    return fail("Libtorrent failed to download from Engine")

                # Verify file integrity
                downloaded_file = os.path.join(lt_leecher_dir, "test_payload.bin")
                if not os.path.exists(downloaded_file):
                    return fail("Downloaded file doesn't exist")

                actual_hash = sha1_file(downloaded_file)
                if actual_hash != expected_hash:
                    return fail(f"Hash mismatch: expected {expected_hash}, got {actual_hash}")

    return passed("Seeding test completed")


if __name__ == "__main__":
    sys.exit(main())
