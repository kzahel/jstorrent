import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { IOBridgeStore } from '../io-bridge-store'
import { IOBridgeEffects, createIOBridge } from '../io-bridge-effects'
import {
  MockAdapter,
  createMockDaemonInfo,
  createSuccessProbeResult,
  createFailedProbeResult,
} from '../adapters/mock-adapter'
import type { IOBridgeState } from '../types'

describe('IO Bridge Integration', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Desktop flow', () => {
    it('probes and connects on start', async () => {
      const adapter = new MockAdapter({
        platform: 'desktop',
        probeResult: createSuccessProbeResult(),
      })

      const store = new IOBridgeStore()
      const effects = new IOBridgeEffects(store, adapter)

      effects.start()
      expect(store.getState().name).toBe('PROBING')

      // Wait for probe to complete
      await vi.runAllTimersAsync()

      expect(store.getState().name).toBe('CONNECTED')
      expect(adapter.getProbeCallCount()).toBe(1)

      effects.stop()
    })

    it('shows install prompt when probe fails', async () => {
      const adapter = new MockAdapter({
        platform: 'desktop',
        probeResult: createFailedProbeResult(),
      })

      const store = new IOBridgeStore()
      const effects = new IOBridgeEffects(store, adapter)

      effects.start()
      await vi.runAllTimersAsync()

      expect(store.getState().name).toBe('INSTALL_PROMPT')

      effects.stop()
    })

    it('retries probe on manual retry', async () => {
      const adapter = new MockAdapter({
        platform: 'desktop',
        probeResult: createFailedProbeResult(),
      })

      const store = new IOBridgeStore()
      const effects = new IOBridgeEffects(store, adapter)

      effects.start()
      await vi.runAllTimersAsync()
      expect(store.getState().name).toBe('INSTALL_PROMPT')

      // Update adapter to succeed
      adapter.setProbeResult(createSuccessProbeResult())

      // Trigger retry
      effects.retry()
      expect(store.getState().name).toBe('PROBING')

      await vi.runAllTimersAsync()
      expect(store.getState().name).toBe('CONNECTED')
      expect(adapter.getProbeCallCount()).toBe(2)

      effects.stop()
    })

    it('auto-retries on disconnect', async () => {
      const connectionId = 'test-conn-1'
      const adapter = new MockAdapter({
        platform: 'desktop',
        probeResult: createSuccessProbeResult(connectionId),
        probeDelay: 100, // Add delay to allow checking intermediate state
      })

      const store = new IOBridgeStore()
      const effects = new IOBridgeEffects(store, adapter, {
        autoRetryDelayMs: 1000,
      })

      effects.start()
      // Let probe complete
      await vi.advanceTimersByTimeAsync(150)
      expect(store.getState().name).toBe('CONNECTED')

      // Simulate disconnect
      adapter.simulateDaemonDisconnected(connectionId, true)
      expect(store.getState().name).toBe('DISCONNECTED')

      // Wait for auto-retry delay (but not probe completion)
      await vi.advanceTimersByTimeAsync(1000)
      expect(store.getState().name).toBe('PROBING')

      // Let probe complete
      await vi.advanceTimersByTimeAsync(150)
      expect(store.getState().name).toBe('CONNECTED')

      effects.stop()
    })

    it('does not auto-retry when disabled', async () => {
      const connectionId = 'test-conn-2'
      const adapter = new MockAdapter({
        platform: 'desktop',
        probeResult: createSuccessProbeResult(connectionId),
      })

      const store = new IOBridgeStore()
      const effects = new IOBridgeEffects(store, adapter, {
        autoRetryOnDisconnect: false,
      })

      effects.start()
      await vi.runAllTimersAsync()
      expect(store.getState().name).toBe('CONNECTED')

      // Simulate disconnect
      adapter.simulateDaemonDisconnected(connectionId, false)
      expect(store.getState().name).toBe('DISCONNECTED')

      // Wait and verify no auto-retry
      await vi.advanceTimersByTimeAsync(5000)
      expect(store.getState().name).toBe('DISCONNECTED')

      effects.stop()
    })
  })

  describe('ChromeOS flow', () => {
    it('shows launch prompt when probe fails', async () => {
      const adapter = new MockAdapter({
        platform: 'chromeos',
        probeResult: createFailedProbeResult(),
      })

      const store = new IOBridgeStore()
      const effects = new IOBridgeEffects(store, adapter)

      effects.start()
      await vi.runAllTimersAsync()

      expect(store.getState().name).toBe('LAUNCH_PROMPT')

      effects.stop()
    })

    it('goes to awaiting launch on user launch', async () => {
      const adapter = new MockAdapter({
        platform: 'chromeos',
        probeResult: createFailedProbeResult(),
      })

      const store = new IOBridgeStore()
      const effects = new IOBridgeEffects(store, adapter)

      effects.start()
      await vi.runAllTimersAsync()
      expect(store.getState().name).toBe('LAUNCH_PROMPT')

      effects.userLaunch()
      expect(store.getState().name).toBe('AWAITING_LAUNCH')
      expect(adapter.getLaunchCallCount()).toBe(1)

      effects.stop()
    })

    it('connects when daemon becomes available after launch', async () => {
      const adapter = new MockAdapter({
        platform: 'chromeos',
        probeResult: createFailedProbeResult(),
      })

      const store = new IOBridgeStore()
      const effects = new IOBridgeEffects(store, adapter, {
        launchTimeoutMs: 30000,
      })

      effects.start()
      // Let probe complete
      await vi.advanceTimersByTimeAsync(10)
      expect(store.getState().name).toBe('LAUNCH_PROMPT')

      effects.userLaunch()
      // Let launch trigger (don't run all timers - that would trigger timeout)
      await vi.advanceTimersByTimeAsync(10)
      expect(store.getState().name).toBe('AWAITING_LAUNCH')

      // Simulate daemon coming up
      const daemonInfo = createMockDaemonInfo()
      adapter.simulateDaemonConnected('chromeos-conn-1', daemonInfo)

      const finalState = store.getState()
      expect(finalState.name).toBe('CONNECTED')
      if (finalState.name === 'CONNECTED') {
        expect(finalState.connectionId).toBe('chromeos-conn-1')
      }

      effects.stop()
    })

    it('times out waiting for launch', async () => {
      const adapter = new MockAdapter({
        platform: 'chromeos',
        probeResult: createFailedProbeResult(),
      })

      const store = new IOBridgeStore()
      const effects = new IOBridgeEffects(store, adapter, {
        launchTimeoutMs: 5000,
      })

      effects.start()
      await vi.runAllTimersAsync()

      effects.userLaunch()
      expect(store.getState().name).toBe('AWAITING_LAUNCH')

      // Advance past timeout
      await vi.advanceTimersByTimeAsync(5001)

      expect(store.getState().name).toBe('LAUNCH_FAILED')

      effects.stop()
    })

    it('returns to launch prompt on user cancel', async () => {
      const adapter = new MockAdapter({
        platform: 'chromeos',
        probeResult: createFailedProbeResult(),
      })

      const store = new IOBridgeStore()
      const effects = new IOBridgeEffects(store, adapter)

      effects.start()
      await vi.runAllTimersAsync()

      effects.userLaunch()
      expect(store.getState().name).toBe('AWAITING_LAUNCH')

      effects.userCancel()
      expect(store.getState().name).toBe('LAUNCH_PROMPT')

      effects.stop()
    })

    it('retries after launch failure', async () => {
      const adapter = new MockAdapter({
        platform: 'chromeos',
        probeResult: createFailedProbeResult(),
      })

      const store = new IOBridgeStore()
      const effects = new IOBridgeEffects(store, adapter, {
        launchTimeoutMs: 1000,
      })

      effects.start()
      await vi.runAllTimersAsync()

      effects.userLaunch()
      await vi.advanceTimersByTimeAsync(1001)
      expect(store.getState().name).toBe('LAUNCH_FAILED')

      // Now make probe succeed
      adapter.setProbeResult(createSuccessProbeResult())

      effects.retry()
      await vi.runAllTimersAsync()

      expect(store.getState().name).toBe('CONNECTED')

      effects.stop()
    })
  })

  describe('Store', () => {
    it('notifies listeners on state change', async () => {
      const adapter = new MockAdapter({
        platform: 'desktop',
        probeResult: createSuccessProbeResult(),
      })

      const store = new IOBridgeStore()
      const effects = new IOBridgeEffects(store, adapter)

      const states: IOBridgeState[] = []
      store.subscribe((state) => {
        states.push(state)
      })

      effects.start()
      await vi.runAllTimersAsync()

      expect(states.map((s) => s.name)).toEqual(['PROBING', 'CONNECTED'])

      effects.stop()
    })

    it('allows unsubscribing', async () => {
      const adapter = new MockAdapter({
        platform: 'desktop',
        probeResult: createSuccessProbeResult(),
      })

      const store = new IOBridgeStore()
      const effects = new IOBridgeEffects(store, adapter)

      const states: IOBridgeState[] = []
      const unsub = store.subscribe((state) => {
        states.push(state)
      })

      effects.start()
      expect(states.length).toBe(1) // PROBING

      unsub()
      await vi.runAllTimersAsync()

      // Should not have received CONNECTED
      expect(states.length).toBe(1)

      effects.stop()
    })

    it('reset clears state', () => {
      const store = new IOBridgeStore()

      store.dispatch({
        type: 'START',
        platform: 'desktop',
        history: { attempts: 0, lastAttempt: null, lastError: null },
      })

      expect(store.getState().name).toBe('PROBING')

      store.reset()
      expect(store.getState().name).toBe('INITIALIZING')
    })
  })

  describe('createIOBridge helper', () => {
    it('creates and starts bridge', async () => {
      const adapter = new MockAdapter({
        platform: 'desktop',
        probeResult: createSuccessProbeResult(),
      })

      const { store, stop } = createIOBridge(adapter)

      expect(store.getState().name).toBe('PROBING')
      await vi.runAllTimersAsync()
      expect(store.getState().name).toBe('CONNECTED')

      stop()
      expect(adapter.isDisposed()).toBe(true)
    })
  })

  describe('cleanup', () => {
    it('cleans up launch timeout when state changes', async () => {
      const adapter = new MockAdapter({
        platform: 'chromeos',
        probeResult: createFailedProbeResult(),
      })

      const store = new IOBridgeStore()
      const effects = new IOBridgeEffects(store, adapter, {
        launchTimeoutMs: 10000,
      })

      effects.start()
      // Let probe complete
      await vi.advanceTimersByTimeAsync(10)
      expect(store.getState().name).toBe('LAUNCH_PROMPT')

      effects.userLaunch()
      // Let launch trigger
      await vi.advanceTimersByTimeAsync(10)
      expect(store.getState().name).toBe('AWAITING_LAUNCH')

      // Daemon connects before timeout
      adapter.simulateDaemonConnected('conn-1', createMockDaemonInfo())
      expect(store.getState().name).toBe('CONNECTED')

      // Advance past what would have been the timeout
      await vi.advanceTimersByTimeAsync(15000)

      // Should still be connected (timeout was cancelled)
      expect(store.getState().name).toBe('CONNECTED')

      effects.stop()
    })

    it('cleans up on stop', async () => {
      const connectionId = 'cleanup-test-conn'
      const adapter = new MockAdapter({
        platform: 'desktop',
        probeResult: createSuccessProbeResult(connectionId),
      })

      const store = new IOBridgeStore()
      const effects = new IOBridgeEffects(store, adapter)

      effects.start()
      await vi.runAllTimersAsync()
      expect(store.getState().name).toBe('CONNECTED')

      effects.stop()

      // Simulate disconnect after stop - should not affect state
      const currentState = store.getState()
      adapter.simulateDaemonDisconnected(connectionId, true)
      expect(store.getState()).toBe(currentState)
    })
  })
})
