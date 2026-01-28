export type DiskJobType = 'write' | 'read'
export type DiskJobStatus = 'pending' | 'running'

export interface DiskJob {
  id: number
  type: DiskJobType
  pieceIndex: number
  fileCount: number // How many files this job touches
  size: number // Bytes
  status: DiskJobStatus
  enqueuedAt: number // Timestamp when enqueued
  startedAt?: number // Timestamp when started running
}

export interface DiskQueueSnapshot {
  pending: DiskJob[]
  running: DiskJob[]
  draining: boolean
}

export interface IDiskQueue {
  enqueue(
    job: Omit<DiskJob, 'id' | 'status' | 'enqueuedAt'>,
    execute: () => Promise<void>,
  ): Promise<void>
  drain(): Promise<void>
  resume(): void
  getSnapshot(): DiskQueueSnapshot
  /**
   * Flush any pending batched writes.
   * Called at end of tick to send accumulated writes in a single FFI call.
   * Default implementation is no-op (for non-batching queues).
   */
  flushPending?(): void
}

// Default concurrent disk workers for TorrentDiskQueue (extension/daemon mode)
const DEFAULT_DISK_WORKERS = 6

export interface DiskQueueConfig {
  maxWorkers: number
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
      maxWorkers: config.maxWorkers ?? DEFAULT_DISK_WORKERS,
    }
  }

  async enqueue(
    jobData: Omit<DiskJob, 'id' | 'status' | 'enqueuedAt'>,
    execute: () => Promise<void>,
  ): Promise<void> {
    const job: DiskJob = {
      ...jobData,
      id: this.nextId++,
      status: 'pending',
      enqueuedAt: Date.now(),
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

  private startJob(job: DiskJob, execute: () => Promise<void>): void {
    job.status = 'running'
    job.startedAt = Date.now()
    this.running.set(job.id, job)

    execute().finally(() => {
      this.running.delete(job.id)

      // Check if drain is waiting
      if (this.draining && this.running.size === 0) {
        this.drainResolve?.()
      }

      this.schedule()
    })
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

/**
 * Passthrough disk queue for Android/QuickJS.
 *
 * Immediately executes writes without JS-side queuing. The actual batching
 * happens in NativeBatchingDiskQueue which collects writes during a tick
 * and flushes them in a single FFI call at end of tick.
 *
 * Use this instead of TorrentDiskQueue for Android where:
 * - Writes go through NativeFileHandle → NativeBatchingDiskQueue
 * - Batching happens at the FFI layer, not in JS
 * - Concurrency is controlled by active pieces limit, not worker pool
 */
export class PassthroughDiskQueue implements IDiskQueue {
  async enqueue(
    _job: Omit<DiskJob, 'id' | 'status' | 'enqueuedAt'>,
    execute: () => Promise<void>,
  ): Promise<void> {
    // Execute immediately - batching happens in NativeBatchingDiskQueue
    await execute()
  }

  async drain(): Promise<void> {
    // No-op - nothing queued on JS side
  }

  resume(): void {
    // No-op
  }

  getSnapshot(): DiskQueueSnapshot {
    return { pending: [], running: [], draining: false }
  }
}
