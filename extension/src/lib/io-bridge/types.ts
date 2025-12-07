/**
 * IO Bridge Types
 *
 * Shared types for the IO Bridge state machine.
 */

// Re-export shared types from native-connection
export type { DaemonInfo, DownloadRoot } from '../native-connection'

/**
 * Platform identifier.
 * - desktop: Windows, Mac, Linux with native messaging
 * - chromeos: ChromeOS with Android container HTTP connection
 */
export type Platform = 'desktop' | 'chromeos'

/**
 * History of connection attempts for debugging.
 */
export interface ConnectionHistory {
  attempts: number
  lastAttempt: number | null
  lastError: string | null
}

/**
 * Unique connection identifier for tracking reconnects.
 */
export type ConnectionId = string

// =============================================================================
// State Types
// =============================================================================

export type IOBridgeStateName =
  | 'INITIALIZING'
  | 'PROBING'
  | 'CONNECTED'
  | 'DISCONNECTED'
  | 'INSTALL_PROMPT'
  | 'LAUNCH_PROMPT'
  | 'AWAITING_LAUNCH'
  | 'LAUNCH_FAILED'

/**
 * Base state interface.
 */
interface BaseState {
  name: IOBridgeStateName
}

export interface InitializingState extends BaseState {
  name: 'INITIALIZING'
}

export interface ProbingState extends BaseState {
  name: 'PROBING'
  platform: Platform
  history: ConnectionHistory
}

export interface ConnectedState extends BaseState {
  name: 'CONNECTED'
  platform: Platform
  connectionId: ConnectionId
  daemonInfo: import('../native-connection').DaemonInfo
}

export interface DisconnectedState extends BaseState {
  name: 'DISCONNECTED'
  platform: Platform
  history: ConnectionHistory
  wasHealthy: boolean
}

export interface InstallPromptState extends BaseState {
  name: 'INSTALL_PROMPT'
  platform: 'desktop'
  history: ConnectionHistory
}

export interface LaunchPromptState extends BaseState {
  name: 'LAUNCH_PROMPT'
  platform: 'chromeos'
  history: ConnectionHistory
}

export interface AwaitingLaunchState extends BaseState {
  name: 'AWAITING_LAUNCH'
  platform: 'chromeos'
  history: ConnectionHistory
  startedAt: number
}

export interface LaunchFailedState extends BaseState {
  name: 'LAUNCH_FAILED'
  platform: 'chromeos'
  history: ConnectionHistory
}

/**
 * Union of all possible states.
 */
export type IOBridgeState =
  | InitializingState
  | ProbingState
  | ConnectedState
  | DisconnectedState
  | InstallPromptState
  | LaunchPromptState
  | AwaitingLaunchState
  | LaunchFailedState

// =============================================================================
// Event Types
// =============================================================================

export type IOBridgeEventName =
  | 'START'
  | 'PROBE_SUCCESS'
  | 'PROBE_FAILED'
  | 'USER_LAUNCH'
  | 'USER_CANCEL'
  | 'DAEMON_CONNECTED'
  | 'DAEMON_DISCONNECTED'
  | 'LAUNCH_TIMEOUT'
  | 'RETRY'

export interface StartEvent {
  type: 'START'
  platform: Platform
  history: ConnectionHistory
}

export interface ProbeSuccessEvent {
  type: 'PROBE_SUCCESS'
  connectionId: ConnectionId
  daemonInfo: import('../native-connection').DaemonInfo
}

export interface ProbeFailedEvent {
  type: 'PROBE_FAILED'
}

export interface UserLaunchEvent {
  type: 'USER_LAUNCH'
}

export interface UserCancelEvent {
  type: 'USER_CANCEL'
}

export interface DaemonConnectedEvent {
  type: 'DAEMON_CONNECTED'
  connectionId: ConnectionId
  daemonInfo: import('../native-connection').DaemonInfo
}

export interface DaemonDisconnectedEvent {
  type: 'DAEMON_DISCONNECTED'
  wasHealthy: boolean
}

export interface LaunchTimeoutEvent {
  type: 'LAUNCH_TIMEOUT'
}

export interface RetryEvent {
  type: 'RETRY'
}

/**
 * Union of all possible events.
 */
export type IOBridgeEvent =
  | StartEvent
  | ProbeSuccessEvent
  | ProbeFailedEvent
  | UserLaunchEvent
  | UserCancelEvent
  | DaemonConnectedEvent
  | DaemonDisconnectedEvent
  | LaunchTimeoutEvent
  | RetryEvent
