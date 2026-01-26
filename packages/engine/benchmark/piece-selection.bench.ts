/**
 * Benchmark for piece selection performance.
 *
 * Run with JIT disabled to approximate QuickJS performance:
 *   NODE_OPTIONS='--jitless' pnpm vitest bench benchmark/piece-selection.bench.ts
 *
 * Run with JIT enabled for comparison:
 *   pnpm vitest bench benchmark/piece-selection.bench.ts
 */
import { bench, describe } from 'vitest'
import { BitField } from '../src/utils/bitfield'

// Match Ubuntu Server torrent characteristics
const PIECE_COUNT = 12881 // 3.3GB / 256KB
const PEER_COUNT = 20
const PIPELINE_LIMIT = 16

// Completion scenarios to test
const COMPLETION_SCENARIOS = [
  { name: '0%', completedCount: 0 },
  { name: '50%', completedCount: Math.floor(PIECE_COUNT * 0.5) },
  { name: '71%', completedCount: Math.floor(PIECE_COUNT * 0.71) }, // Observed case
  { name: '90%', completedCount: Math.floor(PIECE_COUNT * 0.9) },
  { name: '99%', completedCount: Math.floor(PIECE_COUNT * 0.99) },
]

/**
 * Create test state for a given completion percentage.
 * Pieces are completed sequentially (index 0, 1, 2, ...).
 */
function createTestState(completedCount: number) {
  const ourBitfield = new BitField(PIECE_COUNT)
  const peerBitfield = BitField.createFull(PIECE_COUNT) // Peer has all pieces
  const piecePriority = new Uint8Array(PIECE_COUNT).fill(1) // All pieces wanted
  const activePieces = new Set<number>()

  // Mark completed pieces (sequential from start)
  for (let i = 0; i < completedCount; i++) {
    ourBitfield.set(i)
  }

  // Add some active pieces (being downloaded)
  const activeCount = Math.min(50, PIECE_COUNT - completedCount)
  for (let i = 0; i < activeCount; i++) {
    activePieces.add(completedCount + i)
  }

  return { ourBitfield, peerBitfield, piecePriority, activePieces, completedCount }
}

/**
 * Current Phase 2 implementation - scans from index 0.
 */
function phase2Current(
  ourBitfield: BitField,
  peerBitfield: BitField,
  piecePriority: Uint8Array,
  activePieces: Set<number>,
  pipelineLimit: number,
): number[] {
  const selected: number[] = []

  for (let i = 0; i < PIECE_COUNT; i++) {
    if (selected.length >= pipelineLimit) break
    if (ourBitfield.get(i)) continue
    if (!peerBitfield.get(i)) continue
    if (piecePriority[i] === 0) continue
    if (activePieces.has(i)) continue
    selected.push(i)
  }

  return selected
}

/**
 * Optimized Phase 2 - starts from firstNeededPiece.
 */
function phase2Optimized(
  ourBitfield: BitField,
  peerBitfield: BitField,
  piecePriority: Uint8Array,
  activePieces: Set<number>,
  pipelineLimit: number,
  firstNeededPiece: number,
): number[] {
  const selected: number[] = []

  for (let i = firstNeededPiece; i < PIECE_COUNT; i++) {
    if (selected.length >= pipelineLimit) break
    if (ourBitfield.get(i)) continue
    if (!peerBitfield.get(i)) continue
    if (piecePriority[i] === 0) continue
    if (activePieces.has(i)) continue
    selected.push(i)
  }

  return selected
}

/**
 * Simulate calling requestPieces for all peers (one round).
 * This is what happens in a microtask batch.
 */
function simulateBatchCurrent(
  ourBitfield: BitField,
  peerBitfield: BitField,
  piecePriority: Uint8Array,
  activePieces: Set<number>,
  peerCount: number,
): void {
  for (let p = 0; p < peerCount; p++) {
    phase2Current(ourBitfield, peerBitfield, piecePriority, activePieces, PIPELINE_LIMIT)
  }
}

function simulateBatchOptimized(
  ourBitfield: BitField,
  peerBitfield: BitField,
  piecePriority: Uint8Array,
  activePieces: Set<number>,
  peerCount: number,
  firstNeededPiece: number,
): void {
  for (let p = 0; p < peerCount; p++) {
    phase2Optimized(
      ourBitfield,
      peerBitfield,
      piecePriority,
      activePieces,
      PIPELINE_LIMIT,
      firstNeededPiece,
    )
  }
}

// Single call benchmarks - measure one Phase 2 invocation
describe('Phase 2 single call', () => {
  for (const scenario of COMPLETION_SCENARIOS) {
    const state = createTestState(scenario.completedCount)

    bench(`current @ ${scenario.name} complete`, () => {
      phase2Current(
        state.ourBitfield,
        state.peerBitfield,
        state.piecePriority,
        state.activePieces,
        PIPELINE_LIMIT,
      )
    })

    bench(`optimized @ ${scenario.name} complete`, () => {
      phase2Optimized(
        state.ourBitfield,
        state.peerBitfield,
        state.piecePriority,
        state.activePieces,
        PIPELINE_LIMIT,
        state.completedCount, // firstNeededPiece = first incomplete
      )
    })
  }
})

// Batch benchmarks - simulate one microtask batch with all peers
describe('Phase 2 batch (20 peers)', () => {
  for (const scenario of COMPLETION_SCENARIOS) {
    const state = createTestState(scenario.completedCount)

    bench(`current @ ${scenario.name} complete`, () => {
      simulateBatchCurrent(
        state.ourBitfield,
        state.peerBitfield,
        state.piecePriority,
        state.activePieces,
        PEER_COUNT,
      )
    })

    bench(`optimized @ ${scenario.name} complete`, () => {
      simulateBatchOptimized(
        state.ourBitfield,
        state.peerBitfield,
        state.piecePriority,
        state.activePieces,
        PEER_COUNT,
        state.completedCount,
      )
    })
  }
})

// Sustained load benchmark - simulate 1 second of download activity
describe('Sustained download simulation (1 second)', () => {
  const BATCHES_PER_SECOND = 100 // Approximate microtask batch rate

  for (const scenario of [COMPLETION_SCENARIOS[2], COMPLETION_SCENARIOS[4]]) {
    // 71% and 99%
    const state = createTestState(scenario.completedCount)

    bench(`current @ ${scenario.name} complete (${BATCHES_PER_SECOND} batches)`, () => {
      for (let b = 0; b < BATCHES_PER_SECOND; b++) {
        simulateBatchCurrent(
          state.ourBitfield,
          state.peerBitfield,
          state.piecePriority,
          state.activePieces,
          PEER_COUNT,
        )
      }
    })

    bench(`optimized @ ${scenario.name} complete (${BATCHES_PER_SECOND} batches)`, () => {
      for (let b = 0; b < BATCHES_PER_SECOND; b++) {
        simulateBatchOptimized(
          state.ourBitfield,
          state.peerBitfield,
          state.piecePriority,
          state.activePieces,
          PEER_COUNT,
          state.completedCount,
        )
      }
    })
  }
})
