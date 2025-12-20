## IO-Daemon WebSocket Bridge Protocol (High-Level Specification, With Authentication)

This specification defines a **multiplexed TCP/UDP socket bridge** carried over **WebSocket binary frames**.
It includes an explicit **authentication phase** as part of the binary protocol.

Scope:

* **Network I/O only** (TCP + UDP).
* **No** file/disk/range access.
* **One WebSocket = one session**.
* **All messages = binary WebSocket frames (no JSON, no text)**.

---

# 1. Transport

### 1.1 WebSocket mode

* All messages MUST be sent as **WebSocket binary frames**.
* Each binary frame contains exactly **one complete protocol message**.
* No application-level fragmentation; WebSocket fragmentation MAY be used but is transparent to the protocol.

### 1.2 Endianness

* All multi-byte integers are **little-endian**.

---

# 2. Message Envelope

Every binary frame begins with an 8-byte envelope:

```
byte 0   : version (u8)     MUST be 1
byte 1   : msg_type (u8)    opcode (see §3)
byte 2-3 : flags (u16)      reserved, MUST be 0
byte 4-7 : request_id (u32) correlation ID or 0
byte 8.. : payload          type depends on msg_type
```

* `version` ensures compatibility.
* `request_id` supports request/response correlation for operations that have them.

---

# 3. Message Types (Opcodes)

## 3.1 Session & Authentication

| Opcode                     | Direction       | Purpose                                  |
| -------------------------- | --------------- | ---------------------------------------- |
| `CLIENT_HELLO`  (0x01)     | client → daemon | Introduce client & protocol version      |
| `SERVER_HELLO`  (0x02)     | daemon → client | Server confirms version                  |
| **`AUTH`          (0x03)** | client → daemon | Provide authentication token/credentials |
| **`AUTH_RESULT`   (0x04)** | daemon → client | Accept or reject authentication          |
| `ERROR`          (0x7F)    | both            | Protocol or IO error                     |

A client MUST authenticate before issuing any TCP/UDP operations.

## 3.2 TCP

| Opcode                 | Direction     | Purpose                           |
| ---------------------- | ------------- | --------------------------------- |
| `TCP_CONNECT`   (0x10) | client→daemon | Initiate TCP connection           |
| `TCP_CONNECTED` (0x11) | daemon→client | Result of connect request         |
| `TCP_SEND`      (0x12) | client→daemon | Send bytes                        |
| `TCP_RECV`      (0x13) | daemon→client | Bytes received                    |
| `TCP_CLOSE`     (0x14) | both          | Close connection / report closure |

## 3.3 UDP

| Opcode               | Direction     | Purpose                 |
| -------------------- | ------------- | ----------------------- |
| `UDP_BIND`    (0x20) | client→daemon | Bind local UDP endpoint |
| `UDP_BOUND`   (0x21) | daemon→client | Bind result             |
| `UDP_SEND`    (0x22) | client→daemon | Send datagram           |
| `UDP_RECV`    (0x23) | daemon→client | Datagram received       |
| `UDP_CLOSE`   (0x24) | both          | Close endpoint          |

---

# 4. Authentication Flow

Authentication is **explicit and mandatory**.

### 4.1 Connection sequence

1. WebSocket connection established.
2. Client MUST send `CLIENT_HELLO`.
3. Server replies with `SERVER_HELLO`.
4. Client MUST send **`AUTH`**.
5. Server replies with **`AUTH_RESULT`**.
6. If authentication succeeds → normal TCP/UDP commands allowed.
7. If authentication fails → server SHOULD send ERROR and close WebSocket.

### 4.2 AUTH (0x03)

Payload (high-level):

* `auth_type` (u8) — e.g., 1=token, 2=HMAC, 3=public-key proof
* `credential` — UTF-8 string or binary blob (implementation-specific)

No other messages are allowed before successful authentication.

### 4.3 AUTH_RESULT (0x04)

Payload:

* `status` (u8):

  * `0` = success
  * non-zero = failure
* Optionally an error message (UTF-8)

If status ≠ 0, daemon SHOULD close session.

---

# 5. Multiplexing Model

* Client assigns a **socketId** (u32) for each desired TCP or UDP endpoint.
* Daemon MUST preserve this socketId across all related messages.
* Multiple sockets can coexist and are interleaved over a single WebSocket connection.

---

# 6. High-Level Payload Shapes

Exact byte layout is intentionally omitted; these are structural requirements.

### 6.1 TCP_CONNECT

* `socketId`
* `hostname` (string)
* `port` (u16)
* `timeout_ms` (u32, 0=default)

### TCP_CONNECTED

* `socketId`
* `status` (0=success)
* `errno_code` (u32)

### TCP_SEND

* `socketId`
* Raw binary payload (rest of the frame)

### TCP_RECV

* `socketId`
* Raw binary payload

### TCP_CLOSE

* `socketId`
* `reason` (u8)
* `errno_code` (u32)

---

### 6.2 UDP_BIND

* `socketId`
* `bind_addr` (string or empty)
* `port` (u16)

### UDP_BOUND

* `socketId`
* `status`
* `bound_port`
* `errno_code`

### UDP_SEND

* `socketId`
* `dest_addr` (string)
* `dest_port` (u16)
* Raw datagram payload

### UDP_RECV

* `socketId`
* `src_addr` (string)
* `src_port` (u16)
* Raw datagram payload

### UDP_CLOSE

* `socketId`
* `reason`
* `errno_code`

---

# 7. Daemon Behavior Requirements

* MUST reject all TCP/UDP requests prior to successful authentication.
* MUST treat each WebSocket binary frame as one complete protocol message.
* MUST multiplex all socket operations over single WS connection.
* MUST emit TCP_RECV / UDP_RECV only when authenticated & socket open.
* MAY implement flow control or throttling (out of scope for spec).
* On malformed frames, MUST send ERROR and MAY close connection.

---

# 8. Client Behavior Requirements

* MUST send CLIENT_HELLO then AUTH before any I/O operations.
* MUST manage unique socketId values.
* MUST handle asynchronous events (TCP_RECV, UDP_RECV, *_CLOSE).
* SHOULD gracefully close sockets before closing the WebSocket.
* MUST treat ERROR for authentication as fatal.

---

# 9. Security Notes

* Authentication is not transported via URL parameters or headers.
* Authentication token or credential is carried entirely inside the binary `AUTH` message.
* Server MUST treat pre-auth state as restricted: only accept CLIENT_HELLO, then AUTH.
* Server SHOULD drop connections on invalid ordering or invalid version.

---

# 10. Summary

This is a high-level, binary-only, authentication-aware protocol for multiplexing TCP and UDP sockets over a WebSocket connection.

Key properties:

* Mandatory authentication built into protocol flow
* No JSON, no text frames
* Binary WebSocket frames only
* Clear handshake phase
* Strong separation: pre-auth vs post-auth behavior
* Clean multiplexing with socketId
* Only network I/O operations included
