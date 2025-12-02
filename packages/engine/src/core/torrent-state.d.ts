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
  | 'stopped'
  | 'checking'
  | 'downloading_metadata'
  | 'downloading'
  | 'seeding'
  | 'error'
/**
 * Compute activity state from torrent properties.
 */
export declare function computeActivityState(
  userState: TorrentUserState,
  engineSuspended: boolean,
  hasMetadata: boolean,
  isChecking: boolean,
  progress: number,
  hasError: boolean,
): TorrentActivityState
//# sourceMappingURL=torrent-state.d.ts.map
