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
            import shutil
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
            "name": "multi_peer_payload.bin",
            "pieces": pieces.hex()
        })
        assert resp["ok"]

        # 3. Connect Peers
        for port in ports:
            resp = engine.send_command("add_peer", {
                "info_hash": info_hash,
                "ip": "127.0.0.1",
                "port": port
            })

        # 4. Wait for Download
        print("Waiting for download to complete...")
        downloaded = False
        start_time = time.time()
        for i in range(60): # 30 seconds
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
        engine.stop()
        for s in seeders:
            s.stop()
