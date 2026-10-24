import type {
  ApplicationDestination,
  LibraryCategory,
  TorrentCategory,
} from "./model";

export const APPLICATION_DESTINATIONS = [
  "library",
  "transfers",
  "workbench",
] as const;

export const LIBRARY_CATEGORIES = [
  "all",
  "recent",
  "available",
  "downloading",
  "archived",
] as const;

export const TORRENT_CATEGORIES = [
  "all",
  "active",
  "downloading",
  "completed",
  "paused",
  "errors",
  "archived",
] as const;

export const SETTINGS_CATEGORIES = [
  "appearance",
  "downloads",
  "connection",
  "notifications",
  "power",
  "remote-access",
  "web-access",
  "privacy",
  "data-reset",
  "about",
] as const;

export type SettingsCategory = (typeof SETTINGS_CATEGORIES)[number];

export interface NavigationPreferences {
  readonly destination: ApplicationDestination;
  readonly libraryCategory: LibraryCategory;
  readonly transfersCategory: TorrentCategory;
  readonly workbenchCategory: TorrentCategory;
}

export const DEFAULT_DESTINATION: ApplicationDestination = "workbench";
export const DEFAULT_LIBRARY_CATEGORY: LibraryCategory = "all";
export const DEFAULT_TORRENT_CATEGORY: TorrentCategory = "all";
export const NAVIGATION_STORAGE_KEY = "rstorrent.presentation.navigation";

const NAVIGATION_VERSION = 1;

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem">;

export function loadNavigationPreferences(
  storage: ReadableStorage | null = browserStorage(),
): NavigationPreferences {
  if (storage === null) return defaultNavigationPreferences();
  try {
    const source = storage.getItem(NAVIGATION_STORAGE_KEY);
    if (source === null) return defaultNavigationPreferences();
    const value = JSON.parse(source) as {
      readonly version?: unknown;
      readonly destination?: unknown;
      readonly libraryCategory?: unknown;
      readonly transfersCategory?: unknown;
      readonly workbenchCategory?: unknown;
    };
    if (value.version !== NAVIGATION_VERSION) {
      return defaultNavigationPreferences();
    }
    const wasTransfers = value.destination === "transfers";
    const workbenchCategory = wasTransfers
      ? value.transfersCategory
      : value.workbenchCategory;
    return {
      destination: wasTransfers
        ? "workbench"
        : isApplicationDestination(value.destination)
          ? value.destination
          : DEFAULT_DESTINATION,
      libraryCategory: isLibraryCategory(value.libraryCategory)
        ? value.libraryCategory
        : DEFAULT_LIBRARY_CATEGORY,
      transfersCategory: isTorrentCategory(value.transfersCategory)
        ? value.transfersCategory
        : DEFAULT_TORRENT_CATEGORY,
      workbenchCategory: isTorrentCategory(workbenchCategory)
        ? workbenchCategory
        : DEFAULT_TORRENT_CATEGORY,
    };
  } catch {
    return defaultNavigationPreferences();
  }
}

export function saveNavigationPreferences(
  preferences: NavigationPreferences,
  storage: WritableStorage | null = browserStorage(),
): void {
  if (storage === null) return;
  try {
    storage.setItem(
      NAVIGATION_STORAGE_KEY,
      JSON.stringify({ version: NAVIGATION_VERSION, ...preferences }),
    );
  } catch {
    // Browser-local navigation settings are optional in sandboxed contexts.
  }
}

export function isApplicationDestination(
  value: unknown,
): value is ApplicationDestination {
  return APPLICATION_DESTINATIONS.some((candidate) => candidate === value);
}

export function isLibraryCategory(value: unknown): value is LibraryCategory {
  return LIBRARY_CATEGORIES.some((candidate) => candidate === value);
}

export function isTorrentCategory(value: unknown): value is TorrentCategory {
  return TORRENT_CATEGORIES.some((candidate) => candidate === value);
}

export function isSettingsCategory(value: unknown): value is SettingsCategory {
  return SETTINGS_CATEGORIES.some((candidate) => candidate === value);
}

function defaultNavigationPreferences(): NavigationPreferences {
  return {
    destination: DEFAULT_DESTINATION,
    libraryCategory: DEFAULT_LIBRARY_CATEGORY,
    transfersCategory: DEFAULT_TORRENT_CATEGORY,
    workbenchCategory: DEFAULT_TORRENT_CATEGORY,
  };
}

function browserStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
