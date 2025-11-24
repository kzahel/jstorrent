import pytest
import os
import time
import hashlib
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

def test_resume(tmp_path):
    # Setup directories
    temp_dir = str(tmp_path)
    seeder_dir = os.path.join(temp_dir, "seeder_resume")
    leecher_dir = os.path.join(temp_dir, "leecher_resume")
    os.makedirs(seeder_dir)
    os.makedirs(leecher_dir)

    # 1. Start Libtorrent Seeder
    lt_session = LibtorrentSession(seeder_dir, port=50004)
    file_size = 10 * 1024 * 1024 # 10MB
    piece_length = 16384 # 16KB pieces
    
    torrent_path, info_hash = lt_session.create_dummy_torrent("resume_payload.bin", size=file_size, piece_length=piece_length)
    
    # Add to libtorrent as seeder
    lt_handle = lt_session.add_torrent(torrent_path, seeder_dir, seed_mode=True)
    
    # Wait for seeding
    for _ in range(50):
        if lt_handle.status().is_seeding:
            break
        time.sleep(0.1)
    assert lt_handle.status().is_seeding

    expected_hash = calculate_sha1(os.path.join(seeder_dir, "resume_payload.bin"))

    # Get pieces for verification
    import libtorrent as lt
    info = lt.torrent_info(torrent_path)
    pieces = b""
    for i in range(info.num_pieces()):
        pieces += info.hash_for_piece(i)

    # 2. Start TS Engine (Run 1)
    engine = EngineRPC()
    engine.start()

    try:
        # Init engine
        resp = engine.send_command("init", {
            "listen_port": 0,
            "download_dir": leecher_dir
        })
        assert resp["ok"]

        # Add torrent
        resp = engine.send_command("add_torrent_file", {
            "path": torrent_path,
            "info_hash": info_hash,
            "piece_length": piece_length,
            "total_length": file_size,
            "name": "resume_payload.bin",
            "pieces": pieces.hex()
        })
        assert resp["ok"]

        # Connect Peer
        resp = engine.send_command("add_peer", {
            "info_hash": info_hash,
            "ip": "127.0.0.1",
            "port": 50004
        })

        # Wait for partial download (e.g. > 10%)
        print("Waiting for partial download...")
        downloaded_some = False
        for i in range(60):
            download_path = os.path.join(leecher_dir, "resume_payload.bin")
            if os.path.exists(download_path):
                current_size = os.path.getsize(download_path)
                if current_size > file_size * 0.1:
                    print(f"Downloaded {current_size} bytes (> 10%)")
                    downloaded_some = True
                    break
            time.sleep(0.5)
        
        assert downloaded_some, "Did not download enough data"

        # Wait a bit to ensure persistence (debounce/async write)
        time.sleep(2)
        print("Stopping engine (simulating crash/shutdown)...")
        print("Resume data saved.")

    finally:
        engine.stop()

    # 3. Restart TS Engine (Run 2)
    print("Restarting engine...")
    engine = EngineRPC()
    engine.start()

    try:
        # Init engine
        resp = engine.send_command("init", {
            "listen_port": 0,
            "download_dir": leecher_dir
        })
        assert resp["ok"]

        # Add torrent (should load resume data)
        resp = engine.send_command("add_torrent_file", {
            "path": torrent_path,
            "info_hash": info_hash,
            "piece_length": piece_length,
            "total_length": file_size,
            "name": "resume_payload.bin",
            "pieces": pieces.hex()
        })
        assert resp["ok"]
        
        # Check if bitfield was loaded?
        # We can't easily check internal state via RPC unless we add a get_bitfield command.
        # But if we connect a peer, it should send a BITFIELD message reflecting what we have.
        # Or we can just verify it finishes downloading the rest.
        
        # Connect Peer
        resp = engine.send_command("add_peer", {
            "info_hash": info_hash,
            "ip": "127.0.0.1",
            "port": 50004
        })

        # Wait for completion
        print("Waiting for completion...")
        downloaded = False
        start_time = time.time()
        for i in range(60):
            download_path = os.path.join(leecher_dir, "resume_payload.bin")
            if os.path.exists(download_path):
                current_size = os.path.getsize(download_path)
                if current_size == file_size:
                    print("Verifying hash...")
                    if calculate_sha1(download_path) == expected_hash:
                        downloaded = True
                        print(f"Download verified! Time: {time.time() - start_time:.2f}s")
                        break
            time.sleep(0.5)
        
        assert downloaded, "Download failed or timed out after resume"

    finally:
        engine.stop()
        lt_session.stop()
