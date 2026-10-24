import { describe, expect, it, vi } from "vitest";

import { CommandRejectedError } from "./command-error";
import type {
  CommandAccepted,
  InspectionCommand,
  MagnetExport,
  TorrentRow,
} from "./model";
import {
  exportShareLink,
  peerHintDecision,
  peerHintStatus,
  sharedLinksMessage,
  type ShareExport,
} from "./share-export";

const HASH = "a88fda5954e89178c372716a6a78b8180ed4dad3";
const TORRENT = "t1-0123456789abcdef0123456789abcdef";

function executor(
  respond: (command: InspectionCommand) => MagnetExport | Error,
) {
  return vi.fn(async (command: InspectionCommand): Promise<CommandAccepted> => {
    const response = respond(command);
    if (response instanceof Error) throw response;
    return { accepted: true, magnetExport: response };
  });
}

function plain(magnet: string): MagnetExport {
  return { magnet, source: "verbatim", omittedTrackerCount: 0 };
}

describe("exportShareLink", () => {
  it("asks for size and hint and reports the included address", async () => {
    const execute = executor(() => ({
      ...plain(`magnet:?xt=urn:btih:${HASH}&xl=900&x.pe=192.168.1.20:6881`),
      peerHints: [{ endpoint: "192.168.1.20:6881", scope: "local_network" }],
    }));
    const result = await exportShareLink(execute, {
      torrentId: TORRENT,
      peerHint: true,
    });
    expect(execute).toHaveBeenCalledWith({
      type: "export_magnet",
      torrentId: TORRENT,
      options: { includeSize: true, peerHint: true },
    });
    expect(result).toEqual({
      link: `https://jstorrent.com/share/#xt=urn:btih:${HASH}&xl=900&x.pe=192.168.1.20:6881`,
      omittedTrackerCount: 0,
      peerHints: [{ endpoint: "192.168.1.20:6881", scope: "local_network" }],
      peerHintOmission: null,
    });
  });

  it("sorts file indices and adds display keys for a single file only", async () => {
    const execute = executor((command) =>
      plain(
        command.type === "export_magnet" &&
          command.options?.fileIndices?.length === 1
          ? `magnet:?xt=urn:btih:${HASH}&xl=900&so=4`
          : `magnet:?xt=urn:btih:${HASH}&xl=900&so=1-2,4`,
      ),
    );
    const single = await exportShareLink(execute, {
      torrentId: TORRENT,
      peerHint: false,
      files: {
        fileIndices: [4],
        display: { fileName: "Movie (2026).mkv", fileSize: "123456" },
      },
    });
    expect(single.link).toBe(
      `https://jstorrent.com/share/#xt=urn:btih:${HASH}&xl=900&so=4` +
        "&jst.file=Movie%20(2026).mkv&jst.size=123456",
    );
    const several = await exportShareLink(execute, {
      torrentId: TORRENT,
      peerHint: false,
      files: {
        fileIndices: [4, 2, 1, 2],
        display: { fileName: "ignored", fileSize: "1" },
      },
    });
    expect(execute).toHaveBeenLastCalledWith({
      type: "export_magnet",
      torrentId: TORRENT,
      options: { includeSize: true, fileIndices: [1, 2, 4] },
    });
    expect(several.link).not.toContain("jst.");
  });

  it("falls back once to the plain export when a host rejects the options", async () => {
    const execute = executor((command) =>
      command.type === "export_magnet" && command.options !== undefined
        ? new CommandRejectedError("unknown field `options`", "invalid_request")
        : plain(`magnet:?xt=urn:btih:${HASH}`),
    );
    const result = await exportShareLink(execute, {
      torrentId: TORRENT,
      peerHint: true,
    });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenLastCalledWith({
      type: "export_magnet",
      torrentId: TORRENT,
    });
    expect(result.link).toBe(`https://jstorrent.com/share/#xt=urn:btih:${HASH}`);
    expect(result.peerHints).toEqual([]);
    expect(result.peerHintOmission).toBeNull();
  });

  it("does not retry other rejections or file shares", async () => {
    for (const code of ["invalid_torrent_state", "resource_limit", undefined]) {
      const execute = executor(
        () => new CommandRejectedError("refused", code),
      );
      await expect(
        exportShareLink(execute, { torrentId: TORRENT, peerHint: false }),
      ).rejects.toThrow("refused");
      expect(execute).toHaveBeenCalledTimes(1);
    }
    const execute = executor(
      () => new CommandRejectedError("bad index", "invalid_request"),
    );
    await expect(
      exportShareLink(execute, {
        torrentId: TORRENT,
        peerHint: false,
        files: { fileIndices: [9] },
      }),
    ).rejects.toThrow("bad index");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("refuses a file share from a host that ignored the selection", async () => {
    const execute = executor(() => plain(`magnet:?xt=urn:btih:${HASH}`));
    await expect(
      exportShareLink(execute, {
        torrentId: TORRENT,
        peerHint: false,
        files: { fileIndices: [0], display: { fileName: "a.txt" } },
      }),
    ).rejects.toThrow(
      "The JSTorrent you're connected to needs an update to share single files.",
    );
  });
});

describe("peer hint decision", () => {
  const row = (overrides: Partial<TorrentRow>) =>
    ({ sizeBytes: 100, privateTorrent: false, ...overrides }) as TorrentRow;

  it("follows the remembered choice for public torrents with metadata", () => {
    expect(peerHintDecision([row({})], "ask")).toBe("ask");
    expect(peerHintDecision([row({})], "include")).toBe(true);
    expect(peerHintDecision([row({})], "omit")).toBe(false);
  });

  it("never asks or hints for private torrents or before metadata", () => {
    expect(
      peerHintDecision([row({}), row({ privateTorrent: true })], "include"),
    ).toBe(false);
    expect(peerHintDecision([row({ privateTorrent: true })], "ask")).toBe(false);
    expect(peerHintDecision([row({ sizeBytes: null })], "ask")).toBe(false);
    expect(peerHintDecision([], "ask")).toBe(false);
  });
});

describe("share feedback", () => {
  const publicRow = { privateTorrent: false } as TorrentRow;
  const result = (overrides: Partial<ShareExport>): ShareExport => ({
    link: "https://jstorrent.com/share/#xt=urn:btih:abcd",
    omittedTrackerCount: 0,
    peerHints: [],
    peerHintOmission: null,
    ...overrides,
  });

  it("says whether the address is in the link", () => {
    expect(
      sharedLinksMessage(
        [publicRow],
        [result({ peerHints: [{ endpoint: "203.0.113.5:6881", scope: "internet" }] })],
        true,
      ),
    ).toBe("Share link copied with your address.");
    expect(
      sharedLinksMessage(
        [publicRow, publicRow],
        [
          result({ peerHints: [{ endpoint: "192.168.1.20:6881", scope: "local_network" }] }),
          result({}),
        ],
        true,
      ),
    ).toBe(
      "2 share links copied with your local network address. Only people on your network can use them to reach you.",
    );
    expect(
      sharedLinksMessage(
        [publicRow],
        [result({ peerHintOmission: "incoming_disabled" })],
        true,
      ),
    ).toBe(
      "Share link copied without your address because incoming connections are off.",
    );
    expect(
      sharedLinksMessage(
        [publicRow],
        [result({ peerHintOmission: "not_reachable" })],
        true,
      ),
    ).toBe(
      "Share link copied without your address because it couldn't be confirmed reachable.",
    );
  });

  it("keeps the plain messages when no hint was asked for or reported", () => {
    expect(sharedLinksMessage([publicRow], [result({})], true)).toBe(
      "Share link copied",
    );
    expect(sharedLinksMessage([publicRow], [result({})], false)).toBe(
      "Share link copied",
    );
    expect(
      sharedLinksMessage(
        [{ privateTorrent: true } as TorrentRow],
        [result({})],
        false,
      ),
    ).toBe(
      "Share link copied. This torrent is private, so the link only works for members of its tracker.",
    );
  });

  it("describes the address for the Share panel", () => {
    expect(peerHintStatus(result({}))).toBeNull();
    expect(
      peerHintStatus(
        result({
          peerHints: [
            { endpoint: "203.0.113.5:6881", scope: "internet" },
            { endpoint: "[2001:db8::1]:6881", scope: "internet" },
          ],
        }),
      ),
    ).toBe("Includes your address 203.0.113.5:6881, [2001:db8::1]:6881.");
    expect(peerHintStatus(result({ peerHintOmission: "no_address" }))).toBe(
      "Your address isn't included because no usable address was found.",
    );
  });
});
