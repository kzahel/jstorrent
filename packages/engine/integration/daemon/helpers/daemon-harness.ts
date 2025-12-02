import { spawn, ChildProcess } from 'child_process'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'

export interface DaemonHarness {
  port: number
  token: string
  installId: string
  configDir: string
  dataDir: string
  process: ChildProcess
  cleanup: () => Promise<void>
}

export interface DaemonConfig {
  roots?: Array<{
    key: string
    path: string
    displayName: string
  }>
}

const DAEMON_BIN = path.resolve(
  __dirname,
  '../../../../../native-host/target/debug/jstorrent-io-daemon',
)

export async function startDaemon(config: DaemonConfig = {}): Promise<DaemonHarness> {
  // Create temp directories
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jstorrent-daemon-test-'))
  const configDir = path.join(tmpDir, 'config')
  const dataDir = path.join(tmpDir, 'data')

  await fs.mkdir(configDir, { recursive: true })
  await fs.mkdir(dataDir, { recursive: true })

  const token = 'test-token-' + Math.random().toString(36).slice(2)
  const installId = 'test-install-' + Math.random().toString(36).slice(2)

  // Build download_roots from config
  const roots = config.roots ?? [{ key: 'default', path: dataDir, displayName: 'Test Data' }]

  // Ensure root directories exist
  for (const root of roots) {
    await fs.mkdir(root.path, { recursive: true })
  }

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
        download_roots: roots.map((r) => ({
          key: r.key,
          path: r.path,
          display_name: r.displayName,
          removable: false,
          last_stat_ok: true,
          last_checked: Date.now(),
        })),
      },
    ],
  }

  const nativeHostDir = path.join(configDir, 'jstorrent-native')
  await fs.mkdir(nativeHostDir, { recursive: true })
  await fs.writeFile(path.join(nativeHostDir, 'rpc-info.json'), JSON.stringify(rpcInfo))

  // Spawn daemon
  let daemonProcess: ChildProcess
  const port = await new Promise<number>((resolve, reject) => {
    daemonProcess = spawn(
      DAEMON_BIN,
      ['--port', '0', '--token', token, '--install-id', installId],
      {
        env: { ...process.env, JSTORRENT_CONFIG_DIR: configDir },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )

    let output = ''
    let resolved = false

    daemonProcess.stdout?.on('data', (data) => {
      output += data.toString()
      // Daemon prints port to stdout
      const match = output.match(/(\d+)\n/)
      if (match && !resolved) {
        resolved = true
        const port = parseInt(match[1], 10)
        resolve(port)
      }
    })

    daemonProcess.stderr?.on('data', (data) => {
      console.error(`Daemon stderr: ${data}`)
    })

    daemonProcess.on('error', (err) => {
      if (!resolved) reject(err)
    })

    daemonProcess.on('exit', (code) => {
      if (!resolved && code !== 0) {
        reject(new Error(`Daemon exited with code ${code}`))
      }
    })
  })

  return {
    port,
    token,
    installId,
    configDir,
    dataDir,
    process: daemonProcess!,
    cleanup: async () => {
      if (daemonProcess) {
        daemonProcess.kill()
      }
      // Clean temp dir
      await fs.rm(tmpDir, { recursive: true, force: true })
    },
  }
}
