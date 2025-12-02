import libtorrent as lt
import os
import time
import shutil
import sys

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
        'user_agent': 'lt_test_agent'
    }
    params = lt.session_params()
    params.settings = settings
    ses = lt.session(params)
    
    # Force alert mask
    settings_update = {'alert_mask': lt.alert.category_t.all_categories | lt.alert.category_t.peer_log_notification}
    ses.apply_settings(settings_update)
    
    return ses

def verify_handshake():
    print("Verifying Libtorrent <-> Libtorrent Handshake")
    
    # Setup paths
    root = os.path.abspath("lt_verify_tmp")
    if os.path.exists(root):
        shutil.rmtree(root)
    os.makedirs(root)
    
    seeder_dir = os.path.join(root, "seeder")
    leecher_dir = os.path.join(root, "leecher")
    os.makedirs(seeder_dir)
    os.makedirs(leecher_dir)
    
    # Create dummy data
    filename = "data.bin"
    filepath = os.path.join(seeder_dir, filename)
    with open(filepath, "wb") as f:
        f.write(os.urandom(1024 * 1024)) # 1MB
        
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
    
    print("Sessions started. Checking for early alerts...")
    time.sleep(0.5)
    for ses, name in [(ses1, "Seeder"), (ses2, "Leecher")]:
        for a in ses.pop_alerts():
            print(f"[{name}] EARLY: {a.message()}")
    
    # Add Torrent to Seeder
    params1 = lt.add_torrent_params()
    params1.ti = torrent_info
    params1.save_path = seeder_dir
    params1.flags = lt.torrent_flags.seed_mode
    # Disable auto_managed to prevent queueing
    params1.flags &= ~lt.torrent_flags.auto_managed
    h1 = ses1.add_torrent(params1)
    h1.resume()
    h1.force_recheck() # Force check as requested
    
    # Add Torrent to Leecher
    params2 = lt.add_torrent_params()
    params2.ti = torrent_info
    params2.save_path = leecher_dir
    # Disable auto_managed
    params2.flags &= ~lt.torrent_flags.auto_managed
    h2 = ses2.add_torrent(params2)
    h2.resume()
    
    # Wait for seeder to be seeding
    print("Waiting for seeder to verify data...")
    for _ in range(50):
        s = h1.status()
        if s.is_seeding:
            print("Seeder is seeding (verified).")
            break
        print(f"Seeder state: {s.state} Progress: {s.progress}")
        time.sleep(0.1)
        
    # Wait for status
    time.sleep(1)
    s1 = h1.status()
    s2 = h2.status()
    print(f"Seeder Status: {s1.state} (paused={s1.paused}, auto_managed={s1.auto_managed})")
    print(f"Leecher Status: {s2.state} (paused={s2.paused}, auto_managed={s2.auto_managed})")
    
    # Connect
    print("Connecting Leecher to Seeder...")
    h2.connect_peer(("127.0.0.1", 50001))
    print("Connecting Seeder to Leecher...")
    h1.connect_peer(("127.0.0.1", 50002))
    
    # Poll for connection
    connected = False
    for i in range(10):
        s1 = h1.status()
        s2 = h2.status()
        print(f"Tick {i}: Seeder Peers: {s1.num_peers}, Leecher Peers: {s2.num_peers}")
        
        # Print alerts
        for ses, name in [(ses1, "Seeder"), (ses2, "Leecher")]:
            alerts = ses.pop_alerts()
            for a in alerts:
                if isinstance(a, lt.listen_succeeded_alert):
                    print(f"[{name}] LISTEN SUCCEEDED: {a.message()}")
                elif isinstance(a, lt.listen_failed_alert):
                    print(f"[{name}] LISTEN FAILED: {a.message()}")
                else:
                    print(f"[{name}] {a.message()}")
        
        if s1.num_peers > 0 and s2.num_peers > 0:
            connected = True
            break
        time.sleep(1)
        
    # Cleanup
    del ses1
    del ses2
    shutil.rmtree(root)
    
    if connected:
        print("SUCCESS: Handshake verified between two libtorrent sessions.")
    else:
        print("FAILURE: Could not establish connection.")
        sys.exit(1)

if __name__ == "__main__":
    verify_handshake()
