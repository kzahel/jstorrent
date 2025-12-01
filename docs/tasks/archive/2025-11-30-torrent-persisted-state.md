# Refactor: Centralize Torrent Persisted State

## Problem

Torrent has many scattered public fields for persistence, each restored ad-hoc:

```typescript
// Current: fields scattered everywhere
torrent.magnetLink = data.magnetLink
torrent.torrentFileBase64 = data.torrentFile
torrent.addedAt = data.addedAt
torrent.totalDownloaded = state.downloaded
torrent.totalUploaded = state.uploaded
// ... etc
```

Adding a new persisted field requires:
1. Add field to Torrent
2. Update session-persistence.ts save logic
3. Update session-persistence.ts restore logic
4. Hope you didn't miss anything

## Goal

Single `TorrentPersistedState` interface that defines all persisted fields. One getter, one setter. Adding a new field = add to interface + done.

## Solution

### 1. Define the persisted state type

```typescript
// In torrent.ts or new file: torrent-persisted-state.ts

export interface TorrentPersistedState {
  // === Origin (at least one set) ===
  magnetLink?: string        // Original magnet URI
  torrentFile?: Uint8Array   // Whole .torrent file bytes
  
  // Info dict - for magnet, fetched from peers
  // For .torrent, can extract from torrentFile but cache here
  infoBuffer?: Uint8Array
  
  // === Timestamps ===
  addedAt: number
  completedAt?: number
  
  // === User Intent ===
  userState: TorrentUserState
  queuePosition?: number
  
  // === Stats ===
  totalDownloaded: number
  totalUploaded: number
  
  // === Progress ===
  completedPieces: number[]   // Indices of verified pieces
}

// Default for new torrents
export function createDefaultPersistedState(): TorrentPersistedState {
  return {
    addedAt: Date.now(),
    userState: 'active',
    totalDownloaded: 0,
    totalUploaded: 0,
    completedPieces: [],
  }
}
```

### 2. Add to Torrent class

```typescript
class Torrent {
  // Single source of truth for persisted fields
  private _persisted: TorrentPersistedState = createDefaultPersistedState()
  
  // === Derived getters ===
  
  get source(): 'magnet' | 'torrent-file' {
    return this._persisted.torrentFile ? 'torrent-file' : 'magnet'
  }
  
  get magnetLink(): string | undefined {
    return this._persisted.magnetLink
  }
  
  get torrentFile(): Uint8Array | undefined {
    return this._persisted.torrentFile
  }
  
  get addedAt(): number {
    return this._persisted.addedAt
  }
  
  get completedAt(): number | undefined {
    return this._persisted.completedAt
  }
  
  get userState(): TorrentUserState {
    return this._persisted.userState
  }
  
  get queuePosition(): number | undefined {
    return this._persisted.queuePosition
  }
  
  get totalDownloaded(): number {
    return this._persisted.totalDownloaded
  }
  
  get totalUploaded(): number {
    return this._persisted.totalUploaded
  }
  
  // === Mutators for runtime updates ===
  
  addDownloaded(bytes: number): void {
    this._persisted.totalDownloaded += bytes
  }
  
  addUploaded(bytes: number): void {
    this._persisted.totalUploaded += bytes
  }
  
  setUserState(state: TorrentUserState, queuePosition?: number): void {
    this._persisted.userState = state
    this._persisted.queuePosition = queuePosition
  }
  
  markCompleted(): void {
    this._persisted.completedAt = Date.now()
  }
  
  // === Persistence API ===
  
  getPersistedState(): TorrentPersistedState {
    return {
      ...this._persisted,
      // Always sync bitfield → completedPieces
      completedPieces: this._bitfield?.getSetIndices() ?? [],
      // Always sync metadataRaw → infoBuffer
      infoBuffer: this._metadataRaw ?? undefined,
    }
  }
  
  restorePersistedState(state: TorrentPersistedState): void {
    this._persisted = { ...state }
    
    // Restore bitfield from completedPieces
    if (state.completedPieces.length && this._bitfield) {
      for (const i of state.completedPieces) {
        this._bitfield.set(i, true)
      }
    }
    
    // Restore metadata
    if (state.infoBuffer) {
      this._metadataRaw = state.infoBuffer
      this._metadataComplete = true
    }
  }
  
  // === Initialization (called by BtEngine) ===
  
  initFromMagnet(magnetLink: string): void {
    this._persisted.magnetLink = magnetLink
  }
  
  initFromTorrentFile(torrentFile: Uint8Array): void {
    this._persisted.torrentFile = torrentFile
  }
}
```

### 3. Add BitField.getSetIndices()

```typescript
// In bitfield.ts
class BitField {
  getSetIndices(): number[] {
    const indices: number[] = []
    for (let i = 0; i < this._size; i++) {
      if (this.get(i)) {
        indices.push(i)
      }
    }
    return indices
  }
}
```

### 4. Simplify SessionPersistence

```typescript
class SessionPersistence {
  async saveTorrentState(torrent: Torrent): Promise<void> {
    const state = torrent.getPersistedState()
    const key = `torrent:${torrent.infoHashStr}`
    
    // Serialize - handle Uint8Array fields
    const serialized = {
      ...state,
      torrentFile: state.torrentFile ? this.uint8ArrayToBase64(state.torrentFile) : undefined,
      infoBuffer: state.infoBuffer ? this.uint8ArrayToBase64(state.infoBuffer) : undefined,
    }
    
    await this.store.set(key, JSON.stringify(serialized))
  }
  
  async restoreTorrentState(torrent: Torrent, infoHash: string): Promise<void> {
    const key = `torrent:${infoHash}`
    const data = await this.store.get(key)
    if (!data) return
    
    const parsed = JSON.parse(data)
    
    // Deserialize - restore Uint8Array fields
    const state: TorrentPersistedState = {
      ...parsed,
      torrentFile: parsed.torrentFile ? this.base64ToUint8Array(parsed.torrentFile) : undefined,
      infoBuffer: parsed.infoBuffer ? this.base64ToUint8Array(parsed.infoBuffer) : undefined,
    }
    
    torrent.restorePersistedState(state)
  }
}
```

### 5. Update BtEngine

```typescript
// In addTorrent()

// Before:
torrent.magnetLink = magnetLink
torrent.torrentFileBase64 = torrentFileBase64

// After:
if (magnetLink) {
  torrent.initFromMagnet(magnetLink)
} else if (torrentFileBytes) {
  torrent.initFromTorrentFile(torrentFileBytes)
}
```

## Adding a New Persisted Field

Example: adding `label` for user-defined labels/tags.

**Step 1: Add to interface**
```typescript
interface TorrentPersistedState {
  // ... existing fields
  label?: string
}
```

**Step 2: Add getter (and setter if mutable)**
```typescript
class Torrent {
  get label(): string | undefined {
    return this._persisted.label
  }
  
  setLabel(label: string | undefined): void {
    this._persisted.label = label
  }
}
```

**Done.** Persistence automatically includes it because `getPersistedState()` spreads `_persisted`.

## Migration Path

### Phase 1: Add TorrentPersistedState
- Add interface and `_persisted` field
- Add `getPersistedState()` and `restorePersistedState()`
- Keep old fields temporarily for compatibility

### Phase 2: Update SessionPersistence
- Use new methods for save/restore
- Remove ad-hoc field access

### Phase 3: Update BtEngine
- Use `initFromMagnet()` / `initFromTorrentFile()`
- Remove direct field assignments

### Phase 4: Remove old fields
- Delete the old public fields from Torrent
- Update any remaining callers to use getters

## Files to Modify

1. `packages/engine/src/core/torrent.ts` — add TorrentPersistedState, _persisted, methods
2. `packages/engine/src/utils/bitfield.ts` — add getSetIndices()
3. `packages/engine/src/core/session-persistence.ts` — use new methods
4. `packages/engine/src/core/bt-engine.ts` — use init methods
5. `packages/engine/src/core/engine-state.ts` — use getters

## Testing

1. Unit test `getPersistedState()` / `restorePersistedState()` round-trip
2. Integration test: add torrent, stop engine, restore, verify state matches
3. Test both magnet and .torrent file sources
