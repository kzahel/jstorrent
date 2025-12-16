import {
  BtEngine,
  Torrent,
  LogStore,
  globalLogStore,
  DiskQueueSnapshot,
  TrackerStats,
  BandwidthTracker,
} from '@jstorrent/engine'

/**
 * Abstract interface for engine access.
 * Allows UI to work with direct engine or RPC client.
 */
export interface EngineAdapter {
  /** All torrents in the engine */
  readonly torrents: Torrent[]

  /** Total number of peer connections */
  readonly numConnections: number

  /** Add a torrent from magnet link or .torrent buffer */
  addTorrent(
    magnetOrBuffer: string | Uint8Array,
    options?: { userState?: 'active' | 'stopped' },
  ): Promise<Torrent | null>

  /** Remove a torrent */
  removeTorrent(torrent: Torrent): Promise<void>

  /** Remove a torrent and delete all associated data files from disk */
  removeTorrentWithData(torrent: Torrent): Promise<{ success: boolean; errors: string[] }>

  /** Reset a torrent's state (progress, stats, file priorities) without removing it */
  resetTorrent(torrent: Torrent): Promise<void>

  /** Get torrent by info hash string */
  getTorrent(infoHash: string): Torrent | undefined

  /** Subscribe to engine events */
  on(event: string, callback: (...args: unknown[]) => void): void

  /** Unsubscribe from engine events */
  off(event: string, callback: (...args: unknown[]) => void): void

  /** Clean up resources */
  destroy(): void

  /** Get the log store for viewing logs */
  getLogStore(): LogStore

  /** Get disk queue snapshot for a torrent */
  getDiskQueueSnapshot(infoHash: string): DiskQueueSnapshot | null

  /** Get tracker stats for a torrent */
  getTrackerStats(infoHash: string): TrackerStats[]

  /** Get the bandwidth tracker for speed graphs */
  getBandwidthTracker(): BandwidthTracker
}

/**
 * Adapter that wraps a direct BtEngine instance.
 * Used when engine runs in the same JS heap.
 */
export class DirectEngineAdapter implements EngineAdapter {
  constructor(private engine: BtEngine) {}

  get torrents(): Torrent[] {
    return this.engine.torrents
  }

  get numConnections(): number {
    return this.engine.numConnections
  }

  async addTorrent(
    magnetOrBuffer: string | Uint8Array,
    options?: { userState?: 'active' | 'stopped' },
  ): Promise<Torrent | null> {
    return this.engine.addTorrent(magnetOrBuffer, options)
  }

  async removeTorrent(torrent: Torrent): Promise<void> {
    await this.engine.removeTorrent(torrent)
  }

  async removeTorrentWithData(torrent: Torrent): Promise<{ success: boolean; errors: string[] }> {
    return this.engine.removeTorrentWithData(torrent)
  }

  async resetTorrent(torrent: Torrent): Promise<void> {
    await this.engine.resetTorrent(torrent)
  }

  getTorrent(infoHash: string): Torrent | undefined {
    return this.engine.getTorrent(infoHash)
  }

  on(event: string, callback: (...args: unknown[]) => void): void {
    this.engine.on(event as Parameters<typeof this.engine.on>[0], callback as () => void)
  }

  off(event: string, callback: (...args: unknown[]) => void): void {
    this.engine.off(event as Parameters<typeof this.engine.off>[0], callback as () => void)
  }

  destroy(): void {
    this.engine.destroy()
  }

  getLogStore(): LogStore {
    return globalLogStore
  }

  getDiskQueueSnapshot(infoHash: string): DiskQueueSnapshot | null {
    const torrent = this.engine.getTorrent(infoHash)
    if (!torrent) return null
    return torrent.getDiskQueueSnapshot()
  }

  getTrackerStats(infoHash: string): TrackerStats[] {
    const torrent = this.engine.getTorrent(infoHash)
    return torrent?.getTrackerStats() ?? []
  }

  getBandwidthTracker(): BandwidthTracker {
    return this.engine.bandwidthTracker
  }
}
