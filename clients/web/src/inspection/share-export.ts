import { message as localizedMessage } from "../localization/runtime";
import { CommandRejectedError } from "./command-error";
import type {
  CommandAccepted,
  InspectionCommand,
  MagnetPeerHint,
  MagnetPeerHintOmission,
  TorrentRow,
} from "./model";
import type { PeerHintPreference } from "./share-preferences";
import {
  magnetSelectsFiles,
  shareLinkFromMagnet,
  type ShareLinkDisplay,
} from "./share-link";

export type ExecuteCommand = (
  command: InspectionCommand,
) => Promise<CommandAccepted>;

/** Files of one torrent to share (Tactical 357). */
export interface ShareFiles {
  /** `FileView` indices; sorted and deduplicated before export. */
  readonly fileIndices: readonly number[];
  /** Display keys, used only for a single file. */
  readonly display?: ShareLinkDisplay;
}

export interface ShareExportRequest {
  readonly torrentId: string;
  readonly peerHint: boolean;
  readonly files?: ShareFiles;
}

export interface ShareExport {
  readonly link: string;
  readonly omittedTrackerCount: number;
  /** Addresses in the link; empty unless a hint was requested. */
  readonly peerHints: readonly MagnetPeerHint[];
  /** Why a requested hint was left out; null if none was reported. */
  readonly peerHintOmission: MagnetPeerHintOmission | null;
}

/**
 * Exports one share link with its size, file selection and, if asked, the
 * engine's peer hint. A host that rejects the options as an invalid request
 * predates them; a whole-torrent share then falls back once to the plain
 * export. Older hosts that ignore the options return the plain export
 * themselves, so a file share checks that the selection really is there.
 */
export async function exportShareLink(
  execute: ExecuteCommand,
  request: ShareExportRequest,
): Promise<ShareExport> {
  const fileIndices = [...new Set(request.files?.fileIndices ?? [])].sort(
    (left, right) => left - right,
  );
  const fileShare = fileIndices.length > 0;
  let result: CommandAccepted;
  try {
    result = await execute({
      type: "export_magnet",
      torrentId: request.torrentId,
      options: {
        includeSize: true,
        ...(fileShare ? { fileIndices } : {}),
        ...(request.peerHint ? { peerHint: true } : {}),
      },
    });
  } catch (error) {
    if (
      fileShare ||
      !(error instanceof CommandRejectedError) ||
      error.code !== "invalid_request"
    ) {
      throw error;
    }
    result = await execute({
      type: "export_magnet",
      torrentId: request.torrentId,
    });
  }
  const exported = result.magnetExport;
  if (exported === undefined) {
    throw new Error(localizedMessage("feedback.magnet.export.missing"));
  }
  if (fileShare && !magnetSelectsFiles(exported.magnet)) {
    throw new Error(localizedMessage("feedback.share.files.unsupported"));
  }
  return {
    link: shareLinkFromMagnet(
      exported.magnet,
      fileShare && fileIndices.length === 1 ? (request.files?.display ?? {}) : {},
    ),
    omittedTrackerCount: exported.omittedTrackerCount,
    peerHints: exported.peerHints ?? [],
    peerHintOmission: exported.peerHintOmission ?? null,
  };
}

/**
 * Whether a share of these torrents may carry a peer hint at all. Any
 * private torrent rules it out, and a torrent without metadata has nothing
 * to serve yet, so neither asks.
 */
export function peerHintApplies(targets: readonly TorrentRow[]): boolean {
  return (
    targets.length > 0 &&
    !targets.some((target) => target.privateTorrent === true) &&
    targets.some((target) => target.sizeBytes !== null)
  );
}

/** The hint choice for a copy: decided, or `ask` for the dialog. */
export function peerHintDecision(
  targets: readonly TorrentRow[],
  preference: PeerHintPreference,
): boolean | "ask" {
  if (!peerHintApplies(targets)) return false;
  return preference === "ask" ? "ask" : preference === "include";
}

/** The toast after share links were copied. */
export function sharedLinksMessage(
  targets: readonly TorrentRow[],
  results: readonly ShareExport[],
  peerHintRequested: boolean,
): string {
  const links = results.length;
  if (peerHintRequested) {
    const included = results.flatMap((result) => result.peerHints);
    if (included.length > 0) {
      return localizedMessage("feedback.share.link.copied.with.address", {
        links,
        scope: included.some((hint) => hint.scope === "internet")
          ? "internet"
          : "local_network",
      });
    }
    const reason = results.find(
      (result) => result.peerHintOmission !== null,
    )?.peerHintOmission;
    if (reason !== undefined && reason !== null) {
      return localizedMessage("feedback.share.link.copied.without.address", {
        links,
        reason,
      });
    }
  }
  const trackers = results.reduce(
    (sum, result) => sum + result.omittedTrackerCount,
    0,
  );
  if (trackers > 0) {
    return localizedMessage("feedback.share.link.copied.trackers.omitted", {
      links,
      trackers,
    });
  }
  // A private torrent's links only work inside its tracker's community.
  if (targets.some((target) => target.privateTorrent)) {
    return localizedMessage("feedback.share.link.copied.private", { links });
  }
  return localizedMessage("feedback.share.link.copied", { links });
}

/** One line for the Share panel about the address in the link. */
export function peerHintStatus(result: ShareExport): string | null {
  if (result.peerHints.length > 0) {
    return localizedMessage("share.panel.address.included", {
      addresses: result.peerHints.map((hint) => hint.endpoint).join(", "),
      scope: result.peerHints.some((hint) => hint.scope === "internet")
        ? "internet"
        : "local_network",
    });
  }
  if (result.peerHintOmission !== null) {
    return localizedMessage("share.panel.address.omitted", {
      reason: result.peerHintOmission,
    });
  }
  return null;
}
