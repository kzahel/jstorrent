/**
 * Per-torrent disk I/O queue with configurable concurrency.
 *
 * Design decisions:
 * - Runs multiple workers in parallel (default 4, matches typical SSD parallelism)
 * - Serializes .parts file access (bencoded = full rewrite each time)
 * - Drains before file priority changes
 * - Exposes raw state for UI debugging
 */

/**
 * A disk job represents a single I/O operation.
 */
export interface DiskJob {
  /** Unique identifier for tracking */
  id: string
  /** Type of operation */
  type: 'read' | 'write'
  /** File path being accessed */
  filePath: string
  /** Byte offset within the file */
  offset: number
  /** Number of bytes */
  length: number
  /** Whether this is a .parts file operation (serialized) */
  isPartsFile: boolean
  /** Timestamp when job was enqueued */
  enqueuedAt: number
  /** Timestamp when job started executing (set when running) */
  startedAt?: number
  /** The actual work to execute */
  executor: () => Promise<void>
}

/**
 * Snapshot of queue state for UI/debugging.
 * When healthy, pending and running are empty.
 * Items appear when I/O is backed up.
 */
export interface DiskQueueSnapshot {
  pending: Omit<DiskJob, 'executor'>[]
  running: Omit<DiskJob, 'executor'>[]
  partsLocked: boolean
  draining: boolean
}

/**
 * Interface for disk queue - allows dependency injection and future topology changes.
 */
export interface IDiskQueue {
  /** Enqueue a job for execution. Resolves when the job completes. */
  enqueue(job: DiskJob): Promise<void>
  /** Drain the queue - wait for all running jobs, block new jobs until resume(). */
  drain(): Promise<void>
  /** Resume after drain - allow new jobs to be processed. */
  resume(): void
  /** Get current state snapshot for UI/debugging. */
  getSnapshot(): DiskQueueSnapshot
  /** Destroy the queue - reject pending jobs and cleanup. */
  destroy(): void
}

/**
 * Default queue configuration.
 */
export interface DiskQueueConfig {
  /** Maximum number of concurrent workers (default: 4) */
  maxWorkers: number
  /** Timeout for drain operation in ms (default: 30000) */
  drainTimeoutMs: number
}

const DEFAULT_CONFIG: DiskQueueConfig = {
  maxWorkers: 4,
  drainTimeoutMs: 30000,
}

interface QueuedJob {
  job: DiskJob
  resolve: () => void
  reject: (error: Error) => void
}

/**
 * Per-torrent disk queue implementation.
 *
 * Concurrency rules:
 * - Writes to different files: PARALLEL
 * - Writes to same file (different offsets): PARALLEL (OS handles)
 * - Writes to .parts file: SERIALIZED
 * - Priority changes: DRAIN queue first
 */
export class DiskQueue implements IDiskQueue {
  private config: DiskQueueConfig
  private pending: QueuedJob[] = []
  private running: Map<string, DiskJob> = new Map()
  private partsLocked: boolean = false
  private draining: boolean = false
  private destroyed: boolean = false
  private drainPromise: Promise<void> | null = null
  private jobCounter = 0

  constructor(config: Partial<DiskQueueConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Generate a unique job ID.
   */
  generateJobId(): string {
    return `job-${++this.jobCounter}-${Date.now()}`
  }

  async enqueue(job: DiskJob): Promise<void> {
    if (this.destroyed) {
      throw new Error('Queue has been destroyed')
    }

    if (this.draining) {
      // Block new jobs during drain - wait for drain to complete
      if (this.drainPromise) {
        await this.drainPromise
      }
    }

    return new Promise((resolve, reject) => {
      const queuedJob: QueuedJob = { job, resolve, reject }
      this.pending.push(queuedJob)
      this.processQueue()
    })
  }

  async drain(): Promise<void> {
    if (this.draining) {
      // Already draining, return existing promise
      return this.drainPromise!
    }

    this.draining = true

    // Create drain promise
    this.drainPromise = new Promise<void>((resolve, reject) => {
      // Set up timeout
      const timeoutId = setTimeout(() => {
        if (this.draining) {
          this.draining = false
          this.drainPromise = null
          reject(new Error(`Drain timed out after ${this.config.drainTimeoutMs}ms`))
        }
      }, this.config.drainTimeoutMs)

      // Check if already drained
      if (this.running.size === 0 && this.pending.length === 0) {
        clearTimeout(timeoutId)
        this.draining = false
        this.drainPromise = null
        resolve()
        return
      }

      // Store timeout ID so we can clear it when drain completes
      const checkDrained = () => {
        if (this.running.size === 0 && this.pending.length === 0) {
          clearTimeout(timeoutId)
          this.draining = false
          this.drainPromise = null
          ;(this as { _drainCheck?: () => void })._drainCheck = undefined
          resolve()
        }
      }

      // The processQueue will call checkDrained via onJobComplete
      // Store the check function for use in job completion
      ;(this as { _drainCheck?: () => void })._drainCheck = checkDrained
    })

    return this.drainPromise
  }

  resume(): void {
    if (!this.draining) return

    this.draining = false
    this.drainPromise = null
    ;(this as { _drainCheck?: () => void })._drainCheck = undefined

    // Resume processing
    this.processQueue()
  }

  getSnapshot(): DiskQueueSnapshot {
    const stripExecutor = (job: DiskJob): Omit<DiskJob, 'executor'> => {
      const { executor: _executor, ...rest } = job
      return rest
    }

    return {
      pending: this.pending.map((q) => stripExecutor(q.job)),
      running: Array.from(this.running.values()).map(stripExecutor),
      partsLocked: this.partsLocked,
      draining: this.draining,
    }
  }

  destroy(): void {
    this.destroyed = true
    this.draining = false

    // Reject all pending jobs
    for (const queuedJob of this.pending) {
      queuedJob.reject(new Error('Queue destroyed'))
    }
    this.pending = []

    // Running jobs will complete naturally
  }

  private processQueue(): void {
    if (this.destroyed || this.draining) return

    while (this.canStartJob()) {
      const nextJob = this.getNextJob()
      if (!nextJob) break

      this.startJob(nextJob)
    }
  }

  private canStartJob(): boolean {
    // Check worker limit
    if (this.running.size >= this.config.maxWorkers) return false

    // Check if we have pending jobs
    if (this.pending.length === 0) return false

    return true
  }

  private getNextJob(): QueuedJob | null {
    // Find first job that can run
    for (let i = 0; i < this.pending.length; i++) {
      const queuedJob = this.pending[i]

      // Check if parts file is locked
      if (queuedJob.job.isPartsFile && this.partsLocked) {
        continue
      }

      // Found a runnable job
      this.pending.splice(i, 1)
      return queuedJob
    }

    return null
  }

  private startJob(queuedJob: QueuedJob): void {
    const { job, resolve, reject } = queuedJob

    // Mark as running
    job.startedAt = Date.now()
    this.running.set(job.id, job)

    // Lock parts file if needed
    if (job.isPartsFile) {
      this.partsLocked = true
    }

    // Execute the job
    job
      .executor()
      .then(() => {
        this.onJobComplete(job)
        resolve()
      })
      .catch((error) => {
        this.onJobComplete(job)
        reject(error)
      })
  }

  private onJobComplete(job: DiskJob): void {
    this.running.delete(job.id)

    // Unlock parts file if this was a parts job
    if (job.isPartsFile) {
      this.partsLocked = false
    }

    // Check if drain is complete
    const drainCheck = (this as { _drainCheck?: () => void })._drainCheck
    if (drainCheck && this.draining) {
      drainCheck()
    }

    // Process more jobs
    if (!this.draining) {
      this.processQueue()
    }
  }
}

/**
 * Create a no-op queue that executes jobs immediately without queueing.
 * Useful for testing or when queue behavior is not needed.
 */
export class ImmediateDiskQueue implements IDiskQueue {
  async enqueue(job: DiskJob): Promise<void> {
    await job.executor()
  }

  async drain(): Promise<void> {
    // Nothing to drain - jobs execute immediately
  }

  resume(): void {
    // No-op
  }

  getSnapshot(): DiskQueueSnapshot {
    return {
      pending: [],
      running: [],
      partsLocked: false,
      draining: false,
    }
  }

  destroy(): void {
    // No-op
  }
}
