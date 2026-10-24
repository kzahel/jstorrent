import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_CLIENT_SETTINGS_RUNTIME_VIEW } from "../api";
import type { InspectionSnapshot, TorrentRow } from "./model";
import { installRouteHistory, type RouteHistoryWindow } from "./route-history";
import { createInspectionStore, emptyDiskSet, type InspectionStoreApi } from "./state";

/** Session history with the browser's asynchronous traversal. */
class FakeWindow implements RouteHistoryWindow {
  readonly entries: { state: unknown; url: string }[];
  index = 0;
  private readonly listeners = new Set<() => void>();

  constructor(url: string) {
    this.entries = [{ state: null, url }];
  }

  get location() {
    const url = new URL(this.entries[this.index]!.url, "http://host");
    return { hash: url.hash, pathname: url.pathname, search: url.search };
  }

  readonly history = {
    owner: this as FakeWindow,
    get state() {
      return this.owner.entries[this.owner.index]!.state;
    },
    pushState(state: unknown, _unused: string, url?: string | URL | null) {
      this.owner.entries.splice(this.owner.index + 1);
      this.owner.entries.push({ state, url: String(url) });
      this.owner.index += 1;
    },
    replaceState(state: unknown, _unused: string, url?: string | URL | null) {
      this.owner.entries[this.owner.index] = { state, url: String(url) };
    },
    back() {
      this.owner.traverse(-1);
    },
  };

  /** Back or Forward as the user presses it. */
  traverse(delta: number): void {
    const next = this.index + delta;
    if (next < 0 || next >= this.entries.length) return;
    queueMicrotask(() => {
      this.index = next;
      for (const listener of this.listeners) listener();
    });
  }

  addEventListener(type: "popstate" | "hashchange", listener: () => void): void {
    // Hash navigation fires both; one listener stands for both here.
    if (type === "popstate") this.listeners.add(listener);
  }

  removeEventListener(type: "popstate" | "hashchange", listener: () => void): void {
    if (type === "popstate") this.listeners.delete(listener);
  }
}

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

function install(url: string): { store: InspectionStoreApi; view: FakeWindow } {
  const store = createInspectionStore(null);
  const view = new FakeWindow(url);
  disposers.push(installRouteHistory(store, view));
  return { store, view };
}

function load(store: InspectionStoreApi): void {
  store.getState().applyUpdate({ type: "snapshot", snapshot: snapshot(["a", "b"]) });
}

const settle = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe("route history", () => {
  it("writes the screen into the fragment and keeps the page query", () => {
    const { store, view } = install("/?demo=healthy-download");
    expect(view.location.hash).toBe("#/torrents");
    load(store);
    expect(view.entries).toHaveLength(1);
    expect(view.location.search).toBe("?demo=healthy-download");
    expect(view.location.hash).toBe("#/torrents?torrent=a");
  });

  it("applies a deep link once the first snapshot can check its torrent", () => {
    const { store, view } = install("/#/library?torrent=b&view=files&settings=about");
    // The store's defaults do not overwrite the link before the snapshot.
    store.getState().setLayout("wide");
    expect(view.location.hash).toBe("#/library?torrent=b&view=files&settings=about");
    load(store);
    const presentation = store.getState().presentation;
    expect(presentation.destination).toBe("library");
    expect(presentation.libraryDetailOpen).toBe(true);
    expect(presentation.currentTorrentId).toBe("b");
    expect(presentation.libraryDetailMode).toBe("files");
    expect(presentation.settingsCategory).toBe("about");
    expect(view.location.hash).toBe("#/library?torrent=b&view=files&settings=about");
  });

  it("drops a torrent the host does not have", () => {
    const { store, view } = install("/#/library?torrent=gone");
    load(store);
    expect(store.getState().presentation.libraryDetailOpen).toBe(false);
    expect(view.location.hash).toBe("#/library");
  });

  it("pushes openings, replaces refinements and closes through Back", async () => {
    const { store, view } = install("/#/library");
    load(store);
    store.getState().openLibraryTorrentDetail("a");
    expect(view.entries).toHaveLength(2);
    expect(view.location.hash).toBe("#/library?torrent=a");

    store.getState().selectLibraryDetailMode("files");
    expect(view.entries).toHaveLength(2);
    expect(view.location.hash).toBe("#/library?torrent=a&view=files");

    store.getState().closeLibraryTorrentDetail();
    await settle();
    expect(view.index).toBe(0);
    expect(view.location.hash).toBe("#/library");
    expect(store.getState().presentation.libraryDetailOpen).toBe(false);

    view.traverse(1);
    await settle();
    expect(store.getState().presentation.libraryDetailOpen).toBe(true);
    expect(store.getState().presentation.libraryDetailMode).toBe("files");
  });

  it("moves between destinations and Settings with Back", async () => {
    const { store, view } = install("/");
    load(store);
    store.getState().selectDestination("library");
    store.getState().openSettings("downloads");
    store.getState().selectSettingsCategory("data-reset");
    expect(view.entries.map((entry) => new URL(entry.url, "http://host").hash)).toEqual([
      "#/torrents?torrent=a",
      "#/library",
      "#/library?settings=data-reset",
    ]);

    view.traverse(-1);
    await settle();
    expect(store.getState().presentation.settingsCategory).toBeNull();
    view.traverse(-1);
    await settle();
    expect(store.getState().presentation.destination).toBe("workbench");
  });

  it("keeps a busy Settings open when Back is pressed", async () => {
    const { store, view } = install("/");
    load(store);
    store.getState().openSettings("data-reset");
    store.getState().setSettingsBusy(true);
    view.traverse(-1);
    await settle();
    expect(store.getState().presentation.settingsCategory).toBe("data-reset");
    expect(view.location.hash).toBe("#/torrents?torrent=a&settings=data-reset");
  });

  it("opens and closes the narrow detail through history", async () => {
    const { store, view } = install("/");
    store.getState().setLayout("phone");
    load(store);
    store.getState().openTorrentDetail("b");
    expect(view.location.hash).toBe("#/torrents?torrent=b&open=1");
    expect(view.entries).toHaveLength(2);

    view.traverse(-1);
    await settle();
    expect(store.getState().presentation.detailOpen).toBe(false);
    view.traverse(1);
    await settle();
    expect(store.getState().presentation.detailOpen).toBe(true);
    expect(store.getState().presentation.currentTorrentId).toBe("b");
  });
});

function snapshot(ids: readonly string[]): InspectionSnapshot {
  const rows = ids.map(row);
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
    torrentOrder: [...ids],
    torrents: Object.fromEntries(rows.map((item) => [item.id, item])),
    peersByTorrent: {},
    swarmByTorrent: {},
    filesByTorrent: {},
    mediaByTorrent: {},
    libraryMedia: null,
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
      libraryMedia: { status: "not_requested" },
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

function row(id: string): TorrentRow {
  return {
    id,
    name: id,
    status: "downloading",
    operationalState: "downloading",
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
  };
}
