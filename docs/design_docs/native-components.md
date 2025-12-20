Below is a **concise but complete** design document describing the **three native components**, their **responsibilities**, their **lifecycles**, and their **interop with the MV3 extension**.

This is suitable as an architectural reference.

---

# **JSTorrent Native Components – Design Overview**

## **1. Components**

The JSTorrent system uses three native executables:

1. **jstorrent-link-handler**
   OS-level protocol/file handler for `magnet:` and `.torrent` files.

2. **jstorrent-native-host**
   Chrome *Native Messaging* host that coordinates everything.

3. **jstorrent-io-daemon**
   High-throughput localhost HTTP/WebSocket server that performs all privileged I/O.

The extension houses the torrent engine (TypeScript), which communicates with these binaries.

---

# **2. Responsibilities**

## **2.1 jstorrent-link-handler**

**Role:** Entry point for OS integrations.

### Responsibilities

* Registered as:

  * default handler for **magnet:**
  * default handler for **.torrent** files
* On invocation:

  * Extract URI or data
  * Start `jstorrent-native-host` if not running
  * Pass magnet/torrent payload through a local HTTP handoff to the daemon or via a minimal RPC to the native host
* Very short-lived, no long-running state

### Not Responsible For

* Torrent parsing
* Torrent scheduling
* Socket/file I/O
* Maintaining any process lifecycle beyond a handoff

---

## **2.2 jstorrent-native-host** (Coordinator)

**Role:** Supervisor and privileged coordinator; interface between extension and OS-native layer.

### Responsibilities

* Launched by Chrome when extension uses `connectNative`
* Single instance per Chrome profile
* On startup:

  * Receives commands from the extension
  * Starts or restarts `jstorrent-io-daemon` if needed
  * Generates and passes authentication secret to the extension
  * Assigns a dynamic localhost port for daemon
* Maintains lifecycle state:

  * RUNNING / STARTING / STOPPING / STOPPED
* Relays:

  * Handoff messages from link-handler
  * Persistent health updates from daemon back to the extension (optional)

### Not Responsible For

* Torrent engine logic
* High-throughput I/O
* Range serving
* Socket multiplexing

### Why it exists

* Native Messaging only allows direct communication with **this** process
* It provides stable identity tied to extension ID
* It supervises the daemon so you do not need OS-level services

---

## **2.3 jstorrent-io-daemon**

**Role:** High-performance local I/O server.

### Responsibilities

* Provides all privileged, high-throughput operations via:

  * **HTTP server** (file I/O, hashing, control RPC)
  * **WebSocket server** (multiplexed peer I/O)
* Exposes:

  * Random-access file reads/writes
  * Hashing operations (SHA-1/SHA-256) over raw buffers
  * Socket operations (open, send, recv, close)
  * Range-enabled streaming endpoint (`/stream/<fileId>`)
* Authenticates requests using secret token from native host
* Exits when:

  * Parent `native-host` process exits
  * Idle timeout is reached
  * Explicit extension command requests shutdown

### Not Responsible For

* Torrent metadata
* Piece layout (piece ↔ file spans)
* Prioritization or availability decisions
* Choosing download order
* Mapping torrent semantics to file operations

---

# **3. System Lifecycle**

## **3.1 Extension Startup**

1. MV3 Service Worker starts.

2. SW calls `connectNative("jstorrent-native-host")`.

3. Native host starts or resumes.

4. Native host:

   * Launches `jstorrent-io-daemon` if needed
   * Sends:

     * `daemonPort`
     * `authToken`
     * capabilities

5. Extension then connects directly to daemon (`http://127.0.0.1:PORT`) and opens main WebSocket `/io`.

---

## **3.2 Normal Operation**

**Extension** (torrent engine):

* Manages all torrent logic and metadata
* Calls daemon APIs for low-level operations

**Daemon**:

* Performs all heavy I/O
* Communicates streaming/range/blocking decisions via WS

**Native host**:

* Stays dormant except for:

  * occasional supervision
  * link-handler deliveries
  * extension-initiated commands (e.g. daemon restart)

---

## **3.3 External Magnet/Torrent Launch**

1. OS launches **jstorrent-link-handler** with magnet/.torrent.
2. Link-handler performs lightweight HTTP RPC to native-host or daemon.
3. Native host ensures daemon is running.
4. Extension is notified via WS/HTTP to add the new torrent.

---

## **3.4 Shutdown**

### When extension SW unloads:

* Native messaging host loses its port
* Chrome terminates native host process
* Daemon, as child, receives parent exit → exits automatically

### When user disables/uninstalls extension:

* Chrome kills native host
* Daemon dies with parent
* Link-handler remains installed but becomes inert until reinstallation

### When torrents complete & idle timeout triggers:

* Extension tells daemon to shut down
* Daemon exits
* Native host returns to empty state (but stays alive until SW unload)

---

# **4. Interop Model**

## **Data Plane (High-Throughput)**

Via `jstorrent-io-daemon`:

* WebSocket `/io`
* HTTP endpoints:

  * `/files/*`
  * `/hash/*`
  * `/stream/<fileId>`
  * `/control/*`

## **Control Plane (Supervision)**

Via `jstorrent-native-host`:

* `connectNative` from extension
* Commands:

  * start/stop daemon
  * deliver magnets/torrents from link-handler
  * restart-on-crash

## **External Inputs**

* OS-level magnet/torrent via link-handler → native-host → extension

---

# **5. Summary**

**jstorrent-link-handler**

* OS integration
* Passes URI/file payloads
* Very short lived

**jstorrent-native-host**

* Supervisor & bridge between Chrome and native
* Launches daemon
* Provides stable identity and lifecycle guarantees

**jstorrent-io-daemon**

* Local I/O service (HTTP + WebSocket)
* Performs all heavy disk, hashing, and socket work
* No torrent semantics

**Extension (TS engine)**

* Torrent logic
* Piece assembly
* Scheduling
* Range availability decisions
* Communicates with daemon for all privileged work
