/**
 * Platform detection utilities.
 */

export type Platform = 'chromeos' | 'desktop'

/**
 * Detailed platform type for metrics tracking.
 * Distinguishes between different desktop operating systems.
 */
export type DetailedPlatform = 'mac' | 'win' | 'linux' | 'chromeos'

/**
 * Detect if running on ChromeOS.
 * Uses navigator.userAgent which contains "CrOS" on ChromeOS.
 */
export function detectPlatform(): Platform {
  if (typeof navigator !== 'undefined' && navigator.userAgent.includes('CrOS')) {
    return 'chromeos'
  }
  return 'desktop'
}

/**
 * Detect detailed platform from userAgent.
 * Returns 'mac', 'win', 'linux', or 'chromeos'.
 * Used for metrics tracking to understand platform distribution.
 */
export function detectDetailedPlatform(): DetailedPlatform {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''

  // ChromeOS check first (most specific - contains "CrOS")
  if (ua.includes('CrOS')) return 'chromeos'

  // macOS detection
  if (ua.includes('Macintosh') || ua.includes('Mac OS X')) return 'mac'

  // Windows detection
  if (ua.includes('Windows')) return 'win'

  // Linux detection (after ChromeOS since CrOS userAgent also contains Linux)
  if (ua.includes('Linux')) return 'linux'

  // Fallback - treat unknown as linux (most permissive)
  return 'linux'
}

/**
 * Check if we can reach the Android daemon.
 * Returns true if the daemon responds to /status.
 */
export async function isAndroidDaemonReachable(
  host: string = '100.115.92.2',
  port: number = 7800,
  timeoutMs: number = 2000,
): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

    const response = await fetch(`http://${host}:${port}/status`, {
      signal: controller.signal,
    })

    clearTimeout(timeoutId)
    return response.ok
  } catch {
    return false
  }
}

/**
 * Try multiple ports in case 7800 is taken.
 * Returns the port that responds, or null if none.
 */
export async function findAndroidDaemonPort(
  host: string = '100.115.92.2',
  basePorts: number[] = [7800, 7805, 7814, 7827],
): Promise<number | null> {
  for (const port of basePorts) {
    if (await isAndroidDaemonReachable(host, port)) {
      return port
    }
  }
  return null
}
