# Unified File I/O: Stateless API Refactoring

**Date:** December 24, 2025  
**Status:** Planning  
**Goal:** Make HTTP companion mode and QuickJS standalone mode use the same Kotlin file I/O implementation

---

## Background

Currently we have two separate file I/O implementations:

| Aspect | HTTP Companion | QuickJS Standalone |
|--------|----------------|-------------------|
| **Kotlin layer** | `FileManagerImpl` (io-core) | `FileHandleManager` (quickjs-engine) |
| **API style** | Stateless: `read(uri, path, offset, length)` | Stateful: `open()` → `read(handleId)` → `close()` |
| **Storage** | SAF via DocumentFile | App-private via RandomAccessFile |
| **Transport** | HTTP | JNI |

This creates:
- Duplicate code with divergent behavior
- Different storage backends (SAF vs app-private)
- Handle management complexity in QuickJS mode

## Target Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      TypeScript Engine                          │
│                                                                 │
│  NativeFileHandle stores (rootKey, path) - no numeric handleId │
│  read/write make stateless calls with full path info            │
└─────────────────────────┬───────────────────────────────────────┘
                          │
          ┌───────────────┴───────────────┐
          │                               │
          ▼                               ▼
┌─────────────────────┐         ┌─────────────────────┐
│  DaemonFileSystem   │         │  NativeFileSystem   │
│  (HTTP transport)   │         │  (JNI transport)    │
└─────────┬───────────┘         └─────────┬───────────┘
          │                               │
          │ HTTP POST /write/{root}       │ __jstorrent_file_write()
          │                               │
          ▼                               ▼
┌─────────────────────┐         ┌─────────────────────┐
│  FileRoutes.kt      │         │  FileBindings.kt    │
│  (Ktor routing)     │         │  (QuickJS glue)     │
└─────────┬───────────┘         └─────────┬───────────┘
          │                               │
          └───────────────┬───────────────┘
                          │
                          ▼
               ┌─────────────────────┐
               │   FileManagerImpl   │
               │     (io-core)       │
               │                     │
               │ - SAF operations    │
               │ - DocumentFile LRU  │
               │ - Thread-safe       │
               └─────────────────────┘
```

**Key insight:** The TypeScript `IFileHandle` interface has `open/read/write/close` semantics, but that doesn't mean the Kotlin implementation needs stateful handles. The NativeFileHandle can store `(rootKey, path)` and each read/write is a complete stateless call.

---

## Phases

### Phase 1: TypeScript Interface Changes

Update the native bindings to be stateless (matching HTTP semantics).

#### 1.1 Update bindings.d.ts

**Current (handle-based):**
```typescript
function __jstorrent_file_open(handleId: number, rootKey: string, path: string, mode: string): boolean
function __jstorrent_file_read(handleId: number, offset: number, length: number, position: number): ArrayBuffer
function __jstorrent_file_write(handleId: number, data: ArrayBuffer, position: number): number
function __jstorrent_file_close(handleId: number): void
function __jstorrent_file_truncate(handleId: number, len: number): boolean
function __jstorrent_file_sync(handleId: number): void
```

**New (stateless):**
```typescript
// Primary I/O operations - stateless, matching HTTP semantics
function __jstorrent_file_read(rootKey: string, path: string, offset: number, length: number): ArrayBuffer
function __jstorrent_file_write(rootKey: string, path: string, offset: number, data: ArrayBuffer): number

// Path operations - already stateless, unchanged
function __jstorrent_file_stat(rootKey: string, path: string): string | null
function __jstorrent_file_mkdir(rootKey: string, path: string): boolean
function __jstorrent_file_exists(rootKey: string, path: string): boolean
function __jstorrent_file_readdir(rootKey: string, path: string): string
function __jstorrent_file_delete(rootKey: string, path: string): boolean
```

**Removed functions:**
- `__jstorrent_file_open` - no longer needed
- `__jstorrent_file_close` - no longer needed
- `__jstorrent_file_truncate` - can add back if needed, but currently unused
- `__jstorrent_file_sync` - file is synced after each write

#### 1.2 Update NativeFileHandle

```typescript
// packages/engine/src/adapters/native/native-file-handle.ts

export class NativeFileHandle implements IFileHandle {
  private closed = false

  constructor(
    private readonly rootKey: string,
    private readonly path: string,
  ) {}

  async read(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ bytesRead: number }> {
    if (this.closed) throw new Error('File handle is closed')

    // Stateless call - Kotlin opens, seeks, reads, closes internally
    const result = __jstorrent_file_read(this.rootKey, this.path, position, length)

    if (!result || result.byteLength === 0) {
      return { bytesRead: 0 }
    }

    const data = new Uint8Array(result)
    const bytesToCopy = Math.min(data.length, buffer.length - offset)
    buffer.set(data.subarray(0, bytesToCopy), offset)

    return { bytesRead: bytesToCopy }
  }

  async write(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ bytesWritten: number }> {
    if (this.closed) throw new Error('File handle is closed')

    const data = buffer.subarray(offset, offset + length)
    const arrayBuffer = data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength,
    ) as ArrayBuffer

    // Stateless call - Kotlin opens, seeks, writes, closes internally
    const bytesWritten = __jstorrent_file_write(
      this.rootKey,
      this.path,
      position,
      arrayBuffer,
    )

    if (bytesWritten < 0) throw new Error('Write failed')
    return { bytesWritten }
  }

  async truncate(len: number): Promise<void> {
    // For now, throw - truncate is rarely used
    // Can be added back if needed
    throw new Error('Truncate not supported in stateless mode')
  }

  async sync(): Promise<void> {
    // No-op - each write is already synced
  }

  async close(): Promise<void> {
    // No-op - there's no actual handle to close
    this.closed = true
  }
}
```

#### 1.3 Update NativeFileSystem

```typescript
// packages/engine/src/adapters/native/native-filesystem.ts

export class NativeFileSystem implements IFileSystem {
  constructor(private readonly rootKey: string) {}

  async open(path: string, mode: 'r' | 'w' | 'r+'): Promise<IFileHandle> {
    // For 'w' mode, we might want to ensure parent dirs exist
    // But FileManagerImpl.write() already creates parents, so just return handle
    return new NativeFileHandle(this.rootKey, path)
  }

  // stat, mkdir, exists, readdir, delete - unchanged (already stateless)
  // ...
}
```

**Key change:** `open()` no longer calls `__jstorrent_file_open`. It just creates a NativeFileHandle that stores the rootKey and path. The actual file operations happen on read/write.

---

### Phase 2: Kotlin FileBindings Rewrite

Replace handle-based FileHandleManager calls with stateless FileManager calls.

#### 2.1 Update FileBindings Dependencies

```kotlin
// packages/quickjs-engine/.../bindings/FileBindings.kt

class FileBindings(
    private val fileManager: FileManager,        // From io-core
    private val rootResolver: (String) -> Uri?,  // Resolves rootKey → Uri
) {
    fun register(ctx: QuickJsContext) {
        registerReadWrite(ctx)
        registerPathFunctions(ctx)
    }
    
    // ...
}
```

#### 2.2 Rewrite Read/Write Bindings

```kotlin
private fun registerReadWrite(ctx: QuickJsContext) {
    // __jstorrent_file_read(rootKey: string, path: string, offset: number, length: number): ArrayBuffer
    ctx.setGlobalFunctionReturnsBinary("__jstorrent_file_read") { args, _ ->
        val rootKey = args.getOrNull(0) ?: ""
        val path = args.getOrNull(1) ?: ""
        val offset = args.getOrNull(2)?.toLongOrNull() ?: 0L
        val length = args.getOrNull(3)?.toIntOrNull() ?: 0

        if (path.isEmpty() || length <= 0) {
            return@setGlobalFunctionReturnsBinary ByteArray(0)
        }

        val rootUri = rootResolver(rootKey)
        if (rootUri == null) {
            Log.w(TAG, "Unknown root key: $rootKey")
            return@setGlobalFunctionReturnsBinary ByteArray(0)
        }

        try {
            fileManager.read(rootUri, path, offset, length)
        } catch (e: FileManagerException) {
            Log.e(TAG, "Read failed: $path", e)
            ByteArray(0)
        }
    }

    // __jstorrent_file_write(rootKey: string, path: string, offset: number, data: ArrayBuffer): number
    ctx.setGlobalFunctionWithBinary("__jstorrent_file_write", 3) { args, binary ->
        val rootKey = args.getOrNull(0) ?: ""
        val path = args.getOrNull(1) ?: ""
        val offset = args.getOrNull(2)?.toLongOrNull() ?: 0L

        if (path.isEmpty() || binary == null) {
            return@setGlobalFunctionWithBinary "-1"
        }

        val rootUri = rootResolver(rootKey)
        if (rootUri == null) {
            Log.w(TAG, "Unknown root key: $rootKey")
            return@setGlobalFunctionWithBinary "-1"
        }

        try {
            fileManager.write(rootUri, path, offset, binary)
            binary.size.toString()
        } catch (e: FileManagerException) {
            Log.e(TAG, "Write failed: $path", e)
            "-1"
        }
    }
}
```

#### 2.3 Update Path Functions

The path functions (stat, mkdir, exists, readdir, delete) need similar updates to use FileManager:

```kotlin
private fun registerPathFunctions(ctx: QuickJsContext) {
    // __jstorrent_file_exists(rootKey: string, path: string): boolean
    ctx.setGlobalFunction("__jstorrent_file_exists") { args ->
        val rootKey = args.getOrNull(0) ?: ""
        val path = args.getOrNull(1) ?: ""

        val rootUri = rootResolver(rootKey) ?: return@setGlobalFunction "false"
        fileManager.exists(rootUri, path).toString()
    }

    // Similar for stat, mkdir, readdir, delete...
}
```

**Note:** FileManager interface may need to be extended for `stat`, `mkdir`, `readdir`, `delete` if they're not already there. Currently it has `exists` and `getOrCreateFile`.

---

### Phase 3: Extend FileManager Interface

Add missing operations to FileManager that FileHandleManager currently provides.

#### 3.1 Update FileManager Interface

```kotlin
// io-core/.../file/FileManager.kt

interface FileManager {
    // Existing
    fun read(rootUri: Uri, relativePath: String, offset: Long, length: Int): ByteArray
    fun write(rootUri: Uri, relativePath: String, offset: Long, data: ByteArray)
    fun exists(rootUri: Uri, relativePath: String): Boolean
    fun getOrCreateFile(rootUri: Uri, relativePath: String): DocumentFile?
    fun clearCache()

    // New - needed by FileBindings
    fun stat(rootUri: Uri, relativePath: String): FileStat?
    fun mkdir(rootUri: Uri, relativePath: String): Boolean
    fun readdir(rootUri: Uri, relativePath: String): List<String>
    fun delete(rootUri: Uri, relativePath: String): Boolean
}

data class FileStat(
    val size: Long,
    val mtime: Long,
    val isDirectory: Boolean,
    val isFile: Boolean,
)
```

#### 3.2 Implement in FileManagerImpl

```kotlin
// io-core/.../file/FileManagerImpl.kt

override fun stat(rootUri: Uri, relativePath: String): FileStat? {
    val docFile = findFile(rootUri, relativePath) ?: return null
    return FileStat(
        size = docFile.length(),
        mtime = docFile.lastModified(),
        isDirectory = docFile.isDirectory,
        isFile = docFile.isFile,
    )
}

override fun mkdir(rootUri: Uri, relativePath: String): Boolean {
    // Navigate to parent, create directory
    val parts = relativePath.split("/").filter { it.isNotEmpty() }
    if (parts.isEmpty()) return false

    var current = DocumentFile.fromTreeUri(context, rootUri) ?: return false

    for (part in parts) {
        val existing = current.findFile(part)
        current = when {
            existing?.isDirectory == true -> existing
            existing != null -> return false // File exists, not a directory
            else -> current.createDirectory(part) ?: return false
        }
    }
    return true
}

override fun readdir(rootUri: Uri, relativePath: String): List<String> {
    val docFile = if (relativePath.isEmpty()) {
        DocumentFile.fromTreeUri(context, rootUri)
    } else {
        findFile(rootUri, relativePath)
    }

    return docFile?.listFiles()?.mapNotNull { it.name } ?: emptyList()
}

override fun delete(rootUri: Uri, relativePath: String): Boolean {
    val docFile = findFile(rootUri, relativePath) ?: return false
    return docFile.delete()
}
```

---

### Phase 4: Wiring and Dependency Injection

Connect FileBindings to FileManager and RootStore.

#### 4.1 Update QuickJsEngine

```kotlin
// quickjs-engine/.../QuickJsEngine.kt

class QuickJsEngine(
    private val context: Context,
    private val fileManager: FileManager,
    private val rootResolver: (String) -> Uri?,
) {
    private val fileBindings = FileBindings(fileManager, rootResolver)
    
    fun start() {
        // ...
        fileBindings.register(jsContext)
        // ...
    }
}
```

#### 4.2 Update EngineService

```kotlin
// app/.../service/EngineService.kt

class EngineService : Service() {
    private lateinit var engine: QuickJsEngine
    private lateinit var fileManager: FileManager
    private lateinit var rootStore: RootStore

    override fun onCreate() {
        super.onCreate()
        
        rootStore = RootStore(this)
        fileManager = FileManagerImpl(this)
        
        engine = QuickJsEngine(
            context = this,
            fileManager = fileManager,
            rootResolver = { key -> rootStore.resolveKey(key) },
        )
    }
}
```

---

### Phase 5: Cleanup

#### 5.1 Delete FileHandleManager

Remove the entire file:
```
android/quickjs-engine/src/main/kotlin/com/jstorrent/quickjs/file/FileHandleManager.kt
```

And the directory if empty:
```
android/quickjs-engine/src/main/kotlin/com/jstorrent/quickjs/file/
```

#### 5.2 Update Tests

- Remove FileHandleManager tests
- Add FileBindings integration tests using FileManagerImpl
- Update any existing tests that reference the old handle-based API

#### 5.3 Update Documentation

- Update ARCHITECTURE.md if it references FileHandleManager
- Update any diagrams showing the separate implementations

---

## Verification

### Unit Tests

```bash
cd android
./gradlew :quickjs-engine:test
./gradlew :io-core:test
```

### Integration Test

1. Build the app: `./gradlew assembleDebug`
2. Install on device/emulator
3. Add a torrent in standalone mode
4. Verify files download correctly
5. Check logs for any file operation errors

### Manual Test Checklist

- [ ] Standalone mode: Add magnet link, download completes
- [ ] Standalone mode: Files appear in expected location
- [ ] Companion mode: Still works (regression check)
- [ ] File read/write at various offsets works
- [ ] Large files (>100MB) work
- [ ] Directory creation works
- [ ] File deletion works

---

## Rollback Plan

If issues arise:
1. The old FileHandleManager can be restored from git
2. bindings.d.ts can be reverted
3. FileBindings can be reverted to use FileHandleManager

Keep the old code in a branch until the new implementation is proven stable.

---

## Future Enhancements

### Optional: File Descriptor Caching

If profiling shows file open/close is a bottleneck (unlikely), add LRU caching inside FileManagerImpl:

```kotlin
class FileManagerImpl(...) : FileManager {
    private val pfdCache = object : LruCache<String, ParcelFileDescriptor>(8) {
        override fun entryRemoved(evicted: Boolean, key: String, old: PFD, new: PFD?) {
            old.close()
        }
    }
}
```

This is transparent to callers - the API stays stateless.

### Optional: Truncate Support

If needed, add:
```typescript
function __jstorrent_file_truncate(rootKey: string, path: string, length: number): boolean
```

And corresponding FileManager method.

---

## Summary

| Phase | Changes | Risk |
|-------|---------|------|
| 1 | TypeScript: Stateless bindings | Low - internal refactor |
| 2 | Kotlin: FileBindings uses FileManager | Medium - new wiring |
| 3 | Extend FileManager interface | Low - additive |
| 4 | Dependency injection updates | Low - wiring only |
| 5 | Delete FileHandleManager | Low - cleanup |

**Total estimated effort:** 4-6 hours

**Main benefit:** Single file I/O implementation for both modes, same behavior, easier testing, path to SAF support in standalone mode.
