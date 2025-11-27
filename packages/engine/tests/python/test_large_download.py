import pytest
import os
import time
import hashlib
from libtorrent_utils import LibtorrentSession


def calculate_sha1(file_path):
    sha1 = hashlib.sha1()
    with open(file_path, 'rb') as f:
        while True:
            data = f.read(1024 * 1024) # Read in larger chunks
            if not data:
                break
            sha1.update(data)
    return sha1.hexdigest()


def test_large_download(tmp_path, engine_factory):
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

    # 2. Start JSTEngine
    engine = engine_factory(download_dir=leecher_dir)

    # Add torrent file
    tid = engine.add_torrent_file(torrent_path)

    # 3. Connect to peer
    engine.add_peer(tid, "127.0.0.1", 50003)

    # 4. Wait for Download
    print("Waiting for download to complete...")
    downloaded = False
    start_time = time.time()
    # 100MB might take a while. 
    # 100MB / 10MB/s = 10s.
    # Give it 60s.
    for i in range(120): # 60 seconds
        status = engine.get_torrent_status(tid)
        progress = status.get("progress", 0)
        peers = status.get("peers", 0)
        
        if i % 10 == 0:
            print(f"Progress: {progress * 100:.1f}%, Peers: {peers}")
        
        if progress >= 1.0:
            downloaded = True
            print(f"Download complete! Time: {time.time() - start_time:.2f}s")
            break
        
        # Also check file existence and size as backup
        download_path = os.path.join(leecher_dir, "large_payload.bin")
        if os.path.exists(download_path):
            current_size = os.path.getsize(download_path)
            if i % 10 == 0:
                print(f"File size: {current_size / (1024*1024):.2f} MB / {file_size / (1024*1024):.2f} MB")
            
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
                    break
        
        time.sleep(0.5)

    assert downloaded, "Download failed or timed out"
