Below is a **clean, minimal, composable TypeScript class architecture** tailored to your system:

* Chrome extension connects to your **native host** (via `chrome.runtime.connectNative`)
* Native host replies with a **DaemonInfo** message (port, token, etc.)
* Client then establishes a **WebSocket** to the IO-daemon
* Higher-level modules (`ISockets`, `ITcpSocket`, `IUdpSocket`, etc.) use the **client’s** daemon connection as their transport
* Client manages lifecycle: start, ensure-ready, spin-down when idle

This design emphasizes:

* Clear separation of concerns
* Predictable lifecycle (native host → daemon info → ws auth → ready)
* Testability
* No global state
* Easy to extend

It avoids unnecessary complexity and keeps the control plane narrow.

---

# 1. Core Design Overview

You will have **four** layers:

```
+---------------------------------+
|          App/UI Layer           |
+---------------------------------+
|             Client              |
|     - owns NativeHostConnection |
|     - owns DaemonConnection     |
|     - top-level lifecycle       |
+---------------------------------+
| NativeHostConnection | DaemonConnection |
+---------------------------------+
|         Low-level IO Daemon WS (binary)         |
+---------------------------------+
```

And functional interfaces:

* `INativeHostConnection` — abstraction for Chrome native messaging
* `IDaemonConnection` — abstraction for WS socket bridge
* `ISockets` / `ITcpSocket` / `IUdpSocket` — API for socket creation/use

This gives you a very solid, clean layering.

---

# 2. TypeScript Interfaces

## 2.1 DaemonInfo (native host → extension)

```ts
interface DaemonInfo {
  port: number;
  token: string;
  version: number;
  // maybe more: pid, platform, buildId
}
```

## 2.2 INativeHostConnection

Responsible only for native-messaging I/O.

```ts
interface INativeHostConnection {
  connect(): Promise<void>;
  send(msg: any): void;
  onMessage(cb: (msg: any) => void): void;
  onDisconnect(cb: () => void): void;
}
```

## 2.3 IDaemonConnection

Binary WebSocket wrapper that knows the binary framing spec.

```ts
interface IDaemonConnection {
  connect(info: DaemonInfo): Promise<void>;
  sendFrame(frame: ArrayBuffer): void;
  onFrame(cb: (frame: ArrayBuffer) => void): void;
  close(): void;
  readonly ready: boolean;
}
```

## 2.4 ISockets (frontend API to app code)

A factory for socket primitives.

```ts
interface ITcpSocket {
  send(data: Uint8Array): void;
  onData(cb: (data: Uint8Array) => void): void;
  close(): void;
}

interface IUdpSocket {
  send(addr: string, port: number, data: Uint8Array): void;
  onMessage(cb: (src: {addr: string, port: number}, data: Uint8Array) => void): void;
  close(): void;
}

interface ISockets {
  createTcpSocket(): Promise<ITcpSocket>;
  createUdpSocket(bindAddr?: string, bindPort?: number): Promise<IUdpSocket>;
}
```

---

# 3. Class Structure

Here is the recommended architecture:

## 3.1 NativeHostConnection class (Chrome-native messaging)

```ts
class NativeHostConnection implements INativeHostConnection {
  private port: chrome.runtime.Port | null = null;

  async connect(): Promise<void> {
    this.port = chrome.runtime.connectNative("com.example.jstorrent");
  }

  send(msg: any) {
    this.port?.postMessage(msg);
  }

  onMessage(cb: (msg: any) => void) {
    this.port?.onMessage.addListener(cb);
  }

  onDisconnect(cb: () => void) {
    this.port?.onDisconnect.addListener(cb);
  }
}
```

This layer emits `DaemonInfo` when the native host sends it.

---

## 3.2 DaemonConnection class (binary WebSocket connection)

Responsible for:

* opening WebSocket binary connection
* AUTH frame (using token)
* tracking ready state
* framing/unframing messages (I/O-daemon spec)

```ts
class DaemonConnection implements IDaemonConnection {
  private ws: WebSocket | null = null;
  private frameHandlers: Array<(f: ArrayBuffer) => void> = [];
  ready = false;

  async connect(info: DaemonInfo): Promise<void> {
    const url = `ws://127.0.0.1:${info.port}/io`;

    this.ws = new WebSocket(url);
    this.ws.binaryType = "arraybuffer";

    await new Promise<void>((resolve, reject) => {
      this.ws!.onopen = () => resolve();
      this.ws!.onerror = () => reject();
    });

    // Send AUTH frame using the binary protocol you've defined
    this.ws.send(buildAuthFrame(info.token));

    // Wait for AUTH_RESULT
    await new Promise<void>((resolve, reject) => {
      this.ws!.onmessage = (ev) => {
        const frame = ev.data as ArrayBuffer;
        const opcode = readOpcode(frame);
        if (opcode === Msg.AUTH_RESULT) {
          const ok = parseAuthResult(frame);
          if (ok) {
            this.ready = true;
            resolve();
          } else {
            reject(new Error("Daemon auth failed"));
          }
        } else {
          // unsolicited frame before auth
          reject(new Error("Unexpected frame before auth"));
        }
      }
    });

    // After auth, switch to normal frame-dispatch mode
    this.ws.onmessage = (ev) => {
      const frame = ev.data as ArrayBuffer;
      for (const h of this.frameHandlers) h(frame);
    };
  }

  sendFrame(frame: ArrayBuffer) {
    if (!this.ready) throw new Error("Daemon not ready");
    this.ws?.send(frame);
  }

  onFrame(cb: (f: ArrayBuffer) => void) {
    this.frameHandlers.push(cb);
  }

  close() {
    this.ws?.close();
  }
}
```

---

## 3.3 Sockets class (frontend API)

Wraps the daemon connection, creates socketIds, encodes/decodes frames.

```ts
class Sockets implements ISockets {
  private daemon: IDaemonConnection;
  private nextSocketId = 1;

  constructor(daemon: IDaemonConnection) {
    this.daemon = daemon;
  }

  async createTcpSocket(): Promise<ITcpSocket> {
    const socketId = this.nextSocketId++;
    const connectFrame = buildTcpConnectFrame(socketId, "host", 6881);
    this.daemon.sendFrame(connectFrame);

    await waitForTcpConnected(socketId, this.daemon);

    return new TcpSocket(socketId, this.daemon);
  }

  async createUdpSocket(bindAddr?: string, bindPort?: number): Promise<IUdpSocket> {
    const socketId = this.nextSocketId++;
    const bindFrame = buildUdpBindFrame(socketId, bindAddr, bindPort);
    this.daemon.sendFrame(bindFrame);

    await waitForUdpBound(socketId, this.daemon);

    return new UdpSocket(socketId, this.daemon);
  }
}
```

And the primitives:

```ts
class TcpSocket implements ITcpSocket {
  constructor(private id: number, private daemon: IDaemonConnection) {}

  send(data: Uint8Array) {
    this.daemon.sendFrame(buildTcpSendFrame(this.id, data));
  }

  onData(cb: (data: Uint8Array) => void) {
    addFrameHandlerForTcpRecv(this.id, this.daemon, cb);
  }

  close() {
    this.daemon.sendFrame(buildTcpCloseFrame(this.id));
  }
}
```

UDP is analogous.

---

# 4. The Top-Level Client

This is the high-level orchestrator.
It:

* owns NativeHostConnection
* waits for DaemonInfo
* constructs DaemonConnection
* exposes `ensureDaemonReady()`
* exposes `.sockets` for TCP/UDP ops
* manages autoclose if idle

```ts
class Client {
  private native: INativeHostConnection;
  private daemon: IDaemonConnection | null = null;
  private sockets: ISockets | null = null;
  private ready = false;

  constructor(native: INativeHostConnection) {
    this.native = native;
  }

  async ensureDaemonReady(): Promise<ISockets> {
    if (this.ready) return this.sockets!;

    await this.native.connect();

    const daemonInfo = await this.waitForDaemonInfo();
    this.daemon = new DaemonConnection();
    await this.daemon.connect(daemonInfo);

    this.sockets = new Sockets(this.daemon);
    this.ready = true;

    return this.sockets;
  }

  private waitForDaemonInfo(): Promise<DaemonInfo> {
    return new Promise((resolve) => {
      this.native.onMessage((msg) => {
        if (msg.type === "DaemonInfo") {
          resolve(msg.payload as DaemonInfo);
        }
      });
    });
  }

  shutdown() {
    this.daemon?.close();
    this.ready = false;
  }
}
```

### Usage:

```ts
const client = new Client(new NativeHostConnection());

const sockets = await client.ensureDaemonReady();
const tcp = await sockets.createTcpSocket();

tcp.send(...);
tcp.onData(...);
```

---

# 5. Why This Structure Works

### Clear separation of responsibilities

* **NativeHostConnection**: only native messaging
* **DaemonConnection**: only binary WS framing + auth
* **Sockets**: socket multiplexing, socket factories
* **Client**: session lifecycle, ready state, daemon orchestration

### Easy to extend

* Adding `ITcpSocketAdvanced` or DHT, tracker channels is trivial
* Client can autosleep daemon connection after idle
* DaemonConnection can support reconnect behaviour

### Testability

* Each class can be mocked independently
* Socket classes can be tested with fake DaemonConnection

### Safety

* No cross-contamination; auth logic isolated
* Clear ready/connected state
* All I/O flows through one place

