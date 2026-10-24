import { describe, expect, it } from "vitest";

import {
  DEFAULT_CLIENT_SETTINGS_RUNTIME_VIEW,
  type ClientSettingsRuntimeView,
  type DhtInspectionView,
  type DhtLookupView,
  type PeerSourceView,
  type SwarmPeerState,
} from "../api";
import type { SwarmRow, SwarmSet, TrackerRow } from "./model";
import { dhtTargets, peerSourceSummaries } from "./peer-sources";

const V1 = "aa".repeat(20);
const V2 = "bb".repeat(32);

describe("peer source summaries", () => {
  it("counts known and connected peers per source, once per record", () => {
    const swarm = swarmSet([
      ["dht", "peer_exchange"],
      ["dht", "dht"],
      ["incoming"],
    ], ["connected", "eligible", "connected"]);
    const [trackers, dht, pex, incoming] = peerSourceSummaries(
      { protocolIdentities: { v1: V1 } },
      [],
      swarm,
      null,
      settings(),
    );

    expect(trackers).toMatchObject({ kind: "tracker", status: { type: "none" } });
    expect(dht).toMatchObject({ kind: "dht", known: 2, connected: 1 });
    expect(pex).toMatchObject({ kind: "peer_exchange", known: 1, connected: 1 });
    expect(incoming).toMatchObject({ kind: "incoming", known: 1, connected: 1 });
  });

  it("shows dashes before the tracker and swarm views arrive", () => {
    const [trackers, dht] = peerSourceSummaries(undefined, undefined, undefined, null, settings());
    expect(trackers).toMatchObject({ status: { type: "unknown" }, known: null });
    expect(dht).toMatchObject({ known: null, connected: null });
  });

  it("adds local network only when it supplied peers", () => {
    expect(
      peerSourceSummaries(undefined, [], swarmSet([]), null, settings()).map((source) => source.kind),
    ).toEqual(["tracker", "dht", "peer_exchange", "incoming"]);
    expect(
      peerSourceSummaries(undefined, [], swarmSet([["local_discovery"]]), null, settings()).at(-1),
    ).toMatchObject({ kind: "local_discovery", known: 1 });
  });

  it("reports a DHT search only for this torrent's v1 or truncated v2 target", () => {
    const view = dhtView([
      lookup(V1.toUpperCase(), 3),
      lookup(V2.slice(0, 40), 4),
      lookup("cc".repeat(20), 9),
    ]);

    expect(
      peerSourceSummaries({ protocolIdentities: { v1: V1 } }, [], undefined, view, settings())[1]?.status,
    ).toEqual({ type: "searching", found: 3 });
    expect(
      peerSourceSummaries({ protocolIdentities: { v2: V2 } }, [], undefined, view, settings())[1]?.status,
    ).toEqual({ type: "searching", found: 4 });
    expect(
      peerSourceSummaries(
        { protocolIdentities: { v1: "dd".repeat(20) } },
        [],
        undefined,
        view,
        settings(),
      )[1]?.status,
    ).toEqual({ type: "on" });
    expect(dhtTargets({ protocolIdentities: { v1: V1, v2: V2 } })).toEqual(
      new Set([V1, V2.slice(0, 40)]),
    );
  });

  it("reflects disabled, starting and offline sources", () => {
    const off = settings({
      effective_dht_enabled: false,
      effective_peer_exchange_enabled: false,
      listener_status: { type: "disabled" },
    });
    expect(
      peerSourceSummaries(undefined, [], undefined, dhtView([]), off).map((source) => source.status.type),
    ).toEqual(["none", "off", "off", "off"]);

    const [, dht, , incoming] = peerSourceSummaries(
      undefined,
      [],
      undefined,
      { ...dhtView([]), lifecycle: "bootstrap_empty" },
      settings({
        listener_status: { type: "bind_failed", reason: "address_in_use", detail: "busy" },
      }),
    );
    expect(dht?.status).toEqual({ type: "starting" });
    expect(incoming?.status).toEqual({ type: "offline" });

    expect(
      peerSourceSummaries(
        undefined,
        [],
        undefined,
        null,
        settings({ listener_status: { type: "listening", address: "0.0.0.0", port: 6881 } }),
      )[3]?.status,
    ).toEqual({ type: "listening", port: 6881 });
  });
});

describe("tracker peer source", () => {
  it("counts tracker peers once across trackers that returned them", () => {
    const [trackers] = peerSourceSummaries(
      undefined,
      [tracker({ lastSuccessAtMs: 1 }), tracker({ lastSuccessAtMs: 1 })],
      swarmSet([["tracker"], ["tracker", "dht"], ["dht"]], ["connected"]),
      null,
      settings(),
    );
    expect(trackers).toMatchObject({
      kind: "tracker",
      status: { type: "working", working: 2, total: 2 },
      known: 2,
      connected: 1,
    });
  });

  it("calls a tracker working only while its last announce succeeded", () => {
    const status = (rows: readonly TrackerRow[]) =>
      peerSourceSummaries(undefined, rows, undefined, null, settings())[0]?.status;
    const failed = { lastFailureAtMs: 2, error: "timeout" };

    expect(status([
      tracker({ lastSuccessAtMs: 1 }),
      tracker({ lastSuccessAtMs: 1, ...failed }),
      tracker({ status: "announcing" }),
    ])).toEqual({ type: "working", working: 1, total: 3 });
    expect(status([tracker({ status: "announcing" }), tracker(failed)]))
      .toEqual({ type: "announcing" });
    expect(status([tracker(failed)])).toEqual({ type: "failing" });
    expect(status([tracker({ status: "inactive" })])).toEqual({ type: "idle" });
  });
});

function tracker(overrides: Partial<TrackerRow> = {}): TrackerRow {
  return {
    id: "0", torrentId: "t1", url: "udp://tracker.example:6969",
    transport: "udp", security: "unencrypted", source: "metainfo", tier: 0,
    status: "idle", announceEvent: null, totalAttempts: 0, consecutiveFailures: 0,
    lastConnectionFamily: null, lastPeerCount: null, seeders: null, leechers: null,
    intervalSeconds: null, nextAction: null, nextActionAtMs: null,
    lastSuccessAtMs: null, lastFailureAtMs: null, error: null,
    ...overrides,
  };
}

function settings(
  overrides: Partial<ClientSettingsRuntimeView> = {},
): ClientSettingsRuntimeView {
  return { ...DEFAULT_CLIENT_SETTINGS_RUNTIME_VIEW, ...overrides };
}

function swarmSet(
  sources: readonly (readonly PeerSourceView[])[],
  states: readonly SwarmPeerState[] = [],
): SwarmSet {
  const rows: Record<string, SwarmRow> = {};
  sources.forEach((recordSources, index) => {
    rows[String(index)] = {
      recordId: String(index),
      torrentId: "t1",
      endpoint: `198.51.100.${index}:6881`,
      sources: recordSources,
      state: states[index] ?? "eligible",
    } as SwarmRow;
  });
  return {
    state: "active",
    capturedMillis: 0,
    maximumRecords: 100,
    counts: {
      total: sources.length,
      eligible: 0,
      not_connectable: 0,
      dialing: 0,
      connected: 0,
      backed_off: 0,
      failure_limited: 0,
      banned: 0,
    },
    order: Object.keys(rows),
    rows,
  };
}

function dhtView(lookups: readonly DhtLookupView[]): DhtInspectionView {
  return { lifecycle: "participating", lookups } as unknown as DhtInspectionView;
}

function lookup(target: string, found: number): DhtLookupView {
  return {
    family: "ipv4",
    lookup_id: target,
    target_id: target,
    age_millis: "100",
    deadline_in_millis: "1000",
    unqueried_candidates: 0,
    in_flight_candidates: 1,
    responded_candidates: 2,
    failed_candidates: 0,
    discovered_peers: found,
    closest_responded_prefix_bits: 10,
    last_convergence_improvement_age_millis: null,
  };
}
