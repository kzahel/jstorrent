import { EventEmitter } from '../utils/event-emitter'
export interface PeerInfo {
  ip: string
  port: number
}
export interface TrackerAnnounceResponse {
  interval: number
  peers: PeerInfo[]
  complete?: number
  incomplete?: number
}
export type TrackerAnnounceEvent = 'started' | 'stopped' | 'completed' | 'update'
export interface ITracker extends EventEmitter {
  announce(event: TrackerAnnounceEvent): Promise<void>
  destroy(): void
  on(event: 'peersDiscovered', listener: (peers: PeerInfo[]) => void): this
  on(event: 'error', listener: (err: Error) => void): this
  on(event: 'warning', listener: (msg: string) => void): this
}
//# sourceMappingURL=tracker.d.ts.map
