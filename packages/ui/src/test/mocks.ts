/**
 * Mock torrent for testing
 */
export interface MockTorrent {
  infoHashStr: string
  name: string
  progress: number
  activityState: string
  downloadSpeed: number
  uploadSpeed: number
  numPeers: number
  contentStorage?: { getTotalSize: () => number }
}

export function createMockTorrent(id: number): MockTorrent {
  const hash = id.toString(16).padStart(40, '0')
  return {
    infoHashStr: hash,
    name: `Test Torrent ${id.toString().padStart(3, '0')}`,
    progress: Math.random(),
    activityState: 'downloading',
    downloadSpeed: Math.floor(Math.random() * 1000000),
    uploadSpeed: Math.floor(Math.random() * 100000),
    numPeers: Math.floor(Math.random() * 20),
    contentStorage: { getTotalSize: () => 1024 * 1024 * 100 },
  }
}

export function createMockTorrents(count: number): MockTorrent[] {
  return Array.from({ length: count }, (_, i) => createMockTorrent(i + 1))
}

export interface MockSource {
  torrents: MockTorrent[]
  getTorrent: (hash: string) => MockTorrent | undefined
}

export function createMockSource(count: number): MockSource {
  const torrents = createMockTorrents(count)
  return {
    torrents,
    getTorrent: (hash: string) => torrents.find((t) => t.infoHashStr === hash),
  }
}
