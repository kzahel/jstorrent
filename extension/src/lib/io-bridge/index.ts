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

// Desktop adapter (native messaging)
export { DesktopAdapter } from './adapters/desktop-adapter'
export type { DesktopAdapterConfig } from './adapters/desktop-adapter'

// ChromeOS adapter (HTTP to Android container)
export { ChromeOSAdapter } from './adapters/chromeos-adapter'
export type { ChromeOSAdapterConfig } from './adapters/chromeos-adapter'

// Service (high-level API for service worker)
export { IOBridgeService, createIOBridgeService } from './io-bridge-service'
export type {
  IOBridgeServiceConfig,
  StateChangeCallback,
  NativeEventCallback,
  NativeEvent,
} from './io-bridge-service'

// Version status
export { getVersionStatus, formatVersion, VERSION_CONFIG } from './version-status'
export type { VersionStatus, VersionConfig } from './version-status'

// Readiness computation
export { getReadiness, isFirstTimeUser } from './readiness'
export type { ReadinessStatus, ReadinessIssue, IndicatorColor } from './readiness'
