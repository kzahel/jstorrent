import { afterEach, describe, expect, it, vi } from "vitest";

import { InspectionController } from "../controller";
import { DemoApplication } from "./DemoApplication";

afterEach(() => {
  vi.useRealTimers();
});

describe("DemoApplication", () => {
  it("advances a deterministic healthy download and joins its clock", async () => {
    vi.useFakeTimers();
    const application = new DemoApplication({
      scenarioId: "healthy-download",
      running: true,
      tickMs: 1_000,
    });
    const controller = new InspectionController(application);
    controller.start();

    expect(controller.store.getState().torrentOrder).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(8_000);
    const torrent = controller.store.getState().torrents[
      controller.store.getState().torrentOrder[0]!
    ];
    expect(torrent?.status).toBe("downloading");
    expect(torrent?.progress).toBeGreaterThan(0);

    await controller.close();
    const revision = controller.store.getState().revision;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(controller.store.getState().revision).toBe(revision);
  });

  it("recovers a tracker cohort and represents reconnect as a new identity", async () => {
    const application = new DemoApplication({
      scenarioId: "tracker-recovery",
      running: false,
    });
    const controller = new InspectionController(application);
    controller.start();
    controller.store.getState().selectDestination("workbench");
    await Promise.resolve();
    const torrentId = controller.store.getState().torrentOrder[0]!;
    expect(controller.store.getState().peersByTorrent[torrentId]?.order).toHaveLength(0);
    controller.store.getState().selectTab("trackers");
    await vi.waitFor(() => {
      expect(
        controller.store.getState().trackersByTorrent[torrentId]?.rows[
          "udp://tracker.openbittorrent.com:80"
        ]?.status,
      ).toBe("announcing");
    });

    await controller.dispatch({
      type: "advance_demo_clock",
      milliseconds: 24_000,
    });
    expect(controller.store.getState().torrents[torrentId]?.peersKnown).toBe(42);
    const recoveredTracker =
      controller.store.getState().trackersByTorrent[torrentId]?.rows[
        "udp://tracker.openbittorrent.com:80"
      ];
    expect(recoveredTracker).toMatchObject({
      status: "reannounce_wait",
      lastConnectionFamily: "ipv4",
      lastPeerCount: 42,
      seeders: 31,
      leechers: 11,
      consecutiveFailures: 0,
      error: null,
    });
    controller.store.getState().selectTab("peers");
    await vi.waitFor(() => {
      expect(
        controller.store.getState().peersByTorrent[torrentId]?.order,
      ).toHaveLength(14);
    });
    const originalConnection = controller.store.getState().peersByTorrent[
      torrentId
    ]?.order[0];
    await controller.dispatch({
      type: "advance_demo_clock",
      milliseconds: 22_000,
    });
    const nextPeerSet = controller.store.getState().peersByTorrent[torrentId];
    expect(nextPeerSet?.rows[originalConnection!]).toBeUndefined();
    expect(nextPeerSet?.order[0]).toContain("reconnect");
    await controller.close();
  });

  it("exports share options: size, file selection and a fake LAN hint", async () => {
    const application = new DemoApplication({
      scenarioId: "healthy-download",
      elapsedMs: 42_000,
      running: false,
    });
    const controller = new InspectionController(application);
    controller.start();
    const torrentId = controller.store.getState().torrentOrder[0]!;
    const torrent = controller.store.getState().torrents[torrentId]!;
    const base =
      "magnet:?xt=urn:btih:a962f460b83861cfb5faa1d7ad7da9c3f3cc2fc4" +
      "&dn=Big%20Buck%20Bunny%201080p%20surround";
    await expect(
      controller.execute({
        type: "export_magnet",
        torrentId,
        options: { includeSize: true, fileIndices: [3, 0, 1], peerHint: true },
      }),
    ).resolves.toMatchObject({
      magnetExport: {
        magnet: `${base}&xl=${torrent.sizeBytes}&so=0-1,3&x.pe=192.168.1.20:6881`,
        peerHints: [{ endpoint: "192.168.1.20:6881", scope: "local_network" }],
      },
    });
    await controller.close();

    const stalled = new InspectionController(
      new DemoApplication({
        scenarioId: "stalled-metadata",
        elapsedMs: 4_000,
        running: false,
      }),
    );
    stalled.start();
    const pending = stalled.store.getState().torrentOrder[0]!;
    expect(stalled.store.getState().torrents[pending]?.sourceSizeBytes).toBe(276_445_467);
    await expect(
      stalled.execute({
        type: "export_magnet",
        torrentId: pending,
        options: { includeSize: true, peerHint: true },
      }),
    ).resolves.toMatchObject({
      magnetExport: { peerHints: [], peerHintOmission: "metadata_pending" },
    });
    await expect(
      stalled.execute({
        type: "export_magnet",
        torrentId: pending,
        options: { fileIndices: [0] },
      }),
    ).rejects.toThrow("metadata is not available");
    await stalled.close();
  });

  it("applies pause, archive, add, and reset commands", async () => {
    const application = new DemoApplication({
      scenarioId: "healthy-download",
      elapsedMs: 42_000,
      running: false,
    });
    const controller = new InspectionController(application);
    controller.start();
    const torrentId = controller.store.getState().torrentOrder[0]!;

    await controller.dispatch({ type: "pause", torrentId });
    expect(controller.store.getState().torrents[torrentId]?.status).toBe("paused");
    await controller.dispatch({ type: "archive", torrentId });
    expect(controller.store.getState().torrents[torrentId]?.archived).toBe(true);
    await expect(
      controller.execute({ type: "export_magnet", torrentId }),
    ).resolves.toMatchObject({
      accepted: true,
      magnetExport: {
        magnet:
          "magnet:?xt=urn:btih:a962f460b83861cfb5faa1d7ad7da9c3f3cc2fc4" +
          "&dn=Big%20Buck%20Bunny%201080p%20surround",
        source: "synthesized",
        omittedTrackerCount: 0,
      },
    });
    await controller.dispatch({ type: "add_demo_torrent" });
    expect(controller.store.getState().torrentOrder).toHaveLength(4);
    await expect(
      controller.dispatch({
        type: "add_magnet",
        magnet:
          "magnet:?xt=urn:btih:000102030405060708090a0b0c0d0e0f10111213",
        storageRoot: "root_a",
        startContent: true,
      }),
    ).rejects.toThrow("unavailable in demo scenarios");
    await controller.dispatch({ type: "reset_demo" });
    expect(controller.store.getState().torrentOrder).toHaveLength(3);
    expect(controller.store.getState().demo?.elapsedMs).toBe(0);
    await controller.close();
  });

  it("materializes the bounded scale fixture without starting a timer", async () => {
    vi.useFakeTimers();
    const application = new DemoApplication({
      scenarioId: "large-swarm",
      running: false,
    });
    const controller = new InspectionController(application);
    controller.start();
    controller.store.getState().selectDestination("workbench");
    await Promise.resolve();
    const state = controller.store.getState();
    const torrentId = state.torrentOrder[0]!;
    expect(state.torrentOrder).toHaveLength(2_000);
    expect(state.peersByTorrent[torrentId]?.order).toHaveLength(10_000);
    controller.store.getState().selectTab("swarm");
    await vi.waitFor(() => {
      expect(controller.store.getState().swarmByTorrent[torrentId]?.order).toHaveLength(1_000);
    });
    const revision = controller.store.getState().revision;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(controller.store.getState().revision).toBe(revision);
    await controller.close();
  });
});
