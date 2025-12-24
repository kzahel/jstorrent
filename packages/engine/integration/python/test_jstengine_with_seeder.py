#!/usr/bin/env python3
"""
Test JSTEngine downloading from the standalone libtorrent_seed_for_test.py seeder.

Usage:
    # First, start the seeder in another terminal:
    uv run python libtorrent_seed_for_test.py --size 100mb

    # Then run this test:
    uv run python test_jstengine_with_seeder.py
"""
import os
import sys
import tempfile
from pathlib import Path

from test_helpers import test_engine, wait_for_complete, sha1_file, fail, passed

# Known v1 infohash from the deterministic seeder (not truncated v2 hash!)
INFOHASH_100MB = "67d01ece1b99c49c257baada0f760b770a7530b9"
SEEDER_PORT = 6881
DATA_DIR = Path.home() / ".jstorrent-test-seed"


def main() -> int:
    size = sys.argv[1] if len(sys.argv) > 1 else "100mb"

    if size == "100mb":
        filename = "testdata_100mb.bin"
        expected_size = 100 * 1024 * 1024
    else:
        filename = "testdata_1gb.bin"
        expected_size = 1024 * 1024 * 1024

    torrent_path = DATA_DIR / f"{filename}.torrent"
    source_file = DATA_DIR / filename

    if not torrent_path.exists():
        return fail(f"Torrent file not found: {torrent_path}\n"
                   f"Run the seeder first: uv run python libtorrent_seed_for_test.py --size {size}")

    if not source_file.exists():
        return fail(f"Source file not found: {source_file}")

    # Calculate expected hash from source
    print(f"Calculating expected hash from {source_file}...")
    expected_hash = sha1_file(str(source_file))
    print(f"Expected SHA1: {expected_hash}")

    # Create temp directory for download
    with tempfile.TemporaryDirectory(prefix="jst_seeder_test_") as download_dir:
        print(f"Download directory: {download_dir}")

        with test_engine(download_dir) as engine:
            print(f"JSTEngine started on port {engine.rpc_port}, BT port {engine.bt_port}")

            # Add torrent file
            print(f"Adding torrent: {torrent_path}")
            tid = engine.add_torrent_file(str(torrent_path))
            print(f"Torrent ID: {tid}")

            # Get initial status
            status = engine.get_torrent_status(tid)
            print(f"Initial status: {status.get('state')} ({status.get('progress', 0) * 100:.1f}%)")

            # Add peer hint to the seeder
            print(f"Adding peer: 127.0.0.1:{SEEDER_PORT}")
            engine.add_peer(tid, "127.0.0.1", SEEDER_PORT)

            # Wait for download
            print("Waiting for download...")
            timeout = 120 if size == "1gb" else 60

            if not wait_for_complete(engine, tid, timeout=timeout):
                status = engine.get_torrent_status(tid)
                print(f"Final status: {status}")

                # Check peer info
                try:
                    peers = engine.get_peer_info(tid)
                    print(f"Peers: {peers}")
                except Exception as e:
                    print(f"Could not get peer info: {e}")

                return fail("Download incomplete")

            # Verify file
            download_path = os.path.join(download_dir, filename)
            if not os.path.exists(download_path):
                return fail(f"Downloaded file not found: {download_path}")

            actual_size = os.path.getsize(download_path)
            if actual_size != expected_size:
                return fail(f"Size mismatch: expected {expected_size}, got {actual_size}")

            actual_hash = sha1_file(download_path)
            if actual_hash != expected_hash:
                return fail(f"Hash mismatch:\n  Expected: {expected_hash}\n  Actual:   {actual_hash}")

            print(f"Downloaded {actual_size} bytes")
            print(f"SHA1 verified: {actual_hash}")

    return passed("JSTEngine successfully downloaded from standalone seeder!")


if __name__ == "__main__":
    sys.exit(main())
