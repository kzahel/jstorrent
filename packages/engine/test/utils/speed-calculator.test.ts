import { describe, it, expect, beforeEach, vi } from 'vitest'
import { SpeedCalculator } from '../../src/utils/speed-calculator'

describe('SpeedCalculator', () => {
  let calculator: SpeedCalculator

  beforeEach(() => {
    calculator = new SpeedCalculator(5) // 5 second window
    vi.useFakeTimers()
  })

  it('should calculate speed correctly for a single update', () => {
    calculator.addBytes(1000)
    // Speed is total bytes / window size
    // 1000 bytes / 5 seconds = 200 bytes/sec
    expect(calculator.getSpeed()).toBe(200)
  })

  it('should accumulate bytes within the same second', () => {
    calculator.addBytes(500)
    calculator.addBytes(500)
    expect(calculator.getSpeed()).toBe(200)
  })

  it('should handle updates across multiple seconds', () => {
    calculator.addBytes(1000) // t=0
    vi.advanceTimersByTime(1000)
    calculator.addBytes(1000) // t=1
    // Total 2000 bytes in 5 sec window = 400 bytes/sec
    expect(calculator.getSpeed()).toBe(400)
  })

  it('should drop old buckets as time passes', () => {
    calculator.addBytes(1000) // t=0
    vi.advanceTimersByTime(4000) // t=4
    calculator.addBytes(1000) // t=4
    // Total 2000 bytes
    expect(calculator.getSpeed()).toBe(400)

    vi.advanceTimersByTime(1000) // t=5. The bucket at t=0 should be dropped.
    // Now we have 1000 bytes (from t=4) in the last 5 seconds (t=1 to t=5)
    expect(calculator.getSpeed()).toBe(200)
  })

  it('should reset if time gap is larger than window', () => {
    calculator.addBytes(1000)
    vi.advanceTimersByTime(6000) // 6 seconds passed
    expect(calculator.getSpeed()).toBe(0)
  })
})
