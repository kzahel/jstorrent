**Design Document: Magnet Protocol + Local RPC Integration
for `jstorrent-native-host`**

---

## 1. Overview

`jstorrent-native-host` currently provides:

- A Rust **native messaging host** used by a Chrome extension.
- Installers for **Windows**, **macOS**, and **Linux**.

New requirements:

1. Add a **local RPC server** inside the native host (HTTP on `127.0.0.1`) for internal IPC.
2. On startup, the native host must write a **discovery file** (`rpc-info`) with:
   - RPC port
   - PID
   - random token
   - Chrome profile info
   - browser executable path

3. Introduce a separate **protocol handler stub binary** that:
   - Is registered as the OS handler for `magnet:` URIs.
   - Reads the discovery file.
   - Tries to communicate with the native host via RPC.
   - If RPC fails, falls back to launching the appropriate browser + profile with a URL that the extension knows how to handle.

4. Update installers (Win/macOS/Linux) to register the **`magnet:` protocol handler** pointing to the stub binary.

---

## 2. Goals and Non-Goals

### Goals

- Allow users to click `magnet:` links from **any application**, not just Chrome.
- If the native host is already running:
  - Handle `magnet:` purely via **local RPC**, with no browser UI.

- If the native host is not running:
  - Launch the browser + profile that the user most recently used with the extension.
  - Allow the extension to start the host and then handle the magnet.

- Support **multiple Chrome profiles** in a reasonable way.
- Maintain a clear separation of roles:
  - Native host: extension ↔ torrent engine bridge + RPC server.
  - Stub: OS protocol handler and “entry point” for magnets.

### Non-Goals

- Do not attempt to secure against fully compromised local machines.
- Do not implement cross-user multi-tenant support; design is per-OS-user.
- Do not attempt to manage browser installations globally (only those the user actually uses with the extension).

---

## 3. High-Level Architecture

### Components

1. **Chrome Extension**
   - Uses **native messaging** to talk to `jstorrent-native-host`.
   - Optionally uses an offscreen document to keep the host alive for long-running operations.

2. **Native Messaging Host (`jstorrent-native-host`)**
   - Launched by Chrome via native messaging.
   - On startup:
     - Binds a local HTTP server on `127.0.0.1:0` (ephemeral port).
     - Writes `rpc-info-<profile>.json` with port, PID, token, browser and profile metadata.

   - Handles two channels:
     - **Native messaging** from the extension.
     - **HTTP RPC** from the protocol stub (and possibly other local tools).

3. **Protocol Handler Stub (`jstorrent-magnet-stub`)**
   - Registered as OS handler for `magnet:` URLs.
   - When invoked:
     - Attempts to read and validate `rpc-info` for the relevant profile(s).
     - If valid and RPC responds:
       - POSTs the magnet to the running host.

     - Otherwise:
       - Launches the correct browser and profile (from `rpc-info` or fallback heuristic) with a `chrome-extension://` URL containing the magnet.

4. **Installers**
   - Install the native host binary + manifest.
   - Install the stub binary.
   - Register `magnet:` protocol handler pointing to the stub.
   - (Optionally) store uninstall / repair information.

---

## 4. Discovery File (`rpc-info`) Design

### Location

We’ll use a **per-user config directory**, with one file per Chrome profile.

- Windows:
  `%LOCALAPPDATA%\jstorrent-native-host\rpc-info-<profile-id>.json`
- macOS:
  `~/Library/Application Support/jstorrent-native-host/rpc-info-<profile-id>.json`
- Linux:
  `~/.config/jstorrent-native-host/rpc-info-<profile-id>.json`

> `<profile-id>` is a stable identifier for the Chrome profile, e.g. `"Default"`, `"Profile 1"`, `"Work"`. Derived from environment or parent process command line.

### JSON Schema (version 1)

```json
{
  "version": 1,
  "pid": 12345,
  "port": 54231,
  "token": "bdcd511e3aa3ea091a9c251dd0bd0754a3becdfde51160b7d95b14169cbca94f",
  "started": 1732191000,
  "last_used": 1732191050,

  "browser": {
    "name": "Google Chrome",
    "binary": "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "profile_id": "Default",
    "profile_path": "C:\\Users\\User\\AppData\\Local\\Google\\Chrome\\User Data\\Default",
    "extension_id": "abcdefghijklmnopabcdefghijklmnop"
  }
}
```

### Fields

- `version`: format version.
- `pid`: OS process ID of the native host.
- `port`: TCP port on `127.0.0.1` where RPC server listens.
- `token`: random per-session secret (128–256 bits).
- `started`: UNIX timestamp when host process started.
- `last_used`: updated when host receives real work (from extension or stub).
- `browser.name`: human-friendly name (Chrome, Chromium, Brave, etc.).
- `browser.binary`: path to browser executable that launched the host.
- `browser.profile_id`: logical profile name string.
- `browser.profile_path`: full profile directory path (optional but useful).
- `browser.extension_id`: ID of the extension using this host.

---

## 5. Native Host Changes

### 5.1 Startup Flow

On startup, `jstorrent-native-host` will:

1. **Determine browser + profile info**
   - Infer browser executable path via parent process inspection.
   - Infer profile id/path via environment or Chrome command line (`--profile-directory`).
   - Infer extension ID via native messaging context (known at build time per browser store).

2. **Start RPC server**
   - Bind: `127.0.0.1:0` (ephemeral).
   - Retrieve bound port.
   - Generate secure random `token` (256-bit).
   - Save `pid = current process ID`.
   - Initialize `started` and `last_used`.

3. **Write `rpc-info-<profile>.json`**
   - Ensure directory exists.
   - Overwrite any existing file for this profile.
   - Write JSON atomically:
     - Write to temp file, then rename.

4. **Enter main loop**
   - Handle native messaging traffic from Chrome.
   - Handle HTTP RPC requests on the bound port.

### 5.2 RPC HTTP API

All endpoints must require the `token`, passed via query parameter or header.

**Base URL**

- `http://127.0.0.1:<port>/`

**Endpoints (initial set)**

1. `GET /health?token=<token>`
   - Response: `{ "status": "ok", "pid": <pid>, "version": 1 }`
   - Used by stub to check host liveness.

2. `POST /add-magnet?token=<token>`
   - Body: JSON `{ "magnet": "magnet:?xt=urn:btih:..." }`
   - Response: `{ "status": "queued" | "error", "message": "..." }`
   - Host forwards this internally (or through extension) to torrent engine.

3. `GET /status?token=<token>`
   - Optional, mainly for debugging or future tools.

> The first version can keep RPC minimal: `health` + `add-magnet`.

### 5.3 Native Messaging Channel

- Existing behavior is preserved: extension uses `chrome.runtime.connectNative("com.jstorrent.native_host")`.
- Host logic should unify requests coming from:
  - Native messaging (extension)
  - RPC HTTP (stub)

- Both eventually feed a common internal “torrent engine controller”.

### 5.4 PID Validation Logic (from Stub’s Perspective)

The host itself just writes `pid`.
Stub will:

1. Read `rpc-info-<profile>.json`.
2. Check if PID is alive and executable matches expected host binary.
3. If check fails, treat host as offline.

---

## 6. Protocol Handler Stub Design

### 6.1 Responsibilities

- Registered OS-wide as handler for `magnet:` URLs.
- On invocation with a `magnet:` argument:
  1. Try to connect to an existing native host via RPC.
  2. If successful, send `add-magnet` and exit silently.
  3. If unsuccessful, launch the correct browser/profile with a URL that triggers the extension path.

### 6.2 Stub Magnet Flow

1. Parse CLI arguments to obtain `magnet:?…`.
2. Read all relevant `rpc-info-*.json` files:
   - Filter by:
     - Existing file.
     - Recently `started`.

   - For each candidate:
     - Validate PID (is the process alive and path matches host binary?).
     - `GET /health?token=...`.

   - Prefer:
     - Hosts that pass `health`.
     - If more than one valid:
       - Prefer most recent `last_used`.

3. If any valid host responds:
   - `POST /add-magnet?token=...` with the magnet.
   - Exit with success.

4. If no host is available:
   - Choose a profile to launch:
     - Prefer most recently `last_used` `rpc-info-*`.
     - If none exists: use default browser detection logic (e.g., Chrome stable, etc.).

   - Launch chosen browser executable with:
     - `chrome-extension://<extensionId>/magnet-handler.html?magnet=<urlencoded-magnet>`
     - Optionally, also pass `--profile-directory=<profile_id>` if we know it.

   - Exit after successful process spawn.

### 6.3 Error Handling

- If stub cannot find or launch any browser:
  - Show a small error dialog (platform-specific) or print to stderr.

- If stub cannot parse magnet:
  - No-op or show error.

---

## 7. Installer Changes

### 7.1 Windows

- Install:
  - `jstorrent-native-host.exe` (native host).
  - `jstorrent-magnet-stub.exe` (protocol handler).

- Register native host (existing behavior).
- Register protocol handler in registry:

Under `HKEY_CLASSES_ROOT\magnet\shell\open\command`:

- Command: `"C:\Program Files\JSTorrent\jstorrent-magnet-stub.exe" "%1"`

Also ensure a proper `URL Protocol` key under `HKEY_CLASSES_ROOT\magnet`.

### 7.2 macOS

- Bundle `jstorrent-magnet-stub` into `.app` or as a registered helper.
- Use `Info.plist` with:
  - `CFBundleURLTypes` supporting `magnet` scheme.

- On `open "magnet:..."`, stub is invoked; stub executes logic described in §6.2.

### 7.3 Linux

- Install stub binary (e.g., `/usr/local/bin/jstorrent-magnet-stub`).
- Install a `.desktop` file with:

```ini
[Desktop Entry]
Name=JSTorrent Magnet Handler
Exec=/usr/local/bin/jstorrent-magnet-stub %u
Type=Application
MimeType=x-scheme-handler/magnet;
```

- Run `xdg-mime` to associate `magnet` with the desktop entry.

---

## 8. Multiple Chrome Profiles Behavior

### Current Design Intent

- One `rpc-info-<profile>.json` per profile.
- Each Chrome profile that loads the extension spawns its own native host.
- Each native host instance writes its own discovery file and listens on its own port.

### Behavior

- If user uses multiple profiles at once:
  - They have separate engines (by design).
  - Stub may choose a specific profile:
    - Prefer the profile whose native host is currently alive.
    - If multiple: prefer last-used (most recent `last_used` timestamp).

- If no hosts are running:
  - Stub picks the profile with most-recent `last_used`, and launches that browser + profile.

This is a reasonable approximation that favors the user’s most recent real usage.

---

## 9. Security Considerations

- RPC server binds to `127.0.0.1` only.
- `token` is a random 128–256 bit value for each host session.
- `rpc-info-*.json` is per-user, stored in user-writable directories.
- Only requests with correct `token` are honored.
- PID validation prevents connecting to unrelated processes that re-use the PID.
- No extra encryption is added (no meaningful benefit for localhost-only IPC given this threat model).

---

## 10. Migration and Compatibility

- Existing native host behavior remains compatible:
  - Extension continues to function as before.

- New behavior is additive:
  - Hosts will start writing `rpc-info`.
  - Stub can be rolled out later; extensions will still work without stub.

- Installers must be updated to:
  - Install the stub.
  - Register `magnet:` handler.

- Old installations without stub will simply not intercept `magnet:` until reinstalled/updated.

---

## 11. Open Questions / Future Enhancements

1. **Handling non-Chrome Chromium-based browsers**
   - When host is launched from Brave / Vivaldi / Edge:
     - Should we treat them as fully supported if extension installed there?

   - This can be discovered once we see real usage.

2. **User-visible configuration**
   - Whether to let user choose a “preferred browser/profile” via a UI in the extension.
