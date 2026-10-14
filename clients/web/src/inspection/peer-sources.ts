import type {
  ClientSettingsRuntimeView,
  DhtInspectionView,
  PeerSourceView,
} from "../api";
import type { SwarmSet, TorrentRow } from "./model";

export type PeerSourceKind =
  | "dht"
  | "peer_exchange"
  | "incoming"
  | "local_discovery";

export type PeerSourceStatus =
  | { readonly type: "off" }
  | { readonly type: "offline" }
  | { readonly type: "starting" }
  | { readonly type: "idle" }
  | { readonly type: "on" }
  | { readonly type: "listening"; readonly port: number }
  | { readonly type: "searching"; readonly found: number };

export interface PeerSourceSummary {
  readonly kind: PeerSourceKind;
  readonly status: PeerSourceStatus;
  /** Null while the swarm view has not arrived. */
  readonly known: number | null;
  readonly connected: number | null;
}

/**
 * Summarizes the non-tracker ways one torrent finds peers. Counts come from
 * the bounded swarm view; a record with several sources counts for each.
 */
export function peerSourceSummaries(
  torrent: Pick<TorrentRow, "protocolIdentities"> | undefined,
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
