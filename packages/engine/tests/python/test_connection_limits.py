import pytest
import os
import time
import shutil
from libtorrent_utils import LibtorrentSession

def test_global_connection_limit(tmp_path, engine_factory):
    """Test that engine respects global max connection limits."""
    # Setup directories
    temp_dir = str(tmp_path)
    seeder_base_dir = os.path.join(temp_dir, "seeders")
    leecher_dir = os.path.join(temp_dir, "leecher")
    os.makedirs(seeder_base_dir)
    os.makedirs(leecher_dir)

    # 1. Start Multiple Libtorrent Seeders
    num_seeders = 10
    max_connections = 5
    
    piece_length = 16384
    file_size = 50 * 1024 * 1024 # 50MB
    
    # Create one torrent file shared by all
    # We need a dummy session just to create the torrent
    dummy_session = LibtorrentSession(seeder_base_dir, port=50000)
    torrent_path, info_hash = dummy_session.create_dummy_torrent("test_payload.bin", size=file_size, piece_length=piece_length)
    dummy_session.stop() # We don't need this session anymore

    seeders = []
    for i in range(num_seeders):
        s_dir = os.path.join(seeder_base_dir, f"s{i}")
        os.makedirs(s_dir)
        # Copy payload to seeder dir so they can seed it
        shutil.copy(os.path.join(seeder_base_dir, "test_payload.bin"), os.path.join(s_dir, "test_payload.bin"))
        
        port = 50001 + i
        session = LibtorrentSession(s_dir, port=port)
        handle = session.add_torrent(torrent_path, s_dir, seed_mode=True)
        seeders.append((session, handle, port))

    # Wait for seeders to be ready
    print("Waiting for seeders...")
    for _, handle, _ in seeders:
        for _ in range(50):
            if handle.status().is_seeding:
                break
            time.sleep(0.1)
        assert handle.status().is_seeding

    # 2. Start JSTEngine with limit
    # We need to pass maxConnections to the engine config
    engine = engine_factory(download_dir=leecher_dir, maxConnections=max_connections, verbose=True)

    # Add torrent file
    tid = engine.add_torrent_file(torrent_path)

    # 3. Connect to ALL Libtorrent peers
    print(f"Adding {num_seeders} peers to engine...")
    for _, _, port in seeders:
        engine.add_peer(tid, "127.0.0.1", port)

    # 4. Verify Connections
    # Poll for connections
    max_seen = 0
    start_time = time.time()
    while time.time() - start_time < 15:
        status = engine.get_torrent_status(tid)
        peers_connected = status.get("peers", 0)
        print(f"Engine reported peers: {peers_connected}")
        max_seen = max(max_seen, peers_connected)
        
        if peers_connected > max_connections:
            pytest.fail(f"Connected to {peers_connected} peers, exceeded max {max_connections}")
            
        if peers_connected == max_connections:
            # We reached the limit, good.
            # Keep monitoring for a bit to ensure it doesn't go over
            pass
            
        if status.get("progress", 0) >= 1.0:
            print("Download complete early")
            break
            
        time.sleep(0.5)
    
    print(f"Max peers seen: {max_seen}")
    
    assert max_seen > 0, "Should have connected to some peers"
    assert max_seen <= max_connections, f"Max peers seen {max_seen} exceeded limit {max_connections}"
    # Ideally we want to see exactly max_connections
    assert max_seen == max_connections, f"Should have reached limit {max_connections}, got max {max_seen}"

def test_per_torrent_connection_limit(tmp_path, engine_factory):
    """Test that engine respects per-torrent max peer limits."""
    # Setup directories
    temp_dir = str(tmp_path)
    seeder_base_dir = os.path.join(temp_dir, "seeders_pt")
    leecher_dir = os.path.join(temp_dir, "leecher_pt")
    os.makedirs(seeder_base_dir)
    os.makedirs(leecher_dir)

    # 1. Start Multiple Libtorrent Seeders
    num_seeders = 8
    max_peers = 4
    
    piece_length = 16384
    file_size = 50 * 1024 * 1024 # 50MB
    
    dummy_session = LibtorrentSession(seeder_base_dir, port=51000)
    torrent_path, info_hash = dummy_session.create_dummy_torrent("test_payload_pt.bin", size=file_size, piece_length=piece_length)
    dummy_session.stop()

    seeders = []
    for i in range(num_seeders):
        s_dir = os.path.join(seeder_base_dir, f"s{i}")
        os.makedirs(s_dir)
        shutil.copy(os.path.join(seeder_base_dir, "test_payload_pt.bin"), os.path.join(s_dir, "test_payload_pt.bin"))
        
        port = 51001 + i
        session = LibtorrentSession(s_dir, port=port)
        handle = session.add_torrent(torrent_path, s_dir, seed_mode=True)
        seeders.append((session, handle, port))

    # Wait for seeders
    for _, handle, _ in seeders:
        for _ in range(50):
            if handle.status().is_seeding:
                break
            time.sleep(0.1)
        assert handle.status().is_seeding

    # 2. Start JSTEngine with per-torrent limit
    # We assume 'maxPeers' is the config key for per-torrent limit
    engine = engine_factory(download_dir=leecher_dir, maxPeers=max_peers, maxConnections=100, verbose=True)

    # Add torrent file
    tid = engine.add_torrent_file(torrent_path)

    # 3. Connect to ALL Libtorrent peers
    for _, _, port in seeders:
        engine.add_peer(tid, "127.0.0.1", port)

    # 4. Verify Connections
    max_seen = 0
    start_time = time.time()
    while time.time() - start_time < 15:
        status = engine.get_torrent_status(tid)
        peers_connected = status.get("peers", 0)
        print(f"Engine reported peers: {peers_connected}")
        max_seen = max(max_seen, peers_connected)
        
        if peers_connected > max_peers:
            pytest.fail(f"Connected to {peers_connected} peers, exceeded max {max_peers}")
            
        if status.get("progress", 0) >= 1.0:
            print("Download complete early")
            break
            
        time.sleep(0.5)
    
    print(f"Max peers seen: {max_seen}")
    
    assert max_seen > 0, "Should have connected to some peers"
    assert max_seen <= max_peers, f"Max peers seen {max_seen} exceeded limit {max_peers}"
    assert max_seen == max_peers, f"Should have reached limit {max_peers}, got max {max_seen}"
