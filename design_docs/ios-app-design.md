Below is a **clean, executive-level design doc / product overview** for the **JSTorrent iOS companion app**, written to be readable by both engineering and product stakeholders.

This explains:

* Why a native iOS app is the *only viable* option
* Core user flows
* Architecture overview
* High-level technical constraints
* App Store-safe positioning

---

# **JSTorrent iOS App – Product Overview & Design Document**

## **1. Purpose**

The JSTorrent iOS app provides a **remote control interface** for the JSTorrent desktop daemon.
It allows iPhone/iPad users to:

* Add magnet links / torrents to their desktop instance
* Monitor download progress
* Prioritize files or specific ranges
* Manage queues and settings
* Stream completed or in-progress video files directly from the desktop daemon

The iOS app **does not** run a BitTorrent engine.
It serves exclusively as a **remote UI**, fully compliant with App Store policies.

---

# **2. Why a Native iOS App Is the Only Viable Option**

### **2.1 Local Network Discovery**

Only native apps can use:

* **mDNS/Bonjour** to automatically discover the daemon
* **Local Network Entitlement** to connect to LAN services

Safari/PWA cannot discover or access the daemon automatically.

---

### **2.2 Mixed-Content Restrictions**

Web apps loaded via HTTPS **cannot** fetch or stream from daemon’s HTTP endpoints on LAN due to mixed-content blocking.

Native apps **can** access `http://<LAN-IP>:PORT` directly.

---

### **2.3 Streaming Requirements**

To support:

* video playback (`Range` requests)
* partial streaming (e.g., MP4 header at end)
* resuming mid-file

Native iOS uses **AVPlayer** and direct HTTP.
Web apps cannot perform this against a LAN daemon unless it supports HTTPS with a real CA certificate—impractical for local devices.

---

### **2.4 Secure Persistent Pairing & Tokens**

Native Keychain provides:

* strong secret storage
* QR-code pairing workflow
* seamless reconnect

Web apps rely on localStorage/cookies—not secure enough for local network control.

---

### **2.5 App Store Compliance**

Native iOS apps are allowed to function as **remote control clients** as long as:

* They do **not** include torrenting logic
* They do **not** connect to peers
* They do **not** parse `.torrent` files
* They only control remote software

This fits JSTorrent’s architecture perfectly.

---

# **3. Target Audience & Value**

### **For existing JSTorrent users**

* Control torrents without sitting at the computer
* Stream downloaded media to iPhone/iPad
* Manage priorities and ranges from anywhere on LAN or remotely

### **For new users**

* Simple “desktop + iPhone” torrenting workflow
* Video playback without moving large files around
* Unified remote control interface

---

# **4. Key Features**

## **4.1 Automatic Local Discovery**

* Use **Bonjour/mDNS** to detect desktop daemon instances:

  * `jstorrent-daemon._http._tcp.local`
* Display available devices in a friendly device picker

---

## **4.2 Secure Local Pairing**

* Daemon displays a **one-time pairing code** or QR code
* User scans or enters code in the app
* App receives:

  * host IP
  * port
  * daemonAuthToken
* Stored in Keychain

---

## **4.3 Remote Torrent Control**

The app displays:

* Active torrents
* Download / upload speeds
* Piece availability maps
* File list & priorities
* Per-torrent settings
* Overall queue controls

Commands:

* Add magnet/torrent
* Start/stop/pause
* Remove
* Change priority
* Force recheck
* Sequential/range priority

---

## **4.4 Video and File Streaming**

The app can:

* Play downloaded or partially downloaded files using AVPlayer
* Resume from any position (daemon handles missing-range blocking)
* Stream to external displays via AirPlay

---

## **4.5 Remote Operation (optional)**

If user configures:

* Port-forwarding
* Tailscale/ZeroTier
* Or a simple relay discovery system (non-proxy)

The app can operate their desktop remotely.

---

# **5. Architecture**

## **5.1 Components**

* **iOS App (SwiftUI)**

  * UI and control logic
  * AVPlayer streaming
  * Pairing and secure token storage
  * LAN communication
* **JSTorrent Desktop Daemon**

  * HTTP server for file I/O & streaming
  * WebSocket server for torrent state updates
  * Authentication token generation
* **Native Host (desktop)**

  * Manages daemon lifecycle
  * Communicates with browser extension
* **Browser Extension (desktop)**

  * Runs torrent engine logic
  * Uses daemon for I/O

---

## **5.2 Communication Paths**

### **iOS App → Daemon**

* **HTTP API**

  * `/torrents` (list)
  * `/torrents/{id}` (update)
  * `/files/{id}` (browse)
  * `/stream/{fileId}` (Range-enabled streaming)

* **WebSocket API**

  * Real-time torrent updates
  * File availability updates
  * Range blocking/unblocking

### **Daemon → iOS App**

* JSON WS event stream
* HTTP file range responses
* Streaming video bytes

---

# **6. User Flows**

## **Flow 1 – Pairing**

1. User installs desktop extension + daemon
2. Opens iOS app
3. App autodiscovers daemon via mDNS
4. User taps device → sees QR code on desktop
5. Scan → paired
6. App now shows torrent dashboard

---

## **Flow 2 – Add Torrent**

1. User taps “Add Download”
2. App accepts magnet link (pasted or scanned QR)
3. Sends to daemon’s `/add` endpoint
4. Torrent appears in list

---

## **Flow 3 – Streaming a Video**

1. User taps a completed or partially completed file
2. AVPlayer requests byte ranges
3. Daemon blocks until data is available
4. App streams video smoothly
5. Seeks prompt downloading of required pieces

---

## **Flow 4 – Remote Operation**

1. User connects via Tailscale or external address
2. App uses same tokens & endpoints
3. Control UI works identically remotely

---

# **7. Technical Constraints**

* No torrent protocol logic in iOS app
* No `.torrent` parsing
* No peer or tracker connectivity
* All torrent metadata stored/managed on desktop
* iOS app only performs RPC and playback
* Cloud backend optional (only for discovery, not relay)

---

# **8. Benefits**

### **For users**

* Seamless local-first torrent management
* Instant streaming to phone/tablet
* No need to shuffle files manually
* Zero cloud storage required
* Fully private, LAN-only, encrypted RPC

### **For developers**

* Clear separation of responsibilities
* Minimal iOS complexity
* No App Store rejection risk
* Reuses same daemon API as web or desktop UIs

---

# **9. Summary**

A **native iOS remote control app** is the only fully viable option due to:

* mDNS support
* Local Network access
* No mixed-content blocking
* Secure token storage
* AVPlayer streaming
* Freedom from App Store rejection (control-only)

It enables a seamless “phone as remote, desktop as torrent engine” experience with full streaming support and minimal setup.
