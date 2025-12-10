# Unify Daemon Auth Protocol - Agent Guide

## Overview

The extension currently has branching logic to handle two different WebSocket AUTH formats:

- **Desktop (io-daemon)**: `authType=1` + raw token bytes
- **ChromeOS (Android daemon)**: `authType=0` + `token + '\0' + extensionId + '\0' + installId`

This task unifies to a single format (authType=0) across all platforms.

## Current State

**Extension (`daemon-connection.ts` lines 92-120):**
```typescript
if (this.getCredentials) {
  // ChromeOS - authType=0, null-separated fields
  authPayload[offset++] = 0
  // ... token + \0 + extensionId + \0 + installId
} else {
  // Desktop - authType=1, raw token
  authPayload[0] = 1
  authPayload.set(tokenBytes, 1)
}
```

**Desktop io-daemon (`ws.rs` lines 155-177):**
```rust
let _auth_type = payload[0]; // Ignored
let token = String::from_utf8_lossy(&payload[1..]).to_string();
// Treats entire payload after authType as token
```

**Android daemon (`SocketHandler.kt`):**
```kotlin
// Parses: authType(1) + token + \0 + extensionId + \0 + installId
val parts = payloadStr.split('\u0000')
val token = parts[0]
val extensionId = parts[1]
val installId = parts[2]
```

## Target State

Single AUTH format everywhere:
- `authType=0` + `token + '\0' + extensionId + '\0' + installId`
- Desktop ignores extensionId/installId but parses past them to extract token

---

## Phase 1: Update io-daemon (Rust)

### 1.1 Update ws.rs AUTH parsing

**File:** `native-host/io-daemon/src/ws.rs`

**Find the AUTH handling block (around line 155-178):**

```rust
                    OP_AUTH => {
                        // Payload: auth_type(u8) + token(utf8)
                        if payload.len() < 1 {
                            send_error(&tx, env.request_id, "Invalid auth payload").await;
                            break;
                        }
                        let _auth_type = payload[0]; // Ignored for now, assume token
                        let token = String::from_utf8_lossy(&payload[1..]).to_string();
                        
                        // ... token verification ...
```

**Replace with:**

```rust
                    OP_AUTH => {
                        // Parse AUTH payload
                        // Format: authType(1) + token + '\0' + extensionId + '\0' + installId
                        // Desktop ignores extensionId/installId but must parse them
                        if payload.is_empty() {
                            send_error(&tx, env.request_id, "Empty auth payload").await;
                            break;
                        }

                        let auth_type = payload[0];
                        let data = &payload[1..];

                        let token = match auth_type {
                            0 => {
                                // New format: null-separated fields
                                // Find first null byte to extract token
                                let token_end = data.iter().position(|&b| b == 0).unwrap_or(data.len());
                                String::from_utf8_lossy(&data[..token_end]).to_string()
                            }
                            1 => {
                                // Legacy format: raw token (entire remaining payload)
                                String::from_utf8_lossy(data).to_string()
                            }
                            _ => {
                                send_error(&tx, env.request_id, "Unknown auth type").await;
                                break;
                            }
                        };
```

The rest of the auth verification logic remains unchanged - it just uses the extracted `token`.

---

## Phase 2: Update daemon-connection.ts

### 2.1 Remove branching logic

**File:** `packages/engine/src/adapters/daemon/daemon-connection.ts`

**Find the AUTH payload construction (around line 92-121):**

```typescript
    // 3. Send AUTH
    let authPayload: Uint8Array
    if (this.getCredentials) {
      // ChromeOS/Android mode - new format with extensionId and installId
      const encoder = new TextEncoder()
      const tokenBytes = encoder.encode(token)
      const extIdBytes = encoder.encode(extensionId)
      const installIdBytes = encoder.encode(installId)

      // Format: authType(1) + token + \0 + extensionId + \0 + installId
      authPayload = new Uint8Array(
        1 + tokenBytes.length + 1 + extIdBytes.length + 1 + installIdBytes.length,
      )
      let offset = 0
      authPayload[offset++] = 0 // authType 0 for new format
      authPayload.set(tokenBytes, offset)
      offset += tokenBytes.length
      authPayload[offset++] = 0 // null separator
      authPayload.set(extIdBytes, offset)
      offset += extIdBytes.length
      authPayload[offset++] = 0 // null separator
      authPayload.set(installIdBytes, offset)
    } else {
      // Desktop mode - legacy format for jstorrent-native compatibility
      const tokenBytes = new TextEncoder().encode(token)
      authPayload = new Uint8Array(1 + tokenBytes.length)
      authPayload[0] = 1 // authType 1 for legacy token auth
      authPayload.set(tokenBytes, 1)
    }

    this.sendFrameInternal(this.packEnvelope(DaemonConnection.OP_AUTH, 2, authPayload))
```

**Replace with:**

```typescript
    // 3. Send AUTH - unified format for all platforms
    // Format: authType(1) + token + \0 + extensionId + \0 + installId
    const encoder = new TextEncoder()
    const tokenBytes = encoder.encode(token)
    const extIdBytes = encoder.encode(extensionId)
    const installIdBytes = encoder.encode(installId)

    const authPayload = new Uint8Array(
      1 + tokenBytes.length + 1 + extIdBytes.length + 1 + installIdBytes.length,
    )
    let offset = 0
    authPayload[offset++] = 0 // authType 0
    authPayload.set(tokenBytes, offset)
    offset += tokenBytes.length
    authPayload[offset++] = 0 // null separator
    authPayload.set(extIdBytes, offset)
    offset += extIdBytes.length
    authPayload[offset++] = 0 // null separator
    authPayload.set(installIdBytes, offset)

    this.sendFrameInternal(this.packEnvelope(DaemonConnection.OP_AUTH, 2, authPayload))
```

### 2.2 Update constructor and credentials handling

The constructor currently has separate paths for `getCredentials` vs `legacyToken`. Since both now use the same format, we can simplify.

**Find the credential extraction (around line 62-75):**

```typescript
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
```

**This stays the same** - desktop can still pass empty strings for extensionId/installId. The only change is the AUTH payload format (always authType=0).

### 2.3 Update comments

Update the constructor comment to reflect unified behavior:

```typescript
  constructor(
    private port: number,
    private host: string = '127.0.0.1',
    private getCredentials?: CredentialsGetter,
    // Direct token for desktop (extensionId/installId will be empty strings)
    private legacyToken?: string,
  ) {
```

---

## Phase 3: Verification

### 3.1 Build io-daemon

```bash
cd native-host
cargo build --workspace
```

### 3.2 Build extension

```bash
pnpm build
```

### 3.3 Test Desktop

1. Install native host locally:
   ```bash
   cd native-host
   ./scripts/install-local-linux.sh  # or macos
   ```

2. Load extension, open UI
3. Verify WebSocket connects and authenticates
4. Add a torrent, verify download works

### 3.4 Test ChromeOS

1. Build and install Android app
2. Load extension
3. Verify pairing and connection work
4. Add a torrent, verify download works

---

## Files Summary

**Rust (io-daemon):**
- `native-host/io-daemon/src/ws.rs` - Update AUTH parsing to handle authType=0 format

**TypeScript (extension):**
- `packages/engine/src/adapters/daemon/daemon-connection.ts` - Remove branching, always use authType=0

---

## Notes

- Desktop io-daemon extracts the token by finding the first null byte
- extensionId/installId are parsed but ignored on desktop (could be used for logging/debugging later)
- Android daemon already handles this format correctly
- No backwards compatibility needed - not yet released
