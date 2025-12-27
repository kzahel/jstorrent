# Phase 1: Add Async/Suspend Semantics to QuickJS Engine Layer

## Problem

All `QuickJsEngine` methods use `CountDownLatch.await()` to block the calling thread until JS execution completes. When called from the Main thread (which happens during torrent downloads when state updates trigger UI code that calls engine methods), this causes:

- UI freezes (spinner stops, touch unresponsive)
- ANR risk on slower devices
- Unusable experience during active downloads

## Solution

Add `suspend` function variants to `QuickJsEngine` and `EngineController` that use Kotlin coroutines instead of blocking latches. No JNI changes needed - the blocking is purely in the Kotlin layer.

## Scope

**This phase covers:**
- `QuickJsEngine` - add suspend variants of all blocking methods
- `EngineController` - add suspend variants of command/query methods

**Next phases will cover:**
- Phase 2: `EngineService` suspend API
- Phase 3: `TorrentRepository` interface + `EngineServiceRepository` 
- Phase 4: Activity call sites (`NativeStandaloneActivity`, `AddRootActivity`)

---

## File Changes

### 1. Add coroutines dependency (if not present)

**File:** `android/quickjs-engine/build.gradle.kts`

Check if kotlinx-coroutines-core is already in dependencies. If not, add:

```kotlin
dependencies {
    // ... existing deps
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.7.3")
}
```

### 2. Update QuickJsEngine.kt

**File:** `android/quickjs-engine/src/main/kotlin/com/jstorrent/quickjs/QuickJsEngine.kt`

Add import at top:
```kotlin
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
```

Add suspend variants for each blocking method. Pattern:

**Before (blocking):**
```kotlin
fun evaluate(script: String, filename: String = "script.js"): Any? {
    val result = AtomicReference<Any?>()
    val error = AtomicReference<Throwable?>()
    val latch = CountDownLatch(1)

    jsThread.post {
        try {
            result.set(context.evaluate(script, filename))
        } catch (e: Throwable) {
            error.set(e)
        } finally {
            latch.countDown()
        }
    }

    latch.await()
    error.get()?.let { throw it }
    return result.get()
}
```

**After (add suspend variant):**
```kotlin
/**
 * Evaluate JavaScript code on the JS thread (suspend version).
 * 
 * Suspends until evaluation completes. Safe to call from any thread including Main.
 */
suspend fun evaluateAsync(script: String, filename: String = "script.js"): Any? {
    return suspendCancellableCoroutine { cont ->
        jsThread.post {
            try {
                val result = context.evaluate(script, filename)
                cont.resume(result)
            } catch (e: Throwable) {
                cont.resumeWithException(e)
            }
        }
    }
}
```

**Methods to add suspend variants for:**

| Blocking Method | Suspend Variant |
|-----------------|-----------------|
| `evaluate()` | `evaluateAsync()` |
| `setGlobalFunction()` | `setGlobalFunctionAsync()` |
| `setGlobalFunctionWithBinary()` | `setGlobalFunctionWithBinaryAsync()` |
| `setGlobalFunctionReturnsBinary()` | `setGlobalFunctionReturnsBinaryAsync()` |
| `callGlobalFunction()` | `callGlobalFunctionAsync()` |
| `callGlobalFunctionWithBinary()` | `callGlobalFunctionWithBinaryAsync()` |
| `executeAllPendingJobs()` | `executeAllPendingJobsAsync()` |
| `postAndWait()` | `postAndWaitAsync()` |

**Full implementation for each:**

```kotlin
// =========================================================================
// Suspend (async) variants - safe to call from Main thread
// =========================================================================

/**
 * Evaluate JavaScript code on the JS thread (suspend version).
 */
suspend fun evaluateAsync(script: String, filename: String = "script.js"): Any? {
    return suspendCancellableCoroutine { cont ->
        jsThread.post {
            try {
                val result = context.evaluate(script, filename)
                cont.resume(result)
            } catch (e: Throwable) {
                cont.resumeWithException(e)
            }
        }
    }
}

/**
 * Register a global function (suspend version).
 */
suspend fun setGlobalFunctionAsync(name: String, callback: (Array<String>) -> String?) {
    return suspendCancellableCoroutine { cont ->
        jsThread.post {
            try {
                context.setGlobalFunction(name, callback)
                cont.resume(Unit)
            } catch (e: Throwable) {
                cont.resumeWithException(e)
            }
        }
    }
}

/**
 * Register a global function with binary data (suspend version).
 */
suspend fun setGlobalFunctionWithBinaryAsync(
    name: String,
    binaryArgIndex: Int,
    callback: (args: Array<String>, binary: ByteArray?) -> String?
) {
    return suspendCancellableCoroutine { cont ->
        jsThread.post {
            try {
                context.setGlobalFunctionWithBinary(name, binaryArgIndex, callback)
                cont.resume(Unit)
            } catch (e: Throwable) {
                cont.resumeWithException(e)
            }
        }
    }
}

/**
 * Register a global function that returns binary (suspend version).
 */
suspend fun setGlobalFunctionReturnsBinaryAsync(
    name: String,
    binaryArgIndex: Int = -1,
    callback: (args: Array<String>, binary: ByteArray?) -> ByteArray?
) {
    return suspendCancellableCoroutine { cont ->
        jsThread.post {
            try {
                context.setGlobalFunctionReturnsBinary(name, binaryArgIndex, callback)
                cont.resume(Unit)
            } catch (e: Throwable) {
                cont.resumeWithException(e)
            }
        }
    }
}

/**
 * Call a global JavaScript function (suspend version).
 */
suspend fun callGlobalFunctionAsync(funcName: String, vararg args: String?): Any? {
    return suspendCancellableCoroutine { cont ->
        jsThread.post {
            try {
                val result = context.callGlobalFunction(funcName, *args)
                cont.resume(result)
            } catch (e: Throwable) {
                cont.resumeWithException(e)
            }
        }
    }
}

/**
 * Call a global JavaScript function with binary data (suspend version).
 */
suspend fun callGlobalFunctionWithBinaryAsync(
    funcName: String,
    binaryArg: ByteArray,
    binaryArgIndex: Int,
    vararg args: String?
): Any? {
    return suspendCancellableCoroutine { cont ->
        jsThread.post {
            try {
                val result = context.callGlobalFunctionWithBinary(funcName, binaryArg, binaryArgIndex, *args)
                cont.resume(result)
            } catch (e: Throwable) {
                cont.resumeWithException(e)
            }
        }
    }
}

/**
 * Execute all pending jobs (suspend version).
 */
suspend fun executeAllPendingJobsAsync() {
    return suspendCancellableCoroutine { cont ->
        jsThread.post {
            try {
                context.executeAllPendingJobs()
                cont.resume(Unit)
            } catch (e: Throwable) {
                cont.resumeWithException(e)
            }
        }
    }
}

/**
 * Post work and wait for completion (suspend version).
 */
suspend fun postAndWaitAsync(block: () -> Unit) {
    return suspendCancellableCoroutine { cont ->
        jsThread.post {
            try {
                block()
                cont.resume(Unit)
            } catch (e: Throwable) {
                cont.resumeWithException(e)
            }
        }
    }
}
```

### 3. Update EngineController.kt

**File:** `android/quickjs-engine/src/main/kotlin/com/jstorrent/quickjs/EngineController.kt`

Add suspend variants of all command and query methods. These wrap the engine's suspend methods.

**Add after existing methods (or intersperse - your choice):**

```kotlin
// =========================================================================
// Async Command API - safe to call from Main thread
// =========================================================================

/**
 * Add a torrent (suspend version).
 */
suspend fun addTorrentAsync(magnetOrBase64: String) {
    checkLoaded()
    val escaped = magnetOrBase64.replace("\\", "\\\\").replace("'", "\\'")
    engine!!.callGlobalFunctionAsync("__jstorrent_cmd_add_torrent", escaped)
    Log.i(TAG, "addTorrentAsync called")
}

/**
 * Pause a torrent (suspend version).
 */
suspend fun pauseTorrentAsync(infoHash: String) {
    checkLoaded()
    engine!!.callGlobalFunctionAsync("__jstorrent_cmd_pause", infoHash)
    Log.i(TAG, "pauseTorrentAsync: $infoHash")
}

/**
 * Resume a torrent (suspend version).
 */
suspend fun resumeTorrentAsync(infoHash: String) {
    checkLoaded()
    engine!!.callGlobalFunctionAsync("__jstorrent_cmd_resume", infoHash)
    Log.i(TAG, "resumeTorrentAsync: $infoHash")
}

/**
 * Remove a torrent (suspend version).
 */
suspend fun removeTorrentAsync(infoHash: String, deleteFiles: Boolean = false) {
    checkLoaded()
    engine!!.callGlobalFunctionAsync(
        "__jstorrent_cmd_remove",
        infoHash,
        deleteFiles.toString()
    )
    Log.i(TAG, "removeTorrentAsync: $infoHash (deleteFiles=$deleteFiles)")
}

/**
 * Add test torrent (suspend version).
 */
suspend fun addTestTorrentAsync() {
    checkLoaded()
    engine!!.callGlobalFunctionAsync("__jstorrent_cmd_add_test_torrent")
    Log.i(TAG, "addTestTorrentAsync called")
}

// =========================================================================
// Async Root Management - safe to call from Main thread
// =========================================================================

/**
 * Add a storage root (suspend version).
 */
suspend fun addRootAsync(key: String, label: String, uri: String) {
    checkLoaded()
    engine!!.callGlobalFunctionAsync(
        "__jstorrent_cmd_add_root",
        key.escapeJs(),
        label.escapeJs(),
        uri.escapeJs()
    )
    Log.i(TAG, "Added root to engine (async): $key -> $label")
}

/**
 * Set default storage root (suspend version).
 */
suspend fun setDefaultRootAsync(key: String) {
    checkLoaded()
    engine!!.callGlobalFunctionAsync("__jstorrent_cmd_set_default_root", key.escapeJs())
    Log.i(TAG, "Set default root (async): $key")
}

/**
 * Remove a storage root (suspend version).
 */
suspend fun removeRootAsync(key: String) {
    checkLoaded()
    engine!!.callGlobalFunctionAsync("__jstorrent_cmd_remove_root", key.escapeJs())
    Log.i(TAG, "Removed root (async): $key")
}

// =========================================================================
// Async Query API - safe to call from Main thread
// =========================================================================

/**
 * Get torrent list (suspend version).
 */
suspend fun getTorrentListAsync(): List<TorrentInfo> {
    checkLoaded()
    val resultJson = engine!!.callGlobalFunctionAsync("__jstorrent_query_torrent_list") as? String
        ?: return emptyList()
    return try {
        json.decodeFromString<TorrentListResponse>(resultJson).torrents
    } catch (e: Exception) {
        Log.e(TAG, "Failed to parse torrent list", e)
        emptyList()
    }
}

/**
 * Get files for a torrent (suspend version).
 */
suspend fun getFilesAsync(infoHash: String): List<FileInfo> {
    checkLoaded()
    val resultJson = engine!!.callGlobalFunctionAsync("__jstorrent_query_files", infoHash) as? String
        ?: return emptyList()
    return try {
        json.decodeFromString<FileListResponse>(resultJson).files
    } catch (e: Exception) {
        Log.e(TAG, "Failed to parse file list", e)
        emptyList()
    }
}
```

---

## Verification

### 1. Build check

```bash
cd android
./gradlew :quickjs-engine:compileDebugKotlin
```

Should compile without errors.

### 2. Unit test (optional but recommended)

Create a simple test to verify suspend methods work:

**File:** `android/quickjs-engine/src/test/kotlin/com/jstorrent/quickjs/QuickJsEngineAsyncTest.kt`

```kotlin
package com.jstorrent.quickjs

import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals

class QuickJsEngineAsyncTest {

    private lateinit var engine: QuickJsEngine

    @Before
    fun setUp() {
        engine = QuickJsEngine()
    }

    @After
    fun tearDown() {
        engine.close()
    }

    @Test
    fun `evaluateAsync returns result`() = runBlocking {
        val result = engine.evaluateAsync("1 + 2")
        assertEquals(3, result)
    }

    @Test
    fun `callGlobalFunctionAsync works`() = runBlocking {
        engine.evaluateAsync("globalThis.add = (a, b) => Number(a) + Number(b)")
        val result = engine.callGlobalFunctionAsync("add", "5", "7")
        assertEquals(12, result)
    }
}
```

Run:
```bash
cd android
./gradlew :quickjs-engine:testDebugUnitTest
```

### 3. Full build

```bash
cd android
./gradlew assembleDebug
```

---

## What's NOT in This Phase

- **EngineService changes** - Phase 2
- **TorrentRepository interface changes** - Phase 3  
- **Activity call site updates** - Phase 4
- **Deprecating blocking methods** - Future (keep both for now)

---

## Phase Overview (High Level)

| Phase | Scope | Purpose |
|-------|-------|---------|
| **1 (this)** | QuickJsEngine + EngineController | Add suspend primitives |
| **2** | EngineService | Expose suspend API from service |
| **3** | TorrentRepository + EngineServiceRepository | Update repository interface, add internal scope |
| **4** | NativeStandaloneActivity, AddRootActivity | Fix all Main thread call sites |

After Phase 4, the app should be fully non-blocking on Main thread.

**Phase 2 preview:** Add `addTorrentAsync()`, `pauseTorrentAsync()`, etc. to `EngineService` that delegate to `controller?.addTorrentAsync()`.

**Phase 3 preview:** Either:
- Option A: Make `TorrentRepository` methods suspend, update all call sites
- Option B: Keep fire-and-forget interface, use internal `CoroutineScope` in repository

**Phase 4 preview:** Update `syncRootsWithEngine()` and other direct controller calls to use `lifecycleScope.launch(Dispatchers.IO) { ... }` with async methods.
