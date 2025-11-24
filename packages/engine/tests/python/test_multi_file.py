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
    
    engine_files = []
    offset = 0
    for i in range(info.num_files()):
        f = info.files().at(i)
        print(f"  {i}: {f.path} ({f.size} bytes)")
        engine_files.append({
            "path": f.path,
            "length": f.size,
            "offset": offset
        })
        offset += f.size

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

        # Get pieces
        pieces = b""
        for i in range(info.num_pieces()):
            pieces += info.hash_for_piece(i)

        resp = engine.send_command("add_torrent_file", {
            "path": torrent_path,
            "info_hash": info_hash,
            "piece_length": piece_length,
            "total_length": sum(f["length"] for f in engine_files),
            "files": engine_files,
            "pieces": pieces.hex()
        })
        assert resp["ok"]
        engine_port = resp["port"]

        # 3. Connect Peers
        resp = engine.send_command("add_peer", {
            "info_hash": info_hash,
            "ip": "127.0.0.1",
            "port": 50002
        })

        # 4. Wait for Download
        print("Waiting for download to complete...")
        downloaded = False
        for i in range(60): # 30 seconds
            # Check files
            all_exist = True
            for name, size in files: # Check the original files we care about
                # The path in the torrent might be different now due to sorting?
                # Libtorrent preserves the relative path structure but might sort the list.
                # We need to find where our files ended up.
                # We can look up by name in the engine_files list.
                
                # Construct expected path
                # If create_multi_file_torrent used "multi_test" as dir_name, then paths are "multi_test/name"
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
                    print("Download verified!")
                    break
            
            time.sleep(0.5)

        assert downloaded, "Download failed or timed out"

    finally:
        engine.stop()
        lt_session.stop()
