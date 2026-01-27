# Upload/Seeding Architecture

Reference document for understanding how uploading and seeding works, with focus on mobile performance considerations.

## Overview

When we have pieces that peers want, they send REQUEST messages and we serve PIECE messages back. This document covers the current implementation and identifies tuning opportunities.

## Current Architecture

### Request Flow

```
Peer sends REQUEST(index, begin, length)
    ↓
peer-connection.ts parses wire protocol
    ↓
torrent-peer-handler.ts:213-215 delegates to uploader
    ↓
torrent-uploader.ts validates and queues
    ↓
drainQueue() loop processes FIFO
    ↓
Rate limit check (token bucket)
    ↓
Async file read
    ↓
Send PIECE message
```

### Key Components

| Component | File | Purpose |
|-----------|------|---------|
| `TorrentUploader` | `core/torrent-uploader.ts` | Queue management, rate limiting, serving pieces |
| `TokenBucket` | `utils/token-bucket.ts` | Bytes/sec rate limiting with burst capacity |
| `UnchokeAlgorithm` | `peer-coordinator/unchoke-algorithm.ts` | BEP 3 tit-for-tat + optimistic slot |
| `BandwidthTracker` | `core/bandwidth-tracker.ts` | Global upload/download buckets |

### Request Validation

Before queueing a request (`torrent-uploader.ts:85-101`):

1. **Choke check**: Reject if peer is choked (`peer.amChoking`)
2. **Piece serveable**: Must be in our bitfield AND not in `.parts` file
3. **Storage ready**: Content storage must be initialized

### Rate Limiting

Token bucket algorithm (`utils/token-bucket.ts`):
- Tokens refill at configured bytes/sec
- Burst capacity = 2 seconds worth by default
- `tryConsume(bytes)` returns false if insufficient tokens
- Drain loop reschedules with calculated delay when rate-limited

### Choking Algorithm (BEP 3)

Implemented in `peer-coordinator/unchoke-algorithm.ts`:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `maxUploadSlots` | 4 | Total peers we'll upload to simultaneously |
| `chokeIntervalMs` | 10,000 | Re-evaluate unchoke decisions every 10s |
| `optimisticIntervalMs` | 30,000 | Rotate optimistic slot every 30s |
| `newPeerThresholdMs` | 60,000 | Peers < 60s old get 3x weight in optimistic selection |

**Slot allocation**:
- N-1 slots: Top downloaders (tit-for-tat reciprocity)
- 1 slot: Optimistic rotation (allows new peers to bootstrap)

When a peer is choked:
- CHOKE message sent immediately
- All queued uploads for that peer are **discarded**
- Peer must wait for next unchoke cycle to request again

## Existing Controls

Settings in `config/config-schema.ts`:

| Setting | Default | Range | Effect |
|---------|---------|-------|--------|
| `uploadSpeedUnlimited` | `true` | bool | Bypass rate limiting |
| `uploadSpeedLimit` | 1 MB/s | ≥1 | Bytes/sec when limited |
| `maxUploadSlots` | 4 | 0-50 | Concurrent upload peers |

**Important**: Setting `maxUploadSlots: 0` makes the client a "pure leecher" - all peers stay choked, no uploads occur.

## Mobile Performance Concerns

### 1. Unbounded Upload Queue

The queue (`TorrentUploader.queue`) has no size limit. If peers send requests faster than we can serve (due to slow I/O or rate limiting), memory grows unboundedly.

**Impact**: Memory pressure on constrained devices.

### 2. No File Read Concurrency Limit

The drain loop is single-threaded but file reads are async. While waiting for one read, the loop can start another. On slow storage, this piles up pending I/O.

**Impact**: I/O saturation, blocking downloads.

### 3. Download vs Upload I/O Contention

Both operations read from disk:
- **Download**: Read pieces for hash verification
- **Upload**: Read pieces to serve to peers

No priority system exists. Upload reads compete equally with download reads.

**Impact**: Download speed degradation while seeding.

### 4. Default Slot Count

4 upload slots is reasonable for desktop but aggressive for mobile where:
- Storage is slower (flash wear, thermal throttling)
- CPU is constrained (QuickJS single-threaded)
- Network may be metered

### 5. No Mode Toggle

Cannot easily say "don't upload while I'm downloading" without setting `maxUploadSlots: 0` and re-enabling later.

## Potential Improvements

### Quick Wins (config changes)

1. **Lower default `maxUploadSlots` on Android** - e.g., 2 instead of 4
2. **Document `maxUploadSlots: 0`** as "download only" mode

### Medium Effort (new settings)

1. **`maxUploadQueueSize`** - Drop oldest/newest requests when queue exceeds limit
2. **`uploadWhileDownloading`** - Boolean to pause uploads when any torrent is incomplete
3. **`maxConcurrentUploadReads`** - Limit in-flight file reads for uploads

### Larger Changes

1. **I/O priority system** - Prefer download reads over upload reads
2. **Per-torrent upload toggle** - Disable uploads for specific torrents
3. **Adaptive slot scaling** - Reduce slots when I/O latency increases

## File Locations

Key files for upload/seeding:

```
packages/engine/src/
├── config/config-schema.ts          # Settings definitions
├── core/
│   ├── torrent-uploader.ts          # Upload queue and serving
│   ├── torrent-peer-handler.ts      # REQUEST message handling
│   ├── torrent-tick-loop.ts         # Choke decision application
│   ├── bandwidth-tracker.ts         # Global rate limit buckets
│   └── torrent-content-storage.ts   # File reads for serving
├── peer-coordinator/
│   └── unchoke-algorithm.ts         # BEP 3 choking logic
└── utils/
    └── token-bucket.ts              # Rate limiting primitive
```

## Debugging

### Check upload state via debug manhole (Android)

```bash
# Get swarm info including upload queue
adb shell am broadcast -a com.jstorrent.DEBUG --es cmd swarm -p com.jstorrent.app

# Evaluate uploader queue length
adb shell am broadcast -a com.jstorrent.DEBUG --es cmd eval \
  --es expr "globalThis.jstorrent?.torrents?.[0]?.uploader?.queueLength" \
  -p com.jstorrent.app
```

### Extension debugging

```javascript
// In ext_evaluate
globalThis.engine?.torrents?.map(t => ({
  name: t.name,
  uploadSpeed: t.uploadSpeed,
  queueLength: t.uploader?.queueLength
}))
```
