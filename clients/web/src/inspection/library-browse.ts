import type {
  LibraryAvailabilityFilter,
  LibraryMediaQuery,
  LibraryMediaSort,
} from "../api";
import type { LibraryMediaRequest } from "./model";

/** Library views are presets of one query (Tactical 363). */
export type LibraryPreset = "all" | "shows" | "movies" | "music" | "torrents";
export type LibraryLayout = "grid" | "list";

export const LIBRARY_PRESETS: readonly LibraryPreset[] = [
  "all",
  "shows",
  "movies",
  "music",
  "torrents",
];

export const LIBRARY_PAGE_SIZE = 100;

/** An opened show, album or torrent. */
export interface LibraryGroupSelection {
  readonly id: string;
  readonly title: string;
}

export interface LibraryBrowseState {
  readonly preset: LibraryPreset;
  readonly text: string;
  readonly availability: LibraryAvailabilityFilter;
  readonly includeArchived: boolean;
  readonly sort: LibraryMediaSort;
  readonly descending: boolean;
  /** Shows and Music list groups first; false lists their items. */
  readonly grouped: boolean;
  readonly group: LibraryGroupSelection | null;
  readonly page: number;
  readonly layout: LibraryLayout;
}

export const DEFAULT_LIBRARY_BROWSE: LibraryBrowseState = {
  preset: "all",
  text: "",
  availability: "any",
  includeArchived: false,
  sort: "title",
  descending: false,
  grouped: true,
  group: null,
  page: 0,
  layout: "grid",
};

/** Whether the preset lists groups at its top level. */
export function presetGroups(preset: LibraryPreset): boolean {
  return preset === "shows" || preset === "music" || preset === "torrents";
}

/** The host query and page for the current Library presentation. */
export function libraryMediaRequest(browse: LibraryBrowseState): LibraryMediaRequest {
  const query: {
    -readonly [Key in keyof LibraryMediaQuery]: LibraryMediaQuery[Key];
  } = {
    text: browse.text.trim(),
    kinds: [],
    roles: [],
    availability: browse.availability,
    archived: browse.includeArchived ? "include" : "exclude",
    grouping: "none",
    sort: browse.sort,
    descending: browse.descending,
  };
  switch (browse.preset) {
    case "all":
      break;
    case "shows":
      query.kinds = ["video"];
      query.roles = ["episode"];
      if (browse.grouped && browse.group === null) query.grouping = "series";
      break;
    case "movies":
      query.roles = ["movie"];
      break;
    case "music":
      query.kinds = ["audio"];
      if (browse.grouped && browse.group === null) query.grouping = "album";
      break;
    case "torrents":
      if (browse.group === null) query.grouping = "torrent";
      break;
  }
  if (browse.group !== null) {
    const torrentId = browse.group.id.startsWith("torrent:")
      ? browse.group.id.slice("torrent:".length)
      : null;
    if (torrentId === null) query.group_id = browse.group.id;
    else query.torrent_id = torrentId;
    // A show or album reads in its natural order.
    if (browse.preset !== "torrents") {
      query.sort = "title";
      query.descending = false;
    }
  }
  return {
    query,
    offset: browse.page * LIBRARY_PAGE_SIZE,
    limit: LIBRARY_PAGE_SIZE,
  };
}

export function sameLibraryRequest(
  left: LibraryMediaRequest | null | undefined,
  right: LibraryMediaRequest | null | undefined,
): boolean {
  if (left === right) return true;
  if (left == null || right == null) return false;
  return libraryRequestKey(left) === libraryRequestKey(right);
}

/**
 * A view ID per request, so a page answering an earlier query is never
 * shown as the answer to the current one. Two independent 32-bit hashes
 * keep collisions negligible within one view set.
 */
export function libraryMediaViewId(request: LibraryMediaRequest): string {
  const key = libraryRequestKey(request);
  return `library-media-${hash(key, 0x811c9dc5)}${hash(key, 0x01000193)}`;
}

function libraryRequestKey(request: LibraryMediaRequest): string {
  const query = request.query;
  return JSON.stringify([
    query.text,
    query.kinds,
    query.roles,
    query.availability,
    query.archived,
    query.torrent_id ?? null,
    query.group_id ?? null,
    query.grouping,
    query.sort,
    query.descending,
    request.offset,
    request.limit,
  ]);
}

function hash(value: string, seed: number): string {
  let state = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    state ^= value.charCodeAt(index);
    state = Math.imul(state, 0x01000193) >>> 0;
  }
  return state.toString(16).padStart(8, "0");
}

export const LIBRARY_BROWSE_STORAGE_KEY = "rstorrent.presentation.library";

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem">;

/** Remembered per field; anything unreadable takes its default. */
export function loadLibraryBrowse(
  storage: ReadableStorage | null = browserStorage(),
): LibraryBrowseState {
  if (storage === null) return DEFAULT_LIBRARY_BROWSE;
  let value: Record<string, unknown>;
  try {
    const source = storage.getItem(LIBRARY_BROWSE_STORAGE_KEY);
    const parsed: unknown = source === null ? null : JSON.parse(source);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_LIBRARY_BROWSE;
    value = parsed as Record<string, unknown>;
  } catch {
    return DEFAULT_LIBRARY_BROWSE;
  }
  const pick = <T>(field: string, allowed: readonly T[], fallback: T): T =>
    allowed.includes(value[field] as T) ? (value[field] as T) : fallback;
  return {
    ...DEFAULT_LIBRARY_BROWSE,
    preset: pick("preset", LIBRARY_PRESETS, DEFAULT_LIBRARY_BROWSE.preset),
    layout: pick<LibraryLayout>("layout", ["grid", "list"], "grid"),
    sort: pick<LibraryMediaSort>("sort", ["title", "size", "source"], "title"),
    descending: pick("descending", [true, false], false),
    includeArchived: pick("includeArchived", [true, false], false),
    grouped: pick("grouped", [true, false], true),
  };
}

/** Writes the known fields over the stored ones, keeping any a newer client added. */
export function saveLibraryBrowse(
  browse: LibraryBrowseState,
  storage: (ReadableStorage & WritableStorage) | null = browserStorage(),
): void {
  if (storage === null) return;
  try {
    let stored: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(
        storage.getItem(LIBRARY_BROWSE_STORAGE_KEY) ?? "{}",
      );
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        stored = parsed as Record<string, unknown>;
      }
    } catch {
      // An unreadable value is replaced only by this explicit change.
    }
    storage.setItem(
      LIBRARY_BROWSE_STORAGE_KEY,
      JSON.stringify({
        ...stored,
        preset: browse.preset,
        layout: browse.layout,
        sort: browse.sort,
        descending: browse.descending,
        includeArchived: browse.includeArchived,
        grouped: browse.grouped,
      }),
    );
  } catch {
    // Browser-local Library settings are optional in sandboxed contexts.
  }
}

function browserStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
