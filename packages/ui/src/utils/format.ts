/**
 * Format bytes as human-readable string (e.g., "1.5 GB")
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

/**
 * Format bytes per second as speed string (e.g., "1.5 MB/s")
 */
export function formatSpeed(bytesPerSecond: number): string {
  return formatBytes(bytesPerSecond) + '/s'
}

/**
 * Format percentage (0-1) as string (e.g., "67.5%")
 */
export function formatPercent(ratio: number, decimals = 1): string {
  return (ratio * 100).toFixed(decimals) + '%'
}

/**
 * Format seconds as duration string (e.g., "2h 15m", "5m 30s")
 */
export function formatDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '∞'

  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)

  if (hours > 0) {
    return `${hours}h ${minutes}m`
  } else if (minutes > 0) {
    return `${minutes}m ${secs}s`
  } else {
    return `${secs}s`
  }
}

/** Known BitTorrent client codes (Azureus-style) */
const TORRENT_CLIENTS: Record<string, string> = {
  UT: 'µTorrent',
  TR: 'Transmission',
  DE: 'Deluge',
  qB: 'qBittorrent',
  AZ: 'Azureus',
  LT: 'libtorrent',
  lt: 'libtorrent',
  JS: 'JSTorrent',
}

/**
 * Parse a BitTorrent peer ID to extract the client name and version.
 * Supports Azureus-style encoding (-XX####-).
 */
export function parseClientName(peerId: Uint8Array | null): string {
  if (!peerId) return ''

  // Azureus-style: -XX####- where XX=client code, ####=version digits
  if (peerId[0] === 0x2d && peerId[7] === 0x2d) {
    const clientCode = String.fromCharCode(peerId[1], peerId[2])
    const versionChars = String.fromCharCode(peerId[3], peerId[4], peerId[5], peerId[6])

    const name = TORRENT_CLIENTS[clientCode] || clientCode

    // Parse version: each char is a version component (0-9)
    // "0001" → "0.0.0.1", "1234" → "1.2.3.4"
    const versionParts = versionChars.split('').map((c) => parseInt(c, 10) || 0)
    // Remove trailing zeros for cleaner display
    while (versionParts.length > 1 && versionParts[versionParts.length - 1] === 0) {
      versionParts.pop()
    }
    const version = versionParts.join('.')

    return `${name} ${version}`
  }

  // Shadow-style: first byte is client
  // Just show hex for unknown
  return Array.from(peerId.slice(0, 8))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
