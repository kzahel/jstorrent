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

def test_multi_file_download(tmp_path):
    # Setup directories
    temp_dir = str(tmp_path)
    seeder_dir = os.path.join(temp_dir, "seeder_multi")
    leecher_dir = os.path.join(temp_dir, "leecher_multi")
    os.makedirs(seeder_dir)
    os.makedirs(leecher_dir)

    # 1. Start Libtorrent Seeder
    lt_session = LibtorrentSession(seeder_dir, port=50002)
    
    files = [
        ("small.txt", 1024),          # 1KB
        ("medium.bin", 1024 * 512),   # 512KB
        ("large.bin", 1024 * 1024 * 2) # 2MB
    ]
    total_size = sum(f[1] for f in files)
    piece_length = 16384
    
    torrent_name = "multi_test"
    torrent_path, info_hash = lt_session.create_multi_file_torrent(torrent_name, files, piece_length=piece_length)

    # Check files in torrent info
    import libtorrent as lt
    info = lt.torrent_info(torrent_path)
    print("Torrent Files:")
    
    for i in range(info.num_files()):
        f = info.files().at(i)
        print(f"  {i}: {f.path} ({f.size} bytes)")

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
        engine.add_peer(tid, "127.0.0.1", 50002)

        # 4. Wait for Download
        print("Waiting for download to complete...")
        downloaded = False
        for i in range(60): # 30 seconds
            status = engine.get_torrent_status(tid)
            progress = status.get("progress", 0)
            print(f"Progress: {progress * 100:.1f}%")
            
            if progress >= 1.0:
                downloaded = True
                print("Download complete per engine status!")
                break
            
            # Also check files as backup
            all_exist = True
            for name, size in files:
                expected_path = os.path.join(leecher_dir, torrent_name, name)
                
                if not os.path.exists(expected_path) or os.path.getsize(expected_path) != size:
                    all_exist = False
                    break
            
            if all_exist:
                # Verify hashes
                hashes_match = True
                for name, size in files:
                    src_path = os.path.join(seeder_dir, torrent_name, name)
                    dst_path = os.path.join(leecher_dir, torrent_name, name)
                    if calculate_sha1(src_path) != calculate_sha1(dst_path):
                        print(f"Hash mismatch for {name}")
                        hashes_match = False
                        break
                
                if hashes_match:
                    downloaded = True
                    print("Download verified via file check!")
                    break
            
            time.sleep(0.5)

        assert downloaded, "Download failed or timed out"

    finally:
        engine.close()
        lt_session.stop()
