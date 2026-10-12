import { message as localizedMessage } from "../localization/runtime";
import type { MediaFileAvailability } from "../api";

export type FileActionId = "open" | "download_now" | "high" | "normal" | "skip";

interface OpenFileActionDefinition {
  readonly id: "open";
  readonly label: string;
  readonly group: "open";
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

export type FileActionDefinition =
  | OpenFileActionDefinition
  | DownloadFileActionDefinition
  | PriorityFileActionDefinition;

export type ResolvedFileAction = FileActionDefinition & {
  readonly disabled: boolean;
  readonly disabledReason?: string;
};

export const FILE_ACTIONS: readonly FileActionDefinition[] = [
  { id: "open", label: localizedMessage("inspection.file.actions.open"), group: "open" },
  { id: "download_now", label: localizedMessage("inspection.file.actions.download.now"), group: "download" },
  { id: "high", label: localizedMessage("inspection.file.actions.high"), group: "priority", priority: "high" },
  { id: "normal", label: localizedMessage("inspection.file.actions.normal"), group: "priority", priority: "normal" },
  { id: "skip", label: localizedMessage("inspection.file.actions.skip"), group: "priority", priority: "skip" },
];

export function resolveFileActions(
  targetCount: number,
  skippedTargetCount: number,
  pending: boolean,
  unavailableReason?: string,
  openAvailability?: MediaFileAvailability,
  torrentArchived = false,
): readonly ResolvedFileAction[] {
  const disabledReason = pending
    ? "Another file action is still in progress."
    : targetCount === 0
      ? "Select a file to use these actions."
      : unavailableReason;
  return FILE_ACTIONS.filter(
    (action) =>
      (action.id !== "open" ||
        (targetCount === 1 &&
          (openAvailability === "available" ||
            openAvailability === "streamable"))) &&
      (action.id !== "download_now" || skippedTargetCount > 0),
  ).map((action) => {
    const reason =
      disabledReason ??
      (action.id === "download_now" && torrentArchived
        ? localizedMessage("inspection.file.actions.restore.before.downloading")
        : undefined);
    return {
      ...action,
      disabled: reason !== undefined,
      ...(reason === undefined ? {} : { disabledReason: reason }),
    };
  });
}
