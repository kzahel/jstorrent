import pytest
import os
import time
from libtorrent_utils import LibtorrentSession


def test_handshake(tmp_path, engine_factory):
    # Setup directories
    temp_dir = str(tmp_path)
    seeder_dir = os.path.join(temp_dir, "seeder")
    leecher_dir = os.path.join(temp_dir, "leecher")
    os.makedirs(seeder_dir)
    os.makedirs(leecher_dir)

    # 1. Start Libtorrent Seeder
    piece_length = 16384
    file_size = 1024 * 1024 * 10 # 10MB
    lt_session = LibtorrentSession(seeder_dir, port=50001)
    torrent_path, info_hash = lt_session.create_dummy_torrent("test_payload.bin", size=file_size, piece_length=piece_length)

    # Add to libtorrent as seeder
    lt_handle = lt_session.add_torrent(torrent_path, seeder_dir, seed_mode=True)

    # Wait for libtorrent to be ready (checking state)
    print("Waiting for Libtorrent seeder to be ready...")
    for _ in range(50):
        s = lt_handle.status()
        if s.is_seeding:
            print("Libtorrent seeder is ready.")
            break
        time.sleep(0.1)
    assert lt_handle.status().is_seeding

    # 2. Start JSTEngine
    engine = engine_factory(download_dir=leecher_dir)

    # Add torrent file
    tid = engine.add_torrent_file(torrent_path)

    # 3. Connect to Libtorrent peer
    engine.add_peer(tid, "127.0.0.1", 50001)

    # 4. Verify Handshake
    # Poll for connection
    connected = False
    lt_saw_peer = False
    
    for _ in range(20):
        # Check JSTEngine torrent status
        status = engine.get_torrent_status(tid)
        engine_connected = status.get("peers", 0) > 0

        # Check libtorrent status
        s = lt_handle.status()
        if s.num_peers > 0:
            lt_saw_peer = True
            
        print(f"LT Peers: {s.num_peers}, Connect Candidates: {s.connect_candidates}")
        print(f"Engine peers: {status.get('peers', 0)}")

        if engine_connected and lt_saw_peer:
            connected = True
            break

        time.sleep(0.5)

    assert connected, "Handshake failed: Engine or Libtorrent did not see the peer"
