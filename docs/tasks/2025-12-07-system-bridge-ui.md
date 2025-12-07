# System Bridge UI Implementation

## Overview

Replace the current blocking initialization flow with a non-blocking System Bridge that:
1. Allows the app to function without an active daemon connection
2. Shows connection status via a toolbar indicator
3. Surfaces configuration (connection + download roots) in a unified panel
4. Uses visual urgency (pulsing) instead of modal onboarding

**Key insight:** The IOBridge state machine (from `2025-12-07-io-bridge-state-machine.md`) remains unchanged. This task adds:
- UI layer that renders state as indicator + panel
- Version status computation
- Readiness logic combining connection state + version + storage
- Pulsing behavior when user action is needed

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  UI Layer                                                           │
│  ├── SystemIndicator.tsx (toolbar pill)                             │
│  ├── SystemBridgePanel.tsx (dropdown panel)                         │
│  └── Pulsing logic (CSS animation when action needed)               │
├─────────────────────────────────────────────────────────────────────┤
│  Readiness Computation                                              │
│  ├── version-status.ts (compatible/suggested/required)              │
│  └── readiness.ts (combines state + version + roots)                │
├─────────────────────────────────────────────────────────────────────┤
│  State Machine (existing - from io-bridge-state-machine.md)         │
│  └── IOBridge states, events, transitions (Phases 1-5)              │
├─────────────────────────────────────────────────────────────────────┤
│  Engine Changes                                                     │
│  └── BtEngine already supports suspend/resume - minimal changes     │
└─────────────────────────────────────────────────────────────────────┘
```

## Prerequisites

**Complete Phases 1-5 from `2025-12-07-io-bridge-state-machine.md` first.** Those phases implement:
- Phase 1: Pure state machine + types
- Phase 2: Store + Mock adapter + Effect runner
- Phase 3: Desktop adapter
- Phase 4: ChromeOS adapter  
- Phase 5: Integration + Migration

This document covers **Phases 6-11** which build the UI on top of that foundation.

---

## Phase 6: Version Status

Add version checking to determine if daemon needs updating.

### 6.1 Create version-status.ts

Create `extension/src/lib/io-bridge/version-status.ts`:

```typescript
/**
 * Version compatibility checking for IO Bridge.
 */

export type VersionStatus = 'compatible' | 'update_suggested' | 'update_required'

export interface VersionConfig {
  /** Daemon versions below this cannot work at all */
  minSupported: number
  /** Current extension version - daemon below this should update */
  current: number
}

/**
 * Default version config - update these when releasing breaking changes.
 */
export const VERSION_CONFIG: VersionConfig = {
  minSupported: 1,
  current: 1,
}

/**
 * Determine version compatibility status.
 */
export function getVersionStatus(
  daemonVersion: number | undefined,
  config: VersionConfig = VERSION_CONFIG,
): VersionStatus {
  if (daemonVersion === undefined) {
    // No version info - assume compatible (legacy daemon)
    return 'compatible'
  }

  if (daemonVersion < config.minSupported) {
    return 'update_required'
  }

  if (daemonVersion < config.current) {
    return 'update_suggested'
  }

  return 'compatible'
}

/**
 * Format version for display.
 */
export function formatVersion(version: number | undefined): string {
  if (version === undefined) {
    return 'unknown'
  }
  // For now, versions are simple integers. Could expand to semver later.
  return `v${version}`
}
```

### 6.2 Create version status tests

Create `extension/test/unit/io-bridge/version-status.test.ts`:

```typescript
import { describe, test, expect } from 'vitest'
import {
  getVersionStatus,
  formatVersion,
  VersionConfig,
} from '../../../src/lib/io-bridge/version-status'

describe('version-status', () => {
  const config: VersionConfig = {
    minSupported: 2,
    current: 5,
  }

  describe('getVersionStatus', () => {
    test('undefined version returns compatible (legacy)', () => {
      expect(getVersionStatus(undefined, config)).toBe('compatible')
    })

    test('version below minSupported returns update_required', () => {
      expect(getVersionStatus(1, config)).toBe('update_required')
    })

    test('version at minSupported but below current returns update_suggested', () => {
      expect(getVersionStatus(2, config)).toBe('update_suggested')
      expect(getVersionStatus(4, config)).toBe('update_suggested')
    })

    test('version at or above current returns compatible', () => {
      expect(getVersionStatus(5, config)).toBe('compatible')
      expect(getVersionStatus(6, config)).toBe('compatible')
    })
  })

  describe('formatVersion', () => {
    test('formats undefined as unknown', () => {
      expect(formatVersion(undefined)).toBe('unknown')
    })

    test('formats number with v prefix', () => {
      expect(formatVersion(1)).toBe('v1')
      expect(formatVersion(123)).toBe('v123')
    })
  })
})
```

### 6.3 Update index.ts exports

Add to `extension/src/lib/io-bridge/index.ts`:

```typescript
export {
  getVersionStatus,
  formatVersion,
  VersionStatus,
  VersionConfig,
  VERSION_CONFIG,
} from './version-status'
```

### 6.4 Verification

```bash
cd extension
pnpm test -- version-status
```

---

## Phase 7: Readiness Computation

Combine all prerequisites into a single readiness status for the UI.

### 7.1 Create readiness.ts

Create `extension/src/lib/io-bridge/readiness.ts`:

```typescript
/**
 * Readiness computation for System Bridge UI.
 * Combines IOBridge state + version status + storage roots into a single status.
 */

import type { IOBridgeState } from './io-bridge-state'
import type { VersionStatus } from './version-status'
import type { DownloadRoot } from './types'

export type ReadinessIssue =
  | 'not_connected'
  | 'update_required'
  | 'no_root'

export type IndicatorColor = 'green' | 'yellow' | 'red'

export interface ReadinessStatus {
  /** Whether downloads can proceed */
  ready: boolean

  /** Indicator appearance */
  indicator: {
    label: string
    color: IndicatorColor
  }

  /** What's blocking readiness (if not ready) */
  issues: ReadinessIssue[]

  /** Whether to show update suggestion (non-blocking) */
  canSuggestUpdate: boolean

  /** Whether indicator should pulse (needs user attention) */
  pulse: boolean
}

/**
 * Compute readiness status from component states.
 */
export function getReadiness(
  state: IOBridgeState,
  versionStatus: VersionStatus,
  roots: DownloadRoot[],
  hasPendingTorrents: boolean,
): ReadinessStatus {
  const issues: ReadinessIssue[] = []

  // Check connection
  const isConnected = state.type === 'CONNECTED'
  if (!isConnected) {
    issues.push('not_connected')
  }

  // Check version (only relevant if connected)
  if (isConnected && versionStatus === 'update_required') {
    issues.push('update_required')
  }

  // Check roots (only relevant if connected)
  const hasRoot = roots.length > 0
  if (isConnected && !hasRoot) {
    issues.push('no_root')
  }

  const ready = issues.length === 0
  const canSuggestUpdate = isConnected && versionStatus === 'update_suggested'

  // Determine indicator
  const indicator = computeIndicator(state, versionStatus, hasRoot, canSuggestUpdate)

  // Pulse when action needed AND torrents waiting
  const pulse = !ready && hasPendingTorrents

  return {
    ready,
    indicator,
    issues,
    canSuggestUpdate,
    pulse,
  }
}

function computeIndicator(
  state: IOBridgeState,
  versionStatus: VersionStatus,
  hasRoot: boolean,
  canSuggestUpdate: boolean,
): { label: string; color: IndicatorColor } {
  // Not connected states
  if (state.type === 'INITIALIZING') {
    return { label: 'Starting...', color: 'yellow' }
  }

  if (state.type === 'PROBING') {
    return { label: 'Connecting...', color: 'yellow' }
  }

  if (state.type === 'INSTALL_PROMPT') {
    return { label: 'Setup', color: 'yellow' }
  }

  if (state.type === 'LAUNCH_PROMPT') {
    return { label: 'Setup', color: 'yellow' }
  }

  if (state.type === 'AWAITING_LAUNCH') {
    return { label: 'Waiting...', color: 'yellow' }
  }

  if (state.type === 'LAUNCH_FAILED') {
    return { label: 'Failed', color: 'red' }
  }

  if (state.type === 'DISCONNECTED') {
    return { label: 'Offline', color: 'red' }
  }

  // Connected but version incompatible
  if (state.type === 'CONNECTED' && versionStatus === 'update_required') {
    return { label: 'Update Required', color: 'red' }
  }

  // Connected but no download root
  if (state.type === 'CONNECTED' && !hasRoot) {
    return { label: 'Setup', color: 'yellow' }
  }

  // Connected, compatible, has root - but update available
  if (state.type === 'CONNECTED' && canSuggestUpdate) {
    return { label: 'Update Available', color: 'green' }
  }

  // All good
  if (state.type === 'CONNECTED') {
    return { label: 'Ready', color: 'green' }
  }

  // Fallback
  return { label: 'Unknown', color: 'yellow' }
}
```

### 7.2 Create readiness tests

Create `extension/test/unit/io-bridge/readiness.test.ts`:

```typescript
import { describe, test, expect } from 'vitest'
import { getReadiness } from '../../../src/lib/io-bridge/readiness'
import type { IOBridgeState } from '../../../src/lib/io-bridge/io-bridge-state'
import type { DaemonInfo, DownloadRoot } from '../../../src/lib/io-bridge/types'

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
        type: 'DISCONNECTED',
        platform: 'desktop',
        history: 'previously',
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
        type: 'CONNECTED',
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
        type: 'CONNECTED',
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
        type: 'CONNECTED',
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
        type: 'CONNECTED',
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
        type: 'DISCONNECTED',
        platform: 'desktop',
        history: 'previously',
        wasHealthy: true,
      }

      const withPending = getReadiness(state, 'compatible', [mockRoot], true)
      expect(withPending.pulse).toBe(true)

      const withoutPending = getReadiness(state, 'compatible', [mockRoot], false)
      expect(withoutPending.pulse).toBe(false)
    })

    test('does not pulse when ready even with pending torrents', () => {
      const state: IOBridgeState = {
        type: 'CONNECTED',
        platform: 'desktop',
        connectionId: '123',
        daemonInfo: mockDaemonInfo,
      }

      const result = getReadiness(state, 'compatible', [mockRoot], true)
      expect(result.pulse).toBe(false)
    })
  })
})
```

### 7.3 Update index.ts exports

Add to `extension/src/lib/io-bridge/index.ts`:

```typescript
export {
  getReadiness,
  ReadinessStatus,
  ReadinessIssue,
  IndicatorColor,
} from './readiness'
```

### 7.4 Verification

```bash
cd extension
pnpm test -- readiness
```

---

## Phase 8: System Indicator Component

Create the toolbar indicator that shows readiness status.

### 8.1 Create SystemIndicator.tsx

Create `packages/client/src/components/SystemIndicator.tsx`:

```typescript
import React from 'react'

export interface SystemIndicatorProps {
  label: string
  color: 'green' | 'yellow' | 'red'
  pulse: boolean
  onClick: () => void
}

const colorMap = {
  green: {
    bg: 'var(--accent-success, #22c55e)',
    text: 'white',
  },
  yellow: {
    bg: 'var(--accent-warning, #eab308)',
    text: 'black',
  },
  red: {
    bg: 'var(--accent-error, #ef4444)',
    text: 'white',
  },
}

export function SystemIndicator({ label, color, pulse, onClick }: SystemIndicatorProps) {
  const colors = colorMap[color]

  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '4px 10px',
        border: 'none',
        borderRadius: '12px',
        background: colors.bg,
        color: colors.text,
        fontSize: '12px',
        fontWeight: 500,
        cursor: 'pointer',
        animation: pulse ? 'pulse 2s ease-in-out infinite' : undefined,
      }}
    >
      <span
        style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          background: colors.text,
          opacity: 0.8,
        }}
      />
      {label}
      <span style={{ opacity: 0.6 }}>▾</span>
    </button>
  )
}

// Add CSS animation via style tag (or move to CSS file)
const styleId = 'system-indicator-styles'
if (typeof document !== 'undefined' && !document.getElementById(styleId)) {
  const style = document.createElement('style')
  style.id = styleId
  style.textContent = `
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.8; transform: scale(1.02); }
    }
  `
  document.head.appendChild(style)
}
```

### 8.2 Update packages/client/src/index.ts exports

Add export:

```typescript
export { SystemIndicator, type SystemIndicatorProps } from './components/SystemIndicator'
```

### 8.3 Verification

Visual check - component renders correctly with different props. Add to App.tsx header temporarily:

```typescript
<SystemIndicator
  label="Ready"
  color="green"
  pulse={false}
  onClick={() => console.log('clicked')}
/>
```

---

## Phase 9: System Bridge Panel Component

Create the panel that shows connection and storage details.

### 9.1 Create SystemBridgePanel.tsx

Create `packages/client/src/components/SystemBridgePanel.tsx`:

```typescript
import React from 'react'
import type { IOBridgeState } from '@jstorrent/engine' // Will need to export from io-bridge
import type { VersionStatus } from '@jstorrent/engine'
import type { DownloadRoot } from '@jstorrent/engine'

export interface SystemBridgePanelProps {
  state: IOBridgeState
  versionStatus: VersionStatus
  daemonVersion: number | undefined
  roots: DownloadRoot[]
  defaultRootKey: string | null
  onClose: () => void
  onRetry: () => void
  onLaunch: () => void
  onCancel: () => void
  onDisconnect: () => void
  onAddFolder: () => void
  onSetDefaultRoot: (key: string) => void
  onCopyDebugInfo: () => void
}

export function SystemBridgePanel({
  state,
  versionStatus,
  daemonVersion,
  roots,
  defaultRootKey,
  onClose,
  onRetry,
  onLaunch,
  onCancel,
  onDisconnect,
  onAddFolder,
  onSetDefaultRoot,
  onCopyDebugInfo,
}: SystemBridgePanelProps) {
  return (
    <div
      style={{
        position: 'absolute',
        top: '100%',
        right: 0,
        marginTop: '4px',
        width: '320px',
        background: 'var(--bg-primary, white)',
        border: '1px solid var(--border-color, #e5e7eb)',
        borderRadius: '8px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        zIndex: 1000,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '12px 16px',
          borderBottom: '1px solid var(--border-color, #e5e7eb)',
        }}
      >
        <span style={{ fontWeight: 600, fontSize: '14px' }}>System Bridge</span>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: '18px',
            lineHeight: 1,
            padding: '4px',
            color: 'var(--text-secondary)',
          }}
        >
          ×
        </button>
      </div>

      {/* Content */}
      <div style={{ padding: '16px' }}>
        {renderContent()}
      </div>

      {/* Footer */}
      <div
        style={{
          padding: '12px 16px',
          borderTop: '1px solid var(--border-color, #e5e7eb)',
          display: 'flex',
          gap: '8px',
        }}
      >
        {renderActions()}
      </div>
    </div>
  )

  function renderContent() {
    switch (state.type) {
      case 'INITIALIZING':
      case 'PROBING':
        return (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ marginBottom: '8px' }}>Connecting...</div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
              Looking for companion app
            </div>
          </div>
        )

      case 'INSTALL_PROMPT':
        return (
          <div>
            <div style={{ marginBottom: '12px', fontWeight: 500 }}>
              Companion App Required
            </div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '16px' }}>
              JSTorrent needs a companion app to handle downloads.
              {state.history === 'never' && (
                <> Download and install it to get started.</>
              )}
            </div>
          </div>
        )

      case 'LAUNCH_PROMPT':
        return (
          <div>
            <div style={{ marginBottom: '12px', fontWeight: 500 }}>
              Launch Companion App
            </div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '16px' }}>
              {state.history === 'never' ? (
                <>Install the JSTorrent Companion app from the Play Store, then click Launch.</>
              ) : (
                <>Click Launch to start the companion app.</>
              )}
            </div>
          </div>
        )

      case 'AWAITING_LAUNCH':
        return (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ marginBottom: '8px' }}>Waiting for app...</div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
              Approve the dialog to continue
            </div>
          </div>
        )

      case 'LAUNCH_FAILED':
        return (
          <div>
            <div style={{ marginBottom: '12px', fontWeight: 500, color: 'var(--accent-error)' }}>
              Launch Timed Out
            </div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '16px' }}>
              The companion app didn't respond. Make sure it's installed and try again.
            </div>
          </div>
        )

      case 'DISCONNECTED':
        return (
          <div>
            <div style={{ marginBottom: '12px', fontWeight: 500 }}>
              Disconnected
            </div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '16px' }}>
              Connection to companion app was lost.
              {state.wasHealthy && ' This may be temporary.'}
            </div>
          </div>
        )

      case 'CONNECTED':
        return renderConnectedContent()
    }
  }

  function renderConnectedContent() {
    if (state.type !== 'CONNECTED') return null

    const { daemonInfo } = state

    // Show update required prominently
    if (versionStatus === 'update_required') {
      return (
        <div>
          <div
            style={{
              padding: '12px',
              background: 'var(--accent-error-bg, #fef2f2)',
              borderRadius: '6px',
              marginBottom: '16px',
            }}
          >
            <div style={{ fontWeight: 500, color: 'var(--accent-error)', marginBottom: '4px' }}>
              Update Required
            </div>
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              The companion app (v{daemonVersion ?? '?'}) is too old. Please download the latest version.
            </div>
          </div>
        </div>
      )
    }

    return (
      <>
        {/* Connection info */}
        <div style={{ marginBottom: '16px' }}>
          <div style={{ fontWeight: 500, marginBottom: '8px' }}>Companion App</div>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            <div>● Connected — v{daemonVersion ?? '?'}</div>
            <div style={{ marginTop: '4px' }}>
              {daemonInfo.host ?? '127.0.0.1'}:{daemonInfo.port}
            </div>
          </div>

          {versionStatus === 'update_suggested' && (
            <div
              style={{
                marginTop: '8px',
                padding: '8px',
                background: 'var(--accent-info-bg, #eff6ff)',
                borderRadius: '4px',
                fontSize: '13px',
              }}
            >
              ℹ️ Update available
            </div>
          )}
        </div>

        {/* Download locations */}
        <div>
          <div style={{ fontWeight: 500, marginBottom: '8px' }}>Download Locations</div>
          {roots.length === 0 ? (
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              No download folder configured. Click "Add Folder" to get started.
            </div>
          ) : (
            <div style={{ fontSize: '13px' }}>
              {roots.map((root) => (
                <label
                  key={root.key}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '6px 0',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="radio"
                    name="defaultRoot"
                    checked={root.key === defaultRootKey}
                    onChange={() => onSetDefaultRoot(root.key)}
                  />
                  <span style={{ flex: 1 }}>{root.display_name}</span>
                </label>
              ))}
            </div>
          )}
          <button
            onClick={onAddFolder}
            style={{
              marginTop: '8px',
              padding: '6px 12px',
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            Add Folder...
          </button>
        </div>
      </>
    )
  }

  function renderActions() {
    switch (state.type) {
      case 'INSTALL_PROMPT':
        return (
          <>
            <a
              href="https://jstorrent.com/download"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                padding: '6px 12px',
                background: 'var(--accent-primary)',
                color: 'white',
                textDecoration: 'none',
                borderRadius: '4px',
                fontSize: '13px',
              }}
            >
              Download
            </a>
            <button onClick={onRetry} style={{ padding: '6px 12px', fontSize: '13px' }}>
              I've Installed It
            </button>
          </>
        )

      case 'LAUNCH_PROMPT':
        return (
          <>
            <button
              onClick={onLaunch}
              style={{
                padding: '6px 12px',
                background: 'var(--accent-primary)',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              Launch App
            </button>
            {state.history === 'never' && (
              <a
                href="https://play.google.com/store/apps/details?id=com.jstorrent.app"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  padding: '6px 12px',
                  fontSize: '13px',
                  textDecoration: 'none',
                  color: 'var(--text-secondary)',
                }}
              >
                Install
              </a>
            )}
          </>
        )

      case 'AWAITING_LAUNCH':
        return (
          <button onClick={onCancel} style={{ padding: '6px 12px', fontSize: '13px' }}>
            Cancel
          </button>
        )

      case 'LAUNCH_FAILED':
      case 'DISCONNECTED':
        return (
          <button
            onClick={onRetry}
            style={{
              padding: '6px 12px',
              background: 'var(--accent-primary)',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            Try Again
          </button>
        )

      case 'CONNECTED':
        return (
          <>
            <button onClick={onDisconnect} style={{ padding: '6px 12px', fontSize: '13px' }}>
              Disconnect
            </button>
            <button
              onClick={onCopyDebugInfo}
              style={{ padding: '6px 12px', fontSize: '13px', marginLeft: 'auto' }}
            >
              Copy Debug Info
            </button>
          </>
        )

      default:
        return null
    }
  }
}
```

### 9.2 Update exports

Add to `packages/client/src/index.ts`:

```typescript
export { SystemBridgePanel, type SystemBridgePanelProps } from './components/SystemBridgePanel'
```

### 9.3 Verification

Visual check - panel renders correctly for each state. Wire up temporarily in App.tsx.

---

## Phase 10: Wire into App

Integrate System Bridge indicator and panel into the main application.

### 10.1 Create useSystemBridge hook

Create `packages/client/src/hooks/useSystemBridge.ts`:

```typescript
import { useState, useEffect, useCallback, useMemo } from 'react'
import type { IOBridgeState } from '../../../extension/src/lib/io-bridge/io-bridge-state'
import type { IOBridgeStore } from '../../../extension/src/lib/io-bridge/io-bridge-store'
import type { IOBridgeEffects } from '../../../extension/src/lib/io-bridge/io-bridge-effects'
import { getVersionStatus, VersionStatus } from '../../../extension/src/lib/io-bridge/version-status'
import { getReadiness, ReadinessStatus } from '../../../extension/src/lib/io-bridge/readiness'
import type { DownloadRoot } from '../../../extension/src/lib/io-bridge/types'

export interface UseSystemBridgeResult {
  state: IOBridgeState
  readiness: ReadinessStatus
  versionStatus: VersionStatus
  daemonVersion: number | undefined
  roots: DownloadRoot[]
  defaultRootKey: string | null
  
  // Actions
  retry: () => void
  launch: () => void
  cancel: () => void
  disconnect: () => void
  copyDebugInfo: () => Promise<void>
}

export function useSystemBridge(
  store: IOBridgeStore,
  effects: IOBridgeEffects,
  hasPendingTorrents: boolean,
): UseSystemBridgeResult {
  const [state, setState] = useState<IOBridgeState>(store.getState())
  const [roots, setRoots] = useState<DownloadRoot[]>([])
  const [defaultRootKey, setDefaultRootKey] = useState<string | null>(null)

  // Subscribe to state changes
  useEffect(() => {
    const unsubscribe = store.subscribe((newState) => {
      setState(newState)
      
      // Update roots when connected
      if (newState.type === 'CONNECTED') {
        setRoots(newState.daemonInfo.roots)
      }
    })
    return unsubscribe
  }, [store])

  // Compute derived values
  const daemonVersion = state.type === 'CONNECTED' ? state.daemonInfo.version : undefined
  const versionStatus = useMemo(() => getVersionStatus(daemonVersion), [daemonVersion])
  
  const readiness = useMemo(
    () => getReadiness(state, versionStatus, roots, hasPendingTorrents),
    [state, versionStatus, roots, hasPendingTorrents],
  )

  // Actions
  const retry = useCallback(() => effects.userClickedRetry(), [effects])
  const launch = useCallback(() => effects.userClickedLaunch(), [effects])
  const cancel = useCallback(() => effects.userClickedCancel(), [effects])
  const disconnect = useCallback(() => {
    // TODO: Implement disconnect in effects
    console.log('disconnect not implemented')
  }, [])

  const copyDebugInfo = useCallback(async () => {
    const info = {
      state: state.type,
      platform: 'platform' in state ? state.platform : 'unknown',
      version: daemonVersion,
      versionStatus,
      ready: readiness.ready,
      issues: readiness.issues,
      roots: roots.length,
    }
    const text = `JSTorrent Debug Info\n${JSON.stringify(info, null, 2)}`
    await navigator.clipboard.writeText(text)
  }, [state, daemonVersion, versionStatus, readiness, roots])

  return {
    state,
    readiness,
    versionStatus,
    daemonVersion,
    roots,
    defaultRootKey,
    retry,
    launch,
    cancel,
    disconnect,
    copyDebugInfo,
  }
}
```

### 10.2 Update App.tsx header

In `packages/client/src/App.tsx`, update the header section to include the System Bridge indicator:

Find this section in the header:
```typescript
<div style={{ marginLeft: 'auto', color: 'var(--text-secondary)', fontSize: '12px' }}>
  {torrents.length} torrents | {numConnections} peers | ↓{' '}
  {formatBytes(globalStats.totalDownloadRate)}/s | ↑{' '}
  {formatBytes(globalStats.totalUploadRate)}/s
</div>
```

Add the System Bridge indicator before this div (implementation depends on how IOBridge store/effects are passed down - this is a sketch):

```typescript
{/* System Bridge indicator */}
<div style={{ position: 'relative' }}>
  <SystemIndicator
    label={readiness.indicator.label}
    color={readiness.indicator.color}
    pulse={readiness.pulse}
    onClick={() => setPanelOpen(!panelOpen)}
  />
  {panelOpen && (
    <SystemBridgePanel
      state={bridgeState}
      versionStatus={versionStatus}
      daemonVersion={daemonVersion}
      roots={roots}
      defaultRootKey={defaultRootKey}
      onClose={() => setPanelOpen(false)}
      onRetry={retry}
      onLaunch={launch}
      onCancel={cancel}
      onDisconnect={disconnect}
      onAddFolder={handleAddFolder}
      onSetDefaultRoot={handleSetDefaultRoot}
      onCopyDebugInfo={copyDebugInfo}
    />
  )}
</div>

<div style={{ marginLeft: 'auto', /* ... */ }}>
  {/* existing stats */}
</div>
```

### 10.3 Verification

**🔴 CHECKPOINT: Manual verification**

1. Load extension with daemon not running
   - Indicator shows yellow "Setup" (or "Offline" if previously connected)
   - Clicking opens panel with appropriate content

2. Start daemon, connect
   - Indicator transitions to green "Ready"
   - Panel shows connection info and roots

3. Add a torrent while disconnected
   - Indicator pulses
   - Torrent shows "waiting..." status

4. Configure download root
   - Panel shows root list
   - Can set default root

---

## Phase 11: Polish

Final touches and edge cases.

### 11.1 Click-outside to close panel

Add click-outside handling to SystemBridgePanel or wrap in a Portal component.

### 11.2 Keyboard navigation

- Escape to close panel
- Tab through panel controls

### 11.3 Responsive positioning

Panel should not overflow viewport - position dynamically based on available space.

### 11.4 Loading states

Add subtle loading indicators during PROBING and other async states.

### 11.5 Error messages

Surface connection errors more prominently (e.g., "Native host not found", "Permission denied").

---

## File Summary

### New Files (Phases 6-11)

```
extension/src/lib/io-bridge/
├── version-status.ts           ← Version compatibility
└── readiness.ts                ← Combined readiness computation

extension/test/unit/io-bridge/
├── version-status.test.ts      ← Version tests
└── readiness.test.ts           ← Readiness tests

packages/client/src/components/
├── SystemIndicator.tsx         ← Toolbar indicator
└── SystemBridgePanel.tsx       ← Dropdown panel

packages/client/src/hooks/
└── useSystemBridge.ts          ← React hook for bridge state
```

### Modified Files

```
extension/src/lib/io-bridge/index.ts   ← Add exports
packages/client/src/index.ts           ← Add exports
packages/client/src/App.tsx            ← Integrate indicator/panel
```

---

## Testing Commands

```bash
# Run all new tests
cd extension
pnpm test -- version-status readiness

# Full extension test suite
pnpm test

# Manual testing
pnpm dev
# Load extension, test indicator/panel in various states
```

---

## Design Decisions

### Why no modal onboarding?

The previous design used a modal for first-time setup. This design uses visual urgency (pulsing indicator) instead because:
1. Modal blocks interaction - can't even browse existing torrents
2. Pulsing is visible but non-blocking
3. Same panel component works for both onboarding and ongoing management
4. Users learn through interaction, not interruption

### Why combine connection + storage in one panel?

Both are prerequisites for downloading. A user asking "why isn't my torrent downloading?" gets the full answer in one place. The panel can be expanded with tabs later if needed.

### Why "System Bridge" naming?

- "IO Bridge" is implementation jargon
- "System" is familiar from OS patterns
- "Bridge" hints at the architecture (browser ↔ native)
- Together they're descriptive without being too technical

---

## Future Considerations

### Tabs in panel

If the panel gets too busy, add tabs:
- Status (connection info)
- Storage (download roots)
- Logs (debug output)

### Multiple roots per torrent

Currently each torrent goes to the default root. Future: per-torrent root selection via context menu.

### Auto-reconnect

Currently requires user action to reconnect. Future: auto-reconnect after brief disconnect with exponential backoff.
