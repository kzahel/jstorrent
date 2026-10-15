import { describe, expect, it } from "vitest";

import { DEFAULT_CLIENT_SETTINGS_RUNTIME_VIEW } from "../api";
import type {
  InspectionSnapshot,
  PeerRow,
  PeerSet,
  TorrentRow,
} from "./model";
import { createInspectionStore, emptyDiskSet } from "./state";

describe("inspection store", () => {
  it("retains a command-result reveal until the target row arrives", () => {
    const store = createInspectionStore(null);
    store.getState().applyUpdate({
      type: "snapshot",
      snapshot: snapshot([row("first", "downloading")]),
    });
    store.getState().selectTorrentCategory("paused");
    store.getState().revealTorrent("added");
    expect(store.getState().presentation.pendingRevealTorrentId).toBe("added");
    expect(store.getState().presentation.currentTorrentId).toBeNull();

    store.getState().applyUpdate({
      type: "patch",
      revision: 2,
      torrents: {
        upsert: [row("added", "downloading")],
        removed: [],
        order: ["first", "added"],
      },
    });
    expect(store.getState().presentation.currentTorrentId).toBe("added");
    expect(store.getState().presentation.selectedTorrentIds).toEqual(["added"]);
    expect(store.getState().presentation.transfersCategory).toBe("all");
    expect(store.getState().presentation.pendingRevealTorrentId).toBeNull();
    expect(store.getState().presentation.detailOpen).toBe(false);
  });
  it("preserves unrelated row references across keyed patches", () => {
    const store = createInspectionStore();
    const first = row("first", "downloading");
    const second = row("second", "paused");
    store.getState().applyUpdate({
      type: "snapshot",
      snapshot: snapshot([first, second]),
    });
    const retained = store.getState().torrents.second;
    store.getState().applyUpdate({
      type: "patch",
      revision: 2,
      torrents: {
        upsert: [{ ...first, progress: 0.7 }],
        removed: [],
      },
    });
    expect(store.getState().torrents.second).toBe(retained);
    expect(store.getState().torrents.first?.progress).toBe(0.7);
  });

  it("keeps the current peer through live snapshots while its connection remains", () => {
    const store = createInspectionStore();
    const first = peer("7", "first");
    store.getState().applyUpdate({
      type: "snapshot",
      snapshot: snapshot([row("first", "downloading")], [first]),
    });
    store.getState().setCurrentPeer(first.connectionId);

    store.getState().applyUpdate({
      type: "snapshot",
      snapshot: snapshot(
        [row("first", "downloading")],
        [{ ...first, downloadRate: 2 }],
      ),
    });
    expect(store.getState().presentation.currentPeerId).toBe(first.connectionId);

    store.getState().applyUpdate({
      type: "snapshot",
      snapshot: snapshot([row("first", "downloading")]),
    });
    expect(store.getState().presentation.currentPeerId).toBeNull();
  });

  it("clears the current peer when a keyed patch removes its connection", () => {
    const store = createInspectionStore();
    const first = peer("7", "first");
    store.getState().applyUpdate({
      type: "snapshot",
      snapshot: snapshot([row("first", "downloading")], [first]),
    });
    store.getState().setCurrentPeer(first.connectionId);

    store.getState().applyUpdate({
      type: "patch",
      revision: 2,
      peers: [
        {
          torrentId: "first",
          upsert: [],
          removed: [first.connectionId],
          order: [],
        },
      ],
    });

    expect(store.getState().presentation.currentPeerId).toBeNull();
  });

  it("opens session views alone and keeps narrow torrent details on torrent tabs", () => {
    const store = createInspectionStore(null);
    store.getState().applyUpdate({
      type: "snapshot",
      snapshot: snapshot([row("first", "downloading")]),
    });
    store.getState().selectDestination("library");
    store.getState().setLayout("phone");
    store.getState().openSessionView("speed");
    expect(store.getState().presentation).toMatchObject({
      destination: "workbench",
      activeTab: "speed",
      detailOpen: true,
      sidebarOpen: false,
    });

    store.getState().closeDetail();
    store.getState().openTorrentDetail("first");
    expect(store.getState().presentation.activeTab).toBe("general");

    store.getState().setLayout("wide");
    store.getState().selectTab("logs");
    store.getState().openTorrentDetail("first");
    expect(store.getState().presentation.activeTab).toBe("logs");
  });

  it("clears a removed singleton selection without inventing a fallback", () => {
    const store = createInspectionStore();
    store.getState().applyUpdate({
      type: "snapshot",
      snapshot: snapshot([
        row("first", "downloading"),
        row("second", "paused"),
      ]),
    });
    store.getState().openTorrentDetail("second");
    store.getState().applyUpdate({
      type: "patch",
      revision: 2,
      torrents: { upsert: [], removed: ["second"], order: ["first"] },
    });
    expect(store.getState().presentation.currentTorrentId).toBeNull();
    expect(store.getState().presentation.selectedTorrentIds).toEqual([]);
    expect(store.getState().presentation.detailOpen).toBe(false);
  });

  it("keeps current constrained to the checked torrent selection", () => {
    const store = createInspectionStore(null);
    store.getState().applyUpdate({
      type: "snapshot",
      snapshot: snapshot([
        row("first", "downloading"),
        row("second", "paused"),
        row("third", "complete"),
      ]),
    });
    expect(store.getState().presentation.currentTorrentId).toBe("first");
    expect(store.getState().presentation.selectedTorrentIds).toEqual(["first"]);

    store
      .getState()
      .setTorrentSelection(["first", "second", "second", "third"], "second");
    expect(store.getState().presentation.currentTorrentId).toBe("second");
    expect(store.getState().presentation.selectedTorrentIds).toEqual([
      "first",
      "second",
      "third",
    ]);
    store.getState().openTorrentDetail("first");
    expect(store.getState().presentation.currentTorrentId).toBe("first");
    expect(store.getState().presentation.selectedTorrentIds).toEqual([
      "first",
      "second",
      "third",
    ]);
    expect(store.getState().presentation.detailOpen).toBe(true);

    store.getState().applyUpdate({
      type: "patch",
      revision: 2,
      torrents: {
        upsert: [],
        removed: ["first"],
        order: ["second", "third"],
      },
    });
    expect(store.getState().presentation.selectedTorrentIds).toEqual([
      "second",
      "third",
    ]);
    expect(store.getState().presentation.currentTorrentId).toBe("second");
    expect(store.getState().presentation.detailOpen).toBe(false);

    store.getState().selectOnlyTorrent("third");
    expect(store.getState().presentation.currentTorrentId).toBe("third");
    expect(store.getState().presentation.selectedTorrentIds).toEqual(["third"]);
    store.getState().clearTorrentSelection();
    expect(store.getState().presentation.currentTorrentId).toBeNull();
    expect(store.getState().presentation.selectedTorrentIds).toEqual([]);
    store.getState().applyUpdate({
      type: "patch",
      revision: 3,
      torrents: {
        upsert: [{ ...row("third", "paused"), progress: 0.5 }],
        removed: [],
      },
    });
    expect(store.getState().presentation.currentTorrentId).toBeNull();
    expect(store.getState().presentation.selectedTorrentIds).toEqual([]);
  });

  it("drops selected torrents a newly chosen category hides", () => {
    const store = createInspectionStore(null);
    store.getState().applyUpdate({
      type: "snapshot",
      snapshot: snapshot([
        row("first", "downloading"),
        row("second", "paused"),
        row("third", "complete"),
      ]),
    });
    store.getState().openTorrentDetail("first");
    store.getState().setTorrentSelection(["first", "second", "third"], "first");

    store.getState().selectTorrentCategory("paused");
    expect(store.getState().presentation).toMatchObject({
      workbenchCategory: "paused",
      currentTorrentId: "second",
      selectedTorrentIds: ["second"],
      detailOpen: true,
    });

    store.getState().selectTorrentCategory("completed");
    expect(store.getState().presentation).toMatchObject({
      currentTorrentId: null,
      selectedTorrentIds: [],
      detailOpen: false,
    });

    store.getState().setTorrentSelection(["third"], "third");
    store.getState().selectTorrentCategory("all");
    expect(store.getState().presentation).toMatchObject({
      currentTorrentId: "third",
      selectedTorrentIds: ["third"],
    });
  });

  it("keeps the drawer open across destinations and closes it on a category", () => {
    const store = createInspectionStore(null);
    store.getState().toggleSidebar();

    store.getState().selectDestination("library");
    expect(store.getState().presentation.sidebarOpen).toBe(true);

    store.getState().selectLibraryCategory("recent");
    expect(store.getState().presentation.sidebarOpen).toBe(false);
  });

  it("keeps destination filters independent and persists navigation", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const store = createInspectionStore(storage);
    expect(store.getState().presentation.destination).toBe("workbench");

    store.getState().selectDestination("transfers");

    store.getState().selectTorrentCategory("paused");
    store.getState().selectDestination("workbench");
    store.getState().selectTorrentCategory("errors");
    store.getState().selectDestination("library");
    store.getState().selectLibraryCategory("available");

    const presentation = store.getState().presentation;
    expect(presentation.transfersCategory).toBe("paused");
    expect(presentation.workbenchCategory).toBe("errors");
    expect(presentation.libraryCategory).toBe("available");
    expect(
      createInspectionStore(storage).getState().presentation,
    ).toMatchObject({
      destination: "library",
      transfersCategory: "paused",
      workbenchCategory: "errors",
      libraryCategory: "available",
    });
  });

  it("keeps Library detail state separate from Workbench detail", () => {
    const store = createInspectionStore();
    store.getState().applyUpdate({
      type: "snapshot",
      snapshot: snapshot([row("show", "downloading")]),
    });

    store.getState().openLibraryTorrentDetail("show");
    expect(store.getState().presentation).toMatchObject({
      destination: "library",
      currentTorrentId: "show",
      libraryDetailOpen: true,
      libraryDetailMode: "media",
    });
    store.getState().selectLibraryDetailMode("files");
    expect(store.getState().presentation.libraryDetailMode).toBe("files");
    store.getState().closeLibraryTorrentDetail();
    expect(store.getState().presentation.libraryDetailOpen).toBe(false);

    store.getState().openLibraryTorrentDetail("show");
    store.getState().openTorrentInWorkbench("show");
    expect(store.getState().presentation).toMatchObject({
      destination: "workbench",
      detailOpen: true,
      libraryDetailOpen: false,
    });
  });

  it("opens an errored torrent directly at its General error detail", () => {
    const store = createInspectionStore();
    const failed = {
      ...row("failed", "error"),
      error: "Write failed: destination has no free space",
    };
    store.getState().applyUpdate({
      type: "snapshot",
      snapshot: snapshot([row("other", "paused"), failed]),
    });
    store.getState().setTorrentSelection(["other", "failed"], "other");

    store.getState().openTorrentErrorDetail("failed");

    expect(store.getState().presentation).toMatchObject({
      destination: "workbench",
      currentTorrentId: "failed",
      selectedTorrentIds: ["failed"],
      activeTab: "general",
      detailOpen: true,
      detailTarget: { type: "torrent_error", torrentId: "failed" },
    });
    store.getState().clearDetailTarget();
    expect(store.getState().presentation.detailTarget).toBeNull();
  });

  it("bounds retained diagnostic rows and reports drops", () => {
    const store = createInspectionStore();
    store.getState().applyUpdate({ type: "snapshot", snapshot: snapshot([]) });
    store.getState().applyUpdate({
      type: "patch",
      revision: 2,
      logs: {
        append: Array.from({ length: 10_000 }, (_, index) => ({
          id: String(index),
          timestampMs: index,
          severity: "info" as const,
          category: "test",
          code: "bounded",
          message: "bounded",
          torrentId: null,
          subjects: [],
          fields: [],
        })),
        sourceEvictedCount: 2,
        retainedFromSequence: "1",
        deliveryResetCount: 0,
        lastDeliveryResetReason: null,
      },
    });
    expect(store.getState().logs).toHaveLength(2_048);
    expect(store.getState().logLoss.sourceEvictedCount).toBe(2);
    expect(store.getState().logLoss.localEvictedCount).toBe(7_952);
  });

  it("keeps the detail pane size within its usable range", () => {
    const store = createInspectionStore();
    expect(store.getState().presentation.detailPanePercent).toBe(57);

    store.getState().setDetailPanePercent(10);
    expect(store.getState().presentation.detailPanePercent).toBe(25);
    store.getState().setDetailPanePercent(95);
    expect(store.getState().presentation.detailPanePercent).toBe(80);
    store.getState().setDetailPanePercent(Number.NaN);
    expect(store.getState().presentation.detailPanePercent).toBe(57);
  });

  it("defaults and persists complete appearance presentation state", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const store = createInspectionStore(storage);
    expect(store.getState().presentation.interfaceSize).toBe("standard");
    expect(store.getState().presentation.colorTheme).toBe("auto");
    expect(store.getState().presentation.dataUnits).toBe("binary");

    store.getState().setColorTheme("dark");
    store.getState().setDataUnits("decimal");
    store.getState().setInterfaceSize("spacious");
    expect(store.getState().presentation.interfaceSize).toBe("spacious");
    expect(store.getState().presentation.colorTheme).toBe("dark");
    expect(store.getState().presentation.dataUnits).toBe("decimal");
    expect(
      JSON.parse(values.get("rstorrent.presentation.appearance") ?? "null"),
    ).toEqual({
      version: 3,
      interfaceSize: "spacious",
      colorTheme: "dark",
      dataUnits: "decimal",
    });
    const restored = createInspectionStore(storage).getState().presentation;
    expect(restored.interfaceSize).toBe("spacious");
    expect(restored.colorTheme).toBe("dark");
    expect(restored.dataUnits).toBe("decimal");
  });

  it("keeps live data-unit changes when browser storage writes fail", () => {
    const store = createInspectionStore({
      getItem: () => null,
      setItem: () => {
        throw new Error("denied");
      },
    });

    expect(() => store.getState().setDataUnits("decimal")).not.toThrow();
    expect(store.getState().presentation.dataUnits).toBe("decimal");
  });
});

function row(id: string, status: TorrentRow["status"]): TorrentRow {
  return {
    id,
    name: id,
    status,
    operationalState:
      status === "metadata"
        ? "starting"
        : status === "complete"
          ? "seeding"
          : status,
    queuePosition: null,
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
    seedAdmission: status === "complete" ? "active" : "ineligible",
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
  };
}

function peer(connectionId: string, torrentId: string): PeerRow {
  return {
    connectionId,
    torrentId,
    state: "connected",
    endpoint: "127.0.0.1:51413",
    client: "test peer",
    source: "manual",
    progress: null,
    downloadRate: 1,
    uploadRate: 0,
    downloadedBytes: 1,
    uploadedBytes: 0,
    requestsPending: 1,
    oldestRequestMs: 1,
    connectedAgeMs: 1,
    lastPayloadAgeMs: 1,
    flags: [],
    mseMethod: null,
    useful: true,
  };
}

function snapshot(
  rows: readonly TorrentRow[],
  peers: readonly PeerRow[] = [],
): InspectionSnapshot {
  const peersByTorrent: Record<string, PeerSet> = {};
  for (const item of peers) {
    const current = peersByTorrent[item.torrentId] ?? { order: [], rows: {} };
    peersByTorrent[item.torrentId] = {
      order: [...current.order, item.connectionId],
      rows: { ...current.rows, [item.connectionId]: item },
    };
  }
  return {
    revision: 1,
    durableRevision: "1",
    session: {
      connection: { type: "demo" },
      downloadRate: 0,
      uploadRate: 0,
      dhtNodes: 0,
      knownPeers: 0,
    },
    demo: null,
    storage: { roots: [], defaultRoot: null, showAddOptions: true },
    clientSettings: structuredClone(DEFAULT_CLIENT_SETTINGS_RUNTIME_VIEW),
    torrentOrder: rows.map((item) => item.id),
    torrents: Object.fromEntries(rows.map((item) => [item.id, item])),
    peersByTorrent,
    swarmByTorrent: {},
    filesByTorrent: {},
    mediaByTorrent: {},
    trackersByTorrent: {},
    piecesByTorrent: {},
    disk: emptyDiskSet(),
    dht: null,
    speed: null,
    logs: [],
    logLoss: {
      sourceEvictedCount: 0,
      retainedFromSequence: "1",
      localEvictedCount: 0,
      deliveryResetCount: 0,
      lastDeliveryResetReason: null,
    },
    viewStatus: {
      library: { status: "ready" },
      torrentSummary: { status: "not_requested" },
      peers: { status: "not_requested" },
      swarm: { status: "not_requested" },
      files: { status: "not_requested" },
      media: { status: "not_requested" },
      trackers: { status: "not_requested" },
      pieces: { status: "not_requested" },
      disk: { status: "not_requested" },
      dht: { status: "not_requested" },
      speed: { status: "not_requested" },
      logs: { status: "not_requested" },
    },
  };
}
