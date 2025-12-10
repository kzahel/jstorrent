# Secure Android Pairing Flow - Agent Guide

## Implementation Status

**Phases 1-8 are already implemented.** Agents should start at **Phase 9** which adds:
- Separate `/control` WebSocket endpoint (for DaemonBridge control plane)
- Credentials getter pattern (for DaemonConnection to fetch fresh auth at connect time)

Phases 1-8 are retained below as reference for the existing implementation.

---

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
| `/status` | POST | Yes | No | Headers only | `{port, paired, extensionId, installId}` |
| `/pair` | POST | Yes | No | Body: `{token}` | 200 / 202 / 409 |
| `/roots` | GET | No | Yes | `X-JST-Auth` header | `{roots:[...]}` |
| `/read/{root}` | GET | No | Yes | `X-JST-Auth` header | bytes |
| `/write/{root}` | POST | No | Yes | `X-JST-Auth` header | status |
| `/hash/sha1` | POST | No | Yes | `X-JST-Auth` header | bytes |
| `/io` | WebSocket | No | Yes | AUTH frame: `{token, extensionId, installId}` | AUTH_RESULT |
| `/control` | WebSocket | No | Yes | AUTH frame: `{token, extensionId, installId}` | AUTH_RESULT |

**Origin check:** Validates `Origin` header starts with `chrome-extension://`

**Note:** `/status` uses POST (not GET) because Chrome service workers don't send `Origin` headers on GET requests.

**POST /pair responses:**
- `200 OK` - Same extensionId AND installId, token updated silently (no dialog)
- `202 Accepted` - Dialog shown, extension should poll `/status`
- `409 Conflict` - Dialog already showing for another request, back off and poll

### Connection Flow

**Initial pairing:**
```
Extension                          Android
    |                                  |
    |------ POST /status ------------->|  (headers: ExtensionId, InstallId)
    |<------ {paired:false} -----------|
    |                                  |
    |------- POST /pair -------------->|  (headers + body: {token})
    |<------ 202 Accepted -------------|
    |                                  |  [dialog shows]
    |------ POST /status (poll) ------>|
    |<------ {paired:false} -----------|
    |          ...                     |  [user clicks Allow]
    |------ POST /status ------------->|
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
    |------ POST /status ------------->|
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
    |------ POST /status ------------->|
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
            // Uses POST because service workers don't send Origin on GET
            post("/status") {
                if (!call.requireExtensionOrigin()) return@post
                val headers = call.getExtensionHeaders() ?: return@post
                
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

### 8.1 Update daemon-bridge.ts

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
    const response = await fetch(`http://100.115.92.2:${port}/status`, {
      method: 'POST',  // POST required - service workers don't send Origin on GET
      headers,
    })
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

## Phase 9: Separate /control Endpoint and Credentials Getter

### Background

There are two WebSocket connections to the Android daemon:
1. **DaemonBridge** (service worker) - control plane: pairing, health checks, ROOTS_CHANGED
2. **DaemonConnection** (engine/UI) - I/O plane: TCP/UDP sockets, file read/write

This mirrors desktop which has native messaging (control) + WebSocket (I/O).

Currently both connect to `/io`, causing confusion and the AUTH format mismatch. We'll separate them:
- `/control` - for DaemonBridge, only control opcodes
- `/io` - for DaemonConnection, only I/O opcodes

Additionally, we'll use a credentials getter pattern so DaemonConnection fetches fresh credentials at connection time.

### 9.1 Update Protocol.kt - Add Opcode Sets

**File:** `android-io-daemon/app/src/main/java/com/jstorrent/app/server/Protocol.kt`

**Add after the opcode constants (after line 36):**

```kotlin
    // Opcode sets for route validation
    val HANDSHAKE_OPCODES = setOf(
        OP_CLIENT_HELLO, OP_SERVER_HELLO, OP_AUTH, OP_AUTH_RESULT, OP_ERROR
    )

    val IO_OPCODES = HANDSHAKE_OPCODES + setOf(
        OP_TCP_CONNECT, OP_TCP_CONNECTED, OP_TCP_SEND, OP_TCP_RECV, OP_TCP_CLOSE,
        OP_UDP_BIND, OP_UDP_BOUND, OP_UDP_SEND, OP_UDP_RECV, OP_UDP_CLOSE
    )

    val CONTROL_OPCODES = HANDSHAKE_OPCODES + setOf(
        OP_CTRL_ROOTS_CHANGED, OP_CTRL_EVENT
    )
```

### 9.2 Update SocketHandler.kt - Add Session Type

**File:** `android-io-daemon/app/src/main/java/com/jstorrent/app/server/SocketHandler.kt`

**Add enum after imports:**

```kotlin
enum class SessionType {
    IO,      // /io endpoint - socket operations
    CONTROL  // /control endpoint - control broadcasts
}
```

**Update SocketSession class signature to accept session type:**

```kotlin
class SocketSession(
    private val wsSession: DefaultWebSocketServerSession,
    private val tokenStore: TokenStore,
    private val httpServer: HttpServer,
    private val sessionType: SessionType
) {
```

**Add opcode validation in handleMessage (after envelope parsing, around line 77):**

```kotlin
        // Validate opcode is allowed for this session type
        val allowedOpcodes = when (sessionType) {
            SessionType.IO -> Protocol.IO_OPCODES
            SessionType.CONTROL -> Protocol.CONTROL_OPCODES
        }
        if (envelope.opcode !in allowedOpcodes) {
            Log.w(TAG, "Opcode 0x${envelope.opcode.toString(16)} not allowed on ${sessionType.name} endpoint")
            sendError(envelope.requestId, "Opcode not allowed on this endpoint")
            return
        }
```

**Update registerControlSession call to only register CONTROL sessions (in handlePreAuth OP_AUTH success block):**

```kotlin
                if (storedToken != null &&
                    token == storedToken &&
                    tokenStore.isPairedWith(extensionId, installId)
                ) {
                    authenticated = true
                    send(Protocol.createMessage(Protocol.OP_AUTH_RESULT, envelope.requestId, byteArrayOf(0)))
                    Log.i(TAG, "WebSocket authenticated (${sessionType.name})")
                    
                    // Only register control sessions for broadcasts
                    if (sessionType == SessionType.CONTROL) {
                        httpServer.registerControlSession(this@SocketSession)
                    }
                }
```

### 9.3 Update HttpServer.kt - Add /control Route

**File:** `android-io-daemon/app/src/main/java/com/jstorrent/app/server/HttpServer.kt`

**Find the existing `/io` WebSocket route and add `/control` route after it:**

```kotlin
            // WebSocket endpoint for I/O operations (sockets, files)
            webSocket("/io") {
                Log.i(TAG, "WebSocket /io connected")
                val session = SocketSession(this, tokenStore, this@HttpServer, SessionType.IO)
                session.run()
                Log.i(TAG, "WebSocket /io disconnected")
            }

            // WebSocket endpoint for control plane (roots, events)
            webSocket("/control") {
                Log.i(TAG, "WebSocket /control connected")
                val session = SocketSession(this, tokenStore, this@HttpServer, SessionType.CONTROL)
                session.run()
                Log.i(TAG, "WebSocket /control disconnected")
            }
```

**Update the existing `/io` route to pass SessionType.IO:**

```kotlin
            webSocket("/io") {
                Log.i(TAG, "WebSocket /io connected")
                val session = SocketSession(this, tokenStore, this@HttpServer, SessionType.IO)
                session.run()
                Log.i(TAG, "WebSocket /io disconnected")
            }
```

### 9.4 Update DaemonBridge - Use /control

**File:** `extension/src/lib/daemon-bridge.ts`

**Find `connectWebSocket` method and change the URL from `/io` to `/control`:**

```typescript
  private async connectWebSocket(port: number, token: string): Promise<void> {
    const installId = await getOrCreateInstallId()

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://100.115.92.2:${port}/control`)  // Changed from /io
      ws.binaryType = 'arraybuffer'
```

### 9.5 Update DaemonConnection - Credentials Getter Pattern

**File:** `packages/engine/src/adapters/daemon/daemon-connection.ts`

**Define credentials type and update constructor:**

```typescript
export interface DaemonCredentials {
  token: string
  extensionId: string
  installId: string
}

export type CredentialsGetter = () => Promise<DaemonCredentials>

export interface IDaemonConnection {
  connect(info: { port: number; token: string }): Promise<void>
  sendFrame(frame: ArrayBuffer): void
  onFrame(cb: (frame: ArrayBuffer) => void): void
  close(): void
  readonly ready: boolean
}

export class DaemonConnection {
  private baseUrl: string
  private ws: WebSocket | null = null
  private frameHandlers: Array<(f: ArrayBuffer) => void> = []
  public ready = false

  // Cached credentials for HTTP requests
  private cachedCredentials: DaemonCredentials | null = null

  // Opcodes
  private static readonly OP_CLIENT_HELLO = 0x01
  private static readonly OP_SERVER_HELLO = 0x02
  private static readonly OP_AUTH = 0x03
  private static readonly OP_AUTH_RESULT = 0x04
  private static readonly OP_ERROR = 0x7f
  private static readonly PROTOCOL_VERSION = 1

  constructor(
    private port: number,
    private host: string = '127.0.0.1',
    private getCredentials?: CredentialsGetter,
    // Legacy: direct token for desktop compatibility
    private legacyToken?: string,
  ) {
    this.baseUrl = `http://${host}:${port}`
  }

  // Legacy static factory for backwards compatibility
  static async connect(
    port: number,
    authToken: string,
    host: string = '127.0.0.1',
  ): Promise<DaemonConnection> {
    const connection = new DaemonConnection(port, host, undefined, authToken)
    return connection
  }
```

**Update connectWebSocket to use credentials getter:**

```typescript
  async connectWebSocket(): Promise<void> {
    if (this.ready) return

    // Get fresh credentials
    let token: string
    let extensionId: string
    let installId: string

    if (this.getCredentials) {
      const creds = await this.getCredentials()
      this.cachedCredentials = creds
      token = creds.token
      extensionId = creds.extensionId
      installId = creds.installId
    } else if (this.legacyToken) {
      // Desktop mode - token only
      token = this.legacyToken
      extensionId = ''
      installId = ''
    } else {
      throw new Error('No credentials available')
    }

    const url = `ws://${this.host}:${this.port}/io`
    this.ws = new WebSocket(url)
    this.ws.binaryType = 'arraybuffer'

    await new Promise<void>((resolve, reject) => {
      this.ws!.onopen = () => resolve()
      this.ws!.onerror = (_err) => reject(new Error('WebSocket connection failed'))
    })

    // 1. Send CLIENT_HELLO
    this.sendFrameInternal(this.packEnvelope(DaemonConnection.OP_CLIENT_HELLO, 1))

    // 2. Wait for SERVER_HELLO
    await this.waitForOpcode(DaemonConnection.OP_SERVER_HELLO)

    // 3. Send AUTH with full credentials
    const encoder = new TextEncoder()
    const tokenBytes = encoder.encode(token)
    const extIdBytes = encoder.encode(extensionId)
    const installIdBytes = encoder.encode(installId)

    // Format: authType(1) + token + \0 + extensionId + \0 + installId
    const authPayload = new Uint8Array(
      1 + tokenBytes.length + 1 + extIdBytes.length + 1 + installIdBytes.length,
    )
    let offset = 0
    authPayload[offset++] = 0 // authType (0 = token auth, matches daemon-bridge.ts)
    authPayload.set(tokenBytes, offset)
    offset += tokenBytes.length
    authPayload[offset++] = 0 // null separator
    authPayload.set(extIdBytes, offset)
    offset += extIdBytes.length
    authPayload[offset++] = 0 // null separator
    authPayload.set(installIdBytes, offset)

    this.sendFrameInternal(this.packEnvelope(DaemonConnection.OP_AUTH, 2, authPayload))

    // 4. Wait for AUTH_RESULT
    const authResultFrame = await this.waitForOpcode(DaemonConnection.OP_AUTH_RESULT)
    const authResultPayload = this.unpackEnvelope(authResultFrame).payload

    if (authResultPayload.byteLength > 0 && authResultPayload[0] === 0) {
      this.ready = true
    } else {
      throw new Error('Daemon auth failed')
    }

    // Switch to normal message handling
    this.ws!.onmessage = (ev) => {
      const frame = ev.data as ArrayBuffer
      for (const h of this.frameHandlers) h(frame)
    }
  }
```

**Update HTTP request methods to use cached credentials:**

```typescript
  private getAuthToken(): string {
    if (this.cachedCredentials) {
      return this.cachedCredentials.token
    }
    if (this.legacyToken) {
      return this.legacyToken
    }
    throw new Error('No auth token available')
  }

  private getHttpHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'X-JST-Auth': this.getAuthToken(),
    }
    if (this.cachedCredentials) {
      headers['X-JST-ExtensionId'] = this.cachedCredentials.extensionId
      headers['X-JST-InstallId'] = this.cachedCredentials.installId
    }
    return headers
  }
```

**Update request methods to use getHttpHeaders():**

Replace `'X-JST-Auth': this.authToken` with `...this.getHttpHeaders()` in:
- `request()` method
- `requestBinary()` method
- `requestWithHeaders()` method

### 9.6 Update EngineManager - Pass Credentials Getter

**File:** `packages/client/src/chrome/engine-manager.ts`

**Add helper function before the class:**

```typescript
/**
 * Create credentials getter for DaemonConnection.
 * Reads fresh values from chrome.storage.local at connection time.
 */
function createCredentialsGetter(): CredentialsGetter {
  return async () => {
    const stored = await chrome.storage.local.get(['android:authToken', 'installId'])
    const token = stored['android:authToken']
    const installId = stored['installId']

    if (!token) {
      throw new Error('No auth token in storage')
    }

    return {
      token,
      extensionId: chrome.runtime.id,
      installId: installId || '',
    }
  }
}
```

**Update DaemonConnection creation (around line 118):**

```typescript
    // 2. Create direct WebSocket connection to daemon
    // On ChromeOS, use credentials getter for fresh token
    // On desktop, use token directly from daemon info
    const isChromeos = daemonInfo.host === '100.115.92.2'

    if (isChromeos) {
      this.daemonConnection = new DaemonConnection(
        daemonInfo.port,
        daemonInfo.host,
        createCredentialsGetter(),
      )
    } else {
      // Desktop - use legacy token directly
      this.daemonConnection = new DaemonConnection(
        daemonInfo.port,
        daemonInfo.host,
        undefined,
        daemonInfo.token,
      )
    }
```

**Add import for CredentialsGetter:**

```typescript
import {
  BtEngine,
  DaemonConnection,
  DaemonSocketFactory,
  DaemonFileSystem,
  DaemonHasher,
  StorageRootManager,
  ChromeStorageSessionStore,
  ExternalChromeStorageSessionStore,
  globalLogStore,
  LogStore,
  ISessionStore,
  Torrent,
  toHex,
  CredentialsGetter,  // Add this
} from '@jstorrent/engine'
```

### 9.7 Export CredentialsGetter from Engine Package

**File:** `packages/engine/src/index.ts`

**Add to exports:**

```typescript
export type { DaemonCredentials, CredentialsGetter } from './adapters/daemon/daemon-connection'
```

### 9.8 Create WebSocketRouteTest.kt

**File:** `android-io-daemon/app/src/test/java/com/jstorrent/app/server/WebSocketRouteTest.kt`

**Create new file:**

```kotlin
package com.jstorrent.app.server

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Unit tests for WebSocket route opcode validation.
 * Ensures /io and /control routes only accept their designated opcodes.
 */
class WebSocketRouteTest {

    // =========================================================================
    // IO route opcode tests
    // =========================================================================

    @Test
    fun `IO route accepts handshake opcodes`() {
        assertTrue(isOpcodeAllowedForIO(Protocol.OP_CLIENT_HELLO))
        assertTrue(isOpcodeAllowedForIO(Protocol.OP_SERVER_HELLO))
        assertTrue(isOpcodeAllowedForIO(Protocol.OP_AUTH))
        assertTrue(isOpcodeAllowedForIO(Protocol.OP_AUTH_RESULT))
        assertTrue(isOpcodeAllowedForIO(Protocol.OP_ERROR))
    }

    @Test
    fun `IO route accepts TCP opcodes`() {
        assertTrue(isOpcodeAllowedForIO(Protocol.OP_TCP_CONNECT))
        assertTrue(isOpcodeAllowedForIO(Protocol.OP_TCP_CONNECTED))
        assertTrue(isOpcodeAllowedForIO(Protocol.OP_TCP_SEND))
        assertTrue(isOpcodeAllowedForIO(Protocol.OP_TCP_RECV))
        assertTrue(isOpcodeAllowedForIO(Protocol.OP_TCP_CLOSE))
    }

    @Test
    fun `IO route accepts UDP opcodes`() {
        assertTrue(isOpcodeAllowedForIO(Protocol.OP_UDP_BIND))
        assertTrue(isOpcodeAllowedForIO(Protocol.OP_UDP_BOUND))
        assertTrue(isOpcodeAllowedForIO(Protocol.OP_UDP_SEND))
        assertTrue(isOpcodeAllowedForIO(Protocol.OP_UDP_RECV))
        assertTrue(isOpcodeAllowedForIO(Protocol.OP_UDP_CLOSE))
    }

    @Test
    fun `IO route rejects control opcodes`() {
        assertFalse(isOpcodeAllowedForIO(Protocol.OP_CTRL_ROOTS_CHANGED))
        assertFalse(isOpcodeAllowedForIO(Protocol.OP_CTRL_EVENT))
    }

    // =========================================================================
    // Control route opcode tests
    // =========================================================================

    @Test
    fun `Control route accepts handshake opcodes`() {
        assertTrue(isOpcodeAllowedForControl(Protocol.OP_CLIENT_HELLO))
        assertTrue(isOpcodeAllowedForControl(Protocol.OP_SERVER_HELLO))
        assertTrue(isOpcodeAllowedForControl(Protocol.OP_AUTH))
        assertTrue(isOpcodeAllowedForControl(Protocol.OP_AUTH_RESULT))
        assertTrue(isOpcodeAllowedForControl(Protocol.OP_ERROR))
    }

    @Test
    fun `Control route accepts control opcodes`() {
        assertTrue(isOpcodeAllowedForControl(Protocol.OP_CTRL_ROOTS_CHANGED))
        assertTrue(isOpcodeAllowedForControl(Protocol.OP_CTRL_EVENT))
    }

    @Test
    fun `Control route rejects TCP opcodes`() {
        assertFalse(isOpcodeAllowedForControl(Protocol.OP_TCP_CONNECT))
        assertFalse(isOpcodeAllowedForControl(Protocol.OP_TCP_CONNECTED))
        assertFalse(isOpcodeAllowedForControl(Protocol.OP_TCP_SEND))
        assertFalse(isOpcodeAllowedForControl(Protocol.OP_TCP_RECV))
        assertFalse(isOpcodeAllowedForControl(Protocol.OP_TCP_CLOSE))
    }

    @Test
    fun `Control route rejects UDP opcodes`() {
        assertFalse(isOpcodeAllowedForControl(Protocol.OP_UDP_BIND))
        assertFalse(isOpcodeAllowedForControl(Protocol.OP_UDP_BOUND))
        assertFalse(isOpcodeAllowedForControl(Protocol.OP_UDP_SEND))
        assertFalse(isOpcodeAllowedForControl(Protocol.OP_UDP_RECV))
        assertFalse(isOpcodeAllowedForControl(Protocol.OP_UDP_CLOSE))
    }

    // =========================================================================
    // Test helpers - mirror Protocol opcode sets
    // =========================================================================

    private val HANDSHAKE_OPCODES = setOf(
        Protocol.OP_CLIENT_HELLO,
        Protocol.OP_SERVER_HELLO,
        Protocol.OP_AUTH,
        Protocol.OP_AUTH_RESULT,
        Protocol.OP_ERROR
    )

    private val IO_OPCODES = HANDSHAKE_OPCODES + setOf(
        Protocol.OP_TCP_CONNECT, Protocol.OP_TCP_CONNECTED,
        Protocol.OP_TCP_SEND, Protocol.OP_TCP_RECV, Protocol.OP_TCP_CLOSE,
        Protocol.OP_UDP_BIND, Protocol.OP_UDP_BOUND,
        Protocol.OP_UDP_SEND, Protocol.OP_UDP_RECV, Protocol.OP_UDP_CLOSE
    )

    private val CONTROL_OPCODES = HANDSHAKE_OPCODES + setOf(
        Protocol.OP_CTRL_ROOTS_CHANGED,
        Protocol.OP_CTRL_EVENT
    )

    private fun isOpcodeAllowedForIO(opcode: Byte): Boolean = opcode in IO_OPCODES
    private fun isOpcodeAllowedForControl(opcode: Byte): Boolean = opcode in CONTROL_OPCODES
}
```

---

## Phase 10: Verification

### 10.1 Build Android App

```bash
cd android-io-daemon
./gradlew assembleDebug
```

### 10.2 Build Extension

```bash
cd extension
pnpm build
```

### 10.3 Run Unit Tests

```bash
cd android-io-daemon
./gradlew test
```

Verify all tests pass, especially:
- `TokenStoreTest` - isPairedWith security tests
- `OriginCheckMiddlewareTest` - origin validation
- `WebSocketAuthTest` - AUTH frame parsing
- `WebSocketRouteTest` - /io vs /control opcode restrictions

### 10.4 Manual Testing on ChromeOS

1. Install Android app
2. Load extension
3. Open extension UI → triggers launch intent
4. Verify app opens and shows pairing dialog
5. Click Allow
6. Verify connection completes
7. Add a torrent → verify download starts (tests /io WebSocket)
8. Check Android logs: should see both `/io` and `/control` connections
9. Add a download root → verify ROOTS_CHANGED received (tests /control WebSocket)
10. Close and reopen extension
11. Verify silent reconnection (no dialog)
12. Clear extension data (new installId)
13. Verify "Replace?" dialog appears

### 10.5 Verify WebSocket Separation

Check Android logcat for:
```
WebSocket /control connected
WebSocket /io connected
```

Verify opcode restrictions:
- ROOTS_CHANGED events only go to /control sessions
- TCP/UDP operations only work on /io sessions

### 10.6 Verify Desktop Unchanged

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
- `server/WebSocketRouteTest.kt` - /io vs /control opcode validation tests

**Android - Modified:**
- `auth/TokenStore.kt` - Add installId, extensionId
- `server/Protocol.kt` - Add opcode sets for route validation (IO_OPCODES, CONTROL_OPCODES)
- `server/HttpServer.kt` - Add POST /pair, /control WebSocket route, update /status, add origin checks
- `server/SocketHandler.kt` - Add SessionType enum, opcode validation per route, update AUTH parsing
- `MainActivity.kt` - Remove token from intent handling
- `AndroidManifest.xml` - Register PairingApprovalActivity
- `build.gradle.kts` - Add mockito-kotlin test dependency

**Extension - Modified:**
- `lib/daemon-bridge.ts` - New pairing flow, consistent headers, connect to /control instead of /io

**Engine Package - Modified:**
- `adapters/daemon/daemon-connection.ts` - Credentials getter pattern, AUTH format with extensionId/installId
- `index.ts` - Export CredentialsGetter type

**Client Package - Modified:**
- `chrome/engine-manager.ts` - Pass credentials getter to DaemonConnection for ChromeOS
