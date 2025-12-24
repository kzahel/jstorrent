import libtorrent as lt
import os
import shutil
import time
from typing import Tuple


def get_v1_info_hash(info: lt.torrent_info) -> str:
    """Get the v1 info hash from a torrent_info object.

    For hybrid v1+v2 torrents, info_hash() returns the truncated v2 hash.
    We need the v1 hash (SHA1 of full info dict) for compatibility with JSTEngine.
    """
    hashes = info.info_hashes()
    if hashes.has_v1():
        return str(hashes.v1)
    return str(info.info_hash())

class LibtorrentSession:
    def __init__(self, root_dir: str, port: int = 40000):
        self.root_dir = root_dir
        self.port = port
        
        settings = {
            'listen_interfaces': '127.0.0.1:%d' % port,
            'enable_dht': False,
            'enable_lsd': False,
            'enable_upnp': False,
            'enable_natpmp': False,
            'in_enc_policy': 0, # pe_disabled
            'out_enc_policy': 0, # pe_disabled
            'allowed_enc_level': 0, # pe_plaintext
            'enable_incoming_utp': False,
            'enable_outgoing_utp': False,
            'prefer_rc4': False,
            'user_agent': 'libtorrent_test',
            'alert_mask': lt.alert.category_t.all_categories,
            'allow_multiple_connections_per_ip': True
        }
        
        params = lt.session_params()
        params.settings = settings
        self.session = lt.session(params)
        
        # Force apply settings again just in case
        self.session.apply_settings(settings)
        
        # Explicitly disable encryption using settings_pack (pe_settings is deprecated)
        try:
            settings['out_enc_policy'] = lt.enc_policy.pe_disabled
            settings['in_enc_policy'] = lt.enc_policy.pe_disabled
            settings['allowed_enc_level'] = lt.enc_level.plaintext
            
            params.settings = settings
            self.session.apply_settings(settings)
            print("DEBUG: Applied encryption settings via settings_pack.")
        except Exception as e:
            print(f"DEBUG: Failed to apply encryption settings: {e}")
        
        # Verify settings
        applied = self.session.get_settings()
        print(f"DEBUG: out_enc_policy={applied.get('out_enc_policy')}")
        print(f"DEBUG: in_enc_policy={applied.get('in_enc_policy')}")
        print(f"DEBUG: allowed_enc_level={applied.get('allowed_enc_level')}")
        
    def create_dummy_torrent(self, name: str, size: int = 1024 * 1024, piece_length: int = 0, tracker_url: str = None) -> Tuple[str, str]:
        """Creates a dummy file and a .torrent file for it. Returns (torrent_path, info_hash_hex)."""
        file_path = os.path.join(self.root_dir, name)
        with open(file_path, "wb") as f:
            f.write(os.urandom(size))
            
        fs = lt.file_storage()
        lt.add_files(fs, file_path)
        t = lt.create_torrent(fs, piece_size=piece_length)
        t.set_creator('libtorrent_test')
        if tracker_url:
            t.add_tracker(tracker_url)
        lt.set_piece_hashes(t, self.root_dir)
        torrent_path = os.path.join(self.root_dir, name + ".torrent")
        
        with open(torrent_path, "wb") as f:
            f.write(lt.bencode(t.generate()))
            
        info = lt.torrent_info(torrent_path)
        info_hash = get_v1_info_hash(info)
        return torrent_path, info_hash

    def create_multi_file_torrent(self, dir_name: str, files: list[Tuple[str, int]], piece_length: int = 0, tracker_url: str = None) -> Tuple[str, str]:
        """
        Creates a multi-file torrent.
        files: list of (filename, size) tuples.
        Returns (torrent_path, info_hash_hex).
        """
        base_path = os.path.join(self.root_dir, dir_name)
        os.makedirs(base_path, exist_ok=True)
        
        fs = lt.file_storage()
        
        for name, size in files:
            file_path = os.path.join(base_path, name)
            # Ensure subdirectories exist if name contains path separators
            os.makedirs(os.path.dirname(file_path), exist_ok=True)
            with open(file_path, "wb") as f:
                f.write(os.urandom(size))
            fs.add_file(os.path.join(dir_name, name), size)

        t = lt.create_torrent(fs, piece_size=piece_length)
        t.set_creator('libtorrent_test')
        if tracker_url:
            t.add_tracker(tracker_url)
        lt.set_piece_hashes(t, self.root_dir) # set_piece_hashes expects the parent dir of the content
        
        torrent_path = os.path.join(self.root_dir, dir_name + ".torrent")
        with open(torrent_path, "wb") as f:
            f.write(lt.bencode(t.generate()))
            
        info = lt.torrent_info(torrent_path)
        info_hash = get_v1_info_hash(info)
        return torrent_path, info_hash

    def add_torrent(self, torrent_path: str, save_path: str, seed_mode: bool = False):
        params = lt.add_torrent_params()
        params.ti = lt.torrent_info(torrent_path)
        params.save_path = save_path
        
        if seed_mode:
            params.flags = lt.torrent_flags.seed_mode
            
        # Disable auto_managed to prevent queueing
        params.flags &= ~lt.torrent_flags.auto_managed
            
        handle = self.session.add_torrent(params)
        handle.resume()
        
        if seed_mode:
            handle.force_recheck()
            
        return handle

    def stop(self):
        # libtorrent session doesn't strictly need a stop method in python bindings, 
        # but good for cleanup if needed
        pass

    def print_alerts(self):
        alerts = self.session.pop_alerts()
        for a in alerts:
            print(f"Libtorrent Alert: {a.message()}")

    def listen_port(self) -> int:
        return self.session.listen_port()


class EncryptedLibtorrentSession(LibtorrentSession):
    """
    Libtorrent session that REQUIRES encryption (MSE/PE).

    Used for testing that jstorrent can connect to peers that only accept
    encrypted connections (pe_forced policy with RC4 encryption).
    """

    def __init__(self, root_dir: str, port: int = 40000):
        self.root_dir = root_dir
        self.port = port

        # Start with base settings, then override for encryption
        settings = {
            'listen_interfaces': '127.0.0.1:%d' % port,
            'enable_dht': False,
            'enable_lsd': False,
            'enable_upnp': False,
            'enable_natpmp': False,
            'enable_incoming_utp': False,
            'enable_outgoing_utp': False,
            'user_agent': 'libtorrent_mse_test',
            'alert_mask': lt.alert.category_t.all_categories,
            'allow_multiple_connections_per_ip': True,
            # Encryption settings - REQUIRE encryption
            'out_enc_policy': 2,  # pe_forced (numeric fallback)
            'in_enc_policy': 2,   # pe_forced
            'allowed_enc_level': 3,  # both (prefer RC4)
            'prefer_rc4': True,
        }

        params = lt.session_params()
        params.settings = settings
        self.session = lt.session(params)

        # Apply settings using proper enum values
        try:
            settings['out_enc_policy'] = lt.enc_policy.pe_forced
            settings['in_enc_policy'] = lt.enc_policy.pe_forced
            settings['allowed_enc_level'] = lt.enc_level.both
            self.session.apply_settings(settings)
            print("DEBUG: Applied encryption REQUIRED settings (pe_forced, both).")
        except AttributeError:
            # Fallback to numeric values if enums not available
            settings['out_enc_policy'] = 2  # pe_forced
            settings['in_enc_policy'] = 2   # pe_forced
            settings['allowed_enc_level'] = 3  # both
            self.session.apply_settings(settings)
            print("DEBUG: Applied encryption REQUIRED settings (numeric fallback).")

        # Verify settings
        applied = self.session.get_settings()
        print(f"DEBUG (encrypted): out_enc_policy={applied.get('out_enc_policy')} (expect: 2/pe_forced)")
        print(f"DEBUG (encrypted): in_enc_policy={applied.get('in_enc_policy')} (expect: 2/pe_forced)")
        print(f"DEBUG (encrypted): allowed_enc_level={applied.get('allowed_enc_level')} (expect: 3/both)")
        print(f"DEBUG (encrypted): prefer_rc4={applied.get('prefer_rc4')}")
