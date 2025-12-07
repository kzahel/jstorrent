/**
 * IO Bridge Store
 *
 * Holds the current state and notifies listeners of state changes.
 */

import type { IOBridgeState, IOBridgeEvent } from './types'
import { transition, createInitialState } from './io-bridge-state'

export type StateListener = (state: IOBridgeState, previousState: IOBridgeState) => void

/**
 * State store for the IO Bridge.
 *
 * - Holds the current state
 * - Dispatches events through the transition function
 * - Notifies listeners of state changes
 */
export class IOBridgeStore {
  private state: IOBridgeState
  private listeners: Set<StateListener> = new Set()

  constructor(initialState: IOBridgeState = createInitialState()) {
    this.state = initialState
  }

  /**
   * Get the current state.
   */
  getState(): IOBridgeState {
    return this.state
  }

  /**
   * Dispatch an event to the state machine.
   *
   * If the state changes, notifies all listeners.
   * Returns true if the state changed, false otherwise.
   */
  dispatch(event: IOBridgeEvent): boolean {
    const previousState = this.state
    const nextState = transition(previousState, event)

    if (nextState !== previousState) {
      this.state = nextState
      this.notifyListeners(previousState)
      return true
    }

    return false
  }

  /**
   * Subscribe to state changes.
   *
   * Returns an unsubscribe function.
   */
  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Reset the store to a specific state.
   * Useful for testing or recovery scenarios.
   */
  reset(state: IOBridgeState = createInitialState()): void {
    const previousState = this.state
    this.state = state
    if (state !== previousState) {
      this.notifyListeners(previousState)
    }
  }

  private notifyListeners(previousState: IOBridgeState): void {
    for (const listener of this.listeners) {
      try {
        listener(this.state, previousState)
      } catch (error) {
        console.error('[IOBridgeStore] Listener error:', error)
      }
    }
  }
}
