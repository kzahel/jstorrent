# Companion Mode E2E Test Plan

**Goal:** Establish comprehensive test coverage for companion mode (ChromeOS) before making any standalone mode changes.

**Context:** Companion mode runs `IoDaemonService` which provides HTTP/WebSocket endpoints for the Chrome extension. This is completely separate from `EngineService` (standalone mode).

---

## Current State

| Component | Tests |
|-----------|-------|
| IoDaemonService | ❌ None |
| CompanionHttpServer | ❌ None |
| IoWebSocketHandler | ❌ None |
| ControlWebSocketHandler | ❌ None |
| Pairing flow | ❌ None |
| File I/O | ❌ None |

---

## Test Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Instrumented Test                           │
├─────────────────────────────────────────────────────────────────┤
│  1. Start IoDaemonService                                       │
│  2. Create OkHttp client                                        │
│  3. Hit HTTP endpoints / open WebSocket                         │
│  4. Verify responses match protocol spec                        │
│  5. Stop service                                                │
└─────────────────────────────────────────────────────────────────┘
```

We'll use OkHttp for HTTP requests and WebSocket connections from test code.

---

## Phase 1: Service Lifecycle Tests

**Goal:** Verify IoDaemonService starts, runs HTTP server, and stops cleanly.

### 1.1 Create Test Base Class

```kotlin
// android/app/src/androidTest/java/com/jstorrent/app/companion/CompanionTestBase.kt
package com.jstorrent.app.companion

import android.content.Context
import androidx.test.platform.app.InstrumentationRegistry
import com.jstorrent.app.auth.TokenStore
import com.jstorrent.app.service.IoDaemonService
import com.jstorrent.app.storage.RootStore
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.junit.After
import org.junit.Before
import java.util.concurrent.TimeUnit

/**
 * Base class for companion mode tests.
 * Provides common setup/teardown and HTTP client utilities.
 */
abstract class CompanionTestBase {

    protected val context: Context = InstrumentationRegistry.getInstrumentation().targetContext
    protected lateinit var tokenStore: TokenStore
    protected lateinit var rootStore: RootStore

    protected val httpClient = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(5, TimeUnit.SECONDS)
        .writeTimeout(5, TimeUnit.SECONDS)
        .build()

    protected val baseUrl: String
        get() = "http://127.0.0.1:${IoDaemonService.instance?.port ?: 7800}"

    @Before
    open fun setUp() {
        tokenStore = TokenStore(context)
        rootStore = RootStore(context)
        
        // Clear any existing state
        tokenStore.clear()
        
        // Start service
        IoDaemonService.start(context)
        
        // Wait for server to be ready
        runBlocking {
            repeat(30) {
                if (IoDaemonService.instance?.isServerRunning == true) return@runBlocking
                delay(100)
            }
        }
    }

    @After
    open fun tearDown() {
        IoDaemonService.stop(context)
        runBlocking { delay(500) }
    }

    // =========================================================================
    // HTTP Helpers
    // =========================================================================

    protected fun get(path: String, headers: Map<String, String> = emptyMap()): okhttp3.Response {
        val request = Request.Builder()
            .url("$baseUrl$path")
            .apply { headers.forEach { (k, v) -> addHeader(k, v) } }
            .get()
            .build()
        return httpClient.newCall(request).execute()
    }

    protected fun post(
        path: String,
        body: String = "",
        headers: Map<String, String> = emptyMap()
    ): okhttp3.Response {
        val request = Request.Builder()
            .url("$baseUrl$path")
            .apply { headers.forEach { (k, v) -> addHeader(k, v) } }
            .post(body.toRequestBody("application/json".toMediaType()))
            .build()
        return httpClient.newCall(request).execute()
    }

    protected fun postBytes(
        path: String,
        body: ByteArray,
        headers: Map<String, String> = emptyMap()
    ): okhttp3.Response {
        val request = Request.Builder()
            .url("$baseUrl$path")
            .apply { headers.forEach { (k, v) -> addHeader(k, v) } }
            .post(body.toRequestBody("application/octet-stream".toMediaType()))
            .build()
        return httpClient.newCall(request).execute()
    }

    protected fun delete(path: String, headers: Map<String, String> = emptyMap()): okhttp3.Response {
        val request = Request.Builder()
            .url("$baseUrl$path")
            .apply { headers.forEach { (k, v) -> addHeader(k, v) } }
            .delete()
            .build()
        return httpClient.newCall(request).execute()
    }

    // =========================================================================
    // Auth Helpers
    // =========================================================================

    protected fun extensionHeaders(token: String? = null): Map<String, String> {
        val headers = mutableMapOf(
            "Origin" to "chrome-extension://testextensionid",
            "X-JST-ExtensionId" to "testextensionid",
            "X-JST-InstallId" to "test-install-id-12345"
        )
        if (token != null) {
            headers["X-JST-Auth"] = token
        }
        return headers
    }

    /**
     * Set up a valid token for authenticated requests.
     */
    protected fun setupAuthToken(): String {
        val token = "test-token-${System.currentTimeMillis()}"
        // API: pair(token, installId, extensionId)
        tokenStore.pair(token, "test-install-id-12345", "testextensionid")
        return token
    }
}
```

### 1.2 Service Lifecycle Test

```kotlin
// android/app/src/androidTest/java/com/jstorrent/app/companion/IoDaemonServiceTest.kt
package com.jstorrent.app.companion

import android.util.Log
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.jstorrent.app.service.IoDaemonService
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking

private const val TAG = "IoDaemonServiceTest"

@RunWith(AndroidJUnit4::class)
class IoDaemonServiceTest : CompanionTestBase() {

    @Test
    fun serviceStartsAndServerIsRunning() {
        assertNotNull("Service instance should exist", IoDaemonService.instance)
        assertTrue("Server should be running", IoDaemonService.instance?.isServerRunning == true)
        assertTrue("Port should be valid", IoDaemonService.instance?.port ?: 0 > 0)
        Log.i(TAG, "Server running on port ${IoDaemonService.instance?.port}")
    }

    @Test
    fun serviceStopsCleanly() = runBlocking {
        assertTrue("Server should be running initially", IoDaemonService.instance?.isServerRunning == true)
        
        IoDaemonService.stop(context)
        delay(1000)
        
        // Instance may still exist briefly but server should be stopped
        val instance = IoDaemonService.instance
        assertTrue(
            "Server should be stopped or instance null",
            instance == null || !instance.isServerRunning
        )
    }

    @Test
    fun serviceRestartsSuccessfully() = runBlocking {
        val port1 = IoDaemonService.instance?.port
        assertNotNull("Initial port should be set", port1)

        IoDaemonService.stop(context)
        delay(500)

        IoDaemonService.start(context)
        repeat(30) {
            if (IoDaemonService.instance?.isServerRunning == true) return@repeat
            delay(100)
        }

        assertTrue("Server should be running after restart", IoDaemonService.instance?.isServerRunning == true)
    }
}
```

### Verification

```bash
cd android
./gradlew :app:connectedAndroidTest --tests "com.jstorrent.app.companion.IoDaemonServiceTest"
```

---

## Phase 2: HTTP Endpoint Tests (Unauthenticated)

**Goal:** Test endpoints that don't require authentication.

```kotlin
// android/app/src/androidTest/java/com/jstorrent/app/companion/HttpEndpointTest.kt
package com.jstorrent.app.companion

import android.util.Log
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import androidx.test.ext.junit.runners.AndroidJUnit4

private const val TAG = "HttpEndpointTest"

@RunWith(AndroidJUnit4::class)
class HttpEndpointTest : CompanionTestBase() {

    private val json = Json { ignoreUnknownKeys = true }

    // =========================================================================
    // Health Check
    // =========================================================================

    @Test
    fun healthEndpointReturnsOk() {
        val response = get("/health")
        
        assertEquals(200, response.code)
        assertEquals("ok", response.body?.string())
    }

    // =========================================================================
    // Status Endpoint
    // =========================================================================

    @Test
    fun statusEndpointRequiresExtensionOrigin() {
        // No Origin header - should fail
        val response = post("/status", "{}")
        
        // Should reject without extension origin
        assertNotEquals(200, response.code)
    }

    @Test
    fun statusEndpointReturnsPortAndPairingStatus() {
        val response = post("/status", "{}", extensionHeaders())
        
        assertEquals(200, response.code)
        
        val body = response.body?.string() ?: ""
        Log.i(TAG, "Status response: $body")
        
        val jsonObj = json.parseToJsonElement(body).jsonObject
        
        assertTrue("Should have port", jsonObj.containsKey("port"))
        assertTrue("Should have paired", jsonObj.containsKey("paired"))
        
        val port = jsonObj["port"]?.jsonPrimitive?.content?.toInt()
        val paired = jsonObj["paired"]?.jsonPrimitive?.content?.toBoolean()
        
        assertEquals(IoDaemonService.instance?.port, port)
        assertFalse("Should not be paired initially", paired ?: true)
    }

    @Test
    fun statusEndpointWithTokenValidation() {
        // Set up a valid token
        val token = setupAuthToken()
        
        // Request status with token in body
        val response = post(
            "/status",
            """{"token": "$token"}""",
            extensionHeaders()
        )
        
        assertEquals(200, response.code)
        
        val body = response.body?.string() ?: ""
        val jsonObj = json.parseToJsonElement(body).jsonObject
        
        val tokenValid = jsonObj["tokenValid"]?.jsonPrimitive?.content?.toBoolean()
        assertTrue("Token should be valid", tokenValid ?: false)
    }

    // =========================================================================
    // Network Interfaces
    // =========================================================================

    @Test
    fun networkInterfacesEndpointReturnsData() {
        val response = get("/network/interfaces")
        
        assertEquals(200, response.code)
        
        val body = response.body?.string() ?: ""
        Log.i(TAG, "Network interfaces: $body")
        
        // Should be a JSON array (even if empty on emulator)
        assertTrue("Should be JSON array", body.startsWith("["))
    }
}
```

### Verification

```bash
cd android
./gradlew :app:connectedAndroidTest --tests "com.jstorrent.app.companion.HttpEndpointTest"
```

---

## Phase 3: Authenticated HTTP Endpoint Tests

**Goal:** Test endpoints that require token authentication.

```kotlin
// android/app/src/androidTest/java/com/jstorrent/app/companion/AuthenticatedEndpointTest.kt
package com.jstorrent.app.companion

import android.util.Base64
import android.util.Log
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.security.MessageDigest

private const val TAG = "AuthenticatedEndpointTest"

@RunWith(AndroidJUnit4::class)
class AuthenticatedEndpointTest : CompanionTestBase() {

    // =========================================================================
    // Auth Rejection
    // =========================================================================

    @Test
    fun rootsEndpointRejectsWithoutAuth() {
        val response = get("/roots", extensionHeaders())
        
        assertEquals("Should reject without auth", 401, response.code)
    }

    @Test
    fun hashEndpointRejectsWithoutAuth() {
        val response = postBytes("/hash/sha1", "test".toByteArray(), extensionHeaders())
        
        assertEquals("Should reject without auth", 401, response.code)
    }

    // =========================================================================
    // Roots Endpoint
    // =========================================================================

    @Test
    fun rootsEndpointReturnsRootsList() {
        val token = setupAuthToken()
        
        val response = get("/roots", extensionHeaders(token))
        
        assertEquals(200, response.code)
        
        val body = response.body?.string() ?: ""
        Log.i(TAG, "Roots response: $body")
        
        assertTrue("Should contain roots array", body.contains("roots"))
    }

    // =========================================================================
    // Hash Endpoint
    // =========================================================================

    @Test
    fun hashEndpointComputesSha1() {
        val token = setupAuthToken()
        val testData = "Hello, World!".toByteArray()
        
        val response = postBytes("/hash/sha1", testData, extensionHeaders(token))
        
        assertEquals(200, response.code)
        
        val hashBytes = response.body?.bytes() ?: ByteArray(0)
        assertEquals("SHA1 is 20 bytes", 20, hashBytes.size)
        
        // Verify against Java's MessageDigest
        val expectedHash = MessageDigest.getInstance("SHA-1").digest(testData)
        assertArrayEquals("Hash should match", expectedHash, hashBytes)
    }

    @Test
    fun hashEndpointHandlesEmptyData() {
        val token = setupAuthToken()
        
        val response = postBytes("/hash/sha1", ByteArray(0), extensionHeaders(token))
        
        assertEquals(200, response.code)
        
        val hashBytes = response.body?.bytes() ?: ByteArray(0)
        assertEquals(20, hashBytes.size)
        
        // SHA1 of empty is da39a3ee5e6b4b0d3255bfef95601890afd80709
        val expectedHash = MessageDigest.getInstance("SHA-1").digest(ByteArray(0))
        assertArrayEquals(expectedHash, hashBytes)
    }

    @Test
    fun hashEndpointHandlesLargeData() {
        val token = setupAuthToken()
        val largeData = ByteArray(1024 * 1024) { it.toByte() }  // 1MB
        
        val response = postBytes("/hash/sha1", largeData, extensionHeaders(token))
        
        assertEquals(200, response.code)
        assertEquals(20, response.body?.bytes()?.size)
    }
}
```

### Verification

```bash
cd android
./gradlew :app:connectedAndroidTest --tests "com.jstorrent.app.companion.AuthenticatedEndpointTest"
```

---

## Phase 4: File I/O Tests

**Goal:** Test /read and /write endpoints.

**Prerequisites:** Add test-only method to `RootStore` for `file://` URIs.

### 4.0 Add Test Helper to RootStore

Add this method to `android/app/src/main/java/com/jstorrent/app/storage/RootStore.kt`:

```kotlin
/**
 * Add a test root with explicit values. For instrumented tests only.
 * Bypasses SAF validation to allow file:// URIs.
 */
@androidx.annotation.VisibleForTesting
internal fun addTestRoot(uri: String, displayName: String): DownloadRoot {
    val key = generateKey(Uri.parse(uri))
    val root = DownloadRoot(
        key = key,
        uri = uri,
        displayName = displayName,
        removable = false,
        lastStatOk = true,
        lastChecked = System.currentTimeMillis()
    )
    config = config.copy(roots = config.roots + root)
    save()
    return root
}
```

### 4.1 File I/O Test Class

```kotlin
// android/app/src/androidTest/java/com/jstorrent/app/companion/FileIOTest.kt
package com.jstorrent.app.companion

import android.util.Base64
import android.util.Log
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.io.File

private const val TAG = "FileIOTest"

@RunWith(AndroidJUnit4::class)
class FileIOTest : CompanionTestBase() {

    private lateinit var testRootKey: String
    private lateinit var token: String
    private lateinit var testDir: File

    @Before
    override fun setUp() {
        super.setUp()
        token = setupAuthToken()
        
        // Create a test directory in app's private storage
        testDir = File(context.filesDir, "test_downloads_${System.currentTimeMillis()}")
        testDir.mkdirs()
        
        // Add root using file:// URI - FileManagerImpl handles these natively
        val result = rootStore.addTestRoot(
            uri = "file://${testDir.absolutePath}",
            displayName = "Test Downloads"
        )
        testRootKey = result.key
        
        Log.i(TAG, "Test root key: $testRootKey, path: ${testDir.absolutePath}")
    }

    // =========================================================================
    // Write Tests
    // =========================================================================

    @Test
    fun writeCreatesNewFile() {
        val testPath = "test_file_${System.currentTimeMillis()}.txt"
        val testData = "Hello, JSTorrent!".toByteArray()
        val pathBase64 = Base64.encodeToString(testPath.toByteArray(), Base64.NO_WRAP)

        val headers = extensionHeaders(token) + mapOf(
            "X-Path-Base64" to pathBase64
        )

        val response = postBytes("/write/$testRootKey", testData, headers)
        
        assertEquals("Write should succeed", 200, response.code)
        
        // Verify file exists on disk
        val file = File(testDir, testPath)
        assertTrue("File should exist", file.exists())
        assertEquals("Content should match", "Hello, JSTorrent!", file.readText())
    }

    @Test
    fun writeWithOffsetWorks() {
        val testPath = "test_offset_${System.currentTimeMillis()}.bin"
        val pathBase64 = Base64.encodeToString(testPath.toByteArray(), Base64.NO_WRAP)

        // First write
        val data1 = "AAAA".toByteArray()
        postBytes("/write/$testRootKey", data1, extensionHeaders(token) + mapOf(
            "X-Path-Base64" to pathBase64
        ))

        // Write at offset 2
        val data2 = "BB".toByteArray()
        val response = postBytes("/write/$testRootKey", data2, extensionHeaders(token) + mapOf(
            "X-Path-Base64" to pathBase64,
            "X-Offset" to "2"
        ))
        
        assertEquals(200, response.code)

        // Read back and verify: should be "AABB"
        val readResponse = get("/read/$testRootKey", extensionHeaders(token) + mapOf(
            "X-Path-Base64" to pathBase64,
            "X-Offset" to "0",
            "X-Length" to "4"
        ))
        
        assertEquals(200, readResponse.code)
        assertEquals("AABB", readResponse.body?.string())
    }
    
    @Test
    fun writeCreatesParentDirectories() {
        val testPath = "subdir/nested/file_${System.currentTimeMillis()}.txt"
        val testData = "Nested content".toByteArray()
        val pathBase64 = Base64.encodeToString(testPath.toByteArray(), Base64.NO_WRAP)

        val response = postBytes("/write/$testRootKey", testData, extensionHeaders(token) + mapOf(
            "X-Path-Base64" to pathBase64
        ))
        
        assertEquals("Write should succeed", 200, response.code)
        
        // Verify nested file exists
        val file = File(testDir, testPath)
        assertTrue("Nested file should exist", file.exists())
    }

    // =========================================================================
    // Read Tests
    // =========================================================================

    @Test
    fun readExistingFile() {
        // First write a file
        val testPath = "read_test_${System.currentTimeMillis()}.txt"
        val testData = "Test content for reading"
        val pathBase64 = Base64.encodeToString(testPath.toByteArray(), Base64.NO_WRAP)

        postBytes("/write/$testRootKey", testData.toByteArray(), extensionHeaders(token) + mapOf(
            "X-Path-Base64" to pathBase64
        ))

        // Now read it back
        val response = get("/read/$testRootKey", extensionHeaders(token) + mapOf(
            "X-Path-Base64" to pathBase64,
            "X-Offset" to "0",
            "X-Length" to testData.length.toString()
        ))
        
        assertEquals(200, response.code)
        assertEquals(testData, response.body?.string())
    }

    @Test
    fun readWithOffsetAndLength() {
        val testPath = "partial_read_${System.currentTimeMillis()}.txt"
        val testData = "0123456789"
        val pathBase64 = Base64.encodeToString(testPath.toByteArray(), Base64.NO_WRAP)

        postBytes("/write/$testRootKey", testData.toByteArray(), extensionHeaders(token) + mapOf(
            "X-Path-Base64" to pathBase64
        ))

        // Read bytes 3-6 (should be "3456")
        val response = get("/read/$testRootKey", extensionHeaders(token) + mapOf(
            "X-Path-Base64" to pathBase64,
            "X-Offset" to "3",
            "X-Length" to "4"
        ))
        
        assertEquals(200, response.code)
        assertEquals("3456", response.body?.string())
    }

    @Test
    fun readNonexistentFileReturns404() {
        val pathBase64 = Base64.encodeToString("nonexistent_file.txt".toByteArray(), Base64.NO_WRAP)

        val response = get("/read/$testRootKey", extensionHeaders(token) + mapOf(
            "X-Path-Base64" to pathBase64,
            "X-Offset" to "0",
            "X-Length" to "100"
        ))
        
        assertEquals(404, response.code)
    }

    @Test
    fun readInvalidRootKeyReturns404() {
        val pathBase64 = Base64.encodeToString("test.txt".toByteArray(), Base64.NO_WRAP)

        val response = get("/read/invalid_root_key", extensionHeaders(token) + mapOf(
            "X-Path-Base64" to pathBase64,
            "X-Offset" to "0",
            "X-Length" to "100"
        ))
        
        // Invalid root key should return 404 or 400
        assertTrue("Should reject invalid root", response.code in listOf(400, 404))
    }
}
```

### Verification

```bash
cd android
./gradlew :app:connectedAndroidTest --tests "com.jstorrent.app.companion.FileIOTest"
```

---

## Phase 5: WebSocket IO Tests

**Goal:** Test WebSocket /io endpoint with binary protocol.

```kotlin
// android/app/src/androidTest/java/com/jstorrent/app/companion/WebSocketIOTest.kt
package com.jstorrent.app.companion

import android.util.Log
import com.jstorrent.io.protocol.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.toByteString
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

private const val TAG = "WebSocketIOTest"

@RunWith(AndroidJUnit4::class)
class WebSocketIOTest : CompanionTestBase() {

    // =========================================================================
    // Protocol Helpers
    // =========================================================================

    private fun createClientHello(requestId: Int): ByteArray {
        return Protocol.createMessage(Protocol.OP_CLIENT_HELLO, requestId)
    }

    private fun createAuthFrame(requestId: Int, token: String, extensionId: String, installId: String): ByteArray {
        // AUTH payload: authType(1) + token + \0 + extensionId + \0 + installId
        val payload = byteArrayOf(0) +  // authType = 0
            token.toByteArray() + byteArrayOf(0) +
            extensionId.toByteArray() + byteArrayOf(0) +
            installId.toByteArray()
        return Protocol.createMessage(Protocol.OP_AUTH, requestId, payload)
    }

    // =========================================================================
    // Connection & Auth Tests
    // =========================================================================

    @Test
    fun webSocketConnectsAndAuthenticates() {
        val token = setupAuthToken()
        val latch = CountDownLatch(3)  // HELLO, AUTH_RESULT
        val messages = mutableListOf<ByteArray>()
        val error = AtomicReference<Throwable>()

        val request = Request.Builder()
            .url("ws://127.0.0.1:${IoDaemonService.instance?.port}/io")
            .build()

        val listener = object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                Log.i(TAG, "WebSocket opened")
                // Send CLIENT_HELLO
                webSocket.send(createClientHello(1).toByteString())
                latch.countDown()
            }

            override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                val data = bytes.toByteArray()
                Log.i(TAG, "Received ${data.size} bytes, opcode=0x${data.getOrNull(1)?.toInt()?.and(0xFF)?.toString(16)}")
                messages.add(data)

                // Check opcode
                val opcode = data.getOrNull(1)?.toInt()?.and(0xFF) ?: -1
                when (opcode) {
                    Protocol.OP_SERVER_HELLO -> {
                        Log.i(TAG, "Got SERVER_HELLO, sending AUTH")
                        webSocket.send(createAuthFrame(2, token, "testextensionid", "test-install-id-12345").toByteString())
                    }
                    Protocol.OP_AUTH_RESULT -> {
                        Log.i(TAG, "Got AUTH_RESULT")
                        latch.countDown()
                        webSocket.close(1000, "Test complete")
                        latch.countDown()
                    }
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.e(TAG, "WebSocket failure", t)
                error.set(t)
                latch.countDown()
                latch.countDown()
                latch.countDown()
            }
        }

        val ws = httpClient.newWebSocket(request, listener)
        
        assertTrue("Should complete handshake", latch.await(10, TimeUnit.SECONDS))
        assertNull("Should have no error", error.get())
        
        // Verify AUTH_RESULT indicates success (status byte = 0)
        val authResult = messages.find { 
            it.getOrNull(1)?.toInt()?.and(0xFF) == Protocol.OP_AUTH_RESULT 
        }
        assertNotNull("Should have AUTH_RESULT", authResult)
        
        val status = authResult?.getOrNull(8)?.toInt()?.and(0xFF)
        assertEquals("AUTH should succeed (status=0)", 0, status)
    }

    @Test
    fun authFailsWithInvalidToken() {
        val latch = CountDownLatch(2)
        var authStatus: Int = -1

        val request = Request.Builder()
            .url("ws://127.0.0.1:${IoDaemonService.instance?.port}/io")
            .build()

        val listener = object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                webSocket.send(createClientHello(1).toByteString())
            }

            override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                val data = bytes.toByteArray()
                val opcode = data.getOrNull(1)?.toInt()?.and(0xFF) ?: -1
                
                when (opcode) {
                    Protocol.OP_SERVER_HELLO -> {
                        // Send AUTH with invalid token
                        webSocket.send(createAuthFrame(2, "invalid-token", "ext", "install").toByteString())
                    }
                    Protocol.OP_AUTH_RESULT -> {
                        authStatus = data.getOrNull(8)?.toInt()?.and(0xFF) ?: -1
                        latch.countDown()
                        webSocket.close(1000, "Done")
                        latch.countDown()
                    }
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                latch.countDown()
                latch.countDown()
            }
        }

        httpClient.newWebSocket(request, listener)
        
        assertTrue(latch.await(10, TimeUnit.SECONDS))
        assertNotEquals("AUTH should fail (status != 0)", 0, authStatus)
    }
}
```

### Verification

```bash
cd android
./gradlew :app:connectedAndroidTest --tests "com.jstorrent.app.companion.WebSocketIOTest"
```

---

## Phase 6: TCP Socket Operation Tests

**Goal:** Test TCP socket operations through WebSocket protocol.

```kotlin
// android/app/src/androidTest/java/com/jstorrent/app/companion/TcpSocketTest.kt
package com.jstorrent.app.companion

import android.util.Log
import com.jstorrent.io.protocol.Protocol
import com.jstorrent.io.protocol.toLEBytes
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.toByteString
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

private const val TAG = "TcpSocketTest"

@RunWith(AndroidJUnit4::class)
class TcpSocketTest : CompanionTestBase() {

    /**
     * Helper to get an authenticated WebSocket.
     */
    private fun connectAndAuth(onAuthenticated: (WebSocket) -> Unit, onMessage: (WebSocket, ByteArray) -> Unit) {
        val token = setupAuthToken()
        val latch = CountDownLatch(1)

        val request = Request.Builder()
            .url("ws://127.0.0.1:${IoDaemonService.instance?.port}/io")
            .build()

        val listener = object : WebSocketListener() {
            private var authenticated = false

            override fun onOpen(webSocket: WebSocket, response: Response) {
                webSocket.send(Protocol.createMessage(Protocol.OP_CLIENT_HELLO, 1).toByteString())
            }

            override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                val data = bytes.toByteArray()
                val opcode = data.getOrNull(1)?.toInt()?.and(0xFF) ?: -1

                if (!authenticated) {
                    when (opcode) {
                        Protocol.OP_SERVER_HELLO -> {
                            val payload = byteArrayOf(0) +
                                token.toByteArray() + byteArrayOf(0) +
                                "testextensionid".toByteArray() + byteArrayOf(0) +
                                "test-install-id".toByteArray()
                            webSocket.send(Protocol.createMessage(Protocol.OP_AUTH, 2, payload).toByteString())
                        }
                        Protocol.OP_AUTH_RESULT -> {
                            val status = data.getOrNull(8)?.toInt()?.and(0xFF)
                            if (status == 0) {
                                authenticated = true
                                latch.countDown()
                                onAuthenticated(webSocket)
                            }
                        }
                    }
                } else {
                    onMessage(webSocket, data)
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.e(TAG, "WebSocket failure", t)
                latch.countDown()
            }
        }

        httpClient.newWebSocket(request, listener)
        assertTrue("Should authenticate", latch.await(10, TimeUnit.SECONDS))
    }

    @Test
    fun tcpConnectToValidHost() {
        val connectLatch = CountDownLatch(1)
        val socketIdHolder = AtomicInteger(-1)
        var connectSuccess = false

        connectAndAuth(
            onAuthenticated = { ws ->
                // TCP_CONNECT to google.com:80
                val socketId = 1
                val port: Short = 80
                val host = "google.com"
                
                val payload = socketId.toLEBytes() +
                    byteArrayOf((port.toInt() and 0xFF).toByte(), ((port.toInt() shr 8) and 0xFF).toByte()) +
                    host.toByteArray()
                
                ws.send(Protocol.createMessage(Protocol.OP_TCP_CONNECT, 100, payload).toByteString())
                socketIdHolder.set(socketId)
            },
            onMessage = { ws, data ->
                val opcode = data.getOrNull(1)?.toInt()?.and(0xFF) ?: -1
                
                if (opcode == Protocol.OP_TCP_CONNECTED) {
                    // Parse response: [socketId:4][status:1]
                    val status = data.getOrNull(12)?.toInt()?.and(0xFF)
                    Log.i(TAG, "TCP_CONNECTED: status=$status")
                    connectSuccess = (status == 0)
                    
                    // Close the socket
                    val socketId = socketIdHolder.get()
                    val closePayload = socketId.toLEBytes() + byteArrayOf(0) + 0.toLEBytes()
                    ws.send(Protocol.createMessage(Protocol.OP_TCP_CLOSE, 0, closePayload).toByteString())
                    
                    ws.close(1000, "Done")
                    connectLatch.countDown()
                }
            }
        )

        assertTrue("Should receive TCP_CONNECTED", connectLatch.await(15, TimeUnit.SECONDS))
        assertTrue("Connect should succeed", connectSuccess)
    }

    @Test
    fun tcpConnectToInvalidHostFails() {
        val connectLatch = CountDownLatch(1)
        var connectFailed = false

        connectAndAuth(
            onAuthenticated = { ws ->
                val socketId = 1
                val port: Short = 12345
                val host = "invalid.nonexistent.host.test"
                
                val payload = socketId.toLEBytes() +
                    byteArrayOf((port.toInt() and 0xFF).toByte(), ((port.toInt() shr 8) and 0xFF).toByte()) +
                    host.toByteArray()
                
                ws.send(Protocol.createMessage(Protocol.OP_TCP_CONNECT, 100, payload).toByteString())
            },
            onMessage = { ws, data ->
                val opcode = data.getOrNull(1)?.toInt()?.and(0xFF) ?: -1
                
                if (opcode == Protocol.OP_TCP_CONNECTED) {
                    val status = data.getOrNull(12)?.toInt()?.and(0xFF)
                    Log.i(TAG, "TCP_CONNECTED: status=$status")
                    connectFailed = (status != 0)
                    ws.close(1000, "Done")
                    connectLatch.countDown()
                }
            }
        )

        assertTrue("Should receive response", connectLatch.await(15, TimeUnit.SECONDS))
        assertTrue("Connect should fail for invalid host", connectFailed)
    }
}
```

### Verification

```bash
cd android
./gradlew :app:connectedAndroidTest --tests "com.jstorrent.app.companion.TcpSocketTest"
```

---

## Summary

| Phase | Tests | Time |
|-------|-------|------|
| 1 | Service lifecycle (start/stop/restart) | ~5s |
| 2 | HTTP endpoints (health, status, network) | ~5s |
| 3 | Authenticated endpoints (roots, hash) | ~5s |
| 4 | File I/O (read/write with offsets) | ~10s |
| 5 | WebSocket auth handshake | ~10s |
| 6 | TCP socket operations | ~15s |

**Total:** ~50 seconds

### Run All Companion Tests

```bash
cd android
./gradlew :app:connectedAndroidTest --tests "com.jstorrent.app.companion.*"
```

---

## Future Phases (If Needed)

- **Phase 7:** UDP socket operations
- **Phase 8:** WebSocket /control endpoint (ROOTS_CHANGED, EVENT broadcasts)
- **Phase 9:** Pairing flow (intent URL → dialog → token storage)
- **Phase 10:** Stress tests (multiple concurrent connections, large file I/O)
