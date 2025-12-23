---

# JSTorrent Native Host Subsystem

### *Design Document (Rewritten with UX, IPC, and Multi-Component Coordination Model)*

## 1. Purpose and Scope

The JSTorrent “native stack” consists of Rust binaries that work together with a Chrome extension (Manifest V3) to provide filesystem and networking capabilities, handle link association, and coordinate UX flows across OS, browser, and optional remote-control applications (Android/iOS).

This document specifies:

* `jstorrent-native-host` (the Chrome extension’s native messaging host; responsible for coordination, config, discovery, lifecycle).
* `jstorrent-io-daemon` (process providing socket and filesystem syscalls via HTTP + WebSocket).
* `jstorrent-link-handler` (system-level magnet/`.torrent` handler used when users click magnet links or open `.torrent` files outside Chrome).
* The **rpc-info** discovery mechanism and configuration directory layout.
* UX flows, security constraints, authentication tokens, download root management, and inter-process coordination rules across Windows/macOS/Linux.

This design supports future **external controllers** such as an Android or iOS “remote control” app. Those clients can discover the system either locally or through cloud-hosted relays, but the design of such relays is outside the scope of this document.

---

## 2. Architectural Overview

### 2.1 Components

* **Chrome extension (MV3)**

  * Controls the BitTorrent engine.
  * Communicates with `jstorrent-native-host` over native messaging.
  * Discovers and connects to the IO daemon using info provided by the native host.
  * Manages user UI for selecting download roots and triggering native-host operations.

* **jstorrent-native-host**

  * The coordination process launched exclusively by Chrome via `chrome.runtime.connectNative`.
  * Manages lifecycle of `jstorrent-io-daemon` (spawning it as a child process; daemon terminates when the service worker becomes inactive).
  * Creates and maintains the **native-host rpc-info** file.
  * Stores user-selected download roots, each assigned a stable persistent token.
  * Communicates IO daemon’s listening port and auth tokens back to the extension.
  * Central authority for discovery.

* **jstorrent-io-daemon**

  * Child process of native-host.
  * Provides high-performance socket APIs (primarily via WebSocket) and filesystem APIs (mostly via HTTP).
  * Reads the rpc-info file but **never writes configuration**.
  * At startup informs the native-host of its bound port and daemon-specific authentication token.
  * Supports multiple independent download roots; each request specifies which root to operate on.

* **jstorrent-link-handler**

  * OS-level handler for `magnet:` and `.torrent` file types.
  * Uses rpc-info to detect a running native-host.
  * If native-host is not reachable, launches the configured browser with a **LAUNCH_URL** webpage that has `externally_connectable` permissions.
  * The webpage then handles UX flows, including onboarding, extension installation states, outdated/misconfigured native components, or extension-disabled scenarios.

* **Remote control apps (Android/iOS)** — future extension

  * May discover native-host either locally or via cloud relay, using the same rpc-info metadata or tokens communicated through a pairing mechanism.

---

## 3. Configuration Directory and Files

### 3.1 Platform Paths

Current implementation (unchanged):

* **Windows:** `%LOCALAPPDATA%\jstorrent-native\`
* **macOS:** `~/Library/Application Support/jstorrent-native/`
* **Linux:** `~/.config/jstorrent-native/`

### 3.2 Files

* **`rpc-info.json`**
  Authored **exclusively** by `jstorrent-native-host`. Stores discovery information

* **`jstorrent-native.env`**
  Developer overrides. Supported variables:
  * `DEV_ORIGINS` - Comma-separated list of origins allowed for CORS in io-daemon (e.g., `http://local.jstorrent.com:3001`). Used for localhost dev server with HMR.
  * `LAUNCH_URL` - Override for local development.
  * Logging configuration.

* **Download root metadata file**
(Not yet implemented)
  Stores list of user-selected download roots, each with:

  * Opaque stable token (e.g., `sha1(realpath + salt)`).
  * Path.
  * Display name.
  * Metadata such as whether the path was removable / external storage.
  * Last validation status.

* **Logs**
  `native-host.log`, `io-daemon.log`, `link-handler.log`.

---

## 4. native-host RPC Info File

### 4.1 Purpose

The rpc-info file is used mainly by:

* **jstorrent-link-handler**: to determine whether a native-host is running
* **Extensions or controllers**: to identify a running native-host
* **io-daemon**: to read discovery metadata and the authentication token needed to talk to native-host.

### 4.2 Structure (current baseline)

```
{
  "version": 1,

  "profiles": [
    {
      "install_id": "c0e3d61a-db53-4f8e-ac67-89cac9c9e67b",
      "extension_id": "dbokmlpefliilbjldladbimlcfgbolhk",

      "salt": "base64-128bits",

      "pid": 31257,
      "token": "native-host-auth-token",
      "started": 1764074065,
      "last_used": 1764074065,

      "browser": {
        "binary": "/opt/google/chrome/chrome",
        "name": "chrome"
      },

      "download_roots": [
        {
          "token": "sha1token1",
          "path": "/home/user/Videos",
          "display_name": "Videos",
          "removable": false,
          "last_stat_ok": true,
          "last_checked": 1764074011
        }
      ]
    }
  ]
}
```

### 4.3 Clarifications

* **No io-daemon info belongs here.**
  io-daemon communicates its port and token directly to native-host, not via file writes.

* **Extension ID is required** unless trivially discoverable from current profile context.

* **Profile-specific isolation:**
  The rpc-info file is tied to the Chrome profile that launched the native-host. Different profiles maintain separate files and download-root lists. They use an install_id which is randomly
  generated by the extension at install time. Chrome's sandboxing
  model doesn't let us identify the specific Chrome profile.

---

## 5. Download Root Management

### 5.1 Philosophy

The system no longer uses simple “Set/GetDownloadRoot.”
Instead:

* Users maintain a **list of persistent download roots**.
* Each root is assigned a **stable opaque token** derived from `(resolved_path + salt)`.

  * This prevents tokens from leaking the true path.
  * Stability allows re-selecting the same root and resuming torrents.
* The extension stores these tokens (similar to Chrome’s `retainEntry/restoreEntry` model).

### 5.2 API operations (via native-host)

* `SelectNewDownloadRoot`

  * Requires a **user gesture** from the extension UI.
  * Prompts repeatedly until a valid directory is chosen.
  * Creates a new root entry (or returns existing token if root already known).

* `DeleteDownloadRoot`

  * Removes a root; revokes native-host and io-daemon access to it.
  * Existing torrents seeding from that location become invalid.

* `ListDownloadRoots`

  * Returns entries, including stat information when available.
  * Missing/disconnected external drives should be flagged.
  * Optional OS metadata: removable volume, external drive, etc.

### 5.3 Passing roots to the io-daemon

All IO operations carry:

```
{ root_token: "...", relative_path: "...", ... }
```

io-daemon verifies that the token is known and that the path resolves strictly under the assigned root.

---

## 6. jstorrent-native-host

### 6.1 Responsibilities

* Handle Native Messaging handshake and messages from the extension.
* Spawn and supervise `jstorrent-io-daemon` **as a child process**.

  * It shares lifecycle with the service worker.
  * Terminates automatically when not needed.
* Write and maintain `rpc-info.json`.
* Manage download roots and their tokens.
* Provide the extension with:

  * IO daemon port.
  * IO daemon authentication token.
  * Config metadata.

### 6.2 Security

* All outbound info is given **only to the extension that invoked the host**.
* io-daemon requests must contain:

  * The daemon-specific auth token.
  * Headers identifying that the request originates from the Chrome extension.
* ipc boundaries rely on:

  * Loopback-only servers.
  * Extension-origin enforcement.

### 6.3 Lifecycle

* Extension sends `EnsureIoDaemon` → native-host spawns or reuses child.
* io-daemon notifies native-host of bound port + token.
* native-host forwards that to the extension via structured response.
* When Chrome unloads the service worker, the native-host process ends → io-daemon ends.

---

## 7. jstorrent-io-daemon

### 7.1 Binding and startup

* Reads rpc-info to authenticate itself to native-host.
* Binds to an ephemeral loopback port.
* Generates a **daemon-specific auth token** (separate from native-host token).
* Immediately notifies native-host (via a direct IPC channel) of:

  * Bound port
  * Daemon auth token

### 7.2 Protocols

* **WebSocket**

  * Primary channel for socket operations.
  * May handle lightweight file reads when seeding (offset/len reads).
  * Requires extension-origin headers + daemon token.

* **HTTP**

  * Used for higher-latency or bulk operations:

    * Write pieces to disk (POST).
    * Filesystem metadata (stat/list/remove).
    * Optional: high-performance hashing endpoint (if implemented here rather than native-host).

* **No HTTP networking operations.**
  All networking (TCP/UDP) must go via WebSocket.

### 7.3 Multiple download roots

* io-daemon accepts filesystem `root_token` on each request.
* Validates that the root exists and is currently accessible.
* Can return status codes indicating:

  * Device disconnected.
  * Permission denied.
  * Invalid token.

---

## 8. jstorrent-link-handler

### 8.1 Behavior when user opens magnet/`.torrent`

1. The handler reads `rpc-info.json`.

2. Attempts to communicate with native-host using stored token and current pid.

3. **If a native-host is reachable**:

   * Forwards the magnet or file path to the extension via native-host RPC.

4. **If no native-host is reachable**:

   * Launches the most recently used browser with:

     ```
     LAUNCH_URL#magnet=<url-encoded>
     LAUNCH_URL#torrent_path=<url-encoded-path>
     ```
   * **Sensitive data is placed in the fragment (`#`), not the query string**, so it never leaves the machine.
   * The webpage:

     * Is externally_connectable to the extension.
     * Detects whether the extension is installed/enabled.
     * Handles onboarding and misconfiguration flows.
     * Once extension is active, extension spawns the native-host.

### 8.2 Native-host cannot be launched directly

The link handler **cannot** invoke the Chrome native host.
Only the Chrome extension can do so (via native messaging).
Thus launching the LAUNCH_URL page is the fallback for all “native-host is not running” conditions.

---

## 9. Extension Interaction Model

* All torrent-addition logic lives in the **extension**.
* The extension uses tokens for download roots.
* Extension communicates exclusively with the native-host; never directly with rpc-info.
* When native-host returns IO daemon details, the extension binds to that daemon and begins performing socket/filesystem operations.

---

## 10. io-daemon ↔ native-host Interaction

* io-daemon reads rpc-info for initial auth info.
* io-daemon never writes configuration files.
* On startup:

  * io-daemon establishes secure channel back to native-host.
  * Communicates port + daemon token.
  * Waits for native-host to acknowledge.
* Native-host then communicates this info to the extension.
* io-daemon reads rpc-info.json for download roots
* io-daemon listens for native-host to tell it to refresh the config in 
  case the download roots change.

---

## 11. Testing Strategy

* Integration tests that spawn:

  * native-host and io-daemon.
  * fake extension clients.
  * link-handler scenarios (with missing native-host, outdated rpc-info, etc.).
* Tests for removable/external drive behavior.
* Tests for multi-root security restrictions.
* Tests for origin enforcement on io-daemon HTTP/WebSocket endpoints.
* Tests for detached browser state (extension disabled, misconfigured native-host).

---

## 12. Future Extensions

* Support pairing flows for Android/iOS remote controllers via cloud relays.
* Provide hashing endpoints in native-host or io-daemon depending on performance evaluation.
* More robust multi-drive lifecycle (eject notifications, auto-invalidate).
