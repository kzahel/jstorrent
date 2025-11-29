"""
Test that download continues after peer disconnect.

This is the core test for the ActivePiece refactoring. The bug was:
- Peer A requests blocks for piece P
- Peer A disconnects before sending data
- Blocks marked as "requested" stay that way forever
- No other peer will request those blocks → stall

The fix: Track which peer made each request. When peer disconnects,
clear only that peer's requests so blocks become available for other peers.
"""
import pytest
import os
import time
from libtorrent_utils import LibtorrentSession


def test_peer_disconnect_allows_rerequest(tmp_path, engine_factory):
    """
    Test that disconnecting a peer allows blocks to be re-requested from another peer.

    Strategy: Connect to two seeders, disconnect one mid-download, verify the
    download completes from the remaining seeder.
    """
    temp_dir = str(tmp_path)
    seeder1_dir = os.path.join(temp_dir, "seeder1")
    seeder2_dir = os.path.join(temp_dir, "seeder2")
    leecher_dir = os.path.join(temp_dir, "leecher")
    os.makedirs(seeder1_dir)
    os.makedirs(seeder2_dir)
    os.makedirs(leecher_dir)

    # Use a larger file so we have time to disconnect mid-download
    piece_length = 16384
    file_size = 1024 * 1024  # 1MB = 64 pieces

    # Create seeder1 with the data
    lt_session1 = LibtorrentSession(seeder1_dir, port=50101)
    torrent_path, info_hash = lt_session1.create_dummy_torrent(
        "test_data.bin", size=file_size, piece_length=piece_length
    )
    lt_handle1 = lt_session1.add_torrent(torrent_path, seeder1_dir, seed_mode=True)

    # Wait for seeder1 to be ready
    for _ in range(50):
        if lt_handle1.status().is_seeding:
            break
        time.sleep(0.1)
    assert lt_handle1.status().is_seeding, "Seeder1 not ready"

    # Create seeder2 with the same data (copy the file)
    import shutil
    shutil.copy(
        os.path.join(seeder1_dir, "test_data.bin"),
        os.path.join(seeder2_dir, "test_data.bin")
    )
    lt_session2 = LibtorrentSession(seeder2_dir, port=50102)
    lt_handle2 = lt_session2.add_torrent(torrent_path, seeder2_dir, seed_mode=True)

    # Wait for seeder2 to be ready
    for _ in range(50):
        if lt_handle2.status().is_seeding:
            break
        time.sleep(0.1)
    assert lt_handle2.status().is_seeding, "Seeder2 not ready"

    # Start JSTEngine leecher
    engine = engine_factory(download_dir=leecher_dir)
    tid = engine.add_torrent_file(torrent_path)

    # Connect to BOTH seeders
    engine.add_peer(tid, "127.0.0.1", 50101)
    engine.add_peer(tid, "127.0.0.1", 50102)

    # Wait for connections to establish
    time.sleep(0.3)

    # Disconnect seeder1 while download is in progress
    # This should clear seeder1's requests, allowing seeder2 to fulfill them
    engine.force_disconnect_peer(tid, "127.0.0.1", 50101)
    print("Disconnected seeder1")

    # Download should continue and complete from seeder2
    # The key fix ensures that blocks requested from seeder1 are now
    # available to be requested from seeder2
    for i in range(50):
        status = engine.get_torrent_status(tid)
        progress = status.get("progress", 0)
        print(f"Tick {i}: Progress: {progress:.1%}")
        if progress >= 1.0:
            print("Download complete!")
            break
        time.sleep(0.1)

    final_status = engine.get_torrent_status(tid)
    assert final_status["progress"] >= 1.0, (
        f"Download stalled at {final_status['progress']:.1%} after peer disconnect. "
        "This suggests the ActivePiece request clearing isn't working."
    )


def test_single_peer_disconnect_and_reconnect(tmp_path, engine_factory):
    """
    Test the scenario where we have only one peer, disconnect it, reconnect it,
    and verify download continues.

    This tests that requests from a disconnected peer are properly cleared
    and can be re-requested when the same peer reconnects.
    """
    temp_dir = str(tmp_path)
    seeder_dir = os.path.join(temp_dir, "seeder")
    leecher_dir = os.path.join(temp_dir, "leecher")
    os.makedirs(seeder_dir)
    os.makedirs(leecher_dir)

    piece_length = 16384
    file_size = 512 * 1024  # 512KB = 32 pieces

    # Create seeder
    lt_session = LibtorrentSession(seeder_dir, port=50103)
    torrent_path, info_hash = lt_session.create_dummy_torrent(
        "test_data.bin", size=file_size, piece_length=piece_length
    )
    lt_handle = lt_session.add_torrent(torrent_path, seeder_dir, seed_mode=True)

    for _ in range(50):
        if lt_handle.status().is_seeding:
            break
        time.sleep(0.1)
    assert lt_handle.status().is_seeding, "Seeder not ready"

    # Start leecher
    engine = engine_factory(download_dir=leecher_dir)
    tid = engine.add_torrent_file(torrent_path)

    # Connect and wait for some progress
    engine.add_peer(tid, "127.0.0.1", 50103)
    time.sleep(0.2)

    # Disconnect while download in progress
    engine.force_disconnect_peer(tid, "127.0.0.1", 50103)
    print("Disconnected peer")

    progress_at_disconnect = engine.get_torrent_status(tid).get("progress", 0)
    print(f"Progress at disconnect: {progress_at_disconnect:.1%}")

    # Reconnect to the same peer
    engine.add_peer(tid, "127.0.0.1", 50103)
    print("Reconnected peer")

    # Download should continue from where it left off
    for i in range(50):
        status = engine.get_torrent_status(tid)
        progress = status.get("progress", 0)
        print(f"After reconnect {i}: Progress: {progress:.1%}")
        if progress >= 1.0:
            print("Download complete!")
            break
        time.sleep(0.1)

    final_status = engine.get_torrent_status(tid)
    assert final_status["progress"] >= 1.0, (
        f"Download stalled at {final_status['progress']:.1%} after reconnect. "
        "This suggests request clearing on disconnect isn't working."
    )
