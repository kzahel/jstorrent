# Phase 3: Update Repository Layer for Async

## Goal

Update `TorrentRepository` interface and `EngineServiceRepository` implementation so queries don't block the Main thread. Commands stay fire-and-forget (results via StateFlow/events).

## Design Decision

- **Commands** (`addTorrent`, `pauseTorrent`, `resumeTorrent`, `removeTorrent`): Fire-and-forget, non-blocking. Results flow via `state` StateFlow. Errors flow via `lastError` StateFlow.
- **Queries** (`getTorrentList`, `getFiles`): Suspend functions that return results without blocking.

This matches how the QuickJS bridge works - commands don't return meaningful results synchronously.

## Scope

**Files:**
- `android/app/src/main/java/com/jstorrent/app/viewmodel/TorrentRepository.kt`
- `android/app/src/main/java/com/jstorrent/app/viewmodel/EngineServiceRepository.kt`

## Changes

### TorrentRepository.kt

```kotlin
interface TorrentRepository {
    // State (unchanged)
    val state: StateFlow<EngineState?>
    val isLoaded: StateFlow<Boolean>
    val lastError: StateFlow<String?>

    // Commands - fire and forget (use async internally, but don't expose suspend)
    fun addTorrent(magnetOrBase64: String)
    fun pauseTorrent(infoHash: String)
    fun resumeTorrent(infoHash: String)
    fun removeTorrent(infoHash: String, deleteFiles: Boolean = false)
    fun pauseAll()
    fun resumeAll()

    // Queries - suspend, need actual result
    suspend fun getTorrentList(): List<TorrentInfo>
    suspend fun getFiles(infoHash: String): List<FileInfo>
}
```

### EngineServiceRepository.kt

- Add internal `CoroutineScope` for launching async commands
- Commands: `scope.launch { service?.addTorrentAsync(...) }`
- Queries: Delegate to `service?.getTorrentListAsync()` directly (suspend)

```kotlin
class EngineServiceRepository : TorrentRepository {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    
    override fun addTorrent(magnetOrBase64: String) {
        scope.launch { service?.addTorrentAsync(magnetOrBase64) }
    }
    
    override suspend fun getTorrentList(): List<TorrentInfo> {
        return service?.getTorrentListAsync() ?: emptyList()
    }
    // ... etc
}
```

## Instrumented Tests

Create `android/app/src/androidTest/java/com/jstorrent/app/RepositoryAsyncTest.kt`

Key tests:

1. **Commands don't block Main thread**
   - Call `addTorrent()` from Main, verify returns in <50ms
   
2. **Queries work from coroutine**
   - Call `getTorrentList()` in `runTest`, verify returns list
   
3. **pauseAll/resumeAll don't block**
   - These iterate torrents internally, previously would block multiple times

```kotlin
@RunWith(AndroidJUnit4::class)
class RepositoryAsyncTest {
    
    @Test
    fun addTorrent_returnsImmediately() {
        val elapsed = measureTimeMillis {
            runBlocking(Dispatchers.Main) {
                repository.addTorrent("magnet:?xt=urn:btih:...")
            }
        }
        assertTrue("Should return in <50ms, took ${elapsed}ms", elapsed < 50)
    }
    
    @Test
    fun getTorrentList_suspendVersion_works() = runTest {
        val list = repository.getTorrentList()
        assertNotNull(list)
    }
}
```

## Verification

```bash
cd android
./gradlew :app:connectedAndroidTest
```

## Depends On

Phase 2 complete (EngineService has `*Async()` methods)

## What's Next

Phase 4: Update Activity call sites (`syncRootsWithEngine()`, pending magnet handling) to use the async methods properly.
