# Fix Piece Buffering Stall Issue

### THIS IDEA DIDNT WORK FULLY


## Problem

Downloads stall because:
1. `requestPieces` requests blocks from ANY missing piece (e.g., pieces 0-50)
2. `PieceBufferManager` only allows 20 active pieces
3. When piece 21+ arrives, it's dropped ("at capacity")
4. Pieces 0-20 never complete because blocks for them are scattered among many pieces
5. Deadlock: can't make room because no pieces complete, can't complete because no room

## Legacy JSTorrent Implementation Analysis

The legacy implementation in `legacy-jstorrent-engine/js/` had several key mechanisms:

### 1. Per-Peer Outstanding Request Limit (`peerconnection.js:501`)
```javascript
while (this.outstandingPieceChunkRequestCount < this._attributes.limit) {
    payloads = curPiece.getChunkRequestsForPeer(2, this)  // Only 2 chunks at a time per piece
    // ...
    this.outstandingPieceChunkRequestCount += payloads.length
}
```

### 2. Global Memory Backpressure (`peerconnection.js:472`)
```javascript
if (this.torrent.unflushedPieceDataSize > this.torrent.unflushedPieceDataSizeLimit) {
    console.clog(L.DEV,'not requesting more pieces -- need disk io to write out more first')
    return
}
```

### 3. Skip Pieces With Complete Data In Memory (`peerconnection.js:499`)
```javascript
if (curPiece.haveData) { continue }  // we have the data, just haven't hashed/persisted yet
```

### 4. Sequential Piece Selection with `bitfieldFirstMissing` (`peerconnection.js:491-495`)
```javascript
var startAtPiece = this.torrent.bitfieldFirstMissing
for (var pieceNum=startAtPiece; pieceNum<this.torrent.numPieces; pieceNum++) {
    if (this.peerBitfield[pieceNum] && ! this.torrent.havePieceData(pieceNum)) {
```

### 5. Piece State Tracking (`piece.js:76-111`)
- `haveData` - All chunks received, in memory waiting for hash check
- `haveValidData` - Hash verified
- `haveDataPersisted` - Written to disk
- `chunkRequests` / `chunkResponses` - Track per-chunk state

### 6. Endgame Mode (`piece.js:449-478`)
When near completion, allows duplicate requests to different peers for same chunks.

## Root Cause

The new implementation dropped the backpressure mechanism. It should:
1. **Track unflushed data size** and stop requesting when too high
2. **Skip pieces already buffered** (equivalent to `curPiece.haveData` check)
3. **Per-peer request limits** rather than global limits

## Applied Fix

The minimal fix has been applied to `packages/engine/src/core/torrent.ts`:

```typescript
private requestPieces(peer: PeerConnection) {
  if (peer.peerChoking) {
    console.log('Torrent: Peer is choking, cannot request')
    return
  }

  if (!this.pieceManager) return
  const missing = this.pieceManager.getMissingPieces()
  this.logger.debug(`Missing pieces: ${missing.length}`)

  const MAX_PIPELINE = 200
  const MAX_ACTIVE_PIECES = 20 // Match PieceBufferManager limit

  // Track how many distinct NEW pieces we'd be starting
  let newPiecesStarted = 0
  const currentlyBuffered = this.pieceBufferManager?.activeCount || 0

  for (const index of missing) {
    if (peer.requestsPending >= MAX_PIPELINE) break

    // Skip pieces that are complete in buffer (waiting for hash/flush)
    // This is the equivalent of legacy's "curPiece.haveData" check
    const existingBuffer = this.pieceBufferManager?.get(index)
    if (existingBuffer?.isComplete()) {
      continue // Already have all data, just waiting for finalization
    }

    // Check if starting this piece would exceed buffer capacity
    const isNewPiece = !existingBuffer
    if (isNewPiece) {
      if (currentlyBuffered + newPiecesStarted >= MAX_ACTIVE_PIECES) {
        continue // Would exceed buffer limit
      }
    }

    const hasPiece = peer.bitfield?.get(index)

    if (hasPiece) {
      const neededBlocks = this.pieceManager.getNeededBlocks(index)
      if (neededBlocks.length > 0) {
        if (isNewPiece) {
          newPiecesStarted++
        }

        for (const block of neededBlocks) {
          if (peer.requestsPending >= MAX_PIPELINE) break

          if (this.pieceManager.isBlockRequested(index, block.begin)) continue

          peer.sendRequest(index, block.begin, block.length)
          peer.requestsPending++
          this.pieceManager?.addRequested(index, block.begin)
        }
      }
    }
  }
}
```

**Key changes:**
1. **Skip pieces complete in buffer** (`existingBuffer?.isComplete()`) - Don't request more for pieces waiting for hash/flush
2. **Limit new piece starts** - Don't start more pieces than buffer can hold
3. **Track buffered count** - Use `activeCount` from PieceBufferManager

## Future Improvements (Not Critical)
