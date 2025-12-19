import { BtEngine } from '../src/core/bt-engine'
import { InMemoryFileSystem, MemorySessionStore } from '../src/adapters/memory'
import { NodeSocketFactory, NodeHasher } from '../src/adapters/node'
import { StorageRootManager } from '../src/storage/storage-root-manager'

async function main() {
  const magnetLink = process.argv[2]
  const port = process.argv[3] ? parseInt(process.argv[3], 10) : 0

  if (!magnetLink?.startsWith('magnet:')) {
    console.error('Usage: pnpm download-memory "magnet:?xt=urn:btih:..." [port]')
    process.exit(1)
  }

  console.log(`Magnet: ${magnetLink}`)
  if (port) console.log(`Port: ${port}`)

  // Memory storage with real network sockets
  const storageRootManager = new StorageRootManager(() => new InMemoryFileSystem())
  storageRootManager.addRoot({ key: 'memory', label: 'Memory', path: '/memory' })
  storageRootManager.setDefaultRoot('memory')

  const engine = new BtEngine({
    socketFactory: new NodeSocketFactory(),
    storageRootManager,
    sessionStore: new MemorySessionStore(),
    hasher: new NodeHasher(),
    port,
  })

  console.log('Adding torrent...')
  const { torrent } = await engine.addTorrent(magnetLink)
  if (!torrent) throw new Error('Failed to add torrent')
  console.log(`Torrent added: ${torrent.infoHash}`)
  console.log(`Name: ${torrent.name}`)
  console.log(`Pieces: ${torrent.piecesCount}`)
  console.log('Files:')
  torrent.files.forEach((f) => {
    console.log(`  - ${f.path} (${f.length} bytes)`)
  })

  torrent.on('piece', (index: number) => {
    const total = torrent.piecesCount
    const completed = torrent.completedPiecesCount
    const progress = ((completed / total) * 100).toFixed(1)
    console.log(`Piece ${index} verified (${completed}/${total} = ${progress}%)`)
  })

  torrent.on('complete', () => {
    console.log('Download complete!')
    engine.destroy()
    process.exit(0)
  })

  torrent.on('error', (err) => {
    console.error('Torrent error:', err)
  })

  console.log('Download started. Press Ctrl+C to stop.')
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
