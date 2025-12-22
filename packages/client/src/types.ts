/**
 * Shared types for @jstorrent/client
 * These are Chrome-free and can be used in standalone contexts.
 */

export interface DaemonInfo {
  port: number
  token: string
  version?: number
  roots: Array<{
    key: string
    path: string
    display_name: string
    removable: boolean
    last_stat_ok: boolean
    last_checked: number
  }>
  /** Host address for daemon connection. Defaults to 127.0.0.1 on desktop, but differs on ChromeOS. */
  host?: string
}

export interface DownloadRoot {
  key: string
  path: string
  display_name: string
  removable: boolean
  last_stat_ok: boolean
  last_checked: number
}
