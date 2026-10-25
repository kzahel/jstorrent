import { message as localizedMessage, formatNumber } from "../localization/runtime";
import type { IconName } from "./components/Icon";
import { torrentRemovalActive } from "./format";
import type { TorrentRow } from "./model";
import { seedLimitReached } from "./seed-stop";

export type TorrentActionId =
  | "start"
  | "pause"
  | "move_to_top"
  | "move_to_bottom"
  | "force_recheck"
  | "copy_magnet"
  | "copy_share_link"
  | "settings"
  | "archive"
  | "restore"
  | "remove";

export type TorrentActionGroup =
  | "transfer"
  | "sharing"
  | "organization"
  | "destructive";

export type TorrentActionPlacement = "direct" | "overflow";

export interface TorrentActionDefinition {
  readonly id: TorrentActionId;
  readonly label: (targets: readonly TorrentRow[]) => string;
  readonly pendingLabel: string;
  readonly icon: IconName;
  readonly group: TorrentActionGroup;
  readonly placement: TorrentActionPlacement;
  readonly destructive: boolean;
}

export interface TorrentActionAvailability {
  readonly disabled: boolean;
  readonly reason?: string;
}

export const TORRENT_ACTIONS: readonly TorrentActionDefinition[] = [
  {
    id: "start",
    // Starting one torrent stopped by a seeding limit keeps it seeding.
    label: (targets) =>
      targets.length === 1 && seedLimitReached(targets[0]!)
        ? localizedMessage("inspection.torrent.actions.keep.seeding")
        : localizedMessage("inspection.torrent.actions.start"),
    get pendingLabel() { return localizedMessage("inspection.torrent.actions.pending.start"); },
    icon: "play",
    group: "transfer",
    placement: "direct",
    destructive: false,
  },
  {
    id: "pause",
    label: () => localizedMessage("inspection.torrent.actions.pause"),
    get pendingLabel() { return localizedMessage("inspection.torrent.actions.pending.pause"); },
    icon: "pause",
    group: "transfer",
    placement: "direct",
    destructive: false,
  },
  {
    id: "force_recheck",
    label: () => localizedMessage("inspection.torrent.actions.force.recheck"),
    get pendingLabel() { return localizedMessage("inspection.torrent.actions.pending.force.recheck"); },
    icon: "recheck",
    group: "transfer",
    placement: "overflow",
    destructive: false,
  },
  {
    id: "move_to_top",
    label: () => localizedMessage("inspection.torrent.actions.move.to.top"),
    get pendingLabel() { return localizedMessage("inspection.torrent.actions.pending.move.to.top"); },
    icon: "transfers",
    group: "transfer",
    placement: "overflow",
    destructive: false,
  },
  {
    id: "move_to_bottom",
    label: () => localizedMessage("inspection.torrent.actions.move.to.bottom"),
    get pendingLabel() { return localizedMessage("inspection.torrent.actions.pending.move.to.bottom"); },
    icon: "transfers",
    group: "transfer",
    placement: "overflow",
    destructive: false,
  },
  {
    id: "copy_magnet",
    label: (targets) =>
      targets.length === 1 ? localizedMessage("inspection.torrent.actions.copy.magnet.one") : localizedMessage("inspection.torrent.actions.copy.magnet.many"),
    get pendingLabel() { return localizedMessage("inspection.torrent.actions.pending.copy.magnet"); },
    icon: "magnet",
    group: "sharing",
    placement: "overflow",
    destructive: false,
  },
  {
    id: "copy_share_link",
    label: (targets) =>
      targets.length === 1
        ? localizedMessage("inspection.torrent.actions.copy.share.link")
        : localizedMessage("inspection.torrent.actions.copy.share.links"),
    get pendingLabel() { return localizedMessage("inspection.torrent.actions.copying.share.links"); },
    icon: "link",
    group: "sharing",
    placement: "overflow",
    destructive: false,
  },
  {
    id: "settings",
    label: () => localizedMessage("inspection.components.torrent.settings.dialog.title"),
    get pendingLabel() { return localizedMessage("inspection.torrent.actions.pending.settings"); },
    icon: "settings",
    group: "organization",
    placement: "overflow",
    destructive: false,
  },
  {
    id: "archive",
    label: () => localizedMessage("inspection.torrent.actions.archive"),
    get pendingLabel() { return localizedMessage("inspection.torrent.actions.pending.archive"); },
    icon: "archive",
    group: "organization",
    placement: "overflow",
    destructive: false,
  },
  {
    id: "restore",
    label: () => localizedMessage("inspection.torrent.actions.restore"),
    get pendingLabel() { return localizedMessage("inspection.torrent.actions.pending.restore"); },
    icon: "restore",
    group: "organization",
    placement: "overflow",
    destructive: false,
  },
  {
    id: "remove",
    label: () => localizedMessage("inspection.torrent.actions.remove"),
    get pendingLabel() { return localizedMessage("inspection.torrent.actions.pending.remove"); },
    icon: "remove",
    group: "destructive",
    placement: "direct",
    destructive: true,
  },
];

export const TORRENT_ACTION_GROUPS: readonly TorrentActionGroup[] = [
  "transfer",
  "sharing",
  "organization",
  "destructive",
];

export function torrentActionsForPlacement(
  placement: TorrentActionPlacement,
): readonly TorrentActionDefinition[] {
  return TORRENT_ACTIONS.filter((action) => action.placement === placement);
}

export function orderedSelectedTorrentRows(
  order: readonly string[],
  torrents: Readonly<Record<string, TorrentRow>>,
  selectedIds: ReadonlySet<string>,
): TorrentRow[] {
  return order
    .filter((id) => selectedIds.has(id))
    .map((id) => torrents[id])
    .filter((row): row is TorrentRow => row !== undefined);
}

export function torrentActionAvailability(
  actionId: TorrentActionId,
  targets: readonly TorrentRow[],
): TorrentActionAvailability {
  if (targets.length === 0) {
    return { disabled: true, reason: localizedMessage("inspection.torrent.actions.select.a.torrent.to.use.this.action") };
  }

  if (actionId === "copy_magnet" || actionId === "copy_share_link") {
    return { disabled: false };
  }

  if (actionId === "settings" && targets.length !== 1) {
    return { disabled: true, reason: localizedMessage("inspection.torrent.actions.select.one.torrent.to.edit.settings") };
  }

  const activeRemovalCount = targets.filter(torrentRemovalActive).length;
  if (activeRemovalCount > 0) {
    return {
      disabled: true,
      reason: localizedMessage("inspection.torrent.actions.removal.active", { count: activeRemovalCount }),
    };
  }

  if (actionId !== "remove" && targets.some((row) => row.removalState !== null)) {
    return {
      disabled: true,
      reason: localizedMessage("inspection.torrent.actions.a.selected.torrent.has.a.failed.removal"),
    };
  }

  // Archived torrents stay paused; the engine rejects starting or queueing
  // them until they are restored.
  if (actionId === "start" || actionId === "move_to_top" || actionId === "move_to_bottom") {
    const archived = targets.filter((row) => row.archived === true).length;
    if (archived > 0) {
      return {
        disabled: true,
        reason:
          archived === 1
            ? localizedMessage("inspection.torrent.actions.restore.archived.torrent.first")
            : localizedMessage("inspection.torrent.actions.restore.archived.torrents.first", {
                count: formatNumber(archived),
              }),
      };
    }
  }

  switch (actionId) {
    case "start":
    case "pause":
    case "remove":
    case "settings":
      return { disabled: false };
    case "force_recheck": {
      const unavailable = targets.filter((row) => !row.forceRecheckAvailable).length;
      return unavailable === 0
        ? { disabled: false }
        : {
            disabled: true,
            reason: localizedMessage("inspection.torrent.actions.recheck.unavailable", { count: unavailable }),
          };
    }
    case "move_to_top":
    case "move_to_bottom": {
      const unavailable = targets.filter((row) => row.queuePosition === null).length;
      return unavailable === 0
        ? { disabled: false }
        : {
            disabled: true,
            reason: localizedMessage("inspection.torrent.actions.queue.unavailable", { count: unavailable }),
          };
    }
    case "archive":
    case "restore": {
      if (targets.some((row) => row.archived === null)) {
        return {
          disabled: true,
          reason: localizedMessage("inspection.torrent.actions.archive.state.is.unavailable.for.a.selected"),
        };
      }
      if (actionId === "archive" && targets.some((row) => row.awaitingFileSelection === true)) {
        return {
          disabled: true,
          reason: localizedMessage("inspection.torrent.actions.choose.files.before.archiving"),
        };
      }
      const alreadySatisfied = targets.every((row) =>
        actionId === "archive" ? row.archived === true : row.archived === false,
      );
      return alreadySatisfied
        ? {
            disabled: true,
            reason:
              actionId === "archive"
                ? localizedMessage("inspection.torrent.actions.archive.already")
                : localizedMessage("inspection.torrent.actions.restore.already"),
          }
        : { disabled: false };
    }
  }
}
