import { describe, expect, it } from "vitest";

import {
  MAX_TORRENT_INPUT_BYTES,
  magnetLabel,
  splitTorrentInputList,
  validateTorrentInput,
} from "./torrentInput";

describe("validateTorrentInput", () => {
  it("trims and accepts a bounded magnet link", () => {
    expect(
      validateTorrentInput(
        "  magnet:?xt=urn:btih:000102030405060708090a0b0c0d0e0f10111213  ",
      ),
    ).toEqual({
      accepted: true,
      magnet: "magnet:?xt=urn:btih:000102030405060708090a0b0c0d0e0f10111213",
    });
  });

  it("distinguishes empty, remote, file, and malformed input", () => {
    expect(validateTorrentInput("   ")).toMatchObject({
      accepted: false,
      message: expect.stringContaining("file selection"),
    });
    expect(validateTorrentInput("https://example.test/file.torrent")).toMatchObject({
      accepted: false,
      message: expect.stringContaining("Remote .torrent URLs"),
    });
    expect(validateTorrentInput("file:///tmp/file.torrent")).toMatchObject({
      accepted: false,
      message: expect.stringContaining("file selection"),
    });
    expect(validateTorrentInput("not a magnet")).toEqual({
      accepted: false,
      message: "Enter a magnet link beginning with magnet:?",
    });
  });

  it("bounds the UTF-8 input before application dispatch", () => {
    const oversized = `magnet:?xt=urn:btih:${"é".repeat(MAX_TORRENT_INPUT_BYTES)}`;
    expect(validateTorrentInput(oversized)).toMatchObject({
      accepted: false,
      message: expect.stringContaining("16,384 bytes"),
    });
  });
});

describe("splitTorrentInputList", () => {
  const first = "magnet:?xt=urn:btih:000102030405060708090a0b0c0d0e0f10111213&dn=First";
  const second = "magnet:?xt=urn:btih:1111111111111111111111111111111111111111";

  it("keeps a single item on the one-link path", () => {
    expect(splitTorrentInputList(`  ${first}  `)).toBeNull();
    expect(splitTorrentInputList("not a magnet")).toBeNull();
  });

  it("splits several links on any whitespace and keeps stray items to report", () => {
    expect(splitTorrentInputList(`${first}\n\t${second} junk`)).toEqual([
      first,
      second,
      "junk",
    ]);
  });

  it("names a link by its display name when it has one", () => {
    expect(magnetLabel(first)).toBe("First");
    expect(magnetLabel(second)).toBe(second);
    const long = `${second}&tr=${"x".repeat(100)}`;
    expect(magnetLabel(long)).toBe(`${long.slice(0, 79)}…`);
    expect(magnetLabel("junk")).toBe("junk");
  });
});
