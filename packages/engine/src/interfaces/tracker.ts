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

export interface ITracker extends EventEmitter {
  announce(event: TrackerAnnounceEvent): Promise<void>
  destroy(): void

  // Events
  on(event: 'peer', listener: (peer: PeerInfo) => void): this
  on(event: 'error', listener: (err: Error) => void): this
  on(event: 'warning', listener: (msg: string) => void): this
}
