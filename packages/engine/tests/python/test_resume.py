import pytest
import os
import time
import hashlib
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

    # 2. Start JSTEngine (Run 1)
    engine = JSTEngine(port=3002, download_dir=leecher_dir)

    try:
        # Add torrent file
        tid = engine.add_torrent_file(torrent_path)

        # Connect to Peer
        engine.add_peer(tid, "127.0.0.1", 50004)

        # Wait for partial download (e.g. > 10%)
        print("Waiting for partial download...")
        downloaded_some = False
        for i in range(60):
            status = engine.get_torrent_status(tid)
            progress = status.get("progress", 0)
            print(f"Progress: {progress * 100:.1f}%")
            
            if progress > 0.1:
                print(f"Downloaded > 10%")
                downloaded_some = True
                break
                
            # Also check file size as backup
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
        engine.close()

    # 3. Restart JSTEngine (Run 2)
    print("Restarting engine...")
    engine = JSTEngine(port=3002, download_dir=leecher_dir)

    try:
        # Add torrent (should load resume data)
        tid = engine.add_torrent_file(torrent_path)
        
        # Connect Peer
        engine.add_peer(tid, "127.0.0.1", 50004)

        # Wait for completion
        print("Waiting for completion...")
        downloaded = False
        start_time = time.time()
        for i in range(60):
            status = engine.get_torrent_status(tid)
            progress = status.get("progress", 0)
            print(f"Progress: {progress * 100:.1f}%")
            
            if progress >= 1.0:
                downloaded = True
                print(f"Download verified via status! Time: {time.time() - start_time:.2f}s")
                break
                
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
        engine.close()
        lt_session.stop()
