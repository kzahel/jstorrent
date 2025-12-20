Below is a **concise but technical overview** of the **jstorrent-io-daemon**: its **purpose**, **lifecycle**, **API surface**, and **internal concurrency model** designed for **maximum throughput** on Windows/macOS/Linux.

---

# **JSTorrent I/O Daemon – Process Overview**

## **1. Role**

`jstorrent-io-daemon` is the high-throughput, low-latency Rust process that performs all privileged I/O on behalf of the JSTorrent MV3 extension.

It provides:

* File I/O (random access, streaming, preallocation)
* Hashing (SHA-1, SHA-256) using parallel CPU
* Socket I/O (TCP/UDP, multiplexed)
* Range-capable streaming endpoints for video playback
* Local WebSocket transport for peer traffic

It contains **zero torrent logic**; it only performs raw I/O operations on request.

---

# **2. Lifecycle**

## **2.1 Launch**

* Always launched **by jstorrent-native-host** (never directly by browser/extension).
* Started with:

  * random ephemeral **TCP port**
  * random ephemeral **auth token**
  * optional debug flags

## **2.2 Initialization**

On startup:

* Bind HTTP server to `127.0.0.1:<port>`
* Bind WebSocket endpoint `/io`
* Initialize thread pools:

  * **File I/O pool**
  * **Hashing pool**
  * **Network event loop**
  * **Control executor**
* Register process death handler for parent (`native-host`)

## **2.3 Ready State**

Daemon enters “ready” when:

* HTTP server is accepting connections
* WS is accepting connections
* Auth token is active

Native-host then sends the (port, authToken) to the extension.

## **2.4 Operation**

Daemon remains alive as long as:

* Its parent process is alive (preferred)
* OR active torrents exist (optional idle timeout extension)
* OR extension keeps its WS/HTTP activity above threshold

## **2.5 Shutdown**

Daemon exits immediately when:

* Parent (`native-host`) dies
* Receives a `/control/shutdown` RPC
* Idle timeout is reached
* Internal fatal error occurs (native-host will restart)

Shutdown:

* Close WS connections
* Finish in-flight writes if possible
* Terminate quickly on normal exit

---

# **3. API Surface**

## **3.1 HTTP Endpoints**

### **Auth**

All endpoints require:

```
X-JST-Auth: <token>
X-JST-Session: <sessionId>
```

### **File API**

```
GET    /files/<fileId>/read?offset&length
PATCH  /files/<fileId>/write?offset   (body = raw bytes)
POST   /files/<fileId>/flush
POST   /files/<fileId>/close
POST   /files/<fileId>/preallocate?size
```

Characteristics:

* Fully binary
* 100% zero-copy internally where possible
* Uses async file handles for maximum parallelism

### **Hash API**

```
POST /hash/sha1       (body = raw bytes)
POST /hash/sha256     (body = raw bytes)
```

Optional “from-file” version:

```
POST /hash/from-file  (JSON { fileRanges: [...] })
```

### **Control API**

```
POST /control/open_socket   { host, port, protocol }
POST /control/close_socket  { socketId }
POST /control/shutdown
```

### **Streaming Endpoint**

```
GET /stream/<fileId>
Range: bytes=start-end
```

Daemon defers availability checks to extension via WS “range_request”.

---

## **3.2 WebSocket Endpoint: `/io`**

Handles:

* Peer TCP/UDP send/recv
* Streamed binary data
* Range request notifications
* Socket-close events

Messages:

```
{ op: "tcp_send", socketId, data }
{ op: "tcp_recv", socketId, data }
{ op: "udp_send", socketId, data }
{ op: "udp_recv", socketId, data }
{ op: "range_request", ... }
{ op: "range_available", ... }
```

Multiplexing is done on `socketId`.

Binary frames are used for data to avoid JSON overhead.

---

# **4. Concurrency Model**

The daemon is structured around **clean division of CPU-bound, I/O-bound, and control tasks**.

## **4.1 Rust Runtime**

Uses **tokio** as the async foundation:

* One **main reactor** for sockets and HTTP
* Several **tokio worker threads** for I/O
* Dedicated pools for CPU-heavy hashing

## **4.2 Thread Pools**

### **A. File I/O Threadpool**

* Backed by `tokio::fs` or custom blocking threadpool
* High concurrency (4–16 threads)
* Handles reads/writes with minimal blocking
* Can reorder I/O for better throughput (optional)

### **B. Hashing Threadpool**

* CPU-bound
* Uses **Rayon** or explicit Rust threads
* High parallel throughput for SHA-1/SHA-256
* Zero-copy hashing on raw dynamically allocated buffers

### **C. Socket I/O**

Managed by tokio reactor:

* mio-poll or epoll/kqueue
* All TCP/UDP sockets registered
* Incoming data is forwarded to WS as binary frames
* Reduces syscalls by batching when possible

### **D. Control / Range Coordination Thread**

* Receives WS messages from extension
* Wakes blocked streaming handlers
* Manages long-pollable range requests

This keeps long-range HTTP requests from blocking I/O threads.

---

# **5. Maximum Throughput Techniques**

### **5.1 Zero-Copy as Much as Possible**

* Use `Bytes` or `BytesMut` to avoid reallocations
* Memory-map large files or use direct async file reads
* Use OS-backed sendfile where possible (optional)

### **5.2 Minimize Lock Contention**

* Store file handles in an RW-locked map
* Each file I/O operation works on its own handle
* Socket events dispatched without global locks

### **5.3 Batching**

* Socket writes coalesced into fewer system calls
* Hashing jobs scheduled batch-style
* File writes optionally buffered

### **5.4 Limit Per-Socket Backpressure**

* Use WS backpressure signals
* Avoid flooding extension with recv events
* Use internal queues per socket

### **5.5 Efficient Range Handling**

* Blocking on availability is done via `tokio::sync::oneshot` or `Notify`
* HTTP handlers stay async, not blocking threads

---

# **6. Error Handling & Resilience**

### **Soft errors**

* Individual I/O failures (disk errors, socket resets) become WS error events
* Extension decides how to recover or retry

### **Hard errors**

* If daemon panics: native-host detects exit, restarts daemon automatically
* Extension re-establishes connection and replays torrent state

### **Auth failures**

* Immediate 401 on HTTP/WS handshake
* No recovery unless extension restarts

---

# **7. Summary**

The **jstorrent-io-daemon** is a high-performance, multi-threaded Rust service designed for:

* fast disk I/O
* fast hashing
* efficient multiplexed networking
* robust streaming
* clean separation from torrent logic

Its concurrency model:

* Uses async I/O for socket + HTTP workloads
* Uses separate threadpools for file and hashing
* Maintains throughput by batching, zero-copy buffers, and low lock contention

It operates only while supervised by **jstorrent-native-host**, shutting down automatically when the parent dies.
