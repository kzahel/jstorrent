# Design document: Python + libtorrent–driven integration tests for a TypeScript BitTorrent engine

## 1. Goals

* Use **libtorrent** (via Python bindings) as a **correctness oracle** for a new BitTorrent engine implemented in TypeScript.
* Build an integration test suite that:

  * Validates **core protocol correctness** (handshake, piece/block exchange, metadata, etc.).
  * Exercises **seeding and downloading** in multiple topologies.
  * Is **deterministic** and reproducible.
* Control the TS engine via a **JSON-RPC protocol over stdio** from Python.
* Keep the design **simple** and **extensible** for future BEP/feature tests.

Non-goals:

* Not a performance or stress-test harness (though the design can be extended).
* Not a GUI test framework.
* Not a framework for arbitrary “eval” of engine internals.

---

## 2. High-level architecture

**Primary runtime:** Python (pytest)
**Oracle engine:** libtorrent (Python bindings)
**System under test (SUT):** Node/TypeScript torrent engine, driven as a child process.

Textual diagram:

```
          +--------------------+
          |   pytest test_*.py |
          +---------+----------+
                    |
                    v
          +---------+----------+
          |  Python Test Harness|
          |  (libtorrent + RPC) |
          +--+--------------+---+
             |              |
    libtorrent API   JSON-RPC over stdio
             |              |
             v              v
   +---------+------+   +--+------------------+
   |  Libtorrent    |   |  Node TS Engine     |
   |  Session(s)    |   |  (child process)    |
   +----------------+   +--------------------+
        |   ^                    |   ^
   TCP/UDP   \___________________/   |
         (BitTorrent wire protocol)   |
                                      v
                                 Filesystem
                                 (test dirs)
```

---

## 3. Components

### 3.1 Python test harness

* Uses `pytest` (or unittest) as runner.
* Imports `libtorrent` Python bindings.
* Provides helper utilities to:

  * Create temporary working directories.
  * Start/stop libtorrent sessions.
  * Start/stop TS engine processes.
  * Send/receive JSON-RPC commands.
  * Wait for libtorrent alerts and assert on them.

Key modules:

* `harness/libtorrent_utils.py`
* `harness/engine_rpc.py`
* `tests/test_basic_swarm.py`, `tests/test_magnet_mode.py`, etc.

### 3.2 Libtorrent configuration

Each test (or fixture) creates one or more **isolated libtorrent sessions** with:

* DHT: off (unless specifically testing DHT)
* LSD: off
* PEX: off
* uTP: configurable (on/off depending on tests)
* Encryption: optional; can be configured per test
* Listening port: explicitly configured to avoid collisions
* Working directory: temporary per test (e.g. `/tmp/itests/sess_X`)

You may define Python fixtures:

* `lt_session_seeder()`
* `lt_session_leecher()`

### 3.3 TS engine process

* Built TS engine compiled to Node JS.
* Test harness starts the engine via `subprocess.Popen(["node", "dist/engine_repl.js"], ...)`.
* Engine exposes a **JSON-RPC REPL over stdin/stdout** (line-oriented, one JSON object per line).
* Engine instance is scoped to one test (or fixture) to keep state isolated.

### 3.4 JSON-RPC protocol (minimal)

Each command is a single JSON object with:

* `id`: incremental or UUID (optional but helpful)
* `cmd`: command string
* `params`: object with command parameters

Example:

```json
{"id": 1, "cmd": "init", "params": {"listen_port": 51001, "download_dir": "/tmp/ts_dl_1"}}
{"id": 2, "cmd": "add_torrent_file", "params": {"path": "/tmp/torrents/sample.torrent"}}
{"id": 3, "cmd": "get_status", "params": {}}
{"id": 4, "cmd": "shutdown", "params": {}}
```

Responses:

```json
{"id": 1, "ok": true}
{"id": 2, "ok": true, "torrent_id": "abc123"}
{"id": 3, "ok": true, "status": {...}}
{"id": 4, "ok": true}
```

Errors:

```json
{"id": 5, "ok": false, "error": "Unknown command 'foo'"}
```

---

## 4. JSON-RPC command set

Start minimal; expand as needed:

1. **Lifecycle**

   * `init`: configure listen port, download directory, feature flags.
   * `shutdown`: orderly shutdown, flush state.

2. **Torrents**

   * `add_torrent_file`: add torrent from `.torrent` path.
   * `add_magnet_uri`: add torrent via magnet link.
   * `remove_torrent`: optional, for cleanup.

3. **Status**

   * `get_torrent_status`: returns status (progress, state, num_peers, pieces bitmap, etc.).
   * `get_engine_stats`: generic engine-level stats (optional).

4. **Debug/Control (optional, but useful)**

   * `force_reannounce`
   * `pause_torrent` / `resume_torrent`
   * `set_torrent_options` (e.g., max connections, piece priorities)

The key is to keep this interface **stable and implementation-agnostic**.

---

## 5. Test topologies

### 5.1 Libtorrent seeder → TS engine leecher

* Python:

  * Creates a test file on disk (e.g., `payload.bin` with random data).
  * Uses libtorrent’s `file_storage` / `create_torrent` to build a `.torrent`.
  * Adds torrent to a “seeder” session:

    * `save_path` = `seeder_dir`
    * `seed_mode` = true (or allow it to check and become seeding).
  * Waits for libtorrent alert `torrent_finished_alert` (or equivalent seeding ready state).

* Python then:

  * Launches TS engine via JSON-RPC:

    * `init(listen_port, download_dir)`
    * `add_torrent_file(path_to_torrent)`
  * Waits for:

    * TS status: `complete == true` OR `progress == 1.0`
    * Optionally: piece-level completion.

* Assertions:

  * File in TS engine download directory matches original payload (byte equality).
  * TS engine’s reported metadata (file size, name, piece count) matches `.torrent`.
  * Libtorrent logs show consistent piece completion (no repeated failures).

### 5.2 TS engine seeder → Libtorrent leecher

Mirror of 5.1:

* Python:

  * Prepares payload file in TS engine’s designated seed directory.
  * Uses libtorrent or an external utility to create a `.torrent` pointing to that file.
* TS engine:

  * `add_torrent_file` or a special `add_torrent_and_seed` command.
* Libtorrent:

  * Adds the same `.torrent` as a downloader (empty directory).
* Assertions:

  * Libtorrent completes successfully.
  * Data matches bit-for-bit.
  * No protocol errors in libtorrent alerts.
  * TS engine’s status indicates seeding/finished.

### 5.3 Multi-peer swarm

Extend to 3+ peers:

* One TS engine + two libtorrent sessions.
* Use this to validate:

  * Piece availability propagation.
  * Proper choking/unchoking.
  * Correct bitfield / have behavior.

---

## 6. Determinism and environment control

To keep tests deterministic:

* Disable external discovery:

  * `dht` off.
  * `lsd` off.
  * `pex` off (unless testing PEX).
* Use fixed ports in a known range (e.g. 50000–51000).
* Use loopback (`127.0.0.1`) only:

  * Avoid external network interference.
* Use **small test files** (e.g. 256 KiB–4 MiB) to keep tests fast.
* Use modest piece sizes (e.g. 16 KiB–64 KiB) so that piece-level tests are granular.
* Set timeouts in the harness (e.g. fail tests if completion takes > N seconds).

---

## 7. Example test lifecycle

### Example: `test_single_file_download_from_libtorrent_seeder.py`

1. **Setup**

   * Create temp directory `tmp/test_1/`.
   * Create `payload.bin` (e.g. 1 MiB random content).
   * Create `.torrent` using libtorrent’s `create_torrent`.
   * Start libtorrent seeder session with:

     * `save_path = tmp/test_1/seeder`
     * `listen_port = 50001`
   * Wait until torrent is in “seeding” state (alerts or status).

2. **Start TS engine**

   * Launch Node process:

     * `Popen(["node", "dist/engine_repl.js"], ...)`
   * Send JSON-RPC:

     * `init(listen_port=50002, download_dir="tmp/test_1/leecher_ts")`
     * `add_torrent_file(path="tmp/test_1/test.torrent")`

3. **Drive swarm**

   * Both peers run on localhost.
   * libtorrent and TS engine connect via BitTorrent wire protocol.

4. **Wait for completion**

   * Poll TS engine via `get_torrent_status` every 100ms.
   * Stop when `progress == 1.0` or `state == "seeding"/"finished"`.

5. **Assertions**

   * Compare `payload.bin` at seeder and leecher (byte-for-byte).
   * Assert libtorrent saw no `file_error_alert`, `hash_failed_alert`, etc.
   * Assert TS engine reported no internal error statuses.
   * Optionally: assert number of piece failures/retries is below threshold.

6. **Teardown**

   * Send `shutdown` to TS engine.
   * Stop libtorrent session.
   * Clean up temporary directories.

---

## 8. Test categorization

You can organize tests by functionality/BEP:

1. **Core transfer**

   * Simple single-file torrents.
   * Multi-file torrents.
   * Piece size edge cases.

2. **Metadata handling**

   * Magnet links (metadata exchange BEP 9).
   * Infohash v1 and v2 (if supported).

3. **Protocol behavior**

   * Choking/unchoking correctness.
   * HAVE / BITFIELD messages alignment.
   * Request/Cancel/Reject handling.

4. **Error handling**

   * Corrupted pieces (e.g. manually patch file).
   * Mismatched file sizes.
   * Early disconnects / peer churn.

5. **Extensions**

   * Fast extensions (if implemented).
   * PEX, if/when supported.
   * DHT-related behavior in a controlled test (separate tests, separate sessions).

Each test uses libtorrent as the **oracle** for “correct behavior”.

---

## 9. CI and automation

* Install dependencies in CI:

  * Python + libtorrent bindings.
  * Node + built TS engine.
* Use a deterministic libtorrent version pinned in requirements (e.g. `python-libtorrent==X.Y`).
* Run tests via `pytest -q`.
* Optionally, support:

  * Parallel test execution with per-test port ranges and directories.
  * Test markers (`@pytest.mark.slow`, `@pytest.mark.bep_9`) for grouping.

---

## 10. Extensibility

This design is intentionally simple:

* To add new tests, you typically:

  * Extend JSON-RPC with one or two new commands.
  * Add small helper utilities in Python for new libtorrent behaviors.
  * Write a new `test_*.py` describing the swarm topology.

Because the control plane is JSON-RPC over stdio and libtorrent is embedded directly, you can:

* Add new peers easily (more libtorrent sessions or more TS engine instances).
* Run scenario-based tests (e.g. disconnect and reconnect, partial piece completion).

