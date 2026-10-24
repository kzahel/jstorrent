import { describe, expect, it, vi } from "vitest";

import {
  NAVIGATION_STORAGE_KEY,
  loadNavigationPreferences,
  saveNavigationPreferences,
} from "./navigation";

describe("application navigation preferences", () => {
  it("defaults to Torrents and independent all filters", () => {
    expect(loadNavigationPreferences(null)).toEqual({
      destination: "workbench",
      libraryCategory: "all",
      transfersCategory: "all",
      workbenchCategory: "all",
    });
  });

  it("round trips every preference field", () => {
    let source: string | null = null;
    const storage = {
      getItem: (key: string) =>
        key === NAVIGATION_STORAGE_KEY ? source : null,
      setItem: (key: string, value: string) => {
        if (key === NAVIGATION_STORAGE_KEY) source = value;
      },
    };
    const preferences = {
      destination: "workbench" as const,
      libraryCategory: "recent" as const,
      transfersCategory: "paused" as const,
      workbenchCategory: "errors" as const,
    };
    saveNavigationPreferences(preferences, storage);
    expect(loadNavigationPreferences(storage)).toEqual(preferences);
    expect(JSON.parse(source ?? "null")).toEqual({
      version: 1,
      ...preferences,
    });
  });

  it("validates fields independently and rejects future versions", () => {
    expect(
      loadNavigationPreferences(
        stored({
          version: 1,
          destination: "workbench",
          libraryCategory: "movies",
          transfersCategory: "paused",
          workbenchCategory: "everything",
        }),
      ),
    ).toEqual({
      destination: "workbench",
      libraryCategory: "all",
      transfersCategory: "paused",
      workbenchCategory: "all",
    });
    expect(loadNavigationPreferences(stored({ version: 2 }))).toEqual({
      destination: "workbench",
      libraryCategory: "all",
      transfersCategory: "all",
      workbenchCategory: "all",
    });
  });

  it("tolerates malformed and denied storage", () => {
    expect(loadNavigationPreferences({ getItem: () => "not json" })).toEqual({
      destination: "workbench",
      libraryCategory: "all",
      transfersCategory: "all",
      workbenchCategory: "all",
    });
    const read = vi.fn(() => {
      throw new Error("denied");
    });
    const write = vi.fn(() => {
      throw new Error("denied");
    });
    expect(loadNavigationPreferences({ getItem: read }).destination).toBe(
      "workbench",
    );
    expect(() =>
      saveNavigationPreferences(
        {
          destination: "library",
          libraryCategory: "available",
          transfersCategory: "active",
          workbenchCategory: "archived",
        },
        { setItem: write },
      ),
    ).not.toThrow();
  });

  it("opens a saved Transfers destination in Torrents with its filter", () => {
    expect(loadNavigationPreferences(stored({
      version: 1,
      destination: "transfers",
      libraryCategory: "recent",
      transfersCategory: "paused",
      workbenchCategory: "errors",
    }))).toEqual({
      destination: "workbench",
      libraryCategory: "recent",
      transfersCategory: "paused",
      workbenchCategory: "paused",
    });
  });
});

function stored(value: object) {
  return { getItem: () => JSON.stringify(value) };
}
