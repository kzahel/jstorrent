import { invoke } from "@tauri-apps/api/core";

import type { CatalogRecoveryStatus } from "./api";

/** Desktop recovery (Tactical 369): present only when the catalog did not open. */
export interface DesktopRecovery {
  readonly status: CatalogRecoveryStatus;
  /** Saves the torrent list; false when the user cancelled the save dialog. */
  exportTorrentList(): Promise<boolean>;
  quit(): Promise<void>;
}

export async function loadTauriRecovery(): Promise<DesktopRecovery | null> {
  const status = await invoke<CatalogRecoveryStatus | null>("desktop_recovery_status");
  if (status === null) return null;
  return {
    status,
    exportTorrentList: () => invoke<boolean>("desktop_recovery_export"),
    quit: () => invoke<void>("desktop_recovery_quit"),
  };
}
