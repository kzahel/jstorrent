# Fuzz Testing Scenarios for JSTorrent Engine

## Overview

Use libtorrent (or custom mock peers) to create adversarial conditions that expose bugs in our client. The goal is to test robustness, not just happy-path functionality.

---

## 1. Peer Disconnection Scenarios

### 1.1 Disconnect Mid-Piece
```python
# Seeder sends 50% of blocks for piece 0, then disconnects
# Client should:
# - Clear pending requests for that peer
# - Request remaining blocks from other peers (or re-request when peer reconnects)
# - Not stall

def test_disconnect_mid_piece():
    seeder = MockPeer()
    client.connect(seeder)
    
    # Send partial piece
    for block in piece_0_blocks[:len(piece_0_blocks)//2]:
        seeder.send_block(block)
    
    seeder.disconnect()
    
    # Add new peer
    seeder2 = LibtorrentSeeder()
    client.connect(seeder2)
    
    # Should complete download
    assert wait_for_complete()
```

### 1.2 Disconnect After Sending All Blocks But Before Hash Verified
```python
# Race condition: all blocks received, peer disconnects during hash verification
# Client should still complete the piece

def test_disconnect_during_hash():
    seeder.send_all_blocks_for_piece(0)
    seeder.disconnect()  # Immediately after last block
    
    # Piece should still verify and complete
    assert wait_for_piece_complete(0)
```

### 1.3 Rapid Connect/Disconnect Cycles
```python
# Peer connects, sends a few blocks, disconnects - repeat 10x
# Client should not leak memory or stall

def test_rapid_reconnect():
    for i in range(10):
        seeder.connect()
        seeder.send_random_blocks(count=5)
        seeder.disconnect()
        time.sleep(0.1)
    
    # Should eventually complete with stable seeder
    stable_seeder = LibtorrentSeeder()
    assert wait_for_complete()
```

### 1.4 All Peers Disconnect Simultaneously
```python
# Multiple peers all disconnect at once
# Client should handle gracefully, resume when peers return

def test_all_peers_disconnect():
    peers = [connect_peer() for _ in range(5)]
    wait_for_progress(50)
    
    for peer in peers:
        peer.disconnect()
    
    # All gone - client should be in "stalled" state, not crashed
    assert client.state == 'stalled'
    
    # Reconnect
    new_peer = connect_peer()
    assert wait_for_complete()
```

---

## 2. Corrupt/Malicious Data Scenarios

### 2.1 Send Corrupt Block Data
```python
# Peer sends block with wrong data (will fail hash)
# Client should:
# - Detect hash failure
# - Reset piece
# - Re-request from another peer
# - Optionally mark peer as suspicious

def test_corrupt_block():
    seeder.send_blocks_for_piece(0, corrupt_last_block=True)
    
    # Hash should fail
    assert not piece_verified(0)
    
    # Piece should be reset
    assert client.piece_state(0) == 'incomplete'
    
    # Good seeder should fix it
    good_seeder = LibtorrentSeeder()
    assert wait_for_piece_complete(0)
```

### 2.2 Consistently Corrupt Peer
```python
# One peer always sends bad data, others are good
# Client should eventually get good data

def test_bad_peer_mixed_with_good():
    bad_peer = MockPeer(corrupt_probability=1.0)
    good_peer = LibtorrentSeeder()
    
    # Both connected
    client.connect(bad_peer)
    client.connect(good_peer)
    
    # Should complete despite bad peer
    assert wait_for_complete()
```

### 2.3 Send Unrequested Blocks
```python
# Peer sends blocks we didn't ask for
# Client should ignore or handle gracefully

def test_unrequested_blocks():
    seeder.connect()
    
    # Send blocks for piece we didn't request
    seeder.send_block(piece=99, begin=0, data=random_bytes())
    
    # Client should not crash, should ignore
    assert client.is_healthy()
```

### 2.4 Send Duplicate Blocks
```python
# Same block sent multiple times
# Client should deduplicate

def test_duplicate_blocks():
    for _ in range(5):
        seeder.send_block(piece=0, begin=0, data=correct_data)
    
    # Should only count once
    assert client.piece(0).blocks_received == 1
```

### 2.5 Wrong Piece Index
```python
# Send block claiming to be for piece 0, but we're downloading piece 5
# (Peer sends unrequested piece)

def test_wrong_piece_index():
    client.request_piece(5)
    seeder.send_block(piece=0, begin=0, data=some_data)
    
    # Should not crash, might ignore or buffer
    assert client.is_healthy()
```

---

## 3. Protocol Edge Cases

### 3.1 Malformed Messages
```python
# Send invalid wire protocol messages

def test_malformed_messages():
    seeder.connect()
    seeder.handshake()
    
    # Send garbage
    seeder.send_raw(b'\xff\xff\xff\xff')  # Invalid length prefix
    seeder.send_raw(b'\x00\x00\x00\x01\x99')  # Unknown message type
    seeder.send_raw(b'\x00\x00\x00\x00')  # Zero length (keep-alive, ok)
    seeder.send_raw(b'\x00\x00\x00\x05\x07\x00\x00')  # Truncated PIECE message
    
    # Client should disconnect bad peer, not crash
    assert client.is_healthy()
```

### 3.2 Invalid Block Offset
```python
# Send block with offset that doesn't align to 16KB boundary
# Or offset beyond piece length

def test_invalid_block_offset():
    piece_length = 262144  # 256KB
    
    # Offset beyond piece
    seeder.send_block(piece=0, begin=piece_length + 1000, data=bytes(16384))
    
    # Misaligned offset
    seeder.send_block(piece=0, begin=1000, data=bytes(16384))  # Not 16KB aligned
    
    # Should reject/ignore, not crash
    assert client.is_healthy()
```

### 3.3 Oversized Block
```python
# Send block larger than 16KB (or whatever max)

def test_oversized_block():
    seeder.send_block(piece=0, begin=0, data=bytes(1024 * 1024))  # 1MB block
    
    # Should reject, not buffer 1MB
    assert client.is_healthy()
    assert client.memory_usage < REASONABLE_LIMIT
```

### 3.4 Bitfield Lies
```python
# Peer claims to have pieces they don't have

def test_lying_bitfield():
    # Seeder only has piece 0, but claims to have all
    partial_seeder = MockPeer()
    partial_seeder.set_bitfield(all_ones)  # Lie: claim all pieces
    partial_seeder.actual_pieces = [0]  # Only actually has piece 0
    
    client.connect(partial_seeder)
    
    # Client requests piece 5
    # Seeder can't deliver
    # Client should eventually timeout and try another peer
    
    # Add real seeder
    real_seeder = LibtorrentSeeder()
    assert wait_for_complete()
```

---

## 4. Timing & Timeout Scenarios

### 4.1 Slow Peer (Trickle)
```python
# Peer sends data very slowly - 1 block per 5 seconds
# Client should:
# - Not stall overall download if other peers available
# - Eventually timeout on this peer's requests

def test_slow_peer():
    slow_peer = MockPeer(block_delay=5.0)  # 5 seconds between blocks
    fast_peer = LibtorrentSeeder()
    
    client.connect(slow_peer)
    client.connect(fast_peer)
    
    # Should complete quickly via fast peer
    assert wait_for_complete(timeout=30)  # Not 5 * num_blocks seconds
```

### 4.2 Peer Accepts Connection But Never Sends
```python
# Connect, handshake, then nothing
# Client should timeout

def test_silent_peer():
    silent_peer = MockPeer()
    silent_peer.connect()
    silent_peer.handshake()
    # ... never sends unchoke, never sends data
    
    # Client should timeout and try other peers
    real_peer = LibtorrentSeeder()
    assert wait_for_complete()
```

### 4.3 Peer Sends Unchoke Then Re-Chokes Immediately
```python
# Unchoke/choke rapidly
# Client should handle state changes

def test_rapid_choke_unchoke():
    peer = MockPeer()
    peer.connect()
    peer.handshake()
    
    for _ in range(10):
        peer.send_unchoke()
        time.sleep(0.01)
        peer.send_choke()
        time.sleep(0.01)
    
    assert client.is_healthy()
```

### 4.4 Request Timeout Handling
```python
# Send request, peer never responds
# Client should timeout and re-request

def test_request_timeout():
    peer = MockPeer()
    peer.connect()
    peer.send_unchoke()
    
    # Client sends requests, peer ignores them
    time.sleep(REQUEST_TIMEOUT + 5)
    
    # Requests should be cleared, available for re-request
    assert client.piece(0).pending_requests == 0
```

---

## 5. Piece Edge Cases

### 5.1 Last Piece Smaller Than Others
```python
# Torrent where last piece is only 1KB
# Common edge case

def test_small_last_piece():
    # Create torrent: 256KB pieces, total 513KB
    # Last piece is only 1KB
    torrent = create_torrent(
        size=513 * 1024,
        piece_length=256 * 1024
    )
    
    assert wait_for_complete()
    assert verify_file_hash()
```

### 5.2 Single Piece Torrent
```python
# Entire torrent is one piece

def test_single_piece():
    torrent = create_torrent(size=16384, piece_length=262144)
    # Only 1 piece, 1 block
    
    assert wait_for_complete()
```

### 5.3 Single Block Piece
```python
# Each piece is exactly one block (16KB pieces)

def test_single_block_pieces():
    torrent = create_torrent(size=163840, piece_length=16384)
    # 10 pieces, each is 1 block
    
    assert wait_for_complete()
```

### 5.4 Very Large Piece Size
```python
# 4MB pieces (max typical)

def test_large_pieces():
    torrent = create_torrent(
        size=16 * 1024 * 1024,  # 16MB
        piece_length=4 * 1024 * 1024  # 4MB pieces
    )
    # 4 pieces, each 256 blocks
    
    assert wait_for_complete()
```

### 5.5 First Piece / Last Piece Priority
```python
# First and last pieces often have special handling
# (metadata, preview, etc.)

def test_first_last_piece():
    torrent = create_torrent(size=10 * 1024 * 1024, piece_length=262144)
    
    # Verify first piece completes
    assert wait_for_piece(0)
    
    # Verify last piece completes
    last_piece = torrent.num_pieces - 1
    assert wait_for_piece(last_piece)
```

---

## 6. Resume/Restart Scenarios

### 6.1 Restart With Partial Data
```python
# Download 50%, stop, restart, complete

def test_resume_partial():
    download_until_progress(50)
    engine.stop()
    
    # Verify partial file exists
    assert os.path.exists(partial_file)
    
    engine.start()
    engine.restore_session()
    connect_peer()
    
    assert wait_for_complete()
    assert verify_file_hash()
```

### 6.2 Restart With Corrupt Partial Data
```python
# Partial file on disk, but some bytes corrupted
# Client should detect via hash and re-download bad pieces

def test_resume_corrupt():
    download_until_progress(50)
    engine.stop()
    
    # Corrupt some bytes in downloaded file
    corrupt_file_at_offset(partial_file, offset=1000, bytes=b'\xff' * 100)
    
    engine.start()
    engine.restore_session()
    engine.recheck_torrent()  # Force hash check
    connect_peer()
    
    # Should re-download corrupt pieces
    assert wait_for_complete()
    assert verify_file_hash()  # Final file should be correct
```

### 6.3 Restart With Bitfield But No File
```python
# Bitfield says we have pieces, but file is deleted
# Client should detect and reset

def test_resume_missing_file():
    download_until_progress(50)
    engine.stop()
    
    # Delete the file but keep session state
    os.remove(partial_file)
    
    engine.start()
    engine.restore_session()
    
    # Should detect missing file, reset progress
    # Or recheck should find 0%
```

### 6.4 Stop During Piece Finalization
```python
# Stop exactly when a piece is being hash-verified
# Race condition test

def test_stop_during_finalize():
    # Use mock to pause during sha1()
    with pause_during_hash():
        engine.receive_last_block_of_piece(0)
        engine.stop()
    
    engine.start()
    # Piece 0 should either be complete or need re-download
    # Not in corrupt state
```

---

## 7. Multi-Peer Scenarios

### 7.1 Different Pieces From Different Peers
```python
# Peer A has pieces 0-4, Peer B has pieces 5-9
# Client should download from both

def test_partial_seeders():
    peer_a = MockPeer(has_pieces=[0,1,2,3,4])
    peer_b = MockPeer(has_pieces=[5,6,7,8,9])
    
    client.connect(peer_a)
    client.connect(peer_b)
    
    assert wait_for_complete()
```

### 7.2 Same Block From Multiple Peers (Endgame)
```python
# Near completion, same block requested from multiple peers
# First response wins, others ignored

def test_endgame_duplicate_requests():
    download_until_progress(95)
    
    # Enter endgame - same blocks requested from multiple peers
    peer_a.send_block(piece=last_piece, begin=0, data=correct_data)
    peer_b.send_block(piece=last_piece, begin=0, data=correct_data)
    
    # Should complete, not double-count
    assert wait_for_complete()
```

### 7.3 Fast vs Slow Peer Preference
```python
# Client should prefer requesting from faster peers

def test_peer_speed_preference():
    slow = MockPeer(latency=500)  # 500ms per block
    fast = MockPeer(latency=10)   # 10ms per block
    
    # Track which peer serves more blocks
    # Fast peer should serve most
```

### 7.4 Peer Sends HAVE After We Complete Piece
```python
# Race: we complete piece 0, peer sends HAVE for piece 0
# Should be fine, just redundant

def test_late_have():
    complete_piece(0)
    peer.send_have(0)  # We already have it
    
    assert client.is_healthy()
```

---

## 8. Resource Limit Scenarios

### 8.1 Many Pieces Buffered (Memory Pressure)
```python
# Start many pieces simultaneously
# Client should limit active pieces to avoid OOM

def test_memory_limit():
    # Large torrent, many pieces
    torrent = create_torrent(size=1024*1024*100, piece_length=16384)  # 6000+ pieces
    
    # Connect slow peer that starts many pieces
    slow_peer = MockPeer()
    slow_peer.start_all_pieces_simultaneously()
    
    # Memory should stay bounded
    assert client.active_pieces <= MAX_ACTIVE_PIECES
    assert client.memory_usage < MAX_MEMORY
```

### 8.2 Many Peers Connected
```python
# 100 peers all connected
# Client should handle, maybe limit connections

def test_many_peers():
    peers = [connect_peer() for _ in range(100)]
    
    assert client.is_healthy()
    # Should complete, maybe faster with more peers
    assert wait_for_complete()
```

### 8.3 Disk Full
```python
# Disk runs out of space mid-download

def test_disk_full():
    # Use small tmpfs or mock
    with limited_disk_space(remaining=100*1024):  # 100KB
        torrent = create_torrent(size=1024*1024)  # 1MB
        
        # Should fail gracefully, not crash
        try:
            download()
        except DiskFullError:
            pass
        
        assert client.state == 'error'
        assert 'disk' in client.error_message.lower()
```

---

## 9. Torrent Metadata Scenarios

### 9.1 Magnet Link - Metadata Download
```python
# Download torrent metadata via extension protocol

def test_magnet_metadata():
    magnet = "magnet:?xt=urn:btih:..."
    client.add_magnet(magnet)
    
    peer_with_metadata = LibtorrentSeeder()
    client.connect(peer_with_metadata)
    
    # Should fetch metadata, then download
    assert wait_for_metadata()
    assert wait_for_complete()
```

### 9.2 Metadata Peer Disconnects Mid-Transfer
```python
# Peer disconnects while sending metadata pieces

def test_metadata_disconnect():
    magnet = "magnet:?xt=urn:btih:..."
    client.add_magnet(magnet)
    
    peer = MockPeer()
    peer.send_metadata_piece(0)
    peer.disconnect()  # Before sending all metadata pieces
    
    # Connect new peer, should complete metadata
    peer2 = LibtorrentSeeder()
    assert wait_for_metadata()
```

---

## 10. Multi-File Torrent Scenarios

### 10.1 Pieces Spanning Multiple Files
```python
# One piece contains data from 2 or 3 files
# Common in multi-file torrents

def test_spanning_piece():
    torrent = create_multi_file_torrent([
        ("a.txt", 10000),   # 10KB
        ("b.txt", 10000),   # Piece probably spans a.txt and b.txt
        ("c.txt", 10000),
    ], piece_length=16384)
    
    assert wait_for_complete()
    assert verify_all_files()
```

### 10.2 Skip File (Partial Download)
```python
# User marks one file as "don't download"
# Client should skip pieces for that file (if possible)

def test_skip_file():
    torrent = create_multi_file_torrent([
        ("wanted.txt", 1024*1024),
        ("unwanted.txt", 1024*1024),
    ])
    
    client.set_file_priority("unwanted.txt", 0)  # Don't download
    
    # Should complete with only wanted.txt
    assert wait_for_complete()
    assert os.path.exists("wanted.txt")
    # unwanted.txt might exist partially due to piece spanning
```

### 10.3 Empty Files
```python
# Torrent contains zero-byte files

def test_empty_file():
    torrent = create_multi_file_torrent([
        ("empty.txt", 0),
        ("data.txt", 16384),
    ])
    
    assert wait_for_complete()
    assert os.path.exists("empty.txt")
    assert os.path.getsize("empty.txt") == 0
```

---

## Implementation Notes

### Using Libtorrent as Adversarial Peer

Libtorrent can be configured to behave badly:
```python
settings = lt.settings_pack()
settings.set_bool(lt.settings_pack.allow_multiple_connections_per_ip, True)
settings.set_int(lt.settings_pack.upload_rate_limit, 1000)  # Slow upload
# etc.
```

### Building a Mock Peer

For fine-grained control, build a mock peer:
```python
class MockPeer:
    def __init__(self):
        self.socket = socket.socket()
    
    def connect(self, host, port):
        self.socket.connect((host, port))
    
    def handshake(self, info_hash, peer_id):
        msg = b'\x13BitTorrent protocol' + b'\x00'*8 + info_hash + peer_id
        self.socket.send(msg)
    
    def send_block(self, piece, begin, data):
        payload = struct.pack('>I', piece) + struct.pack('>I', begin) + data
        msg = struct.pack('>I', len(payload) + 1) + b'\x07' + payload
        self.socket.send(msg)
    
    def send_corrupt_block(self, piece, begin, length):
        self.send_block(piece, begin, os.urandom(length))
    
    def disconnect(self):
        self.socket.close()
```

### Test Harness Structure

```
tests/fuzz/
├── run_fuzz_tests.py
├── mock_peer.py
├── scenarios/
│   ├── disconnect.py
│   ├── corrupt_data.py
│   ├── timing.py
│   ├── protocol.py
│   └── ...
└── README.md
```

---

## Priority Order for Implementation

1. **Disconnect mid-piece** - This was our actual bug
2. **Request timeout handling** - Related to the bug
3. **Corrupt block / hash failure** - Common real-world issue
4. **Resume with partial data** - Already have test, extend it
5. **Multi-peer scenarios** - Important for real usage
6. **Protocol malformed messages** - Security hardening
7. **Resource limits** - Stability
8. **Everything else** - Edge cases
