Below is a **concise, high-signal, implementation-oriented design document** for your records.
It captures the architecture, interface, and responsibilities of the streaming endpoint model discussed above.

---

# **JSTorrent – Streaming File Endpoint Design**

## **1. Purpose**

Provide a `Range`-capable HTTP endpoint for serving torrent-backed files (e.g., video playback inside the browser).
The endpoint must support:

* Serving fully-downloaded files.
* Serving partially-downloaded files.
* Blocking until requested byte ranges are available.
* Allowing the extension to prioritize the download of requested ranges.
* Remaining daemon-agnostic of all torrent metadata, piece boundaries, and availability state.

---

# **2. Overview**

File streaming is implemented as an **HTTP endpoint inside jstorrent-io-daemon** that cooperates with the **extension-based torrent engine** over a WebSocket control plane.

### **Key Principles**

1. **Daemon is “muscle”:** parses range headers, performs file reads, streams file data.
2. **Extension is “brain”:** knows torrent layout, piece availability, scheduling, prioritization.
3. **Daemon defers availability decisions to the extension.**
4. **Extension signals readiness** when required data is fully downloaded.

This maintains the architectural separation:

```
Extension (engine)  <--torrent semantics-->  Daemon (I/O engine)
```

---

# **3. HTTP Streaming Endpoint**

## **Endpoint**

```
GET /stream/<fileId>
Range: bytes=START-END
```

### **Behavior**

1. Daemon receives the HTTP request.
2. Daemon parses `Range` header to extract `[start, end]`.
3. Daemon assigns a unique `requestId`.
4. Daemon sends WebSocket message to extension:

```json
{
  "op": "range_request",
  "fileId": "<id>",
  "start": START,
  "end": END,
  "requestId": "<uuid>"
}
```

5. Daemon waits for extension response.
6. Extension replies with one of:

### **A. Data Available**

```json
{ "op": "range_available", "requestId": "<uuid>" }
```

Daemon:

* Reads bytes from file.
* Responds `206 Partial Content` with:

  * `Content-Range: bytes START-END/TOTAL`
  * raw payload.

---

### **B. Data Not Available (Block)**

```json
{ "op": "range_block", "requestId": "<uuid>" }
```

Daemon:

* Suspends the HTTP request (async promise, condition variable, etc.)
* Does **not** send response yet.

Extension:

* Prioritizes download for `[start, end]`.
* When pieces complete, sends:

```json
{ "op": "range_ready", "requestId": "<uuid>" }
```

Daemon:

* Awakes request.
* Reads file region.
* Responds with 206 and data.

---

### **C. Data Will Not Be Available Soon**

```json
{ "op": "range_reject", "requestId": "<uuid>" }
```

Daemon:

* Responds with:

  * `416 Range Not Satisfiable`
  * or `503 Service Unavailable`
    depending on extension instruction.

---

# **4. Daemon Responsibilities**

### **Core**

* Host HTTP `/stream/<fileId>` endpoint.
* Parse Range headers.
* Assign requestId per request.
* Communicate availability checks to extension.
* Block/unblock HTTP handlers based on extension signals.
* Perform file reads once allowed.
* Send correct HTTP streaming responses (e.g., 206, 416).
* Enforce authorization token.
* Ensure all responses adhere to:

  * `Content-Type`
  * `Content-Range`
  * `Accept-Ranges: bytes`
  * `Content-Length`

### **Not Responsible For**

* Torrent piece layout.
* File-to-piece mapping.
* Scheduling or prioritization.
* Knowing which data exists or is pending.
* Reading partial files until extension says “ready”.

Daemon stays **I/O-only**.

---

# **5. Extension Responsibilities (Torrent Engine)**

### **Core**

* Maintain torrent metadata:

  * File list
  * Piece → file spans
  * Block availability

* Track which pieces (and bytes) are downloaded.

* On receiving:

  `range_request(fileId, start, end)`
  determine if data is:

  * **Complete**
  * **Incomplete but fetchable**
  * **Unavailable**

* Reply with one of:

  * `range_available`
  * `range_block`
  * `range_reject`

* If blocked:

  * Map `[start, end]` → piece set.
  * Prioritize piece downloads appropriately.
  * On completion of all pieces covering `[start, end]`, send:

    `{ "op": "range_ready", requestId }`

### **Not Responsible For**

* Performing file reads (daemon does this).
* Responding to HTTP requests directly.
* Serving binary data to the browser.

Extension remains **torrent-semantic-only**.

---

# **6. Control Plane (WebSocket) Messages**

### **Daemon → Extension**

* `range_request { fileId, start, end, requestId }`

### **Extension → Daemon**

* `range_available { requestId }`
* `range_block { requestId }`
* `range_ready { requestId }`
* `range_reject { requestId }`

All messages include:

* `op`
* `requestId`

---

# **7. Streaming Flow Examples**

## **A. Fully Downloaded File**

1. Browser → GET /stream/fileId Range: 0-1023
2. Daemon → range_request
3. Extension → range_available
4. Daemon → 206 bytes 0-1023
5. Browser plays instantly.

---

## **B. Partially Downloaded (Video Streaming Use Case)**

1. Browser seeks to end-of-file metadata: Range: 3,000,000–3,001,024
2. Daemon → range_request
3. Extension:

   * `range_block`
   * Prioritizes final pieces
4. After download:

   * `range_ready`
5. Daemon:

   * Reads file
   * Sends 206
6. Browser continues playback.

---

## **C. Invalid / Out-of-range**

1. Browser → Range beyond torrent length
2. Daemon → range_request
3. Extension → range_reject
4. Daemon → 416 Range Not Satisfiable

---

# **8. Benefits of This Design**

### **Extension stays authoritative**

All torrent semantics remain in the extension, not fragmented across processes.

### **Daemon remains simple**

Only handles I/O and HTTP mechanics.

### **Browser video player Just Works**

Chrome’s `<video>` tag respects Range semantics; no MSE or complex buffering needed.

### **Supports on-demand piece prioritization**

Seeking in video automatically pushes rare pieces to the front of the queue.

### **Works for fully or partially downloaded files**

No special casing required.

### **Scales to multiple torrents**

All via unified control channel.

---

# **9. Optional Enhancements**

### **Prefetch Mode**

Extension can request sequential prefetching of upcoming ranges.

### **Streaming Hints**

Extension can inform daemon of expected future ranges to adjust buffering behavior (non-critical).

### **Timeouts**

Daemon can enforce max-wait time before converting block → reject.

### **Stateless fallback**

When WS disconnects, daemon aborts pending requests with 503.

---

# **10. Summary**

* **Daemon implements generic Range-serving HTTP.**
* **Extension governs availability and prioritization.**
* **Communication occurs via a WebSocket command channel.**
* **Streaming works even for in-progress downloads.**

This achieves clean separation of concerns, maximum flexibility, and a simple interface for browser playback.
