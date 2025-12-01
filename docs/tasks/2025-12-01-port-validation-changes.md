# Port Validation Changes - Agent Guide

Apply these changes to `packages/engine/src/core/swarm.ts` to add port validation and suspicious port handling.

## 1. Add Port Validation Section (before Address Utilities section)

Insert this new section before the `// Address Utilities` comment:

```typescript
// ============================================================================
// Port Validation
// ============================================================================

/**
 * Well-known ports that are almost certainly not BitTorrent peers.
 * Connecting to these could be malicious (port scanning) or misconfiguration.
 */
const SUSPICIOUS_PORTS = new Set([
  1,    // tcpmux
  7,    // echo
  20,   // FTP data
  21,   // FTP control
  22,   // SSH
  23,   // Telnet
  25,   // SMTP
  53,   // DNS
  80,   // HTTP
  110,  // POP3
  143,  // IMAP
  443,  // HTTPS
  445,  // SMB
  993,  // IMAPS
  995,  // POP3S
])

/**
 * Check if a port is valid for BitTorrent connections.
 * Returns false for port 0 (invalid) and other clearly wrong values.
 */
export function isValidPort(port: number): boolean {
  return port > 0 && port <= 65535
}

/**
 * Check if a port is suspicious (likely misconfiguration or malicious).
 * These peers should be heavily down-scored or skipped entirely.
 */
export function isSuspiciousPort(port: number): boolean {
  // Port 0 is invalid
  if (port <= 0) return true
  
  // Privileged ports (require root) - very unlikely for BitTorrent
  if (port < 1024) return true
  
  // Well-known service ports that definitely aren't BitTorrent
  if (SUSPICIOUS_PORTS.has(port)) return true
  
  return false
}

/**
 * Get a score penalty for suspicious ports.
 * Returns 0 for normal ports, negative values for suspicious ones.
 */
export function getPortScorePenalty(port: number): number {
  if (port <= 0) return -1000  // Invalid, never use
  if (port < 1024) return -500  // Privileged, almost never use
  if (SUSPICIOUS_PORTS.has(port)) return -500
  return 0
}
```

## 2. Add `suspiciousPort` field to SwarmPeer interface

Add this field to the `SwarmPeer` interface, after `banReason`:

```typescript
  // Ban info (null if not banned)
  banReason: string | null

  // Port quality indicator (privileged ports, well-known services)
  suspiciousPort: boolean

  // Lifetime stats (persisted across connections)
  totalDownloaded: number
```

## 3. Update `addPeer` method

Replace the `addPeer` method to validate ports and mark suspicious ones:

```typescript
  /**
   * Add a peer address from any discovery source.
   * If already known, does nothing (first discovery wins).
   * Returns the peer (new or existing), or null if the address is invalid.
   */
  addPeer(address: PeerAddress, source: DiscoverySource): SwarmPeer | null {
    // Reject invalid ports entirely
    if (!isValidPort(address.port)) {
      this.logger.debug(`Rejecting peer ${address.ip}:${address.port} - invalid port`)
      return null
    }

    const key = addressKey(address)
    let peer = this.peers.get(key)

    if (peer) {
      // Already known - first source wins, nothing to update
      return peer
    }

    // Check if port is suspicious (privileged or well-known service)
    const suspicious = isSuspiciousPort(address.port)
    if (suspicious) {
      this.logger.debug(`Peer ${address.ip}:${address.port} has suspicious port (privileged/<1024)`)
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
      suspiciousPort: suspicious,
      totalDownloaded: 0,
      totalUploaded: 0,
    }
    this.peers.set(key, peer)

    return peer
  }
```

## 4. Update `addPeers` method

Add port validation to bulk add:

```typescript
  /**
   * Bulk add peers (e.g., from tracker response or PEX).
   * Returns count of newly added valid peers.
   */
  addPeers(addresses: PeerAddress[], source: DiscoverySource): number {
    let added = 0
    for (const addr of addresses) {
      // Skip invalid ports
      if (!isValidPort(addr.port)) continue
      
      const key = addressKey(addr)
      if (!this.peers.has(key)) {
        if (this.addPeer(addr, source)) {
          added++
        }
      }
    }
    if (added > 0) {
      this.emit('peersAdded', added)
    }
    return added
  }
```

## 5. Replace `getConnectablePeers` method

Replace with scored selection that deprioritizes suspicious ports:

```typescript
  /**
   * Get peers eligible for connection attempts.
   * Filters out: connected, connecting, in backoff, banned.
   * Returns list sorted by quality score (best first), limited to `limit` peers.
   * Suspicious port peers are returned last (only as last resort).
   */
  getConnectablePeers(limit: number): SwarmPeer[] {
    const now = Date.now()
    const normalCandidates: SwarmPeer[] = []
    const suspiciousCandidates: SwarmPeer[] = []

    // Collect eligible candidates, separating suspicious ports
    for (const peer of this.peers.values()) {
      if (peer.state === 'connected' || peer.state === 'connecting') continue
      if (peer.state === 'banned') continue

      // Check backoff for failed peers
      if (peer.state === 'failed' && peer.lastConnectAttempt) {
        const backoffMs = this.calculateBackoff(peer.connectFailures)
        if (now - peer.lastConnectAttempt < backoffMs) continue
      }

      // Separate suspicious ports - they go last
      if (peer.suspiciousPort) {
        suspiciousCandidates.push(peer)
      } else {
        normalCandidates.push(peer)
      }
    }

    // Score and sort normal candidates
    const scoredNormal = normalCandidates.map(peer => ({
      peer,
      score: this.calculatePeerScore(peer, now),
    }))
    scoredNormal.sort((a, b) => b.score - a.score)

    // Shuffle suspicious candidates (they're all equally bad)
    this.shuffle(suspiciousCandidates)

    // Return normal peers first, then suspicious as last resort
    const result: SwarmPeer[] = []
    for (const { peer } of scoredNormal) {
      if (result.length >= limit) break
      result.push(peer)
    }
    
    // Only add suspicious peers if we still need more
    for (const peer of suspiciousCandidates) {
      if (result.length >= limit) break
      result.push(peer)
    }

    return result
  }

  /**
   * Calculate a quality score for peer selection.
   * Higher is better.
   */
  private calculatePeerScore(peer: SwarmPeer, now: number): number {
    let score = 100

    // Port quality
    score += getPortScorePenalty(peer.port)

    // Prefer peers with previous successful connections
    if (peer.lastConnectSuccess) {
      score += 50
    }

    // Penalize repeated failures
    score -= peer.connectFailures * 20

    // Prefer peers with good download history
    if (peer.totalDownloaded > 0) {
      score += Math.min(50, Math.log10(peer.totalDownloaded) * 10)
    }

    // Penalize recently failed peers (even if backoff expired)
    if (peer.lastConnectAttempt) {
      const timeSince = now - peer.lastConnectAttempt
      if (timeSince < 30000) score -= 30
      else if (timeSince < 60000) score -= 15
    }

    // Source quality
    switch (peer.source) {
      case 'manual':
        score += 20
        break
      case 'tracker':
        score += 10
        break
      case 'incoming':
        score += 5  // They found us, probably real
        break
      case 'pex':
        score += 0  // Neutral
        break
      case 'dht':
        score -= 5  // DHT can have more junk
        break
      case 'lpd':
        score += 15  // Local network, usually good
        break
    }

    // Add small random factor to avoid always picking same peers
    score += Math.random() * 10

    return score
  }
```

## 6. Update `addIncomingConnection` method

For incoming connections, accept even suspicious ports (connection already established):

```typescript
  /**
   * Handle incoming connection (peer connected to us).
   * For incoming connections, we accept even suspicious ports since
   * the connection is already established.
   */
  addIncomingConnection(
    ip: string,
    port: number,
    family: AddressFamily,
    connection: PeerConnection,
  ): SwarmPeer {
    // For incoming, we create the peer directly to ensure we accept it
    // even if the port would normally be rejected
    const key = addressKey({ ip, port, family })
    let peer = this.peers.get(key)

    if (!peer) {
      peer = {
        ip,
        port,
        family,
        source: 'incoming',
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
        suspiciousPort: isSuspiciousPort(port),
        totalDownloaded: 0,
        totalUploaded: 0,
      }
      this.peers.set(key, peer)
    }

    peer.state = 'connected'
    peer.connection = connection
    peer.lastConnectSuccess = Date.now()
    this.connectedKeys.add(key)

    this.emit('peerConnected', key, peer)

    return peer
  }
```

## 7. Export new functions

Add to exports at top of file or ensure they're exported:

```typescript
export {
  isValidPort,
  isSuspiciousPort,
  getPortScorePenalty,
  // ... existing exports
}
```

## Summary

- Invalid ports (0, negative, >65535): Rejected entirely, `addPeer` returns `null`
- Suspicious ports (<1024): Accepted but marked `suspiciousPort: true`, returned last by `getConnectablePeers`
- Normal ports (≥1024): Scored by success history, download stats, source quality
- Incoming connections: Always accepted regardless of port (already connected)
