# Detect V2 Hybrid Torrent Connections

## Overview

When a v1-only client accidentally connects to a hybrid torrent swarm using a truncated v2 info hash (first 20 bytes of SHA256), the connection succeeds but downloads stall indefinitely. This is because piece indices don't align between v1 and v2 views of the same torrent.

BEP 52 specifies that peers connecting with truncated v2 hash SHOULD include `info_hash2` (the full 32-byte SHA256) in their extended handshake (BEP 10). We can detect this field and handle the situation gracefully.

**Goal:** Detect when we've accidentally connected with a truncated v2 hash, log a clear warning, and disconnect immediately rather than stalling forever.

## Background

### The Problem

libtorrent's Python API returns `str(torrent.info_hash())` as the truncated v2 hash for hybrid torrents, not the v1 hash. This looks like a valid 20-byte info hash and is easy to use accidentally.

```python
# WRONG - truncated v2 for hybrid torrents
info_hash = str(t.info_hash())

# CORRECT - explicit v1 hash
info_hash = str(t.info_hash().v1)
```

When JSTorrent connects with truncated v2:
1. Handshake succeeds (libtorrent accepts both hash types)
2. Extended handshake completes
3. No piece exchange happens (piece indices mismatch)
4. Connection appears "stalled" with no errors

### Detection Signals

1. **Reserved byte 7, bit 0x10** — Peer supports v2 (yellow flag, not conclusive)
2. **`info_hash2` in extended handshake** — We connected with truncated v2 (definitive)

### Extended Handshake Format (BEP 10)

```
{
  "m": {"ut_metadata": 1, "ut_pex": 2, ...},
  "v": "libtorrent/2.0.9",
  "info_hash2": <32 bytes>   // ← Present if connected with truncated v2
}
```

## Phase 1: Parse info_hash2 in Extended Handshake

### 1.1 Update extended handshake type definitions

Find the extended handshake interface (likely in `packages/engine/src/protocol/` or similar):

```typescript
// Add to existing ExtendedHandshake interface
interface ExtendedHandshake {
  m?: Record<string, number>
  v?: string
  p?: number
  reqq?: number
  // ... existing fields ...
  
  // BEP 52: Present when peer connected with truncated v2 info hash
  info_hash2?: Uint8Array  // 32 bytes, full SHA256
}
```

### 1.2 Update bencode parsing for info_hash2

Ensure the extended handshake parser handles the binary `info_hash2` field. It's a raw 32-byte value, not hex-encoded.

Find where extended handshake is decoded (likely near `ut_metadata` handling):

```typescript
function parseExtendedHandshake(data: Uint8Array): ExtendedHandshake {
  const decoded = bencodeDecode(data)
  
  return {
    m: decoded.m,
    v: decoded.v ? textDecoder.decode(decoded.v) : undefined,
    p: decoded.p,
    reqq: decoded.reqq,
    // ... existing fields ...
    
    // info_hash2 is raw bytes, keep as Uint8Array
    info_hash2: decoded.info_hash2,
  }
}
```

## Phase 2: Detect and Handle Truncated V2 Connections

### 2.1 Add detection logic in peer connection

After receiving extended handshake, check for `info_hash2`:

```typescript
// In PeerConnection class, after parsing extended handshake

private handleExtendedHandshake(handshake: ExtendedHandshake): void {
  // ... existing handling ...

  // BEP 52: info_hash2 presence means we connected with truncated v2 hash
  if (handshake.info_hash2) {
    this.handleTruncatedV2Connection(handshake.info_hash2)
    return
  }
  
  // ... continue normal flow ...
}

private handleTruncatedV2Connection(fullV2Hash: Uint8Array): void {
  const v2Hex = bytesToHex(fullV2Hash)
  const truncatedHex = bytesToHex(fullV2Hash.slice(0, 20))
  
  this.logger.warn(
    'Connected with truncated v2 info hash. This is a hybrid torrent. ' +
    'Piece indices will not align. Disconnecting. ' +
    `Full v2 hash: ${v2Hex}, truncated (what we used): ${truncatedHex}. ` +
    'Use the v1 info hash instead.'
  )
  
  // Emit event for potential UI notification
  this.emit('truncated-v2-detected', {
    fullV2Hash: v2Hex,
    truncatedHash: truncatedHex,
    peerAddr: this.remoteAddress,
  })
  
  // Disconnect immediately - no point continuing
  this.destroy(new Error('Connected with truncated v2 hash to hybrid torrent'))
}
```

### 2.2 Add event type for detection

```typescript
// In peer connection event types
interface PeerConnectionEvents {
  // ... existing events ...
  
  'truncated-v2-detected': {
    fullV2Hash: string
    truncatedHash: string
    peerAddr: string
  }
}
```

### 2.3 Optional: Surface to Torrent/Engine level

If all peers for a torrent report `truncated-v2-detected`, the torrent itself is misconfigured:

```typescript
// In Torrent class
private truncatedV2Count = 0
private readonly TRUNCATED_V2_THRESHOLD = 3

private onPeerTruncatedV2(event: TruncatedV2Event): void {
  this.truncatedV2Count++
  
  if (this.truncatedV2Count >= this.TRUNCATED_V2_THRESHOLD) {
    this.logger.error(
      `Multiple peers (${this.truncatedV2Count}) report truncated v2 hash. ` +
      'This torrent was likely added with wrong info hash. ' +
      'Check magnet link or .torrent file for v1 hash.'
    )
    
    // Could emit to engine/UI for user notification
    this.emit('likely-wrong-infohash', {
      currentHash: this.infoHashHex,
      suggestedV2Hash: event.fullV2Hash,
    })
  }
}
```

## Phase 3: Python Integration Test

### 3.1 Create test file

Create `packages/engine/integration/python/test_v2_hybrid_detection.py`:

```python
#!/usr/bin/env python3
"""
Test that JSTorrent detects and handles truncated v2 info hash connections.

Scenario:
1. Create a v2 hybrid torrent with libtorrent
2. Start seeding with libtorrent
3. Connect JSTorrent using the TRUNCATED v2 hash (simulating the bug)
4. Verify JSTorrent detects info_hash2 and disconnects gracefully
5. Verify appropriate warning is logged
"""

import os
import sys
import tempfile
import time
import libtorrent as lt

# Add parent to path for shared utilities
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from python.test_utils import (
    create_test_file,
    create_torrent,
    start_jstorrent_engine,
    wait_for_log_message,
    JSTorrentEngine,
)


def create_v2_hybrid_torrent(file_path: str, torrent_path: str) -> lt.torrent_info:
    """Create a v2 hybrid torrent (has both v1 and v2 hashes)."""
    fs = lt.file_storage()
    fs.add_file(os.path.basename(file_path), os.path.getsize(file_path))
    
    ct = lt.create_torrent(fs, flags=lt.create_torrent.v2_only | lt.create_torrent.v1_only)
    # Note: v2_only | v1_only = hybrid (confusing but true)
    
    ct.set_creator("jstorrent-test")
    lt.set_piece_hashes(ct, os.path.dirname(file_path))
    
    torrent_data = ct.generate()
    with open(torrent_path, 'wb') as f:
        f.write(lt.bencode(torrent_data))
    
    return lt.torrent_info(torrent_path)


def test_truncated_v2_detection():
    """
    Test that connecting with truncated v2 hash is detected via info_hash2.
    """
    with tempfile.TemporaryDirectory() as tmpdir:
        # Create test content
        test_file = os.path.join(tmpdir, "test_content.bin")
        create_test_file(test_file, size=64 * 1024)  # 64KB
        
        torrent_path = os.path.join(tmpdir, "hybrid.torrent")
        torrent_info = create_v2_hybrid_torrent(test_file, torrent_path)
        
        # Verify it's actually a hybrid
        ih = torrent_info.info_hash()
        assert ih.has_v1(), "Torrent should have v1 hash"
        assert ih.has_v2(), "Torrent should have v2 hash"
        
        v1_hash = str(ih.v1)
        v2_hash_full = ih.v2.to_bytes().hex()
        v2_hash_truncated = str(ih)  # This is the truncated v2!
        
        print(f"V1 hash:           {v1_hash}")
        print(f"V2 hash (full):    {v2_hash_full}")
        print(f"V2 hash (trunc):   {v2_hash_truncated}")
        
        # These should differ for a hybrid torrent
        assert v1_hash != v2_hash_truncated, \
            "V1 and truncated V2 should differ for hybrid torrents"
        
        # Start libtorrent seeder
        ses = lt.session({'listen_interfaces': '127.0.0.1:16881'})
        ses.apply_settings({
            'enable_dht': False,
            'enable_lsd': False,
            'enable_natpmp': False,
            'enable_upnp': False,
        })
        
        handle = ses.add_torrent({
            'ti': torrent_info,
            'save_path': tmpdir,
            'flags': lt.torrent_flags.seed_mode,
        })
        
        # Wait for seeder to be ready
        while handle.status().state != lt.torrent_status.seeding:
            time.sleep(0.1)
        
        print("Libtorrent seeder ready")
        
        # Start JSTorrent engine with the WRONG hash (truncated v2)
        # This simulates the bug where str(info_hash()) was used
        engine = start_jstorrent_engine()
        
        try:
            # Add torrent with truncated v2 hash and peer hint
            magnet = f"magnet:?xt=urn:btih:{v2_hash_truncated}&x.pe=127.0.0.1:16881"
            engine.add_magnet(magnet)
            
            print(f"Added magnet with truncated v2 hash: {v2_hash_truncated}")
            
            # Wait for the detection log message
            detected = wait_for_log_message(
                engine,
                "Connected with truncated v2 info hash",
                timeout=10.0
            )
            
            assert detected, \
                "JSTorrent should detect truncated v2 connection via info_hash2"
            
            # Verify connection was dropped
            time.sleep(1)
            torrent = engine.get_torrent(v2_hash_truncated)
            assert torrent.connected_peers == 0, \
                "Should have disconnected from peer after detecting truncated v2"
            
            print("✓ Truncated v2 detection working correctly")
            
        finally:
            engine.shutdown()
            ses.remove_torrent(handle)


def test_v1_hash_works_normally():
    """
    Control test: connecting with actual v1 hash should work fine.
    """
    with tempfile.TemporaryDirectory() as tmpdir:
        # Create test content
        test_file = os.path.join(tmpdir, "test_content.bin")
        create_test_file(test_file, size=64 * 1024)
        
        torrent_path = os.path.join(tmpdir, "hybrid.torrent")
        torrent_info = create_v2_hybrid_torrent(test_file, torrent_path)
        
        ih = torrent_info.info_hash()
        v1_hash = str(ih.v1)  # Correct hash to use
        
        # Start libtorrent seeder
        ses = lt.session({'listen_interfaces': '127.0.0.1:16882'})
        ses.apply_settings({
            'enable_dht': False,
            'enable_lsd': False,
            'enable_natpmp': False,
            'enable_upnp': False,
        })
        
        handle = ses.add_torrent({
            'ti': torrent_info,
            'save_path': tmpdir,
            'flags': lt.torrent_flags.seed_mode,
        })
        
        while handle.status().state != lt.torrent_status.seeding:
            time.sleep(0.1)
        
        print("Libtorrent seeder ready")
        
        engine = start_jstorrent_engine()
        
        try:
            # Add with correct v1 hash
            magnet = f"magnet:?xt=urn:btih:{v1_hash}&x.pe=127.0.0.1:16882"
            engine.add_magnet(magnet)
            
            print(f"Added magnet with v1 hash: {v1_hash}")
            
            # Should connect and start downloading normally
            success = engine.wait_for_download_complete(
                v1_hash,
                timeout=30.0
            )
            
            assert success, "Download should complete with correct v1 hash"
            print("✓ V1 hash connection works correctly")
            
        finally:
            engine.shutdown()
            ses.remove_torrent(handle)


if __name__ == "__main__":
    print("=" * 60)
    print("Test: Truncated V2 Info Hash Detection")
    print("=" * 60)
    
    test_truncated_v2_detection()
    
    print()
    print("=" * 60)
    print("Test: V1 Hash Works Normally (Control)")
    print("=" * 60)
    
    test_v1_hash_works_normally()
    
    print()
    print("All tests passed!")
```

### 3.2 Add to test runner

Update `packages/engine/integration/python/run_tests.py`:

```python
# Add to TEST_MODULES list
TEST_MODULES = [
    # ... existing tests ...
    'test_v2_hybrid_detection',
]
```

### 3.3 Utility function for hybrid torrent creation

If `test_utils.py` doesn't have hybrid torrent creation, add:

```python
def create_v2_hybrid_torrent(content_path: str, output_path: str) -> 'lt.torrent_info':
    """
    Create a v2 hybrid torrent (contains both v1 and v2 metadata).
    
    Args:
        content_path: Path to file or directory to create torrent from
        output_path: Where to write .torrent file
        
    Returns:
        libtorrent.torrent_info for the created torrent
    """
    import libtorrent as lt
    
    fs = lt.file_storage()
    if os.path.isfile(content_path):
        fs.add_file(os.path.basename(content_path), os.path.getsize(content_path))
        base_path = os.path.dirname(content_path)
    else:
        lt.add_files(fs, content_path)
        base_path = os.path.dirname(content_path)
    
    # v1_only | v2_only = hybrid
    flags = lt.create_torrent.v1_only | lt.create_torrent.v2_only
    ct = lt.create_torrent(fs, flags=flags)
    ct.set_creator("jstorrent-test")
    lt.set_piece_hashes(ct, base_path)
    
    torrent_data = ct.generate()
    with open(output_path, 'wb') as f:
        f.write(lt.bencode(torrent_data))
    
    return lt.torrent_info(output_path)
```

## Phase 4: Update Existing Tests

### 4.1 Fix any tests using str(info_hash())

Search for patterns like:

```python
# WRONG
info_hash = str(torrent_info.info_hash())

# CORRECT
ih = torrent_info.info_hash()
if ih.has_v1():
    info_hash = str(ih.v1)
else:
    info_hash = str(ih)  # v2-only torrent, truncated is fine
```

Add a helper function:

```python
def get_v1_info_hash(torrent_info: 'lt.torrent_info') -> str:
    """
    Get the v1 info hash from a torrent, handling hybrid torrents correctly.
    
    Raises ValueError if torrent is v2-only (no v1 hash available).
    """
    ih = torrent_info.info_hash()
    if ih.has_v1():
        return str(ih.v1)
    raise ValueError(
        "Torrent has no v1 hash (v2-only). "
        "JSTorrent currently only supports v1 torrents."
    )
```

## Verification

### Manual Testing

1. Create a hybrid torrent with libtorrent CLI:
   ```bash
   # Create hybrid torrent
   python3 -c "
   import libtorrent as lt
   fs = lt.file_storage()
   fs.add_file('test.bin', 65536)
   ct = lt.create_torrent(fs, flags=lt.create_torrent.v1_only | lt.create_torrent.v2_only)
   # ... set piece hashes, save torrent
   "
   ```

2. Start libtorrent seeding the hybrid torrent

3. In JSTorrent, add magnet with truncated v2 hash

4. Observe:
   - Connection established briefly
   - Log warning about truncated v2 detection
   - Connection dropped
   - No stalled download

### Automated Testing

```bash
cd packages/engine/integration/python
python test_v2_hybrid_detection.py
```

### Unit Tests

Add unit test for extended handshake parsing:

```typescript
// packages/engine/test/protocol/extended-handshake.test.ts

describe('Extended Handshake', () => {
  it('should parse info_hash2 field', () => {
    const v2Hash = new Uint8Array(32).fill(0xAB)
    const handshake = {
      m: { ut_metadata: 1 },
      v: 'libtorrent/2.0.9',
      info_hash2: v2Hash,
    }
    const encoded = bencodeEncode(handshake)
    
    const parsed = parseExtendedHandshake(encoded)
    
    expect(parsed.info_hash2).toEqual(v2Hash)
  })
  
  it('should not have info_hash2 for v1-only connections', () => {
    const handshake = {
      m: { ut_metadata: 1 },
      v: 'libtorrent/2.0.9',
    }
    const encoded = bencodeEncode(handshake)
    
    const parsed = parseExtendedHandshake(encoded)
    
    expect(parsed.info_hash2).toBeUndefined()
  })
})
```

## Notes

- This is defensive detection only. The real fix is ensuring magnets/torrents are added with correct v1 hash from the start.
- DHT with truncated v2 will return peers from the v2 swarm, not v1. All those peers would trigger this detection.
- Consider future work: if we detect truncated v2 and have the full v2 hash via `info_hash2`, we could potentially look up the v1 hash from metadata exchange... but that's complex and probably not worth it.

## References

- [BEP 10: Extension Protocol](https://www.bittorrent.org/beps/bep_0010.html)
- [BEP 52: BitTorrent v2](https://www.bittorrent.org/beps/bep_0052.html)
- [libtorrent info_hash_t documentation](https://libtorrent.org/reference-Core.html#info_hash_t)
