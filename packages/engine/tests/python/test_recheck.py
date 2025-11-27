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

def test_recheck(tmp_path):
    # Setup directories
    temp_dir = str(tmp_path)
    seeder_dir = os.path.join(temp_dir, "seeder_recheck")
    leecher_dir = os.path.join(temp_dir, "leecher_recheck")
    os.makedirs(seeder_dir)
    os.makedirs(leecher_dir)

    # 1. Start Libtorrent Seeder
    lt_session = LibtorrentSession(seeder_dir, port=50005)
    file_size = 10 * 1024 * 1024 # 10MB
    piece_length = 16384 # 16KB pieces
    
    torrent_path, info_hash = lt_session.create_dummy_torrent("recheck_payload.bin", size=file_size, piece_length=piece_length)
    
    # Add to libtorrent as seeder
    lt_handle = lt_session.add_torrent(torrent_path, seeder_dir, seed_mode=True)
    
    # Wait for seeding
    for _ in range(50):
        if lt_handle.status().is_seeding:
            break
        time.sleep(0.1)
    assert lt_handle.status().is_seeding

    # 2. Start JSTEngine
    engine = JSTEngine(port=3002, download_dir=leecher_dir)

    try:
        # Add torrent file
        tid = engine.add_torrent_file(torrent_path)

        # Connect to Peer
        engine.add_peer(tid, "127.0.0.1", 50005)

        # Wait for full download
        print("Waiting for download...")
        downloaded = False
        for i in range(60):
            status = engine.get_torrent_status(tid)
            progress = status.get("progress", 0)
            print(f"Progress: {progress * 100:.1f}%")
            
            if progress >= 1.0:
                downloaded = True
                break
                
            download_path = os.path.join(leecher_dir, "recheck_payload.bin")
            if os.path.exists(download_path):
                current_size = os.path.getsize(download_path)
                if current_size == file_size:
                    downloaded = True
                    break
            time.sleep(0.5)
        
        assert downloaded, "Download failed"
        time.sleep(2) # Wait for persistence

        # 3. Corrupt a piece
        print("Corrupting piece 0...")
        download_path = os.path.join(leecher_dir, "recheck_payload.bin")
        with open(download_path, "r+b") as f:
            f.seek(0)
            f.write(b"\x00" * 100) # Overwrite first 100 bytes
        
        # 4. Trigger Recheck
        print("Triggering recheck...")
        engine.recheck(tid)
        
        # 5. Verify that piece 0 is now missing via progress
        # After recheck, progress should be < 100% since piece 0 is corrupted
        time.sleep(2) # Wait for recheck and state update
        
        status = engine.get_torrent_status(tid)
        progress = status.get("progress", 0)
        print(f"Progress after recheck: {progress * 100:.1f}%")
        
        # Progress should be slightly less than 100% now
        assert progress < 1.0, "Piece 0 should be missing after corruption and recheck"

    finally:
        engine.close()
        lt_session.stop()
