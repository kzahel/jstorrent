/**
 * JSTorrent version - single source of truth for client identification.
 *
 * When built with Vite or esbuild, JSTORRENT_VERSION is injected from package.json.
 * The fallback ensures the engine works standalone (tests, Node.js usage).
 */
declare const JSTORRENT_VERSION: string | undefined
export const VERSION: string =
  typeof JSTORRENT_VERSION !== 'undefined' ? JSTORRENT_VERSION : '0.1.0'

/**
 * Convert semantic version "X.Y.Z" to Azureus-style 4-char code "XYZW".
 * For version "0.1.0", returns "0100".
 *
 * Azureus-style peer IDs use format: -XX#### where:
 * - XX is the 2-letter client code (JS for JSTorrent)
 * - #### is the 4-digit version code
 */
export function versionToAzureusCode(version: string): string {
  const parts = version.split('.').map((p) => parseInt(p, 10) || 0)
  // Pad to 4 parts (major, minor, patch, build)
  while (parts.length < 4) parts.push(0)
  // Take first 4 parts, clamp each to 0-9 for single digit
  return parts
    .slice(0, 4)
    .map((n) => String(Math.min(9, Math.max(0, n))))
    .join('')
}

/**
 * Decode Azureus-style 4-char version code back to semantic version.
 * "0001" → "0.0.0.1", "1234" → "1.2.3.4"
 * Strips trailing ".0" components for cleaner display.
 */
export function azureusCodeToVersion(code: string): string {
  if (code.length !== 4) return code
  const parts = code.split('').map((c) => parseInt(c, 10) || 0)
  // Remove trailing zeros for cleaner display
  while (parts.length > 1 && parts[parts.length - 1] === 0) {
    parts.pop()
  }
  return parts.join('.')
}
