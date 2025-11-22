## 1. Purpose

Extend `jstorrent-native-host` so that the same “magnet launcher” mechanism also supports `.torrent` files, without losing any metadata, and without introducing race conditions.

This design covers:

* How the **stub launcher** handles both `magnet:` and `.torrent` invocations.
* How the **native host** RPC surface is extended.
* How **health checks** and `rpc-info` are used to avoid races.
* How the **Chrome extension** uses the `tabs` permission so the main UI is visible after launch in both magnet and `.torrent` cases.

---

## 2. Current architecture (magnet only)

Today the system looks like this:

* OS registers a **stub launcher binary** (`jstorrent-launcher`) as the handler for `magnet:` URLs.
* When a `magnet:` link is opened, the OS invokes the stub with the magnet URI.
* The stub:

  * Attempts to talk to an already-running **native host** over a local RPC HTTP port (`127.0.0.1:<port>`).
  * If the host is running, it calls `POST /add-magnet`.
  * If not, it launches Chrome with a `chrome-extension://{id}/handler.html?...` URL to wake up the extension.
* The Chrome extension:

  * Via service worker + offscreen document, starts the **native host** using `chrome.runtime.connectNative`.
* The native host:

  * On startup, binds an HTTP port.
  * Writes `rpc-info-<profile>.json` (port, pid, token, profile).
  * Responds to `/health` and `/add-magnet`.

---

## 3. New requirement: handle `.torrent` files

We want:

* OS to invoke the **same stub** when a `.torrent` file is opened.
* Stub to deliver the **full .torrent contents** to the native host, not just an infohash.
* Preserve **private tracker** and all bencoded metadata.
* Avoid race conditions between:

  * stub startup,
  * native host startup,
  * and extension/Chrome startup.

We will not pass `.torrent` contents via URL or command line. Everything is passed through via the **RPC POST body** from stub → host

---

## 4. Invocation modes for the stub launcher

The launcher now has two invocation modes:

1. **Magnet handler mode**

   * Invoked with a `magnet:?…` URI.
   * Example (Windows):
     `jstorrent-launcher.exe "magnet:?xt=urn:btih:..."`
2. **.torrent file mode**

   * Invoked with a path to a `.torrent` file.
   * Example:
     `jstorrent-launcher.exe "C:\Users\...\Downloads\somefile.torrent"`

The stub needs to:

* Distinguish arguments:

  * If `argv[1]` starts with `"magnet:..."` → magnet mode.
  * Otherwise treat it as a filesystem path (`.torrent` mode).

---

## 5. Common stub boot sequence (both modes)

The stub should use a unified structure:

1. **Parse input**

   * If magnet mode:

     * Extract magnet URI string as `magnet`.
   * If `.torrent` mode:

     * Extract file path as `torrent_path`.

2. **Read payload early (for `.torrent`)**

   * In `.torrent` mode, read file bytes **immediately**:

     * `bytes = read_all(torrent_path)`
     * If read fails, show error and exit.
   * This avoids later issues if the file is moved or deleted while waiting for the host.

3. **Ensure native host is running**

   * Attempt to load `rpc-info-*.json`.
   * If none exists:

     * Launch Chrome with the extension handler URL:

       * Example:
         `chrome --profile-directory=Default "chrome-extension://{id}/magnet/magnet-handler.html?source=stub"`
   * Enter a polling loop waiting for `rpc-info` to be created.

4. **Read `rpc-info` once it exists**

   * Parse JSON:

     * `port`
     * `token`
     * `pid`
     * (optional) profile information

5. **Poll `/health`**

   * Repeatedly call:

     * `GET http://127.0.0.1:<port>/health?token=<token>`
   * Until:

     * Success (HTTP 200 with expected JSON), or
     * Timeout is reached (e.g., 10–15 seconds) → show error and exit.

6. **Send the actual work request**

   * **Magnet mode**:

     * `POST /add-magnet?token=<token>`

       ```json
       {
         "magnet": "magnet:?xt=urn:btih:..."
       }
       ```
   * **.torrent mode**:

     * `POST /add-torrent?token=<token>`

       ```json
       {
         "file_name": "somefile.torrent",
         "contents_base64": "<base64-encoded-bytes>"
       }
       ```

       (Optionally also include the original path for logging.)

7. **Exit**

   * After a successful 2xx response (or best-effort with reasonable retries), stub exits.
   * Stub remains invisible and is allowed to stay alive for several seconds while waiting.

This pattern is race-free and identical for magnet and `.torrent` once `rpc-info` exists.

---

## 6. Native host changes

### 6.1 `rpc-info` responsibility

* The **native host** is the only writer of `rpc-info-<profile>.json`.
* On startup:

  * Bind TCP on `127.0.0.1:0` (ephemeral port).
  * Generate random token.
  * Resolve profile metadata (profile ID, browser binary, extension ID).
  * Atomically write `rpc-info-<profile>.json`:

    ```json
    {
      "version": 1,
      "pid": 12345,
      "port": 54231,
      "token": "abcd...random...",
      "started": 1732191000,
      "browser": {
        "binary": "...",
        "profile_id": "Default",
        "extension_id": "...",
        ...
      }
    }
    ```
  * Start HTTP server and respond to `/health`.

### 6.2 Health endpoint (unchanged semantics)

* `GET /health?token=<token>`:

  * Returns 200 with small JSON (status, pid, version) when host is ready.
  * Non-200 or network error indicates host is not ready or token mismatch.

### 6.3 New RPC endpoint: `/add-torrent`

Add a new endpoint for `.torrent` handling:

* `POST /add-torrent?token=<token>`

Request example:

```json
{
  "file_name": "somefile.torrent",
  "contents_base64": "<base64-of-raw-torrent-file>"
}
```

Behavior:

1. Decode base64 into raw bytes.
2. Parse bencoded torrent metadata.
3. Add torrent to the engine:

   * Use metadata as authoritative:

     * Infohash
     * Trackers
     * Private flag
     * Web seeds
     * Piece length
     * Files info
4. Return JSON result:

   ```json
   {
     "status": "ok",
     "torrent_id": "<internal-id>",
     "infohash": "<...>",
     "message": "added"
   }
   ```

Magnet handling remains via `/add-magnet`:

* `POST /add-magnet?token=<token>`

  ```json
  { "magnet": "magnet:?xt=urn:btih:..." }
  ```

---

## 7. Race-condition robustness

### 7.1 Stub vs. native host startup order

Case A: Host already running

* Stub finds `rpc-info` immediately.
* Stub calls `/health`, then `/add-*`.

Case B: Host not running

* Stub launches Chrome handler URL.
* Extension starts native host.
* Native host writes `rpc-info`, starts HTTP server.
* Stub sees `rpc-info`, then `/health` starts succeeding.
* Stub then `/add-*`.

In both cases, the stub **does not** send the torrent data until:

* `rpc-info` exists
* `/health` responds with valid status

Therefore, there is no window where:

* Stub "drops" a torrent because host hasn't started yet.
* Host starts before stub writes or vice versa; either order works.

### 7.2 Multiple stubs / concurrent opens

User double-clicks several `.torrent` files quickly:

* OS spawns several stub processes.
* All stubs:

  * Read their respective `.torrent` bytes.
  * If host is not running:

    * All attempt to launch Chrome (Chrome deduplicates application instance).
  * All then wait for `rpc-info` and `/health`.
  * Once host is healthy:

    * Each stub posts its own `/add-torrent` request.

No torrent is lost; there is no conflict. Host handles each request independently.

### 7.3 Chrome startup races

Even if Chrome starts slowly:

* Stubs simply keep waiting for `rpc-info` and `/health` within their timeout window.
* If host never comes up, stub eventually reports failure—but does not silently drop data.

---

## 8. Extension behavior and `chrome.tabs` permission (UI visibility)

Once stub has launched Chrome with the handler URL, the UI side should behave as follows:

### 8.1 Manifest change

Grant the `tabs` permission:

```json
"permissions": [
  "nativeMessaging",
  "offscreen",
  "notifications",
  "storage",
  "tabs"
]
```

### 8.2 Handler page logic (`magnet-handler.html` / JS)

When the extension handler page opens (for both magnet and `.torrent` cases):

1. It sends a message to the service worker:

   ```js
   chrome.runtime.sendMessage({ type: "wake-native-host" });
   ```

2. The service worker ensures offscreen + host are started (idempotent `ensureOffscreen()`).

3. The handler page then uses `chrome.tabs` to manage UI:

   ```js
   const mainUrl = chrome.runtime.getURL("ui/app.html");

   chrome.tabs.query({ url: mainUrl }, tabs => {
     if (tabs.length > 0) {
       // Focus existing main UI tab
       chrome.tabs.update(tabs[0].id, { active: true });
       window.close();
     } else {
       // No main UI tab — open a new one
       chrome.tabs.create({ url: mainUrl }, () => {
         window.close();
       });
     }
   });
   ```

### 8.3 Effect

* If a main UI tab already exists, the user is brought to that tab; handler tab closes.
* If no main UI exists, a new one is opened and handler closes.
* For both magnet and `.torrent` launches, the **same** UI sequence runs:

  * Stub wakes Chrome (with handler URL).
  * Handler ensures host is started.
  * Handler redirects focus to main UI, then closes.

This prevents multiple handler tabs from lingering and ensures the main application UI is visible after launch in both cases.

---

## 9. Summary

* The stub is extended to handle both `magnet:` URIs and `.torrent` file paths.
* For `.torrent`, the stub reads the file bytes first, then waits until the native host is fully alive (via `rpc-info` + `/health`) before sending `POST /add-torrent`.
* The native host is extended with `/add-torrent` while keeping `/add-magnet` and `/health` semantics unchanged.
* Waiting for `rpc-info` and `/health` before posting makes the design robust against:

  * stub/host/Chrome startup ordering,
  * slow Chrome startup,
  * and concurrent invocations.
* The Chrome extension uses the `tabs` permission so that the handler page can always either:

  * focus an existing main UI tab, or
  * open a new main UI tab,
    then close itself, giving a clean UI experience for both magnet and `.torrent` launches.
