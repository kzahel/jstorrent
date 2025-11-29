import libtorrent as lt
import os
import time
import shutil
import sys
import hashlib
import tempfile

def create_session(port):
    settings = {
        'listen_interfaces': '0.0.0.0:%d' % port,
        'enable_dht': False,
        'enable_lsd': False,
        'enable_upnp': False,
        'enable_natpmp': False,
        'in_enc_policy': 0, # pe_disabled
        'out_enc_policy': 0, # pe_disabled
        'allowed_enc_level': 0, # pe_plaintext
        'enable_incoming_utp': False,
        'enable_outgoing_utp': False,
        'user_agent': 'lt_test_agent',
        'alert_mask': lt.alert.category_t.all_categories
    }
    params = lt.session_params()
    params.settings = settings
    ses = lt.session(params)
    
    # Force apply settings again just in case
    ses.apply_settings(settings)
    
    # Explicitly disable encryption using pe_settings
    try:
        ps = lt.pe_settings()
        ps.out_enc_policy = lt.enc_policy.pe_disabled
        ps.in_enc_policy = lt.enc_policy.pe_disabled
        ps.allowed_enc_level = lt.enc_level.plaintext
        ses.set_pe_settings(ps)
    except Exception as e:
        print(f"Failed to apply pe_settings: {e}")
        
    return ses

def verify_download():
    print("Verifying Libtorrent <-> Libtorrent Download")
    
    root_obj = tempfile.TemporaryDirectory()
    root = root_obj.name
    print(f"Created temporary directory: {root}")
    
    seeder_dir = os.path.join(root, "seeder")
    leecher_dir = os.path.join(root, "leecher")
    os.makedirs(seeder_dir)
    os.makedirs(leecher_dir)
    
    # Create dummy data
    filename = "data.bin"
    filepath = os.path.join(seeder_dir, filename)
    file_size = 1024 * 1024 * 5 # 5MB
    with open(filepath, "wb") as f:
        f.write(os.urandom(file_size))
        
    # Calculate hash
    with open(filepath, "rb") as f:
        expected_hash = hashlib.sha1(f.read()).hexdigest()
    print(f"Created dummy file: {file_size} bytes, hash: {expected_hash}")
        
    # Create torrent
    fs = lt.file_storage()
    lt.add_files(fs, filepath)
    t = lt.create_torrent(fs)
    lt.set_piece_hashes(t, os.path.dirname(filepath))
    torrent_info = lt.torrent_info(t.generate())
    info_hash = torrent_info.info_hash()
    print(f"Info Hash: {info_hash}")
    
    # Start Sessions
    ses1 = create_session(50001) # Seeder
    ses2 = create_session(50002) # Leecher
    
    print("Sessions started.")
    
    # Add Torrent to Seeder
    params1 = lt.add_torrent_params()
    params1.ti = torrent_info
    params1.save_path = seeder_dir
    params1.flags = lt.torrent_flags.seed_mode
    # Disable auto_managed to prevent queueing
    params1.flags &= ~lt.torrent_flags.auto_managed
    h1 = ses1.add_torrent(params1)
    h1.resume()
    h1.force_recheck()
    
    # Wait for seeder to be ready
    print("Waiting for seeder to verify data...")
    for _ in range(50):
        if h1.status().is_seeding:
            print("Seeder is ready.")
            break
        time.sleep(0.1)
    
    # Add Torrent to Leecher
    params2 = lt.add_torrent_params()
    params2.ti = torrent_info
    params2.save_path = leecher_dir
    # Disable auto_managed
    params2.flags &= ~lt.torrent_flags.auto_managed
    h2 = ses2.add_torrent(params2)
    h2.resume()
    
    # Connect
    print("Connecting peers...")
    h2.connect_peer(("127.0.0.1", 50001))
    h1.connect_peer(("127.0.0.1", 50002))
    
    # Poll for completion
    completed = False
    start_time = time.time()
    while time.time() - start_time < 30: # 30 seconds timeout
        s1 = h1.status()
        s2 = h2.status()
        
        print(f"Seeder: {s1.state} (peers: {s1.num_peers}) | Leecher: {s2.state} (peers: {s2.num_peers}, progress: {s2.progress * 100:.1f}%)")
        
        if s2.is_seeding:
            completed = True
            print("Download completed!")
            break
            
        time.sleep(1)
        
    # Verify downloaded data
    if completed:
        downloaded_path = os.path.join(leecher_dir, filename)
        if os.path.exists(downloaded_path):
            with open(downloaded_path, "rb") as f:
                actual_hash = hashlib.sha1(f.read()).hexdigest()
            
            if actual_hash == expected_hash:
                print("SUCCESS: Downloaded file matches source.")
            else:
                print(f"FAILURE: Hash mismatch. Expected {expected_hash}, got {actual_hash}")
                completed = False
        else:
            print("FAILURE: Downloaded file not found.")
            completed = False
    else:
        print("FAILURE: Download timed out.")

    # Cleanup
    del ses1
    del ses2
    # shutil.rmtree(root) - handled by tempfile
    root_obj.cleanup()
    
    if not completed:
        sys.exit(1)

if __name__ == "__main__":
    verify_download()
