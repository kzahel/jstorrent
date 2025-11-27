# BitTorrent Engine Analysis

**Date:** 2025-11-23
**Scope:** `packages/engine` (Core, Protocol, Tracker)

## 1. Executive Summary

The `packages/engine` codebase represents an early-stage "alpha" implementation of the BitTorrent protocol. While it demonstrates a basic understanding of the wire protocol and can theoretically download data under highly controlled conditions (single-block pieces, ideal network), it is **currently unfit for real-world usage**.

The most critical deficiency is the **lack of distinction between Pieces and Blocks**. The engine assumes a 1:1 mapping, which violates the core structure of almost all real-world torrents (where pieces are typically 256KB-4MB and blocks are 16KB).

## 2. Architectural Overview

The engine follows a standard object-oriented design:
- **`Client`**: Entry point (implied).
- **`Torrent`**: Manages the state of a single download, orchestrating peers and storage.
- **`PeerConnection`**: Handles TCP socket communication and wire protocol parsing.
- **`PieceManager`**: Tracks bitfield state (have/missing pieces).
- **`DiskManager`**: Handles file I/O.
- **`Tracker`**: Handles peer discovery (HTTP/UDP).

### Strengths
- **Clean Separation of Concerns**: The division between `PeerConnection`, `PieceManager`, and `DiskManager` is logical and follows standard practices.
- **Protocol Abstraction**: `WireProtocol` class correctly isolates message parsing/serialization logic.
- **Interface-Driven**: Use of interfaces (`ITcpSocket`, `IFileSystem`) allows for easy mocking and cross-platform support (Node.js vs. Browser).

### Weaknesses
- **Naive State Management**: `Torrent` class couples orchestration with basic logic. It lacks a dedicated "Downloader" or "Strategy" component to handle complex piece picking.
- **Inefficient Buffer Handling**: `PeerConnection` uses repeated `slice()` operations on `Uint8Array`, which is O(N^2) in worst-case scenarios and generates excessive garbage.
- **Missing Event Loop**: The engine lacks a central "tick" or event loop for maintenance tasks (optimistic unchoking, keep-alives, tracker re-announces).

## 3. Protocol Correctness & BEP Compliance

### BEP 03 (The BitTorrent Protocol Specification)

| Feature | Status | Issues |
| :--- | :--- | :--- |
| **Handshake** | ⚠️ Partial | Hardcoded `pstrlen` check (19). Correctly parses infoHash/peerId. |
| **Message Parsing** | ⚠️ Partial | Basic messages supported. **Missing Keep-Alive handling**. |
| **BitField** | ✅ Pass | Basic implementation exists. |
| **Piece Picking** | ❌ Fail | Naive "First Available" strategy. No "Rarest First". |
| **Pipelining** | ❌ Fail | No request pipelining. Waits for block N before requesting N+1. Throughput will be abysmal. |
| **Choking** | ❌ Fail | No choking algorithm (Tit-for-Tat). Always unchokes peers. |
| **Endgame Mode** | ❌ Fail | No endgame mode to speed up last pieces. |
| **Block/Piece** | ❌ **CRITICAL** | **Engine assumes Piece Size == Block Size.** Real torrents have pieces >> 16KB. |

### BEP 10 (Extension Protocol)
- **Status**: ⚠️ Partial.
- **Notes**: `PeerWireProtocol` has support for `EXTENDED` message type and handshake bit, but no logic to actually handle the handshake payload (m dictionary).

### BEP 15 (UDP Tracker)
- **Status**: ⚠️ Partial.
- **Notes**: Basic Connect/Announce implemented. **Missing exponential backoff** for retries. Hardcoded timeouts.

## 4. Code Quality & Testing

### Code Quality
- **Happy Path Only**: Error handling is minimal. Network failures, corrupt packets, or disk errors often lead to unhandled promises or console errors.
- **Hardcoded Values**: Magic numbers (e.g., `16384` for block size) are scattered.
- **Type Safety**: Generally good use of TypeScript, but some `any` casts in Tracker code.

### Testing
- **Unit Tests**: Existence of `vitest` setup is good.
- **Integration Tests**: `node-download.spec.ts` tests a single scenario with a mocked peer.
    - **Flaw**: The test hardcodes piece size to 16KB to match the engine's limitation, masking the critical architectural flaw.
    - **Flaw**: Test manually triggers requests, bypassing the `Torrent` class's internal logic, which reduces confidence in the actual engine automation.

## 5. Recommendations (Ranked by Priority)

### Priority 1: Block vs. Piece Abstraction (Critical)
**Refactor `PieceManager` and `Torrent` to handle Pieces composed of multiple Blocks.**
- Introduce `Block` concept (typically 16KB).
- `PieceManager` should track "partial pieces" (blocks received vs. blocks expected).
- `DiskManager` is already capable of writing offsets, so this is mostly a logic change in `Torrent` and `PieceManager`.

### Priority 2: Request Pipelining & Queue
**Implement a `RequestManager` to handle high-throughput downloading.**
- Maintain a queue of outgoing requests per peer.
- Ensure ~5-10 requests are always in flight (pipelining) to saturate bandwidth.
- Handle "cancelled" requests if a peer disconnects.

### Priority 3: Robust Message Handling
**Fix `PeerConnection` buffer and state management.**
- Use a circular buffer or a smarter buffering strategy to avoid `slice()`.
- Implement `KEEP_ALIVE` handling (reset timeout).
- Implement proper timeout logic (disconnect if no data for X seconds).

### Priority 4: Choking Algorithm
**Implement standard Tit-for-Tat.**
- Track download rate from each peer.
- Periodically (10s) recalculate top 4 peers to unchoke.
- Implement "Optimistic Unchoke" (random peer every 30s).

### Priority 5: Tracker Improvements
**Harden Tracker implementations.**
- Add auto-announce loop (setInterval based on `interval` response).
- Add exponential backoff for UDP retries.
- Implement proper Bencode parsing for HTTP tracker (verify `utils/bencode.ts` usage).

## 6. Hardening & Verification Plan

### New Integration Tests
1.  **Multi-Block Piece Test**: Create a test with a piece size of 64KB (4 blocks). Verify engine requests 4 distinct blocks and assembles them.
2.  **Choke/Unchoke Test**: Verify engine respects `CHOKE` messages and stops requesting.
3.  **Real Torrent Test**: Use a small, known .torrent file (e.g., a small Linux distro ISO or a test file) and attempt to download from a controlled seed (e.g., `webtorrent-cli` or `transmission-daemon`).

### Fuzz Testing
- Create a "Chaos Peer" that sends garbage data, partial messages, and invalid protocol headers to ensure `PeerConnection` doesn't crash.
