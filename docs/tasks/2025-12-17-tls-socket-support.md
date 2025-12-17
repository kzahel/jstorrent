# TLS Socket Support for IO Daemons

## Problem

HTTPS trackers (e.g., `https://torrent.ubuntu.com:443/announce`) fail because our IO daemons only support plain TCP sockets. The tracker returns an HTML error:

```
400 Bad Request
Reason: You're speaking plain HTTP to an SSL-enabled server port.
```

Currently, the `MinimalHttpClient` sends raw HTTP over a TCP socket from the daemon. For HTTPS, we need TLS termination.

## Why This Matters

1. **HTTPS Trackers** - Many public trackers now require HTTPS
2. **Web Seeds (BEP 19)** - HTTP/HTTPS URLs for piece data, increasingly HTTPS-only
3. **Future Plugins** - Any plugin needing secure HTTP will hit this limitation

## Current Architecture

```
Extension                          IO Daemon (Rust / Android)
─────────                          ──────────────────────────
ISocketFactory
  └─ createTcpSocket(host, port)  ──►  OP_TCP_CONNECT (0x10)
                                       Opens raw TCP socket
ITcpSocket
  └─ send(data)                   ──►  OP_TCP_SEND (0x12)
  └─ onData(cb)                   ◄──  OP_TCP_RECV (0x13)
  └─ close()                      ──►  OP_TCP_CLOSE (0x14)
```

Protocol envelope: `[version:1][opcode:1][flags:2][reqId:4][payload...]`

## Proposed Solution: Socket Upgrade to TLS

Add a new opcode to upgrade an existing TCP socket to TLS, similar to `STARTTLS` or Chrome's `chrome.sockets.tcp.secure()`.

### New Opcode

```
OP_TCP_SECURE = 0x15   // Upgrade socket to TLS
OP_TCP_SECURED = 0x16  // Response: upgrade complete
```

### Protocol Flow

```
1. Extension creates TCP socket:
   ──► OP_TCP_CONNECT { socketId, port, host }
   ◄── OP_TCP_CONNECTED { socketId, status }

2. Extension requests TLS upgrade:
   ──► OP_TCP_SECURE { socketId, hostname }   // hostname for SNI
   ◄── OP_TCP_SECURED { socketId, status }

3. Subsequent send/recv is encrypted (transparent to extension):
   ──► OP_TCP_SEND { socketId, plaintext }    // daemon encrypts
   ◄── OP_TCP_RECV { socketId, plaintext }    // daemon decrypts
```

### TypeScript API Changes

#### ISocketFactory (interfaces/socket.ts)

```typescript
export interface ITcpSocket {
  // ... existing methods ...

  /**
   * Upgrade this socket to TLS.
   * @param hostname - Server hostname for SNI (Server Name Indication)
   * @returns Promise that resolves when TLS handshake completes
   */
  secure?(hostname: string): Promise<void>

  /**
   * Whether this socket is using TLS.
   */
  isSecure?: boolean
}
```

#### Sockets class (extension/src/lib/sockets.ts)

```typescript
const OP_TCP_SECURE = 0x15
const OP_TCP_SECURED = 0x16

class TcpSocket implements ITcpSocket {
  private _isSecure = false

  get isSecure(): boolean {
    return this._isSecure
  }

  async secure(hostname: string): Promise<void> {
    const reqId = this.factory.nextRequestId()

    // Payload: socketId(4) + hostname
    const hostBytes = new TextEncoder().encode(hostname)
    const buffer = new ArrayBuffer(4 + hostBytes.length)
    const view = new DataView(buffer)
    view.setUint32(0, this.id, true)
    new Uint8Array(buffer, 4).set(hostBytes)

    this.daemon.sendFrame(
      this.factory.packEnvelope(OP_TCP_SECURE, reqId, new Uint8Array(buffer))
    )

    await this.factory.waitForResponse(reqId)
    this._isSecure = true
  }
}
```

### Rust Native Host Implementation

Use `native-tls` crate (uses system TLS: SChannel on Windows, Security.framework on macOS, OpenSSL on Linux).

```rust
use native_tls::TlsConnector;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpStream;

enum SocketState {
    Plain(TcpStream),
    Secure(native_tls::TlsStream<TcpStream>),
}

struct SocketManager {
    sockets: HashMap<u32, SocketState>,
}

impl SocketManager {
    fn handle_tcp_secure(&mut self, socket_id: u32, hostname: &str) -> Result<(), Error> {
        let socket = self.sockets.remove(&socket_id)
            .ok_or(Error::SocketNotFound)?;

        let stream = match socket {
            SocketState::Plain(stream) => stream,
            SocketState::Secure(_) => return Err(Error::AlreadySecure),
        };

        let connector = TlsConnector::new()?;
        let tls_stream = connector.connect(hostname, stream)?;

        self.sockets.insert(socket_id, SocketState::Secure(tls_stream));
        Ok(())
    }

    fn send(&mut self, socket_id: u32, data: &[u8]) -> Result<(), Error> {
        match self.sockets.get_mut(&socket_id) {
            Some(SocketState::Plain(stream)) => stream.write_all(data)?,
            Some(SocketState::Secure(stream)) => stream.write_all(data)?,
            None => return Err(Error::SocketNotFound),
        }
        Ok(())
    }
}
```

**Cargo.toml addition:**
```toml
[dependencies]
native-tls = "0.2"
```

### Android IO Daemon Implementation

Use `SSLSocket` from `javax.net.ssl`:

```kotlin
import javax.net.ssl.SSLSocketFactory
import java.net.Socket

sealed class SocketState {
    data class Plain(val socket: Socket) : SocketState()
    data class Secure(val socket: javax.net.ssl.SSLSocket) : SocketState()
}

class SocketManager {
    private val sockets = mutableMapOf<Int, SocketState>()

    fun handleTcpSecure(socketId: Int, hostname: String): Boolean {
        val state = sockets[socketId] ?: return false

        val plainSocket = when (state) {
            is SocketState.Plain -> state.socket
            is SocketState.Secure -> return false // already secure
        }

        val sslSocketFactory = SSLSocketFactory.getDefault() as SSLSocketFactory
        val sslSocket = sslSocketFactory.createSocket(
            plainSocket,
            hostname,
            plainSocket.port,
            true // autoClose
        ) as javax.net.ssl.SSLSocket

        // Start TLS handshake
        sslSocket.startHandshake()

        sockets[socketId] = SocketState.Secure(sslSocket)
        return true
    }
}
```

## Usage in MinimalHttpClient

```typescript
async get(url: string): Promise<Uint8Array> {
  const parsed = new URL(url)
  const isHttps = parsed.protocol === 'https:'
  const port = parsed.port ? parseInt(parsed.port) : (isHttps ? 443 : 80)

  const socket = await this.socketFactory.createTcpSocket(parsed.hostname, port)

  if (isHttps && socket.secure) {
    await socket.secure(parsed.hostname)
  }

  // Send HTTP request (same as before - TLS is transparent)
  socket.send(this.buildRequest(parsed))
  // ...
}
```

## Certificate Validation

Both implementations use **system certificate stores** by default:
- **Rust/native-tls**: Windows cert store, macOS Keychain, or `/etc/ssl/certs` on Linux
- **Android**: System trust store

This means:
- Certs stay up-to-date with OS updates
- No bundled CA roots to maintain
- Corporate/enterprise CAs work if installed on system

## Future Considerations

1. **Skip validation option** - Some trackers use self-signed certs. Could add a flag:
   ```typescript
   secure(hostname: string, options?: { skipValidation?: boolean }): Promise<void>
   ```

2. **Client certificates** - Unlikely needed for BitTorrent.

3. **ALPN** - For HTTP/2 support in web seeds (future).

## Implementation Order

1. Add `OP_TCP_SECURE` / `OP_TCP_SECURED` opcodes to protocol
2. Implement in Rust native host first (easier to test locally)
3. Update TypeScript `ITcpSocket` interface and `Sockets` class
4. Update `MinimalHttpClient` to use TLS for HTTPS URLs
5. Port to Android IO daemon
6. Test with HTTPS trackers (e.g., ubuntu tracker)

## Interim Workaround

Until TLS is implemented, detect HTTPS tracker URLs early and mark them as unsupported with a clear error message instead of failing with a confusing bencode parse error.
