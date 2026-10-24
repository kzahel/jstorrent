import { describe, expect, it } from "vitest";

import { formatRoute, parseRoute, type ApplicationRoute } from "./route";

describe("application route", () => {
  it("omits defaults and round-trips each part", () => {
    const routes: readonly [ApplicationRoute, string][] = [
      [
        { destination: "workbench", category: "all", torrentId: null, tab: "peers", detailOpen: false, settings: null },
        "#/torrents",
      ],
      [
        { destination: "workbench", category: "downloading", torrentId: "t 1", tab: "files", detailOpen: true, settings: "data-reset" },
        "#/torrents/downloading?torrent=t+1&tab=files&open=1&settings=data-reset",
      ],
      [
        { destination: "library", category: "all", torrentId: null, libraryMode: "media", settings: null },
        "#/library",
      ],
      [
        { destination: "library", category: "recent", torrentId: "abc", libraryMode: "files", settings: "about" },
        "#/library/recent?torrent=abc&view=files&settings=about",
      ],
    ];
    for (const [route, fragment] of routes) {
      expect(formatRoute(route)).toBe(fragment);
      expect(parseRoute(fragment)).toEqual(route);
    }
  });

  it("names no route for empty or foreign fragments", () => {
    for (const fragment of ["", "#", "#top", "#/", "#/elsewhere", `#/torrents${"x".repeat(1100)}`]) {
      expect(parseRoute(fragment)).toBeNull();
    }
  });

  it("falls back to defaults for unknown parts", () => {
    expect(
      parseRoute(`#/library/bogus?torrent=${"a".repeat(129)}&view=files&settings=root`),
    ).toEqual({
      destination: "library",
      category: "all",
      torrentId: null,
      libraryMode: "media",
      settings: null,
    });
    expect(parseRoute("#/torrents/everything?tab=shell&open=yes&torrent=")).toEqual({
      destination: "workbench",
      category: "all",
      torrentId: null,
      tab: "peers",
      detailOpen: false,
      settings: null,
    });
  });
});
