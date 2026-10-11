import { describe, expect, it, vi } from "vitest";

import type {
  AddTorrentBytesRequest,
  ApiHello,
  CreateMediaUrlRequest,
  DhtInspectionView,
  ExternalTorrentAddRequest,
  OpenViewSetRequest,
  OpenViewSetResponse,
  PeerView,
  RequestEnvelope,
  ResponseEnvelope,
  SpeedHistoryView,
  TorrentView,
  UpdateBatch,
  UpdateViewSetRequest,
  ViewSetUpdate,
  ViewSpec,
} from "../../api";
import type { ApplicationViewClient, MediaOpenTarget } from "../../api/client";
import { HttpApiError } from "../../api/client";
import type { InspectionSnapshot } from "../model";
import { LiveApplication } from "./LiveApplication";
import type { ViewSetState } from "../../view-set-reducer";
import { torrentMatchesCategory } from "../state";
import {
  clientSettingsFixture,
  clientSettingsRuntimeFixture,
} from "../../test-support/client-settings";

const TORRENT_ID = "t1-000102030405060708090a0b0c0d0e0f";
const V1_INFO_HASH = "000102030405060708090a0b0c0d0e0f10111213";

class FakeLiveClient implements ApplicationViewClient {
  readonly updates: UpdateViewSetRequest[] = [];
  readonly opens: OpenViewSetRequest[] = [];
  readonly requests: RequestEnvelope[] = [];
  readonly uploads: {
    readonly request: AddTorrentBytesRequest;
    readonly source: ArrayBuffer;
  }[] = [];
  readonly externalAdds: ExternalTorrentAddRequest[] = [];
  readonly mediaRequests: CreateMediaUrlRequest[] = [];
  readonly openedMediaUrls: string[] = [];
  openCount = 0;
  private rejectPoll: ((error: Error) => void) | null = null;

  constructor(private readonly torrentView: TorrentView = torrent()) {}

  async hello(): Promise<ApiHello> {
    return {
      api: { current: 1, minimum: 1 },
      encodings: ["json"],
      deliveries: ["poll", "long_poll"],
      capabilities: [
        "torrent_list",
        "torrent_summary",
        "torrent_preparation",
        "torrent_peers",
        "torrent_swarm",
        "torrent_files",
        "torrent_media",
        "torrent_trackers",
        "session_dht",
        "session_current_rates",
        "session_speed_history",
        "diagnostics",
      ],
      limits: {
        max_view_sets_per_owner: 8,
        max_views_per_set: 16,
        max_view_id_bytes: 64,
        min_queue_bytes: 16_384,
        default_queue_bytes: 262_144,
        max_queue_bytes: 524_288,
        max_snapshot_bytes: 16_777_216,
        max_wait_millis: 20_000,
        lease_millis: "300000",
      },
    };
  }

  async dispatch(request: RequestEnvelope): Promise<ResponseEnvelope> {
    this.requests.push(request);
    return {
      version: 1,
      request_id: request.request_id,
      revision: "4",
      ...(request.command.type === "add_magnet"
        ? {
            result: {
              type: "add_torrent" as const,
              result: {
                torrent_id: TORRENT_ID,
                disposition: { type: "added" as const },
                resulting_revision: "4",
              },
            },
          }
        : request.command.type === "export_magnet"
          ? {
              result: {
                type: "export_magnet" as const,
                result: {
                  magnet:
                    `magnet:?xt=urn:btih:${TORRENT_ID}` +
                    "&dn=Exact%20source&tr=udp%3A%2F%2Ftracker.example%3A80",
                  source: "verbatim" as const,
                  omitted_tracker_count: 0,
                },
              },
            }
          : {}),
      status: "success",
      snapshot: {
        profile_id: "live",
        revision: "4",
        storage: { roots: [], show_add_options: true, show_file_selection: true },
        client_settings: clientSettingsFixture(),
        torrents: [],
      },
    };
  }

  async addTorrentBytes(
    request: AddTorrentBytesRequest,
    source: ArrayBuffer,
  ): Promise<ResponseEnvelope> {
    this.uploads.push({ request, source });
    return {
      version: 1,
      request_id: request.request_id,
      revision: "4",
      result: {
        type: "add_torrent",
        result: {
          torrent_id: TORRENT_ID,
          disposition: { type: "already_present" },
          resulting_revision: "4",
        },
      },
      status: "success",
      snapshot: {
        profile_id: "live",
        revision: "4",
        storage: { roots: [], show_add_options: true, show_file_selection: true },
        client_settings: clientSettingsFixture(),
        torrents: [],
      },
    };
  }

  async addExternalTorrent(
    request: ExternalTorrentAddRequest,
  ): Promise<ResponseEnvelope> {
    this.externalAdds.push(request);
    return {
      version: 1,
      request_id: request.request_id,
      revision: "4",
      result: {
        type: "add_torrent",
        result: {
          torrent_id: TORRENT_ID,
          disposition: { type: "already_present" },
          resulting_revision: "4",
        },
      },
      status: "success",
      snapshot: {
        profile_id: "live",
        revision: "4",
        storage: { roots: [], show_add_options: true, show_file_selection: true },
        client_settings: clientSettingsFixture(),
        torrents: [],
      },
    };
  }

  async chooseDownloadRoot(): Promise<null> {
    return null;
  }

  async createMediaUrl(request: CreateMediaUrlRequest) {
    this.mediaRequests.push(request);
    return {
      torrent_id: request.torrent_id,
      file_index: request.file_index,
      outcome: {
        type: "created" as const,
        url: "http://127.0.0.1:43121/media/v1/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        idle_timeout_millis: "1800000",
        absolute_timeout_millis: "86400000",
      },
    };
  }

  prepareMediaOpen(): MediaOpenTarget {
    return {
      open: async (url) => {
        this.openedMediaUrls.push(url);
      },
      cancel: () => {},
    };
  }

  async openViewSet(request: OpenViewSetRequest): Promise<OpenViewSetResponse> {
    this.opens.push(request);
    this.openCount += 1;
    const viewSetId = `vs_${String(this.openCount).padStart(32, "0")}`;
    const initial: UpdateBatch = {
      api_version: 1,
      server_now_millis: "10000",
      view_set_id: viewSetId,
      epoch: String(this.openCount),
      base_cursor: "0",
      cursor: "1",
      durable_revision: "4",
      updates: request.views.map((view) =>
        snapshotFor(view, this.openCount, this.torrentView),
      ),
    };
    return {
      view_set_id: viewSetId,
      lease_millis: "300000",
      effective_queue_bytes: 262_144,
      effective_views: request.views,
      initial,
    };
  }

  async updateViewSet(
    _viewSetId: string,
    request: UpdateViewSetRequest,
  ): Promise<void> {
    this.updates.push(request);
  }

  async nextUpdates(
    _viewSetId: string,
    _after: string,
    _waitMillis: number,
    signal?: AbortSignal,
  ): Promise<UpdateBatch> {
    return new Promise((_resolve, reject) => {
      this.rejectPoll = reject;
      signal?.addEventListener("abort", () => reject(new Error("aborted")), {
        once: true,
      });
    });
  }

  async closeViewSet(): Promise<void> {}
  async close(): Promise<void> {}

  expireViewSet(): void {
    this.rejectPoll?.(
      new HttpApiError(404, "unknown_view_set", "view-set lease expired"),
    );
    this.rejectPoll = null;
  }
}

describe("LiveApplication", () => {
  it("preserves tracker deadlines through unrelated and partial updates and wall-clock jumps", async () => {
    const monotonic = vi.spyOn(performance, "now").mockReturnValue(100_000);
    const wallClock = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const application = await LiveApplication.open(new FakeLiveClient(), {
      initialViews: { library: false, torrentId: TORRENT_ID, detail: "trackers", logCapture: null },
    });
    let latest: InspectionSnapshot | undefined;
    application.subscribe((update) => {
      if (update.type === "snapshot") latest = update.snapshot;
    });
    try {
      const adapter = application as unknown as {
        controller: { current(): ViewSetState };
        acceptState(state: ViewSetState): void;
      };
      const initial = adapter.controller.current();
      const row = () => latest!.trackersByTorrent[TORRENT_ID]!.rows["000000:000000"]!;
      expect(row().nextActionAtMs).toBe(117_000);
      expect(row().lastSuccessAtMs).toBe(96_000);
      monotonic.mockReturnValue(105_000);
      wallClock.mockReturnValue(-1_000_000);
      adapter.acceptState({ ...initial, cursor: "2", serverNowMillis: "15000" });
      expect(row().nextActionAtMs! - performance.now()).toBe(12_000);

      // A tracker collection patch can retain the original row alongside a new row.
      const trackerEntry = Object.entries(initial.views).find(([, view]) => view.type === "trackers")!;
      const source = trackerEntry[1];
      if (source.type !== "trackers") throw new Error("tracker source missing");
      const changed = { ...source.trackers[0]!, tracker_id: "000000:000001", next_action_at_millis: "40000" };
      adapter.acceptState({ ...initial, cursor: "3", serverNowMillis: "15000", views: {
        ...initial.views, [trackerEntry[0]]: { ...source, trackers: [...source.trackers, changed] },
      } });
      expect(row().nextActionAtMs).toBe(117_000);
      expect(latest!.trackersByTorrent[TORRENT_ID]!.rows[changed.tracker_id]!.nextActionAtMs).toBe(130_000);

      // A real reschedule changes the deadline; it is never clamped to an old wait.
      adapter.acceptState({ ...initial, cursor: "4", serverNowMillis: "15000", views: {
        ...initial.views, [trackerEntry[0]]: { ...source, trackers: [{ ...source.trackers[0]!, next_action_at_millis: "55000" }] },
      } });
      expect(row().nextActionAtMs).toBe(145_000);

      // A fresh epoch reanchors using fresh server time, even when its rows are old.
      monotonic.mockReturnValue(110_000);
      adapter.acceptState({ ...initial, epoch: "2", serverNowMillis: "20000" });
      expect(row().nextActionAtMs! - performance.now()).toBe(7_000);
    } finally {
      await application.close();
      monotonic.mockRestore();
      wallClock.mockRestore();
    }
  });
  it.each(["paused", "error"] as const)(
    "classifies blocked storage as needing attention with %s operational state",
    async (operationalState) => {
      const client = new FakeLiveClient({
        ...torrent(),
        state: "awaiting_storage",
        storage_state: "unavailable",
        operational_state: operationalState,
        progress: {
          disposition: "blocked",
          phase: "storage",
          reason: "waiting_for_storage",
          actions: ["select_storage"],
        },
      });
      const application = await LiveApplication.open(client);
      const snapshots: InspectionSnapshot[] = [];
      application.subscribe((update) => {
        if (update.type === "snapshot") snapshots.push(update.snapshot);
      });
      const row = snapshots.at(-1)!.torrents[TORRENT_ID]!;
      expect(row).toMatchObject({
        status: "error",
        operationalState,
        progressReason: "waiting for storage",
      });
      expect(torrentMatchesCategory(row, "errors")).toBe(true);
      expect(torrentMatchesCategory(row, "active")).toBe(false);
      expect(torrentMatchesCategory(row, "downloading")).toBe(false);
      expect(client.requests).toHaveLength(0);
      await application.close();
    },
  );

  it("keeps active storage preparation in the active category", async () => {
    const client = new FakeLiveClient({
      ...torrent(),
      state: "awaiting_storage",
      operational_state: "starting",
      progress: {
        disposition: "active",
        phase: "storage",
        reason: "preparing_storage",
        actions: [],
      },
    });
    const application = await LiveApplication.open(client);
    const snapshots: InspectionSnapshot[] = [];
    application.subscribe((update) => {
      if (update.type === "snapshot") snapshots.push(update.snapshot);
    });
    const row = snapshots.at(-1)!.torrents[TORRENT_ID]!;
    expect(torrentMatchesCategory(row, "errors")).toBe(false);
    expect(torrentMatchesCategory(row, "active")).toBe(true);
    await application.close();
  });

  it("creates and opens an ephemeral URL outside the durable command path", async () => {
    const client = new FakeLiveClient();
    const application = await LiveApplication.open(client);

    await expect(
      application.dispatch({
        type: "open_file",
        torrentId: TORRENT_ID,
        fileIndex: 3,
      }),
    ).resolves.toEqual({ accepted: true, message: "Opening file" });
    expect(client.mediaRequests).toEqual([
      { torrent_id: TORRENT_ID, file_index: 3 },
    ]);
    expect(client.openedMediaUrls).toEqual([
      "http://127.0.0.1:43121/media/v1/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    ]);
    expect(client.requests).toHaveLength(0);
    await application.close();
  });

  it("maps exact payload work and typed ETA without numeric conversion", async () => {
    const client = new FakeLiveClient();
    const application = await LiveApplication.open(client);
    const snapshots: InspectionSnapshot[] = [];
    application.subscribe((update) => {
      if (update.type === "snapshot") snapshots.push(update.snapshot);
    });

    expect(snapshots.at(-1)?.torrents[TORRENT_ID]).toMatchObject({
      operationalState: "downloading",
      queuePosition: null,
      sizeBytes: 131072,
      requiredPayloadBytes: "131072",
      remainingPayloadBytes: "98304",
      etaDownloadRateBytes: "4096",
      eta: { state: "estimate", seconds: "24" },
      checking: {
        generation: "3",
        phase: "hashing",
        piecesTotal: 8,
        piecesProcessed: 2,
        piecesMatched: 1,
        piecesAbsent: 1,
        piecesMismatched: 0,
        bytesHashed: "32768",
        activeHashJobs: 1,
        queuedHashJobs: 5,
        elapsedMs: 2500,
        lastAdvanceAgeMs: 300,
        oldestActiveJobAgeMs: 700,
      },
    });
    expect(snapshots.at(-1)?.session).toMatchObject({
      downloadRate: 4096,
      uploadRate: 2048,
    });
    expect(client.opens[0]?.views).toContainEqual({
      type: "session_current_rates",
      view_id: "session-rates",
      metrics: ["payload_received", "payload_uploaded"],
      delivery: { min_interval_millis: 1_000 },
    });
    await application.close();
  });

  it("requests graph history only while the Speed detail is visible", async () => {
    const client = new FakeLiveClient();
    const application = await LiveApplication.open(client, {
      initialViews: {
        library: false,
        torrentId: TORRENT_ID,
        detail: "speed",
        logCapture: null,
        speed: {
          range: "minutes2",
          metrics: ["payload_received", "peer_wire_received"],
        },
      },
    });

    expect(client.opens[0]?.views).toContainEqual({
      type: "session_speed_history",
      view_id: "session-speed",
      range: "minutes2",
      metrics: ["payload_received", "peer_wire_received"],
      delivery: { min_interval_millis: 500 },
    });
    expect(client.opens[0]?.views).toContainEqual({
      type: "session_current_rates",
      view_id: "session-rates",
      metrics: [
        "payload_received",
        "payload_uploaded",
        "staged_write",
        "payload_verified",
        "peer_wire_received",
      ],
      delivery: { min_interval_millis: 1_000 },
    });

    await application.setViews({
      library: true,
      torrentId: TORRENT_ID,
      detail: "general",
      logCapture: null,
      speed: null,
    });
    expect(client.updates.at(-1)?.views.some(
      (view) => view.type === "session_speed_history",
    )).toBe(false);
    expect(client.updates.at(-1)?.views).toContainEqual({
      type: "session_current_rates",
      view_id: "session-rates",
      metrics: ["payload_received", "payload_uploaded"],
      delivery: { min_interval_millis: 1_000 },
    });
    await application.close();
  });

  it("uses the provisional magnet name until a verified name is available", async () => {
    const pending = torrent();
    pending.display_name = null;
    pending.source_display_name = "Waiting for metadata";
    pending.metadata_available = false;
    pending.piece_count = 0;
    pending.verified_piece_count = 0;
    const application = await LiveApplication.open(new FakeLiveClient(pending), {
      initialViews: {
        library: true,
        torrentId: TORRENT_ID,
        detail: "general",
        logCapture: null,
        speed: null,
      },
    });
    const snapshots: InspectionSnapshot[] = [];
    application.subscribe((update) => {
      if (update.type === "snapshot") snapshots.push(update.snapshot);
    });

    expect(snapshots.at(-1)?.torrents[TORRENT_ID]?.name).toBe(
      "Waiting for metadata",
    );
    expect(snapshots.at(-1)?.torrents[TORRENT_ID]?.preparation).toMatchObject({
      generation: "1",
      metadata: {
        phase: "downloading",
        totalSizeBytes: 32_771,
        receivedBytes: 16_384,
        blockCount: 3,
        activePeers: 2,
        requestsInFlight: 2,
        hashRetries: 1,
      },
      integrity: null,
    });
    expect(
      snapshots.at(-1)?.torrents[TORRENT_ID]?.preparation?.metadata?.blockStates,
    ).toEqual(Uint8Array.of(0x16));
    await application.close();
  });

  it("materializes the session DHT view without a selected torrent", async () => {
    const client = new FakeLiveClient();
    const application = await LiveApplication.open(client, {
      initialViews: {
        library: false,
        torrentId: null,
        detail: "dht",
        logCapture: null,
        speed: null,
      },
    });
    const snapshots: InspectionSnapshot[] = [];
    application.subscribe((update) => {
      if (update.type === "snapshot") snapshots.push(update.snapshot);
    });

    expect(client.opens[0]?.views).toContainEqual({
      type: "session_dht",
      view_id: "session-dht",
      delivery: { min_interval_millis: 500 },
    });
    expect(snapshots.at(-1)?.dht?.lifecycle).toBe("participating");
    expect(snapshots.at(-1)?.dht?.families[0]?.buckets).toHaveLength(160);
    expect(snapshots.at(-1)?.viewStatus.dht).toEqual({ status: "ready" });
    await application.close();
  });

  it("maps semantic magnet intake to the bounded application command", async () => {
    const client = new FakeLiveClient();
    const application = await LiveApplication.open(client);
    const magnet =
      "magnet:?xt=urn:btih:000102030405060708090a0b0c0d0e0f10111213";

    await expect(
      application.dispatch({
        type: "add_magnet",
        magnet,
        storageRoot: "root_a",
        startContent: false,
      }),
    ).resolves.toEqual({
      accepted: true,
      message: "Added",
      torrentId: TORRENT_ID,
      addDisposition: { type: "added" },
    });
    expect(client.requests).toHaveLength(1);
    expect(client.requests[0]?.command).toEqual({
      type: "add_magnet",
      magnet,
      storage_root: "root_a",
      start_content: false,
      await_file_selection: false,
      skip_files: [],
    });
    await application.close();
  });

  it("maps source-aware magnet export without projecting source text", async () => {
    const client = new FakeLiveClient();
    const application = await LiveApplication.open(client);

    await expect(
      application.dispatch({
        type: "export_magnet",
        torrentId: TORRENT_ID,
      }),
    ).resolves.toEqual({
      accepted: true,
      message: "Magnet link ready",
      magnetExport: {
        magnet:
          `magnet:?xt=urn:btih:${TORRENT_ID}` +
          "&dn=Exact%20source&tr=udp%3A%2F%2Ftracker.example%3A80",
        source: "verbatim",
        omittedTrackerCount: 0,
      },
    });
    expect(client.requests).toHaveLength(1);
    expect(client.requests[0]?.command).toEqual({
      type: "export_magnet",
      torrent_id: TORRENT_ID,
    });
    await application.close();
  });

  it("maps one typed client-settings group through the generic command path", async () => {
    const client = new FakeLiveClient();
    const application = await LiveApplication.open(client);
    const snapshots: InspectionSnapshot[] = [];
    application.subscribe((update) => {
      if (update.type === "snapshot") snapshots.push(update.snapshot);
    });
    const patch = {
      peer_connection_limit: 2_000,
      upload_slots: 0,
    };

    expect(snapshots.at(-1)?.clientSettings).toEqual(
      clientSettingsRuntimeFixture(),
    );
    await expect(
      application.dispatch({ type: "update_client_settings", patch }),
    ).resolves.toMatchObject({
      accepted: true,
      message: "Connection and seeding settings saved",
      resultingRevision: "4",
    });
    expect(client.requests).toHaveLength(1);
    expect(client.requests[0]?.command).toEqual({
      type: "update_client_settings",
      patch,
    });
    await application.close();
  });

  it("maps one atomic torrent transfer-limit pair through the generic command path", async () => {
    const client = new FakeLiveClient();
    const application = await LiveApplication.open(client);
    const patch = {
      upload_rate_limit: {
        type: "limited" as const,
        bytes_per_second: 32_768,
      },
    };

    await expect(
      application.dispatch({
        type: "update_torrent_settings",
        torrentId: TORRENT_ID,
        patch,
      }),
    ).resolves.toMatchObject({
      accepted: true,
      message: "Torrent transfer limits saved",
      resultingRevision: "4",
    });
    expect(client.requests[0]?.command).toEqual({
      type: "update_torrent_settings",
      torrent_id: TORRENT_ID,
      patch,
    });
    await application.close();
  });

  it("maps torrent bytes to one all-files upload without a caller digest", async () => {
    const client = new FakeLiveClient();
    const application = await LiveApplication.open(client);
    const source = new Uint8Array([100, 52, 58, 105, 110, 102, 111, 101]).buffer;

    await expect(
      application.dispatch({
        type: "add_torrent_bytes",
        source,
        storageRoot: "root_a",
        startContent: false,
      }),
    ).resolves.toEqual({
      accepted: true,
      message: "Already in your session",
      torrentId: TORRENT_ID,
      addDisposition: { type: "already_present" },
    });
    expect(client.uploads).toHaveLength(1);
    expect(client.uploads[0]).toEqual({
      request: {
        version: 1,
        request_id: expect.stringMatching(/^web-[0-9a-f]{32}-1$/),
        storage_root: "root_a",
        start_content: false,
        await_file_selection: false,
        selection: { type: "all" },
        source_length: source.byteLength,
      },
      source,
    });
    await application.close();
  });

  it("maps opaque desktop activation IDs through the native-only add lane", async () => {
    const client = new FakeLiveClient();
    const application = await LiveApplication.open(client);
    const activationId = "00010203-0405-4607-8809-0a0b0c0d0e0f";

    await expect(
      application.dispatch({
        type: "add_external_torrent",
        activationId,
        storageRoot: "root_a",
        startContent: false,
      }),
    ).resolves.toEqual({
      accepted: true,
      message: "Already in your session",
      torrentId: TORRENT_ID,
      addDisposition: { type: "already_present" },
    });
    expect(client.externalAdds).toHaveLength(1);
    expect(client.externalAdds[0]).toMatchObject({
      activation_id: activationId,
      storage_root: "root_a",
      start_content: false,
      await_file_selection: false,
    });
    expect(JSON.stringify(client.externalAdds)).not.toContain("magnet:?");
    expect(JSON.stringify(client.externalAdds)).not.toContain(".torrent");

    await application.close();
  });

  it("maps sorted live file priority changes to the application command", async () => {
    const client = new FakeLiveClient();
    const application = await LiveApplication.open(client);

    await expect(
      application.dispatch({
        type: "set_file_priority",
        torrentId: TORRENT_ID,
        fileIndices: [9, 2, 4],
        priority: "skip",
      }),
    ).resolves.toEqual({ accepted: true, message: "Selected files skipped" });
    expect(client.requests[0]?.command).toEqual({
      type: "set_file_priority",
      torrent_id: TORRENT_ID,
      file_indices: [2, 4, 9],
      priority: "skip",
    });
    await application.close();
  });

  it("maps one sorted Download now intent to the atomic application command", async () => {
    const client = new FakeLiveClient();
    const application = await LiveApplication.open(client);

    await expect(
      application.dispatch({
        type: "download_files",
        torrentId: TORRENT_ID,
        fileIndices: [9, 2, 4],
      }),
    ).resolves.toEqual({
      accepted: true,
      message: "Selected files requested for download",
    });
    expect(client.requests[0]?.command).toEqual({
      type: "download_files",
      torrent_id: TORRENT_ID,
      file_indices: [2, 4, 9],
    });
    await application.close();
  });

  it("maps force recheck to the durable application command", async () => {
    const client = new FakeLiveClient();
    const application = await LiveApplication.open(client);

    await expect(
      application.dispatch({ type: "force_recheck", torrentId: TORRENT_ID }),
    ).resolves.toEqual({ accepted: true, message: "Torrent recheck started" });
    expect(client.requests[0]?.command).toEqual({
      type: "force_recheck",
      torrent_id: TORRENT_ID,
    });
    await application.close();
  });

  it("maps semantic queue movement to the durable application commands", async () => {
    const client = new FakeLiveClient();
    const application = await LiveApplication.open(client);

    await expect(
      application.dispatch({
        type: "move_download_to_top",
        torrentId: TORRENT_ID,
      }),
    ).resolves.toEqual({
      accepted: true,
      message: "Torrent moved to the top of the download queue",
    });
    await expect(
      application.dispatch({
        type: "move_download_to_bottom",
        torrentId: TORRENT_ID,
      }),
    ).resolves.toEqual({
      accepted: true,
      message: "Torrent moved to the bottom of the download queue",
    });
    expect(client.requests.map((request) => request.command)).toEqual([
      { type: "move_download_to_top", torrent_id: TORRENT_ID },
      { type: "move_download_to_bottom", torrent_id: TORRENT_ID },
    ]);
    await application.close();
  });

  it("uses a unique bounded request namespace for each application instance", async () => {
    const firstClient = new FakeLiveClient();
    const secondClient = new FakeLiveClient();
    const first = await LiveApplication.open(firstClient);
    const second = await LiveApplication.open(secondClient);

    await first.dispatch({ type: "archive", torrentId: TORRENT_ID });
    await first.dispatch({ type: "unarchive", torrentId: TORRENT_ID });
    await second.dispatch({ type: "archive", torrentId: TORRENT_ID });

    const firstIds = firstClient.requests.map((request) => request.request_id);
    const secondId = secondClient.requests[0]?.request_id;
    expect(firstIds[0]).toMatch(/^web-[0-9a-f]{32}-1$/);
    expect(firstIds[1]).toMatch(/^web-[0-9a-f]{32}-2$/);
    expect(secondId).toMatch(/^web-[0-9a-f]{32}-1$/);
    expect(secondId).not.toBe(firstIds[0]);
    expect(firstIds.every((requestId) => requestId.length <= 128)).toBe(true);

    await first.close();
    await second.close();
  });

  it("maps archive and explicit retention removal commands", async () => {
    const client = new FakeLiveClient();
    const application = await LiveApplication.open(client);

    await application.dispatch({ type: "archive", torrentId: TORRENT_ID });
    await application.dispatch({
      type: "remove",
      torrentId: TORRENT_ID,
      deleteData: true,
    });

    expect(client.requests.map((request) => request.command)).toEqual([
      { type: "archive", torrent_id: TORRENT_ID },
      {
        type: "remove_torrent",
        torrent_id: TORRENT_ID,
        data: "delete_data",
      },
    ]);
    await application.close();
  });

  it("routes settings reset and profile clear as distinct semantic commands", async () => {
    const client = new FakeLiveClient();
    const application = await LiveApplication.open(client);
    await application.dispatch({ type: "reset_client_settings" });
    await application.dispatch({ type: "clear_app_data" });
    expect(client.requests.map((request) => request.command)).toEqual([
      { type: "reset_client_settings" },
      { type: "clear_app_data" },
    ]);
    await application.close();
  });

  it("maps active peer state and evicts obsolete responsive views", async () => {
    const client = new FakeLiveClient();
    const application = await LiveApplication.open(client, {
      initialViews: {
        library: true,
        torrentId: TORRENT_ID,
        detail: "peers",
        logCapture: null,
      },
    });
    const snapshots: InspectionSnapshot[] = [];
    application.subscribe((update) => {
      if (update.type === "snapshot") snapshots.push(update.snapshot);
    });

    const initial = snapshots.at(-1)!;
    expect(initial.torrents[TORRENT_ID]?.name).toBe("movie.mkv");
    expect(initial.torrents[TORRENT_ID]?.configuredTrackerCount).toBe(2);
    const peer = initial.peersByTorrent[TORRENT_ID]?.rows["connection-1"];
    expect(peer?.state).toBe("handshaking");
    expect(peer?.client).toBeNull();
    expect(peer?.downloadRate).toBeNull();
    expect(peer?.mseMethod).toBe("plaintext_payload");
    expect(peer?.flags).toEqual([
      "incoming",
      "encrypted",
      "download_choked",
      "extension_protocol",
      "metadata_extension",
      "utp",
    ]);
    expect(initial.viewStatus.peers.status).toBe("ready");

    await application.setViews({
      library: false,
      torrentId: TORRENT_ID,
      detail: "swarm",
      logCapture: null,
    });
    expect(client.updates.at(-1)?.views.map((view) => view.type)).toEqual([
      "torrent_summary",
      "torrent_swarm",
      "session_current_rates",
    ]);
    expect(snapshots.at(-1)?.viewStatus.swarm.status).toBe("loading");

    await application.setViews({
      library: false,
      torrentId: TORRENT_ID,
      detail: "logs",
      logCapture: { profile: "normal", torrentId: null },
    });
    expect(client.updates.at(-1)?.views.map((view) => view.type)).toEqual([
      "torrent_summary",
      "diagnostics",
      "session_current_rates",
    ]);
    expect(
      client.updates.at(-1)?.views.find((view) => view.type === "diagnostics"),
    ).toMatchObject({
      type: "diagnostics",
      torrent_id: null,
      filter: { profile: "normal", minimum_severity: "info" },
    });
    await application.setViews({
      library: false,
      torrentId: TORRENT_ID,
      detail: "logs",
      logCapture: { profile: "trace", torrentId: TORRENT_ID },
    });
    expect(
      client.updates.at(-1)?.views.find((view) => view.type === "diagnostics"),
    ).toMatchObject({
      type: "diagnostics",
      torrent_id: TORRENT_ID,
      filter: { profile: "trace", minimum_severity: "trace" },
    });
    const transition = snapshots.at(-1)!;
    expect(transition.torrentOrder).toEqual([]);
    expect(transition.peersByTorrent).toEqual({});
    expect(transition.viewStatus.peers.status).toBe("not_requested");
    expect(transition.viewStatus.logs.status).toBe("loading");
    await application.close();
  });

  it("subscribes to files only while requested and maps exact byte strings", async () => {
    const client = new FakeLiveClient();
    const application = await LiveApplication.open(client, {
      initialViews: {
        library: false,
        torrentId: TORRENT_ID,
        detail: "files",
        logCapture: null,
      },
    });
    const snapshots: InspectionSnapshot[] = [];
    application.subscribe((update) => {
      if (update.type === "snapshot") snapshots.push(update.snapshot);
    });
    const file = snapshots.at(-1)?.filesByTorrent[TORRENT_ID]?.rows["0"];
    expect(file).toMatchObject({
      name: "movie.mkv",
      lengthBytes: "9007199254740993",
      doneBytes: "16384",
      verifiedBytes: "0",
      storagePath: "/tmp/content/video/movie.mkv",
    });
    expect(
      client.opens[0]?.views.find((view) => view.type === "torrent_files")
        ?.delivery.min_interval_millis,
    ).toBe(250);
    await application.setViews({
      library: true,
      torrentId: TORRENT_ID,
      detail: "general",
      logCapture: null,
    });
    expect(client.updates.at(-1)?.views.map((view) => view.type)).toEqual([
      "torrent_list",
      "torrent_summary",
      "torrent_preparation",
      "session_current_rates",
    ]);
    expect(snapshots.at(-1)?.filesByTorrent).toEqual({});
    await application.close();
  });

  it("subscribes to derived media only while requested and maps episode hints", async () => {
    const client = new FakeLiveClient();
    const application = await LiveApplication.open(client, {
      initialViews: {
        library: true,
        torrentId: TORRENT_ID,
        detail: "media",
        logCapture: null,
      },
    });
    const snapshots: InspectionSnapshot[] = [];
    application.subscribe((update) => {
      if (update.type === "snapshot") snapshots.push(update.snapshot);
    });
    expect(
      snapshots.at(-1)?.mediaByTorrent[TORRENT_ID]?.rows["0"],
    ).toMatchObject({
      name: "Show.Name.S01E02.mkv",
      verifiedBytes: "0",
      role: {
        type: "episode",
        seasonNumber: 1,
        episodeNumber: 2,
      },
    });
    expect(
      client.opens[0]?.views.find((view) => view.type === "torrent_media"),
    ).toMatchObject({ delivery: { min_interval_millis: 250 } });
    await application.setViews({
      library: true,
      torrentId: TORRENT_ID,
      detail: "files",
      logCapture: null,
    });
    expect(client.updates.at(-1)?.views.map((view) => view.type)).toContain(
      "torrent_files",
    );
    expect(client.updates.at(-1)?.views.map((view) => view.type)).not.toContain(
      "torrent_media",
    );
    expect(snapshots.at(-1)?.mediaByTorrent).toEqual({});
    await application.close();
  });

  it("subscribes to trackers only while requested and maps retained state", async () => {
    const client = new FakeLiveClient();
    const application = await LiveApplication.open(client, {
      initialViews: {
        library: false,
        torrentId: TORRENT_ID,
        detail: "trackers",
        logCapture: null,
      },
    });
    const snapshots: InspectionSnapshot[] = [];
    application.subscribe((update) => {
      if (update.type === "snapshot") snapshots.push(update.snapshot);
    });
    const tracker =
      snapshots.at(-1)?.trackersByTorrent[TORRENT_ID]?.rows[
        "000000:000000"
      ];
    expect(tracker).toMatchObject({
      torrentId: TORRENT_ID,
      status: "retry_wait",
      lastConnectionFamily: "ipv4",
      lastPeerCount: 12,
      seeders: 7,
      leechers: 5,
      nextAction: "retry",
      nextActionAtMs: expect.any(Number),
      error: "temporary timeout",
    });
    expect(
      client.opens[0]?.views.find((view) => view.type === "torrent_trackers")
        ?.delivery.min_interval_millis,
    ).toBe(250);
    await application.setViews({
      library: true,
      torrentId: TORRENT_ID,
      detail: "general",
      logCapture: null,
    });
    expect(snapshots.at(-1)?.trackersByTorrent).toEqual({});
    expect(snapshots.at(-1)?.viewStatus.trackers.status).toBe(
      "not_requested",
    );
    await application.close();
  });

  it("marks stale state then atomically installs a fresh view-set epoch", async () => {
    const client = new FakeLiveClient();
    const application = await LiveApplication.open(client, {
      initialViews: {
        library: true,
        torrentId: TORRENT_ID,
        detail: "peers",
        logCapture: null,
      },
      retryBaseMillis: 1,
      retryMaximumMillis: 2,
    });
    const snapshots: InspectionSnapshot[] = [];
    application.subscribe((update) => {
      if (update.type === "snapshot") snapshots.push(update.snapshot);
    });

    client.expireViewSet();
    await waitUntil(() => client.openCount === 2);
    await waitUntil(() => snapshots.at(-1)?.session.connection === "connected");

    expect(
      snapshots.some(
        (snapshot) =>
          snapshot.session.connection === "reconnecting" &&
          snapshot.viewStatus.peers.status === "stale",
      ),
    ).toBe(true);
    const recovered = snapshots.at(-1)!;
    expect(recovered.peersByTorrent[TORRENT_ID]?.order).toEqual([
      "connection-2",
    ]);
    expect(
      recovered.peersByTorrent[TORRENT_ID]?.rows["connection-1"],
    ).toBeUndefined();
    expect(
      recovered.peersByTorrent[TORRENT_ID]?.rows["connection-2"]?.flags,
    ).toEqual([
      "incoming",
      "encrypted",
      "upload_allowed",
      "extension_protocol",
      "metadata_extension",
      "optimistic_unchoke",
    ]);
    expect(recovered.peersByTorrent[TORRENT_ID]?.rows["connection-2"]).toMatchObject({
      state: "connected",
      endpoint: "127.0.0.1:6881",
      client: "µTorrent 3.5.5",
      mseMethod: "rc4",
      source: "incoming",
      uploadRate: 2048,
      uploadedBytes: 8192,
      requestsPending: 2,
      connectedAgeMs: 2000,
      lastPayloadAgeMs: 250,
    });
    await application.close();
  });

  it("reopens a leased swarm view from a complete fresh snapshot", async () => {
    const client = new FakeLiveClient();
    const application = await LiveApplication.open(client, {
      initialViews: {
        library: false,
        torrentId: TORRENT_ID,
        detail: "swarm",
        logCapture: null,
      },
      retryBaseMillis: 1,
      retryMaximumMillis: 2,
    });
    const snapshots: InspectionSnapshot[] = [];
    application.subscribe((update) => {
      if (update.type === "snapshot") snapshots.push(update.snapshot);
    });
    expect(snapshots.at(-1)?.swarmByTorrent[TORRENT_ID]?.order).toEqual(["1"]);
    expect(
      snapshots.at(-1)?.swarmByTorrent[TORRENT_ID]?.rows["1"],
    ).toMatchObject({
      payloadDownloadedBytes: "9007199254740993",
      payloadUploadedBytes: "4503599627370497",
    });

    client.expireViewSet();
    await waitUntil(() => client.openCount === 2);
    await waitUntil(() => snapshots.at(-1)?.session.connection === "connected");

    expect(
      snapshots.some(
        (snapshot) =>
          snapshot.session.connection === "reconnecting" &&
          snapshot.viewStatus.swarm.status === "stale",
      ),
    ).toBe(true);
    expect(snapshots.at(-1)?.swarmByTorrent[TORRENT_ID]?.order).toEqual(["2"]);
    await application.close();
  });
});

function snapshotFor(
  view: ViewSpec,
  generation: number,
  torrentView: TorrentView,
): ViewSetUpdate {
  switch (view.type) {
    case "torrent_list":
      return {
        type: "snapshot",
        view_id: view.view_id,
        snapshot: {
          type: "torrent_list",
          torrents: [torrentView],
          storage: { roots: [], show_add_options: true, show_file_selection: true },
          client_settings: clientSettingsRuntimeFixture(),
        },
      };
    case "torrent_summary":
      return {
        type: "snapshot",
        view_id: view.view_id,
        snapshot: { type: "torrent", torrent: torrentView },
      };
    case "torrent_preparation":
      return {
        type: "snapshot",
        view_id: view.view_id,
        snapshot: {
          type: "torrent_preparation",
          torrent_id: TORRENT_ID,
          preparation: torrentView.metadata_available
            ? null
            : {
                generation: String(generation),
                metadata: {
                  phase: "downloading",
                  total_size_bytes: "32771",
                  received_bytes: "16384",
                  block_count: 3,
                  block_states: "Fg==",
                  active_peers: 2,
                  requests_in_flight: 2,
                  hash_retries: 1,
                },
                integrity: null,
              },
        },
      };
    case "torrent_peers":
      return {
        type: "snapshot",
        view_id: view.view_id,
        snapshot: {
          type: "peers",
          torrent_id: TORRENT_ID,
          peers: [peer(generation)],
        },
      };
    case "torrent_swarm":
      return {
        type: "snapshot",
        view_id: view.view_id,
        snapshot: {
          type: "swarm",
          torrent_id: TORRENT_ID,
          state: "active",
          captured_millis: "1000",
          maximum_records: 1000,
          counts: {
            total: 1,
            eligible: 1,
            not_connectable: 0,
            dialing: 0,
            connected: 0,
            backed_off: 0,
            failure_limited: 0,
            banned: 0,
          },
          peers: [swarmPeer(generation)],
        },
      };
    case "torrent_files":
      return {
        type: "snapshot",
        view_id: view.view_id,
        snapshot: {
          type: "files",
          torrent_id: TORRENT_ID,
          state: "available",
          filesystem_content_base: "/tmp/content",
          page: { offset: 0, limit: 1024, total: 1, next_offset: null },
          files: [
            {
              file_id: "0",
              file_index: 0,
              path: ["video", "movie.mkv"],
              length_bytes: "9007199254740993",
              torrent_offset_bytes: "0",
              first_piece: 0,
              last_piece: 7,
              selection: "normal",
              padding: false,
              done_bytes: "16384",
              verified_bytes: "0",
              media_availability: "unverified",
            },
          ],
        },
      };
    case "torrent_media":
      return {
        type: "snapshot",
        view_id: view.view_id,
        snapshot: {
          type: "media",
          torrent_id: TORRENT_ID,
          state: "available",
          total_non_padding_files: 2,
          items: [
            {
              media_id: "0",
              file_index: 0,
              path: ["Show.Name.S01E02.mkv"],
              extension: "mkv",
              length_bytes: "32768",
              selection: "normal",
              done_bytes: "16384",
              verified_bytes: "0",
              media_availability: "unverified",
              role: {
                type: "episode",
                series_title_hint: "Show Name",
                season_number: 1,
                episode_number: 2,
                ending_episode_number: null,
              },
            },
          ],
        },
      };
    case "torrent_trackers":
      return {
        type: "snapshot",
        view_id: view.view_id,
        snapshot: {
          type: "trackers",
          torrent_id: TORRENT_ID,
          state: "available",
          page: { offset: 0, limit: 1024, total: 1, next_offset: null },
          trackers: [
            {
              tracker_id: "000000:000000",
              url: "udp://tracker.example:6969",
              transport: "udp",
              security: "unencrypted",
              source: "magnet",
              tier: 0,
              status: "retry_wait",
              announce_event: null,
              total_attempts: 2,
              consecutive_failures: 1,
              last_connection_family: "ipv4",
              last_peer_count: 12,
              seeders: 7,
              leechers: 5,
              interval_seconds: 600,
              next_action: "retry",
              next_action_at_millis: "27000",
              last_success_at_millis: "6000",
              last_failure_at_millis: "9500",
              last_error: "temporary timeout",
            },
          ],
        },
      };
    case "session_disk":
      return {
        type: "snapshot",
        view_id: view.view_id,
        snapshot: {
          type: "session_disk",
          pipeline: {
            pressure: "idle",
            checkpoint_stage: "idle",
            intake_backpressured: false,
            sample_millis: "0",
            resident_limit_bytes: "0",
            resident_high_watermark_bytes: "0",
            resident_low_watermark_bytes: "0",
            requested_bytes: "0",
            resident_bytes: "0",
            queued_write_bytes: "0",
            writing_bytes: "0",
            hashing_bytes: "0",
            checkpoint_dirty_pieces: "0",
            checkpoint_dirty_bytes: "0",
            checkpoint_dirty_piece_high_water: "0",
            checkpoint_dirty_byte_high_water: "0",
            checkpoint_oldest_dirty_millis: "0",
            checkpoint_batches_started: "0",
            checkpoint_batches_completed: "0",
            checkpoint_pieces_completed: "0",
            checkpoint_sync_operations_completed: "0",
            checkpoint_sync_service_micros: "0",
            checkpoint_sync_service_max_micros: "0",
            checkpoint_commit_service_micros: "0",
            checkpoint_commit_service_max_micros: "0",
            storage_jobs_pending: "0",
            received_bytes_total: "0",
            stored_bytes_total: "0",
            verified_bytes_total: "0",
            receive_rate_bytes: "0",
            write_rate_bytes: "0",
            hash_rate_bytes: "0",
            write_operations_started: "0",
            write_operations_completed: "0",
            hash_operations_started: "0",
            hash_operations_completed: "0",
            write_queue_wait_micros: "0",
            write_queue_wait_max_micros: "0",
            write_service_micros: "0",
            write_service_max_micros: "0",
            hash_queue_wait_micros: "0",
            hash_queue_wait_max_micros: "0",
            hash_service_micros: "0",
            hash_service_max_micros: "0",
            pressure_transition_count: "0",
            backpressured_millis_total: "0",
          },
          pieces: [],
        },
      };
    case "session_dht":
      return {
        type: "snapshot",
        view_id: view.view_id,
        snapshot: { type: "session_dht", inspection: dhtInspection() },
      };
    case "session_current_rates":
      return {
        type: "snapshot",
        view_id: view.view_id,
        snapshot: {
          type: "session_current_rates",
          rates: {
            captured_millis: "1300",
            rates: view.metrics.map((metric) => ({
              metric,
              bytes: metric === "payload_received"
                ? "4096"
                : metric === "payload_uploaded"
                  ? "2048"
                  : "0",
            })),
          },
        },
      };
    case "session_speed_history":
      return {
        type: "snapshot",
        view_id: view.view_id,
        snapshot: {
          type: "session_speed_history",
          history: speedHistory(view),
        },
      };
    case "diagnostics":
      return {
        type: "snapshot",
        view_id: view.view_id,
        snapshot: {
          type: "diagnostics",
          events: [],
          retention: {
            source_evicted_count: "0",
            retained_from_sequence: "1",
          },
        },
      };
    case "piece_activity":
      throw new Error("piece view is not used by live inspection");
  }
}

function dhtInspection(): DhtInspectionView {
  return {
    lifecycle: "participating",
    network_policy: "loopback_only",
    captured_millis: "1300",
    active_transactions: 0,
    active_lookups: 0,
    queries_sent: "0",
    responses_received: "0",
    queries_received: "0",
    malformed_received: "0",
    family_mismatched: "0",
    rate_limited: "0",
    discovered_peers: "0",
    bootstrap_attempts: "1",
    routing_refreshes: "0",
    datagram_bytes_sent: "0",
    datagram_bytes_received: "0",
    announces_sent: "0",
    announces_succeeded: "0",
    announces_failed: "0",
    families: [{
      family: "ipv4",
      lifecycle: "participating",
      local_node_id: TORRENT_ID,
      local_address: "127.0.0.1:6881",
      observed_external_address: null,
      routing_nodes: 0,
      occupied_buckets: 0,
      deepest_shared_prefix_bits: null,
      active_transactions: 0,
      active_lookups: 0,
      queries_sent: "0",
      responses_received: "0",
      queries_received: "0",
      malformed_received: "0",
      family_mismatched: "0",
      rate_limited: "0",
      discovered_peers: "0",
      bootstrap_attempts: "1",
      routing_refreshes: "0",
      datagram_bytes_sent: "0",
      datagram_bytes_received: "0",
      announces_sent: "0",
      announces_succeeded: "0",
      announces_failed: "0",
      buckets: Array.from({ length: 160 }, (_, bucket_index) => ({
        bucket_index,
        good_nodes: 0,
        questionable_nodes: 0,
        replacement_candidates: 0,
        oldest_live_response_age_millis: null,
      })),
    }],
    lookups: [],
  };
}

function speedHistory(
  view: Extract<ViewSpec, { type: "session_speed_history" }>,
): SpeedHistoryView {
  const bucketMillis = view.range === "seconds30" ? "100" : "2000";
  return {
    captured_millis: "1300",
    history_epoch: "test-speed-1",
    range: view.range,
    bucket_millis: bucketMillis,
    start_millis: "1000",
    complete_through_millis: "1299",
    live: true,
    persistence: "healthy" as const,
    series: view.metrics.map((metric) => ({
      metric,
      values: ["1024", "2048", "1024"],
    })),
    catalog: view.metrics.map((metric) => ({
      metric,
      available: true,
      reason: null,
    })),
  };
}

function swarmPeer(generation: number) {
  return {
    peer_record_id: String(generation),
    torrent_id: TORRENT_ID,
    endpoint: `127.0.0.1:${6_880 + generation}`,
    sources: ["tracker" as const, "dht" as const],
    state: "eligible" as const,
    connectable: true,
    first_observed_age_millis: "5000",
    last_observed_age_millis: "100",
    retry_in_millis: null,
    dial_attempts: generation,
    consecutive_failures: 0,
    total_failures: 0,
    last_dial_age_millis: null,
    last_connected_age_millis: null,
    last_failure: null,
    last_failure_age_millis: null,
    payload_downloaded_bytes: (
      9_007_199_254_740_992n + BigInt(generation)
    ).toString(),
    payload_uploaded_bytes: (
      4_503_599_627_370_496n + BigInt(generation)
    ).toString(),
    trust_points: 0,
    hash_failures: 0,
    valid_pieces: 0,
    on_parole: false,
  };
}

function torrent(): TorrentView {
  return {
    torrent_id: TORRENT_ID,
    protocol_identities: { v1: V1_INFO_HASH },
    display_name: "movie.mkv",
    source_display_name: "Unverified source name",
    state: "downloading",
    operational_state: "downloading",
    transfer_limits: {
      upload: { type: "unlimited" },
      download: { type: "unlimited" },
    },
    storage_state: "available",
    storage_root: "downloads",
    metadata_available: true,
    awaiting_file_selection: false,
    selectable_file_count: 1,
    selected_file_count: 1,
    selectable_file_bytes: "131072",
    selected_file_bytes: "131072",
    piece_count: 8,
    total_size_bytes: "131072",
    verified_piece_count: 2,
    requested_bytes: "32768",
    received_bytes: "16384",
    stored_bytes: "16384",
    active_peer_connections: 1,
    configured_tracker_count: 2,
    payload_download_rate_bytes: "4096",
    required_payload_bytes: "131072",
    remaining_payload_bytes: "98304",
    eta_payload_download_rate_bytes: "4096",
    eta: { state: "estimate", seconds: "24" },
    lifetime: {
      uploaded_payload_bytes: "0",
      downloaded_payload_bytes: "16384",
      active_seconds: "1",
      finished_seconds: "0",
      seeding_seconds: "0",
      share_ratio_hundredths: "0",
    },
    seeding: { admission: "ineligible" },
    progress: {
      disposition: "active",
      phase: "transfer",
      reason: "transferring_pieces",
      actions: [],
    },
    checking: {
      generation: "3",
      phase: "hashing",
      pieces_total: 8,
      pieces_processed: 2,
      pieces_matched: 1,
      pieces_absent: 1,
      pieces_mismatched: 0,
      bytes_hashed: "32768",
      active_hash_jobs: 1,
      queued_hash_jobs: 5,
      elapsed_millis: "2500",
      last_advance_age_millis: "300",
      oldest_active_job_age_millis: "700",
    },
    archived: false,
    delete_data_supported: true,
    force_recheck_available: false,
  };
}

function peer(generation: number): PeerView {
  const uploading = generation !== 1;
  return {
    connection_id: `connection-${generation}`,
    torrent_id: TORRENT_ID,
    peer_record_id: "peer-1",
    direction: "incoming",
    transport: uploading ? "tcp" : "utp",
    lifecycle: generation === 1 ? "protocol_handshaking" : "connected",
    role: "content",
    mse_method: generation === 1 ? "plaintext_payload" : "rc4",
    ...(generation === 1
      ? {}
      : {
          peer_flags: [
            "incoming",
            "encrypted",
            "upload_allowed",
            "extension_protocol",
            "metadata_extension",
            "optimistic_unchoke",
          ] satisfies NonNullable<PeerView["peer_flags"]>,
        }),
    lifecycle_age_millis: "12",
    remote_endpoint: "127.0.0.1:6881",
    local_endpoint: uploading ? "127.0.0.1:51413" : null,
    sources: uploading ? ["incoming"] : ["manual"],
    peer_id: null,
    client_name: generation === 1 ? null : "µTorrent 3.5.5",
    supports_extensions: true,
    supports_ut_metadata: true,
    local_interested: uploading ? null : true,
    remote_interested: uploading ? true : null,
    remote_choking: uploading ? null : true,
    local_choking: uploading ? false : null,
    available_piece_count: null,
    wanted_piece_count: null,
    payload_download_rate_bytes: null,
    payload_downloaded_bytes: null,
    protocol_download_rate_bytes: null,
    protocol_downloaded_bytes: null,
    payload_upload_rate_bytes: uploading ? "2048" : null,
    payload_uploaded_bytes: uploading ? "8192" : null,
    pending_requests: uploading ? 2 : null,
    target_requests: null,
    queued_payload_bytes: uploading ? "4096" : null,
    oldest_request_age_millis: null,
    request_timeout_millis: null,
    request_phase: null,
    connected_age_millis: uploading ? "2000" : null,
    last_useful_age_millis: null,
    last_payload_age_millis: uploading ? "250" : null,
    disconnect_reason: null,
    capabilities: {
      local_endpoint: uploading ? "available" : "unavailable",
      client_name: generation === 1 ? "unavailable" : "available",
      ut_metadata: uploading ? "available" : "unavailable",
      interest_directions: uploading ? "available" : "unavailable",
      local_choke: uploading ? "available" : "unavailable",
      piece_availability: "unavailable",
      protocol_rates: "unavailable",
      upload: uploading ? "available" : "unsupported",
      metadata_stage: "unavailable",
    },
  };
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => globalThis.setTimeout(resolve, 1));
  }
  throw new Error("condition was not reached");
}
