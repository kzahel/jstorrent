/**
 * Metrics Tracking System for JSTorrent
 *
 * PURPOSE:
 * Track aggregate usage metrics across devices for uninstall feedback and analytics.
 * Metrics are passed to the uninstall URL so users can optionally provide context
 * about their usage when uninstalling.
 *
 * STORAGE STRATEGY:
 * - storage.sync: Cross-device aggregates (metrics:aggregate key)
 *   - Syncs across all Chrome instances for the same Google account
 *   - Contains totals, per-platform breakdowns, device list
 * - storage.local: Device-specific data (metrics:installTimestamp)
 *   - Install timestamp for calculating "days installed"
 *
 * CRITICAL SAFETY RULES:
 *
 * 1. The onChanged listener is READ-ONLY. It NEVER calls storage.sync.set().
 *    It only updates the local cache of "expected" values.
 *
 * 2. Storage writes ONLY happen from increment functions (incrementTorrentsAdded,
 *    incrementCompletedDownloads, incrementSessionsStarted, registerDevice).
 *    These are triggered by actual local events, not by sync updates.
 *
 * 3. This design prevents infinite cascading updates:
 *    - Device A increments → writes to sync
 *    - Device B receives sync update → updates local cache only (NO WRITE)
 *    - No infinite loop possible
 *
 * MERGE SEMANTICS:
 * All writes use merge, not overwrite:
 * - deviceIds: Set union (add our ID to existing array)
 * - lastSeenByDevice: Object spread (merge timestamps)
 * - byPlatform: Object spread with nested merge
 * - Counters: Increment from current value
 *
 * This is a simple CRDT-lite approach that works well for:
 * - Monotonically increasing counters
 * - Grow-only sets (deviceIds)
 * - Last-write-wins timestamps (lastSeenByDevice)
 */

import { getOrCreateInstallId } from './install-id'
import { detectDetailedPlatform, type DetailedPlatform } from './platform'

// Re-export for convenience
export { detectDetailedPlatform, type DetailedPlatform } from './platform'

// ============================================================================
// Types
// ============================================================================

export interface PlatformMetrics {
  downloads: number
  added: number
  sessions: number
}

export interface SyncMetrics {
  completedDownloads: number
  torrentsAdded: number
  sessionsStarted: number
  byPlatform: Partial<Record<DetailedPlatform, PlatformMetrics>>
  deviceIds: string[]
  lastSeenByDevice: Record<string, number>
}

// ============================================================================
// Storage Keys
// ============================================================================

const SYNC_KEY = 'metrics:aggregate'
const LOCAL_TIMESTAMP_KEY = 'metrics:installTimestamp'

// ============================================================================
// Defaults
// ============================================================================

const DEFAULT_METRICS: SyncMetrics = {
  completedDownloads: 0,
  torrentsAdded: 0,
  sessionsStarted: 0,
  byPlatform: {},
  deviceIds: [],
  lastSeenByDevice: {},
}

const DEFAULT_PLATFORM_METRICS: PlatformMetrics = {
  downloads: 0,
  added: 0,
  sessions: 0,
}

// ============================================================================
// Throttling
// ============================================================================

let lastUninstallUrlUpdate = 0
const UNINSTALL_URL_THROTTLE_MS = 30000

// ============================================================================
// Storage Access
// ============================================================================

/**
 * Get install timestamp, creating if necessary.
 * For existing users without timestamp, uses current time (migration).
 */
export async function getInstallTimestamp(): Promise<number> {
  const result = await chrome.storage.local.get(LOCAL_TIMESTAMP_KEY)

  if (typeof result[LOCAL_TIMESTAMP_KEY] === 'number') {
    return result[LOCAL_TIMESTAMP_KEY]
  }

  // First access - set to now (migration case for existing users)
  const timestamp = Date.now()
  await chrome.storage.local.set({ [LOCAL_TIMESTAMP_KEY]: timestamp })
  return timestamp
}

/**
 * Get current sync metrics from storage, with defaults.
 */
export async function getSyncMetrics(): Promise<SyncMetrics> {
  const result = await chrome.storage.sync.get(SYNC_KEY)
  const stored = result[SYNC_KEY] as Partial<SyncMetrics> | undefined

  return {
    ...DEFAULT_METRICS,
    ...stored,
    // Ensure nested objects exist even if stored is partial
    byPlatform: stored?.byPlatform ?? {},
    deviceIds: stored?.deviceIds ?? [],
    lastSeenByDevice: stored?.lastSeenByDevice ?? {},
  }
}

/**
 * Write sync metrics with merge semantics.
 * This is the ONLY function that calls storage.sync.set for metrics.
 */
async function writeSyncMetrics(metrics: SyncMetrics): Promise<void> {
  await chrome.storage.sync.set({ [SYNC_KEY]: metrics })
}

// ============================================================================
// Increment Functions (these are the ONLY places that write to sync storage)
// ============================================================================

/**
 * Register this device in the metrics.
 * Adds installId to deviceIds array and updates lastSeen timestamp.
 */
export async function registerDevice(): Promise<void> {
  const installId = await getOrCreateInstallId()
  const timestamp = Date.now()
  const platform = detectDetailedPlatform()

  const current = await getSyncMetrics()

  // Merge deviceIds (Set union)
  const deviceIds = [...new Set([...current.deviceIds, installId])]

  // Merge lastSeenByDevice
  const lastSeenByDevice = {
    ...current.lastSeenByDevice,
    [installId]: timestamp,
  }

  // Ensure platform entry exists
  const platformMetrics = current.byPlatform[platform] ?? { ...DEFAULT_PLATFORM_METRICS }
  const byPlatform = {
    ...current.byPlatform,
    [platform]: platformMetrics,
  }

  await writeSyncMetrics({
    ...current,
    deviceIds,
    lastSeenByDevice,
    byPlatform,
  })

  // Ensure install timestamp exists
  await getInstallTimestamp()

  console.log('[Metrics] Device registered:', installId, 'platform:', platform)
}

/**
 * Increment torrents added counter.
 * Called when TorrentAdded or MagnetAdded native event is received.
 */
export async function incrementTorrentsAdded(): Promise<void> {
  const platform = detectDetailedPlatform()
  const current = await getSyncMetrics()

  const platformMetrics = current.byPlatform[platform] ?? { ...DEFAULT_PLATFORM_METRICS }

  await writeSyncMetrics({
    ...current,
    torrentsAdded: current.torrentsAdded + 1,
    byPlatform: {
      ...current.byPlatform,
      [platform]: {
        ...platformMetrics,
        added: platformMetrics.added + 1,
      },
    },
  })

  scheduleUninstallUrlUpdate()
  console.log('[Metrics] Torrent added, total:', current.torrentsAdded + 1)
}

/**
 * Increment completed downloads counter.
 * Called when notification:torrent-complete message is received.
 */
export async function incrementCompletedDownloads(): Promise<void> {
  const platform = detectDetailedPlatform()
  const current = await getSyncMetrics()

  const platformMetrics = current.byPlatform[platform] ?? { ...DEFAULT_PLATFORM_METRICS }

  await writeSyncMetrics({
    ...current,
    completedDownloads: current.completedDownloads + 1,
    byPlatform: {
      ...current.byPlatform,
      [platform]: {
        ...platformMetrics,
        downloads: platformMetrics.downloads + 1,
      },
    },
  })

  scheduleUninstallUrlUpdate()
  console.log('[Metrics] Download completed, total:', current.completedDownloads + 1)
}

/**
 * Increment sessions started counter.
 * Called when UI connects via port.
 */
export async function incrementSessionsStarted(): Promise<void> {
  const platform = detectDetailedPlatform()
  const installId = await getOrCreateInstallId()
  const timestamp = Date.now()
  const current = await getSyncMetrics()

  const platformMetrics = current.byPlatform[platform] ?? { ...DEFAULT_PLATFORM_METRICS }

  await writeSyncMetrics({
    ...current,
    sessionsStarted: current.sessionsStarted + 1,
    byPlatform: {
      ...current.byPlatform,
      [platform]: {
        ...platformMetrics,
        sessions: platformMetrics.sessions + 1,
      },
    },
    // Also update lastSeen on session start
    lastSeenByDevice: {
      ...current.lastSeenByDevice,
      [installId]: timestamp,
    },
  })

  scheduleUninstallUrlUpdate()
  console.log('[Metrics] Session started, total:', current.sessionsStarted + 1)
}

// ============================================================================
// Uninstall URL
// ============================================================================

/**
 * Schedule uninstall URL update (throttled to avoid excessive API calls).
 */
function scheduleUninstallUrlUpdate(): void {
  const now = Date.now()
  if (now - lastUninstallUrlUpdate < UNINSTALL_URL_THROTTLE_MS) {
    return
  }

  // Defer to avoid blocking the metric increment
  setTimeout(() => {
    updateUninstallUrl().catch((e) => console.error('[Metrics] Failed to update uninstall URL:', e))
  }, 100)
}

/**
 * Update the uninstall URL with current metrics.
 *
 * Parameters:
 * - v: extension version
 * - id: install ID
 * - days: days since install
 * - connected: has ever connected to daemon (0/1)
 * - downloads: total completed downloads
 * - added: total torrents added
 * - sessions: total sessions started
 * - devices: number of devices
 */
export async function updateUninstallUrl(): Promise<void> {
  lastUninstallUrlUpdate = Date.now()

  try {
    const [installId, installTimestamp, metrics, hasConnectedResult] = await Promise.all([
      getOrCreateInstallId(),
      getInstallTimestamp(),
      getSyncMetrics(),
      chrome.storage.local.get('daemon:hasConnectedSuccessfully'),
    ])

    const manifest = chrome.runtime.getManifest()
    const version = manifest.version
    const daysInstalled = Math.floor((Date.now() - installTimestamp) / (1000 * 60 * 60 * 24))
    const connected = hasConnectedResult['daemon:hasConnectedSuccessfully'] === true ? 1 : 0

    const params = new URLSearchParams({
      v: version,
      id: installId,
      days: String(daysInstalled),
      connected: String(connected),
      downloads: String(metrics.completedDownloads),
      added: String(metrics.torrentsAdded),
      sessions: String(metrics.sessionsStarted),
      devices: String(metrics.deviceIds.length),
    })

    const url = `https://new.jstorrent.com/uninstall.html?${params.toString()}`
    chrome.runtime.setUninstallURL(url)

    console.log('[Metrics] Updated uninstall URL:', url)
  } catch (e) {
    console.error('[Metrics] Failed to update uninstall URL:', e)
  }
}

// ============================================================================
// Sync Change Listener (READ-ONLY - never writes to storage)
// ============================================================================

/**
 * Set up listener for sync storage changes.
 *
 * CRITICAL: This listener is READ-ONLY. It NEVER calls storage.sync.set()
 * to prevent infinite cascading updates.
 *
 * Currently just logs sync updates for debugging. The increment functions
 * always read fresh from storage before merging, so no caching is needed.
 */
export function setupSyncListener(): void {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    // Only care about sync storage
    if (areaName !== 'sync') return

    // Only care about our metrics key
    if (!changes[SYNC_KEY]) return

    // Log for debugging - DO NOT WRITE BACK
    console.log('[Metrics] Sync update received (read-only, no write-back)')
  })

  console.log('[Metrics] Sync listener set up (read-only)')
}
