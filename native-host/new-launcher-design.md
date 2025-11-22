Below is the **full design document** for the updated JSTorrent Link Handler stub binary, incorporating:

* The new **webpage-based startup flow** (`https://new.jstorrent.com/launch`)
* A drastically simplified control flow
* Cross-platform **failure notification** using *no* external GUI libraries
* Recommended fallback paths per OS
* Clear separation of responsibilities between stub, webpage, extension, and native host

This is written so an agent can implement it cleanly and without ambiguity.

---

# **JSTorrent Link Handler Stub — Updated Design Document**

## **Purpose**

This document specifies the architecture and behavior of the **JSTorrent Link Handler stub binary** responsible for handling system-level invocations of:

* **magnet:** links
* **.torrent** file opens

The goal is to:

* Delegate all Chrome extension UX and startup logic to a **reliable webpage at jstorrent.com**
* Keep the stub very lightweight and robust
* Provide a **user-visible error message** when handling fails (using only OS-native primitives)
* Maintain race-free behavior for starting and communicating with the JSTorrent native host

---

# **1. High-Level Architecture**

### **Invocation**

The OS invokes the JSTorrent Link Handler when:

* A user clicks a `magnet:?…` link
* A user double-clicks a `.torrent` file

### **Stub responsibilities (minimal)**

The stub:

1. Parses arguments (magnet URI or .torrent filepath)

2. If `.torrent`, immediately reads full binary file into memory

3. Attempts to detect whether the native host is already running (`rpc-info`)

4. If not running, launches Chrome/Chromium to:

   ```
   https://new.jstorrent.com/launch
   ```

5. Polls for:

   * Creation of `rpc-info`
   * Native host `/health` readiness

6. POSTs the magnet or torrent data to the native host

7. Exits normally

8. On failure (timeout or RPC error):

   * Shows a **minimal OS-native error dialog** (no external libs)
   * Exits with error code

### **Webpage responsibilities (not stub concerns)**

At `https://new.jstorrent.com/launch`:

* Detect extension presence
* Trigger `connectNative` to start native host
* Provide instructions if extension is missing
* Open or focus the full JSTorrent UI (chrome-extension:// page)
* Provide ChromeOS fallback

### **Native host responsibilities**

* Start up when triggered
* Write `rpc-info-<profile>.json`
* Expose `/health` and `/add-{magnet,torrent}`
* Accept requests from the stub
* Fail safely with helpful JSON errors

---

# **2. Stub Binary Behavior (Detailed)**

## **2.1 Input Parsing**

### Magnet case:

```
argv[1] starts_with "magnet:"
```

Store raw magnet URI.

### Torrent case:

```
argv[1] is a filesystem path
```

* Validate file exists
* Read full contents into memory immediately
* Store:

  * `file_name`
  * `contents_base64` or raw bytes

## **2.2 Attempt to detect existing native host**

Look for:

```
~/.config/jstorrent-native/rpc-info-*.json
```

Or platform-specific equivalents.

If found and matches a live PID:

* Proceed to health polling
* Skip browser launch

If not found:

* Need to wake Chrome + extension.

---

# **3. Launching the Browser**

### **Launch target:**

```
https://new.jstorrent.com/launch
```

### **Browser selection logic:**

1. If previous `rpc-info` has `"browser": { "binary": "/path/chrome" }` → try that first.
2. Otherwise attempt:

   * `chrome`
   * `google-chrome`
   * `chrome.exe` via standard Windows paths
   * `open -a "Google Chrome"` (macOS)
   * `xdg-open` fallback (Linux)

Stub should not launch any `chrome-extension://` URL.

---

# **4. Polling for Native Host Startup**

### **4.1 Poll for rpc-info creation**

Loop for a fixed timeout (e.g., 10 seconds):
Please make sure the timeout duration is clearly documented and pulled into a constant in the code so it can be tweaked.

* If file appears → parse port/token
* Else keep retrying at 100–200 ms intervals

### **4.2 Poll `/health` endpoint**

After reading `rpc-info`:

Try:

```
GET http://127.0.0.1:<port>/health?token=<token>
```

Loop until:

* HTTP 200 OK → host ready
* Or timeout (e.g., 5–10 seconds)

If timeout → present failure notification.

---

# **5. Sending the Payload**

### **Magnet:**

```
POST /add-magnet?token=<token>
{
  "magnet": "magnet:?xt=urn:btih:..."
}
```

### **Torrent:**

```
POST /add-torrent?token=<token>
{
  "file_name": "example.torrent",
  "contents_base64": "<base64 bytes>"
}
```

Response body is ignored except for success/failure.

---

# **6. Exit Behavior**

* On success → exit `0`
* On failure → show a native error dialog → exit non-zero

---

# **7. Cross-Platform Error Notification (No External Libraries)**

The goal: a **simple**, fallback-safe, no-libraries UI capable of telling the user:

> “JSTorrent could not handle your magnet/torrent link. Reason: {xyz}”

Below are the recommended implementations per OS.

---

## **7.1 Windows (no dependencies)**

Use **Win32 MessageBoxW**, available in `user32.dll`.

* No GUI toolkits required
* Always available on Windows
* Zero overhead

Example:

```c
MessageBoxW(
    NULL,
    L"JSTorrent could not process your magnet/torrent.\n\nReason: <insert>",
    L"JSTorrent Error",
    MB_ICONERROR | MB_OK
);
```

**Recommended:** This is the ideal Windows path.

---

## **7.2 macOS (no external dependencies)**

Two fully viable approaches:

### **Option A: `osascript` (preferred minimal approach)**

Spawn:

```bash
osascript -e 'display alert "JSTorrent Error" message "Failed to process your magnet/torrent.\nReason: ..."' 
```

Pros:

* No Objective-C code needed
* Works on all macOS versions
* No frameworks linked
* Very short code path

Cons:

* Pops up a classic macOS dialog; slightly dated style

### **Option B: Tiny Objective-C file (more native look)**

Embed 10–15 lines of Obj-C:

```objc
NSAlert *alert = [[NSAlert alloc] init];
[alert setMessageText:@"JSTorrent Error"];
[alert setInformativeText:@"Failed to process your magnet/torrent.\nReason: ..."];
[alert runModal];
```

Requires linking with `-framework AppKit`, but still no third-party libraries.

**Recommendation:** Use Option A (`osascript`) for simplicity.

---

## **7.3 Linux (no external GUI libs)**

No built-in GUI toolkit is guaranteed to exist. Options:

### **Option A: Try `zenity`**

```
zenity --error --text="JSTorrent could not process link.\nReason: ..."
```

* Works on GNOME
* Installed by default on many distros

### **Option B: Try `kdialog`**

```
kdialog --error "JSTorrent error: Reason..."
```

* KDE environments

### **Option C: Fallback to stderr**

If neither command exists, write to stderr:

```
eprintln!("JSTorrent error: {}", reason);
```

Since Linux users are accustomed to CLI behavior, fallback is acceptable.

**Recommendation:** Best-effort `zenity` → `kdialog` → stderr.

---

# **8. Failure Notification Summary**

### **Windows:**

* MessageBoxW (single API call)
* Perfectly native
* Zero dependencies

### **macOS:**

* Run `osascript` to show AppleScript alert
* Simple, robust, no libs

### **Linux:**

* Attempt `zenity`
* Attempt `kdialog`
* Fallback to stderr

### **Stub code impact:**

Minimal (<200 LOC).
No new heavy crates or toolkits needed.

---

# **9. Benefits of the New Stub Design**

### **Simplified architecture**

The stub:

* Doesn’t know about the extension ID
* Doesn’t open extension pages
* Doesn’t manage tab lifecycles
* Isn’t responsible for UI logic
* Doesn’t need `chrome-extension://` URLs
* Only interacts with:

  * Browser executable
  * Native host RPC
  * OS dialogs for failure

### **Robust across extension uninstall/disable**

A webpage always loads—even if extension is missing.

### **Race-free**

Stub waits for:

* `rpc-info` creation
* `/health` validation
  before it sends payload.

### **Cleaner separation of concerns**

* Stub = OS entry point
* Webpage = extension/host orchestrator
* Extension = host activation + UI controller
* Host = torrent engine

---

# **10. Final Summary**

This redesign moves all browser-specific startup logic to a controlled webpage and simplifies the stub binary to three tasks:

1. **Wake Chrome** by opening a webpage
2. **Wait for the native host** via `rpc-info` + `/health`
3. **Deliver payload** (`magnet:` or `.torrent`)

And in error cases, the stub:

* Presents a minimal OS-native dialog
* Uses *no* external libraries
* Behaves consistently across Windows, macOS, and Linux

This keeps the stub extremely small, robust, and easily maintainable.
