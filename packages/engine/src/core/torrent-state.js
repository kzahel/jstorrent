/**
 * Compute activity state from torrent properties.
 */
export function computeActivityState(
  userState,
  engineSuspended,
  hasMetadata,
  isChecking,
  progress,
  hasError,
) {
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
