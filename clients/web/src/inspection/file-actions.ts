import { message as localizedMessage } from "../localization/runtime";
import type { MediaFileAvailability } from "../api";

export type FileActionId =
  | "play"
  | "open"
  | "download_now"
  | "high"
  | "normal"
  | "skip"
  | "share";

interface OpenFileActionDefinition {
  readonly id: "open";
  readonly label: string;
  readonly group: "open";
  /** The file opens outside this window, such as in a new browser tab. */
  readonly external: true;
}

/** Plays the file in the in-app video player. */
interface PlayFileActionDefinition {
  readonly id: "play";
  readonly label: string;
  readonly group: "open";
  readonly external: false;
}

interface DownloadFileActionDefinition {
  readonly id: "download_now";
  readonly label: string;
  readonly group: "download";
}

interface PriorityFileActionDefinition {
  readonly id: "high" | "normal" | "skip";
  readonly label: string;
  readonly group: "priority";
  readonly priority: "high" | "normal" | "skip";
}

interface ShareFileActionDefinition {
  readonly id: "share";
  readonly label: string;
  readonly group: "share";
}

export type FileActionDefinition =
  | PlayFileActionDefinition
  | OpenFileActionDefinition
  | DownloadFileActionDefinition
  | PriorityFileActionDefinition
  | ShareFileActionDefinition;

export type ResolvedFileAction = FileActionDefinition & {
  readonly disabled: boolean;
  readonly disabledReason?: string;
};

export const FILE_ACTIONS: readonly FileActionDefinition[] = [
  { id: "open", label: localizedMessage("inspection.file.actions.open"), group: "open", external: true },
  { id: "download_now", label: localizedMessage("inspection.file.actions.download.now"), group: "download" },
  { id: "high", label: localizedMessage("inspection.file.actions.high"), group: "priority", priority: "high" },
  { id: "normal", label: localizedMessage("inspection.file.actions.normal"), group: "priority", priority: "normal" },
  { id: "skip", label: localizedMessage("inspection.file.actions.skip"), group: "priority", priority: "skip" },
  { id: "share", label: localizedMessage("inspection.file.actions.share.files"), group: "share" },
];

export function resolveFileActions(
  targetCount: number,
  skippedTargetCount: number,
  pending: boolean,
  unavailableReason?: string,
  openAvailability?: MediaFileAvailability,
  torrentArchived = false,
  /** Why sharing is unavailable, such as missing metadata. */
  shareUnavailableReason?: string,
): readonly ResolvedFileAction[] {
  const selectionReason = pending
    ? "Another file action is still in progress."
    : targetCount === 0
      ? "Select a file to use these actions."
      : undefined;
  const disabledReason = selectionReason ?? unavailableReason;
  return FILE_ACTIONS.filter(
    (action) =>
      (action.id !== "open" ||
        (targetCount === 1 &&
          (openAvailability === "available" ||
            openAvailability === "streamable"))) &&
      (action.id !== "download_now" || skippedTargetCount > 0),
  ).map((action) => {
    // Sharing only exports a link, so it works on archived torrents and in
    // demo scenarios that refuse file changes.
    const reason =
      action.id === "share"
        ? (selectionReason ?? shareUnavailableReason)
        : (disabledReason ??
          (action.id === "download_now" && torrentArchived
            ? localizedMessage("inspection.file.actions.restore.before.downloading")
            : undefined));
    return {
      ...action,
      ...(action.id === "share" && targetCount === 1
        ? { label: localizedMessage("inspection.file.actions.share.file") }
        : {}),
      disabled: reason !== undefined,
      ...(reason === undefined ? {} : { disabledReason: reason }),
    };
  });
}
