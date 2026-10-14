import { describe, expect, it } from "vitest";

import {
  DEFAULT_CLIENT_SETTINGS_RUNTIME_VIEW,
  type TorrentView,
} from "./api";
import {
  ContractError,
  decodeApiHello,
  decodeApplicationServerFrame,
  decodeChooseDownloadRootResponse,
  decodeMediaUrlResponse,
  decodeResponseEnvelope,
  decodeUpdateBatch,
} from "./validation";
import { clientSettingsRuntimeFixture } from "./test-support/client-settings";
import { reduceUpdateBatch } from "./view-set-reducer";

const TEST_TORRENT_ID = "t1-00000000000000000000000000000000";
const OTHER_TORRENT_ID = "t1-11111111111111111111111111111111";

describe("API hello product validation", () => {
  const base = {
    api: { current: 1, minimum: 1 },
    encodings: ["json"],
    deliveries: ["stream"],
    capabilities: ["torrent_list"],
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
  const product = {
    kind: "desktop",
    version: "0.3.1",
    build_id: "0123456789abcdef0123456789abcdef01234567",
    target: "aarch64-apple-darwin",
    identifier: "com.jstorrent.desktop",
    profile_id: "default",
    profile_location: "/Users/test/Library/Application Support/com.jstorrent.desktop/profile",
  };

  it("accepts a hello with or without host product facts", () => {
    expect(decodeApiHello(JSON.stringify(base)).product).toBeUndefined();
    expect(decodeApiHello(JSON.stringify({ ...base, product })).product).toEqual(product);
    const { identifier: _identifier, profile_location: _location, ...minimal } = product;
    expect(decodeApiHello(JSON.stringify({ ...base, product: minimal })).product).toEqual(minimal);
  });

  it("rejects oversized or missing product facts", () => {
    expect(() => decodeApiHello(JSON.stringify({ ...base, product: { ...product, version: "1".repeat(65) } })))
      .toThrow(ContractError);
    const { profile_id: _profile, ...missing } = product;
    expect(() => decodeApiHello(JSON.stringify({ ...base, product: missing }))).toThrow(ContractError);
  });
});

describe("download folder response validation", () => {
  it("accepts selection or cancellation and rejects an oversized label", () => {
    const selected = {
      root: {
        root_id: "root_a",
        label: "Downloads",
        display_path: "/Users/test/Downloads",
        availability: "available",
      },
    };
    expect(
      decodeChooseDownloadRootResponse(JSON.stringify(selected)).root,
    ).toMatchObject({ root_id: "root_a" });
    expect(
      decodeChooseDownloadRootResponse('{"root":null}').root,
    ).toBeNull();
    selected.root.label = "x".repeat(257);
    expect(() =>
      decodeChooseDownloadRootResponse(JSON.stringify(selected)),
    ).toThrow(/label exceeds 256 bytes/);
  });
});

describe("media URL response validation", () => {
  it("accepts bounded HTTP capabilities and rejects active or ambiguous URLs", () => {
    const response = {
      torrent_id: "t1-000102030405060708090a0b0c0d0e0f",
      file_index: 2,
      outcome: {
        type: "created",
        url: "http://127.0.0.1:43121/media/v1/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        idle_timeout_millis: "1800000",
        absolute_timeout_millis: "86400000",
      },
    };
    expect(decodeMediaUrlResponse(JSON.stringify(response))).toEqual(response);
    for (const url of [
      "javascript:alert(1)",
      "http://user@127.0.0.1:43121/media/v1/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      "http://127.0.0.1:43121/media/v1/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA?copy=1",
    ]) {
      response.outcome.url = url;
      expect(() => decodeMediaUrlResponse(JSON.stringify(response))).toThrow(
        ContractError,
      );
    }
  });
});

describe("application connection validation", () => {
  it("rejects unknown variants and non-canonical ranges", () => {
    expect(() =>
      decodeApplicationServerFrame(JSON.stringify({ type: "invented" })),
    ).toThrow(ContractError);
    expect(() =>
      decodeApplicationServerFrame(
        JSON.stringify({
          type: "view_batch",
          stream_id: "view-1",
          batch: {
            ...peerBatch(TEST_TORRENT_ID),
            epoch: "not-decimal",
          },
        }),
      ),
    ).toThrow(ContractError);
  });
});

describe("magnet export validation", () => {
  it("accepts a bounded typed result and rejects oversized UTF-8", () => {
    const response = {
      version: 1,
      request_id: "export-1",
      revision: "4",
      result: {
        type: "export_magnet",
        result: {
          magnet:
            "magnet:?xt=urn:btih:000102030405060708090a0b0c0d0e0f10111213",
          source: "synthesized",
          omitted_tracker_count: 0,
        },
      },
      status: "success",
      snapshot: {
        profile_id: "default",
        revision: "4",
        storage: { roots: [], show_add_options: true, show_file_selection: true },
        torrents: [],
      },
    };
    expect(decodeResponseEnvelope(JSON.stringify(response)).result).toEqual(
      response.result,
    );

    response.result.result.magnet = "é".repeat(8_193);
    expect(() => decodeResponseEnvelope(JSON.stringify(response))).toThrow(
      /exported magnet exceeds 16384 UTF-8 bytes/,
    );
  });

  it("accepts reported peer hints and rejects unknown or excess values", () => {
    const response = (result: Record<string, unknown>) =>
      JSON.stringify({
        version: 1,
        request_id: "export-2",
        revision: "4",
        result: {
          type: "export_magnet",
          result: {
            magnet:
              "magnet:?xt=urn:btih:000102030405060708090a0b0c0d0e0f10111213",
            source: "synthesized",
            omitted_tracker_count: 0,
            ...result,
          },
        },
        status: "success",
        snapshot: {
          profile_id: "default",
          revision: "4",
          storage: { roots: [], show_add_options: true, show_file_selection: true },
          torrents: [],
        },
      });
    const hint = { endpoint: "192.168.1.20:6881", scope: "local_network" };
    expect(() =>
      decodeResponseEnvelope(response({ peer_hints: [hint] })),
    ).not.toThrow();
    expect(() =>
      decodeResponseEnvelope(response({ peer_hint_omission: "not_reachable" })),
    ).not.toThrow();
    expect(() =>
      decodeResponseEnvelope(response({ peer_hints: [hint, hint, hint] })),
    ).toThrow(ContractError);
    expect(() =>
      decodeResponseEnvelope(
        response({ peer_hints: [{ ...hint, scope: "global" }] }),
      ),
    ).toThrow(ContractError);
    expect(() =>
      decodeResponseEnvelope(response({ peer_hint_omission: "unknown" })),
    ).toThrow(ContractError);
  });
});

describe("client settings validation", () => {
  it("applies Rust-owned defaults to older service and view snapshots", () => {
    const response = decodeResponseEnvelope(
      JSON.stringify({
        version: 1,
        request_id: "request-1",
        revision: "0",
        status: "success",
        snapshot: {
          profile_id: "default",
          revision: "0",
          storage: { roots: [], show_add_options: true, show_file_selection: true },
          torrents: [],
        },
      }),
    );
    expect(response.status).toBe("success");
    if (response.status === "success") {
      expect(response.snapshot.client_settings).toEqual({
        listener: { type: "automatic_local_network" },
        preferred_listen_port: 6_881,
        port_mapping: "upnp",
        peer_connection_limit: 200,
        upload_slots: 8,
        active_downloads: 3,
        active_seeds: { type: "limited", torrents: 5 },
        share_ratio_limit_percent: 200,
        finished_download_ratio_limit_percent: 700,
        finished_time_limit_seconds: 86_400,
        seed_stop_ratio_percent: { type: "off" },
        seed_stop_time_seconds: { type: "off" },
        upload_rate_limit: { type: "unlimited" },
        download_rate_limit: { type: "unlimited" },
        encryption: "allow",
        ipv6_enabled: true,
        dht_enabled: true,
        peer_exchange_enabled: true,
        tracker_https_server_authentication: "system_trust",
      });
    }

    const batch = torrentBatch("Defaulted");
    const snapshot = batch.updates[0]!.snapshot as unknown as Record<
      string,
      unknown
    >;
    delete snapshot.client_settings;
    const decoded = decodeUpdateBatch(JSON.stringify(batch));
    const update = decoded.updates[0]!;
    expect(update.type).toBe("snapshot");
    if (update.type === "snapshot" && update.snapshot.type === "torrent_list") {
      expect(update.snapshot.client_settings).toEqual(
        DEFAULT_CLIENT_SETTINGS_RUNTIME_VIEW,
      );
    }
  });

  it("rejects additional, malformed, and inconsistent runtime settings", () => {
    const additional = torrentBatch("Additional");
    const additionalSettings = additional.updates[0]!.snapshot
      .client_settings.configured as unknown as Record<string, unknown>;
    additionalSettings.invented = true;
    expect(() => decodeUpdateBatch(JSON.stringify(additional))).toThrow(
      ContractError,
    );

    const fractional = torrentBatch("Fractional");
    fractional.updates[0]!.snapshot.client_settings.configured.upload_slots = 1.5;
    expect(() => decodeUpdateBatch(JSON.stringify(fractional))).toThrow(
      ContractError,
    );

    const oversizedSeeds = torrentBatch("Oversized seeds");
    oversizedSeeds.updates[0]!.snapshot.client_settings.configured.active_seeds = {
      type: "limited",
      torrents: 501,
    };
    expect(() => decodeUpdateBatch(JSON.stringify(oversizedSeeds))).toThrow(
      ContractError,
    );

    const excessActiveSeeds = torrentBatch("Excess active seeds");
    excessActiveSeeds.updates[0]!.snapshot.client_settings.effective_active_seeds = {
      type: "limited",
      torrents: 1,
    };
    excessActiveSeeds.updates[0]!.snapshot.client_settings.active_seed_count = 2;
    expect(() => decodeUpdateBatch(JSON.stringify(excessActiveSeeds))).toThrow(
      /active seed count exceeds/,
    );

    const inconsistent = torrentBatch("Inconsistent");
    inconsistent.updates[0]!.snapshot.client_settings.listener_status = {
      type: "listening",
      address: "127.0.0.1",
      port: 6_881,
    };
    expect(() => decodeUpdateBatch(JSON.stringify(inconsistent))).toThrow(
      /disabled listener reports a listening status/,
    );

    const wildcardUdp = torrentBatch("Wildcard UDP");
    wildcardUdp.updates[0]!.snapshot.client_settings = {
      ...clientSettingsRuntimeFixture(),
      effective_listener: {
        listener: { type: "automatic_local_network" },
        preferred_listen_port: 6_881,
      },
      configured: {
        ...clientSettingsRuntimeFixture().configured,
        listener: { type: "automatic_local_network" },
      },
      listener_status: {
        type: "listening",
        address: "192.168.1.104",
        port: 6_881,
      },
      session_udp_status: {
        type: "bound",
        address: "0.0.0.0",
        port: 6_881,
        coordinated_with_tcp: true,
      },
    };
    expect(decodeUpdateBatch(JSON.stringify(wildcardUdp)).updates).toHaveLength(1);

    const mismatchedUdp = torrentBatch("Mismatched UDP");
    mismatchedUdp.updates[0]!.snapshot.client_settings = {
      ...clientSettingsRuntimeFixture(),
      effective_listener: {
        listener: { type: "automatic_loopback" },
        preferred_listen_port: 6_881,
      },
      configured: {
        ...clientSettingsRuntimeFixture().configured,
        listener: { type: "automatic_loopback" },
      },
      listener_status: {
        type: "listening",
        address: "127.0.0.1",
        port: 6_881,
      },
      session_udp_status: {
        type: "bound",
        address: "127.0.0.1",
        port: 6_882,
        coordinated_with_tcp: true,
      },
    };
    expect(() => decodeUpdateBatch(JSON.stringify(mismatchedUdp))).toThrow(
      /coordinated session UDP port differs/,
    );

    const uncertainCleanup = torrentBatch("Uncertain cleanup");
    uncertainCleanup.updates[0]!.snapshot.client_settings = {
      ...clientSettingsRuntimeFixture(),
      effective_port_mapping: "upnp",
      port_mapping_status: {
        type: "cleanup_failed",
        external_address: "203.0.113.10",
        external_port: 48_001,
        remaining_lease_seconds: 42,
        detail: "delete verification failed",
      },
      ipv6_pinhole_status: { type: "ineligible" },
      port_mapping_application: {
        type: "degraded",
        reason: "port_mapping_cleanup_failed",
        detail: "delete verification failed",
      },
    };
    expect(decodeUpdateBatch(JSON.stringify(uncertainCleanup)).updates).toHaveLength(1);
    const invalidCleanupStatus = uncertainCleanup.updates[0]!.snapshot.client_settings
      .port_mapping_status as unknown as Record<string, unknown>;
    invalidCleanupStatus.remaining_lease_seconds = -1;
    expect(() => decodeUpdateBatch(JSON.stringify(uncertainCleanup))).toThrow(
      /remaining_lease_seconds must be >= 0/,
    );

    const pinholed = torrentBatch("IPv6 pinhole");
    pinholed.updates[0]!.snapshot.client_settings = {
      ...clientSettingsRuntimeFixture(),
      effective_port_mapping: "upnp",
      port_mapping_status: { type: "ineligible" },
      ipv6_pinhole_status: {
        type: "pinholed",
        internal_address: "2001:4860:4860::8888",
        internal_port: 42_006,
        lease_seconds: 3_600,
      },
      port_mapping_application: { type: "applied" },
    };
    expect(decodeUpdateBatch(JSON.stringify(pinholed)).updates).toHaveLength(1);
    const invalidPinhole = pinholed.updates[0]!.snapshot.client_settings
      .ipv6_pinhole_status as unknown as Record<string, unknown>;
    invalidPinhole.lease_seconds = 86_401;
    expect(() => decodeUpdateBatch(JSON.stringify(pinholed))).toThrow(
      /IPv6 pinhole lease must be an integer in range/,
    );

    const optionalServiceAbsent = torrentBatch("Optional service absent");
    optionalServiceAbsent.updates[0]!.snapshot.client_settings = {
      ...clientSettingsRuntimeFixture(),
      effective_port_mapping: "upnp",
      port_mapping_status: { type: "ineligible" },
      ipv6_pinhole_status: { type: "service_unavailable" },
      port_mapping_application: { type: "applied" },
    };
    expect(
      decodeUpdateBatch(JSON.stringify(optionalServiceAbsent)).updates,
    ).toHaveLength(1);
  });
});

describe("torrent ETA validation", () => {
  it("accepts exact typed state and rejects missing or inconsistent work", () => {
    expect(decodeUpdateBatch(JSON.stringify(torrentBatch("Valid ETA"))).updates).toHaveLength(1);

    const missing = torrentBatch("Missing ETA work");
    const missingTorrent = missing.updates[0]!.snapshot.torrents[0]! as Record<
      string,
      unknown
    >;
    delete missingTorrent.required_payload_bytes;
    expect(() => decodeUpdateBatch(JSON.stringify(missing))).toThrow(
      /required_payload_bytes/,
    );

    const overrun = torrentBatch("Overrun ETA work");
    overrun.updates[0]!.snapshot.torrents[0]!.remaining_payload_bytes = "65537";
    expect(() => decodeUpdateBatch(JSON.stringify(overrun))).toThrow(
      /remaining payload exceeds required payload/,
    );

    const stalledRate = torrentBatch("Invalid stalled rate");
    const stalledTorrent = stalledRate.updates[0]!.snapshot
      .torrents[0]! as Record<string, unknown>;
    stalledTorrent.eta = { state: "stalled" };
    expect(() => decodeUpdateBatch(JSON.stringify(stalledRate))).toThrow(
      /non-estimated torrent ETA must expose a zero rate/,
    );

    const missingSeconds = torrentBatch("Missing ETA seconds");
    const missingSecondsTorrent = missingSeconds.updates[0]!.snapshot
      .torrents[0]! as Record<string, unknown>;
    missingSecondsTorrent.eta = { state: "estimate" };
    expect(() => decodeUpdateBatch(JSON.stringify(missingSeconds))).toThrow(
      /seconds/,
    );
  });

  it("accepts typed sparse fields and rejects duplicate row or field meaning", () => {
    const sparse = torrentBatch("Sparse") as unknown as Record<string, unknown>;
    const initial = (sparse.updates as Array<Record<string, unknown>>)[0]!;
    const torrent = (
      (initial.snapshot as Record<string, unknown>).torrents as Array<TorrentView>
    )[0]!;
    sparse.updates = [{
      type: "patch",
      view_id: "library",
      patch: {
        type: "torrent_list",
        upsert: [],
        updates: [{
          torrent_id: torrent.torrent_id,
          fields: [{ field: "display_name" as const, value: null }],
        }],
        removed: [],
      },
    }];
    expect(decodeUpdateBatch(JSON.stringify(sparse)).updates).toHaveLength(1);

    const sparsePatch = (sparse.updates as Array<Record<string, unknown>>)[0]!
      .patch as Record<string, unknown>;
    const sparseRow = (sparsePatch.updates as Array<Record<string, unknown>>)[0]!;
    (sparseRow.fields as Array<Record<string, unknown>>).push({
      field: "display_name",
      value: "duplicate",
    });
    expect(() => decodeUpdateBatch(JSON.stringify(sparse))).toThrow(
      /repeats field display_name/,
    );

    const duplicateRow = torrentBatch("Duplicate row") as unknown as Record<string, unknown>;
    const update = (duplicateRow.updates as Array<Record<string, unknown>>)[0]!;
    update.type = "patch";
    delete update.snapshot;
    update.patch = {
      type: "torrent_list",
      upsert: [torrent],
      updates: [{
        torrent_id: torrent.torrent_id,
        fields: [{ field: "display_name", value: "also updated" }],
      }],
      removed: [],
    };
    expect(() => decodeUpdateBatch(JSON.stringify(duplicateRow))).toThrow(
      /repeats a row operation/,
    );
  });
});

describe("peer view validation", () => {
  it("accepts bounded active peers and rejects cross-torrent rows", () => {
    const batch = peerBatch(TEST_TORRENT_ID);
    expect(decodeUpdateBatch(JSON.stringify(batch)).updates).toHaveLength(1);
    batch.updates[0]!.snapshot.peers[0]!.torrent_id = OTHER_TORRENT_ID;
    expect(() => decodeUpdateBatch(JSON.stringify(batch))).toThrow(
      /another torrent/,
    );
  });

  it("accepts typed flags and rejects duplicate flag state", () => {
    const batch = peerBatch(TEST_TORRENT_ID);
    batch.updates[0]!.snapshot.peers[0]!.peer_flags = [
      "incoming",
      "extension_protocol",
      "utp",
    ];
    expect(decodeUpdateBatch(JSON.stringify(batch)).updates).toHaveLength(1);
    batch.updates[0]!.snapshot.peers[0]!.peer_flags = ["incoming", "incoming"];
    expect(() => decodeUpdateBatch(JSON.stringify(batch))).toThrow(
      /flags contain duplicates/,
    );
    batch.updates[0]!.snapshot.peers[0]!.peer_flags = Array(17).fill(
      "incoming",
    );
    expect(() => decodeUpdateBatch(JSON.stringify(batch))).toThrow(
      /flags exceed their bound/,
    );
    batch.updates[0]!.snapshot.peers[0]!.peer_flags = ["invented"];
    expect(() => decodeUpdateBatch(JSON.stringify(batch))).toThrow(
      ContractError,
    );
  });

  it("accepts known MSE methods and rejects invented methods", () => {
    const batch = peerBatch(TEST_TORRENT_ID);
    batch.updates[0]!.snapshot.peers[0]!.mse_method = "rc4";
    expect(decodeUpdateBatch(JSON.stringify(batch)).updates).toHaveLength(1);
    batch.updates[0]!.snapshot.peers[0]!.mse_method = "invented";
    expect(() => decodeUpdateBatch(JSON.stringify(batch))).toThrow(
      ContractError,
    );
  });
});

describe("swarm view validation", () => {
  it("accepts coherent bounded registry state and rejects oversized or inconsistent counts", () => {
    const batch = swarmBatch();
    expect(decodeUpdateBatch(JSON.stringify(batch)).updates).toHaveLength(1);
    batch.updates[0]!.snapshot.maximum_records = 1_001;
    expect(() => decodeUpdateBatch(JSON.stringify(batch))).toThrow(
      /record maximum must be an integer in range/,
    );
    const inconsistent = swarmBatch();
    inconsistent.updates[0]!.snapshot.counts.connected = 1;
    expect(() => decodeUpdateBatch(JSON.stringify(inconsistent))).toThrow(
      /counts are inconsistent/,
    );
    const malformed = swarmBatch();
    malformed.updates[0]!.snapshot.peers[0]!.payload_downloaded_bytes = "rounded";
    expect(() => decodeUpdateBatch(JSON.stringify(malformed))).toThrow(
      /downloaded payload must be a bounded canonical decimal/,
    );
  });
});

describe("torrent display-name validation", () => {
  it("bounds verified and provisional source names independently", () => {
    const batch = torrentBatch("Verified torrent");
    const torrent = batch.updates[0]!.snapshot.torrents[0]! as TorrentView;
    torrent.source_display_name = "Magnet torrent";
    expect(decodeUpdateBatch(JSON.stringify(batch)).updates).toHaveLength(1);
    batch.updates[0]!.snapshot.torrents[0]!.display_name = "x".repeat(256);
    expect(() => decodeUpdateBatch(JSON.stringify(batch))).toThrow(
      /display name exceeds 255 bytes/,
    );

    const sourceBatch = torrentBatch("Verified torrent");
    const sourceTorrent = sourceBatch.updates[0]!.snapshot
      .torrents[0]! as TorrentView;
    sourceTorrent.source_display_name = "x".repeat(256);
    expect(() => decodeUpdateBatch(JSON.stringify(sourceBatch))).toThrow(
      /source display name exceeds 255 bytes/,
    );
  });
});

describe("torrent identity validation", () => {
  it("keeps opaque owners separate from explicit full protocol hashes", () => {
    const batch = torrentBatch("Verified torrent");
    const torrent = batch.updates[0]!.snapshot.torrents[0]! as TorrentView;
    expect(decodeUpdateBatch(JSON.stringify(batch)).updates).toHaveLength(1);

    torrent.protocol_identities = { v2: "2".repeat(64) };
    expect(decodeUpdateBatch(JSON.stringify(batch)).updates).toHaveLength(1);

    torrent.torrent_id = "0".repeat(40);
    expect(() => decodeUpdateBatch(JSON.stringify(batch))).toThrow(
      /must match pattern|torrent ID is invalid/,
    );
    torrent.torrent_id = TEST_TORRENT_ID;

    torrent.protocol_identities = {};
    expect(() => decodeUpdateBatch(JSON.stringify(batch))).toThrow(
      /must NOT have fewer than 1 properties|must not be empty/,
    );
    torrent.protocol_identities = { v1: "A".repeat(40) };
    expect(() => decodeUpdateBatch(JSON.stringify(batch))).toThrow(
      /must match pattern|v1 info hash is invalid/,
    );
  });
});

describe("torrent tracker-count validation", () => {
  it("accepts the bounded summary count and rejects an oversized catalog", () => {
    const batch = torrentBatch("Verified torrent");
    expect(decodeUpdateBatch(JSON.stringify(batch)).updates).toHaveLength(1);
    batch.updates[0]!.snapshot.torrents[0]!.configured_tracker_count = 999_995;
    expect(() => decodeUpdateBatch(JSON.stringify(batch))).toThrow(
      /configured tracker count must be an integer in range/,
    );
  });
});

describe("torrent total-size validation", () => {
  it("accepts a nullable canonical decimal and rejects malformed size", () => {
    const batch = torrentBatch("Verified torrent");
    const torrent = batch.updates[0]!.snapshot.torrents[0]! as TorrentView;
    expect(decodeUpdateBatch(JSON.stringify(batch)).updates).toHaveLength(1);
    torrent.total_size_bytes = null;
    torrent.lifetime.share_ratio_hundredths = null;
    expect(decodeUpdateBatch(JSON.stringify(batch)).updates).toHaveLength(1);
    torrent.total_size_bytes = "01";
    expect(() => decodeUpdateBatch(JSON.stringify(batch))).toThrow(
      /torrent total size must be a bounded canonical decimal/,
    );
  });
});

describe("torrent seeding validation", () => {
  it("rejects invented accounting and inconsistent goal or admission state", () => {
    const mismatchedRatio = torrentBatch("Mismatched ratio");
    mismatchedRatio.updates[0]!.snapshot.torrents[0]!.lifetime.share_ratio_hundredths = "1";
    expect(() => decodeUpdateBatch(JSON.stringify(mismatchedRatio))).toThrow(
      /share ratio does not match/,
    );

    const malformedTimers = torrentBatch("Malformed timers");
    malformedTimers.updates[0]!.snapshot.torrents[0]!.lifetime.finished_seconds = "1";
    expect(() => decodeUpdateBatch(JSON.stringify(malformedTimers))).toThrow(
      /timers are not nested/,
    );

    const inconsistentGoal = torrentBatch("Inconsistent goal");
    const torrent = inconsistentGoal.updates[0]!.snapshot.torrents[0]! as TorrentView;
    torrent.state = "complete";
    torrent.operational_state = "queued";
    torrent.seeding = {
      admission: "queued",
      goal: {
        status: "met",
        share_ratio_met: false,
        finished_download_ratio_met: false,
        finished_time_met: false,
      },
    };
    expect(() => decodeUpdateBatch(JSON.stringify(inconsistentGoal))).toThrow(
      /goal status does not match/,
    );

    torrent.seeding.goal!.status = "unmet";
    torrent.operational_state = "seeding";
    expect(() => decodeUpdateBatch(JSON.stringify(inconsistentGoal))).toThrow(
      /queued seed admission is not reported as queued/,
    );
  });
});

describe("checker progress validation", () => {
  it("accepts exact work accounting and rejects inconsistent outcomes", () => {
    const batch = torrentBatch("Checking torrent");
    const torrent = batch.updates[0]!.snapshot.torrents[0]! as TorrentView;
    torrent.checking = {
      generation: "4",
      phase: "hashing",
      pieces_total: 8,
      pieces_processed: 2,
      pieces_matched: 1,
      pieces_absent: 1,
      pieces_mismatched: 0,
      bytes_hashed: "16384",
      active_hash_jobs: 1,
      queued_hash_jobs: 5,
      elapsed_millis: "1200",
      last_advance_age_millis: "300",
      oldest_active_job_age_millis: "900",
    };
    expect(decodeUpdateBatch(JSON.stringify(batch)).updates).toHaveLength(1);

    torrent.checking.pieces_mismatched = 1;
    expect(() => decodeUpdateBatch(JSON.stringify(batch))).toThrow(
      /outcome counters do not equal processed pieces/,
    );
  });
});

describe("tracker view validation", () => {
  it("requires a canonical server clock and tracker instants", () => {
    for (const clock of [undefined, "-1", "1.5", "01", "184467440737095516160"]) {
      expect(() => decodeUpdateBatch(JSON.stringify({ ...trackerBatch(), server_now_millis: clock }))).toThrow(ContractError);
    }
    const batch = trackerBatch();
    batch.updates[0]!.snapshot.trackers[0]!.next_action_at_millis = "-1";
    expect(() => decodeUpdateBatch(JSON.stringify(batch))).toThrow(ContractError);
  });
  it("accepts bounded state and rejects an oversized retained error", () => {
    const batch = trackerBatch();
    expect(decodeUpdateBatch(JSON.stringify(batch)).updates).toHaveLength(1);
    batch.updates[0]!.snapshot.trackers[0]!.last_error = "x".repeat(257);
    expect(() => decodeUpdateBatch(JSON.stringify(batch))).toThrow(
      /last error exceeds 256 bytes/,
    );
  });
});

describe("disk view validation", () => {
  it("accepts bounded pipeline state and rejects impossible piece accounting", () => {
    const batch = diskBatch();
    expect(decodeUpdateBatch(JSON.stringify(batch)).updates).toHaveLength(1);
    batch.updates[0]!.snapshot.pieces[0]!.stored_bytes = "262145";
    expect(() => decodeUpdateBatch(JSON.stringify(batch))).toThrow(
      /stored_bytes exceeds the piece length/,
    );
  });
});

describe("DHT view validation", () => {
  it("accepts exact bounded state and rejects reordered or inconsistent buckets", () => {
    const batch = dhtBatch();
    expect(decodeUpdateBatch(JSON.stringify(batch)).updates).toHaveLength(1);
    batch.updates[0]!.snapshot.inspection.families[0]!.buckets[159]!.bucket_index = 158;
    expect(() => decodeUpdateBatch(JSON.stringify(batch))).toThrow(
      /exact engine index order/,
    );

    const inconsistent = dhtBatch();
    inconsistent.updates[0]!.snapshot.inspection.families[0]!.routing_nodes = 2;
    expect(() => decodeUpdateBatch(JSON.stringify(inconsistent))).toThrow(
      /aggregates do not match/,
    );
  });
});

describe("speed view validation", () => {
  it("accepts exact range geometry and rejects mismatched or duplicated state", () => {
    const batch = speedBatch();
    expect(decodeUpdateBatch(JSON.stringify(batch)).updates).toHaveLength(2);

    const mismatched = speedBatch();
    const history = mismatched.updates[1]?.snapshot;
    if (history?.type !== "session_speed_history") throw new Error("missing history");
    history.history.bucket_millis = "500";
    expect(() => decodeUpdateBatch(JSON.stringify(mismatched))).toThrow(
      /geometry does not match/,
    );

    const duplicated = speedBatch();
    const rates = duplicated.updates[0]?.snapshot;
    if (rates?.type !== "session_current_rates") throw new Error("missing rates");
    rates.rates.rates.push({
      metric: "payload_received",
      bytes: "20",
    });
    expect(() => decodeUpdateBatch(JSON.stringify(duplicated))).toThrow(
      /metrics are duplicated/,
    );
  });
});

describe("piece activity validation", () => {
  it("decodes removal snapshots and clears verified pieces and active attempts", () => {
    const initial = pieceBatch();
    const state = reduceUpdateBatch(undefined, decodeUpdateBatch(JSON.stringify(initial)));
    const removed = {
      ...initial,
      base_cursor: "1",
      cursor: "2",
      durable_revision: "2",
      updates: [{
        type: "snapshot",
        view_id: "pieces",
        snapshot: {
          type: "piece_activity",
          torrent_id: TEST_TORRENT_ID,
          piece_count: 0,
          verified: [],
          active: [],
        },
      }],
    };
    const next = reduceUpdateBatch(state, decodeUpdateBatch(JSON.stringify(removed)));
    expect(next.views.pieces).toEqual(removed.updates[0]!.snapshot);
    // The old invalid removal patch must continue to be rejected.
    const invalid = {
      ...removed,
      updates: [{ type: "patch", view_id: "pieces", patch: {
        type: "piece_activity", torrent_id: TEST_TORRENT_ID, piece_count: 0,
        verified: [], cleared: [{ start: 2, end_exclusive: 3 }],
        active_upsert: [], active_updates: [], active_removed: ["0:1"],
      }}],
    };
    expect(() => decodeUpdateBatch(JSON.stringify(invalid))).toThrow(
      "cleared pieces are not canonical and bounded",
    );
  });

  it("accepts keyed attempts and rejects overlapping lifecycle ranges", () => {
    const batch = pieceBatch();
    expect(decodeUpdateBatch(JSON.stringify(batch)).updates).toHaveLength(1);
    batch.updates[0]!.snapshot.active[0]!.received = [
      { start: 8_192, end_exclusive: 24_576 },
    ];
    expect(() => decodeUpdateBatch(JSON.stringify(batch))).toThrow(
      /lifecycle ranges overlap/,
    );
  });
});

describe("torrent preparation validation", () => {
  it("accepts compact block state and rejects inconsistent or reserved geometry", () => {
    const batch = preparationBatch();
    expect(decodeUpdateBatch(JSON.stringify(batch)).updates).toHaveLength(1);

    const inconsistentBytes = preparationBatch();
    inconsistentBytes.updates[0]!.snapshot.preparation.metadata.received_bytes =
      "16385";
    expect(() => decodeUpdateBatch(JSON.stringify(inconsistentBytes))).toThrow(
      /byte count disagrees/,
    );

    const reservedState = preparationBatch();
    reservedState.updates[0]!.snapshot.preparation.metadata.block_states = "Fw==";
    expect(() => decodeUpdateBatch(JSON.stringify(reservedState))).toThrow(
      /reserved value/,
    );

    const dirtyPadding = preparationBatch();
    dirtyPadding.updates[0]!.snapshot.preparation.metadata.block_states = "Vg==";
    expect(() => decodeUpdateBatch(JSON.stringify(dirtyPadding))).toThrow(
      /padding is not zero/,
    );
  });
});

describe("diagnostic validation", () => {
  it("accepts structured records and rejects invalid hierarchy and typed values", () => {
    const batch = diagnosticBatch();
    expect(decodeUpdateBatch(JSON.stringify(batch)).updates).toHaveLength(1);
    batch.updates[0]!.snapshot.events[0]!.category = "Peer.Connection";
    expect(() => decodeUpdateBatch(JSON.stringify(batch))).toThrow(ContractError);

    const invalidValue = diagnosticBatch();
    invalidValue.updates[0]!.snapshot.events[0]!.fields[0]!.value.value = "12ms";
    expect(() => decodeUpdateBatch(JSON.stringify(invalidValue))).toThrow(
      ContractError,
    );
  });
});

function preparationBatch() {
  return {
    api_version: 1,
    server_now_millis: "0",
    view_set_id: "vs_000102030405060708090a0b0c0d0e0f",
    epoch: "1",
    base_cursor: "0",
    cursor: "1",
    durable_revision: "1",
    updates: [{
      type: "snapshot" as const,
      view_id: "torrent-preparation",
      snapshot: {
        type: "torrent_preparation" as const,
        torrent_id: TEST_TORRENT_ID,
        preparation: {
          generation: "3",
          metadata: {
            phase: "downloading" as const,
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
    }],
  };
}

function diagnosticBatch() {
  return {
    api_version: 1,
    server_now_millis: "0",
    view_set_id: "vs_000102030405060708090a0b0c0d0e0f",
    epoch: "1",
    base_cursor: "0",
    cursor: "1",
    durable_revision: "1",
    updates: [
      {
        type: "snapshot" as const,
        view_id: "logs",
        snapshot: {
          type: "diagnostics" as const,
          events: [
            {
              sequence: "1",
              timestamp_millis: "1",
              severity: "debug",
              category: "peer.connection",
              code: "handshake_completed",
              torrent_id: TEST_TORRENT_ID,
              message: "Peer extension handshake completed",
              subjects: [
                { type: "peer_connection", connection_id: "connection-1" },
              ],
              fields: [
                {
                  key: "elapsed",
                  value: { type: "duration_millis", value: "12" },
                },
              ],
            },
          ],
          retention: {
            source_evicted_count: "0",
            retained_from_sequence: "1",
          },
        },
      },
    ],
  };
}

function speedBatch() {
  return {
    api_version: 1,
    server_now_millis: "0",
    view_set_id: "vs_000102030405060708090a0b0c0d0e0f",
    epoch: "1",
    base_cursor: "0",
    cursor: "1",
    durable_revision: "1",
    updates: [
      {
        type: "snapshot" as const,
        view_id: "rates",
        snapshot: {
          type: "session_current_rates" as const,
          rates: {
            captured_millis: "30000",
            rates: [{ metric: "payload_received" as const, bytes: "10" }],
          },
        },
      },
      {
        type: "snapshot" as const,
        view_id: "speed",
        snapshot: {
          type: "session_speed_history" as const,
          history: {
            captured_millis: "30000",
            history_epoch: "history-1",
            range: "seconds30" as const,
            bucket_millis: "100",
            start_millis: "0",
            complete_through_millis: "29900",
            live: true,
            persistence: "healthy" as const,
            series: [{
              metric: "payload_received" as const,
              values: Array.from({ length: 300 }, () => "0" as string | null),
            }],
            catalog: [{ metric: "payload_received" as const, available: true }],
          },
        },
      },
    ],
  };
}

function dhtBatch() {
  const buckets = Array.from({ length: 160 }, (_, bucket_index) => ({
    bucket_index,
    good_nodes: 0,
    questionable_nodes: 0,
    replacement_candidates: 0,
    oldest_live_response_age_millis: null as string | null,
  }));
  buckets[159] = {
    bucket_index: 159,
    good_nodes: 1,
    questionable_nodes: 0,
    replacement_candidates: 2,
    oldest_live_response_age_millis: "12000",
  };
  return {
    api_version: 1,
    server_now_millis: "0",
    view_set_id: "vs_000102030405060708090a0b0c0d0e0f",
    epoch: "1",
    base_cursor: "0",
    cursor: "1",
    durable_revision: "1",
    updates: [{
      type: "snapshot" as const,
      view_id: "dht",
      snapshot: {
        type: "session_dht" as const,
        inspection: {
          lifecycle: "participating" as const,
          network_policy: "loopback_only" as const,
          captured_millis: "1000",
          active_transactions: 1,
          active_lookups: 1,
          queries_sent: "1",
          responses_received: "1",
          queries_received: "0",
          malformed_received: "0",
          family_mismatched: "0",
          rate_limited: "0",
          discovered_peers: "0",
          bootstrap_attempts: "1",
          routing_refreshes: "0",
          datagram_bytes_sent: "42",
          datagram_bytes_received: "84",
          announces_sent: "0",
          announces_succeeded: "0",
          announces_failed: "0",
          families: [{
            family: "ipv4" as const,
            lifecycle: "participating" as const,
            local_node_id: "0".repeat(40),
            local_address: "127.0.0.1:6881",
            observed_external_address: null,
            routing_nodes: 1,
            occupied_buckets: 1,
            deepest_shared_prefix_bits: 0,
            active_transactions: 1,
            active_lookups: 1,
            queries_sent: "1",
            responses_received: "1",
            queries_received: "0",
            malformed_received: "0",
            family_mismatched: "0",
            rate_limited: "0",
            discovered_peers: "0",
            bootstrap_attempts: "1",
            routing_refreshes: "0",
            datagram_bytes_sent: "42",
            datagram_bytes_received: "84",
            announces_sent: "0",
            announces_succeeded: "0",
            announces_failed: "0",
            buckets,
          }],
          lookups: [{
            family: "ipv4" as const,
            lookup_id: "1",
            target_id: "1".repeat(40),
            age_millis: "500",
            deadline_in_millis: "29500",
            unqueried_candidates: 8,
            in_flight_candidates: 3,
            responded_candidates: 2,
            failed_candidates: 1,
            discovered_peers: 0,
            closest_responded_prefix_bits: 7,
            last_convergence_improvement_age_millis: "100",
          }],
        },
      },
    }],
  };
}

function pieceBatch() {
  return {
    api_version: 1,
    server_now_millis: "0",
    view_set_id: "vs_000102030405060708090a0b0c0d0e0f",
    epoch: "1",
    base_cursor: "0",
    cursor: "1",
    durable_revision: "1",
    updates: [
      {
        type: "snapshot" as const,
        view_id: "pieces",
        snapshot: {
          type: "piece_activity" as const,
          torrent_id: TEST_TORRENT_ID,
          piece_count: 4,
          verified: [{ start: 2, end_exclusive: 3 }],
          active: [
            {
              piece_id: "0:1",
              piece_index: 0,
              attempt: 1,
              piece_length: 262_144,
              stage: "requested",
              requested: [{ start: 0, end_exclusive: 16_384 }],
              received: [] as Array<{ start: number; end_exclusive: number }>,
              stored: [],
              age_millis: "10",
            },
          ],
        },
      },
    ],
  };
}

function diskBatch() {
  const zeroFields = {
    sample_millis: "0",
    resident_limit_bytes: "1048576",
    resident_high_watermark_bytes: "786432",
    resident_low_watermark_bytes: "524288",
    requested_bytes: "16384",
    resident_bytes: "16384",
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
    received_bytes_total: "16384",
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
  };
  return {
    api_version: 1,
    server_now_millis: "0",
    view_set_id: "vs_000102030405060708090a0b0c0d0e0f",
    epoch: "1",
    base_cursor: "0",
    cursor: "1",
    durable_revision: "1",
    updates: [
      {
        type: "snapshot" as const,
        view_id: "disk",
        snapshot: {
          type: "session_disk" as const,
          pipeline: {
            pressure: "normal",
            checkpoint_stage: "idle",
            intake_backpressured: false,
            ...zeroFields,
          },
          pieces: [
            {
              row_id: `${TEST_TORRENT_ID}:0:1`,
              torrent_id: TEST_TORRENT_ID,
              torrent_name: "Test torrent",
              piece_index: 0,
              piece_length: 262144,
              attempt: 1,
              stage: "receiving",
              requested_bytes: "16384",
              received_bytes: "16384",
              stored_bytes: "0",
              stage_age_millis: "1",
              age_millis: "1",
            },
          ],
        },
      },
    ],
  };
}

function trackerBatch() {
  return {
    api_version: 1,
    server_now_millis: "0",
    view_set_id: "vs_000102030405060708090a0b0c0d0e0f",
    epoch: "1",
    base_cursor: "0",
    cursor: "1",
    durable_revision: "1",
    updates: [
      {
        type: "snapshot" as const,
        view_id: "torrent-trackers",
        snapshot: {
          type: "trackers" as const,
          torrent_id: TEST_TORRENT_ID,
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
              total_attempts: 1,
              consecutive_failures: 1,
              last_connection_family: null,
              last_peer_count: null,
              seeders: null,
              leechers: null,
              interval_seconds: null,
              next_action: "retry",
              next_action_at_millis: "17000",
              last_success_at_millis: null,
              last_failure_at_millis: "100",
              last_error: "timeout",
            },
          ],
        },
      },
    ],
  };
}

function torrentBatch(displayName: string) {
  return {
    api_version: 1,
    server_now_millis: "0",
    view_set_id: "vs_000102030405060708090a0b0c0d0e0f",
    epoch: "1",
    base_cursor: "0",
    cursor: "1",
    durable_revision: "1",
    updates: [
      {
        type: "snapshot" as const,
        view_id: "library",
        snapshot: {
          type: "torrent_list" as const,
          storage: { roots: [], show_add_options: true, show_file_selection: true },
          client_settings: clientSettingsRuntimeFixture(),
          torrents: [
            {
              torrent_id: TEST_TORRENT_ID,
              protocol_identities: { v1: "0".repeat(40) },
              display_name: displayName,
              state: "downloading",
              operational_state: "downloading",
              transfer_limits: {
                upload: { type: "unlimited" as const },
                download: { type: "unlimited" as const },
              },
              storage_state: "available",
              storage_root: "downloads",
              metadata_available: true,
              awaiting_file_selection: false,
              selectable_file_count: 1,
              selected_file_count: 1,
              selectable_file_bytes: "65536",
              selected_file_bytes: "65536",
              piece_count: 1,
              total_size_bytes: "65536",
              verified_piece_count: 0,
              requested_bytes: "0",
              received_bytes: "0",
              stored_bytes: "0",
              active_peer_connections: 0,
              configured_tracker_count: 2,
              payload_download_rate_bytes: "0",
              required_payload_bytes: "65536",
              remaining_payload_bytes: "65536",
              eta_payload_download_rate_bytes: "4096",
              eta: { state: "estimate" as const, seconds: "16" },
              lifetime: {
                uploaded_payload_bytes: "0",
                downloaded_payload_bytes: "0",
                active_seconds: "0",
                finished_seconds: "0",
                seeding_seconds: "0",
                share_ratio_hundredths: "0",
              },
              seeding: { admission: "ineligible" as const },
              progress: {
                disposition: "active",
                phase: "transfer",
                reason: "transferring_pieces",
                actions: [],
              },
              archived: false,
              delete_data_supported: true,
              force_recheck_available: true,
            },
          ],
        },
      },
    ],
  };
}

function peerBatch(torrentId: string) {
  return {
    api_version: 1,
    server_now_millis: "0",
    view_set_id: "vs_000102030405060708090a0b0c0d0e0f",
    epoch: "1",
    base_cursor: "0",
    cursor: "1",
    durable_revision: "1",
    updates: [
      {
        type: "snapshot" as const,
        view_id: "torrent-peers",
        snapshot: {
          type: "peers" as const,
          torrent_id: torrentId,
          peers: [
            {
              connection_id: "1",
              torrent_id: torrentId,
              peer_record_id: "2",
              direction: "outgoing",
              transport: "tcp",
              lifecycle: "protocol_handshaking",
              role: "metadata",
              peer_flags: undefined as string[] | undefined,
              mse_method: undefined as string | undefined,
              lifecycle_age_millis: "5",
              remote_endpoint: "127.0.0.1:6881",
              local_endpoint: null,
              sources: ["magnet_hint"],
              peer_id: null,
              client_name: null,
              supports_extensions: null,
              supports_ut_metadata: null,
              local_interested: null,
              remote_interested: null,
              remote_choking: null,
              local_choking: null,
              available_piece_count: null,
              wanted_piece_count: null,
              payload_download_rate_bytes: null,
              payload_downloaded_bytes: null,
              protocol_download_rate_bytes: null,
              protocol_downloaded_bytes: null,
              payload_upload_rate_bytes: null,
              payload_uploaded_bytes: null,
              pending_requests: null,
              target_requests: null,
              queued_payload_bytes: null,
              oldest_request_age_millis: null,
              request_timeout_millis: null,
              request_phase: null,
              connected_age_millis: null,
              last_useful_age_millis: null,
              last_payload_age_millis: null,
              disconnect_reason: null,
              capabilities: {
                local_endpoint: "unsupported",
                client_name: "unsupported",
                ut_metadata: "unavailable",
                interest_directions: "unavailable",
                local_choke: "unsupported",
                piece_availability: "unavailable",
                protocol_rates: "unsupported",
                upload: "unsupported",
                metadata_stage: "unavailable",
              },
            },
          ],
        },
      },
    ],
  };
}

function swarmBatch() {
  return {
    api_version: 1,
    server_now_millis: "0",
    view_set_id: "vs_000102030405060708090a0b0c0d0e0f",
    epoch: "1",
    base_cursor: "0",
    cursor: "1",
    durable_revision: "1",
    updates: [
      {
        type: "snapshot" as const,
        view_id: "torrent-swarm",
        snapshot: {
          type: "swarm" as const,
          torrent_id: TEST_TORRENT_ID,
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
          peers: [
            {
              peer_record_id: "1",
              torrent_id: TEST_TORRENT_ID,
              endpoint: "127.0.0.1:6881",
              sources: ["tracker" as const],
              state: "eligible" as const,
              connectable: true,
              first_observed_age_millis: "5000",
              last_observed_age_millis: "100",
              retry_in_millis: null,
              dial_attempts: 1,
              consecutive_failures: 0,
              total_failures: 0,
              last_dial_age_millis: "1000",
              last_connected_age_millis: null,
              last_failure: null,
              last_failure_age_millis: null,
              payload_downloaded_bytes: "9007199254740993",
              payload_uploaded_bytes: "4503599627370497",
              trust_points: 0,
              hash_failures: 0,
              valid_pieces: 0,
              on_parole: false,
            },
          ],
        },
      },
    ],
  };
}
