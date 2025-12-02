# JSTorrent Test Reorganization Guide

## Overview

Consolidate and reorganize the test structure in `packages/engine/`. Currently tests are scattered across `test/` and `tests/` folders with inconsistent naming (`.spec.ts` vs `.test.ts`).

**Current structure:**
```
packages/engine/
├── test/                          # vitest tests (24 files)
│   ├── adapters/
│   ├── core/
│   ├── extensions/
│   ├── helpers/
│   ├── integration/               # mixed: self-contained + daemon-dependent
│   ├── logging/
│   ├── protocol/
│   ├── tracker/
│   └── utils/
└── tests/
    ├── unit/                      # 7 more vitest tests
    │   ├── core/
    │   └── utils/
    └── python/                    # python interop tests
```

**Target structure:**
```
packages/engine/
├── test/                          # all vitest tests (no external deps)
│   ├── adapters/
│   │   ├── browser/
│   │   ├── daemon/
│   │   ├── memory/               # NEW: memory-session-store.test.ts
│   │   └── node/                 # NEW: json-file-session-store.test.ts
│   ├── core/                     # MERGED: +3 files from tests/unit/core, +memory-swarm
│   ├── extensions/
│   ├── helpers/
│   ├── logging/
│   ├── protocol/
│   ├── storage/                  # NEW: storage-root-manager.test.ts
│   ├── tracker/                  # +tracker-announce.test.ts
│   └── utils/                    # +speed-calculator.test.ts
└── integration/                  # needs external processes
    ├── daemon/                   # needs io-daemon binary
    │   ├── helpers/
    │   └── *.test.ts
    └── python/                   # needs python + libtorrent
```

---

## Phase 1: Create New Directories

```bash
cd packages/engine

# Create new directories
mkdir -p test/adapters/memory
mkdir -p test/adapters/node
mkdir -p test/storage
mkdir -p integration/daemon
```

---

## Phase 2: Move tests/unit Files

### 2.1 Move tests/unit/core/*.spec.ts → test/core/

**File: connection-manager.spec.ts → connection-manager.test.ts**

Move file:
```bash
mv tests/unit/core/connection-manager.spec.ts test/core/connection-manager.test.ts
```

Update imports in `test/core/connection-manager.test.ts`:
```ts
// OLD:
import { ConnectionManager, DEFAULT_CONNECTION_CONFIG } from '../../../src/core/connection-manager'
import { Swarm, addressKey } from '../../../src/core/swarm'
import { PeerConnection } from '../../../src/core/peer-connection'
import { ISocketFactory, ITcpSocket } from '../../../src/interfaces/socket'
import { MockEngine } from '../../../test/utils/mock-engine'
import type { Logger } from '../../../src/logging/logger'
import type { SwarmPeer } from '../../../src/core/swarm'

// NEW:
import { ConnectionManager, DEFAULT_CONNECTION_CONFIG } from '../../src/core/connection-manager'
import { Swarm, addressKey } from '../../src/core/swarm'
import { PeerConnection } from '../../src/core/peer-connection'
import { ISocketFactory, ITcpSocket } from '../../src/interfaces/socket'
import { MockEngine } from '../utils/mock-engine'
import type { Logger } from '../../src/logging/logger'
import type { SwarmPeer } from '../../src/core/swarm'
```

---

**File: peer-connection-stats.spec.ts → peer-connection-stats.test.ts**

Move file:
```bash
mv tests/unit/core/peer-connection-stats.spec.ts test/core/peer-connection-stats.test.ts
```

Update imports in `test/core/peer-connection-stats.test.ts`:
```ts
// OLD:
import { PeerConnection } from '../../../src/core/peer-connection'
import { ILoggingEngine } from '../../../src/logging/logger'
import { ITcpSocket } from '../../../src/interfaces/socket'

// NEW:
import { PeerConnection } from '../../src/core/peer-connection'
import { ILoggingEngine } from '../../src/logging/logger'
import { ITcpSocket } from '../../src/interfaces/socket'
```

---

**File: torrent-stats.spec.ts → torrent-stats.test.ts**

Move file:
```bash
mv tests/unit/core/torrent-stats.spec.ts test/core/torrent-stats.test.ts
```

Update imports in `test/core/torrent-stats.test.ts`:
```ts
// OLD:
import { Torrent } from '../../../src/core/torrent'
import { PeerConnection } from '../../../src/core/peer-connection'
import { ISocketFactory, ITcpSocket } from '../../../src/interfaces/socket'
import { MockEngine } from '../../../test/utils/mock-engine'
import type { BtEngine } from '../../../src/core/bt-engine'

// NEW:
import { Torrent } from '../../src/core/torrent'
import { PeerConnection } from '../../src/core/peer-connection'
import { ISocketFactory, ITcpSocket } from '../../src/interfaces/socket'
import { MockEngine } from '../utils/mock-engine'
import type { BtEngine } from '../../src/core/bt-engine'
```

---

### 2.2 Move tests/unit/utils/*.spec.ts → test/utils/

**File: speed-calculator.spec.ts → speed-calculator.test.ts**

Move file:
```bash
mv tests/unit/utils/speed-calculator.spec.ts test/utils/speed-calculator.test.ts
```

Update imports in `test/utils/speed-calculator.test.ts`:
```ts
// OLD:
import { SpeedCalculator } from '../../../src/utils/speed-calculator'

// NEW:
import { SpeedCalculator } from '../../src/utils/speed-calculator'
```

---

### 2.3 Move tests/unit/*.spec.ts → test/adapters/ and test/storage/

**File: json-file-session-store.spec.ts → test/adapters/node/**

Move file:
```bash
mv tests/unit/json-file-session-store.spec.ts test/adapters/node/json-file-session-store.test.ts
```

Update imports in `test/adapters/node/json-file-session-store.test.ts`:
```ts
// OLD:
import { JsonFileSessionStore } from '../../src/adapters/node/json-file-session-store'

// NEW:
import { JsonFileSessionStore } from '../../../src/adapters/node/json-file-session-store'
```

---

**File: memory-session-store.spec.ts → test/adapters/memory/**

Move file:
```bash
mv tests/unit/memory-session-store.spec.ts test/adapters/memory/memory-session-store.test.ts
```

Update imports in `test/adapters/memory/memory-session-store.test.ts`:
```ts
// OLD:
import { MemorySessionStore } from '../../src/adapters/memory/memory-session-store'

// NEW:
import { MemorySessionStore } from '../../../src/adapters/memory/memory-session-store'
```

---

**File: storage-root-manager.spec.ts → test/storage/**

Move file:
```bash
mv tests/unit/storage-root-manager.spec.ts test/storage/storage-root-manager.test.ts
```

Update imports in `test/storage/storage-root-manager.test.ts`:
```ts
// OLD:
import { StorageRootManager } from '../../src/storage/storage-root-manager'
import { InMemoryFileSystem } from '../../src/adapters/memory/memory-filesystem'

// NEW:
import { StorageRootManager } from '../../src/storage/storage-root-manager'
import { InMemoryFileSystem } from '../../src/adapters/memory/memory-filesystem'
```
(No change needed - same depth)

---

## Phase 3: Move Self-Contained Integration Tests

### 3.1 Move memory-swarm.spec.ts → test/core/

Move file:
```bash
mv test/integration/memory-swarm.spec.ts test/core/memory-swarm.test.ts
```

Update imports in `test/core/memory-swarm.test.ts`:
```ts
// OLD:
import { BtEngine } from '../../src/core/bt-engine'
import { MemorySocketFactory } from '../../src/adapters/memory'
import { InMemoryFileSystem } from '../../src/adapters/memory'
import { TorrentCreator } from '../../src/core/torrent-creator'
import { PeerConnection } from '../../src/core/peer-connection'
import { FileSystemStorageHandle } from '../../src/io/filesystem-storage-handle'
import { createMemoryEngine } from '../../src/presets/memory'

// NEW (same - already at correct depth):
import { BtEngine } from '../../src/core/bt-engine'
import { MemorySocketFactory } from '../../src/adapters/memory'
import { InMemoryFileSystem } from '../../src/adapters/memory'
import { TorrentCreator } from '../../src/core/torrent-creator'
import { PeerConnection } from '../../src/core/peer-connection'
import { FileSystemStorageHandle } from '../../src/io/filesystem-storage-handle'
import { createMemoryEngine } from '../../src/presets/memory'
```
(No change needed - same depth)

---

### 3.2 Move tracker-announce.spec.ts → test/tracker/

Move file:
```bash
mv test/integration/tracker-announce.spec.ts test/tracker/tracker-announce.test.ts
```

Update imports in `test/tracker/tracker-announce.test.ts`:
```ts
// OLD:
import { BtEngine } from '../../src/core/bt-engine'
import { ScopedNodeFileSystem } from '../../src/adapters/node'
import { SimpleTracker } from '../helpers/simple-tracker'
// ... etc

// NEW (same - already at correct depth):
import { BtEngine } from '../../src/core/bt-engine'
import { ScopedNodeFileSystem } from '../../src/adapters/node'
import { SimpleTracker } from '../helpers/simple-tracker'
// ... etc
```
(No change needed - same depth)

---

## Phase 4: Move Daemon Tests to integration/

### 4.1 Move daemon test files

```bash
mv test/integration/daemon-filesystem.spec.ts integration/daemon/daemon-filesystem.test.ts
mv test/integration/daemon-tcp-socket.spec.ts integration/daemon/daemon-tcp-socket.test.ts
mv test/integration/daemon-udp-socket.spec.ts integration/daemon/daemon-udp-socket.test.ts
mv test/integration/daemon-websocket.spec.ts integration/daemon/daemon-websocket.test.ts
mv test/integration/helpers integration/daemon/
```

### 4.2 Update imports in all daemon test files

Each daemon test file needs import paths updated. The pattern is:

```ts
// OLD (from test/integration/):
import { DaemonConnection } from '../../src/adapters/daemon/daemon-connection'
import { startDaemon, DaemonHarness } from './helpers/daemon-harness'

// NEW (from integration/daemon/):
import { DaemonConnection } from '../../src/adapters/daemon/daemon-connection'
import { startDaemon, DaemonHarness } from './helpers/daemon-harness'
```
(Source imports stay same depth, helper import stays same)

**Update integration/daemon/daemon-filesystem.test.ts:**
```ts
// OLD:
import { startDaemon, DaemonHarness } from './helpers/daemon-harness'
import { DaemonConnection } from '../../src/adapters/daemon/daemon-connection'
import { DaemonFileHandle } from '../../src/adapters/daemon/daemon-file-handle'
import { DaemonFileSystem } from '../../src/adapters/daemon/daemon-filesystem'

// NEW:
import { startDaemon, DaemonHarness } from './helpers/daemon-harness'
import { DaemonConnection } from '../../src/adapters/daemon/daemon-connection'
import { DaemonFileHandle } from '../../src/adapters/daemon/daemon-file-handle'
import { DaemonFileSystem } from '../../src/adapters/daemon/daemon-filesystem'
```
(No change - paths work from new location)

**Update integration/daemon/daemon-tcp-socket.test.ts:**
```ts
// OLD:
import { startDaemon, DaemonHarness } from './helpers/daemon-harness'
import { DaemonConnection } from '../../src/adapters/daemon/daemon-connection'
import { DaemonSocketFactory } from '../../src/adapters/daemon/daemon-socket-factory'

// NEW:
import { startDaemon, DaemonHarness } from './helpers/daemon-harness'
import { DaemonConnection } from '../../src/adapters/daemon/daemon-connection'
import { DaemonSocketFactory } from '../../src/adapters/daemon/daemon-socket-factory'
```
(No change - paths work from new location)

Same pattern for `daemon-udp-socket.test.ts` and `daemon-websocket.test.ts`.

### 4.3 Update helpers/daemon-harness.ts imports

Check and update `integration/daemon/helpers/daemon-harness.ts` if it imports from src/:
```ts
// If it has imports like:
import { something } from '../../../src/...'

// Change to:
import { something } from '../../../src/...'
```
(Should be same depth, verify)

---

## Phase 5: Move Python Tests

```bash
mv tests/python integration/
```

No import changes needed - Python files don't import from the TypeScript source.

---

## Phase 6: Clean Up Empty Directories

```bash
rmdir tests/unit/core
rmdir tests/unit/utils  
rmdir tests/unit
rmdir tests
rmdir test/integration
```

---

## Phase 7: Rename All .spec.ts to .test.ts

```bash
cd packages/engine

# Rename in test/
find test -name "*.spec.ts" -exec bash -c 'mv "$0" "${0%.spec.ts}.test.ts"' {} \;

# Verify no .spec.ts remain
find test -name "*.spec.ts"
```

---

## Phase 8: Update vitest.config.ts

Update `packages/engine/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'integration/**',  // Exclude all integration tests by default
    ],
  },
})
```

---

## Phase 9: Add Integration Test Script

Add to `packages/engine/package.json` scripts:

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:daemon": "vitest run --config vitest.daemon.config.ts",
    "test:python": "cd integration/python && python run_tests.py"
  }
}
```

Create `packages/engine/vitest.daemon.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['integration/daemon/**/*.test.ts'],
  },
})
```

---

## Phase 10: Verification

```bash
cd packages/engine

# 1. Run unit tests (should work without external deps)
pnpm test

# 2. Verify no broken imports
pnpm typecheck

# 3. List final structure
find test integration -name "*.ts" | head -50
```

---

## Summary of File Moves

| Old Path | New Path |
|----------|----------|
| `tests/unit/core/connection-manager.spec.ts` | `test/core/connection-manager.test.ts` |
| `tests/unit/core/peer-connection-stats.spec.ts` | `test/core/peer-connection-stats.test.ts` |
| `tests/unit/core/torrent-stats.spec.ts` | `test/core/torrent-stats.test.ts` |
| `tests/unit/utils/speed-calculator.spec.ts` | `test/utils/speed-calculator.test.ts` |
| `tests/unit/json-file-session-store.spec.ts` | `test/adapters/node/json-file-session-store.test.ts` |
| `tests/unit/memory-session-store.spec.ts` | `test/adapters/memory/memory-session-store.test.ts` |
| `tests/unit/storage-root-manager.spec.ts` | `test/storage/storage-root-manager.test.ts` |
| `test/integration/memory-swarm.spec.ts` | `test/core/memory-swarm.test.ts` |
| `test/integration/tracker-announce.spec.ts` | `test/tracker/tracker-announce.test.ts` |
| `test/integration/daemon-*.spec.ts` | `integration/daemon/daemon-*.test.ts` |
| `test/integration/helpers/` | `integration/daemon/helpers/` |
| `tests/python/` | `integration/python/` |

---

## Checklist

### Phase 1: Create Directories
- [ ] Create `test/adapters/memory/`
- [ ] Create `test/adapters/node/`
- [ ] Create `test/storage/`
- [ ] Create `integration/daemon/`

### Phase 2: Move tests/unit Files
- [ ] Move and update `connection-manager.spec.ts`
- [ ] Move and update `peer-connection-stats.spec.ts`
- [ ] Move and update `torrent-stats.spec.ts`
- [ ] Move and update `speed-calculator.spec.ts`
- [ ] Move and update `json-file-session-store.spec.ts`
- [ ] Move and update `memory-session-store.spec.ts`
- [ ] Move and update `storage-root-manager.spec.ts`

### Phase 3: Move Self-Contained Integration Tests
- [ ] Move `memory-swarm.spec.ts` to `test/core/`
- [ ] Move `tracker-announce.spec.ts` to `test/tracker/`

### Phase 4: Move Daemon Tests
- [ ] Move daemon test files to `integration/daemon/`
- [ ] Move helpers to `integration/daemon/helpers/`
- [ ] Update imports if needed

### Phase 5: Move Python Tests
- [ ] Move `tests/python/` to `integration/python/`

### Phase 6: Clean Up
- [ ] Remove empty directories

### Phase 7: Rename Files
- [ ] Rename all `.spec.ts` to `.test.ts`

### Phase 8: Update Config
- [ ] Update `vitest.config.ts`

### Phase 9: Add Scripts
- [ ] Add `test:daemon` script
- [ ] Add `test:python` script
- [ ] Create `vitest.daemon.config.ts`

### Phase 10: Verify
- [ ] `pnpm test` passes
- [ ] `pnpm typecheck` passes
- [ ] Final structure matches target
