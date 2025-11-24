# BitTorrent Engine Analysis & Roadmap

## Executive Summary
The TypeScript BitTorrent engine (`packages/engine`) currently exists as a **functional skeleton**. It has the core data structures to represent a torrent, manage pieces, and handle basic peer wire protocol messages. However, it lacks the "nervous system" required to be a fully functional BitTorrent client. Critical components like **Tracker Integration**, **Metadata Discovery (Magnet Links)**, and **Smart Peer Management (Choking/Piece Selection)** are either missing or implemented as placeholders.

## 1. Critical Gaps (Priority 1)

These features are essential for the client to work in a real-world swarm.

### 1.1 Tracker Integration (Major)
*   **Current State**: A `TrackerManager` class exists in `src/tracker/tracker-manager.ts` and seems capable of handling HTTP/UDP announces.
*   **The Gap**: **It is completely disconnected.** Neither `Client.ts` nor `Torrent.ts` instantiates or uses `TrackerManager`. The `Torrent` class holds an `announce` list but does nothing with it.
*   **Recommendation**:
    *   Modify `Torrent` to instantiate `TrackerManager` in its constructor.
    *   Wire up `TrackerManager` 'peer' events to `Torrent.addPeer()`.
    *   Ensure `TrackerManager` is started/stopped when the Torrent is.

### 1.2 Metadata Discovery (Magnet Links) (Major)
*   **Current State**: `Client.ts` can parse magnet links and create a `Torrent` instance with just an `infoHash`.
*   **The Gap**: The `Torrent` instance created from a magnet link has no `PieceManager` and no `ContentStorage` initially. There is **no logic** to fetch the `.torrent` metadata (info dictionary) from peers (BEP 09 - `ut_metadata`). Without this, the client cannot know the file layout or piece hashes, so it cannot download anything.
*   **Recommendation**:
    *   Implement the `ut_metadata` extension in `PeerConnection` (handling `extended` handshake and messages).
    *   Add a "Metadata Phase" to `Torrent`:
        1.  Connect to peers (via DHT/Trackers).
        2.  Identify peers supporting `ut_metadata`.
        3.  Request metadata pieces.
        4.  Verify infohash.
        5.  Initialize `PieceManager` and `ContentStorage` once metadata is complete.
        6.  Transition to "Download Phase".

### 1.3 Choking Algorithm (Tit-for-Tat) (Major)
*   **Current State**: `Torrent.ts` uses a placeholder strategy: "Simple unchoke strategy: always unchoke interested peers" (Line 138).
*   **The Gap**: This will lead to poor performance and potential leeching. It does not reward peers who upload to us.
*   **Recommendation**:
    *   Implement a standard Choking Algorithm:
        *   Track download rates from each peer (rolling average).
        *   Every 10s, unchoke the top N peers (fastest uploaders).
        *   Every 30s, perform an "Optimistic Unchoke" (random peer) to discover better connections.

### 1.4 Piece Selection Strategy (Rarest First) (Major)
*   **Current State**: `Torrent.ts` iterates through missing pieces sequentially and requests them from the first peer that has them.
*   **The Gap**: This leads to "rarest piece" availability issues (everyone downloads the beginning first, leaving the end rare).
*   **Recommendation**:
    *   Maintain a "Piece Availability" map (count of how many connected peers have each piece).
    *   Request pieces with the *lowest* availability count first.
    *   Add "Random First" strategy for the very first pieces to get data quickly for trading.

## 2. Important Gaps (Priority 2)

These features improve performance and reliability.

### 2.1 End Game Mode
*   **Gap**: When a torrent is almost complete, the last few blocks can be slow if the peer holding them is slow.
*   **Recommendation**: When < 1% of pieces remain, request the remaining blocks from *all* peers who have them. Cancel outstanding requests once a block is received.

### 2.2 Resume Data & Recheck
*   **Current State**: `SessionManager` saves/loads basic state, but `Torrent` doesn't seem to fully validate existing data on disk against the bitfield on startup.
*   **Recommendation**: Ensure `Torrent` performs a quick check (or full check if needed) of existing files on startup to populate the `BitField` correctly before connecting to peers.

### 2.3 PEX (Peer Exchange)
*   **Gap**: Not implemented. PEX is crucial for finding peers without hammering the tracker.
*   **Recommendation**: Implement BEP 11 (PEX).

## 3. Code Quality & Architecture

*   **Separation of Concerns**: Generally good. `PeerConnection` handles wire protocol, `PieceManager` handles bitfields, `ContentStorage` handles I/O.
*   **Event Driven**: Heavy use of `EventEmitter`. This is standard for Node.js but can get messy. Consider using a more structured state machine for the `Torrent` lifecycle (e.g., `MetadataFetching` -> `Checking` -> `Downloading` -> `Seeding`).
*   **Error Handling**: `console.error` is used liberally. Should be replaced with a proper logging interface or event emission for UI consumption.

## 4. Test Improvements

### 4.1 Unit Tests
*   **Current**: `torrent.spec.ts` uses a `MockSocket`.
*   **Improvement**:
    *   Expand `PieceManager` tests to cover edge cases (last piece length, boundary conditions).
    *   Test `PeerConnection` buffer handling with fragmented TCP packets (simulating network splitting messages).

### 4.2 Integration Tests
*   **Current**: Lacking full integration.
*   **Recommendation**:
    *   **In-Memory Swarm**: Create a test that instantiates **two** `Client` instances in the same process, connected via `MemorySocket` (a mock socket pair).
    *   **Scenario**:
        1.  Client A adds a torrent (Seeder).
        2.  Client B adds the same torrent (Leecher) via magnet.
        3.  Verify Client B fetches metadata from A.
        4.  Verify Client B downloads all pieces from A.
        5.  Verify Client B becomes a seeder.
    *   This "Loopback Swarm" test is the gold standard for verifying the engine logic without network flakes.

## 5. Proposed Roadmap

1.  **Phase 1: The Nervous System (Glue)**
    *   Integrate `TrackerManager` into `Torrent`.
    *   Implement `ut_metadata` (Magnet link support).
2.  **Phase 2: Intelligence**
    *   Implement Rarest First piece selection.
    *   Implement Tit-for-Tat choking.
3.  **Phase 3: Reliability & Performance**
    *   Implement End Game mode.
    *   Add PEX support.
    *   Optimize disk I/O (caching).
