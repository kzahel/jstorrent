import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn, ChildProcess } from 'child_process'
import path from 'path'
import fs from 'fs/promises'
import os from 'os'
import { DaemonFileSystem } from '../../src/adapters/daemon/daemon-filesystem'
import { DaemonConnection } from '../../src/adapters/daemon/daemon-connection'

const DAEMON_BIN = path.resolve(
  __dirname,
  '../../../../native-host/target/debug/jstorrent-io-daemon',
)

describe('DaemonFileSystem Integration', () => {
  let daemonProcess: ChildProcess
  let tmpDir: string
  let configDir: string
  let dataDir1: string
  let dataDir2: string
  let connection: DaemonConnection
  let fs1: DaemonFileSystem
  let fs2: DaemonFileSystem
  const token = 'test-token'
  const installId = 'test-install-id'
  const rootToken1 = 'root-1'
  const rootToken2 = 'root-2'

  beforeAll(async () => {
    // Create temp directories
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jstorrent-test-'))
    configDir = path.join(tmpDir, 'config')
    dataDir1 = path.join(tmpDir, 'data1')
    dataDir2 = path.join(tmpDir, 'data2')

    await fs.mkdir(configDir, { recursive: true })
    await fs.mkdir(dataDir1, { recursive: true })
    await fs.mkdir(dataDir2, { recursive: true })

    // Create rpc-info.json
    const rpcInfo = {
      version: 1,
      profiles: [
        {
          install_id: installId,
          extension_id: 'test-extension',
          salt: 'test-salt',
          pid: process.pid,
          port: 0,
          token: 'host-token',
          started: Date.now(),
          last_used: Date.now(),
          browser: { name: 'test', binary: 'test', extension_id: 'test' },
          download_roots: [
            {
              token: rootToken1,
              path: dataDir1,
              display_name: 'Root 1',
              removable: false,
              last_stat_ok: true,
              last_checked: Date.now(),
            },
            {
              token: rootToken2,
              path: dataDir2,
              display_name: 'Root 2',
              removable: false,
              last_stat_ok: true,
              last_checked: Date.now(),
            },
          ],
        },
      ],
    }

    const nativeHostDir = path.join(configDir, 'jstorrent-native')
    await fs.mkdir(nativeHostDir, { recursive: true })
    await fs.writeFile(path.join(nativeHostDir, 'rpc-info.json'), JSON.stringify(rpcInfo))

    // Spawn io-daemon
    return new Promise<void>((resolve, reject) => {
      daemonProcess = spawn(
        DAEMON_BIN,
        ['--port', '0', '--token', token, '--install-id', installId],
        {
          env: { ...process.env, JSTORRENT_CONFIG_DIR: configDir },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      )

      let output = ''
      daemonProcess.stdout?.on('data', (data) => {
        output += data.toString()
        const match = output.match(/(\d+)\n/) // Daemon prints port to stdout
        if (match) {
          const daemonPort = parseInt(match[1], 10)
          connection = new DaemonConnection(daemonPort, token)
          fs1 = new DaemonFileSystem(connection, rootToken1)
          fs2 = new DaemonFileSystem(connection, rootToken2)
          resolve()
        }
      })

      daemonProcess.stderr?.on('data', (data) => {
        console.error(`Daemon stderr: ${data}`)
      })

      daemonProcess.on('error', reject)
      daemonProcess.on('exit', (code) => {
        if (code !== null && code !== 0) {
          reject(new Error(`Daemon exited with code ${code}`))
        }
      })
    })
  })

  afterAll(async () => {
    if (daemonProcess) {
      daemonProcess.kill()
    }
    // Cleanup temp dir
    // await fs.rm(tmpDir, { recursive: true, force: true })
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
