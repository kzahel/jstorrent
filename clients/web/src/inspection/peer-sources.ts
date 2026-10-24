import type {
  ClientSettingsRuntimeView,
  DhtInspectionView,
  PeerSourceView,
} from "../api";
import type { SwarmSet, TorrentRow, TrackerRow } from "./model";

export type PeerSourceKind =
  | "tracker"
  | "dht"
  | "peer_exchange"
  | "incoming"
  | "local_discovery";

export type PeerSourceStatus =
  | { readonly type: "unknown" }
  | { readonly type: "none" }
  | { readonly type: "off" }
  | { readonly type: "offline" }
  | { readonly type: "starting" }
  | { readonly type: "idle" }
  | { readonly type: "on" }
  | { readonly type: "listening"; readonly port: number }
  | { readonly type: "searching"; readonly found: number }
  | { readonly type: "announcing" }
  | { readonly type: "failing" }
  | { readonly type: "working"; readonly working: number; readonly total: number };

export interface PeerSourceSummary {
  readonly kind: PeerSourceKind;
  readonly status: PeerSourceStatus;
  /** Null while the swarm view has not arrived. */
  readonly known: number | null;
  readonly connected: number | null;
}

/**
 * Summarizes the ways one torrent finds peers, trackers first. Counts come
 * from the bounded swarm view, so a peer several trackers returned counts
 * once; a record with several sources counts for each.
 */
export function peerSourceSummaries(
  torrent: Pick<TorrentRow, "protocolIdentities"> | undefined,
  /** Undefined while the tracker view has not arrived. */
  trackers: readonly TrackerRow[] | undefined,
  swarm: SwarmSet | undefined,
  dht: DhtInspectionView | null,
  settings: ClientSettingsRuntimeView,
): readonly PeerSourceSummary[] {
  const known = new Map<PeerSourceView, number>();
  const connected = new Map<PeerSourceView, number>();
  for (const id of swarm?.order ?? []) {
    const row = swarm?.rows[id];
    if (row === undefined) continue;
    for (const source of new Set(row.sources)) {
      known.set(source, (known.get(source) ?? 0) + 1);
      if (row.state === "connected") {
        connected.set(source, (connected.get(source) ?? 0) + 1);
      }
    }
  }
  const counts = (source: PeerSourceView) => ({
    known: swarm === undefined ? null : (known.get(source) ?? 0),
    connected: swarm === undefined ? null : (connected.get(source) ?? 0),
  });

  const summaries: PeerSourceSummary[] = [
    { kind: "tracker", status: trackerStatus(trackers), ...counts("tracker") },
    { kind: "dht", status: dhtStatus(torrent, dht, settings), ...counts("dht") },
    {
      kind: "peer_exchange",
      status: settings.effective_peer_exchange_enabled
        ? { type: "on" }
        : { type: "off" },
      ...counts("peer_exchange"),
    },
    { kind: "incoming", status: incomingStatus(settings), ...counts("incoming") },
  ];
  if ((known.get("local_discovery") ?? 0) > 0) {
    summaries.push({
      kind: "local_discovery",
      status: { type: "on" },
      ...counts("local_discovery"),
    });
  }
  return summaries;
}

/** Working means the last announce succeeded; an announce in flight keeps that. */
function trackerStatus(trackers: readonly TrackerRow[] | undefined): PeerSourceStatus {
  if (trackers === undefined) return { type: "unknown" };
  if (trackers.length === 0) return { type: "none" };
  const working = trackers.filter(
    (tracker) => tracker.lastSuccessAtMs !== null && tracker.error === null,
  ).length;
  if (working > 0) return { type: "working", working, total: trackers.length };
  if (trackers.some((tracker) => tracker.status === "announcing")) {
    return { type: "announcing" };
  }
  if (trackers.some((tracker) => tracker.lastFailureAtMs !== null)) {
    return { type: "failing" };
  }
  return { type: "idle" };
}

function dhtStatus(
  torrent: Pick<TorrentRow, "protocolIdentities"> | undefined,
  dht: DhtInspectionView | null,
  settings: ClientSettingsRuntimeView,
): PeerSourceStatus {
  if (!settings.effective_dht_enabled) return { type: "off" };
  if (dht === null) return { type: "on" };
  switch (dht.lifecycle) {
    case "disabled":
      return { type: "off" };
    case "offline":
      return { type: "offline" };
    case "bootstrap_empty":
      return { type: "starting" };
    case "inactive":
    case "suspended":
      return { type: "idle" };
    case "participating":
      break;
  }
  const targets = dhtTargets(torrent);
  const searches = dht.lookups.filter((lookup) =>
    targets.has(lookup.target_id.toLowerCase()),
  );
  if (searches.length === 0) return { type: "on" };
  return {
    type: "searching",
    found: searches.reduce((total, lookup) => total + lookup.discovered_peers, 0),
  };
}

/** BEP 5 searches the v1 hash; BEP 52 searches a v2 hash truncated to 20 bytes. */
export function dhtTargets(
  torrent: Pick<TorrentRow, "protocolIdentities"> | undefined,
): ReadonlySet<string> {
  const targets = new Set<string>();
  const v1 = torrent?.protocolIdentities?.v1;
  const v2 = torrent?.protocolIdentities?.v2;
  if (v1 != null) targets.add(v1.toLowerCase());
  if (v2 != null) targets.add(v2.slice(0, 40).toLowerCase());
  return targets;
}

function incomingStatus(settings: ClientSettingsRuntimeView): PeerSourceStatus {
  switch (settings.listener_status.type) {
    case "disabled":
      return { type: "off" };
    case "bind_failed":
      return { type: "offline" };
    case "listening":
      return { type: "listening", port: settings.listener_status.port };
  }
}
