# Phase 2: Add Async Methods to EngineService

## Goal

Expose suspend methods from `EngineService` so Activities and ViewModels can call engine operations without blocking.

## Scope

**File:** `android/app/src/main/java/com/jstorrent/app/service/EngineService.kt`

## Changes

Add suspend variants for each command/query method that delegates to the controller's async methods:

| Existing Method | Add Suspend Variant |
|-----------------|---------------------|
| `addTorrent()` | `addTorrentAsync()` |
| `pauseTorrent()` | `pauseTorrentAsync()` |
| `resumeTorrent()` | `resumeTorrentAsync()` |
| `removeTorrent()` | `removeTorrentAsync()` |
| `addTestTorrent()` | `addTestTorrentAsync()` |
| `getTorrentList()` | `getTorrentListAsync()` |
| `getFiles()` | `getFilesAsync()` |

## Pattern

```kotlin
// Existing (keep)
fun addTorrent(magnetOrBase64: String) {
    controller?.addTorrent(magnetOrBase64)
}

// Add
suspend fun addTorrentAsync(magnetOrBase64: String) {
    controller?.addTorrentAsync(magnetOrBase64)
}
```

## Notes

- Keep blocking versions for backward compatibility
- No changes to service lifecycle, binding, or notifications
- Just a thin pass-through layer to controller's async methods

## Verification

```bash
cd android
./gradlew :app:compileDebugKotlin
```

## Depends On

Phase 1 complete (EngineController has `*Async()` methods)
