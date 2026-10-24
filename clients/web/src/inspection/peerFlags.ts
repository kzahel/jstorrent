import { message as localizedMessage } from "../localization/runtime";
import type { PeerMseMethodView } from "../api";
import type { PeerFlag } from "./model";

export type PeerFlagGroup =
  | "Connection"
  | "Transfer"
  | "Protocol"
  | "Scheduler / integrity";

export interface PeerFlagDefinition {
  readonly glyph: string;
  readonly label: string;
  readonly group: PeerFlagGroup;
}

export const PEER_FLAG_ORDER = [
  "incoming",
  "encrypted",
  "download_allowed",
  "download_choked",
  "upload_allowed",
  "upload_choked",
  "extension_protocol",
  "metadata_extension",
  "utp",
  "hole_punched",
  "on_parole",
  "optimistic_unchoke",
  "snubbed",
  "upload_only",
  "endgame",
  "seed",
] as const satisfies readonly PeerFlag[];

export const PEER_FLAG_DEFINITIONS: Readonly<
  Record<PeerFlag, PeerFlagDefinition>
> = {
  incoming: {
    glyph: "I",
    label: localizedMessage("inspection.peer.flags.incoming"),
    group: "Connection",
  },
  encrypted: {
    glyph: "E",
    label: localizedMessage("inspection.peer.flags.encrypted.or.obfuscated"),
    group: "Connection",
  },
  download_allowed: {
    glyph: "D",
    label: localizedMessage("inspection.peer.flags.download.allowed"),
    group: "Transfer",
  },
  download_choked: {
    glyph: "d",
    label: localizedMessage("inspection.peer.flags.download.choked"),
    group: "Transfer",
  },
  upload_allowed: {
    glyph: "U",
    label: localizedMessage("inspection.peer.flags.upload.allowed"),
    group: "Transfer",
  },
  upload_choked: {
    glyph: "u",
    label: localizedMessage("inspection.peer.flags.upload.choked"),
    group: "Transfer",
  },
  extension_protocol: {
    glyph: "x",
    label: localizedMessage("inspection.peer.flags.extension.protocol"),
    group: "Protocol",
  },
  metadata_extension: {
    glyph: "m",
    label: localizedMessage("inspection.peer.flags.can.send.torrent.info"),
    group: "Protocol",
  },
  utp: {
    glyph: "T",
    label: localizedMessage("inspection.peer.flags.utp"),
    group: "Connection",
  },
  hole_punched: {
    glyph: "h",
    label: localizedMessage("inspection.peer.flags.hole.punched"),
    group: "Connection",
  },
  on_parole: {
    glyph: "p",
    label: localizedMessage("inspection.peer.flags.on.parole"),
    group: "Scheduler / integrity",
  },
  optimistic_unchoke: {
    glyph: "O",
    label: localizedMessage("inspection.peer.flags.optimistic.unchoke"),
    group: "Scheduler / integrity",
  },
  snubbed: {
    glyph: "S",
    label: localizedMessage("inspection.peer.flags.snubbed"),
    group: "Scheduler / integrity",
  },
  upload_only: {
    glyph: "L",
    label: localizedMessage("inspection.peer.flags.upload.only"),
    group: "Transfer",
  },
  endgame: {
    glyph: "e",
    label: localizedMessage("inspection.peer.flags.endgame"),
    group: "Scheduler / integrity",
  },
  seed: {
    glyph: "s",
    label: localizedMessage("inspection.peer.flags.seed"),
    group: "Transfer",
  },
};

export function normalizedPeerFlags(flags: readonly PeerFlag[]): PeerFlag[] {
  const present = new Set(flags);
  return PEER_FLAG_ORDER.filter((flag) => present.has(flag));
}

export function formatPeerFlags(flags: readonly PeerFlag[]): string {
  return normalizedPeerFlags(flags)
    .map((flag) => PEER_FLAG_DEFINITIONS[flag].glyph)
    .join("");
}

export function describePeerFlags(
  flags: readonly PeerFlag[],
  mseMethod: PeerMseMethodView | null = null,
): string {
  const labels = normalizedPeerFlags(flags).map(
    (flag) =>
      flag === "encrypted" && mseMethod !== null
        ? mseMethod === "rc4"
          ? "MSE with RC4 payload"
          : "MSE handshake with plaintext payload"
        : PEER_FLAG_DEFINITIONS[flag].label,
  );
  return labels.length === 0
    ? "No active peer flags"
    : `Peer flags: ${labels.join(", ")}`;
}
