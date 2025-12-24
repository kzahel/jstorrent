# Android SAF Storage Architecture

This document analyzes three approaches for adding SAF (Storage Access Framework) support to the standalone Android native mode, enabling downloaded files to be visible in the Files app and accessible to media players.

## Problem Statement

Files downloaded in standalone native mode are stored in app-private storage (`/data/data/com.jstorrent.app/files/downloads/`), making them:
- Invisible to the Android Files app
- Inaccessible to media players and other apps
- Deleted when the app is uninstalled

SAF provides a way to write to user-selected folders while maintaining proper Android storage permissions.

## Current Architecture

### Two File I/O Paths

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Companion Mode (Extension + Android App)                                │
│                                                                         │
│   Extension (TypeScript)                                                │
│       ↓ HTTP API                                                        │
│   CompanionHttpServer                                                   │
│       ↓ POST /write/{root_key}                                          │
│   FileRoutes (validation, hash check)                                   │
│       ↓                                                                 │
│   FileManagerImpl (io-core)                                             │
│       ↓ SAF DocumentFile + ParcelFileDescriptor                         │
│   User-selected folder ✓ VISIBLE TO FILES APP                          │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│ Standalone Mode (Native Android App)                                    │
│                                                                         │
│   QuickJS Engine (JavaScript)                                           │
│       ↓ Native bindings                                                 │
│   FileBindings → FileHandleManager                                      │
│       ↓ RandomAccessFile                                                │
│   App-private storage ✗ INVISIBLE TO FILES APP                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Key Components

| Component | Location | Current State |
|-----------|----------|---------------|
| SAF folder picker | `AddRootActivity.kt` | Ready |
| Root persistence | `RootStore.kt` | Ready, has `resolveKey(key) → Uri` |
| SAF file I/O | `FileManagerImpl.kt` | Ready, full SAF with caching |
| File bindings | `FileBindings.kt` | Passes rootKey (but ignored) |
| Handle manager | `FileHandleManager.kt` | Uses app-private only |

### Usage Pattern Differences

| Aspect | Companion-Server | FileHandleManager |
|--------|------------------|-------------------|
| **Model** | Stateless per-request | Stateful open handles |
| **Reason** | HTTP request/response lifecycle | Many sequential piece writes |
| **File descriptor** | Open/close per request | Keep open for duration |
| **Efficiency** | Acceptable for HTTP latency | Critical for many small writes |
| **Current storage** | SAF (user-visible) | App-private (hidden) |

Both ultimately need **random-access writes via ParcelFileDescriptor** - the difference is whether the file descriptor is kept open or reopened for each operation.

---

## Approach A: Full Abstraction (IFileHandle + IFileStorage)

Create shared interfaces in `io-core` that both companion-server and quickjs-engine use.

### New Interfaces

```kotlin
// io-core/src/main/java/com/jstorrent/io/file/IFileHandle.kt
interface IFileHandle : Closeable {
    fun read(position: Long, length: Int): ByteArray
    fun write(position: Long, data: ByteArray): Int
    fun truncate(len: Long)
    fun sync()
}

// io-core/src/main/java/com/jstorrent/io/file/IFileStorage.kt
interface IFileStorage {
    fun open(path: String, mode: String): IFileHandle
    fun stat(path: String): FileStat?
    fun mkdir(path: String): Boolean
    fun exists(path: String): Boolean
    fun readdir(path: String): List<String>
    fun delete(path: String): Boolean
}
```

### SAF Implementation

```kotlin
// io-core/src/main/java/com/jstorrent/io/file/SafFileStorage.kt
class SafFileStorage(
    private val context: Context,
    private val rootUri: Uri
) : IFileStorage {
    private val documentFileCache = LruCache<String, DocumentFile>(200)

    override fun open(path: String, mode: String): IFileHandle {
        val docFile = getOrCreateDocumentFile(path, mode)
        val pfd = context.contentResolver.openFileDescriptor(docFile.uri,
            if (mode == "r") "r" else "rw"
        )!!
        return SafFileHandle(pfd)
    }
    // ... other methods
}

class SafFileHandle(private val pfd: ParcelFileDescriptor) : IFileHandle {
    private val channel = FileOutputStream(pfd.fileDescriptor).channel

    override fun write(position: Long, data: ByteArray): Int {
        channel.position(position)
        return channel.write(ByteBuffer.wrap(data))
    }

    override fun sync() {
        pfd.fileDescriptor.sync()
    }

    override fun close() {
        channel.close()
        pfd.close()
    }
}
```

### Usage in FileHandleManager

```kotlin
class FileHandleManager(
    private val context: Context,
    private val storageProvider: ((rootKey: String) -> IFileStorage?)? = null
) {
    private val handles = ConcurrentHashMap<Int, IFileHandle>()
    private val fallbackStorage = AppPrivateFileStorage(context)

    fun open(handleId: Int, rootKey: String, path: String, mode: String): Boolean {
        val storage = storageProvider?.invoke(rootKey) ?: fallbackStorage
        handles[handleId] = storage.open(path, mode)
        return true
    }
}
```

### Files to Create/Modify

**io-core (new):**
- `IFileHandle.kt` - Handle interface
- `IFileStorage.kt` - Storage interface
- `SafFileStorage.kt` - SAF storage implementation
- `SafFileHandle.kt` - SAF handle implementation

**quickjs-engine:**
- `AppPrivateFileStorage.kt` - Fallback implementation
- `FileHandleManager.kt` - Use IFileStorage
- `NativeBindings.kt` - Accept storage provider

**companion-server (refactor):**
- `FileManagerImpl.kt` - Adapt to use IFileStorage or wrap

**app:**
- Storage provider wiring in EngineService

### Tradeoffs

| Pros | Cons |
|------|------|
| Maximum code reuse between modes | Most upfront development work |
| Clean separation of concerns | Requires companion-server refactor |
| Enables future storage backends (cloud, network, etc.) | May be over-engineered if only SAF is needed |
| Single implementation for SAF logic | More interfaces to maintain |
| Easier testing with mock storage | Learning curve for contributors |

### Effort Estimate

- Create interfaces: 1-2 hours
- SAF implementation: 4-6 hours
- AppPrivate implementation: 1-2 hours
- Refactor FileHandleManager: 2-3 hours
- Refactor companion-server: 3-4 hours
- Wiring and testing: 2-3 hours
- **Total: 13-20 hours**

---

## Approach B: Minimal SAF Integration

Add SAF support directly to `FileHandleManager` without new interfaces. Copy/adapt the ParcelFileDescriptor logic from `FileManagerImpl`.

### Implementation

```kotlin
class FileHandleManager(
    private val context: Context,
    private val rootResolver: ((String) -> Uri?)? = null
) {
    private val baseDir: File by lazy {
        File(context.filesDir, "downloads").also { it.mkdirs() }
    }

    private val handles = ConcurrentHashMap<Int, OpenHandle>()
    private val documentFileCache = LinkedHashMap<String, DocumentFile>(100, 0.75f, true)

    private sealed class OpenHandle {
        abstract fun read(position: Long, length: Int): ByteArray
        abstract fun write(position: Long, data: ByteArray): Int
        abstract fun sync()
        abstract fun close()

        // App-private storage handle
        class Private(val raf: RandomAccessFile) : OpenHandle() { ... }

        // SAF storage handle
        class Saf(val pfd: ParcelFileDescriptor, val channel: FileChannel) : OpenHandle() { ... }
    }

    fun open(handleId: Int, rootKey: String, path: String, mode: String): Boolean {
        val uri = rootResolver?.invoke(rootKey)

        val handle = if (uri != null) {
            openSaf(uri, path, mode)
        } else {
            openPrivate(path, mode)
        }

        handles[handleId] = handle
        return true
    }

    private fun openSaf(rootUri: Uri, path: String, mode: String): OpenHandle.Saf {
        val docFile = getOrCreateDocumentFile(rootUri, path, mode)
        val pfd = context.contentResolver.openFileDescriptor(docFile.uri,
            if (mode == "r") "r" else "rw"
        )!!
        val channel = FileOutputStream(pfd.fileDescriptor).channel
        return OpenHandle.Saf(pfd, channel)
    }
}
```

### Files to Modify

**quickjs-engine:**
- `FileHandleManager.kt` - Add SAF logic, sealed class for handles
- `NativeBindings.kt` - Accept root resolver

**app:**
- Wire root resolver in EngineService

### Tradeoffs

| Pros | Cons |
|------|------|
| Fastest to implement | Duplicates ~100 lines from FileManagerImpl |
| No changes to companion-server | SAF logic in two places |
| Minimal new files | Harder to maintain if SAF behavior changes |
| No new dependencies | No path to other storage backends |
| Isolated change | DocumentFile cache duplicated |

### Effort Estimate

- Copy/adapt SAF logic: 2-3 hours
- Update FileHandleManager: 3-4 hours
- Wire root resolver: 1 hour
- Testing: 2 hours
- **Total: 8-10 hours**

---

## Approach C: Reuse FileManagerImpl

Use `FileManagerImpl` from `FileHandleManager`, but maintain open file handles. Keep `FileManagerImpl` for path/DocumentFile resolution, but manage ParcelFileDescriptor lifecycle in FileHandleManager.

### Implementation

```kotlin
class FileHandleManager(
    private val context: Context,
    private val rootResolver: ((String) -> Uri?)? = null,
    private val fileManager: FileManager? = null  // FileManagerImpl from io-core
) {
    private val handles = ConcurrentHashMap<Int, OpenHandle>()

    private data class OpenHandle(
        val rootUri: Uri?,
        val path: String,
        val mode: String,
        // For SAF: use PFD directly
        val pfd: ParcelFileDescriptor?,
        val channel: FileChannel?,
        // For private: use RAF
        val raf: RandomAccessFile?
    )

    fun open(handleId: Int, rootKey: String, path: String, mode: String): Boolean {
        val uri = rootResolver?.invoke(rootKey)

        if (uri != null && fileManager != null) {
            // Use FileManager to resolve/create the DocumentFile
            val docFile = fileManager.getOrCreateFile(uri, path)
                ?: return false

            // Open our own PFD to keep handle open
            val pfd = context.contentResolver.openFileDescriptor(docFile.uri,
                if (mode == "r") "r" else "rw"
            ) ?: return false

            val channel = FileOutputStream(pfd.fileDescriptor).channel
            handles[handleId] = OpenHandle(uri, path, mode, pfd, channel, null)
        } else {
            // Fallback to private storage
            val file = resolvePath(path)
            val raf = RandomAccessFile(file, if (mode == "r") "r" else "rw")
            handles[handleId] = OpenHandle(null, path, mode, null, null, raf)
        }
        return true
    }
}
```

### Files to Modify

**quickjs-engine:**
- `FileHandleManager.kt` - Hybrid approach
- `NativeBindings.kt` - Accept FileManager + root resolver

**app:**
- Wire FileManagerImpl and root resolver in EngineService

### Tradeoffs

| Pros | Cons |
|------|------|
| Reuses FileManagerImpl's DocumentFile caching | Awkward hybrid: FileManager for resolution, own PFD for handle |
| Less code duplication than Approach B | Still need to manage PFD lifecycle separately |
| No refactor of companion-server | FileManager.getOrCreateFile() designed for stateless use |
| Leverages tested SAF navigation code | Cache may hold stale DocumentFile refs if files deleted externally |
| Moderate implementation effort | Two layers of abstraction for same operation |

### Effort Estimate

- Update FileHandleManager: 3-4 hours
- Wire dependencies: 1 hour
- Testing: 2 hours
- **Total: 6-7 hours**

---

## Comparison Matrix

| Criterion | A: Full Abstraction | B: Minimal SAF | C: Reuse FileManagerImpl |
|-----------|---------------------|----------------|--------------------------|
| **Implementation effort** | High (13-20h) | Low (8-10h) | Medium (6-7h) |
| **Code duplication** | None | ~100 lines | ~50 lines |
| **Companion-server changes** | Refactor needed | None | None |
| **Future extensibility** | Excellent | Poor | Moderate |
| **Maintenance burden** | Low (single source) | High (two SAF impls) | Moderate |
| **Risk** | Higher (more changes) | Lower (isolated) | Moderate |
| **Testing complexity** | Lower (mockable) | Higher | Moderate |
| **Module coupling** | Low (via interfaces) | Low | Medium (FileManager dep) |

---

## Recommendation

### For MVP/Testing: Approach C (Reuse FileManagerImpl)

**Rationale:**
- Quickest path to working SAF storage
- Reuses proven DocumentFile resolution code
- No changes to companion-server
- Can be refactored to Approach A later if needed

### For Long-term: Approach A (Full Abstraction)

**When to adopt:**
- After MVP is validated and SAF works
- If planning additional storage backends
- If companion-server needs refactoring anyway
- When consolidating storage code makes sense

### Not Recommended: Approach B (Minimal SAF)

**Reason:**
- Same effort as C but more duplication
- Creates two separate SAF implementations to maintain
- No path to code reuse
- Technical debt with no compensating benefit

---

## Implementation Steps (Approach C)

1. **Update FileHandleManager constructor** to accept FileManager and root resolver
2. **Add sealed class** for Private vs SAF handles
3. **Modify open()** to use FileManager.getOrCreateFile() for SAF, then keep PFD open
4. **Update read/write/sync/close** to handle both handle types
5. **Wire in NativeBindings** and EngineService
6. **Test on emulator** with SAF folder selection

### Key Files

| File | Changes |
|------|---------|
| `android/quickjs-engine/.../FileHandleManager.kt` | Add SAF handle type, use FileManager |
| `android/quickjs-engine/.../NativeBindings.kt` | Accept FileManager + resolver |
| `android/app/.../EngineService.kt` | Wire dependencies |
| `android/app/.../storage/RootStore.kt` | Already has resolveKey() |
| `android/io-core/.../FileManagerImpl.kt` | No changes needed |

---

## Appendix: SAF Handle Lifecycle

For reference, here's how SAF random-access writes work:

```kotlin
// 1. Resolve path to DocumentFile (expensive - involves SAF queries)
val docFile = DocumentFile.fromTreeUri(context, rootUri)
    ?.findFile("subdir")
    ?.findFile("file.bin")

// 2. Open ParcelFileDescriptor (like a file handle)
val pfd = context.contentResolver.openFileDescriptor(docFile.uri, "rw")

// 3. Get FileChannel for random access
val channel = FileOutputStream(pfd.fileDescriptor).channel

// 4. Write at position (can be called many times)
channel.position(offset)
channel.write(ByteBuffer.wrap(data))

// 5. Sync to storage
pfd.fileDescriptor.sync()

// 6. Close when done
channel.close()
pfd.close()
```

The key insight: Step 1 is expensive (SAF queries). Steps 4-5 are cheap. Keeping the PFD/channel open across operations is what makes handle-based I/O efficient.
