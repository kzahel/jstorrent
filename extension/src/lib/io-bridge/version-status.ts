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
