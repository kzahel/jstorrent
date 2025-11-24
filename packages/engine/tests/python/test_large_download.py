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
            data = f.read(1024 * 1024) # Read in larger chunks
            if not data:
                break
            sha1.update(data)
    return sha1.hexdigest()

def test_large_download(tmp_path):
    # Setup directories
    temp_dir = str(tmp_path)
    seeder_dir = os.path.join(temp_dir, "seeder_large")
    leecher_dir = os.path.join(temp_dir, "leecher_large")
    os.makedirs(seeder_dir)
    os.makedirs(leecher_dir)

    # 1. Start Libtorrent Seeder
    lt_session = LibtorrentSession(seeder_dir, port=50003)
    file_size = 100 * 1024 * 1024 # 100MB
    piece_length = 256 * 1024 # 256KB pieces
    
    print(f"Generating {file_size} bytes dummy file...")
    torrent_path, info_hash = lt_session.create_dummy_torrent("large_payload.bin", size=file_size, piece_length=piece_length)
    
    print("Calculating expected hash...")
    source_file = os.path.join(seeder_dir, "large_payload.bin")
    expected_hash = calculate_sha1(source_file)

    # Add to libtorrent as seeder
    lt_handle = lt_session.add_torrent(torrent_path, seeder_dir, seed_mode=True)

    # Wait for libtorrent to be ready
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
            "listen_port": 0,
            "download_dir": leecher_dir
        })
        assert resp["ok"]

        # Add torrent
        import libtorrent as lt
        info = lt.torrent_info(torrent_path)
        pieces = b""
        for i in range(info.num_pieces()):
            pieces += info.hash_for_piece(i)

        resp = engine.send_command("add_torrent_file", {
            "path": torrent_path,
            "info_hash": info_hash,
            "piece_length": piece_length,
            "total_length": file_size,
            "name": "large_payload.bin",
            "pieces": pieces.hex()
        })
        assert resp["ok"]
        engine_port = resp["port"]

        # 3. Connect Peers
        resp = engine.send_command("add_peer", {
            "info_hash": info_hash,
            "ip": "127.0.0.1",
            "port": 50003
        })

        # 4. Wait for Download
        print("Waiting for download to complete...")
        downloaded = False
        start_time = time.time()
        # 100MB might take a while. 
        # 100MB / 10MB/s = 10s.
        # Give it 60s.
        for i in range(120): # 60 seconds
            # Check file existence and size
            download_path = os.path.join(leecher_dir, "large_payload.bin")
            if os.path.exists(download_path):
                current_size = os.path.getsize(download_path)
                if i % 10 == 0:
                    print(f"Progress: {current_size / (1024*1024):.2f} MB / {file_size / (1024*1024):.2f} MB")
                
                if current_size == file_size:
                    # Verify hash
                    print("Verifying hash...")
                    current_hash = calculate_sha1(download_path)
                    if current_hash == expected_hash:
                        downloaded = True
                        print(f"Download verified! Time: {time.time() - start_time:.2f}s")
                        break
                    else:
                        print(f"Hash mismatch! Expected {expected_hash}, got {current_hash}")
                        # Don't break immediately, maybe it's still writing? 
                        # But size matched.
                        # If size matched and hash mismatch, it's a failure.
                        break
            
            time.sleep(0.5)

        assert downloaded, "Download failed or timed out"

    finally:
        engine.stop()
        lt_session.stop()
