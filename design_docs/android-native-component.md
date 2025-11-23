The simplest reliable stack for what you want is:

**JS (React Native / TS engine)** → **C++ JSI shim** → **Rust I/O core** → **OS syscalls (sockets, files)**

Kotlin/Java exists only for app lifecycle (Service, permissions), not in the I/O path.

Below is an overview with enough structure that an automated agent can generate code against it.

---

## 1. High-level architecture

### Layers

1. **React Native JS (Hermes)**

   * Your TypeScript torrent engine.
   * Calls a small JS API: `JSTorrentIO` (socket/file/hash).
2. **C++ JSI Shim (`jstorrentio.cpp`)**

   * Exposes JS-callable functions via JSI/TurboModule.
   * Converts JS arguments ↔ native types.
   * Calls into Rust via a C ABI.
   * Schedules callbacks back onto the JS thread.
3. **Rust I/O Core (`libjstorrent_io`)**

   * Exposed as a `cdylib` for Android.
   * Implements:

     * TCP/UDP open/send/recv/close
     * File open/read/write/close
     * SHA-1 hashing
   * Owns threads, epoll, file descriptors, buffers.
   * Knows nothing about JS/JSI.

### Data flows

* **JS → C++ → Rust**

  * JS calls `JSTorrentIO.socketOpen("peer1", host, port)`.
  * C++ JSI function extracts args, calls `rust_socket_open("peer1", host, port)`.
  * Rust opens a socket, registers it with epoll.

* **Rust → C++ → JS (events)**

  * Rust epoll loop sees data on socket.
  * Rust calls a C callback (provided by C++): `on_socket_data(id, ptr, len)`.
  * C++ uses `CallInvoker` to schedule a JS function call on the JS thread with an `ArrayBuffer`.

Rust never touches JSI. C++ never touches sockets or files. The separation is strict.

---

## 2. JS API surface (what your TS engine sees)

Define a minimal module in JS/TS:

```ts
type SocketId = string;
type FileId = string;

interface JSTorrentIO {
  socketOpen(id: SocketId, host: string, port: number): Promise<void>;
  socketSend(id: SocketId, data: ArrayBuffer): Promise<void>;
  socketClose(id: SocketId): Promise<void>;

  fileOpen(id: FileId, path: string, flags: "r" | "w" | "rw"): Promise<void>;
  fileRead(id: FileId, offset: number, length: number): Promise<ArrayBuffer>;
  fileWrite(id: FileId, offset: number, data: ArrayBuffer): Promise<void>;
  fileClose(id: FileId): Promise<void>;

  sha1(data: ArrayBuffer): Promise<string>;

  onSocketData(
    handler: (id: SocketId, data: ArrayBuffer) => void
  ): void;

  onSocketError(
    handler: (id: SocketId, code: number, message: string) => void
  ): void;
}
```

Your TS torrent engine can implement all protocol logic against this interface and doesn’t need to know about C++ or Rust.

---

## 3. C++ JSI shim: responsibilities

The C++ layer does three things:

1. **JS-facing functions**
   One function per API method:

   * `socketOpen(rt, args…)` → calls `rust_socket_open`.
   * `socketSend(rt, args…)` → calls `rust_socket_send`.
   * `fileRead(rt, args…)` → calls `rust_file_read` and returns an `ArrayBuffer`.

2. **Callback registration**

   * When JS calls `onSocketData(handler)`, C++ stores a `jsi::Function` (wrapped safely) and a `CallInvoker` reference.
   * These are used when Rust notifies about new data.

3. **Rust callback hooks**

   * C++ exposes a C ABI function that Rust calls on events, e.g.:

     ```c
     void jst_io_on_socket_data(const char* id, const uint8_t* data, size_t len);
     ```

   * This function:

     * Copies or wraps `data` into an `ArrayBuffer`.
     * Uses `CallInvoker->invokeAsync` to call the JS handler on the JS thread.

### FFI boundary

C++ declares external Rust functions (C ABI):

```cpp
extern "C" {
  void rust_io_init(void); // optional
  int  rust_socket_open(const char* id, const char* host, uint16_t port);
  int  rust_socket_send(const char* id, const uint8_t* data, size_t len);
  int  rust_socket_close(const char* id);

  int  rust_file_open(const char* id, const char* path, int flags);
  int  rust_file_read(const char* id, uint64_t offset, uint8_t* out, size_t len, size_t* out_read);
  int  rust_file_write(const char* id, uint64_t offset, const uint8_t* data, size_t len);
  int  rust_file_close(const char* id);

  int  rust_sha1(const uint8_t* data, size_t len, uint8_t out[20]);
}
```

C++ calls these; Rust implements them.

C++ also exposes callback entry points for Rust:

```cpp
extern "C" {
  void jst_io_register_rust_callbacks(); // called from C++ during init

  void jst_io_on_socket_data(const char* id, const uint8_t* data, size_t len);
  void jst_io_on_socket_error(const char* id, int code, const char* message);
}
```

Rust calls these on events.

---

## 4. Rust I/O core: responsibilities

Rust is a standalone library, no React Native dependencies:

* Build as `cdylib` (e.g. `libjstorrent_io.so`).
* Expose C ABI functions for C++ to call.
* Internal responsibilities:

1. **Socket management**

   * Maintain a map: `socket_id -> TcpStream` (or raw FDs).
   * Run an epoll (or Tokio) event loop on one or more threads.
   * On readable event:

     * Read into a buffer (e.g. from a pool).
     * Call `jst_io_on_socket_data(id, buf_ptr, len)`.

2. **File management**

   * Maintain `file_id -> File` mapping.
   * Implement `file_open`, `file_read`, `file_write`, `file_close` using `std::fs::File` or direct POSIX via `std::os::unix::io`.

3. **Hashing**

   * Implement `rust_sha1` using `sha1` crate or a small custom implementation.

4. **Threading / safety**

   * All public C ABI functions are small wrappers around an internal `IOContext` that is behind a `Mutex` or runs on a dedicated thread with a channel.
   * No access to JS/JSI from Rust; only calls the C callbacks.

This is a very simple, robust Rust crate. All lifetime, locking, and concurrency are under Rust’s type system.

---

## 5. Threading & callbacks: safe pattern

### Rule: JSI and JS must only be touched on the JS thread.

So the pattern is:

1. JS thread:

   * Calls C++ JSI functions.
   * C++ calls into Rust (C ABI).
2. Rust I/O threads:

   * Handle epoll, file I/O.
   * On event, call C callbacks (`jst_io_on_socket_data`).
3. C callback implementation (in C++):

   * Runs on a Rust worker thread.
   * **Does not touch JSI directly.**
   * Packages event data into a struct.
   * Uses `CallInvoker->invokeAsync` to queue a lambda onto the JS thread.
4. JS thread lambda:

   * Creates the `ArrayBuffer` in JSI.
   * Calls the stored JS handler function.

This keeps all JSI access constrained to one thread, and Rust is never aware of JSI at all.

---

## 6. Memory: simple and safe initial strategy

Because you care about correctness with an automated agent, you can choose a conservative initial model:

* **JS → native**:

  * Copy `ArrayBuffer` contents into a Rust-owned buffer for send/write.
* **native → JS**:

  * Allocate a fresh JS `ArrayBuffer` and copy Rust data into it.

This adds a copy but greatly simplifies ownership:

* Rust owns its buffers entirely (use `Vec<u8>` / `Arc<[u8]>`).
* JS owns `ArrayBuffer` entirely.
* No shared memory; no risk of double-free or dangling pointers.

If needed later, you can optimize to a pooled or zero-copy model, but a copying design is easier for an agent to get right and is fast enough to start.

---

## 7. Why this is a good baseline for an automated coding agent

* Clear, narrow FFI boundary: simple C ABI functions, no complex templates.
* Strict separation of concerns:

  * Rust: I/O and threading, no JSI.
  * C++: JSI and callbacks, no syscalls.
* No JNI or Java in the hot path.
* Conservative memory model (copying) to avoid lifetime bugs.
* All concurrency in Rust under the borrow checker, not in C++.
* JSI usage localized to one file (`jstorrentio.cpp`) with a small number of patterns (call Rust, schedule callback).

An agent can:

* Generate Rust FFI stubs and implementations.
* Generate C++ JSI glue and CallInvoker usage.
* Generate the TS wrapper and interface.
* You then review mainly:

  * FFI signatures,
  * callback scheduling logic,
  * teardown/shutdown flow.

