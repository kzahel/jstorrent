/**
 * IO Bridge State Machine
 *
 * Pure state machine implementation with no side effects.
 * All transitions are deterministic and testable.
 */

import type {
  IOBridgeState,
  IOBridgeEvent,
  InitializingState,
  ProbingState,
  ConnectedState,
  DisconnectedState,
  InstallPromptState,
  LaunchPromptState,
  AwaitingLaunchState,
  LaunchFailedState,
  ConnectionHistory,
  Platform,
} from './types'

// =============================================================================
// Initial State
// =============================================================================

/**
 * Create the initial state.
 */
export function createInitialState(): InitializingState {
  return { name: 'INITIALIZING' }
}

/**
 * Create a fresh connection history.
 */
export function createConnectionHistory(): ConnectionHistory {
  return {
    attempts: 0,
    lastAttempt: null,
    lastError: null,
    consecutiveFailures: 0,
  }
}

/**
 * Update history after an attempt.
 */
export function recordAttempt(
  history: ConnectionHistory,
  error: string | null = null,
): ConnectionHistory {
  return {
    attempts: history.attempts + 1,
    lastAttempt: Date.now(),
    lastError: error,
    consecutiveFailures: error ? history.consecutiveFailures + 1 : 0,
  }
}

/**
 * Reset consecutive failures (on successful connection).
 */
export function resetFailures(history: ConnectionHistory): ConnectionHistory {
  return {
    ...history,
    consecutiveFailures: 0,
    lastError: null,
  }
}

// =============================================================================
// State Transition Function
// =============================================================================

/**
 * Pure state transition function.
 *
 * Given a current state and an event, returns the next state.
 * Returns the same state reference if the transition is not valid.
 */
export function transition(state: IOBridgeState, event: IOBridgeEvent): IOBridgeState {
  switch (state.name) {
    case 'INITIALIZING':
      return handleInitializing(state, event)

    case 'PROBING':
      return handleProbing(state, event)

    case 'CONNECTED':
      return handleConnected(state, event)

    case 'DISCONNECTED':
      return handleDisconnected(state, event)

    case 'INSTALL_PROMPT':
      return handleInstallPrompt(state, event)

    case 'LAUNCH_PROMPT':
      return handleLaunchPrompt(state, event)

    case 'AWAITING_LAUNCH':
      return handleAwaitingLaunch(state, event)

    case 'LAUNCH_FAILED':
      return handleLaunchFailed(state, event)

    default:
      return state
  }
}

// =============================================================================
// State Handlers
// =============================================================================

function handleInitializing(state: InitializingState, event: IOBridgeEvent): IOBridgeState {
  if (event.type === 'START') {
    return {
      name: 'PROBING',
      platform: event.platform,
      history: event.history,
    } satisfies ProbingState
  }
  return state
}

function handleProbing(state: ProbingState, event: IOBridgeEvent): IOBridgeState {
  switch (event.type) {
    case 'PROBE_SUCCESS':
      return {
        name: 'CONNECTED',
        platform: state.platform,
        connectionId: event.connectionId,
        daemonInfo: event.daemonInfo,
      } satisfies ConnectedState

    case 'PROBE_FAILED':
      // Platform-specific failure handling
      if (state.platform === 'desktop') {
        return {
          name: 'INSTALL_PROMPT',
          platform: 'desktop',
          history: recordAttempt(state.history, 'probe failed'),
        } satisfies InstallPromptState
      } else {
        return {
          name: 'LAUNCH_PROMPT',
          platform: 'chromeos',
          history: recordAttempt(state.history, 'probe failed'),
        } satisfies LaunchPromptState
      }

    default:
      return state
  }
}

function handleConnected(state: ConnectedState, event: IOBridgeEvent): IOBridgeState {
  if (event.type === 'DAEMON_DISCONNECTED') {
    return {
      name: 'DISCONNECTED',
      platform: state.platform,
      history: createConnectionHistory(),
      wasHealthy: event.wasHealthy,
    } satisfies DisconnectedState
  }
  return state
}

function handleDisconnected(state: DisconnectedState, event: IOBridgeEvent): IOBridgeState {
  if (event.type === 'RETRY') {
    return {
      name: 'PROBING',
      platform: state.platform,
      history: state.history,
    } satisfies ProbingState
  }
  return state
}

function handleInstallPrompt(state: InstallPromptState, event: IOBridgeEvent): IOBridgeState {
  switch (event.type) {
    case 'RETRY':
      return {
        name: 'PROBING',
        platform: state.platform,
        history: state.history,
      } satisfies ProbingState

    case 'PROBE_SUCCESS':
      // Handle successful poll from INSTALL_PROMPT state
      return {
        name: 'CONNECTED',
        platform: state.platform,
        connectionId: event.connectionId,
        daemonInfo: event.daemonInfo,
      } satisfies ConnectedState

    default:
      return state
  }
}

function handleLaunchPrompt(state: LaunchPromptState, event: IOBridgeEvent): IOBridgeState {
  if (event.type === 'USER_LAUNCH') {
    return {
      name: 'AWAITING_LAUNCH',
      platform: 'chromeos',
      history: state.history,
      startedAt: Date.now(),
    } satisfies AwaitingLaunchState
  }
  return state
}

function handleAwaitingLaunch(state: AwaitingLaunchState, event: IOBridgeEvent): IOBridgeState {
  switch (event.type) {
    case 'DAEMON_CONNECTED':
      return {
        name: 'CONNECTED',
        platform: 'chromeos',
        connectionId: event.connectionId,
        daemonInfo: event.daemonInfo,
      } satisfies ConnectedState

    case 'LAUNCH_TIMEOUT':
      return {
        name: 'LAUNCH_FAILED',
        platform: 'chromeos',
        history: recordAttempt(state.history, 'launch timeout'),
      } satisfies LaunchFailedState

    case 'USER_CANCEL':
      return {
        name: 'LAUNCH_PROMPT',
        platform: 'chromeos',
        history: state.history,
      } satisfies LaunchPromptState

    default:
      return state
  }
}

function handleLaunchFailed(state: LaunchFailedState, event: IOBridgeEvent): IOBridgeState {
  if (event.type === 'RETRY') {
    return {
      name: 'PROBING',
      platform: state.platform,
      history: state.history,
    } satisfies ProbingState
  }
  return state
}

// =============================================================================
// State Predicates
// =============================================================================

/**
 * Check if the state represents a connected daemon.
 */
export function isConnected(state: IOBridgeState): state is ConnectedState {
  return state.name === 'CONNECTED'
}

/**
 * Check if the state represents a state waiting for user action.
 */
export function isWaitingForUser(state: IOBridgeState): boolean {
  return (
    state.name === 'INSTALL_PROMPT' ||
    state.name === 'LAUNCH_PROMPT' ||
    state.name === 'LAUNCH_FAILED'
  )
}

/**
 * Check if the state represents an active connection attempt.
 */
export function isConnecting(state: IOBridgeState): boolean {
  return state.name === 'PROBING' || state.name === 'AWAITING_LAUNCH'
}

/**
 * Get the platform from any state that has it.
 */
export function getPlatform(state: IOBridgeState): Platform | null {
  if ('platform' in state) {
    return state.platform
  }
  return null
}
