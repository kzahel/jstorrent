---
title: "The DHT IPv6 Bug That Broke Bootstrap"
description: "How a hostname resolution issue on IPv4-bound sockets silently killed DHT on many networks, and the debugging journey to find it."
date: 2026-02-22
tags: [networking, dht, debugging]
---

JSTorrent's DHT implementation was silently failing to bootstrap on many networks. No errors, no warnings — just a DHT table that stayed empty. This is the story of tracking down a subtle IPv4/IPv6 incompatibility that affected both the Rust io-daemon (desktop) and the Kotlin UDP layer (Android).

## The symptom

DHT bootstrap involves sending UDP packets to well-known bootstrap nodes like `dht.transmissionbt.com:6881`. The engine would dutifully fire off these packets, but no responses ever came back. The routing table stayed empty, peer discovery silently degraded to trackers only.

On some networks it worked fine. On others, total silence.

## The root cause

The problem was deceptively simple. Our UDP sockets bind to `0.0.0.0` — an IPv4 address. But when we called `send_to` with a hostname like `dht.transmissionbt.com`, the underlying DNS resolution (`getaddrinfo` on Linux/macOS, `InetAddress.getByName` on Android) returns addresses in system-preferred order. On systems that prefer IPv6 — which is increasingly common — the first result is an IPv6 address like `2001:db8::1`.

Sending an IPv6 packet through an IPv4-bound socket fails silently. The packet goes nowhere.

### Rust (io-daemon)

Tokio's `UdpSocket::send_to` with a hostname string calls `getaddrinfo` with `AF_UNSPEC`, which returns all address families. It picks the first result — often IPv6:

```rust
// Before: silently fails on IPv6-preferring systems
let addr = format!("{dest_addr}:{dest_port}");
socket.send_to(data, &addr).await.is_ok()
```

### Android (Kotlin)

Same pattern — `InetSocketAddress(hostname, port)` internally calls `InetAddress.getByName()`, which may return an IPv6 address:

```kotlin
// Before: may resolve to IPv6, failing on our IPv4 socket
val packet = DatagramPacket(data, data.size, InetSocketAddress(destAddr, destPort))
socket.send(packet)
```

## The fix

Both platforms needed the same fix: resolve the hostname ourselves and explicitly prefer IPv4 addresses.

**Rust:** Manually call `tokio::net::lookup_host` and filter for IPv4 before sending. Also added proper error logging — the silent failure was the worst part of this bug.

```rust
// Resolve and pick the first IPv4 address
let host_port = format!("{dest_addr}:{dest_port}");
match tokio::net::lookup_host(host_port).await {
    Ok(mut addrs) => addrs.find(std::net::SocketAddr::is_ipv4),
    Err(e) => {
        tracing::warn!("UDP DNS resolution failed for {}: {}", dest_addr, e);
        None
    }
}
```

**Kotlin:** Use `InetAddress.getAllByName()` and pick the first `Inet4Address`:

```kotlin
private fun resolvePreferIPv4(host: String): InetAddress {
    val addrs = InetAddress.getAllByName(host)
    return addrs.firstOrNull { it is Inet4Address } ?: addrs.first()
}
```

## Additional improvements

While investigating, I also found that DHT bootstrap was too fragile in general:

- **Added retry logic**: Up to 3 retries with exponential backoff (5s, 15s, 30s) if bootstrap completely fails
- **Added a bootstrap node**: `dht.libtorrent.org:25401` joins the existing three nodes for more redundancy
- **Increased query timeout**: 5s → 10s, since slow DNS resolution + UDP round-trip to distant nodes can exceed 5 seconds
- **Added diagnostic scripts**: `test-dht-bootstrap.cjs` and friends for quickly testing DHT connectivity without spinning up the full engine

## Takeaway

The "silent failure" pattern is insidious. The `send_to` call returned `Ok(())` even though the packet went nowhere useful. If you're doing UDP on a socket bound to a specific address family, always resolve hostnames yourself and filter for the matching family. And always log send failures — a quiet `is_ok()` check is a recipe for mysteries.
