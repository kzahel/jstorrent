import { describe, expect, it } from "vitest";

import {
  DEFAULT_LIBRARY_BROWSE,
  LIBRARY_BROWSE_STORAGE_KEY,
  LIBRARY_PAGE_SIZE,
  libraryMediaRequest,
  libraryMediaViewId,
  loadLibraryBrowse,
  saveLibraryBrowse,
  sameLibraryRequest,
  type LibraryBrowseState,
} from "./library-browse";

function browse(change: Partial<LibraryBrowseState>): LibraryBrowseState {
  return { ...DEFAULT_LIBRARY_BROWSE, ...change };
}

describe("Library presets", () => {
  it("are one query with different kinds, roles and grouping", () => {
    expect(libraryMediaRequest(DEFAULT_LIBRARY_BROWSE)).toEqual({
      query: {
        text: "",
        kinds: [],
        roles: [],
        availability: "any",
        archived: "exclude",
        grouping: "none",
        sort: "title",
        descending: false,
      },
      offset: 0,
      limit: LIBRARY_PAGE_SIZE,
    });
    expect(libraryMediaRequest(browse({ preset: "shows" })).query).toMatchObject({
      kinds: ["video"],
      roles: ["episode"],
      grouping: "series",
    });
    expect(
      libraryMediaRequest(browse({ preset: "shows", grouped: false })).query.grouping,
    ).toBe("none");
    expect(libraryMediaRequest(browse({ preset: "movies" })).query).toMatchObject({
      roles: ["movie"],
      grouping: "none",
    });
    expect(libraryMediaRequest(browse({ preset: "music" })).query).toMatchObject({
      kinds: ["audio"],
      grouping: "album",
    });
    expect(libraryMediaRequest(browse({ preset: "torrents" })).query.grouping).toBe(
      "torrent",
    );
  });

  it("open a group in its natural order and a torrent through its ID", () => {
    const show = libraryMediaRequest(
      browse({
        preset: "shows",
        sort: "size",
        descending: true,
        group: { id: "series:north shore stories", title: "North Shore Stories" },
      }),
    ).query;
    expect(show).toMatchObject({
      group_id: "series:north shore stories",
      grouping: "none",
      sort: "title",
      descending: false,
    });
    const torrent = libraryMediaRequest(
      browse({
        preset: "torrents",
        sort: "size",
        group: { id: "torrent:t1-000102030405060708090a0b0c0d0e0f", title: "Show" },
      }),
    ).query;
    expect(torrent.torrent_id).toBe("t1-000102030405060708090a0b0c0d0e0f");
    expect(torrent.group_id).toBeUndefined();
    expect(torrent.sort).toBe("size");
  });

  it("pages, trims search text and includes archived torrents on request", () => {
    const request = libraryMediaRequest(
      browse({ page: 2, text: "  north  ", includeArchived: true }),
    );
    expect(request.offset).toBe(2 * LIBRARY_PAGE_SIZE);
    expect(request.query.text).toBe("north");
    expect(request.query.archived).toBe("include");
  });
});

describe("Library view IDs", () => {
  it("are stable per request, distinct across requests and valid view IDs", () => {
    const first = libraryMediaRequest(DEFAULT_LIBRARY_BROWSE);
    const again = libraryMediaRequest({ ...DEFAULT_LIBRARY_BROWSE });
    const other = libraryMediaRequest(browse({ page: 1 }));
    expect(libraryMediaViewId(first)).toBe(libraryMediaViewId(again));
    expect(libraryMediaViewId(first)).not.toBe(libraryMediaViewId(other));
    expect(libraryMediaViewId(first)).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(sameLibraryRequest(first, again)).toBe(true);
    expect(sameLibraryRequest(first, other)).toBe(false);
    expect(sameLibraryRequest(null, undefined)).toBe(false);
    expect(sameLibraryRequest(null, null)).toBe(true);
  });
});

describe("Library preferences", () => {
  it("remember presentation choices and default every unreadable field", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    };
    saveLibraryBrowse(
      browse({ preset: "music", layout: "list", text: "not kept", page: 4 }),
      storage,
    );
    expect(loadLibraryBrowse(storage)).toEqual(
      browse({ preset: "music", layout: "list" }),
    );
    values.set(
      LIBRARY_BROWSE_STORAGE_KEY,
      JSON.stringify({ preset: "podcasts", layout: "list", descending: "yes" }),
    );
    expect(loadLibraryBrowse(storage)).toEqual(browse({ layout: "list" }));
    values.set(LIBRARY_BROWSE_STORAGE_KEY, "{");
    expect(loadLibraryBrowse(storage)).toEqual(DEFAULT_LIBRARY_BROWSE);

    // Fields a newer client stored survive this client's writes.
    values.set(LIBRARY_BROWSE_STORAGE_KEY, JSON.stringify({ density: "tight" }));
    saveLibraryBrowse(browse({ layout: "list" }), storage);
    expect(JSON.parse(values.get(LIBRARY_BROWSE_STORAGE_KEY)!)).toMatchObject({
      density: "tight",
      layout: "list",
    });
  });
});
