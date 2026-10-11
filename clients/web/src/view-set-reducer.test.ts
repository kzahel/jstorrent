import { describe, expect, it } from "vitest";

import type { DhtInspectionView, TorrentView, UpdateBatch } from "./api";
import {
  reduceUpdateBatch,
  ViewSetContinuityError,
  type ViewSetState,
} from "./view-set-reducer";
import { clientSettingsRuntimeFixture } from "./test-support/client-settings";

const torrentId = "t1-000102030405060708090a0b0c0d0e0f";
const v1InfoHash = "000102030405060708090a0b0c0d0e0f10111213";

function torrent(verified: number): TorrentView {
  return {
    torrent_id: torrentId,
    protocol_identities: { v1: v1InfoHash },
    state: verified === 3 ? "complete" : "downloading",
    operational_state: verified === 3 ? "seeding" : "downloading",
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
    selectable_file_bytes: "49152",
    selected_file_bytes: "49152",
    piece_count: 3,
    total_size_bytes: "49152",
    verified_piece_count: verified,
    requested_bytes: "16384",
    received_bytes: "16384",
    stored_bytes: "16384",
    active_peer_connections: 0,
    payload_download_rate_bytes: "0",
    required_payload_bytes: "49152",
    remaining_payload_bytes: verified === 3 ? "0" : "32768",
    eta_payload_download_rate_bytes: verified === 3 ? "0" : "4096",
    eta:
      verified === 3
        ? { state: "unavailable" }
        : { state: "estimate", seconds: "8" },
    lifetime: {
      uploaded_payload_bytes: "0",
      downloaded_payload_bytes: "16384",
      active_seconds: "0",
      finished_seconds: "0",
      seeding_seconds: "0",
      share_ratio_hundredths: "0",
    },
    seeding: {
      admission: verified === 3 ? "active" : "ineligible",
      ...(verified === 3
        ? {
            goal: {
              status: "met" as const,
              share_ratio_met: true,
              finished_download_ratio_met: false,
              finished_time_met: false,
            },
          }
        : {}),
    },
    progress: {
      disposition: verified === 3 ? "inactive" : "active",
      phase: verified === 3 ? "complete" : "transfer",
      reason: verified === 3 ? "complete" : "transferring_pieces",
      actions: [],
    },
    archived: false,
    delete_data_supported: true,
    force_recheck_available: true,
  };
}

function dhtInspection(captured: string): DhtInspectionView {
  return {
    lifecycle: "participating",
    network_policy: "loopback_only",
    captured_millis: captured,
    active_transactions: 0,
    active_lookups: 0,
    queries_sent: "0",
    responses_received: "0",
    queries_received: "0",
    malformed_received: "0",
    family_mismatched: "0",
    rate_limited: "0",
    discovered_peers: "0",
    bootstrap_attempts: "0",
    routing_refreshes: "0",
    datagram_bytes_sent: "0",
    datagram_bytes_received: "0",
    announces_sent: "0",
    announces_succeeded: "0",
    announces_failed: "0",
    families: [{
      family: "ipv4",
      lifecycle: "participating",
      local_node_id: torrentId,
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
      bootstrap_attempts: "0",
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

function batch(
  baseCursor: string,
  cursor: string,
  updates: UpdateBatch["updates"],
  epoch = "7",
): UpdateBatch {
  return {
    api_version: 1,
    server_now_millis: "0",
    view_set_id: "vs_000102030405060708090a0b0c0d0e0f",
    epoch,
    base_cursor: baseCursor,
    cursor,
    durable_revision: cursor,
    updates,
  };
}

describe("view-set reducer", () => {
  it("applies typed torrent fields and distinguishes nullable clear from unchanged", () => {
    const initialTorrent = { ...torrent(0), display_name: "Provisional" };
    let state = reduceUpdateBatch(
      undefined,
      batch("0", "1", [
        {
          type: "snapshot",
          view_id: "library",
          snapshot: {
            type: "torrent_list",
            torrents: [initialTorrent],
            storage: { roots: [], show_add_options: true, show_file_selection: true },
            client_settings: clientSettingsRuntimeFixture(),
          },
        },
        {
          type: "snapshot",
          view_id: "summary",
          snapshot: { type: "torrent", torrent: initialTorrent },
        },
      ]),
    );
    state = reduceUpdateBatch(
      state,
      batch("1", "2", [
        {
          type: "patch",
          view_id: "library",
          patch: {
            type: "torrent_list",
            upsert: [],
            updates: [{
              torrent_id: torrentId,
              fields: [
                { field: "display_name", value: null },
                { field: "download_queue_position", value: 4 },
                { field: "total_size_bytes", value: null },
              ],
            }],
            removed: [],
          },
        },
        {
          type: "patch",
          view_id: "summary",
          patch: {
            type: "torrent",
            change: {
              change: "update",
              update: {
                torrent_id: torrentId,
                fields: [
                  { field: "display_name", value: "Verified" },
                  { field: "total_size_bytes", value: "65536" },
                ],
              },
            },
          },
        },
      ]),
    );
    expect(state.views.library).toMatchObject({
      torrents: [{
        display_name: null,
        download_queue_position: 4,
        total_size_bytes: null,
      }],
    });
    expect(state.views.summary).toMatchObject({
      torrent: { display_name: "Verified", total_size_bytes: "65536" },
    });
    expect(
      state.views.summary!.type === "torrent"
        ? state.views.summary!.torrent?.download_queue_position
        : null,
    ).toBeUndefined();
  });

  it("applies one atomic pending-selection confirmation patch", () => {
    const pending = {
      ...torrent(0),
      state: "paused" as const,
      operational_state: "paused" as const,
      awaiting_file_selection: true,
      pending_file_selection_position: 0,
      file_catalog_id: "a".repeat(64),
      selectable_file_count: 2,
      selected_file_count: 2,
      selectable_file_bytes: "65536",
      selected_file_bytes: "65536",
    };
    const established = reduceUpdateBatch(
      undefined,
      batch("0", "1", [{
        type: "snapshot",
        view_id: "library",
        snapshot: {
          type: "torrent_list",
          torrents: [pending],
          storage: { roots: [], show_add_options: true, show_file_selection: true },
          client_settings: clientSettingsRuntimeFixture(),
        },
      }]),
    );
    const confirmed = reduceUpdateBatch(
      established,
      batch("1", "2", [{
        type: "patch",
        view_id: "library",
        patch: {
          type: "torrent_list",
          upsert: [],
          updates: [{
            torrent_id: torrentId,
            fields: [
              { field: "awaiting_file_selection", value: false },
              { field: "pending_file_selection_position", value: null },
              { field: "file_catalog_id", value: null },
              { field: "selected_file_count", value: 1 },
              { field: "selected_file_bytes", value: "49152" },
            ],
          }],
          removed: [],
        },
      }]),
    );
    expect(confirmed.views.library).toMatchObject({
      torrents: [{
        awaiting_file_selection: false,
        pending_file_selection_position: null,
        file_catalog_id: null,
        selected_file_count: 1,
        selected_file_bytes: "49152",
      }],
    });
  });

  it("replaces selected preparation atomically and enforces torrent identity", () => {
    let state = reduceUpdateBatch(
      undefined,
      batch("0", "1", [{
        type: "snapshot",
        view_id: "preparation",
        snapshot: {
          type: "torrent_preparation",
          torrent_id: torrentId,
          preparation: {
            generation: "4",
            metadata: {
              phase: "downloading",
              total_size_bytes: "32771",
              received_bytes: "16384",
              block_count: 3,
              block_states: "Fg==",
              active_peers: 1,
              requests_in_flight: 2,
              hash_retries: 0,
            },
            integrity: null,
          },
        },
      }]),
    );
    state = reduceUpdateBatch(
      state,
      batch("1", "2", [{
        type: "patch",
        view_id: "preparation",
        patch: {
          type: "torrent_preparation",
          torrent_id: torrentId,
          preparation: {
            generation: "4",
            metadata: null,
            integrity: {
              phase: "waiting_for_peer",
              needed_hash_ranges: 3,
              active_requests: 0,
            },
          },
        },
      }]),
    );
    expect(state.views.preparation).toMatchObject({
      preparation: {
        generation: "4",
        metadata: null,
        integrity: { phase: "waiting_for_peer", needed_hash_ranges: 3 },
      },
    });

    expect(() =>
      reduceUpdateBatch(
        state,
        batch("2", "3", [{
          type: "patch",
          view_id: "preparation",
          patch: {
            type: "torrent_preparation",
            torrent_id: "t1-11111111111111111111111111111111",
            preparation: null,
          },
        }]),
      )
    ).toThrow(/preparation torrent identity mismatch/);
  });

  it("rejects sparse updates without a base row or with duplicate fields", () => {
    const state = reduceUpdateBatch(
      undefined,
      batch("0", "1", [{
        type: "snapshot",
        view_id: "library",
        snapshot: {
          type: "torrent_list",
          torrents: [],
          storage: { roots: [], show_add_options: true, show_file_selection: true },
          client_settings: clientSettingsRuntimeFixture(),
        },
      }]),
    );
    expect(() => reduceUpdateBatch(state, batch("1", "2", [{
      type: "patch",
      view_id: "library",
      patch: {
        type: "torrent_list",
        upsert: [],
        updates: [{
          torrent_id: torrentId,
          fields: [{ field: "display_name", value: "Missing" }],
        }],
        removed: [],
      },
    }]))).toThrow(ViewSetContinuityError);

    const established = reduceUpdateBatch(
      undefined,
      batch("0", "1", [{
        type: "snapshot",
        view_id: "library",
        snapshot: {
          type: "torrent_list",
          torrents: [torrent(0)],
          storage: { roots: [], show_add_options: true, show_file_selection: true },
          client_settings: clientSettingsRuntimeFixture(),
        },
      }]),
    );
    expect(() => reduceUpdateBatch(established, batch("1", "2", [{
      type: "patch",
      view_id: "library",
      patch: {
        type: "torrent_list",
        upsert: [],
        updates: [{
          torrent_id: torrentId,
          fields: [
            { field: "display_name", value: "one" },
            { field: "display_name", value: "two" },
          ],
        }],
        removed: [],
      },
    }]))).toThrow(ViewSetContinuityError);
  });

  it("applies storage settings independently of torrent rows", () => {
    let state = reduceUpdateBatch(
      undefined,
      batch("0", "1", [
        {
          type: "snapshot",
          view_id: "library",
          snapshot: {
            type: "torrent_list",
            torrents: [],
            storage: { roots: [], show_add_options: true, show_file_selection: true },
            client_settings: clientSettingsRuntimeFixture(),
          },
        },
      ]),
    );
    state = reduceUpdateBatch(
      state,
      batch("1", "2", [
        {
          type: "patch",
          view_id: "library",
          patch: {
            type: "torrent_list",
            upsert: [],
            updates: [],
            removed: [],
            storage: {
              roots: [
                {
                  root_id: "root_a",
                  label: "Downloads",
                  display_path: "/Users/test/Downloads",
                  availability: "available",
                },
              ],
              default_root: "root_a",
              show_add_options: false,
              show_file_selection: false,
            },
          },
        },
      ]),
    );
    expect(state.views.library).toMatchObject({
      type: "torrent_list",
      torrents: [],
      storage: {
        default_root: "root_a",
        show_add_options: false,
        show_file_selection: false,
      },
    });
  });

  it("replaces client settings runtime state independently of torrent rows", () => {
    let state = reduceUpdateBatch(
      undefined,
      batch("0", "1", [
        {
          type: "snapshot",
          view_id: "library",
          snapshot: {
            type: "torrent_list",
            torrents: [],
            storage: { roots: [], show_add_options: true, show_file_selection: true },
            client_settings: clientSettingsRuntimeFixture(),
          },
        },
      ]),
    );
    const configured = {
      listener: { type: "automatic_loopback" as const },
      preferred_listen_port: 6_881,
      port_mapping: "disabled" as const,
      peer_connection_limit: 320,
      upload_slots: 12,
      active_downloads: 3,
      active_seeds: { type: "limited" as const, torrents: 5 },
      share_ratio_limit_percent: 200,
      finished_download_ratio_limit_percent: 700,
      finished_time_limit_seconds: 86_400,
      upload_rate_limit: { type: "unlimited" as const },
      download_rate_limit: { type: "unlimited" as const },
      encryption: "allow" as const,
      ipv6_enabled: true,
      dht_enabled: true,
      peer_exchange_enabled: true,
      tracker_https_server_authentication: "system_trust" as const,
    };
    state = reduceUpdateBatch(
      state,
      batch("1", "2", [
        {
          type: "patch",
          view_id: "library",
          patch: {
            type: "torrent_list",
            upsert: [],
            updates: [],
            removed: [],
            client_settings: {
              ...clientSettingsRuntimeFixture(),
              configured,
              transport_application: { type: "applying" },
              port_mapping_application: { type: "applying" },
              peer_connections_application: { type: "applying" },
              upload_slots_application: { type: "applying" },
              encryption_application: { type: "applying" },
              tracker_https_authentication_application: { type: "applying" },
            },
          },
        },
      ]),
    );
    expect(state.views.library).toMatchObject({
      type: "torrent_list",
      torrents: [],
      client_settings: {
        configured,
        transport_application: { type: "applying" },
      },
    });
  });

  it("replaces the hash-only row when verified metadata supplies a name", () => {
    let state = reduceUpdateBatch(
      undefined,
      batch("0", "1", [
        {
          type: "snapshot",
          view_id: "library",
          snapshot: {
            type: "torrent_list",
            torrents: [torrent(0)],
            storage: { roots: [], show_add_options: true, show_file_selection: true },
            client_settings: clientSettingsRuntimeFixture(),
          },
        },
      ]),
    );
    state = reduceUpdateBatch(
      state,
      batch("1", "2", [
        {
          type: "patch",
          view_id: "library",
          patch: {
            type: "torrent_list",
            upsert: [{ ...torrent(0), display_name: "Verified torrent" }],
            updates: [],
            removed: [],
          },
        },
      ]),
    );
    expect(state.views.library).toMatchObject({
      type: "torrent_list",
      torrents: [{ display_name: "Verified torrent" }],
    });
  });

  it("applies complete keyed file rows without losing catalog metadata", () => {
    const first = {
      file_id: "0",
      file_index: 0,
      path: ["video", "movie.mkv"],
      length_bytes: "9007199254740993",
      torrent_offset_bytes: "0",
      first_piece: 0,
      last_piece: 9,
      selection: "normal" as const,
      padding: false,
      done_bytes: "16384",
      verified_bytes: "0",
      media_availability: "unverified" as const,
    };
    let state = reduceUpdateBatch(
      undefined,
      batch("0", "1", [
        {
          type: "snapshot",
          view_id: "files",
          snapshot: {
            type: "files",
            torrent_id: torrentId,
            state: "available",
            filesystem_content_base: "/tmp/content",
            page: { offset: 0, limit: 1024, total: 1, next_offset: null },
            files: [first],
          },
        },
      ]),
    );
    state = reduceUpdateBatch(
      state,
      batch("1", "2", [
        {
          type: "patch",
          view_id: "files",
          patch: {
            type: "files",
            torrent_id: torrentId,
            upsert: [{ ...first, done_bytes: "32768", verified_bytes: "16384" }],
            updates: [],
            removed: [],
          },
        },
      ]),
    );
    expect(state.views.files).toMatchObject({
      type: "files",
      state: "available",
      filesystem_content_base: "/tmp/content",
      files: [{ file_id: "0", done_bytes: "32768", verified_bytes: "16384" }],
    });
  });

  it("applies complete keyed media rows without losing catalog metadata", () => {
    const first = {
      media_id: "0",
      file_index: 0,
      path: ["Show.Name.S01E02.mkv"],
      extension: "mkv",
      length_bytes: "32768",
      selection: "normal" as const,
      done_bytes: "16384",
      verified_bytes: "0",
      media_availability: "unverified" as const,
      role: {
        type: "episode" as const,
        series_title_hint: "Show Name",
        season_number: 1,
        episode_number: 2,
        ending_episode_number: null,
      },
    };
    let state = reduceUpdateBatch(
      undefined,
      batch("0", "1", [
        {
          type: "snapshot",
          view_id: "media",
          snapshot: {
            type: "media",
            torrent_id: torrentId,
            state: "available",
            total_non_padding_files: 3,
            items: [first],
          },
        },
      ]),
    );
    state = reduceUpdateBatch(
      state,
      batch("1", "2", [
        {
          type: "patch",
          view_id: "media",
          patch: {
            type: "media",
            torrent_id: torrentId,
            upsert: [{
              ...first,
              done_bytes: "32768",
              verified_bytes: "32768",
              media_availability: "available",
            }],
            removed: [],
          },
        },
      ]),
    );
    expect(state.views.media).toMatchObject({
      type: "media",
      state: "available",
      total_non_padding_files: 3,
      items: [{ media_id: "0", verified_bytes: "32768" }],
    });
  });

  it("replaces disk pipeline state and applies keyed piece changes", () => {
    const pipeline = diskPipeline("normal");
    const first = diskPiece("torrent-a:3:1", 3, "receiving");
    let state = reduceUpdateBatch(
      undefined,
      batch("0", "1", [
        {
          type: "snapshot",
          view_id: "disk",
          snapshot: { type: "session_disk", pipeline, pieces: [first] },
        },
      ]),
    );
    const replacement = diskPiece("torrent-a:4:1", 4, "writing");
    state = reduceUpdateBatch(
      state,
      batch("1", "2", [
        {
          type: "patch",
          view_id: "disk",
          patch: {
            type: "session_disk",
            pipeline: diskPipeline("backpressured"),
            upsert: [replacement],
            removed: [first.row_id],
          },
        },
      ]),
    );
    expect(state.views.disk).toMatchObject({
      type: "session_disk",
      pipeline: { pressure: "backpressured", intake_backpressured: true },
      pieces: [{ row_id: "torrent-a:4:1", piece_index: 4, stage: "writing" }],
    });
  });

  it("replaces the complete DHT observation on a patch", () => {
    let state = reduceUpdateBatch(
      undefined,
      batch("0", "1", [{
        type: "snapshot",
        view_id: "dht",
        snapshot: { type: "session_dht", inspection: dhtInspection("1") },
      }]),
    );
    state = reduceUpdateBatch(
      state,
      batch("1", "2", [{
        type: "patch",
        view_id: "dht",
        patch: { type: "session_dht", inspection: dhtInspection("2") },
      }]),
    );
    const view = state.views.dht;
    expect(view?.type).toBe("session_dht");
    if (view?.type !== "session_dht") throw new Error("missing DHT view");
    expect(view.inspection.captured_millis).toBe("2");
    expect(view.inspection.families[0]?.buckets).toHaveLength(160);
    expect(view.inspection.families[0]?.buckets[0]?.bucket_index).toBe(0);
  });

  it("replaces current rates without carrying graph history", () => {
    let state = reduceUpdateBatch(
      undefined,
      batch("0", "1", [{
        type: "snapshot",
        view_id: "rates",
        snapshot: {
          type: "session_current_rates",
          rates: {
            captured_millis: "1000",
            rates: [{ metric: "payload_received", bytes: "10" }],
          },
        },
      }]),
    );
    state = reduceUpdateBatch(state, batch("1", "2", [{
      type: "patch",
      view_id: "rates",
      patch: {
        type: "session_current_rates",
        rates: {
          captured_millis: "1100",
          rates: [{ metric: "payload_received", bytes: "25" }],
        },
      },
    }]));
    expect(state.views.rates).toEqual({
      type: "session_current_rates",
      rates: {
        captured_millis: "1100",
        rates: [{ metric: "payload_received", bytes: "25" }],
      },
    });
  });

  it("applies every completed speed bucket from a coalesced append", () => {
    let state = reduceUpdateBatch(
      undefined,
      batch("0", "1", [{
        type: "snapshot",
        view_id: "speed",
        snapshot: speedSnapshot(),
      }]),
    );
    state = reduceUpdateBatch(state, batch("1", "2", [{
      type: "patch",
      view_id: "speed",
      patch: {
        type: "session_speed_history",
        append: {
          captured_millis: "400",
          history_epoch: "history-1",
          base_complete_through_millis: "200",
          start_millis: "100",
          complete_through_millis: "400",
          series: [{
            metric: "payload_received",
            values: ["30", null],
          }],
        },
      },
    }]));
    expect(state.views.speed).toMatchObject({
      type: "session_speed_history",
      history: {
        captured_millis: "400",
        start_millis: "100",
        complete_through_millis: "400",
        series: [{ values: ["20", "30", "30", null] }],
      },
    });
  });

  it("rejects speed appends with a gap or incompatible shape", () => {
    const state = reduceUpdateBatch(
      undefined,
      batch("0", "1", [{
        type: "snapshot",
        view_id: "speed",
        snapshot: speedSnapshot(),
      }]),
    );
    const append = {
      captured_millis: "300",
      history_epoch: "history-1",
      base_complete_through_millis: "100",
      start_millis: "0",
      complete_through_millis: "300",
      series: [{ metric: "payload_received" as const, values: ["30"] }],
    };
    expect(() => reduceUpdateBatch(state, batch("1", "2", [{
      type: "patch",
      view_id: "speed",
      patch: { type: "session_speed_history", append },
    }]))).toThrow(ViewSetContinuityError);

    expect(() => reduceUpdateBatch(state, batch("1", "2", [{
      type: "patch",
      view_id: "speed",
      patch: {
        type: "session_speed_history",
        append: {
          ...append,
          base_complete_through_millis: "200",
          series: [{ metric: "payload_uploaded", values: ["30"] }],
        },
      },
    }]))).toThrow(ViewSetContinuityError);
  });

  it("applies compact verified changes and keyed active piece retries", () => {
    const first = activePiece(0, 1, "received");
    let state = reduceUpdateBatch(
      undefined,
      batch("0", "1", [
        {
          type: "snapshot",
          view_id: "pieces",
          snapshot: {
            type: "piece_activity",
            torrent_id: torrentId,
            piece_count: 3,
            verified: [],
            active: [first],
          },
        },
      ]),
    );
    state = reduceUpdateBatch(
      state,
      batch("1", "2", [
        {
          type: "patch",
          view_id: "pieces",
          patch: {
            type: "piece_activity",
            torrent_id: torrentId,
            piece_count: 3,
            verified: [{ start: 1, end_exclusive: 2 }],
            cleared: [],
            active_upsert: [activePiece(0, 2, "requested")],
            active_updates: [],
            active_removed: [first.piece_id],
          },
        },
      ]),
    );
    expect(state.views.pieces).toMatchObject({
      type: "piece_activity",
      verified: [{ start: 1, end_exclusive: 2 }],
      active: [{ piece_id: "0:2", attempt: 2, stage: "requested" }],
    });
  });

  it("reduces snapshots, keyed patches, removals, and later upserts", () => {
    let state = reduceUpdateBatch(
      undefined,
      batch("0", "1", [
        {
          type: "snapshot",
          view_id: "library",
          snapshot: {
            type: "torrent_list",
            torrents: [torrent(0)],
            storage: { roots: [], show_add_options: true, show_file_selection: true },
            client_settings: clientSettingsRuntimeFixture(),
          },
        },
      ]),
    );
    state = reduceUpdateBatch(
      state,
      batch("1", "2", [
        {
          type: "patch",
          view_id: "library",
          patch: { type: "torrent_list", upsert: [], updates: [], removed: [torrentId] },
        },
      ]),
    );
    expect(state.views.library).toEqual({
      type: "torrent_list",
      torrents: [],
      storage: { roots: [], show_add_options: true, show_file_selection: true },
      client_settings: clientSettingsRuntimeFixture(),
    });
    state = reduceUpdateBatch(
      state,
      batch("2", "3", [
        {
          type: "patch",
          view_id: "library",
          patch: { type: "torrent_list", upsert: [torrent(3)], updates: [], removed: [] },
        },
      ]),
    );
    expect(state.views.library).toEqual({
      type: "torrent_list",
      torrents: [torrent(3)],
      storage: { roots: [], show_add_options: true, show_file_selection: true },
      client_settings: clientSettingsRuntimeFixture(),
    });
    state = reduceUpdateBatch(
      state,
      batch("3", "4", [{ type: "view_removed", view_id: "library" }]),
    );
    expect(state.views.library).toBeUndefined();
  });

  it("applies bounded keyed swarm rows and coherent summary transitions", () => {
    let state = reduceUpdateBatch(
      undefined,
      batch("0", "1", [
        {
          type: "snapshot",
          view_id: "swarm",
          snapshot: {
            type: "swarm",
            torrent_id: torrentId,
            state: "active",
            captured_millis: "1000",
            maximum_records: 1000,
            counts: {
              total: 0,
              eligible: 0,
              not_connectable: 0,
              dialing: 0,
              connected: 0,
              backed_off: 0,
              failure_limited: 0,
              banned: 0,
            },
            peers: [],
          },
        },
      ]),
    );
    const peer = {
      peer_record_id: "7",
      torrent_id: torrentId,
      endpoint: "127.0.0.1:6881",
      sources: ["tracker" as const, "dht" as const],
      state: "backed_off" as const,
      connectable: true,
      first_observed_age_millis: "5000",
      last_observed_age_millis: "200",
      retry_in_millis: "8000",
      dial_attempts: 2,
      consecutive_failures: 1,
      total_failures: 1,
      last_dial_age_millis: "1000",
      last_connected_age_millis: null,
      last_failure: "connect" as const,
      last_failure_age_millis: "900",
      payload_downloaded_bytes: "9007199254740993",
      payload_uploaded_bytes: "4503599627370497",
      trust_points: 0,
      hash_failures: 0,
      valid_pieces: 0,
      on_parole: false,
    };
    state = reduceUpdateBatch(
      state,
      batch("1", "2", [
        {
          type: "patch",
          view_id: "swarm",
          patch: {
            type: "swarm",
            torrent_id: torrentId,
            state: "active",
            captured_millis: "2000",
            maximum_records: 1000,
            counts: {
              total: 1,
              eligible: 0,
              not_connectable: 0,
              dialing: 0,
              connected: 0,
              backed_off: 1,
              failure_limited: 0,
              banned: 0,
            },
            upsert: [peer],
            removed: [],
          },
        },
      ]),
    );
    expect(state.views.swarm).toMatchObject({
      type: "swarm",
      counts: { total: 1, backed_off: 1 },
      peers: [
        {
          peer_record_id: "7",
          sources: ["tracker", "dht"],
          payload_downloaded_bytes: "9007199254740993",
          payload_uploaded_bytes: "4503599627370497",
        },
      ],
    });

    state = reduceUpdateBatch(
      state,
      batch("2", "3", [
        {
          type: "patch",
          view_id: "swarm",
          patch: {
            type: "swarm",
            torrent_id: torrentId,
            state: "inactive",
            captured_millis: "3000",
            maximum_records: 1000,
            counts: {
              total: 0,
              eligible: 0,
              not_connectable: 0,
              dialing: 0,
              connected: 0,
              backed_off: 0,
              failure_limited: 0,
              banned: 0,
            },
            upsert: [],
            removed: ["7"],
          },
        },
      ]),
    );
    expect(state.views.swarm).toMatchObject({
      type: "swarm",
      state: "inactive",
      peers: [],
    });
  });

  it("treats an already-applied replay as idempotent", () => {
    const initial = batch("0", "1", [
      {
        type: "snapshot",
        view_id: "library",
        snapshot: {
          type: "torrent_list",
          torrents: [],
          storage: { roots: [], show_add_options: true, show_file_selection: true },
          client_settings: clientSettingsRuntimeFixture(),
        },
      },
    ]);
    const state = reduceUpdateBatch(undefined, initial);
    expect(reduceUpdateBatch(state, initial)).toBe(state);
  });

  it("clears stale state and accepts snapshots after an epoch reset", () => {
    const state = reduceUpdateBatch(
      undefined,
      batch("0", "1", [
        {
          type: "snapshot",
          view_id: "library",
          snapshot: {
            type: "torrent_list",
            torrents: [torrent(0)],
            storage: { roots: [], show_add_options: true, show_file_selection: true },
            client_settings: clientSettingsRuntimeFixture(),
          },
        },
      ]),
    );
    const reset = reduceUpdateBatch(
      state,
      batch(
        "2",
        "3",
        [
          { type: "reset_required", reason: "queue_overflow" },
          {
            type: "snapshot",
            view_id: "pieces",
            snapshot: {
              type: "piece_activity",
              torrent_id: torrentId,
              piece_count: 3,
              verified: [{ start: 0, end_exclusive: 1 }],
              active: [],
            },
          },
        ],
        "8",
      ),
    );
    expect(reset.views.library).toBeUndefined();
    expect(reset.views.pieces?.type).toBe("piece_activity");
    expect(reset.cursor).toBe("3");
    expect(reset.deliveryResetCount).toBe(1);
    expect(reset.lastDeliveryResetReason).toBe("queue_overflow");
  });

  it("rejects gaps, wrong identities, and patches without snapshots", () => {
    const state: ViewSetState = {
      viewSetId: "vs_000102030405060708090a0b0c0d0e0f",
      epoch: "7",
      cursor: "1",
      durableRevision: "1",
      serverNowMillis: "0",
      views: {},
      deliveryResetCount: 0,
      lastDeliveryResetReason: null,
    };
    expect(() =>
      reduceUpdateBatch(state, batch("2", "3", [])),
    ).toThrow(ViewSetContinuityError);
    expect(() =>
      reduceUpdateBatch(
        state,
        batch("1", "2", [
          {
            type: "patch",
            view_id: "missing",
            patch: { type: "torrent_list", upsert: [], updates: [], removed: [] },
          },
        ]),
      ),
    ).toThrow(ViewSetContinuityError);
  });
});

function diskPipeline(pressure: "normal" | "backpressured") {
  return {
    pressure,
    checkpoint_stage: "idle" as const,
    intake_backpressured: pressure === "backpressured",
    sample_millis: "1000",
    resident_limit_bytes: "1048576",
    resident_high_watermark_bytes: "786432",
    resident_low_watermark_bytes: "524288",
    requested_bytes: "65536",
    resident_bytes: "32768",
    queued_write_bytes: "16384",
    writing_bytes: "16384",
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
    storage_jobs_pending: "1",
    received_bytes_total: "32768",
    stored_bytes_total: "16384",
    verified_bytes_total: "0",
    receive_rate_bytes: "32768",
    write_rate_bytes: "16384",
    hash_rate_bytes: "0",
    write_operations_started: "1",
    write_operations_completed: "0",
    hash_operations_started: "0",
    hash_operations_completed: "0",
    write_queue_wait_micros: "100",
    write_queue_wait_max_micros: "100",
    write_service_micros: "0",
    write_service_max_micros: "0",
    hash_queue_wait_micros: "0",
    hash_queue_wait_max_micros: "0",
    hash_service_micros: "0",
    hash_service_max_micros: "0",
    pressure_transition_count: pressure === "backpressured" ? "1" : "0",
    backpressured_millis_total: "0",
  };
}

function speedSnapshot() {
  return {
    type: "session_speed_history" as const,
    history: {
      captured_millis: "250",
      history_epoch: "history-1",
      range: "seconds30" as const,
      bucket_millis: "100",
      start_millis: "0",
      complete_through_millis: "200",
      live: true,
      persistence: "healthy" as const,
      series: [{
        metric: "payload_received" as const,
        values: ["10", null, "20", "30"],
      }],
      catalog: [{ metric: "payload_received" as const, available: true }],
    },
  };
}

function activePiece(
  pieceIndex: number,
  attempt: number,
  stage: "requested" | "received",
) {
  return {
    piece_id: `${pieceIndex}:${attempt}`,
    piece_index: pieceIndex,
    attempt,
    piece_length: 262144,
    stage,
    requested: stage === "requested" ? [{ start: 0, end_exclusive: 16384 }] : [],
    received: stage === "received" ? [{ start: 0, end_exclusive: 16384 }] : [],
    stored: [],
    age_millis: "100",
  };
}

function diskPiece(
  rowId: string,
  pieceIndex: number,
  stage: "receiving" | "writing",
) {
  return {
    row_id: rowId,
    torrent_id: torrentId,
    torrent_name: "Test torrent",
    piece_index: pieceIndex,
    piece_length: 262144,
    attempt: 1,
    stage,
    requested_bytes: "16384",
    received_bytes: "16384",
    stored_bytes: "0",
    stage_age_millis: "10",
    age_millis: "20",
  };
}
