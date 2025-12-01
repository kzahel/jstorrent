# Adaptive Connection Timeouts - Agent Guide

This guide covers implementing adaptive connection timeouts in the JSTorrent engine, with a 30-second backstop in the Rust io-daemon.

## Overview

**Problem:** Fixed 10-second timeouts are too aggressive for slow connections (satellite, poor mobile signal) but wasteful for fast connections.

**Solution:**
1. Rust io-daemon: 30-second hard backstop (safety net)
2. TypeScript engine: Adaptive timeout based on observed connection times

## Part 1: Rust io-daemon Change (Simple)

### File: `native-host/io-daemon/src/ws.rs`

**Line ~219**, change:

```rust
// 10 second connect timeout - prevents stalling on unresponsive peers
let connect_timeout = Duration::from_secs(10);
```

To:

```rust
// 30 second connect timeout - backstop for slow connections (satellite, poor mobile)
// The TypeScript engine manages its own adaptive timeout and will cancel earlier
let connect_timeout = Duration::from_secs(30);
```

That's it for Rust. The engine will handle the smart timeouts.

---

## Part 2: TypeScript Engine Changes

### 2.1 Create new file: `packages/engine/src/core/connection-timing.ts`

```typescript
/**
 * Tracks connection timing statistics and computes adaptive timeouts.
 * 
 * Uses 95th percentile of observed connection times with a multiplier,
 * bounded between MIN and MAX to handle edge cases.
 */
export class ConnectionTimingTracker {
  private samples: number[] = []
  private readonly maxSamples: number
  
  // Bounds
  private readonly MIN_TIMEOUT: number
  private readonly MAX_TIMEOUT: number
  private readonly DEFAULT_TIMEOUT: number
  private readonly MULTIPLIER: number
  
  // Stats
  private minSeen = Infinity
  private totalConnections = 0
  private totalTimeouts = 0
  
  constructor(options: {
    maxSamples?: number
    minTimeout?: number
    maxTimeout?: number
    defaultTimeout?: number
    multiplier?: number
  } = {}) {
    this.maxSamples = options.maxSamples ?? 50
    this.MIN_TIMEOUT = options.minTimeout ?? 3000      // Never less than 3s
    this.MAX_TIMEOUT = options.maxTimeout ?? 30000     // Never more than 30s
    this.DEFAULT_TIMEOUT = options.defaultTimeout ?? 10000  // Before we have data
    this.MULTIPLIER = options.multiplier ?? 2.5        // Buffer above observed
  }
  
  /**
   * Record a successful connection and its duration.
   */
  recordSuccess(connectionTimeMs: number): void {
    this.totalConnections++
    this.samples.push(connectionTimeMs)
    
    if (this.samples.length > this.maxSamples) {
      this.samples.shift()
    }
    
    if (connectionTimeMs < this.minSeen) {
      this.minSeen = connectionTimeMs
    }
  }
  
  /**
   * Record a connection timeout (for stats, doesn't affect timeout calculation).
   */
  recordTimeout(): void {
    this.totalTimeouts++
  }
  
  /**
   * Get the current adaptive timeout value.
   */
  getTimeout(): number {
    if (this.samples.length < 5) {
      // Not enough data yet, use default
      return this.DEFAULT_TIMEOUT
    }
    
    // Use 95th percentile * multiplier as timeout
    // This allows for variance while catching true hangs
    const sorted = [...this.samples].sort((a, b) => a - b)
    const p95Index = Math.floor(sorted.length * 0.95)
    const p95 = sorted[p95Index]
    
    const computed = Math.round(p95 * this.MULTIPLIER)
    
    return Math.max(this.MIN_TIMEOUT, Math.min(this.MAX_TIMEOUT, computed))
  }
  
  /**
   * Get statistics for logging/debugging.
   */
  getStats(): ConnectionTimingStats {
    if (this.samples.length === 0) {
      return {
        currentTimeout: this.DEFAULT_TIMEOUT,
        sampleCount: 0,
        minSeen: 0,
        average: 0,
        p95: 0,
        totalConnections: this.totalConnections,
        totalTimeouts: this.totalTimeouts,
      }
    }
    
    const sorted = [...this.samples].sort((a, b) => a - b)
    const sum = this.samples.reduce((a, b) => a + b, 0)
    const avg = sum / this.samples.length
    const p95Index = Math.floor(sorted.length * 0.95)
    const p95 = sorted[p95Index]
    
    return {
      currentTimeout: this.getTimeout(),
      sampleCount: this.samples.length,
      minSeen: this.minSeen === Infinity ? 0 : this.minSeen,
      average: Math.round(avg),
      p95: p95,
      totalConnections: this.totalConnections,
      totalTimeouts: this.totalTimeouts,
    }
  }
  
  /**
   * Reset all statistics (e.g., on network change).
   */
  reset(): void {
    this.samples = []
    this.minSeen = Infinity
    this.totalConnections = 0
    this.totalTimeouts = 0
  }
}

export interface ConnectionTimingStats {
  currentTimeout: number
  sampleCount: number
  minSeen: number
  average: number
  p95: number
  totalConnections: number
  totalTimeouts: number
}
```

### 2.2 Add to Torrent class: `packages/engine/src/core/torrent.ts`

#### Add import at top:

```typescript
import { ConnectionTimingTracker } from './connection-timing'
```

#### Add property to Torrent class:

```typescript
class Torrent {
  // ... existing properties ...
  
  /** Tracks connection timing for adaptive timeouts */
  private connectionTiming: ConnectionTimingTracker
  
  // In constructor:
  constructor(...) {
    // ... existing init ...
    this.connectionTiming = new ConnectionTimingTracker()
  }
```

#### Update `connectToPeer` method:

Find the section where TCP connection is initiated. Add timing tracking:

```typescript
private async connectToPeer(peerInfo: PeerInfo): Promise<void> {
  // ... existing validation ...
  
  const key = peerKey(peerInfo.ip, peerInfo.port)
  
  // ... existing pending connection tracking ...
  
  const connectStartTime = Date.now()
  const timeout = this.connectionTiming.getTimeout()
  
  this.logger.debug(`Connecting to ${key} (timeout: ${timeout}ms)`)
  
  try {
    // Create connection with adaptive timeout
    const socket = await this.createConnectionWithTimeout(peerInfo, timeout)
    
    // Record successful connection time
    const connectionTime = Date.now() - connectStartTime
    this.connectionTiming.recordSuccess(connectionTime)
    
    // ... rest of success handling ...
    
  } catch (error) {
    const elapsed = Date.now() - connectStartTime
    
    // Check if this was a timeout
    if (error instanceof Error && error.message.includes('timeout')) {
      this.connectionTiming.recordTimeout()
      this.logger.debug(`Connection to ${key} timed out after ${elapsed}ms`)
    }
    
    // ... rest of error handling ...
  }
}
```

#### Add timeout wrapper method:

```typescript
/**
 * Create a TCP connection with an internal timeout.
 * This runs independently of the io-daemon's 30s backstop.
 */
private async createConnectionWithTimeout(
  peerInfo: PeerInfo,
  timeoutMs: number
): Promise<TcpSocket> {
  return new Promise((resolve, reject) => {
    let settled = false
    
    // Internal timeout
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        reject(new Error(`Connection timeout after ${timeoutMs}ms`))
      }
    }, timeoutMs)
    
    // Attempt connection
    this.socketFactory
      .createTcpSocket(peerInfo.ip, peerInfo.port)
      .then((socket) => {
        if (!settled) {
          settled = true
          clearTimeout(timer)
          resolve(socket)
        } else {
          // Timeout already fired, close the socket
          socket.close()
        }
      })
      .catch((error) => {
        if (!settled) {
          settled = true
          clearTimeout(timer)
          reject(error)
        }
      })
  })
}
```

#### Add method to expose timing stats:

```typescript
/**
 * Get connection timing statistics for debugging/UI.
 */
getConnectionTimingStats(): ConnectionTimingStats {
  return this.connectionTiming.getStats()
}
```

### 2.3 Optional: Add periodic logging

In the maintenance loop, optionally log timing stats:

```typescript
private runMaintenance(): void {
  // ... existing maintenance ...
  
  // Log timing stats occasionally (every 10th run or so)
  if (this.maintenanceCount % 10 === 0) {
    const timing = this.connectionTiming.getStats()
    if (timing.sampleCount > 0) {
      this.logger.debug(
        `Connection timing: timeout=${timing.currentTimeout}ms, ` +
        `avg=${timing.average}ms, p95=${timing.p95}ms, ` +
        `samples=${timing.sampleCount}, timeouts=${timing.totalTimeouts}`
      )
    }
  }
}
```

---

## Part 3: Export and Index Updates

### `packages/engine/src/core/index.ts`

Add export:

```typescript
export { ConnectionTimingTracker, ConnectionTimingStats } from './connection-timing'
```

---

## Expected Behavior

| Network Type | Observed p95 | Adaptive Timeout | Notes |
|--------------|--------------|------------------|-------|
| Fast (fiber) | ~200ms | 3,000ms (MIN) | Clamped to minimum |
| Normal broadband | ~1,500ms | 3,750ms | 1500 × 2.5 |
| Slow DSL | ~4,000ms | 10,000ms | 4000 × 2.5 |
| Satellite | ~12,000ms | 30,000ms (MAX) | Clamped to maximum |
| Before data | N/A | 10,000ms | Default until 5 samples |

## Testing Considerations

1. **Unit tests for ConnectionTimingTracker:**
   - Verify MIN/MAX bounds are respected
   - Verify p95 calculation
   - Verify default used with < 5 samples

2. **Integration tests:**
   - Mock slow connections and verify timeout adapts
   - Verify successful connections are timed correctly

3. **Manual testing:**
   - Check logs show reasonable timeout values
   - Verify timeouts increase on slow networks (use network throttling)

---

## Summary of Changes

| File | Change |
|------|--------|
| `native-host/io-daemon/src/ws.rs` | Change timeout from 10s to 30s |
| `packages/engine/src/core/connection-timing.ts` | New file - timing tracker |
| `packages/engine/src/core/torrent.ts` | Add timing tracking, timeout wrapper |
| `packages/engine/src/core/index.ts` | Export new module |
