#!/usr/bin/env python3
"""Test BitTorrent handshake between JSTEngine and libtorrent."""
import sys
from test_helpers import (
    test_dirs, test_engine, libtorrent_seeder,
    wait_for_seeding, wait_for, fail, passed
)


def main() -> int:
    with test_dirs() as (seeder_dir, leecher_dir):
        with libtorrent_seeder(seeder_dir) as lt:
            # Create test torrent
            piece_length = 16384
            file_size = 1024 * 1024 * 10  # 10MB
            torrent_path, info_hash = lt.create_dummy_torrent(
                "test_payload.bin", size=file_size, piece_length=piece_length
            )

            # Add to libtorrent as seeder
            lt_handle = lt.add_torrent(torrent_path, seeder_dir, seed_mode=True)

            # Wait for libtorrent to be ready
            print("Waiting for Libtorrent seeder to be ready...")
            if not wait_for_seeding(lt_handle):
                return fail("Libtorrent didn't enter seeding state")
            print("Libtorrent seeder is ready.")

            port = lt.listen_port()

            with test_engine(leecher_dir) as engine:
                # Add torrent file
                tid = engine.add_torrent_file(torrent_path)

                # Connect to Libtorrent peer
                engine.add_peer(tid, "127.0.0.1", port)

                # Verify Handshake - poll for connection
                def both_connected():
                    status = engine.get_torrent_status(tid)
                    engine_connected = status.get("peers", 0) > 0
                    s = lt_handle.status()
                    lt_saw_peer = s.num_peers > 0
                    print(f"LT Peers: {s.num_peers}, Engine peers: {status.get('peers', 0)}")
                    return engine_connected and lt_saw_peer

                if not wait_for(both_connected, timeout=10, description="handshake"):
                    return fail("Handshake failed: Engine or Libtorrent did not see the peer")

    return passed("Handshake successful")


if __name__ == "__main__":
    sys.exit(main())
