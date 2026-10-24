import type {
  ApplicationDestination,
  DetailTab,
  LibraryCategory,
  TorrentCategory,
} from "./model";
import {
  DEFAULT_LIBRARY_CATEGORY,
  DEFAULT_TORRENT_CATEGORY,
  isLibraryCategory,
  isSettingsCategory,
  isTorrentCategory,
  type SettingsCategory,
} from "./navigation";
import type { PresentationState } from "./state";
import { DETAIL_TAB_IDS } from "./tabs";

/**
 * Tactical 365: the screen named by the URL fragment. Selections, filters,
 * scroll and pane sizes are deliberately absent.
 */
export type ApplicationRoute =
  | {
      readonly destination: "library";
      readonly category: LibraryCategory;
      /** The torrent whose Library detail is open. */
      readonly torrentId: string | null;
      readonly libraryMode: "media" | "files";
      readonly settings: SettingsCategory | null;
    }
  | {
      readonly destination: "workbench" | "transfers";
      readonly category: TorrentCategory;
      /** The current torrent. */
      readonly torrentId: string | null;
      readonly tab: DetailTab;
      /** The narrow layout's full-screen detail is open. */
      readonly detailOpen: boolean;
      readonly settings: SettingsCategory | null;
    };

/** Longer torrent ids in a fragment are dropped rather than looked up. */
export const MAX_ROUTE_TORRENT_ID_LENGTH = 128;
const MAX_FRAGMENT_LENGTH = 1024;
const DEFAULT_TAB: DetailTab = "peers";

const PATHS: Readonly<Record<ApplicationDestination, string>> = {
  library: "library",
  workbench: "torrents",
  transfers: "transfers",
};

export function routeFromPresentation(
  presentation: PresentationState,
): ApplicationRoute {
  const settings = presentation.settingsCategory;
  if (presentation.destination === "library") {
    return {
      destination: "library",
      category: presentation.libraryCategory,
      torrentId: presentation.libraryDetailOpen
        ? presentation.currentTorrentId
        : null,
      libraryMode: presentation.libraryDetailMode,
      settings,
    };
  }
  return {
    destination: presentation.destination,
    category:
      presentation.destination === "transfers"
        ? presentation.transfersCategory
        : presentation.workbenchCategory,
    torrentId: presentation.currentTorrentId,
    tab: presentation.activeTab,
    detailOpen: presentation.layout === "phone" && presentation.detailOpen,
    settings,
  };
}

/** The fragment for `route`, including `#`; defaults are left out. */
export function formatRoute(route: ApplicationRoute): string {
  const path = [PATHS[route.destination]];
  const defaultCategory =
    route.destination === "library"
      ? DEFAULT_LIBRARY_CATEGORY
      : DEFAULT_TORRENT_CATEGORY;
  if (route.category !== defaultCategory) path.push(route.category);
  const query = new URLSearchParams();
  if (route.torrentId !== null) query.set("torrent", route.torrentId);
  if (route.destination === "library") {
    if (route.torrentId !== null && route.libraryMode === "files") {
      query.set("view", "files");
    }
  } else {
    if (route.tab !== DEFAULT_TAB) query.set("tab", route.tab);
    if (route.detailOpen) query.set("open", "1");
  }
  if (route.settings !== null) query.set("settings", route.settings);
  const search = query.toString();
  return `#/${path.join("/")}${search === "" ? "" : `?${search}`}`;
}

/**
 * The route a fragment names, or null when it names none. Unknown parts
 * fall back to their defaults.
 */
export function parseRoute(fragment: string): ApplicationRoute | null {
  if (fragment.length > MAX_FRAGMENT_LENGTH) return null;
  const body = fragment.startsWith("#") ? fragment.slice(1) : fragment;
  if (!body.startsWith("/")) return null;
  const queryStart = body.indexOf("?");
  const path = (queryStart === -1 ? body : body.slice(0, queryStart))
    .split("/")
    .filter((segment) => segment !== "");
  let query: URLSearchParams;
  try {
    query = new URLSearchParams(queryStart === -1 ? "" : body.slice(queryStart + 1));
  } catch {
    return null;
  }
  const destination = (
    Object.keys(PATHS) as ApplicationDestination[]
  ).find((candidate) => PATHS[candidate] === path[0]);
  if (destination === undefined) return null;
  const requestedTorrent = query.get("torrent");
  const torrentId =
    requestedTorrent === null ||
    requestedTorrent === "" ||
    requestedTorrent.length > MAX_ROUTE_TORRENT_ID_LENGTH
      ? null
      : requestedTorrent;
  const requestedSettings = query.get("settings");
  const settings = isSettingsCategory(requestedSettings)
    ? requestedSettings
    : null;
  if (destination === "library") {
    return {
      destination,
      category: isLibraryCategory(path[1]) ? path[1] : DEFAULT_LIBRARY_CATEGORY,
      torrentId,
      libraryMode:
        torrentId !== null && query.get("view") === "files" ? "files" : "media",
      settings,
    };
  }
  const requestedTab = query.get("tab");
  return {
    destination,
    category: isTorrentCategory(path[1]) ? path[1] : DEFAULT_TORRENT_CATEGORY,
    torrentId,
    tab: DETAIL_TAB_IDS.find((tab) => tab === requestedTab) ?? DEFAULT_TAB,
    detailOpen: query.get("open") === "1",
    settings,
  };
}
