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
  totalDownloaded: number
  totalUploaded: number
  numPeers: number
  contentStorage?: { getTotalSize: () => number }
}

/**
 * Create a deterministic mock torrent for testing.
 * Values are predictable based on id for reliable sort testing.
 */
export function createMockTorrent(id: number, overrides: Partial<MockTorrent> = {}): MockTorrent {
  const hash = id.toString(16).padStart(40, '0')
  return {
    infoHashStr: hash,
    // Names: Torrent A, B, C, D, E... for easy alphabetical testing
    name: `Torrent ${String.fromCharCode(65 + id)}`,
    progress: 0.5,
    activityState: 'downloading',
    // Download speeds: descending (10000, 9000, 8000...) for predictable sort
    downloadSpeed: (10 - id) * 1000,
    uploadSpeed: id * 100,
    // Total bytes: some deterministic values
    totalDownloaded: (id + 1) * 1024 * 1024 * 50,
    totalUploaded: (id + 1) * 1024 * 1024 * 10,
    numPeers: id,
    contentStorage: { getTotalSize: () => 1024 * 1024 * 100 },
    ...overrides,
  }
}

export function createMockTorrents(count: number): MockTorrent[] {
  return Array.from({ length: count }, (_, i) => createMockTorrent(i))
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
