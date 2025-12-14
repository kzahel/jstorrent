# Endgame Mode Implementation

## Overview

Implement BitTorrent endgame mode to accelerate the final phase of downloads. When all remaining pieces have outstanding requests, we send duplicate requests to multiple peers and cancel redundant requests when blocks arrive.

**Problem:** Near download completion, if remaining pieces are being downloaded from slow peers, fast peers sit idle and the download stalls.

**Solution:** Request the same blocks from multiple peers simultaneously, then send CANCEL messages when a block arrives to avoid wasting bandwidth.

## Phase 1: Wire Protocol - Add sendCancel

### 1.1 Add sendCancel to PeerConnection

File: `packages/engine/src/core/peer-connection.ts`

Find the `sendRequest` method (around line 113) and add `sendCancel` after it:

```typescript
sendRequest(index: number, begin: number, length: number) {
  this.sendMessage(MessageType.REQUEST, { index, begin, length })
}

sendCancel(index: number, begin: number, length: number) {
  this.sendMessage(MessageType.CANCEL, { index, begin, length })
}
```

## Phase 2: ActivePiece Endgame Support

### 2.1 Add endgame methods to ActivePiece

File: `packages/engine/src/core/active-piece.ts`

Add these methods after `getNeededBlocks()` (around line 198):

```typescript
/**
 * Get blocks needed from a specific peer in endgame mode.
 * Returns blocks this peer hasn't requested yet, even if other peers have.
 */
getNeededBlocksEndgame(peerId: string, maxBlocks: number = Infinity): BlockInfo[] {
  const needed: BlockInfo[] = []

  for (let i = 0; i < this.blocksNeeded && needed.length < maxBlocks; i++) {
    // Skip if we have the data
    if (this.blockData.has(i)) continue

    // In endgame: skip only if THIS PEER already requested it
    const requests = this.blockRequests.get(i)
    if (requests?.some((r) => r.peerId === peerId)) continue

    const begin = i * BLOCK_SIZE
    const length = Math.min(BLOCK_SIZE, this.length - begin)
    needed.push({ begin, length })
  }

  return needed
}

/**
 * Get peer IDs that have outstanding requests for a block (excluding one peer).
 * Used in endgame to send CANCEL messages when a block arrives.
 */
getOtherRequesters(blockIndex: number, excludePeerId: string): string[] {
  const requests = this.blockRequests.get(blockIndex) ?? []
  return requests.filter((r) => r.peerId !== excludePeerId).map((r) => r.peerId)
}
```

## Phase 3: EndgameManager

### 3.1 Create EndgameManager

File: `packages/engine/src/core/endgame-manager.ts` (new file)

```typescript
import { ActivePiece, BLOCK_SIZE } from './active-piece'

/**
 * Decision to enter or exit endgame mode.
 */
export interface EndgameDecision {
  type: 'enter_endgame' | 'exit_endgame'
}

/**
 * Decision to send a CANCEL message to a peer.
 */
export interface CancelDecision {
  peerId: string
  index: number
  begin: number
  length: number
}

/**
 * Configuration for endgame mode.
 */
export interface EndgameConfig {
  /** 
   * Maximum number of duplicate requests per block.
   * 0 = unlimited (request from all peers that have the piece)
   * Default: 3
   */
  maxDuplicateRequests: number
}

const DEFAULT_CONFIG: EndgameConfig = {
  maxDuplicateRequests: 3,
}

/**
 * Manages endgame mode for accelerating download completion.
 *
 * Endgame mode activates when:
 * - All remaining pieces have been activated (we're working on them)
 * - Every block in every active piece has at least one outstanding request
 *
 * In endgame mode:
 * - Duplicate block requests are sent to multiple peers
 * - CANCEL messages are sent when blocks arrive to avoid waste
 *
 * This class is pure - no I/O, no side effects. Produces decisions for caller to execute.
 */
export class EndgameManager {
  private _inEndgame = false
  private config: EndgameConfig

  constructor(config: Partial<EndgameConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Whether we're currently in endgame mode.
   */
  get isEndgame(): boolean {
    return this._inEndgame
  }

  /**
   * Update configuration at runtime.
   */
  updateConfig(config: Partial<EndgameConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * Get current configuration.
   */
  getConfig(): Readonly<EndgameConfig> {
    return { ...this.config }
  }

  /**
   * Evaluate whether to enter or exit endgame mode.
   *
   * @param missingPieceCount Number of pieces we don't have yet
   * @param activePieceCount Number of pieces currently being downloaded
   * @param hasUnrequestedBlocks Whether any active piece has blocks with no requests
   * @returns Decision to enter/exit endgame, or null if no change
   */
  evaluate(
    missingPieceCount: number,
    activePieceCount: number,
    hasUnrequestedBlocks: boolean,
  ): EndgameDecision | null {
    // Endgame conditions:
    // 1. We have missing pieces (not complete)
    // 2. All missing pieces are active (we're working on all of them)
    // 3. No unrequested blocks (everything has at least one request)
    const shouldBeEndgame =
      missingPieceCount > 0 &&
      missingPieceCount === activePieceCount &&
      !hasUnrequestedBlocks

    if (shouldBeEndgame && !this._inEndgame) {
      this._inEndgame = true
      return { type: 'enter_endgame' }
    }

    if (!shouldBeEndgame && this._inEndgame) {
      this._inEndgame = false
      return { type: 'exit_endgame' }
    }

    return null
  }

  /**
   * Force exit endgame mode (e.g., when torrent completes or stops).
   */
  reset(): void {
    this._inEndgame = false
  }

  /**
   * Get CANCEL decisions for a received block.
   * Called when a block arrives to cancel duplicate requests from other peers.
   *
   * @param piece The ActivePiece containing the block
   * @param blockIndex Index of the block within the piece
   * @param receivedFromPeerId Peer that sent us this block (don't cancel them)
   * @returns List of CANCEL messages to send
   */
  getCancels(
    piece: ActivePiece,
    blockIndex: number,
    receivedFromPeerId: string,
  ): CancelDecision[] {
    if (!this._inEndgame) return []

    const otherPeers = piece.getOtherRequesters(blockIndex, receivedFromPeerId)
    if (otherPeers.length === 0) return []

    const begin = blockIndex * BLOCK_SIZE
    const length = Math.min(BLOCK_SIZE, piece.length - begin)

    return otherPeers.map((peerId) => ({
      peerId,
      index: piece.index,
      begin,
      length,
    }))
  }

  /**
   * Check if we should send a duplicate request to a peer for a block.
   * Respects maxDuplicateRequests config.
   *
   * @param currentRequestCount How many requests are already out for this block
   * @returns Whether to send another duplicate request
   */
  shouldSendDuplicateRequest(currentRequestCount: number): boolean {
    if (!this._inEndgame) return false
    if (this.config.maxDuplicateRequests === 0) return true // Unlimited
    return currentRequestCount < this.config.maxDuplicateRequests
  }
}
```

### 3.2 Export from index

File: `packages/engine/src/index.ts`

Add export for EndgameManager. Find the core exports section and add:

```typescript
export { EndgameManager, EndgameDecision, CancelDecision, EndgameConfig } from './core/endgame-manager'
```

## Phase 4: ActivePieceManager Helpers

### 4.1 Add helper method to ActivePieceManager

File: `packages/engine/src/core/active-piece-manager.ts`

Add this method after `checkTimeouts()` (around line 167):

```typescript
/**
 * Check if any active piece has unrequested blocks.
 * Used to determine endgame eligibility.
 */
hasUnrequestedBlocks(): boolean {
  for (const piece of this.pieces.values()) {
    // If piece has blocks that aren't received AND aren't requested, return true
    if (piece.getNeededBlocks(1).length > 0) {
      return true
    }
  }
  return false
}
```

## Phase 5: Torrent Integration

### 5.1 Add EndgameManager to Torrent

File: `packages/engine/src/core/torrent.ts`

Add import at top of file:

```typescript
import { EndgameManager } from './endgame-manager'
```

Add property after `_diskQueue` declaration (around line 97):

```typescript
private _diskQueue: TorrentDiskQueue = new TorrentDiskQueue()
private _endgameManager: EndgameManager = new EndgameManager()
```

Add getter for UI/debugging (after other getters, around line 250):

```typescript
/**
 * Whether this torrent is in endgame mode.
 */
get isEndgame(): boolean {
  return this._endgameManager.isEndgame
}
```

### 5.2 Modify requestPieces for endgame

File: `packages/engine/src/core/torrent.ts`

In the `requestPieces()` method, modify the block selection logic. Find this section (around line 1615-1618):

```typescript
// Get blocks we can request from this piece
const neededBlocks = piece.getNeededBlocks(MAX_PIPELINE - peer.requestsPending)
if (neededBlocks.length === 0) {
  _skippedNoNeeded++
  continue
}
```

Replace with:

```typescript
// Get blocks we can request from this piece
// In endgame mode, use peer-specific method to allow duplicate requests
const neededBlocks = this._endgameManager.isEndgame
  ? piece.getNeededBlocksEndgame(peerId, MAX_PIPELINE - peer.requestsPending)
  : piece.getNeededBlocks(MAX_PIPELINE - peer.requestsPending)

if (neededBlocks.length === 0) {
  _skippedNoNeeded++
  continue
}
```

### 5.3 Add endgame evaluation after requesting

File: `packages/engine/src/core/torrent.ts`

At the end of the `requestPieces()` method, before the closing brace, add:

```typescript
// Check if we should enter/exit endgame mode
if (this.activePieces) {
  const decision = this._endgameManager.evaluate(
    missing.length,
    this.activePieces.activeCount,
    this.activePieces.hasUnrequestedBlocks(),
  )
  if (decision) {
    this.logger.info(`Endgame: ${decision.type}`)
  }
}
```

### 5.4 Send CANCEL messages on block receipt

File: `packages/engine/src/core/torrent.ts`

In `handleBlock()`, after the block is added and before `requestPieces()` is called (around line 1707-1714), add CANCEL logic:

Find this code:

```typescript
// Add block to piece
const isNew = piece.addBlock(blockIndex, msg.block, peerId)
if (!isNew) {
  this.logger.debug(`Duplicate block ${msg.index}:${msg.begin}`)
}

// Refill request pipeline immediately (before any async I/O)
// This prevents sawtooth download patterns on fast peers
this.requestPieces(peer)
```

Replace with:

```typescript
// Add block to piece
const isNew = piece.addBlock(blockIndex, msg.block, peerId)
if (!isNew) {
  this.logger.debug(`Duplicate block ${msg.index}:${msg.begin}`)
}

// In endgame mode, send CANCEL to other peers that requested this block
if (isNew && this._endgameManager.isEndgame) {
  const cancels = this._endgameManager.getCancels(piece, blockIndex, peerId)
  for (const cancel of cancels) {
    // Find peer by ID and send cancel
    for (const p of this.connectedPeers) {
      const pId = p.peerId ? toHex(p.peerId) : `${p.remoteAddress}:${p.remotePort}`
      if (pId === cancel.peerId) {
        p.sendCancel(cancel.index, cancel.begin, cancel.length)
        this.logger.debug(`Endgame: sent CANCEL to ${pId} for ${cancel.index}:${cancel.begin}`)
        break
      }
    }
  }
}

// Refill request pipeline immediately (before any async I/O)
// This prevents sawtooth download patterns on fast peers
this.requestPieces(peer)
```

### 5.5 Reset endgame on network suspend

File: `packages/engine/src/core/torrent.ts`

In `suspendNetwork()`, after clearing active pieces (around line 800), add:

```typescript
// Clear active pieces - release buffered data and pending requests
this.activePieces?.destroy()
this.activePieces = undefined

// Reset endgame state
this._endgameManager.reset()
```

## Phase 6: Unit Tests

### 6.1 Create EndgameManager tests

File: `packages/engine/test/core/endgame-manager.test.ts` (new file)

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { EndgameManager } from '../../src/core/endgame-manager'
import { ActivePiece } from '../../src/core/active-piece'

describe('EndgameManager', () => {
  let manager: EndgameManager

  beforeEach(() => {
    manager = new EndgameManager()
  })

  describe('evaluate', () => {
    it('should not enter endgame when download is complete', () => {
      const decision = manager.evaluate(0, 0, false)
      expect(decision).toBeNull()
      expect(manager.isEndgame).toBe(false)
    })

    it('should not enter endgame when not all pieces are active', () => {
      // 5 missing pieces, only 3 active
      const decision = manager.evaluate(5, 3, false)
      expect(decision).toBeNull()
      expect(manager.isEndgame).toBe(false)
    })

    it('should not enter endgame when there are unrequested blocks', () => {
      // All 3 missing pieces are active, but some blocks unrequested
      const decision = manager.evaluate(3, 3, true)
      expect(decision).toBeNull()
      expect(manager.isEndgame).toBe(false)
    })

    it('should enter endgame when all conditions met', () => {
      // 3 missing pieces, all active, no unrequested blocks
      const decision = manager.evaluate(3, 3, false)
      expect(decision).toEqual({ type: 'enter_endgame' })
      expect(manager.isEndgame).toBe(true)
    })

    it('should exit endgame when conditions no longer met', () => {
      // Enter endgame
      manager.evaluate(3, 3, false)
      expect(manager.isEndgame).toBe(true)

      // New piece becomes active (peer sent HAVE)
      const decision = manager.evaluate(4, 3, false)
      expect(decision).toEqual({ type: 'exit_endgame' })
      expect(manager.isEndgame).toBe(false)
    })

    it('should return null when state unchanged', () => {
      // Enter endgame
      manager.evaluate(3, 3, false)

      // Same conditions - no change
      const decision = manager.evaluate(3, 3, false)
      expect(decision).toBeNull()
      expect(manager.isEndgame).toBe(true)
    })
  })

  describe('getCancels', () => {
    it('should return empty when not in endgame', () => {
      const piece = new ActivePiece(0, 32768) // 2 blocks
      piece.addRequest(0, 'peer1')
      piece.addRequest(0, 'peer2')

      const cancels = manager.getCancels(piece, 0, 'peer1')
      expect(cancels).toHaveLength(0)
    })

    it('should return other peers to cancel in endgame', () => {
      // Enter endgame
      manager.evaluate(1, 1, false)

      const piece = new ActivePiece(5, 32768) // 2 blocks
      piece.addRequest(0, 'peer1')
      piece.addRequest(0, 'peer2')
      piece.addRequest(0, 'peer3')

      // peer1 sent the block - cancel peer2 and peer3
      const cancels = manager.getCancels(piece, 0, 'peer1')
      expect(cancels).toHaveLength(2)
      expect(cancels.map((c) => c.peerId).sort()).toEqual(['peer2', 'peer3'])
      expect(cancels[0].index).toBe(5)
      expect(cancels[0].begin).toBe(0)
      expect(cancels[0].length).toBe(16384)
    })

    it('should not include the sender in cancels', () => {
      manager.evaluate(1, 1, false)

      const piece = new ActivePiece(0, 16384) // 1 block
      piece.addRequest(0, 'peer1')

      const cancels = manager.getCancels(piece, 0, 'peer1')
      expect(cancels).toHaveLength(0)
    })
  })

  describe('shouldSendDuplicateRequest', () => {
    it('should return false when not in endgame', () => {
      expect(manager.shouldSendDuplicateRequest(0)).toBe(false)
    })

    it('should respect maxDuplicateRequests config', () => {
      manager.evaluate(1, 1, false) // Enter endgame

      // Default is 3
      expect(manager.shouldSendDuplicateRequest(0)).toBe(true)
      expect(manager.shouldSendDuplicateRequest(2)).toBe(true)
      expect(manager.shouldSendDuplicateRequest(3)).toBe(false)
    })

    it('should allow unlimited with config 0', () => {
      manager.updateConfig({ maxDuplicateRequests: 0 })
      manager.evaluate(1, 1, false)

      expect(manager.shouldSendDuplicateRequest(100)).toBe(true)
    })
  })

  describe('reset', () => {
    it('should exit endgame mode', () => {
      manager.evaluate(1, 1, false)
      expect(manager.isEndgame).toBe(true)

      manager.reset()
      expect(manager.isEndgame).toBe(false)
    })
  })
})
```

### 6.2 Add ActivePiece endgame tests

File: `packages/engine/test/core/active-piece.test.ts`

Add these tests to the existing file:

```typescript
describe('endgame methods', () => {
  describe('getNeededBlocksEndgame', () => {
    it('should return blocks not requested by this specific peer', () => {
      const piece = new ActivePiece(0, 32768) // 2 blocks

      // peer1 requests block 0
      piece.addRequest(0, 'peer1')

      // peer2 should be able to request block 0 (duplicate) and block 1
      const needed = piece.getNeededBlocksEndgame('peer2')
      expect(needed).toHaveLength(2)
      expect(needed[0].begin).toBe(0)
      expect(needed[1].begin).toBe(16384)
    })

    it('should not return blocks already requested by this peer', () => {
      const piece = new ActivePiece(0, 32768)

      piece.addRequest(0, 'peer1')
      piece.addRequest(1, 'peer1')

      // peer1 already requested everything
      const needed = piece.getNeededBlocksEndgame('peer1')
      expect(needed).toHaveLength(0)
    })

    it('should not return blocks we already have', () => {
      const piece = new ActivePiece(0, 32768)

      // Receive block 0
      piece.addBlock(0, new Uint8Array(16384), 'peer1')

      // peer2 should only get block 1
      const needed = piece.getNeededBlocksEndgame('peer2')
      expect(needed).toHaveLength(1)
      expect(needed[0].begin).toBe(16384)
    })

    it('should respect maxBlocks limit', () => {
      const piece = new ActivePiece(0, 65536) // 4 blocks

      const needed = piece.getNeededBlocksEndgame('peer1', 2)
      expect(needed).toHaveLength(2)
    })
  })

  describe('getOtherRequesters', () => {
    it('should return peers that requested the block excluding one', () => {
      const piece = new ActivePiece(0, 16384)

      piece.addRequest(0, 'peer1')
      piece.addRequest(0, 'peer2')
      piece.addRequest(0, 'peer3')

      const others = piece.getOtherRequesters(0, 'peer1')
      expect(others.sort()).toEqual(['peer2', 'peer3'])
    })

    it('should return empty array if no other requesters', () => {
      const piece = new ActivePiece(0, 16384)

      piece.addRequest(0, 'peer1')

      const others = piece.getOtherRequesters(0, 'peer1')
      expect(others).toHaveLength(0)
    })

    it('should return empty array for unrequested block', () => {
      const piece = new ActivePiece(0, 16384)

      const others = piece.getOtherRequesters(0, 'peer1')
      expect(others).toHaveLength(0)
    })
  })
})
```

## Verification

### Step 1: Type Check

```bash
cd /path/to/jstorrent-main
pnpm typecheck
```

### Step 2: Run Unit Tests

```bash
pnpm test
```

Specifically verify new tests pass:

```bash
cd packages/engine
pnpm test -- --grep "EndgameManager"
pnpm test -- --grep "endgame"
```

### Step 3: Run Lint and Format

```bash
pnpm lint
pnpm format:fix
```

### Step 4: Manual Testing

1. Start a download with a small torrent (e.g., Big Buck Bunny)
2. Watch logs for "Endgame: enter_endgame" message near completion
3. Verify CANCEL messages are logged when blocks arrive in endgame
4. Confirm download completes successfully

### Step 5: Integration Test (Optional)

The Python integration tests can verify endgame behavior:

```bash
cd packages/engine/integration/python
python run_tests.py
```

## Notes

- The implementation is conservative with `maxDuplicateRequests: 3` default
- CANCEL messages are best-effort - if peer already sent the block, that's fine
- Endgame automatically exits if conditions change (e.g., peer sends HAVE for new piece)
- The peer ID matching in Torrent uses the same format as elsewhere (hex peerId or ip:port)
