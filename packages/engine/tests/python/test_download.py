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

# @pytest.mark.parametrize("piece_length", [16384, 32768, 65536]) # Test varying piece sizes
def test_download(tmp_path, piece_length):
    # Setup directories
    temp_dir = str(tmp_path)
    seeder_dir = os.path.join(temp_dir, f"seeder_{piece_length}")
    leecher_dir = os.path.join(temp_dir, f"leecher_{piece_length}")
    os.makedirs(seeder_dir)
    os.makedirs(leecher_dir)

    # 1. Start Libtorrent Seeder
    # Use a unique port based on piece_length to avoid TIME_WAIT issues
    port = 50000 + (piece_length // 1000) 
    lt_session = LibtorrentSession(seeder_dir, port=port)
    file_size = 1024 * 512 # 512KB
    torrent_path, info_hash = lt_session.create_dummy_torrent("test_payload.bin", size=file_size, piece_length=piece_length)
    
    # Calculate expected hash
    source_file = os.path.join(seeder_dir, "test_payload.bin")
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
        resp = engine.send_command("add_torrent_file", {
            "path": torrent_path,
            "info_hash": info_hash,
            "piece_length": piece_length,
            "total_length": file_size
        })
        assert resp["ok"]
        engine_port = resp["port"]

        # 3. Connect Peers
        resp = engine.send_command("add_peer", {
            "info_hash": info_hash,
            "ip": "127.0.0.1",
            "port": port
        })

        # 4. Wait for Download
        print("Waiting for download to complete...")
        downloaded = False
        for i in range(60): # 30 seconds
            # Check TS engine status
            resp = engine.send_command("get_status")
            assert resp["ok"]
            torrents = resp["torrents"]
            
            if info_hash in torrents:
                # We need a way to check progress from engine
                # Currently get_status only returns num_peers
                # We should update get_status to return progress/bitfield
                # But for now, we can check file existence or just wait?
                # Let's update repl.ts to return progress!
                pass
            
            # Check file existence and size
            download_path = os.path.join(leecher_dir, "test_payload.bin")
            if os.path.exists(download_path):
                current_size = os.path.getsize(download_path)
                if current_size == file_size:
                    # Verify hash
                    current_hash = calculate_sha1(download_path)
                    if current_hash == expected_hash:
                        downloaded = True
                        print("Download verified!")
                        break
                    else:
                        print(f"Hash mismatch! Expected {expected_hash}, got {current_hash}")
                else:
                    # print(f"Size mismatch: {current_size} / {file_size}")
                    pass
            
            time.sleep(0.5)

        if not downloaded:
            if os.path.exists(download_path):
                print(f"Final check: Size {os.path.getsize(download_path)}/{file_size}")
                print(f"Final check: Hash {calculate_sha1(download_path)} vs {expected_hash}")
            else:
                print("Final check: File not found")

        assert downloaded, "Download failed or timed out"

    finally:
        engine.stop()
        lt_session.stop()
