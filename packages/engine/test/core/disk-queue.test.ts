import { describe, it, expect, beforeEach } from 'vitest'
import { TorrentDiskQueue } from '../../src/core/disk-queue'

describe('TorrentDiskQueue', () => {
  let queue: TorrentDiskQueue

  beforeEach(() => {
    queue = new TorrentDiskQueue({ maxWorkers: 2 })
  })

  describe('enqueue', () => {
    it('should execute jobs immediately when under capacity', async () => {
      const executed: number[] = []

      await queue.enqueue({ type: 'write', pieceIndex: 1, fileCount: 1, size: 1000 }, async () => {
        executed.push(1)
      })

      expect(executed).toEqual([1])
    })

    it('should queue jobs when at capacity', async () => {
      const order: number[] = []
      const resolvers: Array<() => void> = []

      // Create 3 jobs, queue has capacity 2
      const job1 = queue.enqueue(
        { type: 'write', pieceIndex: 1, fileCount: 1, size: 1000 },
        () =>
          new Promise((r) => {
            resolvers[0] = () => {
              order.push(1)
              r()
            }
          }),
      )
      const job2 = queue.enqueue(
        { type: 'write', pieceIndex: 2, fileCount: 1, size: 1000 },
        () =>
          new Promise((r) => {
            resolvers[1] = () => {
              order.push(2)
              r()
            }
          }),
      )
      const job3 = queue.enqueue(
        { type: 'write', pieceIndex: 3, fileCount: 1, size: 1000 },
        () =>
          new Promise((r) => {
            resolvers[2] = () => {
              order.push(3)
              r()
            }
          }),
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

      queue.enqueue({ type: 'write', pieceIndex: 42, fileCount: 2, size: 16384 }, () => {
        return new Promise((r) => {
          resolver = r
        })
      })

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
        () =>
          new Promise((r) => {
            resolver = r
          }),
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
        () =>
          new Promise((r) => {
            resolver = r
          }),
      )

      const drainPromise = queue.drain().then(() => {
        drained = true
      })

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
      const started: number[] = []

      queue.enqueue(
        { type: 'write', pieceIndex: 1, fileCount: 1, size: 1000 },
        () =>
          new Promise((r) => {
            started.push(1)
            resolver1 = r
          }),
      )

      // Start draining
      const drainPromise = queue.drain()

      // Try to enqueue another job
      queue.enqueue(
        { type: 'write', pieceIndex: 2, fileCount: 1, size: 1000 },
        () =>
          new Promise(() => {
            started.push(2)
          }),
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

      const job1Promise = queue.enqueue(
        { type: 'write', pieceIndex: 1, fileCount: 1, size: 1000 },
        () =>
          new Promise((r) => {
            started.push(1)
            resolver1 = r
          }),
      )

      const drainPromise = queue.drain()
      resolver1!()
      await job1Promise
      await drainPromise

      queue.enqueue(
        { type: 'write', pieceIndex: 2, fileCount: 1, size: 1000 },
        () =>
          new Promise((r) => {
            started.push(2)
            resolver2 = r
          }),
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
          () =>
            new Promise((r) => {
              resolvers.push(r)
            }),
        )
      }

      const snapshot = queue4.getSnapshot()
      expect(snapshot.running.length).toBe(4)
      expect(snapshot.pending.length).toBe(2)

      resolvers.forEach((r) => r())
    })
  })
})
