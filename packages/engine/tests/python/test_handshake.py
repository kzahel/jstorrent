import pytest
import os
import time
import shutil
from harness.engine_rpc import EngineRPC
from harness.libtorrent_utils import LibtorrentSession

@pytest.fixture
def temp_dir(tmp_path):
    return str(tmp_path)

def test_handshake(temp_dir):
    # Setup directories
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

    # 2. Start TS Engine
    engine = EngineRPC()
    engine.start()

    try:
        # Init engine
        resp = engine.send_command("init", {
            "listen_port": 0, # Let OS pick port
            "download_dir": leecher_dir
        })
        assert resp["ok"]

        # Add torrent
        resp = engine.send_command("add_torrent_file", {
            "path": torrent_path,
            "info_hash": info_hash,
            "piece_length": piece_length,
            "total_length": file_size
        })
        assert resp["ok"]
        engine_port = resp["port"]

        # 3. Connect Peers
        # Try connecting from TS Engine to Libtorrent (since we added add_peer)
        # This might avoid the encryption issue if Libtorrent accepts plaintext incoming.
        resp = engine.send_command("add_peer", {
            "info_hash": info_hash,
            "ip": "127.0.0.1",
            "port": 50001
        })
        
        # Also try connecting from Libtorrent to TS Engine as backup/dual check
        # lt_handle.connect_peer(("127.0.0.1", engine_port))

        # 4. Verify Handshake
        # Poll for connection
        connected = False
        lt_saw_peer = False
        
        for _ in range(20):
            # Check TS engine status
            resp = engine.send_command("get_status")
            assert resp["ok"]
            torrents = resp["torrents"]
            
            engine_connected = False
            if info_hash in torrents:
                if torrents[info_hash]["num_connected"] > 0:
                    engine_connected = True

            # Check libtorrent status
            s = lt_handle.status()
            if s.num_peers > 0:
                lt_saw_peer = True
                
            print(f"LT Peers: {s.num_peers}, Connect Candidates: {s.connect_candidates}")
            print(f"Engine Connected: {torrents[info_hash]['num_connected'] if info_hash in torrents else 0}")

            if engine_connected and lt_saw_peer:
                connected = True
                break

            time.sleep(0.5)

        assert connected, "Handshake failed: Engine or Libtorrent did not see the peer"

    finally:
        engine.stop()
        lt_session.stop()
