import * as http from 'http'
import { EngineController } from './controller'

export class HttpRpcServer {
  private server: http.Server
  private controller: EngineController
  private port: number

  constructor(port: number = 3000) {
    this.port = port
    this.controller = new EngineController()
    this.server = http.createServer((req, res) => this.handleRequest(req, res))
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(this.port, () => {
        console.log(`HTTP RPC Server listening on port ${this.port}`)
        resolve()
      })
    })
  }

  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    const { method, url } = req

    // Enable CORS for local dev
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    if (method === 'OPTIONS') {
      res.writeHead(200)
      res.end()
      return
    }

    try {
      if (url === '/engine/start' && method === 'POST') {
        const body = await this.readBody(req)
        this.controller.startEngine(body.config)
        this.sendJson(res, { ok: true })
      } else if (url === '/engine/stop' && method === 'POST') {
        this.controller.stopEngine()
        this.sendJson(res, { ok: true })
      } else if (url === '/engine/status' && method === 'GET') {
        const status = this.controller.getEngineStatus()
        this.sendJson(res, status)
      } else if (url === '/shutdown' && method === 'POST') {
        // Stop engine if running
        try {
          this.controller.stopEngine()
        } catch (e) {
          // ignore if not running
        }
        this.sendJson(res, { ok: true })
        // Close server and exit process
        setTimeout(() => {
          this.stop().then(() => process.exit(0))
        }, 100)
      } else if (url === '/torrent/add' && method === 'POST') {
        const body = await this.readBody(req)
        const result = await this.controller.addTorrent(body)
        this.sendJson(res, result)
      } else if (url?.startsWith('/torrent/') && url?.endsWith('/status') && method === 'GET') {
        const id = url.split('/')[2]
        const status = this.controller.getTorrentStatus(id)
        this.sendJson(res, status)
      } else if (url?.startsWith('/torrent/') && url?.endsWith('/pause') && method === 'POST') {
        const id = url.split('/')[2]
        this.controller.pauseTorrent(id)
        this.sendJson(res, { ok: true })
      } else if (url?.startsWith('/torrent/') && url?.endsWith('/resume') && method === 'POST') {
        const id = url.split('/')[2]
        this.controller.resumeTorrent(id)
        this.sendJson(res, { ok: true })
      } else if (url?.startsWith('/torrent/') && url?.endsWith('/remove') && method === 'POST') {
        const id = url.split('/')[2]
        this.controller.removeTorrent(id)
        this.sendJson(res, { ok: true })
      } else if (url?.startsWith('/torrent/') && url?.endsWith('/add-peer') && method === 'POST') {
        const id = url.split('/')[2]
        const body = await this.readBody(req)
        await this.controller.addPeer(id, body.ip, body.port)
        this.sendJson(res, { ok: true })
      } else if (url?.startsWith('/torrent/') && url?.endsWith('/recheck') && method === 'POST') {
        const id = url.split('/')[2]
        await this.controller.recheckTorrent(id)
        this.sendJson(res, { ok: true })
      } else {
        res.writeHead(404)
        this.sendJson(res, { ok: false, error: 'Not Found' })
      }
    } catch (err: any) {
      const code =
        err.message === 'EngineNotRunning' ||
        err.message === 'EngineAlreadyRunning' ||
        err.message === 'TorrentNotFound'
          ? 400
          : 500
      res.writeHead(code)
      this.sendJson(res, { ok: false, error: err.message })
    }
  }

  private readBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      let body = ''
      req.on('data', (chunk) => {
        body += chunk.toString()
      })
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {})
        } catch (err) {
          reject(err)
        }
      })
      req.on('error', reject)
    })
  }

  private sendJson(res: http.ServerResponse, data: any) {
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'application/json')
    }
    res.end(JSON.stringify(data))
  }
}
