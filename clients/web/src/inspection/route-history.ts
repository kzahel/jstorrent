import {
  formatRoute,
  parseRoute,
  routeFromPresentation,
  type ApplicationRoute,
} from "./route";
import type { InspectionStore, InspectionStoreApi } from "./state";
import { isSessionTab } from "./tabs";

/** The parts of `window` the route owner uses. */
export interface RouteHistoryWindow {
  readonly location: Pick<Location, "hash" | "pathname" | "search">;
  readonly history: Pick<History, "state" | "pushState" | "replaceState" | "back">;
  addEventListener(type: "popstate" | "hashchange", listener: () => void): void;
  removeEventListener(type: "popstate" | "hashchange", listener: () => void): void;
}

/** What each history entry records about the entry it was pushed from. */
interface RouteEntry {
  readonly fragment: string;
  readonly previous: string | null;
}

const ENTRY_KEY = "rstorrentRoute";

/**
 * Tactical 365: the one owner of browser history for the application. It
 * keeps the URL fragment and the store's navigation in step and returns its
 * dispose.
 */
export function installRouteHistory(
  store: InspectionStoreApi,
  view: RouteHistoryWindow,
): () => void {
  // A deep link waits for the first library snapshot so its torrent can be
  // checked; until then the store's defaults must not overwrite it.
  let pending = parseRoute(view.location.hash);
  let applying = false;
  let awaitingBack = false;

  const write = (state: InspectionStore) => {
    if (applying || awaitingBack) return;
    if (pending !== null) {
      if (!libraryAnswered(state)) return;
      const route = pending;
      pending = null;
      apply(route);
      state = store.getState();
    }
    const route = routeFromPresentation(state.presentation);
    const fragment = formatRoute(route);
    const shownFragment = view.location.hash;
    if (fragment === shownFragment) return;
    const entry = routeEntry(view.history.state);
    // Closing a detail or Settings returns to the entry it opened from.
    if (entry !== null && entry.previous === fragment) {
      awaitingBack = true;
      view.history.back();
      return;
    }
    const url = view.location.pathname + view.location.search + fragment;
    const shown = parseRoute(shownFragment);
    if (shown !== null && opens(shown, route)) {
      view.history.pushState(
        { [ENTRY_KEY]: { fragment, previous: shownFragment } },
        "",
        url,
      );
    } else {
      view.history.replaceState(
        {
          ...objectState(view.history.state),
          [ENTRY_KEY]: { fragment, previous: entry?.previous ?? null },
        },
        "",
        url,
      );
    }
  };

  const apply = (route: ApplicationRoute) => {
    applying = true;
    try {
      applyRoute(store, route);
    } finally {
      applying = false;
    }
  };

  const followUrl = () => {
    awaitingBack = false;
    const route = parseRoute(view.location.hash);
    if (route !== null) {
      if (pending !== null && !libraryAnswered(store.getState())) {
        pending = route;
        return;
      }
      pending = null;
      apply(route);
    }
    write(store.getState());
  };

  const unsubscribe = store.subscribe(write);
  view.addEventListener("popstate", followUrl);
  view.addEventListener("hashchange", followUrl);
  write(store.getState());
  return () => {
    unsubscribe();
    view.removeEventListener("popstate", followUrl);
    view.removeEventListener("hashchange", followUrl);
  };
}

/** Moves the store to `route` through its actions, each only if needed. */
export function applyRoute(store: InspectionStoreApi, route: ApplicationRoute): void {
  const state = () => store.getState();
  const presentation = () => state().presentation;
  const known = (torrentId: string | null): torrentId is string =>
    torrentId !== null && state().torrents[torrentId] !== undefined;

  if (presentation().destination !== route.destination) {
    state().selectDestination(route.destination);
  }
  if (route.destination === "library") {
    if (presentation().libraryCategory !== route.category) {
      state().selectLibraryCategory(route.category);
    }
    if (known(route.torrentId)) {
      if (
        !presentation().libraryDetailOpen ||
        presentation().currentTorrentId !== route.torrentId
      ) {
        state().openLibraryTorrentDetail(route.torrentId);
      }
      if (presentation().libraryDetailMode !== route.libraryMode) {
        state().selectLibraryDetailMode(route.libraryMode);
      }
    } else if (presentation().libraryDetailOpen) {
      state().closeLibraryTorrentDetail();
    }
  } else {
    const category =
      route.destination === "transfers"
        ? presentation().transfersCategory
        : presentation().workbenchCategory;
    if (category !== route.category) state().selectTorrentCategory(route.category);
    if (known(route.torrentId) && presentation().currentTorrentId !== route.torrentId) {
      state().selectOnlyTorrent(route.torrentId);
    }
    if (presentation().layout === "phone") {
      const currentTorrentId = presentation().currentTorrentId;
      if (route.detailOpen && !presentation().detailOpen) {
        if (isSessionTab(route.tab)) state().openSessionView(route.tab);
        else if (currentTorrentId !== null) state().openTorrentDetail(currentTorrentId);
      } else if (!route.detailOpen && presentation().detailOpen) {
        state().closeDetail();
      }
    }
    if (presentation().activeTab !== route.tab) state().selectTab(route.tab);
  }
  const settings = presentation().settingsCategory;
  if (route.settings === null) {
    if (settings !== null) state().closeSettings();
  } else if (settings === null) {
    state().openSettings(route.settings);
  } else if (settings !== route.settings) {
    state().selectSettingsCategory(route.settings);
  }
}

/** Whether moving from `from` to `to` opens something Back should undo. */
function opens(from: ApplicationRoute, to: ApplicationRoute): boolean {
  if (from.destination !== to.destination || from.category !== to.category) {
    return true;
  }
  if (from.settings === null && to.settings !== null) return true;
  if (to.destination === "library") {
    return to.torrentId !== null && to.torrentId !== from.torrentId;
  }
  return from.destination !== "library" && to.detailOpen && !from.detailOpen;
}

function libraryAnswered(state: InspectionStore): boolean {
  const status = state.viewStatus.library.status;
  return status !== "not_requested" && status !== "loading";
}

function routeEntry(state: unknown): RouteEntry | null {
  const value = objectState(state)[ENTRY_KEY];
  if (typeof value !== "object" || value === null) return null;
  const { fragment, previous } = value as Partial<RouteEntry>;
  if (typeof fragment !== "string") return null;
  return { fragment, previous: typeof previous === "string" ? previous : null };
}

function objectState(state: unknown): Record<string, unknown> {
  return typeof state === "object" && state !== null
    ? (state as Record<string, unknown>)
    : {};
}
