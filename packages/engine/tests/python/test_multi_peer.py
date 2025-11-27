import pytest
import os
import time
import hashlib
import shutil
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

def test_multi_peer_download(tmp_path):
    # Setup directories
    temp_dir = str(tmp_path)
    leecher_dir = os.path.join(temp_dir, "leecher_multi_peer")
    os.makedirs(leecher_dir)

    # 1. Start 3 Libtorrent Seeders
    seeders = []
    ports = [50010, 50011, 50012]
    file_size = 10 * 1024 * 1024 # 10MB
    piece_length = 16384 # 16KB pieces -> ~640 pieces
    
    # Create torrent once
    seeder0_dir = os.path.join(temp_dir, "seeder_0")
    os.makedirs(seeder0_dir)
    lt_session0 = LibtorrentSession(seeder0_dir, port=ports[0])
    torrent_path, info_hash = lt_session0.create_dummy_torrent("multi_peer_payload.bin", size=file_size, piece_length=piece_length)
    
    # Copy torrent and payload to other seeders
    for i, port in enumerate(ports):
        dir_path = os.path.join(temp_dir, f"seeder_{i}")
        if i > 0:
            os.makedirs(dir_path)
            # Copy payload
            shutil.copy(os.path.join(seeder0_dir, "multi_peer_payload.bin"), os.path.join(dir_path, "multi_peer_payload.bin"))
            # Copy torrent file
            shutil.copy(torrent_path, os.path.join(dir_path, "multi_peer_payload.bin.torrent"))
            
            lt_session = LibtorrentSession(dir_path, port=port)
        else:
            lt_session = lt_session0
            
        seeders.append(lt_session)
        
        # Add torrent
        t_path = os.path.join(dir_path, "multi_peer_payload.bin.torrent")
        lt_handle = lt_session.add_torrent(t_path, dir_path, seed_mode=True)
        
        # Wait for seeding
        for _ in range(50):
            if lt_handle.status().is_seeding:
                break
            time.sleep(0.1)
        assert lt_handle.status().is_seeding
        print(f"Seeder {i} ready on port {port}")

    expected_hash = calculate_sha1(os.path.join(seeder0_dir, "multi_peer_payload.bin"))

    # 2. Start JSTEngine
    engine = JSTEngine(port=3002, download_dir=leecher_dir)

    try:
        # Add torrent file
        tid = engine.add_torrent_file(torrent_path)

        # 3. Connect to all Peers
        for port in ports:
            engine.add_peer(tid, "127.0.0.1", port)

        # 4. Wait for Download
        print("Waiting for download to complete...")
        downloaded = False
        start_time = time.time()
        for i in range(60): # 30 seconds
            status = engine.get_torrent_status(tid)
            progress = status.get("progress", 0)
            peers = status.get("peers", 0)
            print(f"Progress: {progress * 100:.1f}%, Peers: {peers}")
            
            if progress >= 1.0:
                downloaded = True
                print(f"Download complete! Time: {time.time() - start_time:.2f}s")
                break
                
            # Also check file as backup
            download_path = os.path.join(leecher_dir, "multi_peer_payload.bin")
            if os.path.exists(download_path):
                current_size = os.path.getsize(download_path)
                if current_size == file_size:
                    print("Verifying hash...")
                    if calculate_sha1(download_path) == expected_hash:
                        downloaded = True
                        print(f"Download verified! Time: {time.time() - start_time:.2f}s")
                        break
            time.sleep(0.5)

        assert downloaded, "Download failed or timed out"

    finally:
        engine.close()
        for s in seeders:
            s.stop()
