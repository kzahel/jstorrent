import { useCallback } from 'react'
import { getBridge } from '../chrome/extension-bridge'

/**
 * Hook to provide ChromeOS bootstrap action callbacks.
 *
 * State is received via useIOBridgeState to avoid creating multiple 'ui' ports.
 */
export function useChromeOSBootstrap() {
  const openIntent = useCallback(() => {
    getBridge().postMessage({ type: 'CHROMEOS_OPEN_INTENT' })
  }, [])

  const resetPairing = useCallback(() => {
    getBridge().postMessage({ type: 'CHROMEOS_RESET_PAIRING' })
  }, [])

  return {
    openIntent,
    resetPairing,
  }
}
