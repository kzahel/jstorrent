/**
 * Native Adapter Exports
 *
 * This module provides adapters for running the JSTorrent engine
 * in QuickJS (Android) and JavaScriptCore (iOS) runtimes.
 */

// Import polyfills first to ensure they're available
import './polyfills'

// Re-export adapter classes
export { NativeSocketFactory } from './native-socket-factory'
export { NativeTcpSocket } from './native-tcp-socket'
export { NativeUdpSocket } from './native-udp-socket'
export { NativeTcpServer } from './native-tcp-server'
export { NativeFileSystem } from './native-filesystem'
export { NativeFileHandle } from './native-file-handle'
export { NativeSessionStore } from './native-session-store'
export { NativeHasher } from './native-hasher'
export { callbackManager } from './callback-manager'
export { setupController, startStatePushLoop } from './controller'
export { NativeConfigHub } from './native-config-hub'
