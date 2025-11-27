import pytest
import subprocess
import time
import os
import sys
import re
from libtorrent_utils import LibtorrentSession
from test_download import calculate_sha1

@pytest.fixture
def tracker_url():
    """Starts a local bittorrent-tracker and yields its announce URL."""
    # Path to the node script
    script_path = os.path.join(os.path.dirname(__file__), 'run_tracker.mjs')
    
    # Start the tracker process
    # We assume 'node' is in the PATH and bittorrent-tracker is installed in packages/engine/node_modules
    # We need to set the CWD to packages/engine so it finds node_modules
    cwd = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../'))
    
    process = subprocess.Popen(
        ['node', script_path],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=cwd,
        text=True,
        bufsize=1
    )
    
    port = None
    url = None
    
    try:
        # Read stdout to find the port
        start_time = time.time()
        while time.time() - start_time < 10:
            line = process.stdout.readline()
            if not line:
                if process.poll() is not None:
                    break
                time.sleep(0.1)
                continue
                
            print(f"Tracker: {line.strip()}")
            match = re.search(r'TRACKER_PORT=(\d+)', line)
            if match:
                port = int(match.group(1))
                url = f"http://127.0.0.1:{port}/announce"
                break
        
        if not url:
            raise RuntimeError("Failed to start tracker: Could not get port")
            
        yield url
        
    finally:
        process.terminate()
        try:
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            process.kill()

def test_tracker_announce_and_peer_discovery(tmp_path, engine_factory, tracker_url):
    """Test complete tracker flow without manual add_peer."""
    print(f"Using tracker at: {tracker_url}")
    
    # Setup directories
    temp_dir = str(tmp_path)
    seeder_dir = os.path.join(temp_dir, "seeder")
    leecher_dir = os.path.join(temp_dir, "leecher")
    os.makedirs(seeder_dir)
    os.makedirs(leecher_dir)

    # 1. Start Libtorrent Seeder
    # Use a random port
    lt_session = LibtorrentSession(seeder_dir, port=0)
    file_size = 1024 * 512 # 512KB
    torrent_path, info_hash = lt_session.create_dummy_torrent(
        "test_tracker_payload.bin", 
        size=file_size, 
        piece_length=16384,
        tracker_url=tracker_url
    )
    
    # Calculate expected hash
    source_file = os.path.join(seeder_dir, "test_tracker_payload.bin")
    expected_hash = calculate_sha1(source_file)

    # Add to libtorrent as seeder
    lt_handle = lt_session.add_torrent(torrent_path, seeder_dir, seed_mode=True)

    # Wait for libtorrent to be ready and announce to tracker
    print("Waiting for Libtorrent seeder to be ready...")
    for _ in range(50):
        s = lt_handle.status()
        if s.is_seeding:
            print(f"Libtorrent seeder is ready on port {lt_session.session.listen_port()}.")
            break
        time.sleep(0.1)
    assert lt_handle.status().is_seeding
    
    # Give it a moment to announce
    time.sleep(2)

    # 2. Start JSTEngine
    engine = engine_factory(download_dir=leecher_dir)

    # Add torrent file
    tid = engine.add_torrent_file(torrent_path)
    
    # We do NOT manually add peer here. We expect discovery via tracker.

    # 3. Wait for Download
    print("Waiting for download to complete...")
    downloaded = False
    for i in range(60): # 30 seconds
        # Check engine status
        status = engine.get_torrent_status(tid)
        progress = status.get("progress", 0)
        peers = status.get("numPeers", 0)
        
        if i % 5 == 0:
            print(f"Progress: {progress * 100:.1f}%, Peers: {peers}")
        
        if progress >= 1.0:
            downloaded = True
            print("Download complete per engine status!")
            break
        
        # Also check file existence and size as backup
        download_path = os.path.join(leecher_dir, "test_tracker_payload.bin")
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
        download_path = os.path.join(leecher_dir, "test_tracker_payload.bin")
        if os.path.exists(download_path):
            print(f"Final check: Size {os.path.getsize(download_path)}/{file_size}")
            print(f"Final check: Hash {calculate_sha1(download_path)} vs {expected_hash}")
        else:
            print("Final check: File not found")
            
        # Debug info
        print("Engine Status:", engine.get_torrent_status(tid))

    assert downloaded, "Download failed or timed out"
