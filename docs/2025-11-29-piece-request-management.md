# Piece Request Management: Problem Analysis and Design

## Current Problem

The Python integration tests are failing - downloads stall after engine restart. The test flow:
1. Start download, get to ~15-20% progress
2. Stop engine (simulating crash)
3. Restart engine, restore session from persisted bitfield
4. Connect to peer again
5. **Download stalls** - progress doesn't advance

(great test for this: `.venv/bin/pytest  -v -s test_resume.py`)

## Root Cause Analysis

The issue is in **request state management**. When downloading:
1. We send REQUEST messages to peers for specific blocks (16KB chunks of pieces)
2. We track which blocks are "requested" to avoid duplicate requests
3. Peer responds with PIECE messages containing the data
4. When all blocks for a piece arrive, we hash-verify and write to disk

**The stall happens because:**
- Requests were marked as "requested" before shutdown
- Or requests are marked but the peer disconnects before responding
- The `isBlockRequested()` check returns true for these stale requests
- We skip requesting those blocks, thinking someone will respond
- Nobody responds → download stalls

## Architecture Overview

### Current Request Flow

```
requestPieces(peer)
  → getMissingPieces()           // Pieces not yet verified
  → getNeededBlocks(pieceIndex)  // Blocks not yet received for this piece
  → isBlockRequested(index, begin) // Check if already requested
  → peer.sendRequest(index, begin, length)
  → pieceManager.addRequested(index, begin)  // Mark as requested

handleBlock(peer, msg)
  → pieceBufferManager.getOrCreate(index)
  → buffer.addBlock(begin, data, peerId)
  → pieceManager.addReceived(index, begin)   // Mark block as received
  → if buffer.isComplete() → finalizePiece()

finalizePiece(index, buffer)
  → buffer.assemble()            // Combine all blocks
  → sha1(pieceData)              // Hash verify
  → contentStorage.writePiece()  // Write to disk
  → pieceManager.markVerified()  // Update bitfield
  → pieceBufferManager.remove()  // Free buffer
```

### Key State Tracked

**Per-Piece State (in PieceManager):**
- `blocks: BitField` - Which blocks have been received
- `requested: BitField` - Which blocks have been requested (PROBLEM AREA)
- `isComplete: boolean` - All blocks received

**Global State:**
- `bitfield: BitField` - Which pieces are verified complete
- `PieceBufferManager` - In-memory buffers for pieces being downloaded

### The Request Tracking Problem

The `requested` bitfield is **never cleared** except:
- When a piece is reset (hash failure)
- When explicitly cleared (new methods added but not fully wired up)

**Missing clearing scenarios:**
1. Peer disconnects → requests to that peer will never be fulfilled
2. Request times out → should be re-requestable
3. Engine restarts → all request state should be fresh

## Legacy JSTorrent Approach

The legacy implementation (`legacy-jstorrent-engine/js/`) solved this elegantly:

### 1. Lazy Piece Object Instantiation

```javascript
getPiece: function(num) {
    var piece = this.pieces.get(num)
    if (!piece) {
        piece = new jstorrent.Piece({torrent:this, num:num})
        this.pieces.add(piece)
    }
    return piece
}
```

Only pieces being actively downloaded have Piece objects. This:
- Keeps memory low for large torrents
- Makes it easy to reason about "active" pieces
- Provides stable object references for state tracking

### 2. Per-Chunk Request Tracking with Peer Association

```javascript
// piece.js
this.chunkRequests = {}  // chunkNum → [{time, peerconn}, ...]
this.chunkResponses = {} // chunkNum → [{data, peerconn}, ...]

registerChunkRequestForPeer: function(peerconn, chunkNum, chunkOffset, chunkSize) {
    if (!this.chunkRequests[chunkNum]) {
        this.chunkRequests[chunkNum] = []
    }
    this.chunkRequests[chunkNum].push({time: new Date(), peerconn: peerconn})
}
```

Each request tracks:
- **Which peer** it was sent to
- **When** it was sent (for timeout detection)

### 3. Timeout-Based Request Expiry

```javascript
// Set timeout when making requests
var id = setTimeout(
    this.torrent.checkPieceChunkTimeouts.bind(this.torrent, this.num, chunkNums),
    timeoutInterval
)

// Check and clear stale requests
checkPieceChunkTimeouts: function(pieceNum, chunkNums) {
    var piece = this.getPiece(pieceNum)
    piece.checkChunkTimeouts(chunkNums)
}
```

Requests automatically expire after a configurable timeout, allowing re-request.

### 4. Response Tracking with Peer Association

```javascript
registerChunkResponseFromPeer: function(peerconn, chunkOffset, data) {
    // Decrement peer's outstanding count
    peerconn.outstandingPieceChunkRequestCount--
    
    // Store response with peer info (for endgame/suspicious peer tracking)
    this.chunkResponses[chunkNum].push({data: data, peerconn: peerconn})
}
```

### 5. Per-Peer Outstanding Request Limits

```javascript
// peerconnection.js
this.outstandingPieceChunkRequestCount = 0

while (this.outstandingPieceChunkRequestCount < this._attributes.limit) {
    payloads = curPiece.getChunkRequestsForPeer(2, this)
    this.outstandingPieceChunkRequestCount += payloads.length
}
```

Each peer has its own limit, allowing fast peers to have more in-flight requests.

### 6. Memory Backpressure

```javascript
if (this.torrent.unflushedPieceDataSize > this.torrent.unflushedPieceDataSizeLimit) {
    console.log('not requesting more pieces -- need disk io to write out more first')
    return
}
```

Stop requesting when too much data is buffered awaiting disk write.

### 7. Endgame Mode

When near completion, allow duplicate requests to different peers:

```javascript
if (this.torrent.isEndgame) {
    if (this.chunkRequests[chunkNum].length < endgameDuplicateRequests) {
        // Allow requesting same chunk from multiple peers
        willRequestThisChunk = true
    }
}
```

## Recommended Solution

### Option A: Minimal Fix - Timeout-Based Request Clearing

Add a simple timeout mechanism:

```typescript
interface PendingRequest {
  pieceIndex: number
  blockBegin: number
  peerId: string
  timestamp: number
}

class RequestTracker {
  private pending: Map<string, PendingRequest> = new Map()
  private timeoutMs: number = 30000  // 30 second timeout
  
  private key(pieceIndex: number, blockBegin: number): string {
    return `${pieceIndex}:${blockBegin}`
  }
  
  addRequest(pieceIndex: number, blockBegin: number, peerId: string): void {
    this.pending.set(this.key(pieceIndex, blockBegin), {
      pieceIndex, blockBegin, peerId, timestamp: Date.now()
    })
  }
  
  removeRequest(pieceIndex: number, blockBegin: number): void {
    this.pending.delete(this.key(pieceIndex, blockBegin))
  }
  
  isRequested(pieceIndex: number, blockBegin: number): boolean {
    const req = this.pending.get(this.key(pieceIndex, blockBegin))
    if (!req) return false
    
    // Check if timed out
    if (Date.now() - req.timestamp > this.timeoutMs) {
      this.pending.delete(this.key(pieceIndex, blockBegin))
      return false
    }
    return true
  }
  
  clearRequestsForPeer(peerId: string): void {
    for (const [key, req] of this.pending) {
      if (req.peerId === peerId) {
        this.pending.delete(key)
      }
    }
  }
  
  clearAll(): void {
    this.pending.clear()
  }
}
```

### Option B: Full Piece Object Model (Like Legacy)

Create proper Piece objects that track all state:

```typescript
class ActivePiece {
  readonly index: number
  readonly torrent: Torrent
  
  // Block state
  private blocksReceived: BitField
  private blockData: Map<number, Uint8Array> = new Map()
  
  // Request tracking with peer + time
  private blockRequests: Map<number, {peerId: string, time: number}[]> = new Map()
  
  // Computed state
  get isComplete(): boolean { ... }
  get haveData(): boolean { ... }  // All blocks received, waiting for hash
  
  // Methods
  registerRequest(blockIndex: number, peerId: string): void
  registerResponse(blockIndex: number, data: Uint8Array, peerId: string): void
  getNeededBlocksForPeer(peerId: string, maxBlocks: number): BlockRequest[]
  checkTimeouts(timeoutMs: number): void
  clearRequestsForPeer(peerId: string): void
}

class ActivePieceManager {
  private pieces: Map<number, ActivePiece> = new Map()
  
  getOrCreate(index: number): ActivePiece {
    let piece = this.pieces.get(index)
    if (!piece) {
      piece = new ActivePiece(index, this.torrent)
      this.pieces.add(piece)
    }
    return piece
  }
  
  remove(index: number): void {
    this.pieces.delete(index)
  }
}
```

### Option C: Hybrid - Keep Current Structure, Add Request Tracker

Keep `PieceManager` and `PieceBufferManager`, but replace the simple `requested` BitField with a proper `RequestTracker`:

```typescript
// In Torrent class
private requestTracker: RequestTracker

// In requestPieces()
if (this.requestTracker.isRequested(index, block.begin)) continue
peer.sendRequest(index, block.begin, block.length)
this.requestTracker.addRequest(index, block.begin, peerId)

// In handleBlock()
this.requestTracker.removeRequest(msg.index, msg.begin)

// In removePeer()
this.requestTracker.clearRequestsForPeer(peer.id)

// Periodic cleanup
setInterval(() => this.requestTracker.cleanupStale(), 10000)
```

## Configuration Knobs Needed

```typescript
interface RequestConfig {
  // Timeout for individual block requests
  requestTimeoutMs: number  // default: 30000 (30 seconds)
  
  // How often to check for stale requests
  cleanupIntervalMs: number  // default: 10000 (10 seconds)
  
  // Per-peer limits
  maxRequestsPerPeer: number  // default: 100-200
  
  // Global limits
  maxActivePieces: number     // default: 20
  maxUnflushedBytes: number   // default: 16MB
  
  // Endgame
  endgameThreshold: number    // default: 0.95 (95% complete)
  endgameDuplicateRequests: number  // default: 2
}
```

## Key Invariants to Maintain

1. **No orphaned requests** - Every request must either:
   - Receive a response
   - Time out and be cleared
   - Be cleared when peer disconnects

2. **No duplicate active requests** - Don't request the same block twice (except endgame)

3. **Memory bounded** - Don't buffer more pieces than `maxActivePieces`

4. **Backpressure** - Stop requesting when disk I/O can't keep up

5. **Progress guaranteed** - If peers are available and have pieces we need, download must advance

## Testing Strategy

The Python tests use libtorrent as a reference implementation:
1. libtorrent seeds a file
2. JSTorrent engine downloads
3. Verify file matches

Key test scenarios:
- `test_handshake.py` - Basic peer connection
- `test_download.py` - Full download completion
- `test_resume.py` - **Currently failing** - Stop/restart mid-download

To debug, add logging for:
- When requests are made: `REQUEST piece=${index} block=${begin} peer=${peerId}`
- When responses arrive: `PIECE piece=${index} block=${begin}`
- When requests time out: `TIMEOUT piece=${index} block=${begin}`
- When pieces complete: `COMPLETE piece=${index}`

## Files to Modify

1. **`packages/engine/src/core/piece-manager.ts`**
   - Replace `requested` BitField with proper tracking
   - Or add `RequestTracker` class

2. **`packages/engine/src/core/torrent.ts`**
   - Update `requestPieces()` to use new tracking
   - Update `handleBlock()` to clear requests on response
   - Update `removePeer()` to clear requests for that peer
   - Add periodic timeout checking

3. **`packages/engine/src/core/piece-buffer.ts`** / **`piece-buffer-manager.ts`**
   - May need integration with request tracking

## Success Criteria

1. All Python tests pass, especially `test_resume.py`
2. Downloads complete without stalling
3. Memory usage stays bounded
4. No duplicate requests (except intentional endgame)
5. Reasonable throughput (not optimized, but functional)

## Debugging Tips

If downloads stall:
1. Check if `requestPieces` is being called → add logging
2. Check if requests are being skipped due to `isBlockRequested` → log skip reasons  
3. Check if responses are being received → log in `handleBlock`
4. Check if pieces are completing → log in `finalizePiece`
5. Check peer connection state → is peer still connected? choking?

The legacy codebase had excellent real-time visualization of all this state, which made debugging much easier. Consider adding detailed logging that shows:
- Number of active pieces
- Pending requests per piece
- Peer connection states
- Buffer memory usage
