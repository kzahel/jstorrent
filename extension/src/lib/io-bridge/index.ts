/**
 * IO Bridge Module
 *
 * Provides a state machine-based connection manager for communicating
 * with the daemon on different platforms (desktop native messaging, ChromeOS HTTP).
 */

// Types
export type {
  Platform,
  ConnectionHistory,
  ConnectionId,
  IOBridgeStateName,
  IOBridgeState,
  IOBridgeEventName,
  IOBridgeEvent,
  InitializingState,
  ProbingState,
  ConnectedState,
  DisconnectedState,
  InstallPromptState,
  LaunchPromptState,
  AwaitingLaunchState,
  LaunchFailedState,
  StartEvent,
  ProbeSuccessEvent,
  ProbeFailedEvent,
  UserLaunchEvent,
  UserCancelEvent,
  DaemonConnectedEvent,
  DaemonDisconnectedEvent,
  LaunchTimeoutEvent,
  RetryEvent,
  DaemonInfo,
  DownloadRoot,
} from './types'

// State machine
export {
  createInitialState,
  createConnectionHistory,
  recordAttempt,
  transition,
  isConnected,
  isWaitingForUser,
  isConnecting,
  getPlatform,
} from './io-bridge-state'

// Store
export { IOBridgeStore } from './io-bridge-store'
export type { StateListener } from './io-bridge-store'

// Adapter interface
export type {
  IIOBridgeAdapter,
  ProbeResult,
  OnDaemonConnected,
  OnDaemonDisconnected,
  AdapterFactory,
} from './io-bridge-adapter'

// Effects
export { IOBridgeEffects, createIOBridge } from './io-bridge-effects'
export type { IOBridgeEffectsConfig } from './io-bridge-effects'

// Mock adapter (for testing)
export {
  MockAdapter,
  createMockDaemonInfo,
  createSuccessProbeResult,
  createFailedProbeResult,
} from './adapters/mock-adapter'
export type { MockAdapterConfig } from './adapters/mock-adapter'
