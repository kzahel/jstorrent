import * as http from 'http'
import { spawn } from 'child_process'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const PORT = 3001

function request(method: string, path: string, body?: any): Promise<any> {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: PORT,
            path: path,
            method: method,
            headers: {
                'Content-Type': 'application/json',
            },
        }

        const req = http.request(options, (res) => {
            let data = ''
            res.on('data', (chunk) => {
                data += chunk
            })
            res.on('end', () => {
                try {
                    const json = JSON.parse(data)
                    resolve({ status: res.statusCode, body: json })
                } catch (e) {
                    resolve({ status: res.statusCode, body: data })
                }
            })
        })

        req.on('error', reject)

        if (body) {
            req.write(JSON.stringify(body))
        }
        req.end()
    })
}

async function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

async function runTest() {
    console.log('Starting RPC server...')
    const rpcScript = path.join(__dirname, '../packages/engine/src/cmd/run-rpc.ts')
    const proc = spawn('pnpm', ['exec', 'tsx', rpcScript], {
        env: { ...process.env, PORT: PORT.toString() },
        cwd: path.join(__dirname, '../packages/engine'), // Run from engine package root
        stdio: 'inherit',
    })

    // Wait for server to start
    await sleep(2000)

    try {
        console.log('Testing GET /engine/status (should be not running)...')
        let res = await request('GET', '/engine/status')
        console.log('Status:', res.body)
        if (res.body.running !== false) throw new Error('Expected running: false')

        console.log('Testing POST /engine/start...')
        res = await request('POST', '/engine/start', { config: {} })
        console.log('Start:', res.body)
        if (!res.body.ok) throw new Error('Failed to start engine')

        console.log('Testing GET /engine/status (should be running)...')
        res = await request('GET', '/engine/status')
        console.log('Status:', res.body)
        if (res.body.running !== true) throw new Error('Expected running: true')

        console.log('Testing POST /torrent/add (magnet)...')
        // Sintel magnet link
        const magnet = 'magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&dn=Sintel&tr=udp%3A%2F%2Ftracker.leechers-paradise.org%3A6969&tr=udp%3A%2F%2Ftracker.coppersurfer.tk%3A6969&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&tr=udp%3A%2F%2Fexplodie.org%3A6969&tr=udp%3A%2F%2Ftracker.empire-js.us%3A1337'
        res = await request('POST', '/torrent/add', { type: 'magnet', data: magnet })
        console.log('Add Torrent:', res.body)
        if (!res.body.ok) throw new Error('Failed to add torrent')
        const torrentId = res.body.id

        console.log(`Testing GET /torrent/${torrentId}/status...`)
        res = await request('GET', `/torrent/${torrentId}/status`)
        console.log('Torrent Status:', res.body)
        if (res.body.id !== torrentId) throw new Error('Torrent ID mismatch')

        console.log('Testing POST /engine/stop...')
        res = await request('POST', '/engine/stop')
        console.log('Stop:', res.body)
        if (!res.body.ok) throw new Error('Failed to stop engine')

        console.log('Testing GET /engine/status (should be not running)...')
        res = await request('GET', '/engine/status')
        console.log('Status:', res.body)
        if (res.body.running !== false) throw new Error('Expected running: false')

        console.log('All tests passed!')
    } catch (err) {
        console.error('Test failed:', err)
        process.exit(1)
    } finally {
        console.log('Shutting down server...')
        await request('POST', '/shutdown')
        proc.kill()
    }
}

runTest()
