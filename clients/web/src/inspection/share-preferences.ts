import type { AppearanceStorage } from "./appearance";

/**
 * Whether share links carry this device's address (Tactical 357). `ask`
 * asks on the next share-link copy; the choice is a privacy choice, so
 * Restore defaults keeps it and only Clear app data removes it.
 */
export type PeerHintPreference = "ask" | "include" | "omit";

export const DEFAULT_PEER_HINT_PREFERENCE: PeerHintPreference = "ask";
export const SHARE_PREFERENCES_STORAGE_KEY = "rstorrent.presentation.share";

const VERSION = 1;
const PREFERENCES: readonly PeerHintPreference[] = ["ask", "include", "omit"];

export function isPeerHintPreference(value: unknown): value is PeerHintPreference {
  return PREFERENCES.some((candidate) => candidate === value);
}

/**
 * Reads the remembered choice. An unreadable or newer record reads as `ask`
 * and is left in place, never rewritten.
 */
export function loadPeerHintPreference(
  storage: AppearanceStorage | null = browserStorage(),
): PeerHintPreference {
  if (storage === null) return DEFAULT_PEER_HINT_PREFERENCE;
  try {
    const parsed = JSON.parse(
      storage.getItem(SHARE_PREFERENCES_STORAGE_KEY) ?? "null",
    ) as { readonly version?: unknown; readonly peerHint?: unknown } | null;
    return parsed?.version === VERSION && isPeerHintPreference(parsed.peerHint)
      ? parsed.peerHint
      : DEFAULT_PEER_HINT_PREFERENCE;
  } catch {
    return DEFAULT_PEER_HINT_PREFERENCE;
  }
}

export function savePeerHintPreference(
  preference: PeerHintPreference,
  storage: AppearanceStorage | null = browserStorage(),
): void {
  if (storage === null) return;
  try {
    storage.setItem(
      SHARE_PREFERENCES_STORAGE_KEY,
      JSON.stringify({ ...readCurrentRecord(storage), version: VERSION, peerHint: preference }),
    );
  } catch {
    // Without storage the choice is asked again next time.
  }
}

function browserStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Missing, malformed and newer choices never opt a user into uploads. */
export function loadShortLinkPreference(
  storage: AppearanceStorage | null = browserStorage(),
): boolean {
  return storage !== null && readCurrentRecord(storage).shortLink === true;
}

export function saveShortLinkPreference(
  enabled: boolean,
  storage: AppearanceStorage | null = browserStorage(),
): void {
  if (storage === null) return;
  try {
    storage.setItem(SHARE_PREFERENCES_STORAGE_KEY, JSON.stringify({
      ...readCurrentRecord(storage), version: VERSION, shortLink: enabled,
    }));
  } catch {
    // If storage fails the checkbox still works for this panel.
  }
}

function readCurrentRecord(storage: AppearanceStorage): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(SHARE_PREFERENCES_STORAGE_KEY) ?? "null");
    return typeof parsed === "object" && parsed !== null &&
      (parsed as { version?: unknown }).version === VERSION
      ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}
