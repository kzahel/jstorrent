import { describe, test, expect } from 'vitest'
import { getReadiness, isFirstTimeUser } from '../readiness'
import type { IOBridgeState, ConnectionHistory } from '../types'
import type { DaemonInfo, DownloadRoot } from '../../native-connection'

const mockHistory: ConnectionHistory = {
  attempts: 0,
  lastAttempt: null,
  lastError: null,
}

const mockDaemonInfo: DaemonInfo = {
  port: 7800,
  token: 'test',
  roots: [],
}

const mockRoot: DownloadRoot = {
  key: 'default',
  path: '/downloads',
  display_name: 'Downloads',
  removable: false,
  last_stat_ok: true,
  last_checked: Date.now(),
}

describe('readiness', () => {
  describe('getReadiness', () => {
    test('not connected returns not ready', () => {
      const state: IOBridgeState = {
        name: 'DISCONNECTED',
        platform: 'desktop',
        history: mockHistory,
        wasHealthy: true,
      }

      const result = getReadiness(state, 'compatible', [mockRoot], false)

      expect(result.ready).toBe(false)
      expect(result.issues).toContain('not_connected')
      expect(result.indicator.color).toBe('red')
      expect(result.indicator.label).toBe('Offline')
    })

    test('connected with update_required returns not ready', () => {
      const state: IOBridgeState = {
        name: 'CONNECTED',
        platform: 'desktop',
        connectionId: '123',
        daemonInfo: mockDaemonInfo,
      }

      const result = getReadiness(state, 'update_required', [mockRoot], false)

      expect(result.ready).toBe(false)
      expect(result.issues).toContain('update_required')
      expect(result.indicator.label).toBe('Update Required')
      expect(result.indicator.color).toBe('red')
    })

    test('connected with no roots returns not ready', () => {
      const state: IOBridgeState = {
        name: 'CONNECTED',
        platform: 'desktop',
        connectionId: '123',
        daemonInfo: mockDaemonInfo,
      }

      const result = getReadiness(state, 'compatible', [], false)

      expect(result.ready).toBe(false)
      expect(result.issues).toContain('no_root')
      expect(result.indicator.label).toBe('Setup')
      expect(result.indicator.color).toBe('yellow')
    })

    test('connected + compatible + has roots = ready', () => {
      const state: IOBridgeState = {
        name: 'CONNECTED',
        platform: 'desktop',
        connectionId: '123',
        daemonInfo: mockDaemonInfo,
      }

      const result = getReadiness(state, 'compatible', [mockRoot], false)

      expect(result.ready).toBe(true)
      expect(result.issues).toHaveLength(0)
      expect(result.indicator.label).toBe('Ready')
      expect(result.indicator.color).toBe('green')
    })

    test('update_suggested shows update available but still ready', () => {
      const state: IOBridgeState = {
        name: 'CONNECTED',
        platform: 'desktop',
        connectionId: '123',
        daemonInfo: mockDaemonInfo,
      }

      const result = getReadiness(state, 'update_suggested', [mockRoot], false)

      expect(result.ready).toBe(true)
      expect(result.canSuggestUpdate).toBe(true)
      expect(result.indicator.label).toBe('Update Available')
      expect(result.indicator.color).toBe('green')
    })

    test('pulses when not ready AND has pending torrents', () => {
      const state: IOBridgeState = {
        name: 'DISCONNECTED',
        platform: 'desktop',
        history: mockHistory,
        wasHealthy: true,
      }

      const withPending = getReadiness(state, 'compatible', [mockRoot], true)
      expect(withPending.pulse).toBe(true)

      const withoutPending = getReadiness(state, 'compatible', [mockRoot], false)
      expect(withoutPending.pulse).toBe(false)
    })

    test('does not pulse when ready even with pending torrents', () => {
      const state: IOBridgeState = {
        name: 'CONNECTED',
        platform: 'desktop',
        connectionId: '123',
        daemonInfo: mockDaemonInfo,
      }

      const result = getReadiness(state, 'compatible', [mockRoot], true)
      expect(result.pulse).toBe(false)
    })

    test('INITIALIZING state shows Starting...', () => {
      const state: IOBridgeState = { name: 'INITIALIZING' }

      const result = getReadiness(state, 'compatible', [], false)

      expect(result.indicator.label).toBe('Starting...')
      expect(result.indicator.color).toBe('yellow')
    })

    test('PROBING state shows Connecting...', () => {
      const state: IOBridgeState = {
        name: 'PROBING',
        platform: 'desktop',
        history: mockHistory,
      }

      const result = getReadiness(state, 'compatible', [], false)

      expect(result.indicator.label).toBe('Connecting...')
      expect(result.indicator.color).toBe('yellow')
    })

    test('INSTALL_PROMPT state shows Setup', () => {
      const state: IOBridgeState = {
        name: 'INSTALL_PROMPT',
        platform: 'desktop',
        history: mockHistory,
      }

      const result = getReadiness(state, 'compatible', [], false)

      expect(result.indicator.label).toBe('Setup')
      expect(result.indicator.color).toBe('yellow')
    })

    test('LAUNCH_PROMPT state shows Setup', () => {
      const state: IOBridgeState = {
        name: 'LAUNCH_PROMPT',
        platform: 'chromeos',
        history: mockHistory,
      }

      const result = getReadiness(state, 'compatible', [], false)

      expect(result.indicator.label).toBe('Setup')
      expect(result.indicator.color).toBe('yellow')
    })

    test('AWAITING_LAUNCH state shows Waiting...', () => {
      const state: IOBridgeState = {
        name: 'AWAITING_LAUNCH',
        platform: 'chromeos',
        history: mockHistory,
        startedAt: Date.now(),
      }

      const result = getReadiness(state, 'compatible', [], false)

      expect(result.indicator.label).toBe('Waiting...')
      expect(result.indicator.color).toBe('yellow')
    })

    test('LAUNCH_FAILED state shows Failed', () => {
      const state: IOBridgeState = {
        name: 'LAUNCH_FAILED',
        platform: 'chromeos',
        history: mockHistory,
      }

      const result = getReadiness(state, 'compatible', [], false)

      expect(result.indicator.label).toBe('Failed')
      expect(result.indicator.color).toBe('red')
    })
  })

  describe('isFirstTimeUser', () => {
    test('returns true for state with no previous attempts', () => {
      const state: IOBridgeState = {
        name: 'INSTALL_PROMPT',
        platform: 'desktop',
        history: { attempts: 0, lastAttempt: null, lastError: null },
      }
      expect(isFirstTimeUser(state)).toBe(true)
    })

    test('returns false for state with previous attempts', () => {
      const state: IOBridgeState = {
        name: 'INSTALL_PROMPT',
        platform: 'desktop',
        history: { attempts: 1, lastAttempt: Date.now(), lastError: null },
      }
      expect(isFirstTimeUser(state)).toBe(false)
    })

    test('returns true for INITIALIZING state (no history)', () => {
      const state: IOBridgeState = { name: 'INITIALIZING' }
      expect(isFirstTimeUser(state)).toBe(true)
    })
  })
})
