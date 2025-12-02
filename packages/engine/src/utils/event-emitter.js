export class EventEmitter {
  constructor() {
    this.events = new Map()
  }
  on(event, listener) {
    if (!this.events.has(event)) {
      this.events.set(event, [])
    }
    this.events.get(event).push(listener)
    return this
  }
  off(event, listener) {
    if (!this.events.has(event)) return this
    const listeners = this.events.get(event)
    const index = listeners.indexOf(listener)
    if (index !== -1) {
      listeners.splice(index, 1)
    }
    return this
  }
  once(event, listener) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onceWrapper = (...args) => {
      this.off(event, onceWrapper)
      listener.apply(this, args)
    }
    return this.on(event, onceWrapper)
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  emit(event, ...args) {
    if (!this.events.has(event)) return false
    const listeners = this.events.get(event)
    // Copy to avoid issues if listeners are removed during execution
    for (const listener of [...listeners]) {
      listener.apply(this, args)
    }
    return true
  }
  removeListener(event, listener) {
    return this.off(event, listener)
  }
  removeAllListeners(event) {
    if (event) {
      this.events.delete(event)
    } else {
      this.events.clear()
    }
    return this
  }
  listenerCount(event) {
    return this.events.get(event)?.length ?? 0
  }
}
