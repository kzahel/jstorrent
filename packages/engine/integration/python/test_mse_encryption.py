#!/usr/bin/env python3
"""
Test MSE/PE (Protocol Encryption) between jstorrent and libtorrent.

Tests:
1. Encrypted download: jstorrent downloads from libtorrent peer requiring encryption
2. Rejection test: Plain connection rejected when peer requires encryption

NOTE: These tests validate MSE/PE integration. Test 1 requires the jstorrent
engine to send MSE encrypted handshakes when encryptionPolicy='prefer'.
If test 1 fails with "incoming regular connections disabled" from libtorrent,
it indicates jstorrent is sending plain BT handshakes instead of MSE handshakes.
"""
import sys
import os
import time
from test_helpers import (
    test_dirs, test_engine,
    wait_for_seeding, wait_for_complete,
    fail, passed, sha1_file
)
from libtorrent_utils import EncryptedLibtorrentSession


def run_encrypted_download_test() -> bool:
    """Test downloading from libtorrent with encryption required."""
    print("\n" + "=" * 50)
    print("Testing MSE/PE encrypted download")
    print("=" * 50)

    with test_dirs() as (seeder_dir, leecher_dir):
        # Create encrypted libtorrent seeder (requires encryption)
        lt_session = EncryptedLibtorrentSession(seeder_dir, port=41000)

        file_size = 256 * 1024  # 256KB
        torrent_path, info_hash = lt_session.create_dummy_torrent(
            "encrypted_test.bin",
            size=file_size,
            piece_length=16384
        )

        # Calculate expected hash
        source_file = os.path.join(seeder_dir, "encrypted_test.bin")
        expected_hash = sha1_file(source_file)

        # Add to libtorrent as seeder
        lt_handle = lt_session.add_torrent(torrent_path, seeder_dir, seed_mode=True)

        # Wait for seeding
        print("Waiting for encrypted Libtorrent seeder...")
        for _ in range(30):
            lt_session.print_alerts()
            if lt_handle.status().is_seeding:
                break
            time.sleep(0.5)

        if not lt_handle.status().is_seeding:
            print("FAIL: Libtorrent didn't start seeding")
            return False

        actual_port = lt_session.listen_port()
        print(f"Libtorrent seeding on port {actual_port}")

        # Start jstorrent engine with encryption PREFERRED
        # (will negotiate encryption with peer)
        with test_engine(leecher_dir, encryptionPolicy='prefer') as engine:
            tid = engine.add_torrent_file(torrent_path)
            engine.add_peer(tid, "127.0.0.1", actual_port)

            print("Waiting for encrypted download...")
            # Allow extra time for MSE handshake
            if not wait_for_complete(engine, tid, timeout=60):
                lt_session.print_alerts()
                download_path = os.path.join(leecher_dir, "encrypted_test.bin")
                if os.path.exists(download_path):
                    print(f"Final check: Size {os.path.getsize(download_path)}/{file_size}")
                    print(f"Final check: Hash {sha1_file(download_path)} vs {expected_hash}")
                else:
                    print("Final check: File not found")
                print("FAIL: Download incomplete")
                return False

            # Verify hash
            download_path = os.path.join(leecher_dir, "encrypted_test.bin")
            actual_hash = sha1_file(download_path)
            if actual_hash != expected_hash:
                print(f"FAIL: Hash mismatch: expected {expected_hash}, got {actual_hash}")
                return False

            print(f"Download complete. Hash verified: {actual_hash[:16]}...")

    return True


def run_encryption_required_rejection_test() -> bool:
    """Test that plain connection is rejected when encryption required."""
    print("\n" + "=" * 50)
    print("Testing encryption required rejection")
    print("=" * 50)

    with test_dirs() as (seeder_dir, leecher_dir):
        # Create encrypted libtorrent seeder (requires encryption)
        lt_session = EncryptedLibtorrentSession(seeder_dir, port=41001)

        torrent_path, info_hash = lt_session.create_dummy_torrent(
            "reject_test.bin",
            size=64 * 1024  # 64KB
        )

        lt_handle = lt_session.add_torrent(torrent_path, seeder_dir, seed_mode=True)

        # Wait for seeding
        for _ in range(20):
            if lt_handle.status().is_seeding:
                break
            time.sleep(0.5)

        if not lt_handle.status().is_seeding:
            print("FAIL: Libtorrent didn't start seeding")
            return False

        actual_port = lt_session.listen_port()
        print(f"Libtorrent seeding (encryption required) on port {actual_port}")

        # Start jstorrent with encryption DISABLED
        # Connection should fail since peer requires encryption
        with test_engine(leecher_dir, encryptionPolicy='disabled') as engine:
            tid = engine.add_torrent_file(torrent_path)
            engine.add_peer(tid, "127.0.0.1", actual_port)

            # Wait a bit - should NOT download
            print("Waiting 5 seconds (should NOT download)...")
            time.sleep(5)

            # Check that we didn't download anything
            status = engine.get_torrent_status(tid)
            progress = status.get("progress", 0)
            print(f"Progress after 5s: {progress * 100:.1f}%")

            if progress > 0:
                print("FAIL: Downloaded data without encryption when it should be rejected")
                return False

            print("Connection correctly rejected (no data transferred)")

    return True


def main() -> int:
    tests = [
        ("Encrypted download", run_encrypted_download_test),
        ("Encryption rejection", run_encryption_required_rejection_test),
    ]

    for name, test_fn in tests:
        try:
            if not test_fn():
                return fail(f"{name} test failed")
            print(f"\n✓ {name} test passed")
        except Exception as e:
            import traceback
            traceback.print_exc()
            return fail(f"{name} raised {e}")

    return passed("All MSE/PE encryption tests passed")


if __name__ == "__main__":
    sys.exit(main())
