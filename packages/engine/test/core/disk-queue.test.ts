import { describe, it, expect, beforeEach } from 'vitest'
import { DiskQueue, DiskJob, ImmediateDiskQueue } from '../../src/core/disk-queue'

/** Create a mock disk job with controllable execution */
function createMockJob(overrides: Partial<DiskJob> = {}): {
  job: DiskJob
  resolve: () => void
  reject: (err: Error) => void
  promise: Promise<void>
} {
  let resolveExecutor: () => void = () => {}
  let rejectExecutor: (err: Error) => void = () => {}

  const promise = new Promise<void>((res, rej) => {
    resolveExecutor = res
    rejectExecutor = rej
  })

  const job: DiskJob = {
    id: `job-${Math.random().toString(36).slice(2, 7)}`,
    type: 'write',
    filePath: 'test.dat',
    offset: 0,
    length: 1024,
    isPartsFile: false,
    enqueuedAt: Date.now(),
    executor: () => promise,
    ...overrides,
  }

  return {
    job,
    resolve: resolveExecutor,
    reject: rejectExecutor,
    promise,
  }
}

describe('DiskQueue', () => {
  let queue: DiskQueue

  beforeEach(() => {
    queue = new DiskQueue({ maxWorkers: 4 })
  })

  describe('basic functionality', () => {
    it('should execute a single job', async () => {
      let executed = false
      const { job, resolve } = createMockJob()
      const originalExecutor = job.executor
      job.executor = async () => {
        await originalExecutor()
        executed = true
      }

      const enqueuePromise = queue.enqueue(job)
      resolve()
      await enqueuePromise

      expect(executed).toBe(true)
    })

    it('should resolve enqueue promise when job completes', async () => {
      const { job, resolve } = createMockJob()

      const enqueuePromise = queue.enqueue(job)

      // Job should be running
      expect(queue.getSnapshot().running.length).toBe(1)

      resolve()
      await enqueuePromise

      // Job should be done
      expect(queue.getSnapshot().running.length).toBe(0)
    })

    it('should reject enqueue promise when job fails', async () => {
      const { job, reject } = createMockJob()

      const enqueuePromise = queue.enqueue(job)
      reject(new Error('Job failed'))

      await expect(enqueuePromise).rejects.toThrow('Job failed')
    })
  })

  describe('concurrency limits', () => {
    it('should respect max workers limit', async () => {
      const queue = new DiskQueue({ maxWorkers: 2 })

      const jobs = [createMockJob(), createMockJob(), createMockJob()]

      // Enqueue all jobs (don't await)
      const promises = jobs.map((j) => queue.enqueue(j.job))

      // Should have 2 running, 1 pending
      const snapshot = queue.getSnapshot()
      expect(snapshot.running.length).toBe(2)
      expect(snapshot.pending.length).toBe(1)

      // Complete first job
      jobs[0].resolve()
      await promises[0]

      // Now should have 2 running, 0 pending (third job started)
      const snapshot2 = queue.getSnapshot()
      expect(snapshot2.running.length).toBe(2)
      expect(snapshot2.pending.length).toBe(0)

      // Complete remaining jobs
      jobs[1].resolve()
      jobs[2].resolve()
      await Promise.all(promises.slice(1))

      expect(queue.getSnapshot().running.length).toBe(0)
    })

    it('should allow up to maxWorkers concurrent jobs', async () => {
      const queue = new DiskQueue({ maxWorkers: 4 })

      const jobs = [createMockJob(), createMockJob(), createMockJob(), createMockJob()]

      // Enqueue all 4 jobs
      const promises = jobs.map((j) => queue.enqueue(j.job))

      // All 4 should be running
      expect(queue.getSnapshot().running.length).toBe(4)
      expect(queue.getSnapshot().pending.length).toBe(0)

      // Complete all
      jobs.forEach((j) => j.resolve())
      await Promise.all(promises)
    })
  })

  describe('.parts file serialization', () => {
    it('should serialize .parts file access', async () => {
      const partsJob1 = createMockJob({
        id: 'parts-1',
        filePath: 'data.parts',
        isPartsFile: true,
      })
      const partsJob2 = createMockJob({
        id: 'parts-2',
        filePath: 'data.parts',
        isPartsFile: true,
      })

      // Enqueue both parts jobs
      const promise1 = queue.enqueue(partsJob1.job)
      const promise2 = queue.enqueue(partsJob2.job)

      // First should be running, second should be pending (serialized)
      const snapshot = queue.getSnapshot()
      expect(snapshot.running.length).toBe(1)
      expect(snapshot.running[0].id).toBe('parts-1')
      expect(snapshot.pending.length).toBe(1)
      expect(snapshot.pending[0].id).toBe('parts-2')
      expect(snapshot.partsLocked).toBe(true)

      // Complete first job
      partsJob1.resolve()
      await promise1

      // Second job should now be running
      const snapshot2 = queue.getSnapshot()
      expect(snapshot2.running.length).toBe(1)
      expect(snapshot2.running[0].id).toBe('parts-2')
      expect(snapshot2.pending.length).toBe(0)

      // Complete second job
      partsJob2.resolve()
      await promise2

      expect(queue.getSnapshot().partsLocked).toBe(false)
    })

    it('should allow non-parts jobs to run while parts is locked', async () => {
      const partsJob = createMockJob({
        id: 'parts',
        filePath: 'data.parts',
        isPartsFile: true,
      })
      const regularJob = createMockJob({
        id: 'regular',
        filePath: 'regular.dat',
        isPartsFile: false,
      })

      // Enqueue parts job first, then regular job
      const partsPromise = queue.enqueue(partsJob.job)
      const regularPromise = queue.enqueue(regularJob.job)

      // Both should be running (parts lock doesn't affect non-parts jobs)
      const snapshot = queue.getSnapshot()
      expect(snapshot.running.length).toBe(2)

      partsJob.resolve()
      regularJob.resolve()
      await Promise.all([partsPromise, regularPromise])
    })
  })

  describe('drain', () => {
    it('should wait for running jobs to complete', async () => {
      const { job, resolve } = createMockJob()

      const enqueuePromise = queue.enqueue(job)

      // Start drain
      const drainPromise = queue.drain()

      // Job should still be running
      expect(queue.getSnapshot().running.length).toBe(1)
      expect(queue.getSnapshot().draining).toBe(true)

      // Complete the job
      resolve()
      await enqueuePromise

      // Drain should complete
      await drainPromise

      expect(queue.getSnapshot().draining).toBe(false)
    })

    it('should block new jobs during drain', async () => {
      const { job: job1, resolve: resolve1 } = createMockJob({ id: 'job1' })
      const { job: job2, resolve: resolve2 } = createMockJob({ id: 'job2' })

      // Enqueue first job
      const promise1 = queue.enqueue(job1)

      // Start drain
      const drainPromise = queue.drain()

      // Try to enqueue second job during drain (should block)
      let job2Started = false
      const promise2 = queue.enqueue(job2).then(() => {
        job2Started = true
      })

      // Give time for any async processing
      await new Promise((r) => setTimeout(r, 10))

      // Job2 should not have started yet
      expect(job2Started).toBe(false)
      expect(queue.getSnapshot().running.length).toBe(1)

      // Complete first job
      resolve1()
      await promise1
      await drainPromise

      // Resume queue
      queue.resume()

      // Now job2 should start
      await new Promise((r) => setTimeout(r, 10))
      expect(queue.getSnapshot().running.length).toBe(1)
      expect(queue.getSnapshot().running[0].id).toBe('job2')

      resolve2()
      await promise2
      expect(job2Started).toBe(true)
    })

    it('should complete immediately if queue is empty', async () => {
      await queue.drain()
      // Drain auto-resets when complete (nothing to drain)
      expect(queue.getSnapshot().draining).toBe(false)
    })

    it('should timeout if jobs take too long', async () => {
      const queue = new DiskQueue({ maxWorkers: 4, drainTimeoutMs: 50 })
      const { job } = createMockJob() // Never resolved

      queue.enqueue(job)

      await expect(queue.drain()).rejects.toThrow('Drain timed out')
    })
  })

  describe('snapshot', () => {
    it('should return consistent state', async () => {
      const { job, resolve } = createMockJob({ id: 'test-job' })

      const snapshot1 = queue.getSnapshot()
      expect(snapshot1.pending.length).toBe(0)
      expect(snapshot1.running.length).toBe(0)
      expect(snapshot1.partsLocked).toBe(false)
      expect(snapshot1.draining).toBe(false)

      const promise = queue.enqueue(job)

      const snapshot2 = queue.getSnapshot()
      expect(snapshot2.running.length).toBe(1)
      expect(snapshot2.running[0].id).toBe('test-job')
      expect(snapshot2.running[0].type).toBe('write')
      expect(snapshot2.running[0].filePath).toBe('test.dat')

      resolve()
      await promise

      const snapshot3 = queue.getSnapshot()
      expect(snapshot3.running.length).toBe(0)
    })

    it('should not include executor in snapshot', async () => {
      const { job, resolve } = createMockJob()

      const promise = queue.enqueue(job)
      const snapshot = queue.getSnapshot()

      // TypeScript should prevent this, but verify at runtime
      expect('executor' in snapshot.running[0]).toBe(false)

      resolve()
      await promise
    })
  })

  describe('destroy', () => {
    it('should reject pending jobs when destroyed', async () => {
      const queue = new DiskQueue({ maxWorkers: 1 })

      const { job: job1 } = createMockJob({ id: 'job1' })
      const { job: job2 } = createMockJob({ id: 'job2' })

      // Job1 runs, job2 queued
      queue.enqueue(job1)
      const promise2 = queue.enqueue(job2)

      expect(queue.getSnapshot().pending.length).toBe(1)

      // Destroy queue
      queue.destroy()

      // Pending job should be rejected
      await expect(promise2).rejects.toThrow('Queue destroyed')
    })

    it('should reject new jobs after destroy', async () => {
      queue.destroy()

      const { job } = createMockJob()
      await expect(queue.enqueue(job)).rejects.toThrow('Queue has been destroyed')
    })
  })

  describe('generateJobId', () => {
    it('should generate unique IDs', () => {
      const id1 = queue.generateJobId()
      const id2 = queue.generateJobId()
      const id3 = queue.generateJobId()

      expect(id1).not.toBe(id2)
      expect(id2).not.toBe(id3)
      expect(id1).not.toBe(id3)
    })
  })
})

describe('ImmediateDiskQueue', () => {
  it('should execute jobs immediately', async () => {
    const queue = new ImmediateDiskQueue()
    let executed = false

    const job: DiskJob = {
      id: 'test',
      type: 'write',
      filePath: 'test.dat',
      offset: 0,
      length: 1024,
      isPartsFile: false,
      enqueuedAt: Date.now(),
      executor: async () => {
        executed = true
      },
    }

    await queue.enqueue(job)
    expect(executed).toBe(true)
  })

  it('should return empty snapshot', () => {
    const queue = new ImmediateDiskQueue()
    const snapshot = queue.getSnapshot()

    expect(snapshot.pending.length).toBe(0)
    expect(snapshot.running.length).toBe(0)
    expect(snapshot.partsLocked).toBe(false)
    expect(snapshot.draining).toBe(false)
  })

  it('should handle drain and resume as no-ops', async () => {
    const queue = new ImmediateDiskQueue()
    await queue.drain()
    queue.resume()
    queue.destroy()
    // No errors = success
  })
})
