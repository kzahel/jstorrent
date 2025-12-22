/**
 * @deprecated Import from '../engine-manager' instead.
 * This file re-exports for backwards compatibility.
 */
export {
  ChromeExtensionEngineManager,
  engineManager,
} from '../engine-manager/chrome-extension-engine-manager'

// Legacy type exports
export type { DaemonInfo, DownloadRoot } from '../types'

// Legacy alias for backwards compatibility
export { ChromeExtensionEngineManager as EngineManager } from '../engine-manager/chrome-extension-engine-manager'
