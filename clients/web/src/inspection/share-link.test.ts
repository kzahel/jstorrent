import { describe, expect, it } from "vitest";

import { magnetSelectsFiles, shareLinkFromMagnet } from "./share-link";

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

  it("appends the display keys of one shared file after the magnet", () => {
    expect(
      shareLinkFromMagnet(
        "magnet:?xt=urn:btih:a88fda5954e89178c372716a6a78b8180ed4dad3&dn=Album&xl=900&so=2",
        { fileName: "02 Track & Field #1 é.flac", fileSize: "263000000" },
      ),
    ).toBe(
      "https://jstorrent.com/share/#xt=urn:btih:a88fda5954e89178c372716a6a78b8180ed4dad3" +
        "&dn=Album&xl=900&so=2" +
        "&jst.file=02%20Track%20%26%20Field%20%231%20%C3%A9.flac&jst.size=263000000",
    );
  });

  it("omits empty names and sizes that are not decimal digits", () => {
    expect(
      shareLinkFromMagnet("magnet:?xt=urn:btih:abcd", {
        fileName: "",
        fileSize: "12e3",
      }),
    ).toBe("https://jstorrent.com/share/#xt=urn:btih:abcd");
    expect(
      shareLinkFromMagnet("magnet:?xt=urn:btih:abcd", { fileSize: "0" }),
    ).toBe("https://jstorrent.com/share/#xt=urn:btih:abcd&jst.size=0");
  });
});

describe("magnetSelectsFiles", () => {
  it("finds a nonempty BEP 53 selection", () => {
    expect(magnetSelectsFiles("magnet:?xt=urn:btih:abcd&so=0,2-4")).toBe(true);
    expect(magnetSelectsFiles("magnet:?so.1=3&xt=urn:btih:abcd")).toBe(true);
    expect(magnetSelectsFiles("magnet:?xt=urn:btih:abcd&dn=so=1")).toBe(false);
    expect(magnetSelectsFiles("magnet:?xt=urn:btih:abcd&so=")).toBe(false);
  });
});
