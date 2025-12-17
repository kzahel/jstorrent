# Fix UPnP Port Collision: Random Port Per Device

## Problem
Two JSTorrent instances on the same network with the same listening port will keep overwriting each other's UPnP mapping. Compounding factor: port is stored in `chrome.storage.sync`, so all devices on the same Chrome account share the same port.

Additionally, DHT uses `port + 1`, so we need two consecutive ports available.

## Solution: Random Port Per Device (Wide Range)

Change port storage from `sync` to `local`. On first run (no stored port), generate a random port in range **10000-60000**.

### Why 10000-60000?
- **~50K ports** - negligible collision probability (even 50 devices < 5% collision)
- **Our peer scoring treats all ports >= 1024 equally** - no bonus for traditional BT range
- **Avoids privileged ports** (< 1024 get -500 penalty)
- **Avoids common dev ports** (3000, 5000, 8000, 8080)
- **Avoids potential ISP throttling** on traditional BT ports 6881-6999
- **Upper bound 60000** ensures DHT port (60001 max) is well below 65535

## Files to Modify

### 1. `packages/engine/src/settings/schema.ts` (lines 145-152)

```typescript
listeningPort: {
  type: 'number',
  storage: 'local',      // Changed from 'sync'
  default: 0,            // 0 = generate random on first run
  min: 1024,
  max: 65535,
  restartRequired: true,
},
```

### 2. `packages/engine/src/settings/base-settings-store.ts` - Fix race condition

The current `init()` has a race condition - the `this.initialized` flag check isn't atomic, so two concurrent calls can both pass the check before either sets the flag.

**Fix**: Use singleton promise pattern (like `extension/src/lib/install-id.ts`):

```typescript
// Add private field (line ~27)
private initPromise: Promise<void> | null = null

// Replace init() method (lines 63-78)
async init(): Promise<void> {
  if (!this.initPromise) {
    this.initPromise = this.doInit()
  }
  return this.initPromise
}

private async doInit(): Promise<void> {
  if (this.initialized) return

  const stored = await this.loadFromStorage()

  // Merge stored values into cache (with validation)
  for (const key of Object.keys(stored) as SettingKey[]) {
    const value = stored[key]
    if (value !== undefined) {
      ;(this.cache as Record<SettingKey, unknown>)[key] = validateValue(key, value)
    }
  }

  this.initialized = true
}
```

### 3. `packages/client/src/settings/chrome-settings-store.ts`

Override `init()` with singleton promise pattern + port generation:

```typescript
// Add after line 23 (changeListener field)
private initPromise: Promise<void> | null = null

// Add after loadFromStorage or at end of class
async init(): Promise<void> {
  if (!this.initPromise) {
    this.initPromise = this.doInit()
  }
  return this.initPromise
}

private async doInit(): Promise<void> {
  await super.init()

  // Generate random listening port on first run (10000-60000)
  // Wide range minimizes collision when multiple devices on same network
  // DHT uses port+1, so we need two consecutive ports
  if (this.get('listeningPort') === 0) {
    const randomPort = 10000 + Math.floor(Math.random() * 50001) // 10000-60000
    await this.set('listeningPort', randomPort)
  }
}
```

**Note**: `LocalStorageSettingsStore` (dev mode) gets the base class race fix for free. Dev mode doesn't need random port generation since there's no multi-device sync concern.

## Testing
1. Fresh install → gets random port in 10000-60000
2. Existing user → gets new random port (old sync setting ignored since storage changed to local)
3. Two devices on same network → different ports, no UPnP collision
4. User manually changes port in settings → preserved across restarts
5. Verify DHT works on port+1
6. **Race condition test**: Multiple concurrent init() calls should result in same port

## Migration Note
Existing users who had a manually-set port in sync storage will lose that setting and get a new random port. This is acceptable since the old behavior was broken for multi-device anyway.
