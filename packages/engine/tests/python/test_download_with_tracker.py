#!/usr/bin/env python3
"""Test download with tracker for peer discovery (no manual add_peer)."""
import sys
import subprocess
import time
import os
import re
from contextlib import contextmanager
from test_helpers import (
    test_dirs, test_engine, libtorrent_seeder,
    wait_for_seeding, wait_for,
    fail, passed, sha1_file
)


@contextmanager
def local_tracker():
    """Starts a local bittorrent-tracker and yields its announce URL."""
    # Path to the node script
    script_path = os.path.join(os.path.dirname(__file__), 'run_simple_tracker.ts')

    # We need to set the CWD to packages/engine so it finds node_modules
    cwd = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../'))

    # Use npx tsx to run the typescript file
    process = subprocess.Popen(
        ['npx', 'tsx', script_path],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=cwd,
        text=True,
        bufsize=1
    )

    url = None

    try:
        # Read stdout to find the port
        start_time = time.time()
        while time.time() - start_time < 10:
            line = process.stdout.readline()
            if not line:
                if process.poll() is not None:
                    break
                time.sleep(0.1)
                continue

            print(f"Tracker: {line.strip()}")
            match = re.search(r'TRACKER_PORT=(\d+)', line)
            if match:
                port = int(match.group(1))
                url = f"http://127.0.0.1:{port}/announce"
                break

        if not url:
            raise RuntimeError("Failed to start tracker: Could not get port")

        yield url

    finally:
        process.terminate()
        try:
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            process.kill()


def main() -> int:
    with local_tracker() as tracker_url:
        print(f"Using tracker at: {tracker_url}")

        with test_dirs() as (seeder_dir, leecher_dir):
            with libtorrent_seeder(seeder_dir) as lt_session:
                file_size = 1024 * 512  # 512KB
                torrent_path, info_hash = lt_session.create_dummy_torrent(
                    "test_tracker_payload.bin",
                    size=file_size,
                    piece_length=16384,
                    tracker_url=tracker_url
                )

                # Calculate expected hash
                source_file = os.path.join(seeder_dir, "test_tracker_payload.bin")
                expected_hash = sha1_file(source_file)

                # Add to libtorrent as seeder
                lt_handle = lt_session.add_torrent(torrent_path, seeder_dir, seed_mode=True)

                # Wait for libtorrent to be ready and announce to tracker
                print("Waiting for Libtorrent seeder to be ready...")
                if not wait_for_seeding(lt_handle):
                    return fail("Libtorrent didn't enter seeding state")
                print(f"Libtorrent seeder is ready on port {lt_session.listen_port()}")

                # Give it a moment to announce
                time.sleep(2)

                with test_engine(leecher_dir) as engine:
                    # Add torrent file
                    tid = engine.add_torrent_file(torrent_path)

                    # We do NOT manually add peer here. We expect discovery via tracker.

                    # Wait for Download
                    print("Waiting for download to complete...")
                    iteration = [0]

                    def check_progress():
                        status = engine.get_torrent_status(tid)
                        progress = status.get("progress", 0)
                        peers = status.get("numPeers", 0)

                        iteration[0] += 1
                        if iteration[0] % 5 == 0:
                            print(f"Progress: {progress * 100:.1f}%, Peers: {peers}")

                        return progress >= 1.0

                    if not wait_for(check_progress, timeout=30, interval=0.5, description="download"):
                        download_path = os.path.join(leecher_dir, "test_tracker_payload.bin")
                        if os.path.exists(download_path):
                            print(f"Final: Size {os.path.getsize(download_path)}/{file_size}")
                            print(f"Final: Hash {sha1_file(download_path)} vs {expected_hash}")
                        else:
                            print("Final: File not found")
                        print("Engine Status:", engine.get_torrent_status(tid))
                        return fail("Download failed or timed out")

                    # Verify hash
                    download_path = os.path.join(leecher_dir, "test_tracker_payload.bin")
                    actual_hash = sha1_file(download_path)
                    if actual_hash != expected_hash:
                        return fail(f"Hash mismatch: expected {expected_hash}, got {actual_hash}")

    return passed("Tracker-based download completed")


if __name__ == "__main__":
    sys.exit(main())
