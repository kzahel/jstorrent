# Multicast UDP, UPnP Port Mapping, and LPD Support

## Overview

Add multicast UDP support to both daemons, enabling UPnP port mapping for incoming connections and Local Peer Discovery (LPD) for LAN transfers. This unblocks seeding tests on real torrents.

**Why multicast?**
- UPnP SSDP discovery uses multicast (239.255.255.250:1900)
- LPD (BEP 14) uses multicast (239.192.152.143:6771)

**Scope:**
1. Daemon protocol: Add multicast join/leave opcodes
2. Daemon HTTP: Add `/network/interfaces` endpoint
3. TypeScript: Update `IUdpSocket` interface and adapters
4. Engine: Port UPnP implementation from legacy code
5. Engine: Implement LPD (simpler, bonus)

---

## Phase 1: Daemon Protocol Changes

### 1.1 New Opcodes

Add to protocol (both Rust and Kotlin):

```
OP_UDP_JOIN_MULTICAST  = 0x25
OP_UDP_LEAVE_MULTICAST = 0x26
```

**Payload format (both):**
```
socketId: u32 (little-endian)
groupAddr: string (e.g., "239.255.255.250")
```

**Response:** None (fire-and-forget). Errors logged server-side.

### 1.2 Rust io-daemon: `native-host/io-daemon/src/ws.rs`

Add opcode constants after line 41:

```rust
const OP_UDP_JOIN_MULTICAST: u8 = 0x25;
const OP_UDP_LEAVE_MULTICAST: u8 = 0x26;
```

Add handling in the main match block (after `OP_UDP_CLOSE` handler, ~line 630):

```rust
OP_UDP_JOIN_MULTICAST => {
    // Payload: socketId(4), groupAddr(string)
    if payload.len() >= 4 {
        let socket_id = u32::from_le_bytes(payload[0..4].try_into().unwrap());
        let group_addr = String::from_utf8_lossy(&payload[4..]).to_string();
        
        if let Some(socket) = socket_manager.lock().await.udp_sockets.get(&socket_id) {
            if let Ok(group) = group_addr.parse::<std::net::Ipv4Addr>() {
                if let Err(e) = socket.join_multicast_v4(group, std::net::Ipv4Addr::UNSPECIFIED) {
                    eprintln!("Failed to join multicast {}: {}", group_addr, e);
                }
            }
        }
    }
}
OP_UDP_LEAVE_MULTICAST => {
    // Payload: socketId(4), groupAddr(string)
    if payload.len() >= 4 {
        let socket_id = u32::from_le_bytes(payload[0..4].try_into().unwrap());
        let group_addr = String::from_utf8_lossy(&payload[4..]).to_string();
        
        if let Some(socket) = socket_manager.lock().await.udp_sockets.get(&socket_id) {
            if let Ok(group) = group_addr.parse::<std::net::Ipv4Addr>() {
                let _ = socket.leave_multicast_v4(group, std::net::Ipv4Addr::UNSPECIFIED);
            }
        }
    }
}
```

**Note:** The tokio `UdpSocket` wraps a std socket. For multicast, you need to access the underlying socket. Use the `socket2` crate which is already a tokio dependency:

```rust
// In UdpSocket creation (OP_UDP_BIND handler), save the socket2::Socket reference
// OR use UdpSocket::from_std() and configure multicast before wrapping
```

Alternative approach - configure multicast during bind:

```rust
// In OP_UDP_BIND, after successful bind:
use socket2::{Socket, Domain, Type, Protocol};

let std_socket = std::net::UdpSocket::bind(&addr)?;
std_socket.set_multicast_loop_v4(true)?;  // See own messages (useful for testing)
std_socket.set_multicast_ttl_v4(1)?;       // LAN only
let socket = UdpSocket::from_std(std_socket)?;
```

Then multicast join/leave uses the standard library methods which work on tokio's UdpSocket.

### 1.3 Kotlin android-io-daemon: `app/src/main/java/com/jstorrent/app/server/Protocol.kt`

Add opcodes:

```kotlin
const val OP_UDP_JOIN_MULTICAST = 0x25
const val OP_UDP_LEAVE_MULTICAST = 0x26

// Update IO_OPCODES set
val IO_OPCODES = setOf(
    // ... existing ...
    OP_UDP_JOIN_MULTICAST,
    OP_UDP_LEAVE_MULTICAST
)
```

### 1.4 Kotlin android-io-daemon: `app/src/main/java/com/jstorrent/app/server/SocketHandler.kt`

In `handlePostAuth()`, add cases (after UDP_CLOSE handling):

```kotlin
Protocol.OP_UDP_JOIN_MULTICAST -> {
    if (payload.size >= 4) {
        val socketId = payload.sliceArray(0..3).toLEInt()
        val groupAddr = String(payload, 4, payload.size - 4)
        
        udpSockets[socketId]?.let { handler ->
            try {
                val group = java.net.InetAddress.getByName(groupAddr)
                handler.socket.joinGroup(group)
                Log.d(TAG, "UDP socket $socketId joined multicast $groupAddr")
            } catch (e: Exception) {
                Log.e(TAG, "Failed to join multicast $groupAddr: ${e.message}")
            }
        }
    }
}

Protocol.OP_UDP_LEAVE_MULTICAST -> {
    if (payload.size >= 4) {
        val socketId = payload.sliceArray(0..3).toLEInt()
        val groupAddr = String(payload, 4, payload.size - 4)
        
        udpSockets[socketId]?.let { handler ->
            try {
                val group = java.net.InetAddress.getByName(groupAddr)
                handler.socket.leaveGroup(group)
                Log.d(TAG, "UDP socket $socketId left multicast $groupAddr")
            } catch (e: Exception) {
                Log.w(TAG, "Failed to leave multicast $groupAddr: ${e.message}")
            }
        }
    }
}
```

**Note:** `DatagramSocket` doesn't support multicast directly. Need to use `MulticastSocket` instead. Update `UdpSocketHandler` to accept either, or always use `MulticastSocket` (it works for unicast too):

```kotlin
// In handlePostAuth() OP_UDP_BIND:
val socket = java.net.MulticastSocket(port)  // Instead of DatagramSocket
socket.reuseAddress = true
socket.timeToLive = 1  // LAN only
```

---

## Phase 2: Network Interfaces Endpoint

### 2.1 Rust io-daemon: `native-host/io-daemon/src/http.rs`

Add dependency to `Cargo.toml`:

```toml
get_if_addrs = "0.5"
```

Add endpoint:

```rust
use get_if_addrs::get_if_addrs;

async fn network_interfaces() -> impl IntoResponse {
    let interfaces = get_if_addrs()
        .map(|addrs| {
            addrs
                .into_iter()
                .filter_map(|iface| {
                    match iface.ip() {
                        std::net::IpAddr::V4(addr) => Some(serde_json::json!({
                            "name": iface.name,
                            "address": addr.to_string(),
                            "prefixLength": prefix_length_from_netmask(&iface)
                        })),
                        _ => None  // Skip IPv6 for now
                    }
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    
    Json(interfaces)
}

fn prefix_length_from_netmask(iface: &get_if_addrs::Interface) -> u8 {
    // get_if_addrs provides netmask, convert to prefix length
    match &iface.addr {
        get_if_addrs::IfAddr::V4(v4) => {
            let mask = u32::from(v4.netmask);
            mask.count_ones() as u8
        }
        _ => 24  // Default
    }
}
```

Add route in `routes()`:

```rust
.route("/network/interfaces", get(network_interfaces))
```

### 2.2 Kotlin android-io-daemon: `app/src/main/java/com/jstorrent/app/server/HttpServer.kt`

Add endpoint in routing:

```kotlin
get("/network/interfaces") {
    val interfaces = mutableListOf<Map<String, Any>>()
    
    try {
        val netInterfaces = java.net.NetworkInterface.getNetworkInterfaces()
        while (netInterfaces.hasMoreElements()) {
            val iface = netInterfaces.nextElement()
            if (iface.isLoopback || !iface.isUp) continue
            
            for (addr in iface.interfaceAddresses) {
                val inet = addr.address
                if (inet is java.net.Inet4Address) {
                    interfaces.add(mapOf(
                        "name" to iface.name,
                        "address" to inet.hostAddress,
                        "prefixLength" to addr.networkPrefixLength.toInt()
                    ))
                }
            }
        }
    } catch (e: Exception) {
        Log.e(TAG, "Failed to get network interfaces: ${e.message}")
    }
    
    call.respond(interfaces)
}
```

---

## Phase 3: TypeScript Interface Updates

### 3.1 Update `IUdpSocket` interface

File: `packages/engine/src/interfaces/socket.ts`

```typescript
export interface IUdpSocket {
  send(addr: string, port: number, data: Uint8Array): void
  onMessage(cb: (src: { addr: string; port: number }, data: Uint8Array) => void): void
  close(): void
  
  // Multicast support
  joinMulticast(group: string): Promise<void>
  leaveMulticast(group: string): Promise<void>
}
```

### 3.2 Update `DaemonUdpSocket`

File: `packages/engine/src/adapters/daemon/daemon-udp-socket.ts`

Add opcodes:

```typescript
const OP_UDP_JOIN_MULTICAST = 0x25
const OP_UDP_LEAVE_MULTICAST = 0x26
```

Add methods:

```typescript
async joinMulticast(group: string): Promise<void> {
  const groupBytes = new TextEncoder().encode(group)
  const buffer = new ArrayBuffer(4 + groupBytes.length)
  const view = new DataView(buffer)
  
  view.setUint32(0, this.id, true)
  new Uint8Array(buffer, 4).set(groupBytes)
  
  const env = new ArrayBuffer(8 + buffer.byteLength)
  const envView = new DataView(env)
  envView.setUint8(0, PROTOCOL_VERSION)
  envView.setUint8(1, OP_UDP_JOIN_MULTICAST)
  envView.setUint16(2, 0, true)
  envView.setUint32(4, 0, true)
  new Uint8Array(env, 8).set(new Uint8Array(buffer))
  
  this.daemon.sendFrame(env)
}

async leaveMulticast(group: string): Promise<void> {
  const groupBytes = new TextEncoder().encode(group)
  const buffer = new ArrayBuffer(4 + groupBytes.length)
  const view = new DataView(buffer)
  
  view.setUint32(0, this.id, true)
  new Uint8Array(buffer, 4).set(groupBytes)
  
  const env = new ArrayBuffer(8 + buffer.byteLength)
  const envView = new DataView(env)
  envView.setUint8(0, PROTOCOL_VERSION)
  envView.setUint8(1, OP_UDP_LEAVE_MULTICAST)
  envView.setUint16(2, 0, true)
  envView.setUint32(4, 0, true)
  new Uint8Array(env, 8).set(new Uint8Array(buffer))
  
  this.daemon.sendFrame(env)
}
```

### 3.3 Update other adapters (stub implementations)

For `MemoryUdpSocket` and `NodeUdpSocket`, add stub methods:

```typescript
async joinMulticast(_group: string): Promise<void> {
  // No-op for memory/test adapter
}

async leaveMulticast(_group: string): Promise<void> {
  // No-op for memory/test adapter
}
```

For Node adapter, can use `dgram.addMembership()` / `dropMembership()` if real multicast testing is needed later.

---

## Phase 4: UPnP Implementation

### 4.1 Create UPnP module

File: `packages/engine/src/upnp/index.ts`

```typescript
export { UPnPManager } from './upnp-manager'
export { SSDPClient } from './ssdp-client'
export { GatewayDevice } from './gateway-device'
```

### 4.2 SSDP Client

File: `packages/engine/src/upnp/ssdp-client.ts`

```typescript
import { ISocketFactory, IUdpSocket } from '../interfaces/socket'
import { Logger } from '../logging/logger'

const SSDP_MULTICAST = '239.255.255.250'
const SSDP_PORT = 1900
const SEARCH_TARGET = 'urn:schemas-upnp-org:device:InternetGatewayDevice:1'

export interface SSDPDevice {
  location: string
  server?: string
  usn?: string
}

export class SSDPClient {
  private socket: IUdpSocket | null = null
  private devices: SSDPDevice[] = []
  private searchTimeout: ReturnType<typeof setTimeout> | null = null
  
  constructor(
    private socketFactory: ISocketFactory,
    private logger?: Logger
  ) {}
  
  async search(timeoutMs = 3000): Promise<SSDPDevice[]> {
    this.devices = []
    this.socket = await this.socketFactory.createUdpSocket('0.0.0.0', 0)
    
    await this.socket.joinMulticast(SSDP_MULTICAST)
    
    return new Promise((resolve) => {
      this.socket!.onMessage((src, data) => {
        const response = new TextDecoder().decode(data)
        const device = this.parseResponse(response)
        if (device) {
          this.devices.push(device)
          this.logger?.debug(`SSDP: Found device at ${device.location}`)
        }
      })
      
      // Send M-SEARCH
      const request = [
        'M-SEARCH * HTTP/1.1',
        `HOST: ${SSDP_MULTICAST}:${SSDP_PORT}`,
        'MAN: "ssdp:discover"',
        'MX: 2',
        `ST: ${SEARCH_TARGET}`,
        '',
        ''
      ].join('\r\n')
      
      this.socket!.send(SSDP_MULTICAST, SSDP_PORT, new TextEncoder().encode(request))
      this.logger?.debug('SSDP: Sent M-SEARCH')
      
      this.searchTimeout = setTimeout(() => {
        this.cleanup()
        resolve(this.devices)
      }, timeoutMs)
    })
  }
  
  private parseResponse(response: string): SSDPDevice | null {
    if (!response.startsWith('HTTP') && !response.startsWith('NOTIFY')) {
      return null
    }
    
    const headers: Record<string, string> = {}
    const lines = response.split('\r\n')
    
    for (const line of lines) {
      const match = line.match(/^([^:]+):\s*(.*)$/)
      if (match) {
        headers[match[1].toLowerCase()] = match[2]
      }
    }
    
    // Check if this is an IGD response
    if (headers.st !== SEARCH_TARGET && headers.nt !== SEARCH_TARGET) {
      return null
    }
    
    if (!headers.location) {
      return null
    }
    
    return {
      location: headers.location,
      server: headers.server,
      usn: headers.usn
    }
  }
  
  private cleanup() {
    if (this.searchTimeout) {
      clearTimeout(this.searchTimeout)
      this.searchTimeout = null
    }
    if (this.socket) {
      this.socket.leaveMulticast(SSDP_MULTICAST)
      this.socket.close()
      this.socket = null
    }
  }
  
  stop() {
    this.cleanup()
  }
}
```

### 4.3 Gateway Device (SOAP client)

File: `packages/engine/src/upnp/gateway-device.ts`

```typescript
import { ISocketFactory } from '../interfaces/socket'
import { MinimalHttpClient } from '../utils/minimal-http-client'
import { Logger } from '../logging/logger'

const WAN_SERVICES = [
  'urn:schemas-upnp-org:service:WANIPConnection:1',
  'urn:schemas-upnp-org:service:WANPPPConnection:1'
]

interface ServiceInfo {
  serviceType: string
  controlURL: string
}

export class GatewayDevice {
  private baseUrl: URL
  private services: ServiceInfo[] = []
  private selectedService: ServiceInfo | null = null
  private http: MinimalHttpClient
  
  externalIP: string | null = null
  
  constructor(
    public location: string,
    socketFactory: ISocketFactory,
    private logger?: Logger
  ) {
    this.baseUrl = new URL(location)
    this.http = new MinimalHttpClient(socketFactory, logger)
  }
  
  async init(): Promise<boolean> {
    try {
      // Fetch device description
      const descData = await this.http.get(this.location)
      const descXml = new TextDecoder().decode(descData)
      
      // Parse services (simple XML parsing)
      this.services = this.parseServices(descXml)
      
      // Find WAN service
      for (const service of this.services) {
        if (WAN_SERVICES.includes(service.serviceType)) {
          this.selectedService = service
          break
        }
      }
      
      if (!this.selectedService) {
        this.logger?.warn('UPnP: No WAN service found')
        return false
      }
      
      // Get external IP to verify the device works
      this.externalIP = await this.getExternalIP()
      return this.externalIP !== null
      
    } catch (e) {
      this.logger?.error(`UPnP: Failed to init gateway: ${e}`)
      return false
    }
  }
  
  private parseServices(xml: string): ServiceInfo[] {
    const services: ServiceInfo[] = []
    
    // Simple regex-based XML parsing (sufficient for UPnP)
    const serviceRegex = /<service>([\s\S]*?)<\/service>/g
    let match
    
    while ((match = serviceRegex.exec(xml)) !== null) {
      const serviceXml = match[1]
      
      const typeMatch = serviceXml.match(/<serviceType>([^<]+)<\/serviceType>/)
      const urlMatch = serviceXml.match(/<controlURL>([^<]+)<\/controlURL>/)
      
      if (typeMatch && urlMatch) {
        services.push({
          serviceType: typeMatch[1],
          controlURL: urlMatch[1]
        })
      }
    }
    
    return services
  }
  
  async getExternalIP(): Promise<string | null> {
    if (!this.selectedService) return null
    
    const response = await this.soapAction('GetExternalIPAddress', [])
    const match = response.match(/<NewExternalIPAddress>([^<]+)<\/NewExternalIPAddress>/)
    return match ? match[1] : null
  }
  
  async addPortMapping(
    externalPort: number,
    internalPort: number,
    internalClient: string,
    protocol: 'TCP' | 'UDP',
    description: string,
    leaseDuration = 0
  ): Promise<boolean> {
    if (!this.selectedService) return false
    
    try {
      await this.soapAction('AddPortMapping', [
        ['NewRemoteHost', ''],
        ['NewExternalPort', externalPort.toString()],
        ['NewProtocol', protocol],
        ['NewInternalPort', internalPort.toString()],
        ['NewInternalClient', internalClient],
        ['NewEnabled', '1'],
        ['NewPortMappingDescription', description],
        ['NewLeaseDuration', leaseDuration.toString()]
      ])
      return true
    } catch (e) {
      this.logger?.error(`UPnP: AddPortMapping failed: ${e}`)
      return false
    }
  }
  
  async deletePortMapping(
    externalPort: number,
    protocol: 'TCP' | 'UDP'
  ): Promise<boolean> {
    if (!this.selectedService) return false
    
    try {
      await this.soapAction('DeletePortMapping', [
        ['NewRemoteHost', ''],
        ['NewExternalPort', externalPort.toString()],
        ['NewProtocol', protocol]
      ])
      return true
    } catch (e) {
      this.logger?.warn(`UPnP: DeletePortMapping failed: ${e}`)
      return false
    }
  }
  
  async getPortMappings(): Promise<Array<{
    externalPort: number
    internalPort: number
    internalClient: string
    protocol: string
    description: string
  }>> {
    if (!this.selectedService) return []
    
    const mappings: Array<{
      externalPort: number
      internalPort: number
      internalClient: string
      protocol: string
      description: string
    }> = []
    
    let index = 0
    while (true) {
      try {
        const response = await this.soapAction('GetGenericPortMappingEntry', [
          ['NewPortMappingIndex', index.toString()]
        ])
        
        const mapping = this.parsePortMapping(response)
        if (mapping) {
          mappings.push(mapping)
        }
        index++
      } catch {
        // End of list
        break
      }
    }
    
    return mappings
  }
  
  private parsePortMapping(xml: string) {
    const get = (tag: string) => {
      const match = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))
      return match ? match[1] : ''
    }
    
    return {
      externalPort: parseInt(get('NewExternalPort'), 10) || 0,
      internalPort: parseInt(get('NewInternalPort'), 10) || 0,
      internalClient: get('NewInternalClient'),
      protocol: get('NewProtocol'),
      description: get('NewPortMappingDescription')
    }
  }
  
  private async soapAction(action: string, args: [string, string][]): Promise<string> {
    if (!this.selectedService) throw new Error('No service selected')
    
    const controlUrl = this.baseUrl.origin + this.selectedService.controlURL
    
    const body = `<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
<s:Body>
<u:${action} xmlns:u="${this.selectedService.serviceType}">
${args.map(([k, v]) => `<${k}>${v}</${k}>`).join('\n')}
</u:${action}>
</s:Body>
</s:Envelope>`
    
    const responseBytes = await this.http.post(controlUrl, body, {
      'Content-Type': 'text/xml; charset="utf-8"',
      'SOAPAction': `"${this.selectedService.serviceType}#${action}"`
    })
    
    return new TextDecoder().decode(responseBytes)
  }
}
```

**Note:** `MinimalHttpClient` currently only supports GET. The POST method needed for SOAP is added in section 4.4 below.

### 4.4 Extend MinimalHttpClient for POST

File: `packages/engine/src/utils/minimal-http-client.ts`

UPnP SOAP requests require POST with these headers:

| Header | Value |
|--------|-------|
| Content-Type | `text/xml; charset="utf-8"` |
| Content-Length | byte length of UTF-8 encoded body |
| SOAPAction | `"urn:schemas-upnp-org:service:WANIPConnection:1#AddPortMapping"` |
| Connection | `close` |

**Important:** `Content-Length` must be the byte length of the UTF-8 encoded body, not the string character count. Since we encode to `Uint8Array` first, `byteLength` gives us exactly that.

Add the `post` method after the existing `get` method:

```typescript
async post(url: string, body: string, headers: Record<string, string> = {}): Promise<Uint8Array> {
  const urlObj = new URL(url)
  const host = urlObj.hostname
  const port = urlObj.port ? parseInt(urlObj.port, 10) : urlObj.protocol === 'https:' ? 443 : 80
  const path = urlObj.pathname + urlObj.search

  this.logger?.debug(
    `MinimalHttpClient: POST ${urlObj.protocol}//${host}:${port}${urlObj.pathname}`,
  )

  const socket = await this.socketFactory.createTcpSocket(host, port)
  const bodyBytes = fromString(body)

  return new Promise<Uint8Array>((resolve, reject) => {
    const requestLines = [
      `POST ${path} HTTP/1.1`,
      `Host: ${host}`,
      `Connection: close`,
      `Content-Length: ${bodyBytes.byteLength}`,
      `User-Agent: JSTorrent/0.0.1`,
      `Accept-Encoding: identity`,
    ]

    for (const [key, value] of Object.entries(headers)) {
      requestLines.push(`${key}: ${value}`)
    }

    requestLines.push('', '') // Double CRLF
    const headerBytes = fromString(requestLines.join('\r\n'))

    let buffer: Uint8Array = new Uint8Array(0)
    let headersParsed = false
    let contentLength: number | null = null
    let connectionClose = false
    let bodyStart = 0
    const MAX_RESPONSE_SIZE = 1024 * 1024 // 1MB cap
    let resolved = false

    const cleanup = () => {
      socket.close()
    }

    const fail = (err: Error) => {
      if (!resolved) {
        resolved = true
        this.logger?.error(`MinimalHttpClient: Request failed: ${err.message}`)
        cleanup()
        reject(err)
      }
    }

    const succeed = (responseBody: Uint8Array) => {
      if (!resolved) {
        resolved = true
        this.logger?.debug(`MinimalHttpClient: Response received, ${responseBody.length} bytes`)
        cleanup()
        resolve(responseBody)
      }
    }

    const processBuffer = () => {
      if (!headersParsed) {
        const separatorIndex = findSequence(buffer, CRLF_CRLF)
        if (separatorIndex !== -1) {
          const headerBuffer = buffer.subarray(0, separatorIndex)
          const headerString = toString(headerBuffer)
          bodyStart = separatorIndex + 4

          // Parse Status Line
          const lines = headerString.split('\r\n')
          const statusLine = lines[0]
          const [_, statusCodeStr] = statusLine.split(' ')
          const statusCode = parseInt(statusCodeStr, 10)

          // Parse Headers
          const resHeaders: Record<string, string> = {}
          for (let i = 1; i < lines.length; i++) {
            const [key, ...val] = lines[i].split(':')
            if (key) resHeaders[key.trim().toLowerCase()] = val.join(':').trim()
          }

          // 1. Reject Transfer-Encoding
          if (resHeaders['transfer-encoding']) {
            fail(new Error('Server used Transfer-Encoding, which is not supported'))
            return
          }

          // 2. Handle Status Codes (1xx, 204, 304 -> empty body)
          if (
            (statusCode >= 100 && statusCode < 200) ||
            statusCode === 204 ||
            statusCode === 304
          ) {
            succeed(new Uint8Array(0))
            return
          }

          // 3. Determine Framing
          if (resHeaders['content-length']) {
            const len = parseInt(resHeaders['content-length'], 10)
            if (isNaN(len) || len < 0) {
              fail(new Error('Invalid Content-Length'))
              return
            }
            contentLength = len
          }

          if (resHeaders['connection'] === 'close') {
            connectionClose = true
          }

          // 4. Reject if missing both
          if (contentLength === null && !connectionClose) {
            fail(new Error('Missing both Content-Length and Connection: close'))
            return
          }

          // 5. Check oversized (if CL known)
          if (contentLength !== null && contentLength > MAX_RESPONSE_SIZE) {
            fail(new Error(`Response too large: ${contentLength}`))
            return
          }

          headersParsed = true
        }
      }

      if (headersParsed) {
        const bodySize = buffer.length - bodyStart

        // Check oversized (accumulated)
        if (bodySize > MAX_RESPONSE_SIZE) {
          fail(new Error('Response body exceeded max size'))
          return
        }

        if (contentLength !== null) {
          if (bodySize >= contentLength) {
            // We have the full body
            const responseBody = buffer.subarray(bodyStart, bodyStart + contentLength)
            succeed(responseBody)
          }
        }
        // If connectionClose, we wait for onClose to handle body
      }
    }

    socket.onData((data) => {
      buffer = concat([buffer, data])
      processBuffer()
    })

    socket.onClose(() => {
      if (resolved) return

      if (headersParsed) {
        if (contentLength !== null) {
          // If we closed but didn't get full CL
          const bodySize = buffer.length - bodyStart
          if (bodySize < contentLength) {
            fail(
              new Error(
                `Connection closed before full Content-Length received (${bodySize}/${contentLength})`,
              ),
            )
          }
        } else if (connectionClose) {
          // Read until close
          const responseBody = buffer.subarray(bodyStart)
          succeed(responseBody)
        }
      } else {
        // Closed before headers
        fail(new Error('Connection closed before headers received'))
      }
    })

    socket.onError((err) => {
      fail(new Error(`Socket error: ${err.message}`))
    })

    // Send request: headers + body
    socket.send(concat([headerBytes, bodyBytes]))
  })
}
```

**Refactoring note:** The response handling logic is identical to `get()`. Consider extracting a shared `request()` method that both `get()` and `post()` call, passing the request bytes. For now, duplication is acceptable to keep the task focused.

### 4.5 UPnP Manager

File: `packages/engine/src/upnp/upnp-manager.ts`

```typescript
import { ISocketFactory } from '../interfaces/socket'
import { Logger } from '../logging/logger'
import { SSDPClient } from './ssdp-client'
import { GatewayDevice } from './gateway-device'

export interface NetworkInterface {
  name: string
  address: string
  prefixLength: number
}

export interface UPnPMapping {
  externalPort: number
  internalPort: number
  protocol: 'TCP' | 'UDP'
}

export class UPnPManager {
  private gateway: GatewayDevice | null = null
  private mappings: UPnPMapping[] = []
  private localAddress: string | null = null
  
  constructor(
    private socketFactory: ISocketFactory,
    private getNetworkInterfaces: () => Promise<NetworkInterface[]>,
    private logger?: Logger
  ) {}
  
  async discover(): Promise<boolean> {
    const ssdp = new SSDPClient(this.socketFactory, this.logger)
    
    try {
      const devices = await ssdp.search(3000)
      
      for (const device of devices) {
        const gateway = new GatewayDevice(device.location, this.socketFactory, this.logger)
        
        if (await gateway.init()) {
          this.gateway = gateway
          this.localAddress = await this.findLocalAddress(gateway)
          
          this.logger?.info(`UPnP: Found gateway at ${device.location}, external IP: ${gateway.externalIP}`)
          return true
        }
      }
      
      this.logger?.warn('UPnP: No working gateway found')
      return false
      
    } finally {
      ssdp.stop()
    }
  }
  
  private async findLocalAddress(gateway: GatewayDevice): Promise<string | null> {
    const interfaces = await this.getNetworkInterfaces()
    const gatewayUrl = new URL(gateway.location)
    const gatewayHost = gatewayUrl.hostname
    
    // Find interface on same subnet as gateway
    const gatewayParts = gatewayHost.split('.').map(Number)
    
    for (const iface of interfaces) {
      const ifaceParts = iface.address.split('.').map(Number)
      
      // Check if on same /24 subnet (common case)
      if (iface.prefixLength >= 24) {
        if (gatewayParts[0] === ifaceParts[0] &&
            gatewayParts[1] === ifaceParts[1] &&
            gatewayParts[2] === ifaceParts[2]) {
          return iface.address
        }
      }
      
      // More general subnet matching
      const mask = ~0 << (32 - iface.prefixLength)
      const gatewayNum = (gatewayParts[0] << 24) | (gatewayParts[1] << 16) | (gatewayParts[2] << 8) | gatewayParts[3]
      const ifaceNum = (ifaceParts[0] << 24) | (ifaceParts[1] << 16) | (ifaceParts[2] << 8) | ifaceParts[3]
      
      if ((gatewayNum & mask) === (ifaceNum & mask)) {
        return iface.address
      }
    }
    
    this.logger?.warn('UPnP: Could not find local address matching gateway subnet')
    return interfaces[0]?.address ?? null
  }
  
  async addMapping(port: number, protocol: 'TCP' | 'UDP' = 'TCP'): Promise<boolean> {
    if (!this.gateway || !this.localAddress) {
      return false
    }
    
    const success = await this.gateway.addPortMapping(
      port,
      port,
      this.localAddress,
      protocol,
      'JSTorrent'
    )
    
    if (success) {
      this.mappings.push({ externalPort: port, internalPort: port, protocol })
      this.logger?.info(`UPnP: Mapped ${protocol} port ${port}`)
    }
    
    return success
  }
  
  async removeMapping(port: number, protocol: 'TCP' | 'UDP' = 'TCP'): Promise<boolean> {
    if (!this.gateway) return false
    
    const success = await this.gateway.deletePortMapping(port, protocol)
    
    if (success) {
      this.mappings = this.mappings.filter(m => 
        !(m.externalPort === port && m.protocol === protocol)
      )
    }
    
    return success
  }
  
  async cleanup(): Promise<void> {
    for (const mapping of [...this.mappings]) {
      await this.removeMapping(mapping.externalPort, mapping.protocol)
    }
  }
  
  get externalIP(): string | null {
    return this.gateway?.externalIP ?? null
  }
}
```

---

## Phase 5: LPD Implementation (Bonus)

File: `packages/engine/src/lpd/lpd-service.ts`

```typescript
import { ISocketFactory, IUdpSocket } from '../interfaces/socket'
import { Logger } from '../logging/logger'
import { InfoHash } from '../utils/infohash'

const LPD_MULTICAST = '239.192.152.143'
const LPD_PORT = 6771
const ANNOUNCE_INTERVAL = 5 * 60 * 1000  // 5 minutes

export class LPDService {
  private socket: IUdpSocket | null = null
  private announceInterval: ReturnType<typeof setInterval> | null = null
  private port: number = 0
  private infoHashes: Set<string> = new Set()
  private onPeerDiscovered: ((infoHash: InfoHash, host: string, port: number) => void) | null = null
  
  constructor(
    private socketFactory: ISocketFactory,
    private logger?: Logger
  ) {}
  
  async start(listenPort: number): Promise<void> {
    this.port = listenPort
    this.socket = await this.socketFactory.createUdpSocket('0.0.0.0', LPD_PORT)
    await this.socket.joinMulticast(LPD_MULTICAST)
    
    this.socket.onMessage((src, data) => {
      this.handleMessage(src.addr, data)
    })
    
    // Start periodic announcements
    this.announceInterval = setInterval(() => {
      this.announceAll()
    }, ANNOUNCE_INTERVAL)
    
    this.logger?.info(`LPD: Started on port ${listenPort}`)
  }
  
  stop(): void {
    if (this.announceInterval) {
      clearInterval(this.announceInterval)
      this.announceInterval = null
    }
    if (this.socket) {
      this.socket.leaveMulticast(LPD_MULTICAST)
      this.socket.close()
      this.socket = null
    }
  }
  
  addInfoHash(infoHash: InfoHash): void {
    this.infoHashes.add(infoHash)
    this.announce(infoHash)
  }
  
  removeInfoHash(infoHash: InfoHash): void {
    this.infoHashes.delete(infoHash)
  }
  
  onPeer(cb: (infoHash: InfoHash, host: string, port: number) => void): void {
    this.onPeerDiscovered = cb
  }
  
  private announce(infoHash: InfoHash): void {
    if (!this.socket) return
    
    const message = [
      'BT-SEARCH * HTTP/1.1',
      `Host: ${LPD_MULTICAST}:${LPD_PORT}`,
      `Port: ${this.port}`,
      `Infohash: ${infoHash}`,
      '',
      ''
    ].join('\r\n')
    
    this.socket.send(LPD_MULTICAST, LPD_PORT, new TextEncoder().encode(message))
  }
  
  private announceAll(): void {
    for (const infoHash of this.infoHashes) {
      this.announce(infoHash as InfoHash)
    }
  }
  
  private handleMessage(fromHost: string, data: Uint8Array): void {
    const message = new TextDecoder().decode(data)
    
    if (!message.startsWith('BT-SEARCH')) return
    
    const headers: Record<string, string> = {}
    for (const line of message.split('\r\n')) {
      const match = line.match(/^([^:]+):\s*(.*)$/)
      if (match) {
        headers[match[1].toLowerCase()] = match[2]
      }
    }
    
    const infoHash = headers.infohash?.toLowerCase() as InfoHash
    const port = parseInt(headers.port, 10)
    
    if (!infoHash || !port || isNaN(port)) return
    
    // Only notify if we're interested in this torrent
    if (this.infoHashes.has(infoHash) && this.onPeerDiscovered) {
      this.logger?.debug(`LPD: Discovered peer ${fromHost}:${port} for ${infoHash.slice(0, 8)}`)
      this.onPeerDiscovered(infoHash, fromHost, port)
    }
  }
}
```

---

## Verification

### Manual Testing

1. **Multicast receive:**
   ```bash
   # From another machine on LAN, send SSDP probe
   echo -e "M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\nST: ssdp:all\r\n\r\n" | nc -u 239.255.255.250 1900
   ```

2. **UPnP discovery:**
   - Run engine with UPnP enabled
   - Check logs for gateway discovery
   - Verify port mapping in router admin UI

3. **LPD:**
   - Run two instances on same LAN
   - Add same torrent to both
   - Verify peer connection without trackers

### Unit Tests

Add tests for:
- SSDP response parsing
- SOAP XML generation
- LPD message parsing
- Subnet matching logic

---

## Dependencies

**Rust:**
- `get_if_addrs = "0.5"` (already used by tokio internally, or add explicitly)

**Kotlin:**
- No new dependencies (uses java.net.*)

**TypeScript:**
- No new dependencies

---

## Notes

1. **TTL:** Multicast TTL is set to 1 (LAN only) to avoid leaking to wider network
2. **Loopback:** Multicast loopback is enabled for testing (see own messages)
3. **IPv6:** Skipped for now - focus on IPv4 which covers 99% of home routers
4. **Lease Duration:** Port mappings use 0 (permanent) - cleanup on exit is best-effort
