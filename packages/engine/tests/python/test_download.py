import pytest
import os
import time
import shutil
import hashlib
import json
from harness.libtorrent_utils import LibtorrentSession
from jst import JSTEngine

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

    # 2. Start JSTEngine
    engine = JSTEngine(port=3002, download_dir=leecher_dir)

    try:
        # Add torrent file
        tid = engine.add_torrent_file(torrent_path)

        # 3. Connect to peer
        engine.add_peer(tid, "127.0.0.1", port)

        # 4. Wait for Download
        print("Waiting for download to complete...")
        downloaded = False
        for i in range(60): # 30 seconds
            # Check engine status
            status = engine.get_torrent_status(tid)
            progress = status.get("progress", 0)
            print(f"Progress: {progress * 100:.1f}%")
            
            if progress >= 1.0:
                downloaded = True
                print("Download complete per engine status!")
                break
            
            # Also check file existence and size as backup
            download_path = os.path.join(leecher_dir, "test_payload.bin")
            if os.path.exists(download_path):
                current_size = os.path.getsize(download_path)
                if current_size == file_size:
                    # Verify hash
                    current_hash = calculate_sha1(download_path)
                    if current_hash == expected_hash:
                        downloaded = True
                        print("Download verified via file check!")
                        break
            
            time.sleep(0.5)

        if not downloaded:
            download_path = os.path.join(leecher_dir, "test_payload.bin")
            if os.path.exists(download_path):
                print(f"Final check: Size {os.path.getsize(download_path)}/{file_size}")
                print(f"Final check: Hash {calculate_sha1(download_path)} vs {expected_hash}")
            else:
                print("Final check: File not found")

        assert downloaded, "Download failed or timed out"

    finally:
        engine.close()
        lt_session.stop()
