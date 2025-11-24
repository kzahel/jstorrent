import pytest
import os
import time
import shutil
import hashlib
import json
from harness.libtorrent_utils import LibtorrentSession
from harness.engine_rpc import EngineRPC

def calculate_sha1(file_path):
    sha1 = hashlib.sha1()
    with open(file_path, 'rb') as f:
        while True:
            data = f.read(65536)
            if not data:
                break
            sha1.update(data)
    return sha1.hexdigest()

@pytest.mark.parametrize("piece_length", [16384])
def test_seeding(tmp_path, piece_length):
    # Setup directories
    temp_dir = str(tmp_path)
    engine_dir = os.path.join(temp_dir, "engine_seeder")
    lt_leecher_dir = os.path.join(temp_dir, "lt_leecher")
    os.makedirs(engine_dir)
    os.makedirs(lt_leecher_dir)

    # 1. Generate Content (using Libtorrent helper)
    # We use a temporary session just to generate the file and torrent
    gen_session = LibtorrentSession(temp_dir, port=50000)
    file_size = 1024 * 512 # 512KB
    torrent_path, info_hash = gen_session.create_dummy_torrent("test_payload.bin", size=file_size, piece_length=piece_length)
    
    # Copy the generated payload to the Engine's directory
    source_file = os.path.join(temp_dir, "test_payload.bin")
    engine_file = os.path.join(engine_dir, "test_payload.bin")
    shutil.copy(source_file, engine_file)
    
    expected_hash = calculate_sha1(source_file)
    gen_session.stop()

    # 2. Start TS Engine (Seeder)
    engine = EngineRPC()
    engine.start()

    try:
        # Init engine
        resp = engine.send_command("init", {
            "listen_port": 0,
            "download_dir": engine_dir
        })
        assert resp["ok"]

        # Add torrent in SEED MODE
        resp = engine.send_command("add_torrent_file", {
            "path": torrent_path,
            "info_hash": info_hash,
            "piece_length": piece_length,
            "total_length": file_size,
            "seed_mode": True
        })
        assert resp["ok"]
        engine_port = resp["port"]

        # 3. Start Libtorrent (Leecher)
        lt_session = LibtorrentSession(lt_leecher_dir, port=50001)
        # Add torrent to libtorrent (standard mode, it will check and find nothing)
        lt_handle = lt_session.add_torrent(torrent_path, lt_leecher_dir)

        # 4. Connect Peers
        # Connect Libtorrent to Engine
        print(f"Connecting Libtorrent to Engine at 127.0.0.1:{engine_port}")
        lt_handle.connect_peer(("127.0.0.1", engine_port))
        
        # Also try reverse connection for robustness
        engine.send_command("add_peer", {
            "info_hash": info_hash,
            "ip": "127.0.0.1",
            "port": 50001
        })

        # 5. Wait for Download
        print("Waiting for Libtorrent to download...")
        downloaded = False
        for i in range(60): # 30 seconds
            s = lt_handle.status()
            print(f"LT Status: {s.state}, Progress: {s.progress}, Peers: {s.num_peers}")
            
            if s.is_seeding:
                downloaded = True
                print("Libtorrent finished downloading!")
                break
            
            time.sleep(0.5)

        assert downloaded, "Libtorrent failed to download from Engine"
        
        # Verify file integrity
        downloaded_file = os.path.join(lt_leecher_dir, "test_payload.bin")
        assert os.path.exists(downloaded_file)
        assert calculate_sha1(downloaded_file) == expected_hash

    finally:
        engine.stop()
        if 'lt_session' in locals():
            lt_session.stop()
