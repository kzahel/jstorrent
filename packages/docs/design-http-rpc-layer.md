> **This HTTP RPC orchestration layer is a Node-only testing scaffold.
> It must never be included inside the core engine package, and BtEngine must remain completely unaware of HTTP, RPC, or process orchestration.
> Other runtimes (extension runtime, io-daemon, native host, mobile) will implement their own orchestration layers using their own transport mechanisms.**


# **HTTP RPC Orchestration Layer – Design Document**

## **1. Purpose**

The HTTP RPC Orchestration Layer is a thin, process-level control interface that manages the lifecycle of a single `BtEngine` instance. It is designed to:

* allow external processes (e.g. Python test harness, native host, dev tooling) to create and control a torrent engine instance
* expose a minimal, stable, language-agnostic API surface
* guarantee deterministic startup and shutdown semantics
* avoid embedding orchestration logic inside the torrent engine
* provide a future foundation for supervising multiple engine processes

The RPC layer is *not* responsible for torrent semantics.
It only creates, destroys, and queries a single engine instance.

---

## **2. High-Level Architecture**

```
                +---------------------+
                |     Python Tests    |
                |   (or any client)   |
                +----------+----------+
                           |
                           | HTTP JSON RPC
                           v
               +-----------------------------+
               | HTTP RPC Orchestration Layer|
               |  (always running in process)|
               +-----------------------------+
                           |
                           | creates/destroys
                           v
               +-----------------------------+
               |         BtEngine            |
               | (single instance per process)|
               +-----------------------------+
```

### Key points:

* The **HTTP RPC server** is created on process startup and stays alive until process termination.
* The **BtEngine** instance is created/destroyed via RPC calls.
* The engine never starts the HTTP server itself.
* There is **only one BtEngine per process**.
* Clients (Python or JS) communicate strictly via HTTP.

---

## **3. Responsibilities**

### **HTTP RPC Layer**

* Start and maintain the HTTP server
* Maintain a single global `BtEngine | null` reference
* Create/destroy engine instances
* Forward high-level commands (add torrent, pause, resume, etc.)
* Provide status queries
* Handle shutdown cleanly
* Enforce that engine methods are only available when engine exists
* Never perform torrent logic

### **BtEngine**

* Implements all actual torrent logic
* Exposes methods that the RPC layer invokes
* Contains no HTTP knowledge
* Contains no process orchestration
* Is fully replaceable/restartable within the process

---

## **4. Process Lifecycle**

1. Process starts
2. HTTP RPC layer is initialized
3. `POST /engine/start` creates a new `BtEngine` instance
4. RPC calls operate on that instance
5. `POST /engine/stop` destroys it and cleans up network/filesystem state
6. `POST /shutdown` stops the engine (if any), closes the server, and exits the process

---

## **5. Minimal HTTP RPC Interface**

This is the core of the design.
Everything else is optional.

### **Base URL:** `http://localhost:<port>/`

All responses are JSON with `{ ok: true, ... }` or `{ ok: false, error: "msg" }`.

---

## **5.1 Engine Lifecycle**

### **POST /engine/start**

**Creates a new BtEngine instance.**

Body (optional):

```
{
  "config": { ... engine config overrides ... }
}
```

Responses:

* `200 OK` — engine created
* `409 Conflict` — engine already running

---

### **POST /engine/stop**

**Stops and destroys the engine instance.**

Responses:

* `200 OK` — stopped
* `404 Not Found` — no engine running

---

### **GET /engine/status**

Returns whether an engine is running, and minimal metadata.

Response:

```
{
  "ok": true,
  "running": true,
  "version": "x.y.z",
  "torrents": [ { "id": "...", "state": "..." }, ... ]
}
```

If no engine running:

```
{ "ok": true, "running": false }
```

---

## **5.2 Torrent Management**

All routes below require an active engine.
If no engine exists → `404 EngineNotRunning`.

---

### **POST /torrent/add**

Adds a torrent by file or magnet.

Body:

```
{
  "type": "file" | "magnet",
  "data": "<buffer base64 or magnet link>",
  "storagePath": "<optional target dir>"
}
```

Response:

```
{ "ok": true, "id": "<torrent id>" }
```

---

### **GET /torrent/:id/status**

Returns high-level torrent state.

Response:

```
{
  "ok": true,
  "id": "...",
  "state": "downloading|seeding|paused|error|stopped",
  "progress": 0.0,
  "downloadRate": 12345,
  "uploadRate": 2345,
  "peers": 12
}
```

---

### **POST /torrent/:id/pause**

Pauses the torrent (keeps connections alive).

### **POST /torrent/:id/resume**

Resumes downloading/seeding.

### **POST /torrent/:id/remove**

Removes torrent from engine.
Implementing data deletion is optional.

---

## **5.3 Process Shutdown**

### **POST /shutdown**

Stops the engine if running, closes the HTTP server, and terminates the process.

Response:

```
{ "ok": true }
```

Python usage:

```python
requests.post(f"http://localhost:{port}/shutdown")
proc.wait()
```

This guarantees no zombie processes.

---

## **6. HTTP Error Conventions**

All errors return:

```
{
  "ok": false,
  "error": "<string>",
  "code": "<enum or string>"
}
```

Recommended codes:

* `EngineNotRunning`
* `EngineAlreadyRunning`
* `TorrentNotFound`
* `InvalidRequest`
* `InternalError`

---

## **7. Non-Goals (for this minimal version)**

These deliberately **won’t** be included yet:

* WebSockets event streaming
* Piece-level details
* Peer inspection
* Session persistence management
* Rate limiting controls
* Multiple engine instances
* Authentication
* Config files
* Plugin architecture
* Any filesystem APIs

These can be layered on later without modifying the minimal core.

---

## **8. Why This API Is Minimal and Sufficient**

This surface:

* enables Python to orchestrate end-to-end tests
* provides deterministic lifecycle behavior
* matches your future multi-process vision (supervisor → engine)
* does not leak implementation details
* is trivial to stub/mimic for agents
* reflects the true state machine of the engine
* requires almost no boilerplate to implement (~200 lines total)
* avoids all complexity from the abandoned REPL-RPC layer

---

## **9. Implementation Notes**

### HTTP Server

* Use a tiny router (`itty-router`, `hono`, or hand-rolled)
* Prefer JSON body parsing only
* Every route checks if `engine` exists before delegating

### Global Holder

```
let engine: BtEngine | null = null
```

### Engine Start/Stop

* Wrap all calls in try/catch
* Ensure stop cleans up sockets, timers, file handles

### Shutdown

* Close HTTP server
* Stop engine
* Call `process.exit(0)`

### Logging

* Log every RPC call with timestamp and minimal metadata
* Important for Python test debugging

---

# **10. Summary**

This design specifies:

* The responsibilities and boundaries of the HTTP RPC server
* A single-engine-per-process lifecycle model
* A minimal yet complete RPC interface
* Predictable shutdown and testing semantics
* A forward-compatible foundation for future supervisors or native hosts

It is ready for an agent to break into tasks and begin implementing.
