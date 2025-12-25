/**
 * ConfigValue<T> Interface
 *
 * A reactive wrapper for configuration values that supports:
 * - Synchronous reads from cache
 * - Lazy getter for deferred evaluation
 * - Subscription to changes
 */

import type { Unsubscribe } from './types'

/**
 * Callback for ConfigValue changes.
 * @param value - The new value
 * @param oldValue - The previous value
 */
export type ConfigValueCallback<T> = (value: T, oldValue: T) => void

/**
 * Reactive configuration value wrapper.
 *
 * All ConfigValue implementations read from an in-memory cache,
 * making get() always synchronous. The cache is updated before
 * subscribers are notified.
 */
export interface ConfigValue<T> {
  /**
   * Get current value (synchronous read from cache).
   */
  get(): T

  /**
   * Get a callback-based getter for lazy evaluation.
   * The returned function always reads the current value when called.
   *
   * Useful for passing to components that should read the latest value
   * at execution time rather than capturing a stale closure.
   */
  getLazy(): () => T

  /**
   * Subscribe to value changes.
   *
   * Callback is invoked synchronously after cache update but potentially
   * before persistence completes. Callback receives both new and old values.
   *
   * @returns Unsubscribe function
   */
  subscribe(callback: ConfigValueCallback<T>): Unsubscribe
}
