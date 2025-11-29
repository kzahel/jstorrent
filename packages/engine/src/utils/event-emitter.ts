// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Listener = (...args: any[]) => void

export class EventEmitter {
  private events: Map<string, Listener[]> = new Map()

  public on(event: string, listener: Listener): this {
    if (!this.events.has(event)) {
      this.events.set(event, [])
    }
    this.events.get(event)!.push(listener)
    return this
  }

  public off(event: string, listener: Listener): this {
    if (!this.events.has(event)) return this
    const listeners = this.events.get(event)!
    const index = listeners.indexOf(listener)
    if (index !== -1) {
      listeners.splice(index, 1)
    }
    return this
  }

  public once(event: string, listener: Listener): this {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onceWrapper = (...args: any[]) => {
      this.off(event, onceWrapper)
      listener.apply(this, args)
    }
    return this.on(event, onceWrapper)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public emit(event: string, ...args: any[]): boolean {
    if (!this.events.has(event)) return false
    const listeners = this.events.get(event)!
    // Copy to avoid issues if listeners are removed during execution
    for (const listener of [...listeners]) {
      listener.apply(this, args)
    }
    return true
  }

  public removeListener(event: string, listener: Listener): this {
    return this.off(event, listener)
  }

  public removeAllListeners(event?: string): this {
    if (event) {
      this.events.delete(event)
    } else {
      this.events.clear()
    }
    return this
  }

  public listenerCount(event: string): number {
    return this.events.get(event)?.length ?? 0
  }
}
