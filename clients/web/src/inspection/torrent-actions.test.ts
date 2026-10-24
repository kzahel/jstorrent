import { describe, expect, it } from "vitest";

import type { TorrentRow } from "./model";
import {
  TORRENT_ACTIONS,
  orderedSelectedTorrentRows,
  torrentActionAvailability,
  torrentActionsForPlacement,
} from "./torrent-actions";

describe("torrent selection actions", () => {
  it("keeps direct plus overflow actions equal to the context action set", () => {
    const toolbarUnion = [
      ...torrentActionsForPlacement("direct"),
      ...torrentActionsForPlacement("overflow"),
    ].map((action) => action.id);
    expect(new Set(toolbarUnion)).toEqual(
      new Set(TORRENT_ACTIONS.map((action) => action.id)),
    );
    expect(TORRENT_ACTIONS.map((action) => [action.group, action.id])).toEqual([
      ["transfer", "start"],
      ["transfer", "pause"],
      ["transfer", "force_recheck"],
      ["transfer", "move_to_top"],
      ["transfer", "move_to_bottom"],
      ["sharing", "copy_magnet"],
      ["sharing", "copy_share_link"],
      ["organization", "settings"],
      ["organization", "archive"],
      ["organization", "restore"],
      ["destructive", "remove"],
    ]);
  });

  it("orders complete hidden selections by application order", () => {
    const torrents = Object.fromEntries(
      ["a", "b", "c"].map((id) => [id, row(id)]),
    );
    expect(
      orderedSelectedTorrentRows(
        ["c", "a", "b"],
        torrents,
        new Set(["a", "c"]),
      ).map((target) => target.id),
    ).toEqual(["c", "a"]);
  });

  it("normalizes mixed states and never selects an eligible subset", () => {
    const mixed = [row("paused", { status: "paused" }), row("running")];
    expect(torrentActionAvailability("start", mixed).disabled).toBe(false);
    expect(torrentActionAvailability("pause", mixed).disabled).toBe(false);
    expect(torrentActionAvailability("move_to_top", mixed).disabled).toBe(false);
    expect(torrentActionAvailability("archive", mixed).disabled).toBe(false);
    expect(torrentActionAvailability("restore", mixed).disabled).toBe(true);

    const recheckMixed = [
      row("ready"),
      row("missing", { forceRecheckAvailable: false }),
    ];
    expect(torrentActionAvailability("force_recheck", recheckMixed)).toEqual({
      disabled: true,
      reason: "1 selected torrent does not have managed content available to recheck.",
    });
    expect(
      torrentActionAvailability("move_to_bottom", [
        row("complete", { queuePosition: null }),
      ]),
    ).toEqual({
      disabled: true,
      reason: "1 selected torrent is not in the download queue.",
    });
  });

  it("requires restore before starting or queueing archived torrents", () => {
    const archived = row("archived", { archived: true, status: "paused" });
    for (const action of ["start", "move_to_top", "move_to_bottom"] as const) {
      expect(torrentActionAvailability(action, [archived])).toEqual({
        disabled: true,
        reason: "A selected torrent is archived. Restore it first.",
      });
    }
    expect(
      torrentActionAvailability("start", [
        archived,
        row("other", { archived: true }),
        row("active"),
      ]),
    ).toEqual({
      disabled: true,
      reason: "2 selected torrents are archived. Restore them first.",
    });
    for (const action of ["pause", "force_recheck", "copy_magnet", "restore", "remove"] as const) {
      expect(torrentActionAvailability(action, [archived]).disabled).toBe(false);
    }
  });

  it("requires a pending file selection to finish before archiving", () => {
    expect(
      torrentActionAvailability("archive", [row("pending", { awaitingFileSelection: true })]),
    ).toEqual({
      disabled: true,
      reason: "Confirm or cancel the pending file selection before archiving.",
    });
  });

  it("keeps copy available but blocks mutations during removal", () => {
    const targets = [row("removing", { removalState: "pending" })];
    expect(torrentActionAvailability("copy_magnet", targets).disabled).toBe(false);
    expect(torrentActionAvailability("pause", targets).disabled).toBe(true);
    expect(torrentActionAvailability("remove", targets).disabled).toBe(true);
  });

  it("opens settings for one torrent only", () => {
    expect(torrentActionAvailability("settings", [])).toEqual({
      disabled: true,
      reason: "Select a torrent to use this action.",
    });
    expect(torrentActionAvailability("settings", [row("a")])).toEqual({
      disabled: false,
    });
    expect(torrentActionAvailability("settings", [row("a"), row("b")])).toEqual({
      disabled: true,
      reason: "Select one torrent to edit its settings.",
    });
  });
});

function row(id: string, overrides: Partial<TorrentRow> = {}): TorrentRow {
  return {
    id,
    name: id,
    status: "downloading",
    operationalState: "downloading",
    queuePosition: 1,
    transferLimits: {
      upload: { type: "unlimited" },
      download: { type: "unlimited" },
    },
    sizeBytes: 100,
    progress: 0.5,
    checking: null,
    downloadRate: 1,
    uploadRate: 0,
    downloadedBytes: 50,
    uploadedBytes: 0,
    peersConnected: 1,
    peersKnown: 2,
    configuredTrackerCount: 0,
    requiredPayloadBytes: "100",
    remainingPayloadBytes: "50",
    etaDownloadRateBytes: "1",
    eta: { state: "estimate", seconds: "50" },
    lifetimeUploadedBytes: "0",
    lifetimeDownloadedBytes: "50",
    activeSeconds: "0",
    finishedSeconds: "0",
    seedingSeconds: "0",
    shareRatioHundredths: "0",
    seedAdmission: "ineligible",
    seedGoal: null,
    addedAtMs: 1,
    archived: false,
    removalState: null,
    deleteDataSupported: true,
    forceRecheckAvailable: true,
    privateTorrent: false,
    infoHash: id,
    error: null,
    progressReason: "test",
    ...overrides,
  };
}
