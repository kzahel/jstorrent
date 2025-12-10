# Android SAF Storage Implementation

## Overview

Implement Storage Access Framework (SAF) for the Android daemon to allow user-selected download folders on ChromeOS/Android. This replaces the current hardcoded private storage with a multi-root system matching the desktop architecture.

**Why:** Files downloaded to Android's private app storage are inaccessible to users via the ChromeOS Files app. SAF provides a future-proof, user-controlled storage solution.

**Architecture principle:** The daemon owns roots (stores URIs, generates keys), the extension sees only opaque keys, and the engine is unchanged.

---

## Terminology Reference

| Term | Desktop (Rust) | Android (Kotlin) | TypeScript |
|------|----------------|------------------|------------|
| Root identifier | `key` | `key` | `key` |
| Display label | `display_name` | `display_name` | `display_name` |
| File path param | `root_key` | `root_key` (currently `root`) | `rootKey` |
| Availability | `last_stat_ok` | `last_stat_ok` | `last_stat_ok` |

**Wire format:** All JSON uses snake_case to match Rust serialization.

---

## Phase 1: RootStore Foundation

**Goal:** Create the storage layer for managing SAF roots with unit tests.

**Files to create:**
- `app/src/main/java/com/jstorrent/app/storage/RootStore.kt`
- `app/src/main/java/com/jstorrent/app/storage/DownloadRoot.kt`
- `app/src/test/java/com/jstorrent/app/storage/RootStoreTest.kt`

### 1.1 Create DownloadRoot data class

Create `app/src/main/java/com/jstorrent/app/storage/DownloadRoot.kt`:

```kotlin
package com.jstorrent.app.storage

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * A user-selected download folder.
 * Mirrors the desktop DownloadRoot structure for API compatibility.
 */
@Serializable
data class DownloadRoot(
    /** Opaque key: sha256(salt + uri.toString()), first 16 hex chars */
    val key: String,
    
    /** SAF tree URI (e.g., content://com.android.externalstorage.documents/tree/...) */
    val uri: String,
    
    /** User-friendly label extracted from URI path */
    @SerialName("display_name")
    val displayName: String,
    
    /** Whether this is removable storage (SD card, USB) */
    val removable: Boolean = false,
    
    /** Last availability check result */
    @SerialName("last_stat_ok")
    val lastStatOk: Boolean = true,
    
    /** Timestamp of last availability check (epoch millis) */
    @SerialName("last_checked")
    val lastChecked: Long = System.currentTimeMillis()
)
```

### 1.2 Create RootStore class

Create `app/src/main/java/com/jstorrent/app/storage/RootStore.kt`:

```kotlin
package com.jstorrent.app.storage

import android.content.Context
import android.net.Uri
import androidx.documentfile.provider.DocumentFile
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File
import java.security.MessageDigest
import java.security.SecureRandom

/**
 * Persists SAF download roots to internal storage.
 * 
 * Storage format: JSON file at /data/data/com.jstorrent.app/files/roots.json
 * 
 * Thread safety: All public methods are synchronized. For UI responsiveness,
 * call from a background thread.
 */
class RootStore(private val context: Context) {
    
    @Serializable
    private data class RootConfig(
        val salt: String,
        val roots: List<DownloadRoot>
    )
    
    private val configFile: File
        get() = File(context.filesDir, CONFIG_FILE_NAME)
    
    private val json = Json { 
        prettyPrint = true
        ignoreUnknownKeys = true
    }
    
    private var config: RootConfig
    
    init {
        config = loadOrCreate()
    }
    
    /**
     * Get all configured roots.
     */
    @Synchronized
    fun listRoots(): List<DownloadRoot> = config.roots.toList()
    
    /**
     * Add a new root from a SAF tree URI.
     * Returns the new root, or existing root if URI already registered.
     */
    @Synchronized
    fun addRoot(treeUri: Uri): DownloadRoot {
        // Check if already exists
        val existing = config.roots.find { it.uri == treeUri.toString() }
        if (existing != null) {
            return existing
        }
        
        val key = generateKey(treeUri)
        val label = extractLabel(treeUri)
        val removable = isRemovableStorage(treeUri)
        
        val root = DownloadRoot(
            key = key,
            uri = treeUri.toString(),
            displayName = label,
            removable = removable,
            lastStatOk = true,
            lastChecked = System.currentTimeMillis()
        )
        
        config = config.copy(roots = config.roots + root)
        save()
        
        return root
    }
    
    /**
     * Remove a root by key.
     * Returns true if root was found and removed.
     */
    @Synchronized
    fun removeRoot(key: String): Boolean {
        val newRoots = config.roots.filter { it.key != key }
        if (newRoots.size == config.roots.size) {
            return false
        }
        config = config.copy(roots = newRoots)
        save()
        return true
    }
    
    /**
     * Resolve a root key to its SAF URI.
     * Returns null if key not found.
     */
    @Synchronized
    fun resolveKey(key: String): Uri? {
        val root = config.roots.find { it.key == key }
        return root?.let { Uri.parse(it.uri) }
    }
    
    /**
     * Check availability of all roots and update lastStatOk.
     * Call periodically or before returning roots to extension.
     */
    @Synchronized
    fun refreshAvailability(): List<DownloadRoot> {
        val updated = config.roots.map { root ->
            val available = checkAvailability(Uri.parse(root.uri))
            root.copy(
                lastStatOk = available,
                lastChecked = System.currentTimeMillis()
            )
        }
        config = config.copy(roots = updated)
        save()
        return updated
    }
    
    /**
     * Get a root by key with current availability.
     */
    @Synchronized
    fun getRoot(key: String): DownloadRoot? {
        return config.roots.find { it.key == key }
    }
    
    // =========================================================================
    // Internal helpers
    // =========================================================================
    
    private fun loadOrCreate(): RootConfig {
        if (!configFile.exists()) {
            return RootConfig(
                salt = generateSalt(),
                roots = emptyList()
            )
        }
        
        return try {
            json.decodeFromString<RootConfig>(configFile.readText())
        } catch (e: Exception) {
            // Corrupted file, start fresh but log warning
            android.util.Log.w(TAG, "Failed to load roots config, starting fresh", e)
            RootConfig(salt = generateSalt(), roots = emptyList())
        }
    }
    
    private fun save() {
        configFile.writeText(json.encodeToString(config))
    }
    
    private fun generateSalt(): String {
        val bytes = ByteArray(16)
        SecureRandom().nextBytes(bytes)
        return bytes.joinToString("") { "%02x".format(it) }
    }
    
    private fun generateKey(uri: Uri): String {
        val input = config.salt + uri.toString()
        val digest = MessageDigest.getInstance("SHA-256")
        val hash = digest.digest(input.toByteArray())
        // Return first 16 hex chars (64 bits) - enough for uniqueness
        return hash.take(8).joinToString("") { "%02x".format(it) }
    }
    
    /**
     * Extract a human-readable label from SAF URI.
     * Example: content://...documents/tree/primary%3ADownload%2FJSTorrent
     *       → "Download/JSTorrent"
     */
    private fun extractLabel(uri: Uri): String {
        // Try to get display name from DocumentFile
        try {
            val docFile = DocumentFile.fromTreeUri(context, uri)
            docFile?.name?.let { return it }
        } catch (_: Exception) {}
        
        // Fallback: parse from URI path
        val path = uri.lastPathSegment ?: return "Downloads"
        
        // URI-decode and extract path after the colon
        // e.g., "primary:Download/JSTorrent" → "Download/JSTorrent"
        val decoded = Uri.decode(path)
        val colonIndex = decoded.indexOf(':')
        return if (colonIndex >= 0) {
            decoded.substring(colonIndex + 1)
        } else {
            decoded
        }
    }
    
    /**
     * Check if URI points to removable storage.
     */
    private fun isRemovableStorage(uri: Uri): Boolean {
        val path = uri.toString()
        // Primary storage is not removable
        if (path.contains("primary")) return false
        // SD cards and USB drives have different volume IDs
        return path.contains("/tree/") && !path.contains("primary")
    }
    
    /**
     * Check if a root is currently accessible.
     */
    private fun checkAvailability(uri: Uri): Boolean {
        return try {
            val docFile = DocumentFile.fromTreeUri(context, uri)
            docFile?.exists() == true && docFile.canWrite()
        } catch (_: Exception) {
            false
        }
    }
    
    companion object {
        private const val TAG = "RootStore"
        private const val CONFIG_FILE_NAME = "roots.json"
    }
}
```

### 1.3 Create unit tests

Create `app/src/test/java/com/jstorrent/app/storage/RootStoreTest.kt`:

```kotlin
package com.jstorrent.app.storage

import org.junit.Assert.*
import org.junit.Test
import java.security.MessageDigest

/**
 * Unit tests for RootStore logic.
 * Tests pure functions without Android dependencies.
 */
class RootStoreTest {
    
    @Test
    fun `key generation is deterministic`() {
        val salt = "abc123"
        val uri = "content://com.android.externalstorage.documents/tree/primary%3ADownload"
        
        val key1 = generateTestKey(salt, uri)
        val key2 = generateTestKey(salt, uri)
        
        assertEquals(key1, key2)
    }
    
    @Test
    fun `key generation produces different keys for different URIs`() {
        val salt = "abc123"
        val uri1 = "content://documents/tree/primary%3ADownload"
        val uri2 = "content://documents/tree/primary%3AMovies"
        
        val key1 = generateTestKey(salt, uri1)
        val key2 = generateTestKey(salt, uri2)
        
        assertNotEquals(key1, key2)
    }
    
    @Test
    fun `key generation produces different keys for different salts`() {
        val uri = "content://documents/tree/primary%3ADownload"
        
        val key1 = generateTestKey("salt1", uri)
        val key2 = generateTestKey("salt2", uri)
        
        assertNotEquals(key1, key2)
    }
    
    @Test
    fun `key is 16 hex characters`() {
        val key = generateTestKey("salt", "content://test")
        
        assertEquals(16, key.length)
        assertTrue(key.all { it in '0'..'9' || it in 'a'..'f' })
    }
    
    @Test
    fun `label extraction from primary storage URI`() {
        val uri = "content://com.android.externalstorage.documents/tree/primary%3ADownload%2FJSTorrent"
        val label = extractTestLabel(uri)
        
        assertEquals("Download/JSTorrent", label)
    }
    
    @Test
    fun `label extraction from simple path`() {
        val uri = "content://documents/tree/primary%3AMovies"
        val label = extractTestLabel(uri)
        
        assertEquals("Movies", label)
    }
    
    @Test
    fun `removable storage detection - primary is not removable`() {
        val uri = "content://documents/tree/primary%3ADownload"
        assertFalse(isTestRemovable(uri))
    }
    
    @Test
    fun `removable storage detection - SD card is removable`() {
        val uri = "content://documents/tree/17FC-2B04%3ATorrents"
        assertTrue(isTestRemovable(uri))
    }
    
    @Test
    fun `DownloadRoot JSON serialization uses snake_case`() {
        val root = DownloadRoot(
            key = "abc123",
            uri = "content://test",
            displayName = "Test",
            removable = false,
            lastStatOk = true,
            lastChecked = 1234567890
        )
        
        val json = kotlinx.serialization.json.Json.encodeToString(
            DownloadRoot.serializer(), 
            root
        )
        
        assertTrue(json.contains("\"display_name\""))
        assertTrue(json.contains("\"last_stat_ok\""))
        assertTrue(json.contains("\"last_checked\""))
        assertFalse(json.contains("displayName"))
        assertFalse(json.contains("lastStatOk"))
    }
    
    @Test
    fun `local provider detection - externalstorage is allowed`() {
        val uri = "content://com.android.externalstorage.documents/tree/primary%3ADownload"
        assertTrue(isAllowedProvider(uri))
    }
    
    @Test
    fun `local provider detection - downloads is allowed`() {
        val uri = "content://com.android.providers.downloads.documents/tree/downloads"
        assertTrue(isAllowedProvider(uri))
    }
    
    @Test
    fun `local provider detection - google drive is rejected`() {
        val uri = "content://com.google.android.apps.docs.storage/tree/abc123"
        assertFalse(isAllowedProvider(uri))
    }
    
    @Test
    fun `local provider detection - dropbox is rejected`() {
        val uri = "content://com.dropbox.android.document/tree/abc123"
        assertFalse(isAllowedProvider(uri))
    }
    
    @Test
    fun `local provider detection - onedrive is rejected`() {
        val uri = "content://com.microsoft.skydrive.content.StorageAccessProvider/tree/abc123"
        assertFalse(isAllowedProvider(uri))
    }
    
    // =========================================================================
    // Test helpers - mirrors RootStore private methods
    // =========================================================================
    
    private fun generateTestKey(salt: String, uri: String): String {
        val input = salt + uri
        val digest = MessageDigest.getInstance("SHA-256")
        val hash = digest.digest(input.toByteArray())
        return hash.take(8).joinToString("") { "%02x".format(it) }
    }
    
    private fun extractTestLabel(uriString: String): String {
        val path = android.net.Uri.parse(uriString).lastPathSegment ?: return "Downloads"
        val decoded = android.net.Uri.decode(path)
        val colonIndex = decoded.indexOf(':')
        return if (colonIndex >= 0) {
            decoded.substring(colonIndex + 1)
        } else {
            decoded
        }
    }
    
    private fun isTestRemovable(uriString: String): Boolean {
        if (uriString.contains("primary")) return false
        return uriString.contains("/tree/") && !uriString.contains("primary")
    }
    
    private val ALLOWED_PROVIDERS = setOf(
        "com.android.externalstorage.documents",
        "com.android.providers.downloads.documents",
    )
    
    private fun isAllowedProvider(uriString: String): Boolean {
        val authority = android.net.Uri.parse(uriString).authority ?: return false
        return authority in ALLOWED_PROVIDERS
    }
}
```

### 1.4 Add kotlinx.serialization dependency

Update `app/build.gradle.kts` - add to plugins block:

```kotlin
plugins {
    // ... existing plugins
    id("org.jetbrains.kotlin.plugin.serialization") version "1.9.22"
}
```

Add to dependencies block:

```kotlin
dependencies {
    // ... existing deps
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.2")
}
```

### Phase 1 Verification

```bash
cd android-io-daemon
./gradlew test --tests "com.jstorrent.app.storage.*"
```

**Expected:** All unit tests pass.

**Note:** The `extractTestLabel` and `isTestRemovable` tests that use `android.net.Uri` will need to run as instrumented tests or use Robolectric. For pure unit tests, either:
1. Move those tests to `androidTest/`
2. Add Robolectric dependency
3. Extract parsing logic to a pure function that takes String

---

## Phase 2: API Endpoints

**Goal:** Wire RootStore into the HTTP server and add `/roots` endpoint.

### 2.1 Update HttpServer to accept RootStore

Update `app/src/main/java/com/jstorrent/app/server/HttpServer.kt`:

Find the class declaration and constructor:

```kotlin
class HttpServer(
    private val tokenStore: TokenStore,
    private val downloadRoot: File
) {
```

Replace with:

```kotlin
class HttpServer(
    private val tokenStore: TokenStore,
    private val rootStore: RootStore,
    private val context: Context
) {
```

Add import at top:

```kotlin
import android.content.Context
import com.jstorrent.app.storage.RootStore
import com.jstorrent.app.storage.DownloadRoot
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
```

### 2.2 Add /roots endpoint

In `HttpServer.kt`, inside `configureRouting()`, add after the `/status` endpoint:

```kotlin
// Roots endpoint - returns available download roots
get("/roots") {
    requireAuth(tokenStore) {
        val roots = rootStore.refreshAvailability()
        val response = RootsResponse(roots = roots)
        call.respondText(
            Json.encodeToString(response),
            ContentType.Application.Json
        )
    }
}
```

Add the response class inside HttpServer.kt (or in a separate file):

```kotlin
@Serializable
private data class RootsResponse(
    val roots: List<DownloadRoot>
)
```

### 2.3 Update FileHandler to use RootStore

Replace the entire `app/src/main/java/com/jstorrent/app/server/FileHandler.kt`:

```kotlin
package com.jstorrent.app.server

import android.content.Context
import android.net.Uri
import android.util.Base64
import android.util.Log
import androidx.documentfile.provider.DocumentFile
import com.jstorrent.app.storage.RootStore
import io.ktor.http.*
import io.ktor.server.application.*
import io.ktor.server.request.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import java.io.FileInputStream
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.security.MessageDigest

private const val TAG = "FileHandler"
private const val MAX_BODY_SIZE = 64 * 1024 * 1024 // 64MB

fun Route.fileRoutes(rootStore: RootStore, context: Context) {

    get("/read/{root_key}") {
        val rootKey = call.parameters["root_key"]
            ?: return@get call.respond(HttpStatusCode.BadRequest, "Missing root_key")
        
        val pathBase64 = call.request.header("X-Path-Base64")
            ?: return@get call.respond(HttpStatusCode.BadRequest, "Missing X-Path-Base64 header")

        val relativePath = try {
            String(Base64.decode(pathBase64, Base64.DEFAULT))
        } catch (e: Exception) {
            return@get call.respond(HttpStatusCode.BadRequest, "Invalid base64 in X-Path-Base64")
        }

        val offset = call.request.header("X-Offset")?.toLongOrNull() ?: 0L
        val length = call.request.header("X-Length")?.toLongOrNull()
            ?: return@get call.respond(HttpStatusCode.BadRequest, "Missing X-Length header")

        // Validate path (prevent directory traversal)
        if (relativePath.contains("..")) {
            return@get call.respond(HttpStatusCode.BadRequest, "Invalid path")
        }

        // Resolve root key to SAF URI
        val rootUri = rootStore.resolveKey(rootKey)
            ?: return@get call.respond(HttpStatusCode.Forbidden, "Invalid root key")

        try {
            val file = resolveFile(context, rootUri, relativePath)
                ?: return@get call.respond(HttpStatusCode.NotFound, "File not found")

            // Use ParcelFileDescriptor for random access reads
            context.contentResolver.openFileDescriptor(file.uri, "r")?.use { pfd ->
                val channel = FileInputStream(pfd.fileDescriptor).channel
                channel.position(offset)
                
                val buffer = ByteBuffer.allocate(length.toInt())
                var totalRead = 0
                while (buffer.hasRemaining()) {
                    val read = channel.read(buffer)
                    if (read == -1) break
                    totalRead += read
                }
                
                if (totalRead < length) {
                    return@get call.respond(
                        HttpStatusCode.InternalServerError,
                        "Could not read requested bytes (got $totalRead, wanted $length)"
                    )
                }
                
                buffer.flip()
                val bytes = ByteArray(buffer.remaining())
                buffer.get(bytes)
                call.respondBytes(bytes, ContentType.Application.OctetStream)
            } ?: return@get call.respond(HttpStatusCode.InternalServerError, "Cannot open file")
        } catch (e: Exception) {
            Log.e(TAG, "Error reading file: ${e.message}", e)
            call.respond(HttpStatusCode.InternalServerError, e.message ?: "Read error")
        }
    }

    post("/write/{root_key}") {
        val rootKey = call.parameters["root_key"]
            ?: return@post call.respond(HttpStatusCode.BadRequest, "Missing root_key")
        
        val pathBase64 = call.request.header("X-Path-Base64")
            ?: return@post call.respond(HttpStatusCode.BadRequest, "Missing X-Path-Base64 header")

        val relativePath = try {
            String(Base64.decode(pathBase64, Base64.DEFAULT))
        } catch (e: Exception) {
            return@post call.respond(HttpStatusCode.BadRequest, "Invalid base64 in X-Path-Base64")
        }

        val offset = call.request.header("X-Offset")?.toLongOrNull() ?: 0L
        val expectedSha1 = call.request.header("X-Expected-SHA1")

        // Validate path
        if (relativePath.contains("..")) {
            return@post call.respond(HttpStatusCode.BadRequest, "Invalid path")
        }

        // Resolve root key to SAF URI
        val rootUri = rootStore.resolveKey(rootKey)
            ?: return@post call.respond(HttpStatusCode.Forbidden, "Invalid root key")

        val body = call.receive<ByteArray>()

        if (body.size > MAX_BODY_SIZE) {
            return@post call.respond(HttpStatusCode.PayloadTooLarge, "Body too large")
        }

        try {
            // Get or create file (creates parent directories as needed)
            val file = getOrCreateFile(context, rootUri, relativePath)
                ?: return@post call.respond(
                    HttpStatusCode.InternalServerError, 
                    "Cannot create file"
                )

            // Use ParcelFileDescriptor for true random access writes
            // This is O(write_size), not O(file_size) like the stream approach
            context.contentResolver.openFileDescriptor(file.uri, "rw")?.use { pfd ->
                val channel = FileOutputStream(pfd.fileDescriptor).channel
                channel.position(offset)
                channel.write(ByteBuffer.wrap(body))
            } ?: return@post call.respond(
                HttpStatusCode.InternalServerError, 
                "Cannot open file for writing"
            )

            // Optional hash verification (verifies what we wrote)
            if (expectedSha1 != null) {
                val digest = MessageDigest.getInstance("SHA-1")
                val actualHash = digest.digest(body).joinToString("") { "%02x".format(it) }
                if (!actualHash.equals(expectedSha1, ignoreCase = true)) {
                    return@post call.respond(
                        HttpStatusCode.Conflict,
                        "Hash mismatch: expected $expectedSha1, got $actualHash"
                    )
                }
            }

            call.respond(HttpStatusCode.OK)
        } catch (e: Exception) {
            Log.e(TAG, "Error writing file: ${e.message}", e)
            when {
                e.message?.contains("ENOSPC") == true ||
                e.message?.contains("No space") == true -> {
                    call.respond(HttpStatusCode.InsufficientStorage, "Disk full")
                }
                else -> {
                    call.respond(HttpStatusCode.InternalServerError, e.message ?: "Write error")
                }
            }
        }
    }
}

/**
 * Resolve a relative path under a SAF tree URI to a DocumentFile.
 * Returns null if file doesn't exist.
 */
private fun resolveFile(context: Context, rootUri: Uri, relativePath: String): DocumentFile? {
    var current = DocumentFile.fromTreeUri(context, rootUri) ?: return null
    
    val segments = relativePath.trimStart('/').split('/')
    for (segment in segments) {
        current = current.findFile(segment) ?: return null
    }
    
    return if (current.isFile) current else null
}

/**
 * Get or create a file at the given path under a SAF tree.
 * Creates parent directories as needed.
 */
private fun getOrCreateFile(context: Context, rootUri: Uri, relativePath: String): DocumentFile? {
    var current = DocumentFile.fromTreeUri(context, rootUri) ?: return null
    
    val segments = relativePath.trimStart('/').split('/')
    val fileName = segments.lastOrNull() ?: return null
    val dirSegments = segments.dropLast(1)
    
    // Create/navigate directories
    for (segment in dirSegments) {
        val existing = current.findFile(segment)
        current = if (existing != null && existing.isDirectory) {
            existing
        } else {
            current.createDirectory(segment) ?: return null
        }
    }
    
    // Get or create file
    val existingFile = current.findFile(fileName)
    return if (existingFile != null && existingFile.isFile) {
        existingFile
    } else {
        // Guess MIME type from extension
        val mimeType = when {
            fileName.endsWith(".mp4") -> "video/mp4"
            fileName.endsWith(".mkv") -> "video/x-matroska"
            fileName.endsWith(".avi") -> "video/x-msvideo"
            fileName.endsWith(".mp3") -> "audio/mpeg"
            fileName.endsWith(".flac") -> "audio/flac"
            fileName.endsWith(".zip") -> "application/zip"
            fileName.endsWith(".rar") -> "application/x-rar-compressed"
            else -> "application/octet-stream"
        }
        current.createFile(mimeType, fileName)
    }
}
```

### 2.4 Update IoDaemonService

Update `app/src/main/java/com/jstorrent/app/service/IoDaemonService.kt`:

Add import:

```kotlin
import com.jstorrent.app.storage.RootStore
```

Add field:

```kotlin
private lateinit var rootStore: RootStore
```

In `onCreate()`, add after tokenStore init:

```kotlin
rootStore = RootStore(this)
```

Update `startServer()` to pass rootStore:

```kotlin
private fun startServer() {
    if (httpServer?.isRunning == true) {
        Log.w(TAG, "Server already running")
        return
    }

    httpServer = HttpServer(tokenStore, rootStore, this)

    try {
        httpServer?.start()
        Log.i(TAG, "HTTP server started on port ${httpServer?.port}")
    } catch (e: Exception) {
        Log.e(TAG, "Failed to start server", e)
    }
}
```

Remove the `getDownloadRoot()` method (no longer needed).

### 2.5 Update HttpServer routing

In `HttpServer.kt`, update the file routes call in `configureRouting()`:

Find:
```kotlin
fileRoutes(downloadRoot)
```

Replace with:
```kotlin
fileRoutes(rootStore, context)
```

### Phase 2 Verification

1. Build the app:
   ```bash
   ./gradlew assembleDebug
   ```

2. Install and launch on device/emulator:
   ```bash
   adb install app/build/outputs/apk/debug/app-debug.apk
   ```

3. Test `/roots` endpoint (should return empty array initially):
   ```bash
   # From adb shell or device
   curl -H "X-JST-Auth: <token>" http://localhost:7800/roots
   ```
   
   Expected response:
   ```json
   {"roots":[]}
   ```

4. Test `/read` and `/write` return 403 for invalid root_key:
   ```bash
   curl -H "X-JST-Auth: <token>" \
        -H "X-Path-Base64: dGVzdC50eHQ=" \
        -H "X-Length: 10" \
        http://localhost:7800/read/invalid_key
   ```
   
   Expected: 403 Forbidden "Invalid root key"

---

## Phase 3: AddRootActivity

**Goal:** Create the SAF picker activity triggered by intent.

### 3.1 Create AddRootActivity

Create `app/src/main/java/com/jstorrent/app/AddRootActivity.kt`:

```kotlin
package com.jstorrent.app

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.Log
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import com.jstorrent.app.storage.RootStore

/**
 * Translucent activity that immediately launches SAF folder picker.
 * Triggered via intent: jstorrent://add-root
 * 
 * Flow:
 * 1. Extension opens jstorrent://add-root intent
 * 2. This activity launches, immediately opens SAF picker
 * 3. User picks folder
 * 4. We validate it's local storage (not cloud)
 * 5. We persist permission, add to RootStore, finish
 * 6. Extension polls /roots until new root appears
 */
class AddRootActivity : AppCompatActivity() {
    
    private lateinit var rootStore: RootStore
    
    private val pickFolder = registerForActivityResult(
        ActivityResultContracts.OpenDocumentTree()
    ) { uri: Uri? ->
        if (uri != null) {
            handleFolderSelected(uri)
        } else {
            Log.i(TAG, "Folder picker cancelled")
        }
        finish()
    }
    
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        rootStore = RootStore(this)
        
        // Launch picker immediately
        pickFolder.launch(null)
    }
    
    private fun handleFolderSelected(uri: Uri) {
        Log.i(TAG, "Folder selected: $uri")
        
        // Validate this is local storage, not a cloud provider
        // Cloud providers don't support random access writes which we require
        if (!isLocalStorageProvider(uri)) {
            Log.w(TAG, "Rejected non-local provider: ${uri.authority}")
            Toast.makeText(
                this,
                "Cloud storage is not supported. Please select a local folder.",
                Toast.LENGTH_LONG
            ).show()
            return
        }
        
        // Take persistable permission
        val flags = Intent.FLAG_GRANT_READ_URI_PERMISSION or 
                    Intent.FLAG_GRANT_WRITE_URI_PERMISSION
        
        try {
            contentResolver.takePersistableUriPermission(uri, flags)
            Log.i(TAG, "Persisted URI permission")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to persist permission", e)
            Toast.makeText(this, "Failed to get folder permission", Toast.LENGTH_SHORT).show()
            return
        }
        
        // Add to RootStore
        val root = rootStore.addRoot(uri)
        Log.i(TAG, "Added root: key=${root.key}, label=${root.displayName}")
    }
    
    /**
     * Check if the URI is from a local storage provider that supports random access.
     * 
     * We explicitly allow:
     * - com.android.externalstorage.documents (internal + SD card + USB)
     * - com.android.providers.downloads.documents (Downloads folder)
     * 
     * We reject cloud providers like:
     * - com.google.android.apps.docs.storage (Google Drive)
     * - com.dropbox.android.document (Dropbox)
     * - com.microsoft.skydrive.content.StorageAccessProvider (OneDrive)
     * - com.box.android.documents (Box)
     * 
     * Random access (seek + write) doesn't work reliably on cloud-backed SAF providers.
     */
    private fun isLocalStorageProvider(uri: Uri): Boolean {
        val authority = uri.authority ?: return false
        
        return authority in ALLOWED_PROVIDERS
    }
    
    companion object {
        private const val TAG = "AddRootActivity"
        
        private val ALLOWED_PROVIDERS = setOf(
            "com.android.externalstorage.documents",  // Internal storage, SD cards, USB drives
            "com.android.providers.downloads.documents",  // Downloads folder
            // Note: MTP devices show up under externalstorage.documents
        )
    }
}
```

### 3.2 Create transparent theme

Add to `app/src/main/res/values/themes.xml`:

```xml
<style name="Theme.JSTorrent.Transparent" parent="Theme.JSTorrent">
    <item name="android:windowIsTranslucent">true</item>
    <item name="android:windowBackground">@android:color/transparent</item>
    <item name="android:windowNoTitle">true</item>
    <item name="android:backgroundDimEnabled">false</item>
</style>
```

### 3.3 Update AndroidManifest.xml

Add the activity inside the `<application>` tag:

```xml
<!-- SAF folder picker activity -->
<activity
    android:name=".AddRootActivity"
    android:exported="true"
    android:theme="@style/Theme.JSTorrent.Transparent"
    android:excludeFromRecents="true"
    android:noHistory="true">
    <intent-filter>
        <action android:name="android.intent.action.VIEW" />
        <category android:name="android.intent.category.DEFAULT" />
        <category android:name="android.intent.category.BROWSABLE" />
        <data android:scheme="jstorrent" android:host="add-root" />
    </intent-filter>
</activity>
```

### Phase 3 Verification (Manual)

1. Build and install:
   ```bash
   ./gradlew installDebug
   ```

2. Trigger the picker via adb:
   ```bash
   adb shell am start -a android.intent.action.VIEW -d "jstorrent://add-root"
   ```

3. **Expected behavior:**
   - Files app (SAF picker) appears immediately
   - Select a folder (e.g., Downloads/JSTorrent)
   - Picker closes
   - App returns to previous state

4. **Test cloud rejection:**
   - Trigger picker again
   - Navigate to Google Drive (if available)
   - Select a folder
   - **Expected:** Toast appears: "Cloud storage is not supported. Please select a local folder."
   - Root is NOT added

5. Verify root was added:
   ```bash
   curl -H "X-JST-Auth: <token>" http://localhost:7800/roots
   ```
   
   Expected: JSON with one root containing the selected folder

6. Test file operations with the new root:
   ```bash
   # Write a test file
   echo -n "hello" | base64  # → aGVsbG8=
   
   curl -X POST \
        -H "X-JST-Auth: <token>" \
        -H "X-Path-Base64: dGVzdC50eHQ=" \
        -H "Content-Type: application/octet-stream" \
        --data-binary "hello" \
        "http://localhost:7800/write/<root_key>"
   
   # Read it back
   curl -H "X-JST-Auth: <token>" \
        -H "X-Path-Base64: dGVzdC50eHQ=" \
        -H "X-Length: 5" \
        "http://localhost:7800/read/<root_key>"
   ```

7. **Test random access write (critical):**
   ```bash
   # Create a 1MB file
   dd if=/dev/zero bs=1M count=1 | base64 > /tmp/1mb.b64
   
   # Write at offset 0
   curl -X POST \
        -H "X-JST-Auth: <token>" \
        -H "X-Path-Base64: $(echo -n 'test-random.bin' | base64)" \
        -H "Content-Type: application/octet-stream" \
        --data-binary @/tmp/1mb.b64 \
        "http://localhost:7800/write/<root_key>"
   
   # Write 4 bytes at offset 512KB (this must NOT read the whole file)
   curl -X POST \
        -H "X-JST-Auth: <token>" \
        -H "X-Path-Base64: $(echo -n 'test-random.bin' | base64)" \
        -H "X-Offset: 524288" \
        -H "Content-Type: application/octet-stream" \
        --data-binary "test" \
        "http://localhost:7800/write/<root_key>"
   
   # Verify the write was fast (should be <100ms, not seconds)
   ```

---

## Phase 4: Extension Integration

**Goal:** Update chromeos-adapter to fetch roots dynamically and trigger picker.

### 4.1 Update chromeos-adapter.ts fetchRoots()

In `extension/src/lib/io-bridge/adapters/chromeos-adapter.ts`, replace the `fetchRoots()` method:

```typescript
private async fetchRoots(): Promise<DownloadRoot[]> {
  if (!this.currentPort || !this.token) {
    return []
  }
  
  try {
    const response = await fetch(
      `http://${this.config.host}:${this.currentPort}/roots`,
      {
        headers: {
          'X-JST-Auth': this.token,
        },
      }
    )
    
    if (!response.ok) {
      console.warn('[ChromeOSAdapter] Failed to fetch roots:', response.status)
      return []
    }
    
    const data = await response.json() as { roots: DownloadRoot[] }
    return data.roots
  } catch (error) {
    console.error('[ChromeOSAdapter] Error fetching roots:', error)
    return []
  }
}
```

### 4.2 Add triggerAddRoot method

Add to `ChromeOSAdapter` class:

```typescript
/**
 * Trigger the Android SAF folder picker.
 * Returns true if intent was opened successfully.
 */
async triggerAddRoot(): Promise<boolean> {
  try {
    const intentUrl = 'intent://add-root#Intent;scheme=jstorrent;package=com.jstorrent.app;end'
    
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab?.id) {
      await chrome.tabs.update(tab.id, { url: intentUrl })
    } else {
      await chrome.tabs.create({ url: intentUrl })
    }
    
    console.log('[ChromeOSAdapter] Triggered add-root intent')
    return true
  } catch (error) {
    console.error('[ChromeOSAdapter] Failed to trigger add-root:', error)
    return false
  }
}

/**
 * Poll for roots until a new one appears or timeout.
 * Used after triggerAddRoot() to detect when user completes picker.
 */
async waitForNewRoot(
  existingKeys: Set<string>,
  timeoutMs: number = 30000
): Promise<DownloadRoot | null> {
  const startTime = Date.now()
  
  while (Date.now() - startTime < timeoutMs) {
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    const roots = await this.fetchRoots()
    const newRoot = roots.find(r => !existingKeys.has(r.key))
    
    if (newRoot) {
      return newRoot
    }
  }
  
  return null
}
```

### 4.3 Add to IIOBridgeAdapter interface

Update `extension/src/lib/io-bridge/io-bridge-adapter.ts`:

```typescript
export interface IIOBridgeAdapter {
  // ... existing methods
  
  /** Trigger folder picker on Android (ChromeOS only) */
  triggerAddRoot?(): Promise<boolean>
  
  /** Wait for a new root to appear after picker (ChromeOS only) */
  waitForNewRoot?(existingKeys: Set<string>, timeoutMs?: number): Promise<DownloadRoot | null>
}
```

### Phase 4 Verification (Manual on ChromeOS)

1. Build extension:
   ```bash
   cd extension && pnpm build
   ```

2. Load extension in Chrome on ChromeOS

3. Build and install Android app on ChromeOS:
   ```bash
   cd android-io-daemon && ./gradlew installDebug
   ```

4. Open extension, verify it shows "No download folder"

5. Click "Add folder" (or however UI triggers it)
   - Files app picker should appear
   - Select a folder
   - Picker closes

6. Extension should show the new root after polling completes

7. Add a test torrent and verify it downloads to the selected folder

8. **Test USB drive scenario:**
   - Insert USB drive
   - Add it as a root
   - Verify downloads work
   - Unplug USB
   - Verify `/roots` shows `last_stat_ok: false`
   - Replug USB
   - Verify root becomes available again

---

## Summary

| Phase | Unit Tests | Instrumented | Manual |
|-------|------------|--------------|--------|
| 1. RootStore | ✅ Key gen, JSON format, provider validation | - | - |
| 2. API Endpoints | - | - | curl /roots, /read, /write |
| 3. AddRootActivity | - | - | ✅ SAF picker flow, cloud rejection |
| 4. Extension | - | - | ✅ E2E on ChromeOS |

## Known Limitations

1. **Local storage only:** Cloud storage providers (Google Drive, Dropbox, OneDrive, etc.) are 
   not supported. They don't reliably support random access writes, which torrents require. 
   The folder picker rejects cloud-backed folders with a user-friendly message.

2. **Android 11+ folder restrictions:** Cannot pick the root of internal storage, root of SD 
   card, or the Downloads directory itself. Users must create or select a subfolder 
   (e.g., "Downloads/Torrents").

3. **Permission limits:** Android limits persisted URI permissions to ~128-512 depending on 
   version. Unlikely to hit in practice (that's 128+ download folders).

4. **DocumentFile overhead:** `DocumentFile.findFile()` is O(n) per path segment. For deeply 
   nested paths, consider caching the DocumentFile tree or using 
   `DocumentsContract.findDocumentPath()` on API 26+. Not a concern for typical torrent 
   directory structures (1-3 levels deep).

## Future Enhancements

- Root removal API and UI
- Default root selection and persistence
- Free space reporting in `/roots` response
- Background root availability monitoring
