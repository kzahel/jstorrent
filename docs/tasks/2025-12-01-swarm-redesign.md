# Swarm Management Redesign

## Problem Statement

The current peer management is fragmented:

1. **TrackerManager** holds `knownPeers` - but this is only one discovery source
2. **PEX** parses peer addresses but they're emitted and lost (nobody listens)
3. **DHT/LPD** not implemented, but when added would be yet another source
4. **No unified view** of the swarm for a torrent
5. **No periodic maintenance** - we only fill peer slots on tracker announce or disconnect
6. **No failure tracking** with backoff - we retry dead peers immediately
7. **Same peer, multiple addresses** - a peer could be known via local IP + public IP, but we don't track this
8. **IPv6 not handled correctly** - PEX `added6` parsed with wrong byte count; no IPv6 tracker support

## IPv6 Considerations

BitTorrent has several specs for IPv6 support:

### BEP 7: IPv6 Tracker Extension

Trackers return IPv6 peers in a separate `peers6` field using compact format:
- IPv4 compact: 6 bytes per peer (4 address + 2 port)
- IPv6 compact: 18 bytes per peer (16 address + 2 port)

### PEX IPv6

PEX messages have separate fields:
- `added` / `dropped` - IPv4 peers (6 bytes each)
- `added6` / `dropped6` - IPv6 peers (18 bytes each)

**Current bug:** We parse `added6` with the IPv4 parser (6 bytes), which is wrong.

### Dual-Stack Peers

A single peer might be reachable via:
- IPv4 address (e.g., `73.45.12.8:51413`)
- IPv6 address (e.g., `[2001:db8::1]:51413`)
- IPv4-mapped IPv6 (e.g., `[::ffff:73.45.12.8]:51413`)

These are the **same peer** (same peerId after handshake) but different network paths.

### Design Implications

1. **Address type field** - Store whether address is IPv4 or IPv6
2. **Canonical form** - Normalize addresses before storing
3. **Separate parsing** - Different compact parsers for v4 vs v6
4. **Key format** - IPv6 needs brackets: `[::1]:6881` vs `127.0.0.1:6881`
5. **Peer identity grouping** - Group entries by peerId to see all addresses for a peer
6. **IPv4-mapped detection** - Optionally normalize `::ffff:x.x.x.x` to plain IPv4

## Design Goals

1. **Single source of truth** - `Torrent.swarm` holds all known peers
2. **Discovery-agnostic** - trackers, PEX, DHT, LPD all feed into the same swarm
3. **Rich peer metadata** - track identity, discovery source, connection history, stats
4. **Inspectable for debugging** - `torrent.swarm` getter shows full state
5. **Smart connection management** - exponential backoff for failed peers, periodic slot filling
6. **Peer identity tracking** - recognize same peer via different addresses

## Data Model

### AddressFamily

```typescript
type AddressFamily = 'ipv4' | 'ipv6';
```

### PeerAddress

A network address where a peer might be reachable:

```typescript
interface PeerAddress {
  ip: string;           // Canonical form: "1.2.3.4" or "2001:db8::1" (no brackets)
  port: number;
  family: AddressFamily;
}

// Helper to create canonical address key for Map
function addressKey(addr: PeerAddress): string {
  // IPv6 needs brackets to disambiguate from port
  return addr.family === 'ipv6' 
    ? `[${addr.ip}]:${addr.port}`
    : `${addr.ip}:${addr.port}`;
}

// Parse address key back to PeerAddress
function parseAddressKey(key: string): PeerAddress {
  if (key.startsWith('[')) {
    // IPv6: [ip]:port
    const match = key.match(/^\[([^\]]+)\]:(\d+)$/);
    if (!match) throw new Error(`Invalid address key: ${key}`);
    return { ip: match[1], port: parseInt(match[2], 10), family: 'ipv6' };
  } else {
    // IPv4: ip:port
    const [ip, portStr] = key.split(':');
    return { ip, port: parseInt(portStr, 10), family: 'ipv4' };
  }
}
```

### Address Utilities

```typescript
/**
 * Detect address family from string.
 */
function detectAddressFamily(ip: string): AddressFamily {
  return ip.includes(':') ? 'ipv6' : 'ipv4';
}

/**
 * Normalize an IP address to canonical form.
 * - IPv4: as-is
 * - IPv6: lowercase, compressed (e.g., "2001:0db8::1" → "2001:db8::1")
 * - IPv4-mapped IPv6: optionally extract IPv4
 */
function normalizeAddress(ip: string, extractMappedIPv4: boolean = true): { ip: string; family: AddressFamily } {
  if (!ip.includes(':')) {
    // Plain IPv4
    return { ip, family: 'ipv4' };
  }
  
  // IPv6
  const lower = ip.toLowerCase();
  
  // Check for IPv4-mapped IPv6 (::ffff:1.2.3.4)
  if (extractMappedIPv4) {
    const mappedMatch = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mappedMatch) {
      return { ip: mappedMatch[1], family: 'ipv4' };
    }
  }
  
  // TODO: Full IPv6 canonicalization (compress zeros, etc.)
  // For now, just lowercase
  return { ip: lower, family: 'ipv6' };
}

/**
 * Parse compact peer format from tracker/PEX.
 */
function parseCompactPeers(data: Uint8Array, family: AddressFamily): PeerAddress[] {
  const peers: PeerAddress[] = [];
  const bytesPerPeer = family === 'ipv4' ? 6 : 18;
  
  for (let i = 0; i + bytesPerPeer <= data.length; i += bytesPerPeer) {
    if (family === 'ipv4') {
      const ip = `${data[i]}.${data[i + 1]}.${data[i + 2]}.${data[i + 3]}`;
      const port = (data[i + 4] << 8) | data[i + 5];
      peers.push({ ip, port, family: 'ipv4' });
    } else {
      // IPv6: 16 bytes for address
      const parts: string[] = [];
      for (let j = 0; j < 16; j += 2) {
        const word = (data[i + j] << 8) | data[i + j + 1];
        parts.push(word.toString(16));
      }
      const ip = compressIPv6(parts.join(':'));
      const port = (data[i + 16] << 8) | data[i + 17];
      peers.push({ ip, port, family: 'ipv6' });
    }
  }
  
  return peers;
}

/**
 * Compress IPv6 address (collapse longest run of zeros).
 * "2001:0db8:0000:0000:0000:0000:0000:0001" → "2001:db8::1"
 */
function compressIPv6(ip: string): string {
  // Remove leading zeros from each group
  let parts = ip.split(':').map(p => p.replace(/^0+/, '') || '0');
  
  // Find longest run of zeros
  let bestStart = -1, bestLen = 0;
  let curStart = -1, curLen = 0;
  
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === '0') {
      if (curStart === -1) curStart = i;
      curLen++;
    } else {
      if (curLen > bestLen) {
        bestStart = curStart;
        bestLen = curLen;
      }
      curStart = -1;
      curLen = 0;
    }
  }
  if (curLen > bestLen) {
    bestStart = curStart;
    bestLen = curLen;
  }
  
  // Replace longest run with ::
  if (bestLen > 1) {
    const before = parts.slice(0, bestStart);
    const after = parts.slice(bestStart + bestLen);
    if (before.length === 0 && after.length === 0) {
      return '::';
    } else if (before.length === 0) {
      return '::' + after.join(':');
    } else if (after.length === 0) {
      return before.join(':') + '::';
    } else {
      return before.join(':') + '::' + after.join(':');
    }
  }
  
  return parts.join(':');
}
```

### DiscoverySource

How we first learned about a peer address (simple enum, not stored with metadata):

```typescript
type DiscoverySource = 'tracker' | 'pex' | 'dht' | 'lpd' | 'incoming' | 'manual';
```

### ConnectionState

```typescript
type ConnectionState = 
  | 'idle'        // Known but never tried, or recovered from failed
  | 'connecting'  // Connection in progress
  | 'connected'   // Active connection
  | 'failed'      // Last attempt failed (in backoff)
  | 'banned';     // Bad behavior - only for data corruption, not connection failures
```

**Note on banning:** We do NOT auto-ban peers just for connection failures (small swarms would be starved). Banning is reserved for peers that sent corrupt data (hash check failed with only that peer contributing). Use `unbanRecoverable()` to unban non-corrupt peers if swarm is desperate.

### SwarmPeer

One entry per ip:port combination:

```typescript
interface SwarmPeer {
  // Address (key is addressKey(this))
  ip: string;
  port: number;
  family: AddressFamily;
  
  // How we first discovered this peer
  source: DiscoverySource;
  discoveredAt: number;
  
  // Connection state
  state: ConnectionState;
  connection: PeerConnection | null;
  
  // Identity (populated after successful handshake)
  peerId: Uint8Array | null;
  clientName: string | null;  // Parsed from peerId, e.g. "µTorrent 3.5.5"
  
  // Connection history
  connectAttempts: number;
  connectFailures: number;
  lastConnectAttempt: number | null;
  lastConnectSuccess: number | null;
  lastConnectError: string | null;
  
  // Ban info (null if not banned)
  banReason: string | null;
  
  // Lifetime stats (persisted across connections)
  totalDownloaded: number;
  totalUploaded: number;
}
```

### SwarmStats

Summary for debugging/UI:

```typescript
interface SwarmStats {
  total: number;
  byState: {
    idle: number;
    connecting: number;
    connected: number;
    failed: number;
    banned: number;
  };
  byFamily: {
    ipv4: number;
    ipv6: number;
  };
  bySource: {
    tracker: number;
    pex: number;
    dht: number;
    lpd: number;
    incoming: number;
  };
  // Unique peer identities (by peerId)
  identifiedPeers: number;
  // Peers with multiple addresses (same peerId, different ip:port)
  multiAddressPeers: PeerIdentity[];
}
```

### PeerIdentity

Groups swarm peers by peerId (same peer, potentially multiple addresses):

```typescript
interface PeerIdentity {
  peerId: string;           // hex
  clientName: string | null;
  addresses: Array<{
    key: string;            // "[::1]:6881" or "1.2.3.4:6881"
    family: AddressFamily;
    state: ConnectionState;
  }>;
  // Aggregated stats
  totalDownloaded: number;
  totalUploaded: number;
}
```

This allows answering questions like:
- "How many unique peers do we know?" (by peerId, not by address)
- "Is this peer reachable via IPv6?" (check addresses)
- "What's our total exchange with peer X?" (sum across all their addresses)

## Swarm Class

```typescript
class Swarm extends EventEmitter {
  // All peers by address key
  private peers: Map<string, SwarmPeer> = new Map();
  
  // Indexes for efficient state-based queries (store keys, not peers)
  private connectedKeys: Set<string> = new Set();
  private connectingKeys: Set<string> = new Set();
  
  // PeerId index for identity grouping
  private peerIdIndex: Map<string, Set<string>> = new Map();  // peerId hex → Set of address keys
  
  constructor(
    private torrent: Torrent,
    private logger: Logger,
  ) {}
  
  // --- Discovery Integration ---
  
  /**
   * Add a peer address from any discovery source.
   * If already known, does nothing (first discovery wins).
   * Returns the peer (new or existing).
   */
  addPeer(address: PeerAddress, source: DiscoverySource): SwarmPeer {
    const key = addressKey(address);
    let peer = this.peers.get(key);
    
    if (peer) {
      // Already known - first source wins, nothing to update
      return peer;
    }
    
    // New peer
    peer = {
      ip: address.ip,
      port: address.port,
      family: address.family,
      source,
      discoveredAt: Date.now(),
      state: 'idle',
      connection: null,
      peerId: null,
      clientName: null,
      connectAttempts: 0,
      connectFailures: 0,
      lastConnectAttempt: null,
      lastConnectSuccess: null,
      lastConnectError: null,
      banReason: null,
      totalDownloaded: 0,
      totalUploaded: 0,
    };
    this.peers.set(key, peer);
    
    return peer;
  }
  
  /**
   * Bulk add peers (e.g., from tracker response or PEX).
   */
  addPeers(addresses: PeerAddress[], source: DiscoverySource): number {
    let added = 0;
    for (const addr of addresses) {
      const key = addressKey(addr);
      if (!this.peers.has(key)) {
        this.addPeer(addr, source);
        added++;
      }
    }
    if (added > 0) {
      this.emit('peersAdded', added);
    }
    return added;
  }
  
  /**
   * Add peers from compact format (tracker response or PEX).
   */
  addCompactPeers(data: Uint8Array, family: AddressFamily, source: DiscoverySource): number {
    const addresses = parseCompactPeers(data, family);
    return this.addPeers(addresses, source);
  }
  
  // --- Connection Management ---
  
  /**
   * Get peers eligible for connection attempts.
   * Filters out: connected, connecting, in backoff, banned.
   * Returns shuffled list limited to `limit` peers for efficiency.
   */
  getConnectablePeers(limit: number): SwarmPeer[] {
    const now = Date.now();
    const candidates: SwarmPeer[] = [];
    
    // Early exit once we have enough candidates
    // (shuffle happens after, so we over-collect slightly for randomness)
    const collectLimit = Math.min(limit * 3, 500);
    
    for (const peer of this.peers.values()) {
      if (candidates.length >= collectLimit) break;
      
      if (peer.state === 'connected' || peer.state === 'connecting') continue;
      if (peer.state === 'banned') continue;
      
      // Check backoff for failed peers
      if (peer.state === 'failed' && peer.lastConnectAttempt) {
        const backoffMs = this.calculateBackoff(peer.connectFailures);
        if (now - peer.lastConnectAttempt < backoffMs) continue;
      }
      
      candidates.push(peer);
    }
    
    // Shuffle for fairness
    this.shuffle(candidates);
    
    return candidates.slice(0, limit);
  }
  
  /**
   * Mark connection attempt started.
   */
  markConnecting(key: string): void {
    const peer = this.peers.get(key);
    if (peer) {
      peer.state = 'connecting';
      peer.connectAttempts++;
      peer.lastConnectAttempt = Date.now();
      this.connectingKeys.add(key);
    }
  }
  
  /**
   * Mark connection successful.
   */
  markConnected(key: string, connection: PeerConnection): void {
    const peer = this.peers.get(key);
    if (peer) {
      peer.state = 'connected';
      peer.connection = connection;
      peer.lastConnectSuccess = Date.now();
      peer.connectFailures = 0;  // Reset on success
      peer.lastConnectError = null;
      
      this.connectingKeys.delete(key);
      this.connectedKeys.add(key);
    }
  }
  
  /**
   * Update peer identity after handshake.
   * Also updates the peerId index for grouping.
   */
  setIdentity(key: string, peerId: Uint8Array, clientName: string): void {
    const peer = this.peers.get(key);
    if (!peer) return;
    
    // Remove from old peerId index if changing
    if (peer.peerId) {
      const oldPidHex = toHex(peer.peerId);
      const oldSet = this.peerIdIndex.get(oldPidHex);
      if (oldSet) {
        oldSet.delete(key);
        if (oldSet.size === 0) {
          this.peerIdIndex.delete(oldPidHex);
        }
      }
    }
    
    peer.peerId = peerId;
    peer.clientName = clientName;
    
    // Add to new peerId index
    const pidHex = toHex(peerId);
    let indexSet = this.peerIdIndex.get(pidHex);
    if (!indexSet) {
      indexSet = new Set();
      this.peerIdIndex.set(pidHex, indexSet);
    }
    indexSet.add(key);
  }
  
  /**
   * Mark connection failed.
   */
  markConnectFailed(key: string, reason: string): void {
    const peer = this.peers.get(key);
    if (peer) {
      peer.state = 'failed';
      peer.connection = null;
      peer.connectFailures++;
      peer.lastConnectError = reason;
      
      this.connectingKeys.delete(key);
    }
  }
  
  /**
   * Mark peer disconnected (was connected, now isn't).
   */
  markDisconnected(key: string): void {
    const peer = this.peers.get(key);
    if (peer) {
      // Accumulate stats from the connection before clearing
      if (peer.connection) {
        peer.totalDownloaded += peer.connection.downloaded;
        peer.totalUploaded += peer.connection.uploaded;
      }
      peer.state = 'idle';  // Can try again
      peer.connection = null;
      
      this.connectedKeys.delete(key);
    }
  }
  
  /**
   * Handle incoming connection (peer connected to us).
   */
  addIncomingConnection(ip: string, port: number, family: AddressFamily, connection: PeerConnection): SwarmPeer {
    const peer = this.addPeer({ ip, port, family }, 'incoming');
    const key = addressKey(peer);
    
    peer.state = 'connected';
    peer.connection = connection;
    peer.lastConnectSuccess = Date.now();
    this.connectedKeys.add(key);
    
    return peer;
  }
  
  /**
   * Ban a peer (bad behavior, corrupt data, etc).
   */
  ban(key: string, reason: string): void {
    const peer = this.peers.get(key);
    if (peer) {
      if (peer.connection) {
        peer.connection.close();
      }
      peer.state = 'banned';
      peer.connection = null;
      peer.banReason = reason;
      
      this.connectedKeys.delete(key);
      this.connectingKeys.delete(key);
      
      this.logger.info(`Banned peer ${key}: ${reason}`);
    }
  }
  
  /**
   * Unban a peer (e.g., if swarm is tiny and we need peers).
   */
  unban(key: string): void {
    const peer = this.peers.get(key);
    if (peer && peer.state === 'banned') {
      peer.state = 'idle';
      peer.banReason = null;
      peer.connectFailures = 0;  // Give them a fresh start
      this.logger.info(`Unbanned peer ${key}`);
    }
  }
  
  /**
   * Unban all peers that weren't banned for data corruption.
   * Useful when swarm is very small and we're desperate.
   */
  unbanRecoverable(): number {
    let count = 0;
    for (const peer of this.peers.values()) {
      if (peer.state === 'banned' && !peer.banReason?.includes('corrupt')) {
        peer.state = 'idle';
        peer.banReason = null;
        peer.connectFailures = 0;
        count++;
      }
    }
    if (count > 0) {
      this.logger.info(`Unbanned ${count} recoverable peers`);
    }
    return count;
  }
  
  // --- Efficient Queries ---
  
  get size(): number {
    return this.peers.size;
  }
  
  get connectedCount(): number {
    return this.connectedKeys.size;
  }
  
  get connectingCount(): number {
    return this.connectingKeys.size;
  }
  
  /**
   * Get all connected peers efficiently.
   */
  getConnectedPeers(): PeerConnection[] {
    const result: PeerConnection[] = [];
    for (const key of this.connectedKeys) {
      const peer = this.peers.get(key);
      if (peer?.connection) {
        result.push(peer.connection);
      }
    }
    return result;
  }
  
  /**
   * Get SwarmPeer by address.
   */
  getPeer(ip: string, port: number, family: AddressFamily): SwarmPeer | undefined {
    return this.peers.get(addressKey({ ip, port, family }));
  }
  
  getPeerByKey(key: string): SwarmPeer | undefined {
    return this.peers.get(key);
  }
  
  /**
   * Get all peers for a specific peer identity.
   */
  getPeersByPeerId(peerIdHex: string): SwarmPeer[] {
    const keys = this.peerIdIndex.get(peerIdHex);
    if (!keys) return [];
    const result: SwarmPeer[] = [];
    for (const key of keys) {
      const peer = this.peers.get(key);
      if (peer) result.push(peer);
    }
    return result;
  }
  
  /**
   * Count peers by family.
   */
  countByFamily(family: AddressFamily): number {
    let count = 0;
    for (const peer of this.peers.values()) {
      if (peer.family === family) count++;
    }
    return count;
  }
  
  /**
   * Count banned peers.
   */
  get bannedCount(): number {
    let count = 0;
    for (const peer of this.peers.values()) {
      if (peer.state === 'banned') count++;
    }
    return count;
  }
  
  // --- Connection Management ---
  
  /**
   * Get peers eligible for connection attempts.
   * Filters out: already connected, in backoff, banned, connecting.
   * Shuffles for fairness.
   */
  getConnectablePeers(limit: number): SwarmEntry[] {
    const now = Date.now();
    const candidates: SwarmEntry[] = [];
    
    for (const entry of this.entries.values()) {
      if (entry.state === 'connected' || entry.state === 'connecting') continue;
      if (entry.state === 'banned') continue;
      
      // Check backoff
      if (entry.state === 'failed' && entry.lastAttempt) {
        const backoffMs = this.calculateBackoff(entry.failureCount);
        if (now - entry.lastAttempt < backoffMs) continue;
      }
      
      candidates.push(entry);
    }
    
    // Shuffle for fairness
    this.shuffle(candidates);
    
    return candidates.slice(0, limit);
  }
  
  /**
   * Mark connection attempt started.
   */
  markConnecting(key: string): void {
    const entry = this.entries.get(key);
    if (entry) {
      entry.state = 'connecting';
      entry.lastAttempt = Date.now();
    }
  }
  
  /**
   * Mark connection successful.
   */
  markConnected(key: string, connection: PeerConnection): void {
    const entry = this.entries.get(key);
    if (entry) {
      entry.state = 'connected';
      entry.connection = connection;
      entry.lastConnected = Date.now();
      entry.failureCount = 0;  // Reset on success
      entry.lastFailureReason = null;
    }
  }
  
  /**
   * Update peer identity after handshake.
   * Also updates the peerId index for grouping.
   */
  setIdentity(key: string, peerId: Uint8Array, clientName: string): void {
    const entry = this.entries.get(key);
    if (entry) {
      // Remove from old peerId index if changing
      if (entry.peerId) {
        const oldPidHex = toHex(entry.peerId);
        const oldSet = this.peerIdIndex.get(oldPidHex);
        if (oldSet) {
          oldSet.delete(key);
          if (oldSet.size === 0) {
            this.peerIdIndex.delete(oldPidHex);
          }
        }
      }
      
      entry.peerId = peerId;
      entry.clientName = clientName;
      
      // Add to new peerId index
      const pidHex = toHex(peerId);
      let indexSet = this.peerIdIndex.get(pidHex);
      if (!indexSet) {
        indexSet = new Set();
        this.peerIdIndex.set(pidHex, indexSet);
      }
      indexSet.add(key);
    }
  }
  
  /**
   * Mark connection failed.
   */
  markConnectFailed(key: string, reason: string): void {
    const peer = this.peers.get(key);
    if (peer) {
      peer.state = 'failed';
      peer.connection = null;
      peer.connectFailures++;
      peer.lastConnectError = reason;
      
      this.connectingKeys.delete(key);
    }
  }
  
  /**
   * Mark peer disconnected (was connected, now isn't).
   */
  markDisconnected(key: string): void {
    const peer = this.peers.get(key);
    if (peer) {
      // Accumulate stats from the connection before clearing
      if (peer.connection) {
        peer.totalDownloaded += peer.connection.downloaded;
        peer.totalUploaded += peer.connection.uploaded;
      }
      peer.state = 'idle';  // Can try again
      peer.connection = null;
      
      this.connectedKeys.delete(key);
    }
  }
  
  /**
   * Handle incoming connection (peer connected to us).
   */
  addIncomingConnection(ip: string, port: number, family: AddressFamily, connection: PeerConnection): SwarmPeer {
    const peer = this.addPeer({ ip, port, family }, 'incoming');
    const key = addressKey(peer);
    
    peer.state = 'connected';
    peer.connection = connection;
    peer.lastConnectSuccess = Date.now();
    this.connectedKeys.add(key);
    
    return peer;
  }
  
  /**
   * Ban a peer (bad behavior, corrupt data, etc).
   */
  ban(key: string, reason: string): void {
    const peer = this.peers.get(key);
    if (peer) {
      if (peer.connection) {
        peer.connection.close();
      }
      peer.state = 'banned';
      peer.connection = null;
      peer.banReason = reason;
      
      this.connectedKeys.delete(key);
      this.connectingKeys.delete(key);
      
      this.logger.info(`Banned peer ${key}: ${reason}`);
    }
  }
  
  /**
   * Unban a peer (e.g., if swarm is tiny and we need peers).
   */
  unban(key: string): void {
    const peer = this.peers.get(key);
    if (peer && peer.state === 'banned') {
      peer.state = 'idle';
      peer.banReason = null;
      peer.connectFailures = 0;  // Give them a fresh start
      this.logger.info(`Unbanned peer ${key}`);
    }
  }
  
  /**
   * Unban all peers that weren't banned for data corruption.
   * Useful when swarm is very small and we're desperate.
   */
  unbanRecoverable(): number {
    let count = 0;
    for (const peer of this.peers.values()) {
      if (peer.state === 'banned' && !peer.banReason?.includes('corrupt')) {
        peer.state = 'idle';
        peer.banReason = null;
        peer.connectFailures = 0;
        count++;
      }
    }
    if (count > 0) {
      this.logger.info(`Unbanned ${count} recoverable peers`);
    }
    return count;
  }
  
  // --- Efficient Queries ---
  
  get size(): number {
    return this.peers.size;
  }
  
  get connectedCount(): number {
    return this.connectedKeys.size;
  }
  
  get connectingCount(): number {
    return this.connectingKeys.size;
  }
  
  get bannedCount(): number {
    let count = 0;
    for (const peer of this.peers.values()) {
      if (peer.state === 'banned') count++;
    }
    return count;
  }
  
  /**
   * Get all connected peers efficiently.
   */
  getConnectedPeers(): PeerConnection[] {
    const result: PeerConnection[] = [];
    for (const key of this.connectedKeys) {
      const peer = this.peers.get(key);
      if (peer?.connection) {
        result.push(peer.connection);
      }
    }
    return result;
  }
  
  /**
   * Get SwarmPeer by address.
   */
  getPeer(ip: string, port: number, family: AddressFamily): SwarmPeer | undefined {
    return this.peers.get(addressKey({ ip, port, family }));
  }
  
  getPeerByKey(key: string): SwarmPeer | undefined {
    return this.peers.get(key);
  }
  
  /**
   * Get all peers for a specific peer identity.
   */
  getPeersByPeerId(peerIdHex: string): SwarmPeer[] {
    const keys = this.peerIdIndex.get(peerIdHex);
    if (!keys) return [];
    const result: SwarmPeer[] = [];
    for (const key of keys) {
      const peer = this.peers.get(key);
      if (peer) result.push(peer);
    }
    return result;
  }
  
  /**
   * Count peers by family.
   */
  countByFamily(family: AddressFamily): number {
    let count = 0;
    for (const peer of this.peers.values()) {
      if (peer.family === family) count++;
    }
    return count;
  }
  
  getStats(): SwarmStats {
    const stats: SwarmStats = {
      total: this.peers.size,
      byState: { idle: 0, connecting: 0, connected: 0, failed: 0, banned: 0 },
      byFamily: { ipv4: 0, ipv6: 0 },
      bySource: { tracker: 0, pex: 0, dht: 0, lpd: 0, incoming: 0, manual: 0 },
      identifiedPeers: this.peerIdIndex.size,
      multiAddressPeers: [],
    };
    
    for (const peer of this.peers.values()) {
      stats.byState[peer.state]++;
      stats.byFamily[peer.family]++;
      stats.bySource[peer.source]++;
    }
    
    // Find peers with multiple addresses
    for (const [peerId, keys] of this.peerIdIndex) {
      if (keys.size > 1) {
        const peerList: SwarmPeer[] = [];
        for (const key of keys) {
          const p = this.peers.get(key);
          if (p) peerList.push(p);
        }
        
        const firstPeer = peerList[0];
        stats.multiAddressPeers.push({
          peerId,
          clientName: firstPeer.clientName,
          addresses: peerList.map(p => ({
            key: addressKey(p),
            family: p.family,
            state: p.state,
          })),
          totalDownloaded: peerList.reduce((sum, p) => sum + p.totalDownloaded, 0),
          totalUploaded: peerList.reduce((sum, p) => sum + p.totalUploaded, 0),
        });
      }
    }
    
    return stats;
  }
  
  /**
   * Get all peers (for debugging). Returns iterator to avoid copying.
   */
  allPeers(): IterableIterator<SwarmPeer> {
    return this.peers.values();
  }
  
  // --- Helpers ---
  
  private calculateBackoff(failures: number): number {
    // Exponential backoff: 1s, 2s, 4s, 8s, ... up to 5 minutes
    return Math.min(1000 * Math.pow(2, failures), 5 * 60 * 1000);
  }
  
  private shuffle<T>(array: T[]): void {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }
  
  /**
   * Clear all peers (on torrent removal).
   */
  clear(): void {
    for (const peer of this.peers.values()) {
      if (peer.connection) {
        peer.connection.close();
      }
    }
    this.peers.clear();
    this.connectedKeys.clear();
    this.connectingKeys.clear();
    this.peerIdIndex.clear();
  }
}
```

## Integration Points

### 1. TrackerManager → Swarm

TrackerManager should no longer hold peers. It emits events, Torrent adds to swarm:

```typescript
// In HttpTracker - parse both IPv4 and IPv6:
private parsePeers(data: any): void {
  // IPv4 peers (compact or dict format)
  if (data.peers) {
    if (data.peers instanceof Uint8Array) {
      const peers = parseCompactPeers(data.peers, 'ipv4');
      this.emit('peersDiscovered', peers);
    } else if (Array.isArray(data.peers)) {
      // Dict format (rare but valid)
      const peers = data.peers.map((p: any) => ({
        ip: p.ip,
        port: p.port,
        family: detectAddressFamily(p.ip),
      }));
      this.emit('peersDiscovered', peers);
    }
  }
  
  // IPv6 peers (BEP 7)
  if (data.peers6 && data.peers6 instanceof Uint8Array) {
    const peers = parseCompactPeers(data.peers6, 'ipv6');
    this.emit('peersDiscovered', peers);
  }
}

// In TrackerManager - just forward events:
tracker.on('peersDiscovered', (peers) => {
  this.emit('peersDiscovered', peers);
});

// In Torrent - add to swarm:
this.trackerManager.on('peersDiscovered', (peers: PeerAddress[]) => {
  this.swarm.addPeers(peers, 'tracker');
});
```

### 2. PEX → Swarm

Update PexHandler to use proper compact parsing and emit to swarm:

```typescript
// In PexHandler - fix IPv6 parsing:
private handlePexMessage(payload: Uint8Array) {
  try {
    const dict = Bencode.decode(payload);
    
    if (dict.added) {
      const peers = parseCompactPeers(dict.added, 'ipv4');
      this.peer.emit('pex_peers', peers);
    }
    if (dict.added6) {
      const peers = parseCompactPeers(dict.added6, 'ipv6');
      this.peer.emit('pex_peers', peers);
    }
    // Could also handle 'dropped' / 'dropped6'
  } catch (_err) {
    // Ignore invalid PEX messages
  }
}

// In Torrent, when setting up peer:
peer.on('pex_peers', (peers: PeerAddress[]) => {
  this.swarm.addPeers(peers, 'pex');
});
```

### 3. Incoming Connections

```typescript
// In BtEngine.handleIncomingConnection:
if (torrent) {
  const entry = torrent.swarm.addIncomingConnection(
    socket.remoteAddress,
    socket.remotePort,
    peer
  );
  // ... rest of handling
}
```

### 4. Connection Lifecycle

```typescript
// In Torrent.connectToPeer:
async connectToPeer(entry: SwarmEntry): Promise<void> {
  const key = `${entry.ip}:${entry.port}`;
  
  this.swarm.markConnecting(key);
  
  try {
    const socket = await this.socketFactory.createTcpSocket(entry.ip, entry.port);
    const peer = new PeerConnection(this.engineInstance, socket, {
      remoteAddress: entry.ip,
      remotePort: entry.port,
    });
    
    this.swarm.markConnected(key, peer);
    this.setupPeer(peer);
    peer.sendHandshake(this.infoHash, this.peerId);
    
  } catch (err) {
    this.swarm.markFailed(key, err.message);
  }
}

// When peer handshakes successfully:
peer.on('handshake', (infoHash, peerId, extensions) => {
  const key = `${peer.remoteAddress}:${peer.remotePort}`;
  const clientName = parseClientName(peerId);  // e.g. "-UT355-..." → "µTorrent 3.5.5"
  this.swarm.setIdentity(key, peerId, clientName);
});

// When peer disconnects:
peer.on('close', () => {
  const key = `${peer.remoteAddress}:${peer.remotePort}`;
  this.swarm.markDisconnected(key);
});
```

### 5. Periodic Maintenance

```typescript
// In Torrent:
private maintenanceInterval: ReturnType<typeof setInterval> | null = null;

startMaintenance(): void {
  if (this.maintenanceInterval) return;
  
  this.maintenanceInterval = setInterval(() => {
    this.runMaintenance();
  }, 5000);
}

stopMaintenance(): void {
  if (this.maintenanceInterval) {
    clearInterval(this.maintenanceInterval);
    this.maintenanceInterval = null;
  }
}

private runMaintenance(): void {
  if (!this._networkActive) return;
  if (this.isComplete && !this.isSeeding) return;
  
  const connected = this.swarm.connectedCount;
  const connecting = this.swarm.connectingCount;
  const slotsAvailable = this.maxPeers - connected - connecting;
  
  if (slotsAvailable > 0) {
    this.logger.debug(
      `Maintenance: ${connected} connected, ${connecting} connecting, ` +
      `${slotsAvailable} slots available, ${this.swarm.size} known peers`
    );
    
    const candidates = this.swarm.getConnectablePeers(slotsAvailable);
    for (const entry of candidates) {
      if (!this.globalLimitCheck()) break;
      this.connectToPeer(entry);
    }
  }
}
```

## Torrent.swarm Getter

For debugging, expose the stats (not all peers by default - too large):

```typescript
// In Torrent:
get swarm(): SwarmStats {
  return this._swarm.getStats();
}

// For detailed debugging when needed:
get swarmPeers(): IterableIterator<SwarmPeer> {
  return this._swarm.allPeers();
}
```

When inspecting in devtools:
```javascript
torrent.swarm
// {
//   total: 156,
//   byState: { idle: 120, connecting: 5, connected: 25, failed: 6, banned: 0 },
//   byFamily: { ipv4: 142, ipv6: 14 },
//   bySource: { tracker: 150, pex: 6, dht: 0, lpd: 0, incoming: 3, manual: 0 },
//   identifiedPeers: 28,  // unique peerIds seen
//   multiAddressPeers: [
//     { 
//       peerId: "2d5554333535...", 
//       clientName: "µTorrent 3.5.5",
//       addresses: [
//         { key: "192.168.1.5:51413", family: "ipv4", state: "connected" },
//         { key: "[2001:db8::5]:51413", family: "ipv6", state: "idle" }
//       ],
//       totalDownloaded: 15728640,
//       totalUploaded: 1048576
//     }
//   ]
// }
```

## Migration Path

### Phase 1: Add Swarm Class (non-breaking)

1. Create `Swarm` class in `packages/engine/src/core/swarm.ts`
2. Add `private _swarm: Swarm` to Torrent
3. Add `get swarm()` getter for debugging
4. Keep existing `peers` array and `pendingConnections` for now

### Phase 2: Route Discoveries to Swarm

1. Make TrackerManager emit peers (remove internal `knownPeers` Set)
2. Torrent adds to swarm on `peersDiscovered`
3. Wire up PEX `pex_peers` events to swarm (fix IPv6 parsing)
4. Keep TrackerManager.knownPeers for now (parallel)

### Phase 3: Use Swarm for Connections

1. `fillPeerSlots()` → uses `swarm.getConnectablePeers()`
2. `connectToPeer()` → takes SwarmPeer, uses swarm state methods
3. Remove `pendingConnections` Set (swarm tracks via `connectingKeys`)
4. Add periodic maintenance interval

### Phase 4: Remove Legacy

1. Remove `TrackerManager.knownPeers`
2. Remove `TrackerManager.getKnownPeers()` 
3. Migrate `this.peers` references to `this.swarm.getConnectedPeers()`
4. Eventually remove `this.peers` array entirely (use swarm's `connectedKeys`)

## Future: DHT and LPD

Once Swarm is in place, adding DHT/LPD is straightforward:

```typescript
// DHT integration
this.dht.on('peer', (ip, port) => {
  this.swarm.addPeer({ ip, port }, { type: 'dht' });
});

// LPD integration  
this.lpd.on('peer', (ip, port) => {
  this.swarm.addPeer({ ip, port }, { type: 'lpd' });
});
```

## Testing Checklist

- [ ] Swarm tracks peers from tracker announces (IPv4)
- [ ] Swarm tracks peers from tracker `peers6` field (IPv6)
- [ ] Swarm tracks peers from PEX `added` messages (IPv4)
- [ ] Swarm tracks peers from PEX `added6` messages (IPv6)
- [ ] Swarm tracks incoming connections
- [ ] Duplicate ip:port ignored (first source wins)
- [ ] IPv4-mapped IPv6 addresses normalized to IPv4 (optional)
- [ ] IPv6 addresses stored in compressed canonical form
- [ ] Connection failures tracked with backoff
- [ ] Backoff increases exponentially up to 5 min cap
- [ ] Only corrupt-data peers get banned (not connection failures)
- [ ] `unbanRecoverable()` unbans non-corrupt peers
- [ ] Periodic maintenance fills peer slots
- [ ] Maintenance respects global connection limit
- [ ] `getConnectablePeers()` limits candidates for efficiency
- [ ] `getConnectedPeers()` uses connectedKeys index (efficient)
- [ ] `torrent.swarm` shows accurate stats
- [ ] `byFamily` correctly counts IPv4 vs IPv6 peers
- [ ] Same peerId from different addresses grouped in `multiAddressPeers`
- [ ] Same peerId from IPv4 and IPv6 addresses linked correctly
- [ ] Swarm cleared on torrent removal
- [ ] peerIdIndex cleaned up when peers removed
- [ ] connectedKeys/connectingKeys stay in sync with peer states
