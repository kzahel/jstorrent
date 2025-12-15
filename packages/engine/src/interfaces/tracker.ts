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

export type TrackerStatus = 'idle' | 'announcing' | 'ok' | 'error'

export interface TrackerStats {
  url: string
  type: 'http' | 'udp'
  status: TrackerStatus
  interval: number
  seeders: number | null
  leechers: number | null
  lastError: string | null
  /** Timestamp (ms) when next announce should occur, or null if not yet announced */
  nextAnnounce: number | null
}

export interface ITracker extends EventEmitter {
  readonly url: string
  announce(event: TrackerAnnounceEvent): Promise<void>
  destroy(): void
  getStats(): TrackerStats

  // Events
  on(event: 'peersDiscovered', listener: (peers: PeerInfo[]) => void): this
  on(event: 'error', listener: (err: Error) => void): this
  on(event: 'warning', listener: (msg: string) => void): this
}
