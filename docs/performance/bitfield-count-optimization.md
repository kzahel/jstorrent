# BitField.count() Optimization

**Status**: Done
**Priority**: Low (not in tick hot path)
**File**: `packages/engine/src/utils/bitfield.ts`

## Problem

Current `count()` is O(bits) and calls `get()` for each bit:

```typescript
count(): number {
  let count = 0
  for (let i = 0; i < this.length; i++) {
    if (this.get(i)) count++  // get() does division + modulo per call
  }
  return count
}
```

For a 4000-piece torrent, that's 4000 iterations with expensive math ops.

## Usage

`count()` is only used in `getSwarmInfo()` (torrent.ts:2243) for UI display of peer completion %. Not in tick hot path, but called on every status update.

## Solution

### Part 1: Popcount Lookup Table

Replace O(bits) with O(bytes) using a 256-entry lookup table:

```typescript
// Module-level constant (computed once at load)
const POPCOUNT = new Uint8Array(256)
for (let i = 0; i < 256; i++) {
  let n = i
  let count = 0
  while (n) {
    count += n & 1
    n >>= 1
  }
  POPCOUNT[i] = count
}

// In BitField class
private _computeCount(): number {
  let total = 0
  for (let i = 0; i < this.buffer.length; i++) {
    total += POPCOUNT[this.buffer[i]]
  }
  return total
}
```

### Part 2: Cached Incremental Count

Cache the count and update incrementally on mutations:

```typescript
private _count: number = 0
private _countValid: boolean = false

count(): number {
  if (!this._countValid) {
    this._count = this._computeCount()
    this._countValid = true
  }
  return this._count
}
```

### Methods to Update

**`set(index, value)`** - Update count incrementally:
```typescript
set(index: number, value: boolean = true): void {
  if (index < 0 || index >= this.length) return

  const byteIndex = Math.floor(index / 8)
  const bitIndex = 7 - (index % 8)
  const wasSet = ((this.buffer[byteIndex] >> bitIndex) & 1) === 1

  if (value && !wasSet) {
    this.buffer[byteIndex] |= 1 << bitIndex
    if (this._countValid) this._count++
  } else if (!value && wasSet) {
    this.buffer[byteIndex] &= ~(1 << bitIndex)
    if (this._countValid) this._count--
  }
}
```

**`restoreFromHex(hex)`** - Invalidate cache:
```typescript
restoreFromHex(hex: string): void {
  // ... existing logic ...
  this._countValid = false  // Add this
}
```

**`constructor(buffer: Uint8Array)`** - When initialized from existing buffer:
```typescript
constructor(lengthOrBuffer: number | Uint8Array) {
  // ... existing logic ...
  this._countValid = false  // Always start invalid
}
```

**Static factories** - `createFull()` can set count directly:
```typescript
static createFull(length: number): BitField {
  const bf = new BitField(length)
  bf.buffer.fill(0xff)
  // ... mask spare bits ...
  bf._count = length  // All bits set
  bf._countValid = true
  return bf
}

static createEmpty(length: number): BitField {
  const bf = new BitField(length)
  bf._count = 0
  bf._countValid = true
  return bf
}
```

## Edge Cases to Test

1. **Empty bitfield** - `count()` should return 0
2. **Full bitfield** - `count()` should return `length`
3. **Partial last byte** - 13 bits (1 full byte + 5 bits), verify spare bits ignored
4. **Incremental accuracy** - Set/clear bits randomly, verify `count()` matches naive recompute
5. **Cache invalidation** - After `restoreFromHex()`, count should recompute
6. **From buffer constructor** - BitField created from existing Uint8Array

## Test Template

```typescript
describe('BitField.count()', () => {
  test('empty bitfield returns 0', () => {
    const bf = BitField.createEmpty(100)
    expect(bf.count()).toBe(0)
  })

  test('full bitfield returns length', () => {
    const bf = BitField.createFull(100)
    expect(bf.count()).toBe(100)
  })

  test('partial last byte handled correctly', () => {
    const bf = BitField.createFull(13)  // 1 byte + 5 bits
    expect(bf.count()).toBe(13)
  })

  test('incremental set updates count', () => {
    const bf = BitField.createEmpty(100)
    bf.set(5)
    bf.set(10)
    bf.set(99)
    expect(bf.count()).toBe(3)
  })

  test('incremental clear updates count', () => {
    const bf = BitField.createFull(100)
    bf.set(5, false)
    bf.set(10, false)
    expect(bf.count()).toBe(98)
  })

  test('set same bit twice does not double count', () => {
    const bf = BitField.createEmpty(100)
    bf.set(5)
    bf.set(5)
    expect(bf.count()).toBe(1)
  })

  test('restoreFromHex invalidates cache', () => {
    const bf = BitField.createEmpty(16)
    bf.count()  // Prime cache
    bf.restoreFromHex('ff00')  // 8 bits set
    expect(bf.count()).toBe(8)
  })

  test('from buffer constructor', () => {
    const buffer = new Uint8Array([0xff, 0x0f])  // 8 + 4 = 12 bits
    const bf = new BitField(buffer)
    expect(bf.count()).toBe(12)
  })
})
```

## Performance Expectation

- `count()` first call: O(bytes) instead of O(bits) - ~8x faster
- `count()` subsequent calls: O(1) if no mutations
- `set()`: O(1) unchanged, just adds a conditional increment/decrement
