# Fixed Tick Rate Performance Analysis

**Date:** 2025-01-26
**Device:** Pixel 9
**Test:** LAN seeder (1GB) vs Real torrent (Ubuntu ISO)

## Summary

The fixed 100ms `setInterval` tick rate for `requestTick()` performs well with few peers/pieces but causes catastrophic performance degradation with many active pieces due to O(pieces × peers) iteration complexity.

## Test Results

### LAN Test (1 peer, few pieces) - HEALTHY

| Metric | Value |
|--------|-------|
| Active pieces | 9-13 |
| Peers/tick | 1 |
| RequestTick avg | 3.7-9ms |
| RequestTick max | 8-26ms |
| TCP callback latency avg | 2.8ms |
| TCP callback latency max | 33ms |
| TCP queue depth max | 2 |
| Disk write callback | 115-142ms (occasional) |
| Throughput | ~25 MB/s |

### Real Torrent (multiple peers, many pieces) - DEGRADED

| Metric | Value | vs LAN |
|--------|-------|--------|
| Active pieces | 500-626 | 50x more |
| Peers/tick | 5-18 | 5-18x more |
| RequestTick avg | 89-148ms | 16-40x slower |
| RequestTick max | 169-499ms | 20-60x slower |
| TCP callback latency avg | 230-1632ms | 80-580x slower |
| TCP callback latency max | 519-3231ms | 16-98x slower |
| TCP queue depth max | 104 (BACKPRESSURE) | 52x higher |
| JobPump avg | 80-118ms | N/A |
| JobPump max | 462-481ms | N/A |
| JS thread latency | 215-526ms | Detected |
| Throughput | 3-5 MB/s | 5-8x slower |

## Root Cause

The `requestTick()` game loop calls `requestPieces(peer)` for each unchoked peer. Phase 1 of `requestPieces()` iterates ALL active pieces:

```
Cost per tick = peers × active_pieces × (bitfield lookup + map operations + block checks)
```

- LAN: 1 peer × 10 pieces = 10 iterations → ~5ms
- Real: 5 peers × 600 pieces = 3,000 iterations → ~150ms

When tick execution (150ms) exceeds the interval (100ms), the system enters a "can't catch up" spiral:
1. Tick takes 150ms, next tick already 50ms overdue
2. Callbacks queue up while tick runs (no yield to event loop)
3. Queue depth grows, latency compounds
4. TCP backpressure triggers, throughput drops
5. More pieces stay active longer, making ticks even slower

## Key Observations

1. **BACKPRESSURE cascade**: TCP callback queue hit 104 pending items
2. **JS thread blocked**: 526ms latency detected by health monitor
3. **Throughput collapse**: 25 MB/s → 3-5 MB/s despite available bandwidth
4. **Self-reinforcing**: Slow ticks → more active pieces → slower ticks

## Comparison with Edge-Triggered

The previous edge-triggered implementation naturally adapted because:
- Processing only happened when data arrived
- Natural backpressure: slow processing → fewer requests → less incoming data
- No fixed interval to "fall behind"

## Potential Fixes

1. **Adaptive setTimeout**: Schedule next tick based on previous tick duration
   - Prevents "can't catch up" by yielding to event loop between ticks

2. **Budgeted iteration**: Process max N pieces per tick, continue next tick
   - Guarantees tick completes within budget

3. **Hybrid approach**: Edge-triggered for data, low-frequency tick for housekeeping
   - Best of both worlds: responsive + guaranteed maintenance

4. **Index optimization**: Track which peers want which active pieces
   - Avoid O(pieces × peers) scan entirely

## Code References

- Tick interval: `packages/engine/src/core/torrent.ts:1666-1681`
- requestTick: `packages/engine/src/core/torrent.ts:1695-1729`
- requestPieces Phase 1: `packages/engine/src/core/torrent.ts:2907-2940`
- requestPieces Phase 2: `packages/engine/src/core/torrent.ts:2949-2987`

## Instrumentation Used

```bash
adb logcat | grep -E "JsThread|TcpBindings|FileBindings|JSTorrent-JS.*RequestTick"
```

Key log patterns:
- `RequestTick: N ticks, avg Xms, max Yms, Z active pieces, W peers/tick`
- `JobPump: N batches, avg Xms, max Yms`
- `Callback latency: N calls, avg Xms, max Yms`
- `TCP recv: X MB/s (raw), queue depth: N (max: M)`
- `Disk write callback latency: Xms`
- `JS callback queue depth: N (BACKPRESSURE)`
- `JS thread latency: Xms`
