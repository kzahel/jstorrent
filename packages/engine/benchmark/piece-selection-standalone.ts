/**
 * Standalone benchmark for piece selection (no vitest/vite dependency).
 *
 * Run with JIT disabled to approximate QuickJS:
 *   npx tsx benchmark/piece-selection-standalone.ts --jitless
 *
 * Run with JIT enabled:
 *   npx tsx benchmark/piece-selection-standalone.ts
 */
import { BitField } from '../src/utils/bitfield.js'

const PIECE_COUNT = 12881
const PEER_COUNT = 20
const PIPELINE_LIMIT = 16
const WARMUP_ITERATIONS = 100
const BENCH_ITERATIONS = 1000

interface TestState {
  ourBitfield: BitField
  peerBitfield: BitField
  piecePriority: Uint8Array
  activePieces: Set<number>
  completedCount: number
}

function createTestState(completedCount: number): TestState {
  const ourBitfield = new BitField(PIECE_COUNT)
  const peerBitfield = BitField.createFull(PIECE_COUNT)
  const piecePriority = new Uint8Array(PIECE_COUNT).fill(1)
  const activePieces = new Set<number>()

  for (let i = 0; i < completedCount; i++) {
    ourBitfield.set(i)
  }

  const activeCount = Math.min(50, PIECE_COUNT - completedCount)
  for (let i = 0; i < activeCount; i++) {
    activePieces.add(completedCount + i)
  }

  return { ourBitfield, peerBitfield, piecePriority, activePieces, completedCount }
}

function phase2Current(state: TestState): number[] {
  const selected: number[] = []
  for (let i = 0; i < PIECE_COUNT; i++) {
    if (selected.length >= PIPELINE_LIMIT) break
    if (state.ourBitfield.get(i)) continue
    if (!state.peerBitfield.get(i)) continue
    if (state.piecePriority[i] === 0) continue
    if (state.activePieces.has(i)) continue
    selected.push(i)
  }
  return selected
}

function phase2Optimized(state: TestState, firstNeededPiece: number): number[] {
  const selected: number[] = []
  for (let i = firstNeededPiece; i < PIECE_COUNT; i++) {
    if (selected.length >= PIPELINE_LIMIT) break
    if (state.ourBitfield.get(i)) continue
    if (!state.peerBitfield.get(i)) continue
    if (state.piecePriority[i] === 0) continue
    if (state.activePieces.has(i)) continue
    selected.push(i)
  }
  return selected
}

function runBatch(state: TestState, optimized: boolean): void {
  for (let p = 0; p < PEER_COUNT; p++) {
    if (optimized) {
      phase2Optimized(state, state.completedCount)
    } else {
      phase2Current(state)
    }
  }
}

function benchmark(
  name: string,
  fn: () => void,
  iterations: number,
): { mean: number; min: number; max: number } {
  // Warmup
  for (let i = 0; i < WARMUP_ITERATIONS; i++) fn()

  const times: number[] = []
  for (let i = 0; i < iterations; i++) {
    const start = performance.now()
    fn()
    times.push(performance.now() - start)
  }

  times.sort((a, b) => a - b)
  const mean = times.reduce((a, b) => a + b, 0) / times.length
  const min = times[0]
  const max = times[times.length - 1]
  const p99 = times[Math.floor(times.length * 0.99)]

  console.log(
    `${name.padEnd(50)} mean: ${mean.toFixed(3)}ms, min: ${min.toFixed(3)}ms, max: ${max.toFixed(3)}ms, p99: ${p99.toFixed(3)}ms`,
  )

  return { mean, min, max }
}

console.log(`\nPiece Selection Benchmark`)
console.log(`Pieces: ${PIECE_COUNT}, Peers: ${PEER_COUNT}, Pipeline: ${PIPELINE_LIMIT}`)
console.log(`Iterations: ${BENCH_ITERATIONS}, Warmup: ${WARMUP_ITERATIONS}`)
console.log(`JIT: ${process.execArgv.includes('--jitless') ? 'DISABLED' : 'enabled'}`)
console.log('='.repeat(100))

const scenarios = [
  { name: '0%', completed: 0 },
  { name: '50%', completed: Math.floor(PIECE_COUNT * 0.5) },
  { name: '71%', completed: Math.floor(PIECE_COUNT * 0.71) },
  { name: '90%', completed: Math.floor(PIECE_COUNT * 0.9) },
  { name: '99%', completed: Math.floor(PIECE_COUNT * 0.99) },
]

console.log('\n--- Single batch (20 peers) ---\n')

for (const scenario of scenarios) {
  const state = createTestState(scenario.completed)

  const currentResult = benchmark(
    `current @ ${scenario.name} complete`,
    () => runBatch(state, false),
    BENCH_ITERATIONS,
  )

  const optimizedResult = benchmark(
    `optimized @ ${scenario.name} complete`,
    () => runBatch(state, true),
    BENCH_ITERATIONS,
  )

  const speedup = currentResult.mean / optimizedResult.mean
  console.log(`  -> Speedup: ${speedup.toFixed(1)}x\n`)
}

console.log('\n--- Sustained (100 batches = ~1 second of download) ---\n')

for (const scenario of scenarios.filter((s) => s.name === '71%' || s.name === '99%')) {
  const state = createTestState(scenario.completed)
  const BATCHES = 100

  const currentResult = benchmark(
    `current @ ${scenario.name} (${BATCHES} batches)`,
    () => {
      for (let b = 0; b < BATCHES; b++) runBatch(state, false)
    },
    100,
  )

  const optimizedResult = benchmark(
    `optimized @ ${scenario.name} (${BATCHES} batches)`,
    () => {
      for (let b = 0; b < BATCHES; b++) runBatch(state, true)
    },
    100,
  )

  const speedup = currentResult.mean / optimizedResult.mean
  console.log(`  -> Speedup: ${speedup.toFixed(1)}x`)
  console.log(
    `  -> JS thread time per second: current=${currentResult.mean.toFixed(1)}ms, optimized=${optimizedResult.mean.toFixed(1)}ms\n`,
  )
}
