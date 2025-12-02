Here is a **clean design for a Python-side wrapper** that makes your HTTP-RPC-controlled JSTorrent engine feel like a *native Python API*, similar in ergonomics to the libtorrent Python bindings—*but without pretending to be libtorrent*.

This gives you a thin idiomatic façade:

* synchronous or async depending on preference
* stable high-level methods
* natural “engine.add_torrent(…)” style
* automatic lifecycle / cleanup
* error translation to Python exceptions
* optional awaitable polling helpers
* no leaking HTTP details

The final result: **Python integration tests feel like they’re driving a real engine**, not an HTTP API.

Below is the recommended design.
---

# 1. Concept: `JSTEngine` Python class

### Clean, natural, and parallel to `lt.session` from libtorrent.

You will create a Python class that wraps the RPC API.

```
engine = JSTEngine(port=3002)
engine.start()
tid = engine.add_torrent("magnet:?xt=urn:btih:...")
status = engine.get_torrent_status(tid)
engine.stop()
engine.shutdown()
```

A perfect analogy to libtorrent:

```
sess = lt.session()
h = lt.add_magnet_uri(sess, uri)
st = h.status()
```

---

# 2. Directory + file structure for Python wrapper

```
tests/python/
    jst/
        __init__.py
        engine.py           (JSTEngine)
        torrent_handle.py   (JSTTorrentHandle)
        errors.py
```

This keeps it clean and reusable.

---

# 3. Minimal API surface (Python)

## 3.1 JSTEngine

### Engine lifecycle

```python
from jst.engine import JSTEngine

engine = JSTEngine(port=3002)
engine.start()       # POST /engine/start
engine.stop()        # POST /engine/stop
engine.shutdown()    # POST /shutdown
```

### Torrent commands

```python
tid = engine.add_torrent_file("/path/file.torrent")
tid = engine.add_magnet("magnet:?xt=...")

status = engine.status()
ts    = engine.get_torrent_status(tid)

engine.pause(tid)
engine.resume(tid)
engine.remove(tid)
```

### Helpful utilities

```python
engine.wait_for_download(tid, timeout=300)   # loops until progress == 1.0
engine.wait_for_state(tid, "seeding", 60)
```

---

# 4. Python class design

Here is the **idiomatic Python class**, minimal but fully reusable.

### `engine.py`

```python
import requests
import time
from .errors import (
    EngineNotRunning, EngineAlreadyRunning,
    TorrentNotFound, RPCError
)

class JSTEngine:
    def __init__(self, host="localhost", port=3002):
        self.base = f"http://{host}:{port}"
        self.session = requests.Session()

    # -----------------------------
    # Helpers
    # -----------------------------
    def _req(self, method, path, **kwargs):
        url = f"{self.base}{path}"
        r = self.session.request(method, url, **kwargs)

        try:
            data = r.json()
        except Exception:
            raise RPCError(f"Invalid JSON from RPC at {url}")

        if not data.get("ok", False):
            code = data.get("code", "RPCError")
            msg = data.get("error", "")
            if code == "EngineNotRunning":
                raise EngineNotRunning(msg)
            if code == "EngineAlreadyRunning":
                raise EngineAlreadyRunning(msg)
            if code == "TorrentNotFound":
                raise TorrentNotFound(msg)
            raise RPCError(msg)

        return data

    # -----------------------------
    # Engine lifecycle
    # -----------------------------
    def start(self, config=None):
        self._req("POST", "/engine/start", json={"config": config or {}})

    def stop(self):
        self._req("POST", "/engine/stop")

    def shutdown(self):
        self._req("POST", "/shutdown")

    def status(self):
        return self._req("GET", "/engine/status")

    # -----------------------------
    # Torrent management
    # -----------------------------
    def add_torrent_file(self, path, storage_key="default"):
        with open(path, "rb") as f:
            data_b64 = f.read().encode("base64")
        res = self._req("POST", "/torrent/add", json={
            "type": "file",
            "data": data_b64,
            "storageKey": storage_key
        })
        return res["id"]

    def add_magnet(self, magnet, storage_key="default"):
        res = self._req("POST", "/torrent/add", json={
            "type": "magnet",
            "data": magnet,
            "storageKey": storage_key
        })
        return res["id"]

    def get_torrent_status(self, tid):
        return self._req("GET", f"/torrent/{tid}/status")

    def pause(self, tid):
        self._req("POST", f"/torrent/{tid}/pause")

    def resume(self, tid):
        self._req("POST", f"/torrent/{tid}/resume")

    def remove(self, tid):
        self._req("POST", f"/torrent/{tid}/remove")

    # -----------------------------
    # Test helpers
    # -----------------------------
    def wait_for_download(self, tid, timeout=300, poll=0.2):
        start = time.time()
        while True:
            st = self.get_torrent_status(tid)
            if st["progress"] >= 1.0:
                return True
            if time.time() - start > timeout:
                raise TimeoutError("Download did not complete in time.")
            time.sleep(poll)

    def wait_for_state(self, tid, state, timeout=60, poll=0.2):
        start = time.time()
        while True:
            st = self.get_torrent_status(tid)
            if st["state"] == state:
                return True
            if time.time() - start > timeout:
                raise TimeoutError(
                    f"Torrent {tid} did not reach state '{state}' in time."
                )
            time.sleep(poll)
```

This class is thin, idiomatic, error-translating, and hides all RPC weirdness.

---

# 5. Python usage: clean and test-friendly

### Example test:

```python
from jst.engine import JSTEngine

def test_basic_download():
    engine = JSTEngine(port=3010)
    engine.start()

    tid = engine.add_magnet(
        "magnet:?xt=urn:btih:..."
    )

    engine.wait_for_download(tid, timeout=120)

    st = engine.get_torrent_status(tid)
    assert st["state"] == "seeding"

    engine.stop()
    engine.shutdown()
```

### Compare this to libtorrent:

```python
sess = lt.session()
h = lt.add_magnet_uri(sess, uri)
while not h.status().is_seeding:
    time.sleep(0.2)
```

The ergonomics match.

---

# 6. Extensions for more libtorrent-like feel

If you want the wrapper to feel more libtorrent-ish:

### Add a “TorrentHandle” object

```
handle = engine.add_magnet(...)
status = handle.status()
handle.pause()
handle.resume()
```

Where:

```python
class JSTTorrentHandle:
    def __init__(self, engine, tid):
        self.engine = engine
        self.tid = tid

    def status(self):
        return self.engine.get_torrent_status(self.tid)

    def pause(self):
        self.engine.pause(self.tid)

    def resume(self):
        self.engine.resume(self.tid)
```

This improves ergonomics and reduces passing of torrent IDs.

---

# 7. Why this Python wrapper is important

This wrapper:

* makes Python tests elegant
* hides the raw HTTP layer
* mimics libtorrent’s Python interface (but stays simple)
* keeps the Node RPC layer extremely minimal
* provides clean exceptions
* integrates cleanly with `pytest` or other frameworks
* avoids making your Node engine aware of Python at all
* enables deterministic, readable e2e tests

This is exactly how headless browser controllers (e.g. Playwright, Selenium Remote Driver) are structured.

---
