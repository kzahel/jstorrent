import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import path from 'path'
import fs from 'fs/promises'
import os from 'os'
import { startDaemon, DaemonHarness } from './helpers/daemon-harness'
import { DaemonFileSystem } from '../../src/adapters/daemon/daemon-filesystem'
import { DaemonConnection } from '../../src/adapters/daemon/daemon-connection'

describe('DaemonFileSystem Integration', () => {
  let harness: DaemonHarness
  let connection: DaemonConnection
  let fs1: DaemonFileSystem
  let fs2: DaemonFileSystem
  const rootToken1 = 'root-1'
  const rootToken2 = 'root-2'

  beforeAll(async () => {
    // Create temp directories for roots
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jstorrent-test-roots-'))
    const dataDir1 = path.join(tmpDir, 'data1')
    const dataDir2 = path.join(tmpDir, 'data2')

    harness = await startDaemon({
      roots: [
        { token: rootToken1, path: dataDir1, displayName: 'Root 1' },
        { token: rootToken2, path: dataDir2, displayName: 'Root 2' },
      ],
    })

    connection = new DaemonConnection(harness.port, harness.token)
    fs1 = new DaemonFileSystem(connection, rootToken1)
    fs2 = new DaemonFileSystem(connection, rootToken2)
  })

  afterAll(async () => {
    await harness.cleanup()
  })

  it('should write and read a file in root 1', async () => {
    const handle = await fs1.open('test.txt', 'w')
    const data = new TextEncoder().encode('Hello World')
    await handle.write(data, 0, data.length, 0)
    await handle.close()

    const readHandle = await fs1.open('test.txt', 'r')
    const buffer = new Uint8Array(data.length)
    const { bytesRead } = await readHandle.read(buffer, 0, data.length, 0)
    expect(bytesRead).toBe(data.length)
    expect(new TextDecoder().decode(buffer)).toBe('Hello World')
    await readHandle.close()
  })

  it('should verify file existence and stat in root 1', async () => {
    expect(await fs1.exists('test.txt')).toBe(true)
    const stats = await fs1.stat('test.txt')
    expect(stats.isFile).toBe(true)
    expect(stats.size).toBe(11)
  })

  it('should list directory in root 1', async () => {
    const files = await fs1.readdir('')
    expect(files).toContain('test.txt')
  })

  it('should write to root 2 and verify isolation', async () => {
    const handle = await fs2.open('root2.txt', 'w')
    const data = new TextEncoder().encode('Root 2 Data')
    await handle.write(data, 0, data.length, 0)
    await handle.close()

    expect(await fs2.exists('root2.txt')).toBe(true)
    expect(await fs1.exists('root2.txt')).toBe(false) // Should not exist in root 1
  })

  it('should delete file in root 1', async () => {
    await fs1.delete('test.txt')
    expect(await fs1.exists('test.txt')).toBe(false)
  })

  it('should truncate file in root 2', async () => {
    const handle = await fs2.open('truncate.txt', 'w')
    const data = new TextEncoder().encode('1234567890')
    await handle.write(data, 0, data.length, 0)
    await handle.close()

    const truncHandle = await fs2.open('truncate.txt', 'r+')
    await truncHandle.truncate(5)
    await truncHandle.close()

    const stats = await fs2.stat('truncate.txt')
    expect(stats.size).toBe(5)
  })
})
