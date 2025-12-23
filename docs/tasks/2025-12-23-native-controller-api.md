# Native Controller API Design

**Purpose:** Define the communication layer between Kotlin (native UI) and QuickJS (engine).

**Principle:** Don't expose BtEngine directly. Expose a thin JSON-based RPC layer with explicit functions.

---

## Architecture

```
┌─────────────────┐                      ┌─────────────────┐
│     Kotlin      │                      │    QuickJS      │
│   (Native UI)   │                      │    (Engine)     │
├─────────────────┤                      ├─────────────────┤
│                 │  ── Commands ──────► │                 │
│                 │  __jstorrent_cmd_*   │                 │
│                 │                      │                 │
│                 │  ── Queries ───────► │                 │
│                 │  __jstorrent_query_* │                 │
│                 │  (returns JSON)      │                 │
│                 │                      │                 │
│                 │  ◄── State Push ───  │                 │
│                 │  __jstorrent_on_*    │                 │
│                 │  (callbacks)         │                 │
└─────────────────┘                      └─────────────────┘
```

**Three types of functions:**

| Type | Direction | Pattern | Returns |
|------|-----------|---------|---------|
| Commands | Kotlin → JS | `__jstorrent_cmd_*` | void or JSON result |
| Queries | Kotlin → JS | `__jstorrent_query_*` | JSON string |
| Callbacks | JS → Kotlin | `__jstorrent_on_*` | void (native binding) |

---

## TypeScript Implementation

### File: `packages/engine/src/adapters/native/controller.ts`

```typescript
import type { BtEngine } from '../../core/bt-engine'

// Callbacks provided by native layer (declared in bindings.d.ts)
declare function __jstorrent_on_state_update(json: string): void
declare function __jstorrent_on_error(json: string): void

export function setupController(engine: BtEngine): void {
  // ============================================================
  // COMMANDS (Native → JS)
  // ============================================================

  ;(globalThis as any).__jstorrent_cmd_add_torrent = (magnetOrBase64: string): string => {
    try {
      const torrent = engine.addTorrent(magnetOrBase64)
      return JSON.stringify({ ok: true, infoHash: torrent.infoHash })
    } catch (e) {
      return JSON.stringify({ ok: false, error: String(e) })
    }
  }

  ;(globalThis as any).__jstorrent_cmd_pause = (infoHash: string): void => {
    engine.getTorrent(infoHash)?.pause()
  }

  ;(globalThis as any).__jstorrent_cmd_resume = (infoHash: string): void => {
    engine.getTorrent(infoHash)?.resume()
  }

  ;(globalThis as any).__jstorrent_cmd_remove = (infoHash: string, deleteFiles: boolean): void => {
    engine.removeTorrent(infoHash, deleteFiles)
  }

  // ============================================================
  // QUERIES (Native → JS) - Returns JSON
  // ============================================================

  ;(globalThis as any).__jstorrent_query_torrent_list = (): string => {
    return JSON.stringify({
      torrents: engine.torrents.map(t => ({
        infoHash: t.infoHash,
        name: t.name,
        progress: t.progress,
        downloadSpeed: t.downloadSpeed,
        uploadSpeed: t.uploadSpeed,
        status: t.status,
        size: t.size,
        downloaded: t.downloaded,
        uploaded: t.uploaded,
        peersConnected: t.peersConnected,
        peersTotal: t.peersTotal,
      }))
    })
  }

  ;(globalThis as any).__jstorrent_query_files = (infoHash: string): string => {
    const torrent = engine.getTorrent(infoHash)
    if (!torrent) return JSON.stringify({ files: [] })
    return JSON.stringify({
      files: torrent.files.map(f => ({
        index: f.index,
        path: f.path,
        size: f.size,
        downloaded: f.downloaded,
        progress: f.progress,
      }))
    })
  }
}

// ============================================================
// STATE PUSH LOOP (JS → Native)
// ============================================================

export function startStatePushLoop(engine: BtEngine): void {
  let lastPushedState = ''

  const pushState = () => {
    const state = JSON.stringify({
      torrents: engine.torrents.map(t => ({
        infoHash: t.infoHash,
        name: t.name,
        progress: t.progress,
        downloadSpeed: t.downloadSpeed,
        uploadSpeed: t.uploadSpeed,
        status: t.status,
      }))
    })

    // Only push if changed
    if (state !== lastPushedState) {
      __jstorrent_on_state_update(state)
      lastPushedState = state
    }
  }

  // Push every 500ms
  setInterval(pushState, 500)

  // Also push immediately on torrent added/removed
  engine.on('torrentAdded', pushState)
  engine.on('torrentRemoved', pushState)
}
```

### File: `packages/engine/src/adapters/native/bindings.d.ts`

Add these callback declarations:

```typescript
// Callbacks (JS → Native)
declare function __jstorrent_on_state_update(json: string): void
declare function __jstorrent_on_error(json: string): void
```

---

## Kotlin Implementation

### File: `android/quickjs-engine/src/main/kotlin/com/jstorrent/quickjs/EngineController.kt`

```kotlin
package com.jstorrent.quickjs

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

class EngineController(private val runtime: QuickJSRuntime) {

    private val json = Json { ignoreUnknownKeys = true }

    // State flow for Compose UI to observe
    private val _state = MutableStateFlow(EngineState())
    val state: StateFlow<EngineState> = _state.asStateFlow()

    init {
        // Register callback for state updates from JS
        runtime.registerCallback("__jstorrent_on_state_update") { args ->
            val jsonStr = args[0] as String
            val newState = json.decodeFromString<EngineState>(jsonStr)
            _state.value = newState
        }
    }

    // ============================================================
    // COMMANDS
    // ============================================================

    fun addTorrent(magnetOrBase64: String): AddTorrentResult {
        val resultJson = runtime.callGlobal("__jstorrent_cmd_add_torrent", magnetOrBase64)
        return json.decodeFromString(resultJson)
    }

    fun pause(infoHash: String) {
        runtime.callGlobal("__jstorrent_cmd_pause", infoHash)
    }

    fun resume(infoHash: String) {
        runtime.callGlobal("__jstorrent_cmd_resume", infoHash)
    }

    fun remove(infoHash: String, deleteFiles: Boolean = false) {
        runtime.callGlobal("__jstorrent_cmd_remove", infoHash, deleteFiles)
    }

    // ============================================================
    // QUERIES
    // ============================================================

    fun getFiles(infoHash: String): FileList {
        val resultJson = runtime.callGlobal("__jstorrent_query_files", infoHash)
        return json.decodeFromString(resultJson)
    }
}

// ============================================================
// DATA CLASSES
// ============================================================

@Serializable
data class EngineState(
    val torrents: List<TorrentSummary> = emptyList()
)

@Serializable
data class TorrentSummary(
    val infoHash: String,
    val name: String,
    val progress: Float,
    val downloadSpeed: Long,
    val uploadSpeed: Long,
    val status: String,
    val size: Long? = null,
    val downloaded: Long? = null,
    val uploaded: Long? = null,
    val peersConnected: Int? = null,
    val peersTotal: Int? = null,
)

@Serializable
data class AddTorrentResult(
    val ok: Boolean,
    val infoHash: String? = null,
    val error: String? = null,
)

@Serializable
data class FileList(
    val files: List<FileSummary>
)

@Serializable
data class FileSummary(
    val index: Int,
    val path: String,
    val size: Long,
    val downloaded: Long,
    val progress: Float,
)
```

---

## API Summary

### Commands (MVP)

| Function | Args | Returns | Description |
|----------|------|---------|-------------|
| `__jstorrent_cmd_add_torrent` | `magnetOrBase64: string` | `{ok, infoHash?, error?}` | Add torrent |
| `__jstorrent_cmd_pause` | `infoHash: string` | void | Pause torrent |
| `__jstorrent_cmd_resume` | `infoHash: string` | void | Resume torrent |
| `__jstorrent_cmd_remove` | `infoHash: string, deleteFiles: boolean` | void | Remove torrent |

### Queries (MVP)

| Function | Args | Returns | Description |
|----------|------|---------|-------------|
| `__jstorrent_query_torrent_list` | none | `{torrents: [...]}` | Full torrent list |
| `__jstorrent_query_files` | `infoHash: string` | `{files: [...]}` | File list for torrent |

### Callbacks (MVP)

| Function | Args | Description |
|----------|------|-------------|
| `__jstorrent_on_state_update` | `json: string` | Pushed every 500ms when state changes |

---

## State Push Strategy

The JS engine pushes compact state every 500ms (only if changed):

```json
{
  "torrents": [
    {
      "infoHash": "abc123...",
      "name": "Ubuntu 24.04",
      "progress": 0.45,
      "downloadSpeed": 1234567,
      "uploadSpeed": 54321,
      "status": "downloading"
    }
  ]
}
```

This is intentionally minimal - just what the list UI needs. Details (files, peers) are queried on-demand.

---

## Future Additions (Not MVP)

When adding features later, follow the same pattern:

```typescript
// Peer list query
;(globalThis as any).__jstorrent_query_peers = (infoHash: string): string => {
  const torrent = engine.getTorrent(infoHash)
  if (!torrent) return JSON.stringify({ peers: [] })
  return JSON.stringify({
    peers: torrent.peers.map(p => ({
      ip: p.ip,
      port: p.port,
      client: p.client,
      downloadSpeed: p.downloadSpeed,
      uploadSpeed: p.uploadSpeed,
      progress: p.progress,
    }))
  })
}
```

For high-frequency updates (like live peer stats), consider:
1. **Polling** - Native queries every 1-2 seconds when tab is visible
2. **Diffing** - JS sends only changed entries (more complex, optimize later if needed)

Start with polling. Optimize only if it's actually a problem.

---

## Testing

1. **Unit test controller.ts** - Mock BtEngine, verify JSON output
2. **Unit test EngineController.kt** - Mock QuickJSRuntime, verify parsing
3. **Integration test** - Full round-trip: Kotlin → QuickJS → controller → engine → state push → Kotlin
