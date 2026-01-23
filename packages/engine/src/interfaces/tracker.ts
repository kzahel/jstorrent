import { EventEmitter } from '../utils/event-emitter'

export interface PeerInfo {
  ip: string
  port: number
}

export interface TrackerAnnounceResponse {
  interval: number
  peers: PeerInfo[]
  complete?: number // seeders
  incomplete?: number // leechers
}

export type TrackerAnnounceEvent = 'started' | 'stopped' | 'completed' | 'update'

/**
 * Stats to include in tracker announce.
 * All values in bytes.
 */
export interface AnnounceStats {
  uploaded: number
  downloaded: number
  /** Bytes remaining. null = unknown (e.g., magnet before metadata received) */
  left: number | null
}

export type TrackerStatus = 'idle' | 'announcing' | 'ok' | 'error'

export interface TrackerStats {
  url: string
  type: 'http' | 'udp'
  status: TrackerStatus
  interval: number
  seeders: number | null
  leechers: number | null
  /** Number of peers received in the most recent announce response */
  lastPeersReceived: number
  /** Cumulative count of unique peers discovered from this tracker */
  uniquePeersDiscovered: number
  lastError: string | null
  /** Timestamp (ms) when next announce should occur, or null if not yet announced */
  nextAnnounce: number | null
}

export interface ITracker extends EventEmitter {
  readonly url: string
  announce(event: TrackerAnnounceEvent, stats?: AnnounceStats): Promise<void>
  destroy(): void
  getStats(): TrackerStats

  // Events
  on(event: 'peersDiscovered', listener: (peers: PeerInfo[]) => void): this
  on(event: 'error', listener: (err: Error) => void): this
  on(event: 'warning', listener: (msg: string) => void): this
}
