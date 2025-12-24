#!/usr/bin/env python3
"""
Test script to download from the running libtorrent_seed_for_test.py seeder.
Run this while the seeder is running to verify it works.
"""
import libtorrent as lt
import os
import sys
import time
import tempfile
from pathlib import Path

# The known v1 infohash from the seeder (not the truncated v2 hash!)
INFOHASH_1GB = "18a7aacab6d2bc518e336921ccd4b6cc32a9624b"
INFOHASH_100MB = "67d01ece1b99c49c257baada0f760b770a7530b9"

SEEDER_PORT = 6881


def create_leecher_session(port: int = 0) -> lt.session:
    """Create a libtorrent session for leeching."""
    settings = {
        "listen_interfaces": f"0.0.0.0:{port}",
        "enable_dht": False,
        "enable_lsd": False,
        "enable_upnp": False,
        "enable_natpmp": False,
        # pe_enabled (1) allows both plaintext and encrypted
        "in_enc_policy": 1,
        "out_enc_policy": 1,
        "allowed_enc_level": 3,  # both (1=plaintext, 2=rc4, 3=both)
        "prefer_rc4": False,
        "enable_incoming_utp": False,
        "enable_outgoing_utp": False,
        "user_agent": "test_leecher",
        "alert_mask": lt.alert.category_t.all_categories,
        "allow_multiple_connections_per_ip": True,
    }
    params = lt.session_params()
    params.settings = settings
    session = lt.session(params)
    session.apply_settings(settings)
    return session


def main():
    # Determine which size to test
    size = sys.argv[1] if len(sys.argv) > 1 else "100mb"

    if size == "1gb":
        infohash = INFOHASH_1GB
        filename = "testdata_1gb.bin"
    else:
        infohash = INFOHASH_100MB
        filename = "testdata_100mb.bin"

    # Check if torrent file exists
    data_dir = Path.home() / ".jstorrent-test-seed"
    torrent_path = data_dir / f"{filename}.torrent"

    if not torrent_path.exists():
        print(f"ERROR: Torrent file not found: {torrent_path}")
        print("Make sure the seeder has been run at least once to generate the data.")
        return 1

    print(f"Testing download from seeder...")
    print(f"  Infohash: {infohash}")
    print(f"  Torrent: {torrent_path}")
    print(f"  Seeder: 127.0.0.1:{SEEDER_PORT}")
    print()

    # Create temp directory for download
    with tempfile.TemporaryDirectory() as tmpdir:
        print(f"Download directory: {tmpdir}")

        # Create leecher session
        session = create_leecher_session(port=0)
        actual_port = session.listen_port()
        print(f"Leecher listening on port {actual_port}")

        # Add torrent
        params = lt.add_torrent_params()
        params.ti = lt.torrent_info(str(torrent_path))
        params.save_path = tmpdir
        params.flags &= ~lt.torrent_flags.auto_managed

        handle = session.add_torrent(params)
        handle.resume()

        print("Torrent added, connecting to seeder...")

        # Connect to seeder
        handle.connect_peer(("127.0.0.1", SEEDER_PORT))

        # Poll and print status
        start_time = time.time()
        timeout = 60  # 60 second timeout for 100MB
        last_progress = -1

        while time.time() - start_time < timeout:
            status = handle.status()

            # Print alerts
            for alert in session.pop_alerts():
                print(f"  ALERT: {alert.message()}")

            progress = status.progress * 100
            if int(progress) != int(last_progress) or status.num_peers != last_progress:
                print(
                    f"  State: {status.state}, "
                    f"Progress: {progress:.1f}%, "
                    f"Peers: {status.num_peers}, "
                    f"Download: {status.download_rate / 1024:.1f} KB/s"
                )
                last_progress = progress

            if status.is_seeding:
                print()
                print("SUCCESS: Download completed!")
                elapsed = time.time() - start_time
                print(f"  Time: {elapsed:.1f}s")
                return 0

            time.sleep(0.5)

        print()
        print("FAILURE: Download timed out")

        # Print final state
        status = handle.status()
        print(f"  Final state: {status.state}")
        print(f"  Final progress: {status.progress * 100:.1f}%")
        print(f"  Peers connected: {status.num_peers}")

        return 1


if __name__ == "__main__":
    sys.exit(main())
