export type Listener = (...args: any[]) => void
export declare class EventEmitter {
  private events
  on(event: string, listener: Listener): this
  off(event: string, listener: Listener): this
  once(event: string, listener: Listener): this
  emit(event: string, ...args: any[]): boolean
  removeListener(event: string, listener: Listener): this
  removeAllListeners(event?: string): this
  listenerCount(event: string): number
}
//# sourceMappingURL=event-emitter.d.ts.map
