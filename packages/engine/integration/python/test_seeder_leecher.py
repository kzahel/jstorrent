#!/usr/bin/env python3
"""
Self-contained test: creates a seeder and leecher, transfers data, verifies.
Use this to understand the working pattern before fixing seed_for_test.
"""
import hashlib
import os
import sys
import tempfile
import time

import libtorrent as lt
import numpy as np

from libtorrent_utils import get_v1_info_hash

# Same seed as libtorrent_seed_for_test.py
DETERMINISTIC_SEED = 0xDEADBEEF


def generate_deterministic_data(path: str, size: int) -> str:
    """Generate deterministic data and return its SHA1 hash."""
    rng = np.random.default_rng(DETERMINISTIC_SEED)
    chunk_size = 1024 * 1024  # 1MB
    hasher = hashlib.sha1()

    with open(path, "wb") as f:
        remaining = size
        while remaining > 0:
            chunk_len = min(chunk_size, remaining)
            chunk = rng.integers(0, 256, size=chunk_len, dtype=np.uint8)
            data = chunk.tobytes()
            f.write(data)
            hasher.update(data)
            remaining -= chunk_len

    return hasher.hexdigest()


def create_session(port: int, peer_id_suffix: str = "A") -> lt.session:
    """Create a libtorrent session with encryption support and unique peer ID."""
    # Generate unique peer ID: -LT2.0B0- followed by suffix
    peer_id = f"-LT20B0-{peer_id_suffix}".ljust(20, "0")[:20]

    settings = {
        "listen_interfaces": f"127.0.0.1:{port}",
        "enable_dht": False,
        "enable_lsd": False,
        "enable_upnp": False,
        "enable_natpmp": False,
        # pe_enabled (1) accepts both plaintext and encrypted connections
        "in_enc_policy": 1,
        "out_enc_policy": 1,
        "allowed_enc_level": 3,  # both plaintext and rc4
        "prefer_rc4": False,
        "enable_incoming_utp": False,
        "enable_outgoing_utp": False,
        "user_agent": "test_session",
        "alert_mask": lt.alert.category_t.all_categories,
        "allow_multiple_connections_per_ip": True,
        "peer_fingerprint": peer_id,
    }

    params = lt.session_params()
    params.settings = settings
    session = lt.session(params)
    session.apply_settings(settings)

    return session


def main() -> int:
    size = 5 * 1024 * 1024  # 5MB test file
    piece_size = 256 * 1024  # 256KB pieces

    with tempfile.TemporaryDirectory() as tmpdir:
        seeder_dir = os.path.join(tmpdir, "seeder")
        leecher_dir = os.path.join(tmpdir, "leecher")
        os.makedirs(seeder_dir)
        os.makedirs(leecher_dir)

        # Generate deterministic data
        print(f"Generating {size // (1024*1024)}MB deterministic data...")
        data_path = os.path.join(seeder_dir, "testdata.bin")
        expected_hash = generate_deterministic_data(data_path, size)
        print(f"  SHA1: {expected_hash}")

        # Create torrent
        print("Creating torrent...")
        fs = lt.file_storage()
        lt.add_files(fs, data_path)
        t = lt.create_torrent(fs, piece_size=piece_size)
        t.set_creator("test_seeder_leecher")
        lt.set_piece_hashes(t, seeder_dir)

        torrent_data = t.generate()
        torrent_info = lt.torrent_info(torrent_data)
        info_hash = get_v1_info_hash(torrent_info)
        print(f"  Infohash: {info_hash}")

        # Create sessions
        print("Creating sessions...")
        seeder_port = 50001
        leecher_port = 50002

        seeder_session = create_session(seeder_port, "SEEDER123456")
        leecher_session = create_session(leecher_port, "LEECHER12345")

        print(f"  Seeder listening on {seeder_session.listen_port()}")
        print(f"  Leecher listening on {leecher_session.listen_port()}")

        # Add torrent to seeder in seed mode
        print("Adding torrent to seeder...")
        seeder_params = lt.add_torrent_params()
        seeder_params.ti = torrent_info
        seeder_params.save_path = seeder_dir
        seeder_params.flags = lt.torrent_flags.seed_mode
        seeder_params.flags &= ~lt.torrent_flags.auto_managed

        seeder_handle = seeder_session.add_torrent(seeder_params)
        seeder_handle.resume()
        seeder_handle.force_recheck()

        # Wait for seeder to be ready
        print("Waiting for seeder to verify data...")
        for _ in range(100):
            if seeder_handle.status().is_seeding:
                print("  Seeder ready!")
                break
            time.sleep(0.1)
        else:
            print("ERROR: Seeder failed to reach seeding state")
            return 1

        # Add torrent to leecher
        print("Adding torrent to leecher...")
        leecher_params = lt.add_torrent_params()
        leecher_params.ti = torrent_info
        leecher_params.save_path = leecher_dir
        leecher_params.flags &= ~lt.torrent_flags.auto_managed

        leecher_handle = leecher_session.add_torrent(leecher_params)
        leecher_handle.resume()

        # Connect peers bidirectionally
        print("Connecting peers...")
        leecher_handle.connect_peer(("127.0.0.1", seeder_port))
        seeder_handle.connect_peer(("127.0.0.1", leecher_port))

        # Poll for completion
        print("Downloading...")
        start_time = time.time()
        timeout = 30

        while time.time() - start_time < timeout:
            seeder_status = seeder_handle.status()
            leecher_status = leecher_handle.status()

            print(
                f"\r  Progress: {leecher_status.progress * 100:.1f}%, "
                f"Peers: {leecher_status.num_peers}, "
                f"Download: {leecher_status.download_rate / 1024:.1f} KB/s",
                end="",
                flush=True,
            )

            if leecher_status.is_seeding:
                print()
                break

            # Pop alerts
            for alert in seeder_session.pop_alerts():
                if "error" in alert.message().lower():
                    print(f"\n  SEEDER ALERT: {alert.message()}")
            for alert in leecher_session.pop_alerts():
                if "error" in alert.message().lower():
                    print(f"\n  LEECHER ALERT: {alert.message()}")

            time.sleep(0.5)
        else:
            print()
            print("ERROR: Download timed out")
            return 1

        # Verify downloaded file
        print("Verifying downloaded file...")
        downloaded_path = os.path.join(leecher_dir, "testdata.bin")

        if not os.path.exists(downloaded_path):
            print(f"ERROR: Downloaded file not found at {downloaded_path}")
            return 1

        with open(downloaded_path, "rb") as f:
            actual_hash = hashlib.sha1(f.read()).hexdigest()

        if actual_hash != expected_hash:
            print(f"ERROR: Hash mismatch!")
            print(f"  Expected: {expected_hash}")
            print(f"  Actual:   {actual_hash}")
            return 1

        elapsed = time.time() - start_time
        speed = size / elapsed / 1024 / 1024

        print()
        print("=" * 60)
        print("SUCCESS!")
        print(f"  Downloaded {size // (1024*1024)}MB in {elapsed:.1f}s ({speed:.1f} MB/s)")
        print(f"  Hash verified: {expected_hash}")
        print("=" * 60)

        return 0


if __name__ == "__main__":
    sys.exit(main())
