# MSE Handshake Race Condition Investigation

**Date**: 2025-12-17
**Test**: `'prefer' initiator with 'prefer' responder should encrypt`
**File**: `packages/engine/test/crypto/encryption-policy.test.ts:333`
**Symptom**: Timeout after 5s in CI (flaky)

## Summary

The test passes consistently locally but times out intermittently in CI. Root cause is unawaited async calls in the MSE handshake state machine.

## Root Cause

In `packages/engine/src/crypto/mse-handshake.ts`, the `processBuffer` method (lines 505-526) calls async methods without awaiting them:

```typescript
private processBuffer(onSend: (data: Uint8Array) => void): void {
  switch (this.state) {
    case 'sent_pubkey':
      this.processPe2(onSend)  // async, not awaited
      break
    case 'received_pubkey':
      this.processPe1(onSend)  // async, not awaited
      break
    case 'waiting_req1_sync':
      this.processReq1Sync(onSend)  // async, not awaited
      break
    case 'waiting_vc_sync':
      this.processPe4()  // async, not awaited
      break
  }
}
```

## Race Condition Flow

1. Data arrives via `onData()` which appends to buffer and calls `processBuffer()`
2. `processBuffer()` calls an async method (e.g., `processPe2`) which awaits `sha1()` or key derivation
3. While async method is suspended, more data arrives from the peer
4. `onData()` is called again, appending to buffer and calling `processBuffer()` again
5. State hasn't transitioned yet (async op still pending), so same handler runs again
6. Concurrent operations on same buffer can cause:
   - Double-processing of data
   - Buffer corruption
   - State machine getting stuck (never calling `complete()`)

## Contributing Factor

`MemorySocket.send()` uses a 1ms `setTimeout` delay:

```typescript
send(data: Uint8Array): void {
  setTimeout(() => {
    this.peer.onDataCb(copy)
  }, 1)  // 1ms delay
}
```

In CI under load, this timing becomes unreliable, making data arrive at unexpected intervals.

## Potential Fixes

1. **Processing lock**: Add a flag to prevent concurrent `processBuffer` calls, queue data instead
2. **Async processBuffer**: Make `processBuffer` async and await state handlers
3. **Sequential queue**: Queue all incoming data and process one chunk at a time after each async op completes

## Reproduction

Hard to reproduce locally due to timing sensitivity. More likely under CI load or slower machines.
