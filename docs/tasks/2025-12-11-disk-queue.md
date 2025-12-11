# Disk Queue Implementation

## Overview

Add a per-torrent disk I/O queue with UI visualization. The queue manages concurrent disk operations and exposes state for debugging.

**Scope:** This task covers only the queue infrastructure and UI. File priority changes and .parts file handling are separate future work.

## File Locations

```
packages/engine/src/core/disk-queue.ts       ← NEW: Queue implementation
packages/engine/test/core/disk-queue.test.ts ← NEW: Unit tests
packages/ui/src/tables/DiskTable.tsx         ← NEW: UI table
packages/ui/src/components/DetailPane.tsx    ← MODIFY: Add Disk tab
packages/client/src/adapters/types.ts        ← MODIFY: Add getDiskQueueSnapshot
```

## Phase 1: Queue Implementation

### 1.1 Create `packages/engine/src/core/disk-queue.ts`

```typescript
export type DiskJobType = 'write' | 'read'
export type DiskJobStatus = 'pending' | 'running'

export interface DiskJob {
  id: number
  type: DiskJobType
  pieceIndex: number
  fileCount: number        // How many files this job touches
  size: number             // Bytes
  status: DiskJobStatus
  startedAt?: number       // Timestamp when started
}

export interface DiskQueueSnapshot {
  pending: DiskJob[]
  running: DiskJob[]
  draining: boolean
}

export interface IDiskQueue {
  enqueue(job: Omit<DiskJob, 'id' | 'status'>, execute: () => Promise<void>): Promise<void>
  drain(): Promise<void>
  resume(): void
  getSnapshot(): DiskQueueSnapshot
}

export interface DiskQueueConfig {
  maxWorkers: number  // Default 4
}

export class TorrentDiskQueue implements IDiskQueue {
  private nextId = 1
  private pending: Array<{ job: DiskJob; execute: () => Promise<void> }> = []
  private running: Map<number, DiskJob> = new Map()
  private draining = false
  private drainResolve: (() => void) | null = null
  private config: DiskQueueConfig

  constructor(config: Partial<DiskQueueConfig> = {}) {
    this.config = {
      maxWorkers: config.maxWorkers ?? 4,
    }
  }

  async enqueue(
    jobData: Omit<DiskJob, 'id' | 'status'>,
    execute: () => Promise<void>,
  ): Promise<void> {
    const job: DiskJob = {
      ...jobData,
      id: this.nextId++,
      status: 'pending',
    }

    return new Promise((resolve, reject) => {
      this.pending.push({
        job,
        execute: async () => {
          try {
            await execute()
            resolve()
          } catch (e) {
            reject(e)
          }
        },
      })
      this.schedule()
    })
  }

  private schedule(): void {
    if (this.draining) return

    while (this.running.size < this.config.maxWorkers && this.pending.length > 0) {
      const item = this.pending.shift()!
      this.startJob(item.job, item.execute)
    }
  }

  private async startJob(job: DiskJob, execute: () => Promise<void>): Promise<void> {
    job.status = 'running'
    job.startedAt = Date.now()
    this.running.set(job.id, job)

    try {
      await execute()
    } finally {
      this.running.delete(job.id)

      // Check if drain is waiting
      if (this.draining && this.running.size === 0) {
        this.drainResolve?.()
      }

      this.schedule()
    }
  }

  async drain(): Promise<void> {
    this.draining = true

    if (this.running.size === 0) {
      return
    }

    return new Promise((resolve) => {
      this.drainResolve = resolve
    })
  }

  resume(): void {
    this.draining = false
    this.drainResolve = null
    this.schedule()
  }

  getSnapshot(): DiskQueueSnapshot {
    return {
      pending: this.pending.map((p) => ({ ...p.job })),
      running: [...this.running.values()].map((j) => ({ ...j })),
      draining: this.draining,
    }
  }
}
```

### 1.2 Export from engine index

In `packages/engine/src/index.ts`, add:

```typescript
export {
  TorrentDiskQueue,
  type IDiskQueue,
  type DiskJob,
  type DiskJobType,
  type DiskJobStatus,
  type DiskQueueSnapshot,
  type DiskQueueConfig,
} from './core/disk-queue'
```

## Phase 2: Unit Tests

### 2.1 Create `packages/engine/test/core/disk-queue.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TorrentDiskQueue, DiskJob } from '../../src/core/disk-queue'

describe('TorrentDiskQueue', () => {
  let queue: TorrentDiskQueue

  beforeEach(() => {
    queue = new TorrentDiskQueue({ maxWorkers: 2 })
  })

  describe('enqueue', () => {
    it('should execute jobs immediately when under capacity', async () => {
      const executed: number[] = []

      await queue.enqueue(
        { type: 'write', pieceIndex: 1, fileCount: 1, size: 1000 },
        async () => { executed.push(1) },
      )

      expect(executed).toEqual([1])
    })

    it('should queue jobs when at capacity', async () => {
      const order: number[] = []
      const resolvers: Array<() => void> = []

      // Create 3 jobs, queue has capacity 2
      const job1 = queue.enqueue(
        { type: 'write', pieceIndex: 1, fileCount: 1, size: 1000 },
        () => new Promise((r) => { resolvers[0] = () => { order.push(1); r() } }),
      )
      const job2 = queue.enqueue(
        { type: 'write', pieceIndex: 2, fileCount: 1, size: 1000 },
        () => new Promise((r) => { resolvers[1] = () => { order.push(2); r() } }),
      )
      const job3 = queue.enqueue(
        { type: 'write', pieceIndex: 3, fileCount: 1, size: 1000 },
        () => new Promise((r) => { resolvers[2] = () => { order.push(3); r() } }),
      )

      // Check snapshot - should have 2 running, 1 pending
      const snapshot1 = queue.getSnapshot()
      expect(snapshot1.running.length).toBe(2)
      expect(snapshot1.pending.length).toBe(1)

      // Complete first job
      resolvers[0]()
      await job1

      // Job 3 should now be running
      const snapshot2 = queue.getSnapshot()
      expect(snapshot2.running.length).toBe(2)
      expect(snapshot2.pending.length).toBe(0)

      // Complete remaining
      resolvers[1]()
      resolvers[2]()
      await Promise.all([job2, job3])

      expect(order).toEqual([1, 2, 3])
    })
  })

  describe('getSnapshot', () => {
    it('should return empty snapshot initially', () => {
      const snapshot = queue.getSnapshot()
      expect(snapshot.pending).toEqual([])
      expect(snapshot.running).toEqual([])
      expect(snapshot.draining).toBe(false)
    })

    it('should include job details in snapshot', async () => {
      let resolver: () => void

      queue.enqueue(
        { type: 'write', pieceIndex: 42, fileCount: 2, size: 16384 },
        () => new Promise((r) => { resolver = r }),
      )

      const snapshot = queue.getSnapshot()
      expect(snapshot.running.length).toBe(1)
      expect(snapshot.running[0].pieceIndex).toBe(42)
      expect(snapshot.running[0].fileCount).toBe(2)
      expect(snapshot.running[0].size).toBe(16384)
      expect(snapshot.running[0].type).toBe('write')
      expect(snapshot.running[0].status).toBe('running')
      expect(snapshot.running[0].startedAt).toBeDefined()

      resolver!()
    })

    it('should return copies, not references', async () => {
      let resolver: () => void

      queue.enqueue(
        { type: 'write', pieceIndex: 1, fileCount: 1, size: 1000 },
        () => new Promise((r) => { resolver = r }),
      )

      const snapshot1 = queue.getSnapshot()
      const snapshot2 = queue.getSnapshot()

      expect(snapshot1.running).not.toBe(snapshot2.running)
      expect(snapshot1.running[0]).not.toBe(snapshot2.running[0])

      resolver!()
    })
  })

  describe('drain', () => {
    it('should resolve immediately if no jobs running', async () => {
      await queue.drain()
      expect(queue.getSnapshot().draining).toBe(true)
    })

    it('should wait for running jobs to complete', async () => {
      let resolver: () => void
      let drained = false

      queue.enqueue(
        { type: 'write', pieceIndex: 1, fileCount: 1, size: 1000 },
        () => new Promise((r) => { resolver = r }),
      )

      const drainPromise = queue.drain().then(() => { drained = true })

      // Should not be drained yet
      expect(drained).toBe(false)
      expect(queue.getSnapshot().draining).toBe(true)

      // Complete the job
      resolver!()
      await drainPromise

      expect(drained).toBe(true)
    })

    it('should not start new jobs while draining', async () => {
      let resolver1: () => void
      let resolver2: () => void
      const started: number[] = []

      queue.enqueue(
        { type: 'write', pieceIndex: 1, fileCount: 1, size: 1000 },
        () => new Promise((r) => { started.push(1); resolver1 = r }),
      )

      // Start draining
      const drainPromise = queue.drain()

      // Try to enqueue another job
      queue.enqueue(
        { type: 'write', pieceIndex: 2, fileCount: 1, size: 1000 },
        () => new Promise((r) => { started.push(2); resolver2 = r }),
      )

      // Job 2 should be pending, not started
      expect(started).toEqual([1])
      expect(queue.getSnapshot().pending.length).toBe(1)

      resolver1!()
      await drainPromise

      // Still pending after drain
      expect(started).toEqual([1])
    })
  })

  describe('resume', () => {
    it('should start pending jobs after resume', async () => {
      let resolver1: () => void
      let resolver2: () => void
      const started: number[] = []

      queue.enqueue(
        { type: 'write', pieceIndex: 1, fileCount: 1, size: 1000 },
        () => new Promise((r) => { started.push(1); resolver1 = r }),
      )

      await queue.drain().then(() => resolver1!())

      queue.enqueue(
        { type: 'write', pieceIndex: 2, fileCount: 1, size: 1000 },
        () => new Promise((r) => { started.push(2); resolver2 = r }),
      )

      // Still draining, job 2 not started
      expect(started).toEqual([1])

      // Resume
      queue.resume()

      // Now job 2 should start
      expect(started).toEqual([1, 2])

      resolver2!()
    })
  })

  describe('maxWorkers config', () => {
    it('should respect custom maxWorkers', async () => {
      const queue4 = new TorrentDiskQueue({ maxWorkers: 4 })
      const resolvers: Array<() => void> = []

      for (let i = 0; i < 6; i++) {
        queue4.enqueue(
          { type: 'write', pieceIndex: i, fileCount: 1, size: 1000 },
          () => new Promise((r) => { resolvers.push(r) }),
        )
      }

      const snapshot = queue4.getSnapshot()
      expect(snapshot.running.length).toBe(4)
      expect(snapshot.pending.length).toBe(2)

      resolvers.forEach((r) => r())
    })
  })
})
```

## Phase 3: UI Table

### 3.1 Create `packages/ui/src/tables/DiskTable.tsx`

```typescript
import { TableMount } from './mount'
import { ColumnDef } from './types'
import { formatBytes } from '../utils/format'
import type { DiskJob, DiskQueueSnapshot } from '@jstorrent/engine'

function formatDuration(job: DiskJob): string {
  if (!job.startedAt) return '-'
  const ms = Date.now() - job.startedAt
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatStatus(job: DiskJob): string {
  return job.status === 'running' ? '▶' : '⏳'
}

const diskColumns: ColumnDef<DiskJob>[] = [
  {
    id: 'status',
    header: '',
    getValue: (j) => formatStatus(j),
    width: 30,
    align: 'center',
  },
  {
    id: 'type',
    header: 'Type',
    getValue: (j) => j.type,
    width: 60,
  },
  {
    id: 'piece',
    header: 'Piece',
    getValue: (j) => String(j.pieceIndex),
    width: 60,
    align: 'right',
  },
  {
    id: 'files',
    header: 'Files',
    getValue: (j) => String(j.fileCount),
    width: 50,
    align: 'right',
  },
  {
    id: 'size',
    header: 'Size',
    getValue: (j) => formatBytes(j.size),
    width: 80,
    align: 'right',
  },
  {
    id: 'time',
    header: 'Time',
    getValue: (j) => formatDuration(j),
    width: 70,
    align: 'right',
  },
]

interface DiskQueueSource {
  getDiskQueueSnapshot(torrentHash: string): DiskQueueSnapshot | null
}

export interface DiskTableProps {
  source: DiskQueueSource
  torrentHash: string
}

export function DiskTable(props: DiskTableProps) {
  const getRows = (): DiskJob[] => {
    const snapshot = props.source.getDiskQueueSnapshot(props.torrentHash)
    if (!snapshot) return []
    // Running jobs first, then pending
    return [...snapshot.running, ...snapshot.pending]
  }

  return (
    <TableMount<DiskJob>
      getRows={getRows}
      getRowKey={(j) => String(j.id)}
      columns={diskColumns}
      storageKey="disk"
      rowHeight={24}
    />
  )
}
```

### 3.2 Export from UI index

In `packages/ui/src/index.ts`, add:

```typescript
export { DiskTable } from './tables/DiskTable'
```

### 3.3 Modify `packages/ui/src/components/DetailPane.tsx`

Add 'disk' to the DetailTab type:

```typescript
export type DetailTab = 'peers' | 'pieces' | 'files' | 'general' | 'logs' | 'disk'
```

Import DiskTable:

```typescript
import { DiskTable } from '../tables/DiskTable'
```

Add tab button after 'logs' button:

```typescript
<button
  style={activeTab === 'disk' ? activeTabStyle : tabStyle}
  onClick={() => setActiveTab('disk')}
>
  Disk
</button>
```

Add tab content after logs content:

```typescript
{activeTab === 'disk' &&
  renderTorrentContent(
    <DiskTable source={props.source} torrentHash={selectedHash!} />,
    'disk activity',
  )}
```

Update the TorrentSource interface in DetailPane.tsx to include:

```typescript
interface TorrentSource {
  readonly torrents: Torrent[]
  getTorrent(hash: string): Torrent | undefined
  getLogStore(): LogStore
  getDiskQueueSnapshot(hash: string): DiskQueueSnapshot | null  // ADD THIS
}
```

## Phase 4: Wire Up Adapter

### 4.1 Modify `packages/client/src/adapters/types.ts`

Add import:

```typescript
import { BtEngine, Torrent, LogStore, globalLogStore, DiskQueueSnapshot } from '@jstorrent/engine'
```

Add to EngineAdapter interface:

```typescript
/** Get disk queue snapshot for a torrent */
getDiskQueueSnapshot(infoHash: string): DiskQueueSnapshot | null
```

Add to DirectEngineAdapter class:

```typescript
getDiskQueueSnapshot(infoHash: string): DiskQueueSnapshot | null {
  const torrent = this.engine.getTorrent(infoHash)
  if (!torrent) return null
  // TODO: Return torrent.getDiskQueueSnapshot() once wired up
  // For now return empty snapshot
  return { pending: [], running: [], draining: false }
}
```

## Verification

Run from monorepo root:

```bash
pnpm typecheck
pnpm test
pnpm lint
```

The Disk tab should appear in the detail pane. It will show an empty table (since queue isn't wired to actual I/O yet). The unit tests verify queue behavior.

## Future Work (Not This Task)

- Wire queue to TorrentContentStorage (inject via constructor)
- Add .parts file handling for boundary pieces  
- Implement file priority changes with drain/resume
- Atomic .parts writes (tmp + fsync + rename)
