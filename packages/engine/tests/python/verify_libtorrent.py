import libtorrent as lt
import os
import sys

def verify_libtorrent():
    print(f"Libtorrent version: {lt.version}")
    
    # 1. Create a dummy file
    filename = "test_data.bin"
    file_size = 1024 * 1024 # 1MB
    with open(filename, "wb") as f:
        f.write(os.urandom(file_size))
    print(f"Created dummy file: {filename} ({file_size} bytes)")
    
    # 2. Create torrent
    fs = lt.file_storage()
    lt.add_files(fs, filename)
    t = lt.create_torrent(fs)
    t.set_creator('libtorrent_test')
    t.set_comment('Test torrent')
    lt.set_piece_hashes(t, ".")
    
    torrent_filename = "test.torrent"
    with open(torrent_filename, "wb") as f:
        f.write(lt.bencode(t.generate()))
    print(f"Created torrent file: {torrent_filename}")
    
    # 3. Load torrent back
    ti = lt.torrent_info(torrent_filename)
    print(f"Loaded torrent info.")
    print(f"Info Hash: {ti.info_hash()}")
    print(f"Num Files: {ti.num_files()}")
    print(f"Total Size: {ti.total_size()}")
    
    # Cleanup
    os.remove(filename)
    os.remove(torrent_filename)
    print("Cleanup complete.")
    
    if ti.num_files() == 1 and ti.total_size() == file_size:
        print("VERIFICATION SUCCESSFUL")
    else:
        print("VERIFICATION FAILED: Mismatch in file count or size")
        sys.exit(1)

if __name__ == "__main__":
    verify_libtorrent()
