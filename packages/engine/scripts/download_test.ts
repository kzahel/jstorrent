import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { Client } from '../src/core/client'
import { ScopedNodeFileSystem } from '../src/io/node/scoped-node-filesystem'
import { NodeSocketFactory } from '../src/io/node/node-socket'

async function main() {
    try {
        // 1. Setup paths
        const magnetPath = path.resolve(__dirname, '../../../big_buck_bunny.magnet')
        const downloadPath = path.join(os.homedir(), 'Downloads', 'jstorrent')

        console.log(`Reading magnet from: ${magnetPath}`)
        console.log(`Download directory: ${downloadPath}`)

        // 2. Read magnet link
        if (!fs.existsSync(magnetPath)) {
            console.error(`Magnet file not found at ${magnetPath}`)
            process.exit(1)
        }
        const magnetLink = fs.readFileSync(magnetPath, 'utf-8').trim()
        console.log(`Magnet link: ${magnetLink}`)

        // 3. Initialize dependencies
        // Ensure download directory exists (ScopedNodeFileSystem might do this, but good to be sure or let it handle it)
        // ScopedNodeFileSystem takes a root path.
        const fileSystem = new ScopedNodeFileSystem(downloadPath)
        const socketFactory = new NodeSocketFactory()

        // 4. Initialize Client
        const client = new Client({
            downloadPath: downloadPath, // Client options might not use this directly if we pass fileSystem, but interface might require it or we can pass it.
            // Looking at ClientOptions in client.ts:
            // export interface ClientOptions {
            //   downloadPath: string
            //   socketFactory: ISocketFactory
            //   fileSystem: IFileSystem
            //   ...
            // }
            fileSystem: fileSystem,
            socketFactory: socketFactory,
        })

        // global.client = client;

        // 5. Add Torrent
        console.log('Adding torrent...')
        const torrent = await client.addTorrent(magnetLink)

        console.log(`Torrent added: ${torrent.infoHash}`)

        // 6. Listen for events
        torrent.on('metadata', () => {
            console.log('Metadata received!')
            console.log(`Torrent name: ${torrent.name}`)
            console.log(`Files:`)
            torrent.files.forEach(f => {
                console.log(` - ${f.path} (${f.length} bytes) - ${(f.progress * 100).toFixed(1)}%`)
            })
        })

        torrent.on('download', (bytes: number) => {
            console.log(`Downloaded ${bytes} bytes. Progress: ${(torrent.progress * 100).toFixed(2)}%`)
        })

        torrent.on('complete', () => {
            console.log('Download complete!')
            client.destroy()
            process.exit(0)
        })

        torrent.on('error', (err) => {
            console.error('Torrent error:', err)
        })

        // Keep process alive
        console.log('Download started. Press Ctrl+C to stop.')

    } catch (err) {
        console.error('Error:', err)
        process.exit(1)
    }
}

main()
