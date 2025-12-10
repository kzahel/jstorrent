# Secure Android Pairing Flow - Agent Guide

## Overview

This task implements a secure pairing flow between the JSTorrent Chrome extension and the Android I/O daemon on ChromeOS. The current implementation passes auth tokens via Android intents, which is insecure because any app can fire intents. The new flow uses HTTP-based pairing over the trusted channel (100.115.92.2) that only the extension can reach.

**Security Model:** 
- The IP 100.115.92.2 (ARC bridge) is only reachable from Chrome on ChromeOS due to the extension's `host_permissions` in manifest.json
- On Android, the daemon listens on 0.0.0.0, so local apps could hit it at 127.0.0.1 - we check `Origin` header to block this
- Android intents are untrusted (any app can send them) - used only for launching, never for auth

## Current State

**Extension (`daemon-bridge.ts`):**
- `triggerLaunch()` sends `intent://pair?token=...` which both launches AND sets token (insecure)
- `checkPaired()` only checks if `paired: true`, doesn't verify installId
- Token is stored in `chrome.storage.local` under `android:authToken`
- installId exists in `chrome.storage.local` under `installId` but isn't sent to Android

**Android (`MainActivity.kt`, `TokenStore.kt`, `HttpServer.kt`):**
- Intent handler at `jstorrent://pair?token=...` silently stores token (no user approval)
- `jstorrent://launch` intent exists but isn't used by extension
- `/status` returns `{"port":..., "paired":...}` but not extensionId/installId
- No `POST /pair` endpoint exists
- No Origin header validation
- TokenStore only stores token, not installId/extensionId

## Target State

### API Contract

All HTTP endpoints (except `/health`) require consistent headers:
- `X-JST-ExtensionId` - Chrome extension ID
- `X-JST-InstallId` - Unique ID per extension installation

| Endpoint | Method | Origin Check | Token Auth | Request | Response |
|----------|--------|--------------|------------|---------|----------|
| `/health` | GET | No | No | - | `"ok"` |
| `/status` | GET | Yes | No | Headers only | `{port, paired, extensionId, installId}` |
| `/pair` | POST | Yes | No | Body: `{token}` | 200 / 202 / 409 |
| `/roots` | GET | No | Yes | `X-JST-Auth` header | `{roots:[...]}` |
| `/read/{root}` | GET | No | Yes | `X-JST-Auth` header | bytes |
| `/write/{root}` | POST | No | Yes | `X-JST-Auth` header | status |
| `/hash/sha1` | POST | No | Yes | `X-JST-Auth` header | bytes |
| `/io` | WebSocket | No | Yes | AUTH frame: `{token, extensionId, installId}` | AUTH_RESULT |

**Origin check:** Validates `Origin` header starts with `chrome-extension://`

**POST /pair responses:**
- `200 OK` - Same extensionId AND installId, token updated silently (no dialog)
- `202 Accepted` - Dialog shown, extension should poll `/status`
- `409 Conflict` - Dialog already showing for another request, back off and poll

### Connection Flow

**Initial pairing:**
```
Extension                          Android
    |                                  |
    |------- GET /status ------------->|  (headers: ExtensionId, InstallId)
    |<------ {paired:false} -----------|
    |                                  |
    |------- POST /pair -------------->|  (headers + body: {token})
    |<------ 202 Accepted -------------|
    |                                  |  [dialog shows]
    |------- GET /status (poll) ------>|
    |<------ {paired:false} -----------|
    |          ...                     |  [user clicks Allow]
    |------- GET /status ------------->|
    |<------ {paired:true, extId, instId} |
    |                                  |
    |------- WebSocket /io ----------->|
    |        AUTH frame --------------->|  ({token, extensionId, installId})
    |<------ AUTH_RESULT success ------|
```

**Reconnection (has cached token, same installId):**
```
Extension                          Android  
    |                                  |
    |------- GET /status ------------->|
    |<------ {paired:true, extId, instId} |  [matches us]
    |                                  |
    |------- WebSocket /io ----------->|
    |        AUTH frame --------------->|
    |<------ AUTH_RESULT success ------|
```

**Different installId (extension reinstalled):**
```
Extension                          Android
    |                                  |
    |------- GET /status ------------->|
    |<------ {paired:true, extId, instId} |  [instId doesn't match]
    |                                  |
    |------- POST /pair -------------->|
    |<------ 202 Accepted -------------|  [shows "Replace?" dialog]
    |       ... poll until approved ...
```

---

## Phase 1: Android - Origin Check Middleware

### 1.1 Create OriginCheckMiddleware.kt

**File:** `android-io-daemon/app/src/main/java/com/jstorrent/app/server/OriginCheckMiddleware.kt`

**Create new file:**

```kotlin
package com.jstorrent.app.server

import io.ktor.http.*
import io.ktor.server.application.*
import io.ktor.server.request.*
import io.ktor.server.response.*

/**
 * Validates that requests come from a Chrome extension.
 * Chrome extensions set Origin: chrome-extension://<id> on fetch requests.
 * This blocks local Android apps from hitting the daemon at 127.0.0.1.
 */
suspend fun ApplicationCall.requireExtensionOrigin(): Boolean {
    val origin = request.header(HttpHeaders.Origin)
    
    if (origin == null || !origin.startsWith("chrome-extension://")) {
        respond(HttpStatusCode.Forbidden, "Invalid origin")
        return false
    }
    
    return true
}

/**
 * Extracts and validates required extension headers.
 * Returns null if headers are missing (after sending error response).
 */
suspend fun ApplicationCall.getExtensionHeaders(): ExtensionHeaders? {
    val extensionId = request.header("X-JST-ExtensionId")
    val installId = request.header("X-JST-InstallId")
    
    if (extensionId.isNullOrBlank() || installId.isNullOrBlank()) {
        respond(HttpStatusCode.BadRequest, "Missing X-JST-ExtensionId or X-JST-InstallId headers")
        return null
    }
    
    return ExtensionHeaders(extensionId, installId)
}

data class ExtensionHeaders(
    val extensionId: String,
    val installId: String
)
```

---

## Phase 2: Android - TokenStore Enhancement

### 2.1 Update TokenStore.kt

Add installId and extensionId storage.

**File:** `android-io-daemon/app/src/main/java/com/jstorrent/app/auth/TokenStore.kt`

**Replace entire file with:**

```kotlin
package com.jstorrent.app.auth

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit

/**
 * Stores the authentication credentials shared between the extension and this app.
 * - token: The shared secret for authenticating requests
 * - installId: Identifies which extension installation is paired (detects reinstalls)
 * - extensionId: The Chrome extension ID that is paired
 */
class TokenStore(context: Context) {

    private val prefs: SharedPreferences = context.getSharedPreferences(
        PREFS_NAME,
        Context.MODE_PRIVATE
    )

    var token: String?
        get() = prefs.getString(KEY_TOKEN, null)
        private set(value) = prefs.edit { putString(KEY_TOKEN, value) }

    var installId: String?
        get() = prefs.getString(KEY_INSTALL_ID, null)
        private set(value) = prefs.edit { putString(KEY_INSTALL_ID, value) }

    var extensionId: String?
        get() = prefs.getString(KEY_EXTENSION_ID, null)
        private set(value) = prefs.edit { putString(KEY_EXTENSION_ID, value) }

    fun hasToken(): Boolean = token != null

    /**
     * Check if paired with a specific extension installation.
     */
    fun isPairedWith(checkExtensionId: String, checkInstallId: String): Boolean {
        return token != null && 
               extensionId == checkExtensionId && 
               installId == checkInstallId
    }

    /**
     * Store pairing credentials atomically.
     */
    fun pair(newToken: String, newInstallId: String, newExtensionId: String) {
        prefs.edit {
            putString(KEY_TOKEN, newToken)
            putString(KEY_INSTALL_ID, newInstallId)
            putString(KEY_EXTENSION_ID, newExtensionId)
        }
    }

    fun clear() {
        prefs.edit {
            remove(KEY_TOKEN)
            remove(KEY_INSTALL_ID)
            remove(KEY_EXTENSION_ID)
        }
    }

    companion object {
        private const val PREFS_NAME = "jstorrent_auth"
        private const val KEY_TOKEN = "auth_token"
        private const val KEY_INSTALL_ID = "install_id"
        private const val KEY_EXTENSION_ID = "extension_id"
    }
}
```

---

## Phase 3: Android - Pairing Approval Activity

### 3.1 Create PairingApprovalActivity.kt

**File:** `android-io-daemon/app/src/main/java/com/jstorrent/app/PairingApprovalActivity.kt`

**Create new file:**

```kotlin
package com.jstorrent.app

import android.app.Activity
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.jstorrent.app.ui.theme.JSTorrentTheme

private const val TAG = "PairingApprovalActivity"

/**
 * Activity that shows pairing approval dialog.
 * Launched by HttpServer when POST /pair is received.
 * Result communicated via companion object callback.
 */
class PairingApprovalActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val token = intent.getStringExtra(EXTRA_TOKEN) ?: run {
            Log.e(TAG, "Missing token")
            finishWithResult(false)
            return
        }
        val installId = intent.getStringExtra(EXTRA_INSTALL_ID) ?: run {
            Log.e(TAG, "Missing installId")
            finishWithResult(false)
            return
        }
        val extensionId = intent.getStringExtra(EXTRA_EXTENSION_ID) ?: run {
            Log.e(TAG, "Missing extensionId")
            finishWithResult(false)
            return
        }
        val isReplace = intent.getBooleanExtra(EXTRA_IS_REPLACE, false)

        setContent {
            JSTorrentTheme {
                PairingApprovalScreen(
                    isReplace = isReplace,
                    onApprove = {
                        Log.i(TAG, "User approved pairing")
                        pendingCallback?.invoke(true, token, installId, extensionId)
                        pendingCallback = null
                        finishWithResult(true)
                    },
                    onDeny = {
                        Log.i(TAG, "User denied pairing")
                        pendingCallback?.invoke(false, null, null, null)
                        pendingCallback = null
                        finishWithResult(false)
                    }
                )
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        // Activity destroyed without explicit action = denial
        if (pendingCallback != null) {
            pendingCallback?.invoke(false, null, null, null)
            pendingCallback = null
        }
    }

    private fun finishWithResult(approved: Boolean) {
        setResult(if (approved) Activity.RESULT_OK else Activity.RESULT_CANCELED)
        finish()
    }

    companion object {
        const val EXTRA_TOKEN = "token"
        const val EXTRA_INSTALL_ID = "install_id"
        const val EXTRA_EXTENSION_ID = "extension_id"
        const val EXTRA_IS_REPLACE = "is_replace"

        var pendingCallback: ((
            approved: Boolean,
            token: String?,
            installId: String?,
            extensionId: String?
        ) -> Unit)? = null
    }
}

@Composable
fun PairingApprovalScreen(
    isReplace: Boolean,
    onApprove: () -> Unit,
    onDeny: () -> Unit
) {
    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Text(
                text = if (isReplace) "Replace Existing Connection?" else "Allow Connection?",
                style = MaterialTheme.typography.headlineMedium,
                textAlign = TextAlign.Center
            )

            Spacer(modifier = Modifier.height(16.dp))

            Text(
                text = if (isReplace) {
                    "A different JSTorrent extension wants to connect. This will replace the current pairing."
                } else {
                    "JSTorrent Chrome extension wants to connect for file downloads."
                },
                style = MaterialTheme.typography.bodyLarge,
                textAlign = TextAlign.Center,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            Spacer(modifier = Modifier.height(32.dp))

            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                OutlinedButton(onClick = onDeny, modifier = Modifier.weight(1f)) {
                    Text("Deny")
                }
                Button(onClick = onApprove, modifier = Modifier.weight(1f)) {
                    Text("Allow")
                }
            }
        }
    }
}
```

### 3.2 Register in AndroidManifest.xml

**File:** `android-io-daemon/app/src/main/AndroidManifest.xml`

**Find:**
```xml
        <!-- SAF folder picker activity -->
        <activity
            android:name=".AddRootActivity"
```

**Add BEFORE it:**
```xml
        <!-- Pairing approval activity -->
        <activity
            android:name=".PairingApprovalActivity"
            android:exported="false"
            android:theme="@style/Theme.JSTorrent"
            android:excludeFromRecents="true" />

```

---

## Phase 4: Android - HttpServer Updates

### 4.1 Update HttpServer.kt

**File:** `android-io-daemon/app/src/main/java/com/jstorrent/app/server/HttpServer.kt`

**Add imports after existing imports:**

```kotlin
import android.content.Intent
import com.jstorrent.app.PairingApprovalActivity
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.coroutines.resume
```

**Add data classes after `RootsResponse` (around line 31):**

```kotlin
@Serializable
private data class StatusResponse(
    val port: Int,
    val paired: Boolean,
    val extensionId: String? = null,
    val installId: String? = null
)

@Serializable
private data class PairRequest(
    val token: String
)

@Serializable
private data class PairResponse(
    val status: String  // "approved", "pending"
)
```

**Add field after `controlSessions` (around line 47):**

```kotlin
    // Is a pairing dialog currently showing?
    @Volatile
    private var pairingDialogShowing = false
```

**Replace the `/status` endpoint (around lines 98-104) with:**

```kotlin
            // Status endpoint - origin check, no token auth
            get("/status") {
                if (!call.requireExtensionOrigin()) return@get
                val headers = call.getExtensionHeaders() ?: return@get
                
                val response = StatusResponse(
                    port = actualPort,
                    paired = tokenStore.hasToken(),
                    extensionId = tokenStore.extensionId,
                    installId = tokenStore.installId
                )
                call.respondText(
                    json.encodeToString(response),
                    ContentType.Application.Json
                )
            }

            // Pairing endpoint - origin check, no token auth
            post("/pair") {
                if (!call.requireExtensionOrigin()) return@post
                val headers = call.getExtensionHeaders() ?: return@post
                
                val request = try {
                    json.decodeFromString<PairRequest>(call.receiveText())
                } catch (e: Exception) {
                    call.respond(HttpStatusCode.BadRequest, "Invalid request body")
                    return@post
                }

                // Same extensionId AND installId = silent re-pair (token refresh)
                if (tokenStore.isPairedWith(headers.extensionId, headers.installId)) {
                    tokenStore.pair(request.token, headers.installId, headers.extensionId)
                    Log.i(TAG, "Silent re-pair: same extensionId and installId")
                    call.respondText(
                        json.encodeToString(PairResponse("approved")),
                        ContentType.Application.Json
                    )
                    return@post
                }

                // Dialog already showing? Return 409
                if (pairingDialogShowing) {
                    Log.w(TAG, "Pairing dialog already showing, rejecting")
                    call.respond(HttpStatusCode.Conflict, "Pairing dialog already showing")
                    return@post
                }

                // Show dialog (async) and return 202
                pairingDialogShowing = true
                val isReplace = tokenStore.hasToken()
                
                showPairingDialog(
                    token = request.token,
                    installId = headers.installId,
                    extensionId = headers.extensionId,
                    isReplace = isReplace
                )
                
                call.respondText(
                    json.encodeToString(PairResponse("pending")),
                    ContentType.Application.Json,
                    HttpStatusCode.Accepted
                )
            }
```

**Update the intercept block for file routes to include header validation (around line 137):**

```kotlin
            // File routes with auth
            route("/") {
                intercept(ApplicationCallPipeline.Call) {
                    val path = call.request.path()
                    if (path.startsWith("/read/") || path.startsWith("/write/")) {
                        // Validate extension headers
                        val headers = call.getExtensionHeaders()
                        if (headers == null) {
                            finish()
                            return@intercept
                        }
                        
                        // Validate token
                        val storedToken = tokenStore.token
                        if (storedToken == null) {
                            call.respond(HttpStatusCode.ServiceUnavailable, "Not paired")
                            finish()
                            return@intercept
                        }

                        val providedToken = call.request.header("X-JST-Auth")
                            ?: call.request.header("Authorization")?.removePrefix("Bearer ")

                        if (providedToken != storedToken) {
                            call.respond(HttpStatusCode.Unauthorized, "Invalid token")
                            finish()
                            return@intercept
                        }
                    }
                }

                fileRoutes(rootStore, context)
            }
```

**Update requireAuth helper in the routing to also check headers. Replace the `/hash/sha1` and `/roots` endpoints:**

```kotlin
            post("/hash/sha1") {
                val headers = call.getExtensionHeaders() ?: return@post
                requireAuth(tokenStore) {
                    val bytes = call.receive<ByteArray>()
                    val digest = MessageDigest.getInstance("SHA-1")
                    val hash = digest.digest(bytes)
                    call.respondBytes(hash, ContentType.Application.OctetStream)
                }
            }

            get("/roots") {
                val headers = call.getExtensionHeaders() ?: return@get
                requireAuth(tokenStore) {
                    val roots = rootStore.refreshAvailability()
                    val response = RootsResponse(roots = roots)
                    call.respondText(
                        json.encodeToString(response),
                        ContentType.Application.Json
                    )
                }
            }
```

**Add method before `companion object`:**

```kotlin
    /**
     * Show pairing approval dialog. Runs async - result stored when user acts.
     */
    private fun showPairingDialog(
        token: String,
        installId: String,
        extensionId: String,
        isReplace: Boolean
    ) {
        PairingApprovalActivity.pendingCallback = { approved, approvedToken, approvedInstallId, approvedExtensionId ->
            pairingDialogShowing = false
            if (approved && approvedToken != null && approvedInstallId != null && approvedExtensionId != null) {
                tokenStore.pair(approvedToken, approvedInstallId, approvedExtensionId)
                Log.i(TAG, "Pairing approved and stored")
            } else {
                Log.i(TAG, "Pairing denied or dismissed")
            }
        }

        val intent = Intent(context, PairingApprovalActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK
            putExtra(PairingApprovalActivity.EXTRA_TOKEN, token)
            putExtra(PairingApprovalActivity.EXTRA_INSTALL_ID, installId)
            putExtra(PairingApprovalActivity.EXTRA_EXTENSION_ID, extensionId)
            putExtra(PairingApprovalActivity.EXTRA_IS_REPLACE, isReplace)
        }
        context.startActivity(intent)
    }
```

---

## Phase 5: Android - MainActivity Cleanup

### 5.1 Update MainActivity.kt

Remove token handling from intent - launch only starts the app.

**File:** `android-io-daemon/app/src/main/java/com/jstorrent/app/MainActivity.kt`

**Replace `handleIntent()` method (lines 69-98) with:**

```kotlin
    private fun handleIntent() {
        val uri = intent?.data ?: return
        Log.d(TAG, "Received intent: $uri")

        when {
            uri.scheme == "jstorrent" && uri.host == "launch" -> {
                Log.i(TAG, "Launch intent - app started")
            }
            uri.scheme == "jstorrent" && uri.host == "pair" -> {
                // Pairing happens via HTTP POST /pair, not via intent
                Log.i(TAG, "Pair intent - ignored, use POST /pair")
            }
            uri.scheme == "magnet" -> {
                Log.i(TAG, "Magnet link: $uri")
                // TODO: Forward to extension
            }
        }
    }
```

---

## Phase 6: Android - WebSocket AUTH Update

### 6.1 Update SocketHandler.kt

Update AUTH frame to include extensionId and installId.

**File:** `android-io-daemon/app/src/main/java/com/jstorrent/app/server/SocketHandler.kt`

**Update `handlePreAuth` method, replace the `Protocol.OP_AUTH` case (around line 97):**

```kotlin
            Protocol.OP_AUTH -> {
                if (payload.isEmpty()) {
                    sendError(envelope.requestId, "Invalid auth payload")
                    return
                }

                // Parse AUTH payload: authType(1) + token + \0 + extensionId + \0 + installId
                val authType = payload[0]
                val payloadStr = String(payload, 1, payload.size - 1)
                val parts = payloadStr.split('\u0000')
                
                if (parts.size < 3) {
                    sendError(envelope.requestId, "Invalid auth payload format")
                    return
                }
                
                val token = parts[0]
                val extensionId = parts[1]
                val installId = parts[2]

                val storedToken = tokenStore.token
                if (storedToken != null && 
                    token == storedToken &&
                    tokenStore.isPairedWith(extensionId, installId)) {
                    authenticated = true
                    send(Protocol.createMessage(Protocol.OP_AUTH_RESULT, envelope.requestId, byteArrayOf(0)))
                    Log.i(TAG, "WebSocket authenticated")
                    httpServer.registerControlSession(this@SocketSession)
                } else {
                    val errorMsg = "Invalid credentials".toByteArray()
                    send(Protocol.createMessage(Protocol.OP_AUTH_RESULT, envelope.requestId, byteArrayOf(1) + errorMsg))
                    Log.w(TAG, "WebSocket auth failed: token=${token == storedToken}, paired=${tokenStore.isPairedWith(extensionId, installId)}")
                }
            }
```

---

## Phase 7: Android Unit Tests

### 7.1 Create TokenStoreTest.kt

**File:** `android-io-daemon/app/src/test/java/com/jstorrent/app/auth/TokenStoreTest.kt`

**Create new file:**

```kotlin
package com.jstorrent.app.auth

import android.content.Context
import android.content.SharedPreferences
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.mockito.kotlin.any
import org.mockito.kotlin.doAnswer
import org.mockito.kotlin.doReturn
import org.mockito.kotlin.mock

/**
 * Unit tests for TokenStore pairing logic.
 * Critical security tests - isPairedWith must check BOTH extensionId AND installId.
 */
class TokenStoreTest {

    private lateinit var tokenStore: TokenStore
    private val prefsMap = mutableMapOf<String, String?>()

    @Before
    fun setup() {
        prefsMap.clear()

        val mockEditor = mock<SharedPreferences.Editor> {
            on { putString(any(), any()) } doAnswer { invocation ->
                prefsMap[invocation.getArgument(0)] = invocation.getArgument(1)
                it.mock
            }
            on { remove(any()) } doAnswer { invocation ->
                prefsMap.remove(invocation.getArgument<String>(0))
                it.mock
            }
            on { apply() } doAnswer { }
        }

        val mockPrefs = mock<SharedPreferences> {
            on { getString(any(), any()) } doAnswer { invocation ->
                prefsMap[invocation.getArgument<String>(0)] ?: invocation.getArgument(1)
            }
            on { edit() } doReturn mockEditor
        }

        val mockContext = mock<Context> {
            on { getSharedPreferences(any(), any()) } doReturn mockPrefs
        }

        tokenStore = TokenStore(mockContext)
    }

    // =========================================================================
    // hasToken tests
    // =========================================================================

    @Test
    fun `hasToken returns false when no token stored`() {
        assertFalse(tokenStore.hasToken())
    }

    @Test
    fun `hasToken returns true after pairing`() {
        tokenStore.pair("token123", "install456", "ext789")
        assertTrue(tokenStore.hasToken())
    }

    @Test
    fun `hasToken returns false after clear`() {
        tokenStore.pair("token123", "install456", "ext789")
        tokenStore.clear()
        assertFalse(tokenStore.hasToken())
    }

    // =========================================================================
    // isPairedWith tests - SECURITY CRITICAL
    // =========================================================================

    @Test
    fun `isPairedWith returns false when not paired`() {
        assertFalse(tokenStore.isPairedWith("ext789", "install456"))
    }

    @Test
    fun `isPairedWith returns true when both extensionId and installId match`() {
        tokenStore.pair("token123", "install456", "ext789")
        assertTrue(tokenStore.isPairedWith("ext789", "install456"))
    }

    @Test
    fun `isPairedWith returns false when extensionId differs`() {
        tokenStore.pair("token123", "install456", "ext789")
        assertFalse(tokenStore.isPairedWith("DIFFERENT_EXT", "install456"))
    }

    @Test
    fun `isPairedWith returns false when installId differs`() {
        tokenStore.pair("token123", "install456", "ext789")
        assertFalse(tokenStore.isPairedWith("ext789", "DIFFERENT_INSTALL"))
    }

    @Test
    fun `isPairedWith returns false when both differ`() {
        tokenStore.pair("token123", "install456", "ext789")
        assertFalse(tokenStore.isPairedWith("DIFFERENT_EXT", "DIFFERENT_INSTALL"))
    }

    @Test
    fun `isPairedWith returns false after clear`() {
        tokenStore.pair("token123", "install456", "ext789")
        tokenStore.clear()
        assertFalse(tokenStore.isPairedWith("ext789", "install456"))
    }

    // =========================================================================
    // pair tests
    // =========================================================================

    @Test
    fun `pair stores all three values`() {
        tokenStore.pair("myToken", "myInstall", "myExt")

        assertEquals("myToken", tokenStore.token)
        assertEquals("myInstall", tokenStore.installId)
        assertEquals("myExt", tokenStore.extensionId)
    }

    @Test
    fun `pair overwrites existing values`() {
        tokenStore.pair("token1", "install1", "ext1")
        tokenStore.pair("token2", "install2", "ext2")

        assertEquals("token2", tokenStore.token)
        assertEquals("install2", tokenStore.installId)
        assertEquals("ext2", tokenStore.extensionId)
    }

    // =========================================================================
    // clear tests
    // =========================================================================

    @Test
    fun `clear removes all values`() {
        tokenStore.pair("token", "install", "ext")
        tokenStore.clear()

        assertNull(tokenStore.token)
        assertNull(tokenStore.installId)
        assertNull(tokenStore.extensionId)
    }
}
```

### 7.2 Create OriginCheckMiddlewareTest.kt

**File:** `android-io-daemon/app/src/test/java/com/jstorrent/app/server/OriginCheckMiddlewareTest.kt`

**Create new file:**

```kotlin
package com.jstorrent.app.server

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Unit tests for origin validation and header extraction.
 * Tests pure validation logic without Ktor dependencies.
 */
class OriginCheckMiddlewareTest {

    // =========================================================================
    // Origin validation tests - SECURITY CRITICAL
    // =========================================================================

    @Test
    fun `valid chrome extension origin is accepted`() {
        assertTrue(isValidExtensionOrigin("chrome-extension://abcdefghijklmnop"))
    }

    @Test
    fun `valid chrome extension origin with long ID is accepted`() {
        assertTrue(isValidExtensionOrigin("chrome-extension://abcdefghijklmnopqrstuvwxyz123456"))
    }

    @Test
    fun `null origin is rejected`() {
        assertFalse(isValidExtensionOrigin(null))
    }

    @Test
    fun `empty origin is rejected`() {
        assertFalse(isValidExtensionOrigin(""))
    }

    @Test
    fun `http localhost origin is rejected`() {
        assertFalse(isValidExtensionOrigin("http://localhost"))
    }

    @Test
    fun `http localhost with port is rejected`() {
        assertFalse(isValidExtensionOrigin("http://localhost:8080"))
    }

    @Test
    fun `https origin is rejected`() {
        assertFalse(isValidExtensionOrigin("https://evil.com"))
    }

    @Test
    fun `http 127-0-0-1 origin is rejected`() {
        assertFalse(isValidExtensionOrigin("http://127.0.0.1"))
    }

    @Test
    fun `moz-extension origin is rejected`() {
        assertFalse(isValidExtensionOrigin("moz-extension://abc123"))
    }

    @Test
    fun `chrome-extension prefix without proper format is rejected`() {
        assertFalse(isValidExtensionOrigin("chrome-extension-fake://abc"))
    }

    @Test
    fun `origin containing chrome-extension but not starting with it is rejected`() {
        assertFalse(isValidExtensionOrigin("https://chrome-extension://abc"))
    }

    // =========================================================================
    // Header extraction tests
    // =========================================================================

    @Test
    fun `extracts valid headers`() {
        val headers = extractExtensionHeaders(
            extensionId = "ext123",
            installId = "install456"
        )

        assertEquals("ext123", headers?.extensionId)
        assertEquals("install456", headers?.installId)
    }

    @Test
    fun `returns null when extensionId is null`() {
        val headers = extractExtensionHeaders(
            extensionId = null,
            installId = "install456"
        )
        assertNull(headers)
    }

    @Test
    fun `returns null when installId is null`() {
        val headers = extractExtensionHeaders(
            extensionId = "ext123",
            installId = null
        )
        assertNull(headers)
    }

    @Test
    fun `returns null when extensionId is blank`() {
        val headers = extractExtensionHeaders(
            extensionId = "   ",
            installId = "install456"
        )
        assertNull(headers)
    }

    @Test
    fun `returns null when installId is blank`() {
        val headers = extractExtensionHeaders(
            extensionId = "ext123",
            installId = ""
        )
        assertNull(headers)
    }

    @Test
    fun `returns null when both are null`() {
        val headers = extractExtensionHeaders(
            extensionId = null,
            installId = null
        )
        assertNull(headers)
    }

    // =========================================================================
    // Test helpers - mirror the validation logic
    // =========================================================================

    private fun isValidExtensionOrigin(origin: String?): Boolean {
        return origin != null && origin.startsWith("chrome-extension://")
    }

    private fun extractExtensionHeaders(
        extensionId: String?,
        installId: String?
    ): ExtensionHeaders? {
        if (extensionId.isNullOrBlank() || installId.isNullOrBlank()) {
            return null
        }
        return ExtensionHeaders(extensionId, installId)
    }
}
```

### 7.3 Create WebSocketAuthTest.kt

**File:** `android-io-daemon/app/src/test/java/com/jstorrent/app/server/WebSocketAuthTest.kt`

**Create new file:**

```kotlin
package com.jstorrent.app.server

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Unit tests for WebSocket AUTH frame parsing.
 * Tests the payload format: authType(1) + token + \0 + extensionId + \0 + installId
 */
class WebSocketAuthTest {

    // =========================================================================
    // AUTH payload parsing tests
    // =========================================================================

    @Test
    fun `parses valid AUTH payload`() {
        val payload = buildAuthPayload("myToken", "myExtId", "myInstallId")
        val parsed = parseAuthPayload(payload)

        assertEquals("myToken", parsed?.token)
        assertEquals("myExtId", parsed?.extensionId)
        assertEquals("myInstallId", parsed?.installId)
    }

    @Test
    fun `parses AUTH payload with empty token`() {
        val payload = buildAuthPayload("", "extId", "installId")
        val parsed = parseAuthPayload(payload)

        assertEquals("", parsed?.token)
        assertEquals("extId", parsed?.extensionId)
        assertEquals("installId", parsed?.installId)
    }

    @Test
    fun `returns null for empty payload`() {
        val parsed = parseAuthPayload(byteArrayOf())
        assertNull(parsed)
    }

    @Test
    fun `returns null for payload with only authType`() {
        val parsed = parseAuthPayload(byteArrayOf(0))
        assertNull(parsed)
    }

    @Test
    fun `returns null for payload missing installId`() {
        // authType + "token" + \0 + "extId" (no second null, no installId)
        val payload = byteArrayOf(0) + "token".toByteArray() + byteArrayOf(0) + "extId".toByteArray()
        val parsed = parseAuthPayload(payload)
        assertNull(parsed)
    }

    @Test
    fun `returns null for payload with only one null separator`() {
        // authType + "token" + \0 + "extIdinstallId" (missing second separator)
        val payload = byteArrayOf(0) + "token".toByteArray() + byteArrayOf(0) + "extIdinstallId".toByteArray()
        val parsed = parseAuthPayload(payload)
        assertNull(parsed)
    }

    @Test
    fun `handles special characters in token`() {
        val token = "token-with-special_chars.123"
        val payload = buildAuthPayload(token, "ext", "install")
        val parsed = parseAuthPayload(payload)

        assertEquals(token, parsed?.token)
    }

    @Test
    fun `handles UUID format values`() {
        val token = "550e8400-e29b-41d4-a716-446655440000"
        val extId = "abcdefghijklmnopqrstuvwxyz123456"
        val installId = "660e8400-f39c-52e5-b827-557766551111"

        val payload = buildAuthPayload(token, extId, installId)
        val parsed = parseAuthPayload(payload)

        assertEquals(token, parsed?.token)
        assertEquals(extId, parsed?.extensionId)
        assertEquals(installId, parsed?.installId)
    }

    // =========================================================================
    // Test helpers - mirror the parsing logic
    // =========================================================================

    data class AuthCredentials(
        val token: String,
        val extensionId: String,
        val installId: String
    )

    private fun buildAuthPayload(token: String, extensionId: String, installId: String): ByteArray {
        val tokenBytes = token.toByteArray(Charsets.UTF_8)
        val extBytes = extensionId.toByteArray(Charsets.UTF_8)
        val installBytes = installId.toByteArray(Charsets.UTF_8)

        return byteArrayOf(0) + // authType
            tokenBytes +
            byteArrayOf(0) + // separator
            extBytes +
            byteArrayOf(0) + // separator
            installBytes
    }

    private fun parseAuthPayload(payload: ByteArray): AuthCredentials? {
        if (payload.isEmpty()) return null

        val payloadStr = String(payload, 1, payload.size - 1, Charsets.UTF_8)
        val parts = payloadStr.split('\u0000')

        if (parts.size < 3) return null

        return AuthCredentials(
            token = parts[0],
            extensionId = parts[1],
            installId = parts[2]
        )
    }
}
```

### 7.4 Add mockito-kotlin dependency

**File:** `android-io-daemon/app/build.gradle.kts`

**Find the dependencies block and add:**

```kotlin
    testImplementation("org.mockito.kotlin:mockito-kotlin:5.2.1")
```

### 7.5 Run tests

```bash
cd android-io-daemon
./gradlew test
```

Verify all tests pass, especially the security-critical `isPairedWith` tests.

---

## Phase 8: Extension - DaemonBridge Updates

### 7.1 Update daemon-bridge.ts

**File:** `extension/src/lib/daemon-bridge.ts`

**Replace `triggerLaunch()` method (lines 140-163) with:**

```typescript
  /**
   * Trigger Android app launch (ChromeOS only).
   * Opens launch intent then polls for daemon and initiates pairing.
   */
  async triggerLaunch(): Promise<boolean> {
    if (this.state.platform !== 'chromeos') return false

    try {
      // Launch intent - just starts the app, no token
      const intentUrl = 'intent://launch#Intent;scheme=jstorrent;package=com.jstorrent.app;end'

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tab?.id) {
        await chrome.tabs.update(tab.id, { url: intentUrl })
      } else {
        await chrome.tabs.create({ url: intentUrl })
      }

      this.updateState({ status: 'connecting', lastError: null })
      this.waitForDaemonAndPair()

      return true
    } catch (e) {
      console.error('[DaemonBridge] Failed to trigger launch:', e)
      return false
    }
  }

  /**
   * Wait for daemon to become reachable after launch, then pair if needed.
   */
  private async waitForDaemonAndPair(): Promise<void> {
    const maxWaitAttempts = 30 // 30s to wait for daemon to start
    const pollInterval = 1000

    // Phase 1: Wait for daemon to become reachable
    let port: number | null = null
    for (let i = 0; i < maxWaitAttempts; i++) {
      port = await this.findDaemonPort()
      if (port) break
      await new Promise((r) => setTimeout(r, pollInterval))
    }

    if (!port) {
      this.updateState({
        status: 'disconnected',
        lastError: 'Android app did not start',
      })
      return
    }

    // Phase 2: Check status and pair if needed
    await this.checkStatusAndPair(port)
  }

  /**
   * Check pairing status and initiate pairing flow if needed.
   */
  private async checkStatusAndPair(port: number): Promise<void> {
    const installId = await getOrCreateInstallId()
    const extensionId = chrome.runtime.id
    
    const status = await this.fetchStatus(port)

    // Already paired with us?
    if (status.paired && status.extensionId === extensionId && status.installId === installId) {
      console.log('[DaemonBridge] Already paired, connecting...')
      await this.completeConnection(port)
      return
    }

    // Need to pair - POST /pair
    const pairResult = await this.requestPairing(port)

    if (pairResult === 'approved') {
      await this.completeConnection(port)
      return
    }

    if (pairResult === 'conflict') {
      // Dialog already showing, wait and retry
      await new Promise((r) => setTimeout(r, 2000))
      await this.checkStatusAndPair(port)
      return
    }

    // pairResult === 'pending' - poll until paired
    await this.pollForPairing(port)
  }

  /**
   * Poll /status until pairing completes or times out.
   */
  private async pollForPairing(port: number): Promise<void> {
    const maxPollAttempts = 60 // 60s for user to approve
    const pollInterval = 1000
    const installId = await getOrCreateInstallId()
    const extensionId = chrome.runtime.id

    for (let i = 0; i < maxPollAttempts; i++) {
      await new Promise((r) => setTimeout(r, pollInterval))

      try {
        const status = await this.fetchStatus(port)
        if (status.paired && status.extensionId === extensionId && status.installId === installId) {
          console.log('[DaemonBridge] Pairing approved')
          await this.completeConnection(port)
          return
        }
      } catch {
        // Keep polling
      }
    }

    this.updateState({
      status: 'disconnected',
      lastError: 'Pairing timed out',
    })
  }
```

**Remove the old `pollForConnection()` method (lines 168-208).**

**Add helper methods after the new methods above:**

```typescript
  /**
   * Build standard headers for all HTTP requests.
   */
  private async buildHeaders(includeAuth: boolean = false): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      'X-JST-ExtensionId': chrome.runtime.id,
      'X-JST-InstallId': await getOrCreateInstallId(),
    }
    if (includeAuth) {
      const token = await this.getOrCreateToken()
      headers['X-JST-Auth'] = token
    }
    return headers
  }

  /**
   * Fetch status from daemon.
   */
  private async fetchStatus(port: number): Promise<{
    port: number
    paired: boolean
    extensionId: string | null
    installId: string | null
  }> {
    const headers = await this.buildHeaders()
    const response = await fetch(`http://100.115.92.2:${port}/status`, { headers })
    if (!response.ok) throw new Error(`Status failed: ${response.status}`)
    return response.json()
  }

  /**
   * Request pairing via POST /pair.
   * Returns 'approved', 'pending', or 'conflict'.
   */
  private async requestPairing(port: number): Promise<'approved' | 'pending' | 'conflict'> {
    const token = await this.getOrCreateToken()
    const headers = await this.buildHeaders()
    headers['Content-Type'] = 'application/json'

    try {
      const response = await fetch(`http://100.115.92.2:${port}/pair`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ token }),
      })

      if (response.ok) {
        const data = (await response.json()) as { status: string }
        return data.status as 'approved' | 'pending'
      } else if (response.status === 409) {
        return 'conflict'
      }
      return 'pending'
    } catch {
      return 'pending'
    }
  }

  /**
   * Complete connection after pairing confirmed.
   */
  private async completeConnection(port: number): Promise<void> {
    const token = await this.getOrCreateToken()
    const headers = await this.buildHeaders(true)
    
    // Fetch roots with auth
    const rootsResponse = await fetch(`http://100.115.92.2:${port}/roots`, { headers })
    const rootsData = (await rootsResponse.json()) as { roots: DownloadRoot[] }
    const roots = rootsData.roots || []

    // Connect WebSocket
    await this.connectWebSocket(port, token)

    this.updateState({
      status: 'connected',
      daemonInfo: { port, token, version: 1, roots, host: '100.115.92.2' },
      roots,
      lastError: null,
    })

    await chrome.storage.local.set({ [STORAGE_KEY_HAS_CONNECTED]: true })
    this.startHealthCheck(port)
    console.log('[DaemonBridge] Connected successfully')
  }
```

**Update `connectChromeos()` method (lines 341-367):**

```typescript
  private async connectChromeos(): Promise<void> {
    const port = await this.findDaemonPort()
    if (!port) {
      throw new Error('Android daemon not reachable')
    }

    const installId = await getOrCreateInstallId()
    const extensionId = chrome.runtime.id
    const status = await this.fetchStatus(port)

    // Already paired with us? Try connecting
    if (status.paired && status.extensionId === extensionId && status.installId === installId) {
      await this.completeConnection(port)
      return
    }

    // Need to pair
    throw new Error('Not paired - use triggerLaunch()')
  }
```

**Update `connectWebSocket()` to include extensionId and installId in AUTH frame (around line 390):**

```typescript
      ws.onmessage = (event) => {
        const data = new Uint8Array(event.data as ArrayBuffer)
        const opcode = data[1]

        if (opcode === 0x02) {
          // SERVER_HELLO - send AUTH with token + extensionId + installId
          const encoder = new TextEncoder()
          const tokenBytes = encoder.encode(token)
          const extensionIdBytes = encoder.encode(chrome.runtime.id)
          const installIdBytes = encoder.encode(installId)
          const nul = new Uint8Array([0])
          
          // Format: authType(1) + token + \0 + extensionId + \0 + installId
          const authPayload = new Uint8Array(
            1 + tokenBytes.length + 1 + extensionIdBytes.length + 1 + installIdBytes.length
          )
          authPayload[0] = 0 // authType
          authPayload.set(tokenBytes, 1)
          authPayload.set(nul, 1 + tokenBytes.length)
          authPayload.set(extensionIdBytes, 1 + tokenBytes.length + 1)
          authPayload.set(nul, 1 + tokenBytes.length + 1 + extensionIdBytes.length)
          authPayload.set(installIdBytes, 1 + tokenBytes.length + 1 + extensionIdBytes.length + 1)
          
          ws.send(this.buildFrame(0x03, 0, authPayload))
        } else if (opcode === 0x04) {
```

Note: You'll need to capture `installId` at the start of `connectWebSocket`. Add this at the beginning of the method:

```typescript
  private async connectWebSocket(port: number, token: string): Promise<void> {
    const installId = await getOrCreateInstallId()
    
    return new Promise((resolve, reject) => {
      // ... rest of method
```

**Update `fetchRoots()` to use buildHeaders (around line 549):**

```typescript
  private async fetchRoots(port: number, token: string): Promise<DownloadRoot[]> {
    try {
      const headers = await this.buildHeaders(true)
      const response = await fetch(`http://100.115.92.2:${port}/roots`, { headers })

      if (!response.ok) return []

      const data = (await response.json()) as {
        roots: Array<{
          key: string
          uri: string
          display_name?: string
          displayName?: string
          removable: boolean
          last_stat_ok?: boolean
          lastStatOk?: boolean
          last_checked?: number
          lastChecked?: number
        }>
      }

      return data.roots.map((r) => ({
        key: r.key,
        path: r.uri,
        display_name: r.display_name || r.displayName || '',
        removable: r.removable,
        last_stat_ok: r.last_stat_ok ?? r.lastStatOk ?? true,
        last_checked: r.last_checked ?? r.lastChecked ?? Date.now(),
      }))
    } catch {
      return []
    }
  }
```

**Remove `checkPaired()` method - no longer needed, replaced by `fetchStatus()`.**

---

## Phase 9: Verification

### 9.1 Build Android App

```bash
cd android-io-daemon
./gradlew assembleDebug
```

### 9.2 Build Extension

```bash
cd extension
pnpm build
```

### 9.3 Manual Testing on ChromeOS

1. Install Android app
2. Load extension
3. Open extension UI → triggers launch intent
4. Verify app opens and shows pairing dialog
5. Click Allow
6. Verify connection completes
7. Close and reopen extension
8. Verify silent reconnection (no dialog)
9. Clear extension data (new installId)
10. Verify "Replace?" dialog appears

### 9.4 Verify Desktop Unchanged

Desktop flow uses native messaging, no changes should affect it.

---

## Files Summary

**Android - New:**
- `server/OriginCheckMiddleware.kt` - Origin validation + header extraction
- `PairingApprovalActivity.kt` - Pairing approval UI

**Android - New Tests:**
- `auth/TokenStoreTest.kt` - isPairedWith security tests
- `server/OriginCheckMiddlewareTest.kt` - Origin validation tests
- `server/WebSocketAuthTest.kt` - AUTH frame parsing tests

**Android - Modified:**
- `auth/TokenStore.kt` - Add installId, extensionId
- `server/HttpServer.kt` - Add POST /pair, update /status, add origin checks
- `server/SocketHandler.kt` - Update AUTH to verify extensionId/installId
- `MainActivity.kt` - Remove token from intent handling
- `AndroidManifest.xml` - Register PairingApprovalActivity
- `build.gradle.kts` - Add mockito-kotlin test dependency

**Extension - Modified:**
- `lib/daemon-bridge.ts` - New pairing flow, consistent headers, updated WebSocket AUTH
