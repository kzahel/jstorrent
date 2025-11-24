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

    # Get pieces for verification
    import libtorrent as lt
    info = lt.torrent_info(torrent_path)
    pieces = b""
    for i in range(info.num_pieces()):
        pieces += info.hash_for_piece(i)

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
            "total_length": file_size,
            "name": "recheck_payload.bin",
            "pieces": pieces.hex()
        })
        assert resp["ok"]

        # Connect Peer
        resp = engine.send_command("add_peer", {
            "info_hash": info_hash,
            "ip": "127.0.0.1",
            "port": 50005
        })

        # Wait for full download
        print("Waiting for download...")
        downloaded = False
        for i in range(60):
            download_path = os.path.join(leecher_dir, "recheck_payload.bin")
            if os.path.exists(download_path):
                current_size = os.path.getsize(download_path)
                if current_size == file_size:
                    # Check if bitfield is full?
                    # We can assume it is if we wait a bit more or check logs.
                    # Or we can just proceed to corruption.
                    downloaded = True
                    break
            time.sleep(0.5)
        
        assert downloaded, "Download failed"
        time.sleep(2) # Wait for persistence

        # 3. Corrupt a piece
        print("Corrupting piece 0...")
        with open(os.path.join(leecher_dir, "recheck_payload.bin"), "r+b") as f:
            f.seek(0)
            f.write(b"\x00" * 100) # Overwrite first 100 bytes
        
        # 4. Trigger Recheck
        print("Triggering recheck...")
        resp = engine.send_command("recheck_torrent", {
            "info_hash": info_hash
        })
        assert resp["ok"]
        
        # 5. Verify that piece 0 is now missing
        # We can check this by trying to resume/download again?
        # Or by checking the persisted resume data?
        # Let's check resume data file.
        
        time.sleep(2) # Wait for recheck and save
        
        resume_path = os.path.join(leecher_dir, ".session", "resume", f"{info_hash}.json")
        # Note: In repl.ts we set session_dir to .session inside download_dir
        
        assert os.path.exists(resume_path), "Resume data not found"
        
        import json
        with open(resume_path, "r") as f:
            data = json.load(f)
            bitfield_hex = data["bitfield"]
            bitfield_bytes = bytes.fromhex(bitfield_hex)
            
            # Piece 0 is the first bit.
            # Byte 0: 0xxxxxxx means piece 0 is missing.
            # 1xxxxxxx means piece 0 is present.
            # Actually bitfield usually stores bit 0 at 0x80 (10000000)
            
            first_byte = bitfield_bytes[0]
            print(f"First byte of bitfield: {first_byte:08b}")
            
            # If piece 0 is missing, the first bit should be 0.
            # If all others are present, it should be 01111111 (0x7F)
            
            is_piece_0_present = (first_byte & 0x80) != 0
            assert not is_piece_0_present, "Piece 0 should be missing after corruption and recheck"
            
            # Check piece 1 is present
            is_piece_1_present = (first_byte & 0x40) != 0
            assert is_piece_1_present, "Piece 1 should be present"

    finally:
        engine.stop()
        lt_session.stop()
