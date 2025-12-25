# Dynamic Runtime Configuration Challenges

This document captures the difficulties encountered when implementing dynamic storage root updates at runtime in native standalone Android mode. These same patterns and pitfalls apply to other dynamic configuration scenarios across extension, companion, and desktop modes.

## Problem Statement

The engine starts before all configuration is available. For Android SAF storage, the user must pick a download folder after app launch, but torrents may already be added and attempting to download. The engine needs to accept configuration updates at runtime and have existing operations "just work" after the configuration becomes available.

## Key Challenges Encountered

### 1. Race Condition: Engine Starts Before Configuration

**Symptom:** `No storage root found for torrent` error even though the user had picked a folder.

**Root Cause:** The engine initializes and torrents start downloading before the user has a chance to configure storage. The torrent receives metadata from peers and immediately tries to write - which fails because no storage root exists yet.

**Log Evidence:**
```
[Client:t:18a7aa] Metadata verified successfully!
Fatal write error - stopping torrent: No storage root found for torrent 18a7aacab6d2bc518e336921ccd4b6cc32a9624b
```

**Solution:** Implement dynamic root updates that can be called after engine initialization:
- TypeScript: `__jstorrent_cmd_add_root()`, `__jstorrent_cmd_set_default_root()`
- Kotlin: `EngineController.addRoot()`, `EngineController.setDefaultRoot()`

### 2. Multiple Instances of State Stores

**Symptom:** Root added in `AddRootActivity` but engine's `RootStore` doesn't see it.

**Root Cause:** `AddRootActivity` and `EngineService` each create their own `RootStore` instance. They read from the same SharedPreferences file, but changes made by one instance aren't visible to the other until explicitly reloaded.

**Solution:** Call `rootStore.reload()` before resolving root keys:
```kotlin
val rootResolver: (String) -> Uri? = { key ->
    rootStore.reload()  // Critical: reload before resolve
    rootStore.resolveKey(key)
}
```

**Lesson:** When configuration is stored in files/preferences, be aware that multiple instances may have stale views. Either:
- Use a singleton pattern
- Explicitly reload before reads
- Use a reactive store with change notifications

### 3. Default Callback Returns Wrong Value

**Symptom:** `Unknown root key` errors from FileBindings even though roots are configured.

**Root Cause:** `EngineController` was created with a default `rootResolver = { null }` that always returned null, ignoring the actual RootStore.

```kotlin
class EngineController(
    ...
    private val rootResolver: (String) -> Uri? = { null },  // BUG: always null!
)
```

**Solution:** Pass a proper rootResolver that queries RootStore:
```kotlin
val rootResolver: (String) -> Uri? = { key ->
    rootStore.reload()
    rootStore.resolveKey(key)
}

_controller = EngineController(
    context = this,
    scope = ioScope,
    rootResolver = rootResolver  // Now actually resolves keys
)
```

**Lesson:** Default parameter values that return empty/null are dangerous for callback patterns. They silently fail without obvious errors. Prefer required parameters or defaults that clearly indicate "not configured".

### 4. Promise Caching with Synchronous Exceptions (The Hardest Bug)

**Symptom:** After adding a storage root and resuming a torrent, the write still fails with the same error - but `getFileSystemForTorrent()` is never called again.

**Root Cause:** JavaScript async execution order causes rejected promises to be cached permanently.

The buggy code:
```typescript
private async getFileHandle(path: string): Promise<IFileHandle> {
    // ... cache checks ...

    const openPromise = (async () => {
        try {
            const fs = this.storageHandle.getFileSystem()  // Throws synchronously!
            const handle = await fs.open(path, 'r+')
            // ...
        } finally {
            this.openingFiles.delete(path)  // Runs BEFORE set() below!
        }
    })()

    this.openingFiles.set(path, openPromise)  // Caches rejected promise
    return openPromise
}
```

**Execution order when `getFileSystem()` throws synchronously:**
1. Async IIFE is invoked, starts executing synchronously
2. `getFileSystem()` throws
3. `finally` block runs (deletes nothing - path not in map yet)
4. Async function returns rejected promise
5. `openingFiles.set(path, openPromise)` caches the rejected promise
6. Next call finds rejected promise in cache, returns it without retrying

**Solution:** Move cleanup to `.finally()` attached after adding to map:
```typescript
const openPromise = (async () => {
    const fs = this.storageHandle.getFileSystem()
    const handle = await fs.open(path, 'r+')
    // ...
})()

this.openingFiles.set(path, openPromise)

// Clean up AFTER adding to map, handles both sync and async errors
openPromise.finally(() => {
    this.openingFiles.delete(path)
})

return openPromise
```

**Lesson:** When caching promises that may reject:
- Be aware that async functions execute synchronously until first `await`
- `try/finally` inside async functions runs before outer code
- Use `.finally()` on the promise itself for cleanup, not `finally` block
- Test the error path explicitly, not just the happy path

### 5. Fallback Logic Not Exercised

**Symptom:** `getRootForTorrent()` should fall back to `defaultKey` but returns null.

**Root Cause:** The fallback was correct in code, but earlier caching prevented the code from being reached on retry.

```typescript
getRootForTorrent(torrentId: string): StorageRoot | null {
    // First check torrent-specific root
    const key = this.torrentRoots.get(this.normalizeId(torrentId))
    if (key) {
        return this.roots.get(key) || null
    }
    // Fall back to default
    if (this.defaultKey) {
        return this.roots.get(this.defaultKey) || null  // Never reached!
    }
    return null
}
```

**Lesson:** When debugging, add logging at multiple layers to identify which layer is caching/failing. The bug may not be where the error originates.

## Debugging Techniques That Helped

### 1. Add Logging at Multiple Layers

```typescript
// In controller (high level)
console.log(`resume: roots=${...}, defaultKey=${...}`)

// In storage manager (mid level)
console.log(`getFileSystemForTorrent: roots=[...], defaultKey=${...}`)

// This revealed getFileSystemForTorrent wasn't being called at all
```

### 2. Compare Timing of Events

Log timestamps revealed the issue:
```
06:54:15.405 - resume: roots=["..."], defaultKey=...  (root IS set)
06:54:21.202 - Fatal write error  (but NO getFileSystemForTorrent log!)
```

The absence of a log between these events indicated caching.

### 3. Trace the Full Call Stack Mentally

When `getFileSystem()` wasn't called, trace backwards:
- `write()` → `getFileHandle()` → cache check → `openingFiles.has(path)` → returns cached promise

## Architecture Recommendations

### For Dynamic Configuration Generally

1. **Lazy Evaluation:** Use callbacks/factories instead of values
   ```typescript
   // Good: callback is called when needed, gets current value
   getFileSystem: () => engine.storageRootManager.getFileSystemForTorrent(id)

   // Bad: value is captured at creation time
   filesystem: engine.storageRootManager.getFileSystemForTorrent(id)
   ```

2. **Avoid Caching Errors:** Either don't cache at all, or clear cache on error
   ```typescript
   // If caching promises, clean up failures
   promise.catch(() => cache.delete(key))
   ```

3. **Notify on Configuration Changes:** When config changes, notify dependent components
   ```kotlin
   EngineService.instance?.controller?.addRoot(...)
   IoDaemonService.instance?.broadcastRootsChanged()
   ```

4. **Retry on Recoverable Errors:** `MissingStorageRootError` should allow retry
   ```typescript
   // userStart() tries to initialize storage if missing
   if (!this.contentStorage && this.hasMetadata) {
       await this.tryInitializeStorage()
   }
   ```

### For Multi-Process/Multi-Instance Systems

1. **Reload Before Read:** When state is shared via files
2. **Use Singletons Carefully:** Or ensure instances stay synchronized
3. **Consider Event-Driven Updates:** Rather than polling/reloading

## Files Modified in This Fix

| File | Change |
|------|--------|
| `packages/engine/src/adapters/native/controller.ts` | Added root management commands |
| `packages/engine/src/core/torrent-content-storage.ts` | Fixed promise caching bug |
| `android/.../EngineController.kt` | Added Kotlin wrappers for root management |
| `android/.../EngineService.kt` | Exposed controller, added proper rootResolver |
| `android/.../AddRootActivity.kt` | Notify engine after adding root |
| `android/.../NativeStandaloneActivity.kt` | Sync roots on resume |

## Applicability to Other Modes

These patterns apply to:

- **Extension mode:** Settings changes (download location, bandwidth limits) need to propagate to running engine
- **Companion mode:** Android/iOS app configuration needs to reach desktop engine
- **Desktop mode:** Native host configuration changes while extension is running

The key insight: any configuration that can change after engine initialization needs careful handling of:
1. How the new value propagates to the engine
2. How existing operations retry with the new value
3. How cached state is invalidated or refreshed
