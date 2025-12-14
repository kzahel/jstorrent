/**
 * Version compatibility checking for IO Bridge.
 */

export type VersionStatus = 'compatible' | 'update_suggested' | 'update_required'

export interface VersionConfig {
  /** Daemon versions below this cannot work at all */
  minSupported: string
  /** Current extension version - daemon below this should update */
  current: string
}

/**
 * Default version config - update these when releasing breaking changes.
 */
export const VERSION_CONFIG: VersionConfig = {
  minSupported: '0.1.0',
  current: '0.1.0',
}

/**
 * Compare two semver strings.
 * Returns: -1 if a < b, 0 if a == b, 1 if a > b
 */
function compareSemver(a: string, b: string): number {
  const partsA = a.split('.').map((p) => parseInt(p, 10) || 0)
  const partsB = b.split('.').map((p) => parseInt(p, 10) || 0)

  // Pad to same length
  while (partsA.length < partsB.length) partsA.push(0)
  while (partsB.length < partsA.length) partsB.push(0)

  for (let i = 0; i < partsA.length; i++) {
    if (partsA[i] < partsB[i]) return -1
    if (partsA[i] > partsB[i]) return 1
  }
  return 0
}

/**
 * Determine version compatibility status.
 */
export function getVersionStatus(
  daemonVersion: string | undefined,
  config: VersionConfig = VERSION_CONFIG,
): VersionStatus {
  if (daemonVersion === undefined || daemonVersion === 'unknown') {
    // No version info - assume compatible (legacy daemon)
    return 'compatible'
  }

  if (compareSemver(daemonVersion, config.minSupported) < 0) {
    return 'update_required'
  }

  if (compareSemver(daemonVersion, config.current) < 0) {
    return 'update_suggested'
  }

  return 'compatible'
}

/**
 * Format version for display.
 */
export function formatVersion(version: string | undefined): string {
  if (version === undefined || version === 'unknown') {
    return 'unknown'
  }
  // Version is already a string like "0.1.0", prefix with "v" if not already
  if (version.startsWith('v')) {
    return version
  }
  return `v${version}`
}
