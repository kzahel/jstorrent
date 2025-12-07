import { describe, it, expect, beforeEach } from 'vitest'
import {
  createInitialState,
  createConnectionHistory,
  recordAttempt,
  transition,
  isConnected,
  isWaitingForUser,
  isConnecting,
  getPlatform,
} from '../io-bridge-state'
import type {
  IOBridgeState,
  StartEvent,
  ProbeSuccessEvent,
  ProbeFailedEvent,
  UserLaunchEvent,
  DaemonConnectedEvent,
  DaemonDisconnectedEvent,
  LaunchTimeoutEvent,
  RetryEvent,
  UserCancelEvent,
  DaemonInfo,
} from '../types'

// =============================================================================
// Test Fixtures
// =============================================================================

const mockDaemonInfo: DaemonInfo = {
  port: 7800,
  token: 'test-token',
  version: 1,
  roots: [
    {
      key: 'default',
      path: '/downloads',
      display_name: 'Downloads',
      removable: false,
      last_stat_ok: true,
      last_checked: Date.now(),
    },
  ],
}

function createStartEvent(platform: 'desktop' | 'chromeos'): StartEvent {
  return {
    type: 'START',
    platform,
    history: createConnectionHistory(),
  }
}

function createProbeSuccessEvent(): ProbeSuccessEvent {
  return {
    type: 'PROBE_SUCCESS',
    connectionId: 'conn-123',
    daemonInfo: mockDaemonInfo,
  }
}

function createProbeFailedEvent(): ProbeFailedEvent {
  return { type: 'PROBE_FAILED' }
}

function createUserLaunchEvent(): UserLaunchEvent {
  return { type: 'USER_LAUNCH' }
}

function createUserCancelEvent(): UserCancelEvent {
  return { type: 'USER_CANCEL' }
}

function createDaemonConnectedEvent(): DaemonConnectedEvent {
  return {
    type: 'DAEMON_CONNECTED',
    connectionId: 'conn-456',
    daemonInfo: mockDaemonInfo,
  }
}

function createDaemonDisconnectedEvent(wasHealthy: boolean = true): DaemonDisconnectedEvent {
  return { type: 'DAEMON_DISCONNECTED', wasHealthy }
}

function createLaunchTimeoutEvent(): LaunchTimeoutEvent {
  return { type: 'LAUNCH_TIMEOUT' }
}

function createRetryEvent(): RetryEvent {
  return { type: 'RETRY' }
}

// =============================================================================
// Tests
// =============================================================================

describe('IO Bridge State Machine', () => {
  describe('createInitialState', () => {
    it('creates INITIALIZING state', () => {
      const state = createInitialState()
      expect(state.name).toBe('INITIALIZING')
    })
  })

  describe('createConnectionHistory', () => {
    it('creates empty history', () => {
      const history = createConnectionHistory()
      expect(history.attempts).toBe(0)
      expect(history.lastAttempt).toBeNull()
      expect(history.lastError).toBeNull()
    })
  })

  describe('recordAttempt', () => {
    it('increments attempts and records timestamp', () => {
      const history = createConnectionHistory()
      const updated = recordAttempt(history, 'test error')

      expect(updated.attempts).toBe(1)
      expect(updated.lastAttempt).toBeTypeOf('number')
      expect(updated.lastError).toBe('test error')
    })

    it('handles null error', () => {
      const history = createConnectionHistory()
      const updated = recordAttempt(history)

      expect(updated.attempts).toBe(1)
      expect(updated.lastError).toBeNull()
    })
  })

  describe('INITIALIZING state', () => {
    let state: IOBridgeState

    beforeEach(() => {
      state = createInitialState()
    })

    it('transitions to PROBING on START (desktop)', () => {
      const next = transition(state, createStartEvent('desktop'))

      expect(next.name).toBe('PROBING')
      if (next.name === 'PROBING') {
        expect(next.platform).toBe('desktop')
      }
    })

    it('transitions to PROBING on START (chromeos)', () => {
      const next = transition(state, createStartEvent('chromeos'))

      expect(next.name).toBe('PROBING')
      if (next.name === 'PROBING') {
        expect(next.platform).toBe('chromeos')
      }
    })

    it('ignores invalid events', () => {
      const next = transition(state, createProbeSuccessEvent())
      expect(next).toBe(state)
    })
  })

  describe('PROBING state', () => {
    describe('desktop platform', () => {
      let state: IOBridgeState

      beforeEach(() => {
        state = transition(createInitialState(), createStartEvent('desktop'))
      })

      it('transitions to CONNECTED on PROBE_SUCCESS', () => {
        const event = createProbeSuccessEvent()
        const next = transition(state, event)

        expect(next.name).toBe('CONNECTED')
        if (next.name === 'CONNECTED') {
          expect(next.platform).toBe('desktop')
          expect(next.connectionId).toBe('conn-123')
          expect(next.daemonInfo).toEqual(mockDaemonInfo)
        }
      })

      it('transitions to INSTALL_PROMPT on PROBE_FAILED', () => {
        const next = transition(state, createProbeFailedEvent())

        expect(next.name).toBe('INSTALL_PROMPT')
        if (next.name === 'INSTALL_PROMPT') {
          expect(next.platform).toBe('desktop')
          expect(next.history.attempts).toBe(1)
        }
      })
    })

    describe('chromeos platform', () => {
      let state: IOBridgeState

      beforeEach(() => {
        state = transition(createInitialState(), createStartEvent('chromeos'))
      })

      it('transitions to CONNECTED on PROBE_SUCCESS', () => {
        const event = createProbeSuccessEvent()
        const next = transition(state, event)

        expect(next.name).toBe('CONNECTED')
        if (next.name === 'CONNECTED') {
          expect(next.platform).toBe('chromeos')
        }
      })

      it('transitions to LAUNCH_PROMPT on PROBE_FAILED', () => {
        const next = transition(state, createProbeFailedEvent())

        expect(next.name).toBe('LAUNCH_PROMPT')
        if (next.name === 'LAUNCH_PROMPT') {
          expect(next.platform).toBe('chromeos')
          expect(next.history.attempts).toBe(1)
        }
      })
    })
  })

  describe('CONNECTED state', () => {
    let state: IOBridgeState

    beforeEach(() => {
      state = transition(createInitialState(), createStartEvent('desktop'))
      state = transition(state, createProbeSuccessEvent())
    })

    it('transitions to DISCONNECTED on DAEMON_DISCONNECTED', () => {
      const next = transition(state, createDaemonDisconnectedEvent(true))

      expect(next.name).toBe('DISCONNECTED')
      if (next.name === 'DISCONNECTED') {
        expect(next.platform).toBe('desktop')
        expect(next.wasHealthy).toBe(true)
      }
    })

    it('preserves wasHealthy=false', () => {
      const next = transition(state, createDaemonDisconnectedEvent(false))

      expect(next.name).toBe('DISCONNECTED')
      if (next.name === 'DISCONNECTED') {
        expect(next.wasHealthy).toBe(false)
      }
    })

    it('ignores invalid events', () => {
      const next = transition(state, createProbeSuccessEvent())
      expect(next).toBe(state)
    })
  })

  describe('DISCONNECTED state', () => {
    let state: IOBridgeState

    beforeEach(() => {
      state = transition(createInitialState(), createStartEvent('desktop'))
      state = transition(state, createProbeSuccessEvent())
      state = transition(state, createDaemonDisconnectedEvent())
    })

    it('transitions to PROBING on RETRY', () => {
      const next = transition(state, createRetryEvent())

      expect(next.name).toBe('PROBING')
      if (next.name === 'PROBING') {
        expect(next.platform).toBe('desktop')
      }
    })

    it('ignores invalid events', () => {
      const next = transition(state, createUserLaunchEvent())
      expect(next).toBe(state)
    })
  })

  describe('INSTALL_PROMPT state (desktop only)', () => {
    let state: IOBridgeState

    beforeEach(() => {
      state = transition(createInitialState(), createStartEvent('desktop'))
      state = transition(state, createProbeFailedEvent())
    })

    it('transitions to PROBING on RETRY', () => {
      const next = transition(state, createRetryEvent())

      expect(next.name).toBe('PROBING')
      if (next.name === 'PROBING') {
        expect(next.platform).toBe('desktop')
      }
    })

    it('ignores USER_LAUNCH event', () => {
      const next = transition(state, createUserLaunchEvent())
      expect(next).toBe(state)
    })
  })

  describe('LAUNCH_PROMPT state (chromeos only)', () => {
    let state: IOBridgeState

    beforeEach(() => {
      state = transition(createInitialState(), createStartEvent('chromeos'))
      state = transition(state, createProbeFailedEvent())
    })

    it('transitions to AWAITING_LAUNCH on USER_LAUNCH', () => {
      const next = transition(state, createUserLaunchEvent())

      expect(next.name).toBe('AWAITING_LAUNCH')
      if (next.name === 'AWAITING_LAUNCH') {
        expect(next.platform).toBe('chromeos')
        expect(next.startedAt).toBeTypeOf('number')
      }
    })

    it('ignores RETRY event', () => {
      const next = transition(state, createRetryEvent())
      expect(next).toBe(state)
    })
  })

  describe('AWAITING_LAUNCH state (chromeos only)', () => {
    let state: IOBridgeState

    beforeEach(() => {
      state = transition(createInitialState(), createStartEvent('chromeos'))
      state = transition(state, createProbeFailedEvent())
      state = transition(state, createUserLaunchEvent())
    })

    it('transitions to CONNECTED on DAEMON_CONNECTED', () => {
      const next = transition(state, createDaemonConnectedEvent())

      expect(next.name).toBe('CONNECTED')
      if (next.name === 'CONNECTED') {
        expect(next.platform).toBe('chromeos')
        expect(next.connectionId).toBe('conn-456')
      }
    })

    it('transitions to LAUNCH_FAILED on LAUNCH_TIMEOUT', () => {
      const next = transition(state, createLaunchTimeoutEvent())

      expect(next.name).toBe('LAUNCH_FAILED')
      if (next.name === 'LAUNCH_FAILED') {
        expect(next.platform).toBe('chromeos')
        expect(next.history.lastError).toBe('launch timeout')
      }
    })

    it('transitions to LAUNCH_PROMPT on USER_CANCEL', () => {
      const next = transition(state, createUserCancelEvent())

      expect(next.name).toBe('LAUNCH_PROMPT')
      if (next.name === 'LAUNCH_PROMPT') {
        expect(next.platform).toBe('chromeos')
      }
    })
  })

  describe('LAUNCH_FAILED state (chromeos only)', () => {
    let state: IOBridgeState

    beforeEach(() => {
      state = transition(createInitialState(), createStartEvent('chromeos'))
      state = transition(state, createProbeFailedEvent())
      state = transition(state, createUserLaunchEvent())
      state = transition(state, createLaunchTimeoutEvent())
    })

    it('transitions to PROBING on RETRY', () => {
      const next = transition(state, createRetryEvent())

      expect(next.name).toBe('PROBING')
      if (next.name === 'PROBING') {
        expect(next.platform).toBe('chromeos')
      }
    })

    it('ignores invalid events', () => {
      const next = transition(state, createUserLaunchEvent())
      expect(next).toBe(state)
    })
  })

  describe('state predicates', () => {
    it('isConnected returns true for CONNECTED state', () => {
      let state: IOBridgeState = transition(createInitialState(), createStartEvent('desktop'))
      state = transition(state, createProbeSuccessEvent())

      expect(isConnected(state)).toBe(true)
      if (isConnected(state)) {
        expect(state.daemonInfo.port).toBe(7800)
      }
    })

    it('isConnected returns false for other states', () => {
      const state = createInitialState()
      expect(isConnected(state)).toBe(false)
    })

    it('isWaitingForUser returns true for prompt states', () => {
      let state: IOBridgeState = transition(createInitialState(), createStartEvent('desktop'))
      state = transition(state, createProbeFailedEvent())

      expect(isWaitingForUser(state)).toBe(true)
    })

    it('isWaitingForUser returns true for LAUNCH_PROMPT', () => {
      let state: IOBridgeState = transition(createInitialState(), createStartEvent('chromeos'))
      state = transition(state, createProbeFailedEvent())

      expect(isWaitingForUser(state)).toBe(true)
    })

    it('isWaitingForUser returns true for LAUNCH_FAILED', () => {
      let state: IOBridgeState = transition(createInitialState(), createStartEvent('chromeos'))
      state = transition(state, createProbeFailedEvent())
      state = transition(state, createUserLaunchEvent())
      state = transition(state, createLaunchTimeoutEvent())

      expect(isWaitingForUser(state)).toBe(true)
    })

    it('isWaitingForUser returns false for CONNECTED', () => {
      let state: IOBridgeState = transition(createInitialState(), createStartEvent('desktop'))
      state = transition(state, createProbeSuccessEvent())

      expect(isWaitingForUser(state)).toBe(false)
    })

    it('isConnecting returns true for PROBING', () => {
      const state = transition(createInitialState(), createStartEvent('desktop'))

      expect(isConnecting(state)).toBe(true)
    })

    it('isConnecting returns true for AWAITING_LAUNCH', () => {
      let state: IOBridgeState = transition(createInitialState(), createStartEvent('chromeos'))
      state = transition(state, createProbeFailedEvent())
      state = transition(state, createUserLaunchEvent())

      expect(isConnecting(state)).toBe(true)
    })

    it('isConnecting returns false for CONNECTED', () => {
      let state: IOBridgeState = transition(createInitialState(), createStartEvent('desktop'))
      state = transition(state, createProbeSuccessEvent())

      expect(isConnecting(state)).toBe(false)
    })

    it('getPlatform returns platform for states that have it', () => {
      const state = transition(createInitialState(), createStartEvent('chromeos'))
      expect(getPlatform(state)).toBe('chromeos')
    })

    it('getPlatform returns null for INITIALIZING', () => {
      const state = createInitialState()
      expect(getPlatform(state)).toBeNull()
    })
  })

  describe('complete flow scenarios', () => {
    it('desktop: happy path from init to connected', () => {
      let state: IOBridgeState = createInitialState()
      expect(state.name).toBe('INITIALIZING')

      state = transition(state, createStartEvent('desktop'))
      expect(state.name).toBe('PROBING')

      state = transition(state, createProbeSuccessEvent())
      expect(state.name).toBe('CONNECTED')
    })

    it('desktop: install prompt flow', () => {
      let state: IOBridgeState = createInitialState()
      state = transition(state, createStartEvent('desktop'))
      state = transition(state, createProbeFailedEvent())
      expect(state.name).toBe('INSTALL_PROMPT')

      state = transition(state, createRetryEvent())
      expect(state.name).toBe('PROBING')

      state = transition(state, createProbeSuccessEvent())
      expect(state.name).toBe('CONNECTED')
    })

    it('chromeos: launch flow with success', () => {
      let state: IOBridgeState = createInitialState()
      state = transition(state, createStartEvent('chromeos'))
      state = transition(state, createProbeFailedEvent())
      expect(state.name).toBe('LAUNCH_PROMPT')

      state = transition(state, createUserLaunchEvent())
      expect(state.name).toBe('AWAITING_LAUNCH')

      state = transition(state, createDaemonConnectedEvent())
      expect(state.name).toBe('CONNECTED')
    })

    it('chromeos: launch flow with timeout and retry', () => {
      let state: IOBridgeState = createInitialState()
      state = transition(state, createStartEvent('chromeos'))
      state = transition(state, createProbeFailedEvent())
      state = transition(state, createUserLaunchEvent())
      state = transition(state, createLaunchTimeoutEvent())
      expect(state.name).toBe('LAUNCH_FAILED')

      state = transition(state, createRetryEvent())
      expect(state.name).toBe('PROBING')
    })

    it('reconnection after disconnect', () => {
      let state: IOBridgeState = createInitialState()
      state = transition(state, createStartEvent('desktop'))
      state = transition(state, createProbeSuccessEvent())
      expect(state.name).toBe('CONNECTED')

      state = transition(state, createDaemonDisconnectedEvent())
      expect(state.name).toBe('DISCONNECTED')

      state = transition(state, createRetryEvent())
      expect(state.name).toBe('PROBING')

      state = transition(state, createProbeSuccessEvent())
      expect(state.name).toBe('CONNECTED')
    })
  })
})
