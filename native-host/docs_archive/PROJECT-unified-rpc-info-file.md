Below is the **clean, coherent, updated design document** focused on the **new unified `rpc-info.json` format**, the **native-host’s responsibilities**, and the **updated link-handler lookup flow**.
The document **does not** include the io-daemon sync mechanism (per your instruction) but leaves a placeholder noting that io-daemon will eventually read/sync from this same file.

This version is designed to be internally consistent and stand alone.

---

# JSTorrent Unified `rpc-info.json` Design

### *Native-Host, Link-Handler, and Profile Management*

## 1. Purpose

This document defines the structure and semantics of the **unified `rpc-info.json`** metadata file used by:

* The **native-host** (Chrome Native Messaging binary)
* The **link-handler** (magnet / .torrent system opener)
* Eventually, the **io-daemon** (future: will load/sync from this file)

The unified structure replaces the old model where multiple files existed, one per Chrome profile (e.g., `rpc-info-Default.json`).
Instead, **one file** contains an **array** of profile entries.

---

## 2. Goals

* Maintain a single durable metadata file for all profiles.
* Make it easy for:

  * Native-host to update *its own* profile block.
  * Link-handler to discover the most recently used host for launching UI.
  * io-daemon (later) to read profile metadata and download roots.
* Avoid storing any daemon-specific state (ports/tokens are now ephemeral).
* Support multi-profile Chrome use.
* Support multiple sets of download roots per profile.

---

## 3. File Location

Platform-specific config directory (unchanged from current implementation):

* **Windows:** `%LOCALAPPDATA%\jstorrent-native\rpc-info.json`
* **macOS:** `~/Library/Application Support/jstorrent-native/rpc-info.json`
* **Linux:** `~/.config/jstorrent-native/rpc-info.json`

Only **one** file exists in this directory.

---

## 4. Unified File Structure

### Top-level structure

```
{
  "version": 1,

  "profiles": [
    {
      "profile_dir": "Default",          // Stable Chrome internal profile folder name
      "extension_id": "bnceafpojmn...jk",

      "salt": "base64-128bits",          // Used to derive download-root tokens

      "pid": 31257,                      // Native-host process ID
      "token": "native-host-auth-token", // Host authentication token
      "started": 1764074065,
      "last_used": 1764074065,

      "browser": {
        "binary": "/opt/google/chrome/chrome",
        "name": "chrome"
      },

      "download_roots": [
        {
          "token": "sha1token1",         // Derived from canonical(path)+salt
          "path": "/home/user/Videos",
          "display_name": "Videos",
          "removable": false,
          "last_stat_ok": true,
          "last_checked": 1764074011
        }
      ]
    },

    {
      "profile_dir": "Profile 1",
      "...": "..."
    }
  ]
}
```

### Notes

* `profile_dir` is the **Chrome internal profile directory**, which is stable and does not change even if the user renames the visible profile.
* `extension_id` identifies the MV3 extension associated with this profile.
* `pid` and `token` represent the currently running native-host instance for that profile.
* `download_roots` is an array for the new multi-root model.

---

## 5. Native-Host Responsibilities

### 5.1 Selecting the profile entry

When native-host starts, the Chrome extension provides the **profile_dir** (or the native-host retrieves it via native messaging environment variables).

Native-host:

1. Loads `rpc-info.json`.
2. Searches `profiles[]` for matching `profile_dir`.
3. If not found:

   * Creates a new entry for this profile (`salt`, empty roots, no prior pid).
4. Updates the entry (pid, token, started, last_used, browser info, etc.).
5. Atomically writes the updated file.

### 5.2 Multi-profile safety

* Native-host **only updates its own profile entry**, never touching others.
* Atomic writes guarantee consistency.

### 5.3 Download root management

* All download roots for the current profile are stored in its own entry’s `download_roots` array.
* Native-host is responsible for:

  * Adding new roots
  * Removing roots
  * Validating and stat’ing roots
  * Computing tokens (sha1(canonical_path + salt))
* Any changes require rewriting `rpc-info.json`.

### 5.4 Relationship to io-daemon (informational, not yet implemented)

Later, io-daemon will:

* Read this file at startup
* Load its profile’s root metadata
* Refresh when instructed by native-host

But this design document does not cover the synchronization mechanism.

---

## 6. Link-Handler Behavior (Updated)

The link-handler’s current logic:

```
for file in config_dir:
    if filename starts with "rpc-info-":
        open file → parse RpcInfo → check pid alive → return
```

This must be replaced with logic that understands the **unified file**.

### New link-handler algorithm

1. Open `rpc-info.json`.
2. Parse into `RpcInfo`.
3. Look at `profiles[]`.
4. Sort entries by `last_used` descending.
5. For each profile entry (most recent first):

   * Check if `pid` refers to a running process.
   * If yes:

     * That native-host is active → return this profile entry.
6. If none are running:

   * Fallback: choose the entry with highest `last_used`.
   * Launch browser with `LAUNCH_URL#...` so extension can activate.

### Why this works

* Link-handler no longer must discover “one file per profile.”
* All metadata is centralized.
* Sorting by `last_used` preserves the previous “recent first” behavior.
* Fallback logic continues to work even when no host is running.

### Link-handler does **not** need download-root info.

It only cares about:

* `profile_dir`
* `extension_id`
* `browser.binary`
* `pid`

---

## 7. File Locking / Atomicity

Native-host must:

* Load entire file
* Modify its entry
* Write to a temporary file
* Atomically rename it over the original file

This ensures:

* Link-handler never reads a partial file
* io-daemon (in future) always reads coherent state

---

## 8. Future: io-daemon and rpc-info.json

Although not part of this revision:

* io-daemon will eventually read the unified file
* It will select `profile_dir` just like native-host does
* It will load the `download_roots` list and other profile metadata
* It will re-read this file when instructed by the native-host

But for now, the design focuses only on formatting and host/link-handler usage.

---

## 9. Summary

### What changed

* Old model:

  * Multiple files: `rpc-info-Default.json`, `rpc-info-Profile1.json`, etc.
  * Link-handler scanned directory for files.

* New model:

  * Single file: `rpc-info.json`
  * Contains `profiles: [ … ]`
  * Native-host updates only its own entry
  * Link-handler picks most recent profile or the one with running pid
  * Download roots unified under the correct profile entry
  * Simpler, more consistent, more extensible

### Benefits

* Cleaner design
* Flat structure easy to parse
* No awkward filename-based profile identification
* More resilient error cases in link-handler
* Per-profile isolation maintained but metadata unified
