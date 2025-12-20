# **JSTorrent – Authentication & Authorization Design (Brief)**

This document defines the **auth tokens**, **headers**, and **trust boundaries** between:

* **Extension**
* **jstorrent-native-host**
* **jstorrent-io-daemon**
* **jstorrent-link-handler**

All communication must be authenticated even on `localhost`.

---

# **1. Trust Model**

* Only the **extension** (via Native Messaging) should be able to control the **native-host**.
* Only a **native-host–spawned daemon** should accept commands or high-throughput requests from the extension.
* The daemon **must reject all HTTP/WS requests lacking the correct token**.
* Link-handler only talks to **native-host**, never directly to daemon.

---

# **2. Token Generation**

### Location

`jstorrent-native-host` generates the tokens.

### Types

1. **daemonAuthToken** — protects all HTTP + WS calls to daemon.
2. **sessionId** (optional) — identifies one logical extension/native-host session.

### Requirements

* 256-bit random hex or base64 URL-safe string
* Generated fresh on each native-host launch
* Stored in memory only
* Passed to extension securely via Native Messaging startup message

### Example:

```json
{
  "op": "daemon_started",
  "port": 35167,
  "token": "Y9e02qYf2-8Ukq8vUSttLzHiv...”,
  "sessionId": "d532aef0-..."
}
```

---

# **3. HTTP Authentication (extension → daemon)**

All HTTP requests **must include**:

### **Header**

```
X-JST-Auth: <daemonAuthToken>
```

### **Behavior**

* Missing/invalid token → `401 Unauthorized`
* Successful → proceed to handler

### Used For

* `/files/*`
* `/hash/*`
* `/control/*`
* `/stream/<fileId>`
* any auxiliary endpoints

### Optional Secondary Header

```
X-JST-Session: <sessionId>
```

Useful for daemon-side metrics and multi-instance debugging.

---

# **4. WebSocket Authentication**

### WebSocket handshake headers:

```
GET /io HTTP/1.1
X-JST-Auth: <daemonAuthToken>
X-JST-Session: <sessionId>
```

### Daemon Validation

* Reject handshake if header missing/invalid
* Do **not** allow query-string tokens (avoid leaking to logs/referrers)

### After connection:

* All WS messages implicitly trust the authenticated session

---

# **5. Native Host Authentication (extension ↔ native-host)**

### Mechanism

**Native Messaging** is inherently authenticated by Chrome:

* Chrome ensures the binary is located in the registered path
* Only the extension with matching ID can open the pipe
* No additional userland token needed

### Message structure:

Every message contains:

```json
{
  "sessionId": "<sessionId>",
  "op": "...",
  ...
}
```

Native-host verifies:

* `sessionId` matches current active session
* Otherwise: reject or ignore message

---

# **6. Link-Handler → Native Host Authentication**

### Mechanism

Link-handler communicates with native-host through **local HTTP or named pipe**:

* Native-host creates a **short-lived, randomly named pipe/socket** on startup
* Native-host communicates this endpoint to link-handler via environment or config
* Link-handler sends:

  * The magnet/torrent data
  * A **one-time ephemeral token**

### Header:

```
X-JST-Link: <ephemeralTokenProvidedByNativeHost>
```

Native-host:

* Validates ephemeral token
* Accepts one or few requests
* Regenerates token after use
* Passes magnet/torrent upward to extension via Native Messaging

**Daemon is never involved.**

---

# **7. Token Lifetimes**

### daemonAuthToken

* Valid until daemon or native-host exits
* Never reused across sessions
* Rotation on every launch

### sessionId

* Stable during extension–native-host connection
* Invalid after SW unload or connectNative() closure

### link-handler token

* Single-use
* Invalid after one handoff
* Bound to a short time window (e.g., 1–2 seconds)

---

# **8. Security Considerations**

* **Localhost still needs auth**. Malicious local processes must not hijack daemon.
* No tokens in URLs (avoid OS/browser logging).
* Tokens never written to disk.
* Token checked for **every** HTTP/WS request.
* Native-host ensures that only the genuine extension ID controls daemon.

---

# **9. Summary**

### Extension → Native Host

* Secure by design via Native Messaging
* Use `sessionId` for correlation only

### Native Host → Daemon

* Provides:

  * `port`
  * `daemonAuthToken`
  * `sessionId`

### Extension → Daemon

* HTTP/WS:

  ```
  X-JST-Auth: <daemonAuthToken>
  X-JST-Session: <sessionId>
  ```

### Link-Handler → Native Host

* Uses ephemeral `X-JST-Link` one-time auth token

This setup provides minimal overhead, maximal security, and clean separation of trust boundaries.
