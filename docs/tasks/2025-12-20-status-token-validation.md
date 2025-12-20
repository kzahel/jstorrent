# Add Token Validation to /status Endpoint

## Overview

The `/status` endpoint currently tells us if we're the "paired identity" (matching extensionId + installId), but doesn't verify if our token is still valid. We only find out at WebSocket AUTH time, which makes error handling complex.

**Change:** Accept optional token in `/status` request, return `tokenValid` field.

## Changes

### 1. TokenStore.kt - Add validation method

In `android-io-daemon/app/src/main/java/com/jstorrent/app/auth/TokenStore.kt`, add after `isPairedWith()`:

```kotlin
/**
 * Validate a token matches the stored token.
 * Returns false if no token stored or doesn't match.
 */
fun isTokenValid(checkToken: String): Boolean {
    val storedToken = token ?: return false
    return storedToken == checkToken
}
```

### 2. HttpServer.kt - Add request type and update response

In `android-io-daemon/app/src/main/java/com/jstorrent/app/server/HttpServer.kt`:

Add new request type after `StatusResponse` (~line 53):

```kotlin
@Serializable
private data class StatusRequest(
    val token: String? = null
)
```

Update `StatusResponse` to include `tokenValid`:

```kotlin
@Serializable
private data class StatusResponse(
    val port: Int,
    val paired: Boolean,
    val extensionId: String? = null,
    val installId: String? = null,
    val version: String? = null,
    val tokenValid: Boolean? = null  // Only present if token was provided in request
)
```

### 3. HttpServer.kt - Update /status handler

Replace the `/status` handler (~line 173):

```kotlin
post("/status") {
    if (!call.requireExtensionOrigin()) return@post
    val headers = call.getExtensionHeaders() ?: return@post

    // Parse optional request body
    val request = try {
        val body = call.receiveText()
        if (body.isNotBlank()) {
            json.decodeFromString<StatusRequest>(body)
        } else {
            StatusRequest()
        }
    } catch (e: Exception) {
        StatusRequest()
    }

    // Check token validity if provided
    val tokenValid = request.token?.let { tokenStore.isTokenValid(it) }

    val response = StatusResponse(
        port = actualPort,
        paired = tokenStore.hasToken(),
        extensionId = tokenStore.extensionId,
        installId = tokenStore.installId,
        version = BuildConfig.VERSION_NAME,
        tokenValid = tokenValid
    )
    call.respondText(
        json.encodeToString(response),
        ContentType.Application.Json
    )
}
```

## Extension Side (for reference)

Once Android changes are deployed, the extension can call:

```typescript
const response = await fetch(`http://100.115.92.2:${port}/status`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-JST-ExtensionId': chrome.runtime.id,
    'X-JST-InstallId': installId,
  },
  body: JSON.stringify({ token: ourToken }),  // optional
})

const status = await response.json()
// status.tokenValid is true/false/undefined
```

Bootstrap logic becomes:

```
if (!status.paired) → need to pair
else if (status.tokenValid === false) → token stale, need to re-pair  
else if (status.tokenValid === true) → good to connect WebSocket
else → (no token sent) legacy behavior, try WebSocket and see
```

## Verification

```bash
cd android-io-daemon
./gradlew build
```

Test manually:
1. Pair extension with Android app
2. Call `/status` with correct token → `tokenValid: true`
3. Call `/status` with wrong token → `tokenValid: false`
4. Call `/status` with no token → `tokenValid: null`
