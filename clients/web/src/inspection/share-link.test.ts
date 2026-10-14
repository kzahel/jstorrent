import { describe, expect, it } from "vitest";

import { shareLinkFromMagnet } from "./share-link";

describe("shareLinkFromMagnet", () => {
  it("puts the magnet query string in the fragment unchanged", () => {
    expect(
      shareLinkFromMagnet(
        "magnet:?xt=urn:btih:a88fda5954e89178c372716a6a78b8180ed4dad3" +
          "&dn=The%20WIRED%20CD&tr=udp%3A%2F%2Ftracker.example%3A6969",
      ),
    ).toBe(
      "https://jstorrent.com/share/#xt=urn:btih:a88fda5954e89178c372716a6a78b8180ed4dad3" +
        "&dn=The%20WIRED%20CD&tr=udp%3A%2F%2Ftracker.example%3A6969",
    );
  });

  it("keeps v2 hashes and raw tracker URLs", () => {
    expect(
      shareLinkFromMagnet(
        "MAGNET:?xt=urn:btmh:1220abcd&tr=http://tracker.example/announce?k=1",
      ),
    ).toBe(
      "https://jstorrent.com/share/#xt=urn:btmh:1220abcd&tr=http://tracker.example/announce?k=1",
    );
  });

  it("escapes characters a fragment cannot carry", () => {
    expect(shareLinkFromMagnet("magnet:?dn=a b#c%zz%41é")).toBe(
      "https://jstorrent.com/share/#dn=a%20b%23c%25zz%41%C3%A9",
    );
  });

  it("rejects anything that is not a magnet", () => {
    expect(() => shareLinkFromMagnet("https://example.com/")).toThrow();
  });
});
