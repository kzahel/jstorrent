export type DiskJobType = 'write' | 'read'
export type DiskJobStatus = 'pending' | 'running'

export interface DiskJob {
  id: number
  type: DiskJobType
  pieceIndex: number
  fileCount: number // How many files this job touches
  size: number // Bytes
  status: DiskJobStatus
  startedAt?: number // Timestamp when started
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
  maxWorkers: number // Default 4
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
