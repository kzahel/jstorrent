/**
 * User's intent for the torrent - persisted to session store.
 */
export type TorrentUserState = 'active' | 'stopped' | 'queued'

/**
 * What the torrent is actually doing right now.
 * Derived from userState + engine state + torrent progress.
 * NOT persisted - computed on the fly.
 */
export type TorrentActivityState =
  | 'stopped' // No network activity
  | 'checking' // Verifying existing data on disk
  | 'downloading_metadata' // Fetching .torrent info from peers
  | 'downloading' // Actively downloading pieces
  | 'seeding' // Complete, uploading to peers
  | 'error' // Something went wrong

/**
 * Compute activity state from torrent properties.
 */
export function computeActivityState(
  userState: TorrentUserState,
  engineSuspended: boolean,
  hasMetadata: boolean,
  isChecking: boolean,
  progress: number,
  hasError: boolean,
): TorrentActivityState {
  // Engine suspended = everything stopped
  if (engineSuspended) return 'stopped'

  // User stopped or queued = stopped
  if (userState === 'stopped' || userState === 'queued') return 'stopped'

  // Error state
  if (hasError) return 'error'

  // Checking data
  if (isChecking) return 'checking'

  // No metadata yet
  if (!hasMetadata) return 'downloading_metadata'

  // Complete
  if (progress >= 1) return 'seeding'

  // Downloading
  return 'downloading'
}
