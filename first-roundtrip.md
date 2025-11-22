Below is a **clear, minimal, implementation-oriented design doc** describing the first version of the JSTorrent **round-trip data flow**, covering:

* `jstorrent.com/launch` → extension
* extension service worker → offscreen → native host
* native host → stub → POST /add-torrent|magnet
* extension UI → displays data
* chrome.tabs.close + open UI
* unit-testable pieces along the way

Designed so your coding agent can begin implementing the full lifecycle in small, testable milestones.

---

# **JSTorrent Round-Trip Architecture v0.1 — Implementation Design Doc**

This document describes the **first functional end-to-end prototype** flow supporting:

* Launch page waking the extension
* Service worker spinning up offscreen + native host
* Native host receiving the “new torrent / magnet” message from the stub
* Extension notifying UI to open
* UI page displaying events / requests / payloads
* Basic unit tests validating the lifecycle

Everything here is intentionally simple. We grow the architecture after this baseline works.

---

# **1. Canonical End-to-End Launch Flow (v0.1)**

Below is the **exact** prototype v0.1 flow.

### **1. User invokes magnet or .torrent**

OS → launches **JSTorrent Link Handler** stub binary.

### **2. Stub launches browser to:**

```
https://new.jstorrent.com/launch
```

### **3. Launch page loads**

It attempts:

```
chrome.runtime.sendMessage(EXT_ID, { type: "launch-ping" })
```

If:

* message works → extension installed
* message fails → show “install extension” instructions

### **4. Extension Service Worker wakes**

SW receives message:

```
launch-ping
```

Then:

1. Calls `ensureOffscreenDocument()`
2. Sends to offscreen: `{ type: "start-native-host" }`
3. Responds to launch page: `{ ok: true }`

### **5. Offscreen page receives start-native-host**

Offscreen runs:

```ts
chrome.runtime.connectNative("jstorrent_native_host")
```

Creates a long-lived port:

```
let nativePort = chrome.runtime.connectNative(...)
```

Then offscreen sends message to host:

```
{ type: "ping-from-extension" }
```

### **6. Native host wakes**

Native host:

1. Writes `rpc-info.json`
2. Opens `/health`
3. Waits for stub POST

### **7. Stub polls /health and then POSTs magnet/torrent**

Important:

* Stub does **not** interact with extension at all
* Stub completes its job by POSTing to native host

Native host receives:

* magnet string *or*
* torrent bytes

### **8. Native host notifies extension**

After processing the POST:

Native host sends to extension via `stdout`:

```
{ type: "new-add", payload: { magnet, torrentInfo } }
```

Offscreen doc receives this message through the native host port.

### **9. Offscreen forwards event to service worker**

This allows SW to decide UI behavior.

```
chrome.runtime.sendMessage({ type: "new-add", ... })
```

### **10. Service worker activates UI**

SW does:

1. Find or create UI tab
2. Focus it
3. Close the launch tab

This uses `"tabs"` permission.

### **11. UI page receives new-add**

UI connects to SW or offscreen via:

```js
chrome.runtime.onMessage.addListener(...)
```

and displays initial details:

* Magnet hash
* Torrent name
* Piece count
* State = “added”
* Any metadata we decide to return

### **12. UI shows the event timeline**

For now, show:

```
- launch-ping received
- offscreen spun up
- native host connected
- new-add event received
```

This is essential for debugging.

---

# **2. Required Components (v0.1) and Responsibilities**

## **A. Launch Page (website/)**

* Entry point for stub-triggered workflows
* Sends `launch-ping` via externally_connectable
* Displays initial “Connecting…” UI
* Closes after receiving a “safe to close” message (optional v0.1)

### Messaging:

Launch → Extension SW:

```
{ type: "launch-ping" }
```

Extension SW → Launch:

```
{ ok: true }
```

Later, SW → Launch (if we implement auto-close):

```
{ type: "close-window" }
```

---

## **B. Extension Service Worker**

**Central coordinator**, receives signals, wakes systems, and controls UI.

Responsibilities (v0.1):

1. Receive `launch-ping`
2. Call `ensureOffscreenDocument()`
3. Tell offscreen to connect to native host
4. Listen for torrent/magnet events from offscreen
5. Activate UI tab:

   * find existing UI tab or open new one
   * close launch tab

### Key message handlers:

```
launch-ping
offscreen → new-add
ui → ready
```

---

## **C. Offscreen Page**

**Long-lived runtime process**, handles native host I/O.

Responsibilities:

1. Connect via `chrome.runtime.connectNative`
2. Maintain port to native host
3. Receive stdio messages
4. Forward messages to service worker
5. Relay commands from SW to native host (later versions)

---

## **D. Native Host**

For v0.1:

* Start RPC server
* Write rpc-info.json
* Respond to stub health checks
* Receive POST data from stub
* Immediately send extension a message:

```
{ type: "new-add", payload: { magnet or torrent } }
```

* Not required to store anything yet
* Not required to handle multi-torrents gracefully yet

---

## **E. Stub**

Already discussed. In v0.1:

* Launch webpage
* POST torrent data
* Exit
* (Optional) notify user of success/failure with OS-native dialog

Stub does **not** talk to extension directly.

---

## **F. UI Page**

**Developer-facing debugging UI**, showing round-trip success.

Responsibilities (v0.1):

* Listen for:

  * `new-add` messages
  * `connection events`
* Display event log chronologically
* Show metadata summary:

  * Magnet hash
  * Torrent name/size
  * Timestamp of event

### UI message handling:

```
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "new-add") render()
})
```

---

# **3. Message Flow Diagram**

```
[Stub] ───launch browser───► [Launch Page]
                                     │
                                     ▼
                           launch-ping (external)
                                     │
                                     ▼
                      [Extension Service Worker]
                           │             │
                           │ ensureOffscreenDocument()
                           │             │
                           ▼             │
                     start-native-host   │
                           │             ▼
                           │  [Offscreen]──connectNative──► [Native Host]
                           │                                         │
                           │                                         │ /health ready
                           │                                         │
                           │                    stub POST (magnet/torrent)
                           │                                         ▼
                           │                                   process request
                           │                                         │
                           │                     send stdout message to extension:
                           │                     {type: "new-add", payload}
                           ▼
                   Service Worker receives new-add
                           │
             open/focus UI tab; close launch page tab
                           │
                           ▼
                         [UI Page]
               show basic event timeline, payload info
```

---

# **4. Testing Plan (Minimal v0.1)**

## **A. Unit Tests (React Testing Library, Vitest)**

### Service Worker:

* When receiving `launch-ping`, calls `ensureOffscreenDocument()`.
* When receiving `new-add`, triggers UI opening logic.
* Unit test stubbed with mock `chrome.tabs` API.

### Offscreen:

* On receiving `start-native-host`, calls `connectNative`.
* Forwards messages from native host to SW.

### UI:

* Renders events correctly on receiving messages.
* Displays magnet and torrent payload summary.

---

## **B. Integration Tests (Playwright, local only)**

* Launch local chromium
* Load extension
* Serve launch page via `vite dev`
* Simulate `launch-ping` flow
* Simulate native host sending `new-add`
* Assert UI tab appears and displays mocked data

These do **not** yet involve real native host or stub.

---

## **C. Manual Full-System Test**

* Use real stub binary
* Use real native host
* Double-click a .torrent file
* Browser opens launch page
* Extension wakes host
* Stub POSTs
* UI page shows “new-add”

---

# **5. Implementation Phases (Recommended)**

### **Phase 1 – Internal messaging**

* launch page → SW → offscreen
* offscreen → SW → UI

### **Phase 2 – Native host integration**

* connectNative
* send/receive messages

### **Phase 3 – Stub integration**

* stub launches page
* stub POSTs and exits
* native host forwards event to extension
* UI displays it

### **Phase 4 – Real torrents**

* stub sends real torrent metadata
* UI parses and displays name, size, infohash

---

# **6. Deliverables**

* `launch.ts` (website): sends launch-ping
* `background.ts` (SW): coordinates offscreen + UI logic
* `offscreen.ts`: handles native host port
* `ui.tsx`: debugging view
* Unit tests for SW, offscreen, UI
* Minimal real torrent / magnet round-trip

---

# **7. Summary**

This design creates the **smallest working round-trip** from:

**Stub → Native Host → Extension → UI**

and gives you a clean framework to build out real torrent logic later.

It emphasizes:

* Pure message passing
* Clear process boundaries
* Testability at every step
* Fast iteration with Vite and local Playwright testing
* Minimal logic per component
* Maximal visibility via UI event log

