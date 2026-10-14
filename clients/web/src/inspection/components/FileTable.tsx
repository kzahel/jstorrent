import { useRemotePlayback, canPlayRemoteFile } from "./RemoteVideoPlayer";
import { message as localizedMessage } from "../../localization/runtime";
import { useEffect, useMemo, useRef, useState } from "react";

import { useInspectionCommand, useInspectionStore } from "../context";
import type { DataUnits } from "../appearance";
import { resolveFileActions, type FileActionId } from "../file-actions";
import { formatExactBytes, formatDecimalProgress } from "../format";
import type { FileRow, ViewMaterialization } from "../model";
import type { DesktopRemoteAccess } from "../remote-access/types";
import { FileActionsMenu } from "./FileActionsMenu";
import { FileActionMenuItems } from "./FileActionMenuItems";
import {
  TableToolbarSlot,
  VirtualTable,
  type VirtualColumn,
} from "./VirtualTable";
import { ActionMenuPopover } from "./overlays/AnchoredOverlay";
import { useToast } from "./Toast";
import styles from "./FileTable.module.css";

const DIRECT_SAVE_TOAST = "direct-save";

const columns = (dataUnits: DataUnits): readonly VirtualColumn<FileRow>[] => [
  {
    id: "name",
    listRole: "title",
    label: localizedMessage("inspection.components.file.table.name"),
    width: 270,
    minimumWidth: 130,
    maximumWidth: 620,
    sortValue: (row) => row.name,
    render: (row) => (
      <span className={styles.name} title={row.name}>
        {row.name}
      </span>
    ),
  },
  {
    id: "folder",
    listRole: "subtitle",
    label: localizedMessage("inspection.components.file.table.folder"),
    width: 210,
    minimumWidth: 100,
    maximumWidth: 520,
    sortValue: (row) => row.folder,
    render: (row) => <span title={row.folder}>{row.folder || "—"}</span>,
  },
  {
    id: "priority",
    listRole: "trailing",
    label: localizedMessage("inspection.components.file.table.priority"),
    width: 76,
    sortValue: (row) => row.selection,
    sortOrder: ["high", "normal", "skipped"],
    render: (row) => (
      <span className={styles.priority} data-selection={row.selection}>
        {row.selection === "skipped"
          ? localizedMessage("inspection.components.file.table.skip")
          : row.selection === "high"
            ? localizedMessage("inspection.components.file.table.high")
            : localizedMessage("inspection.components.file.table.normal")}
      </span>
    ),
  },
  {
    id: "size",
    listRole: "detail",
    label: localizedMessage("inspection.components.file.table.size"),
    width: 92,
    align: "right",
    sortValue: (row) => row.lengthBytes,
    sortKind: "decimal",
    render: (row) => formatExactBytes(row.lengthBytes, dataUnits),
  },
  {
    id: "progress",
    listRole: "wide",
    label: localizedMessage("inspection.components.file.table.progress"),
    width: 108,
    minimumWidth: 88,
    align: "right",
    sortValue: (row) => progressBasisPoints(row),
    sortKind: "number",
    render: (row) => (
      <span className={styles.progress}>
        <span aria-hidden="true">
          <span
            style={{
              width: formatDecimalProgress(row.doneBytes, row.lengthBytes),
            }}
          />
        </span>
        {formatDecimalProgress(row.doneBytes, row.lengthBytes)}
      </span>
    ),
  },
  {
    id: "done",
    label: localizedMessage("inspection.components.file.table.done"),
    width: 96,
    align: "right",
    sortValue: (row) => row.doneBytes,
    sortKind: "decimal",
    render: (row) => formatExactBytes(row.doneBytes, dataUnits),
  },
  {
    id: "verified",
    label: localizedMessage("inspection.components.file.table.verified"),
    width: 96,
    align: "right",
    sortValue: (row) => row.verifiedBytes,
    sortKind: "decimal",
    render: (row) => formatExactBytes(row.verifiedBytes, dataUnits),
  },
  {
    id: "extension",
    label: localizedMessage("inspection.components.file.table.type"),
    width: 72,
    defaultVisible: false,
    sortValue: (row) => row.extension,
    render: (row) => row.extension || "—",
  },
  {
    id: "index",
    label: localizedMessage("inspection.components.file.table.index"),
    width: 68,
    align: "right",
    defaultVisible: false,
    sortValue: (row) => row.index,
    sortKind: "number",
    render: (row) => row.index.toLocaleString(),
  },
  {
    id: "offset",
    label: localizedMessage("inspection.components.file.table.torrent.offset"),
    width: 118,
    align: "right",
    defaultVisible: false,
    sortValue: (row) => row.torrentOffsetBytes,
    sortKind: "decimal",
    render: (row) => formatExactBytes(row.torrentOffsetBytes, dataUnits),
  },
  {
    id: "pieces",
    label: localizedMessage("inspection.components.file.table.pieces"),
    width: 108,
    align: "right",
    defaultVisible: false,
    sortValue: (row) => row.firstPiece,
    sortKind: "number",
    render: (row) =>
      row.firstPiece === null
        ? "—"
        : row.firstPiece === row.lastPiece
          ? row.firstPiece.toLocaleString()
          : `${row.firstPiece.toLocaleString()}–${row.lastPiece?.toLocaleString()}`,
  },
  {
    id: "storagePath",
    label: localizedMessage("inspection.components.file.table.storage.path"),
    width: 520,
    minimumWidth: 180,
    maximumWidth: 900,
    defaultVisible: false,
    sortValue: (row) => row.storagePath,
    render: (row) => (
      <span title={row.storagePath ?? undefined}>{row.storagePath ?? "—"}</span>
    ),
  },
];

export function FileTable({
  torrentId,
  remoteAccess,
}: {
  readonly torrentId: string;
  readonly remoteAccess?: DesktopRemoteAccess | undefined;
}) {
  const playback = useRemotePlayback();
  const dataUnits = useInspectionStore((state) => state.presentation.dataUnits);
  const displayColumns = useMemo(() => columns(dataUnits), [dataUnits]);
  const [currentFileId, setCurrentFileId] = useState<string | null>(null);
  const [selectedFileIds, setSelectedFileIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [fileActionPending, setFileActionPending] = useState(false);
  const [tableToolbar, setTableToolbar] = useState<HTMLDivElement | null>(
    null,
  );
  const [directFileEnabled, setDirectFileEnabled] = useState<boolean | null>(null);
  const directSaveAbort = useRef<AbortController | null>(null);
  const execute = useInspectionCommand();
  const toast = useToast();
  const demo = useInspectionStore((state) => state.demo);
  const torrentArchived = useInspectionStore(
    (state) => state.torrents[torrentId]?.archived === true,
  );
  const fileSet = useInspectionStore(
    (state) => state.filesByTorrent[torrentId],
  );
  const materialization = useInspectionStore((state) => state.viewStatus.files);
  const interfaceSize = useInspectionStore(
    (state) => state.presentation.interfaceSize,
  );
  const rows = useMemo(
    () =>
      (fileSet?.order ?? [])
        .map((id) => fileSet?.rows[id])
        .filter((row): row is FileRow => row !== undefined && !row.padding),
    [fileSet],
  );
  const paddingCount = useMemo(
    () =>
      (fileSet?.order ?? []).filter((id) => fileSet?.rows[id]?.padding === true)
        .length,
    [fileSet],
  );
  const availableIds = useMemo(
    () => new Set(rows.map((row) => row.id)),
    [rows],
  );

  useEffect(() => {
    setCurrentFileId(null);
    setSelectedFileIds(new Set());
    setFileActionPending(false);
    directSaveAbort.current?.abort();
    directSaveAbort.current = null;
  }, [torrentId]);

  useEffect(() => {
    let active = true;
    if (
      remoteAccess?.scope !== "remote" ||
      remoteAccess.directFileSupported?.() !== true
    ) {
      setDirectFileEnabled(false);
      return () => {
        active = false;
      };
    }
    setDirectFileEnabled(null);
    void remoteAccess
      .state()
      .then((state) => {
        if (active) setDirectFileEnabled(state.security?.direct_file.enabled === true);
      })
      .catch(() => {
        if (active) setDirectFileEnabled(false);
      });
    return () => {
      active = false;
    };
  }, [remoteAccess, torrentId]);

  useEffect(() => {
    setSelectedFileIds((current) => {
      const next = new Set([...current].filter((id) => availableIds.has(id)));
      return setsEqual(current, next) ? current : next;
    });
  }, [availableIds]);

  useEffect(() => {
    setCurrentFileId((current) =>
      current !== null && selectedFileIds.has(current)
        ? current
        : (selectedFileIds.values().next().value ?? null),
    );
  }, [selectedFileIds]);

  const changeSelection = (
    selectedIds: readonly string[],
    requestedCurrentId: string | null,
  ) => {
    const next = new Set(selectedIds.filter((id) => availableIds.has(id)));
    const nextCurrentId =
      requestedCurrentId !== null && next.has(requestedCurrentId)
        ? requestedCurrentId
        : (next.values().next().value ?? null);
    setSelectedFileIds(next);
    setCurrentFileId(nextCurrentId);
  };

  const unavailableReason =
    demo === null
      ? undefined
      : "File actions are unavailable in demo scenarios.";
  const selectedSkippedCount = rows.filter(
    (row) => selectedFileIds.has(row.id) && row.selection === "skipped",
  ).length;
  const selectedOpenAvailability =
    selectedFileIds.size === 1
      ? rows.find((row) => selectedFileIds.has(row.id))?.mediaAvailability
      : undefined;
  const toolbarActions = playbackActions(resolveFileActions(
    selectedFileIds.size,
    selectedSkippedCount,
    fileActionPending,
    unavailableReason,
    selectedOpenAvailability,
    torrentArchived,
  ), rows.filter(row => selectedFileIds.has(row.id)));
  const selectedRows = rows.filter((row) => selectedFileIds.has(row.id));
  const toolbarDirectSave = resolveDirectSave(
    remoteAccess,
    selectedRows,
    fileActionPending,
    directFileEnabled,
    unavailableReason,
  );

  function playbackActions(
    actions: ReturnType<typeof resolveFileActions>,
    targets: readonly FileRow[],
  ) {
    if (!playback.remote) return actions;
    const availability = resolveDirectSave(
      remoteAccess, targets, fileActionPending, directFileEnabled, unavailableReason,
    );
    return actions
      .filter(action => action.id !== "open" ||
        (targets.length === 1 && canPlayRemoteFile(targets[0]!.name, targets[0]!.mediaAvailability)))
      .map(action => {
        if (action.id !== "open") return action;
        const reason = action.disabledReason ?? availability?.disabledReason;
        return {
          ...action,
          label: localizedMessage("remote.video.play"),
          disabled: action.disabled || availability?.disabled !== false || remoteAccess?.playCompletedFile === undefined,
          ...(reason === undefined ? {} : { disabledReason: reason }),
        };
      });
  }

  const runFileAction = async (
    actionId: FileActionId,
    requestedIds: readonly string[] = [...selectedFileIds],
  ) => {
    const requested = new Set(requestedIds);
    const targetRows = rows
      .filter((row) => requested.has(row.id))
      .sort((left, right) => left.index - right.index);
    if (targetRows.length !== requested.size) {
      toast.show({ message: localizedMessage("inspection.components.file.table.a.selected.file.is.no.longer.available") });
      return;
    }
    const action = playbackActions(resolveFileActions(
      targetRows.length,
      targetRows.filter((row) => row.selection === "skipped").length,
      fileActionPending,
      unavailableReason,
      targetRows.length === 1 ? targetRows[0]?.mediaAvailability : undefined,
      torrentArchived,
    ), targetRows).find((candidate) => candidate.id === actionId);
    if (action === undefined || action.disabled) {
      if (action?.disabledReason !== undefined) {
        toast.show({ message: action.disabledReason });
      }
      return;
    }
    if (action.id === "open" && playback.remote) {
      const row = targetRows[0]!;
      playback.play({ torrentId, fileIndex: row.index, fileName: row.name, lengthBytes: row.lengthBytes });
      return;
    }
    setFileActionPending(true);
    try {
      const fileIndices = targetRows.map((row) => row.index);
      // The Priority column shows the result; only failures need words.
      await execute(
        action.id === "open"
          ? {
              type: "open_file",
              torrentId,
              fileIndex: targetRows[0]!.index,
            }
          : action.id === "download_now"
          ? {
              type: "download_files",
              torrentId,
              fileIndices,
            }
          : {
              type: "set_file_priority",
              torrentId,
              fileIndices,
              priority: action.priority,
            },
      );
    } catch (error) {
      toast.show({
        tone: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setFileActionPending(false);
    }
  };

  const runDirectSave = async (
    requestedIds: readonly string[] = [...selectedFileIds],
  ) => {
    const requested = new Set(requestedIds);
    const targetRows = rows.filter((row) => requested.has(row.id));
    const action = resolveDirectSave(
      remoteAccess,
      targetRows,
      fileActionPending,
      directFileEnabled,
      unavailableReason,
    );
    if (action === undefined || action.disabled || targetRows.length !== 1) {
      if (action?.disabledReason !== undefined) toast.show({ message: action.disabledReason });
      return;
    }
    const save = remoteAccess?.saveCompletedFile;
    if (save === undefined) return;
    const row = targetRows[0]!;
    const cancellation = new AbortController();
    directSaveAbort.current = cancellation;
    const cancel = {
      label: localizedMessage("inspection.components.file.table.cancel.save"),
      onAction: () => cancellation.abort(),
    };
    const progressToast = (message: string, progress: number) =>
      toast.show({ key: DIRECT_SAVE_TOAST, message, progress, action: cancel });
    setFileActionPending(true);
    progressToast(localizedMessage("inspection.components.file.table.choose.where.to.save.this.remote.file"), 0);
    let lastProgressUpdate = -Infinity;
    try {
      await save({
        torrentId,
        fileIndex: row.index,
        fileName: row.name,
        lengthBytes: row.lengthBytes,
        signal: cancellation.signal,
        onProgress: (progress) => {
          if (progress.state === "connecting") {
            progressToast(localizedMessage("inspection.components.file.table.connecting.directly.to.the.remote.device"), 0);
          } else if (progress.state === "transferring") {
            const now = performance.now();
            if (now - lastProgressUpdate < 200) return;
            lastProgressUpdate = now;
            progressToast(
              localizedMessage("inspection.components.file.table.saving.directly"),
              directProgress(progress.bytesWritten, progress.fileLength),
            );
          } else if (progress.state === "complete") {
            toast.show({
              key: DIRECT_SAVE_TOAST,
              message: localizedMessage("inspection.components.file.table.remote.file.saved"),
            });
          }
        },
      });
    } catch (error) {
      toast.show(
        error instanceof DOMException && error.name === "AbortError"
          ? { key: DIRECT_SAVE_TOAST, message: localizedMessage("feedback.direct.save.cancelled") }
          : {
              key: DIRECT_SAVE_TOAST,
              tone: "error",
              message: error instanceof Error ? error.message : String(error),
            },
      );
    } finally {
      if (directSaveAbort.current === cancellation) directSaveAbort.current = null;
      setFileActionPending(false);
    }
  };

  return (
    <div className={styles.filePanel}>
      <div>
        <div className={styles.summary}>
          {paddingCount > 0 ? (
            <span>{paddingCount.toLocaleString()}{" "}{localizedMessage("inspection.components.file.table.padding.hidden")}</span>
          ) : null}
          <span
            className={styles.storagePath}
            title={fileSet?.filesystemContentBase ?? undefined}
          >
            {fileSet?.filesystemContentBase ?? localizedMessage("inspection.components.file.table.managed.by.android")}
          </span>
          <FileActionsMenu
            pending={fileActionPending}
            actions={toolbarActions}
            onAction={(actionId) => void runFileAction(actionId)}
            directSave={toolbarDirectSave}
            onDirectSave={() => void runDirectSave()}
          />
          <div ref={setTableToolbar} className={styles.tableToolbar} />
        </div>
      </div>
      <TableToolbarSlot.Provider value={tableToolbar}>
        <VirtualTable
          formatCount={(count) => localizedMessage("common.count.files", { count })}
          tableId="files"
          label={localizedMessage("inspection.components.file.table.torrent.files")}
          rows={rows}
          getRowId={(row) => row.id}
          columns={displayColumns}
          interfaceSize={interfaceSize}
          currentRowId={currentFileId}
          selection={{
            selectedIds: selectedFileIds,
            getRowLabel: (row) => row.name,
            onChange: changeSelection,
          }}
          contextMenu={{
            label: localizedMessage("inspection.components.file.table.file.actions"),
            render: (_row, targetIds) => {
              const targetIdSet = new Set(targetIds);
              const actions = playbackActions(resolveFileActions(
                targetIds.length,
                rows.filter(
                  (row) =>
                    targetIdSet.has(row.id) && row.selection === "skipped",
                ).length,
                fileActionPending,
                unavailableReason,
                targetIds.length === 1
                  ? rows.find((row) => row.id === targetIds[0])?.mediaAvailability
                  : undefined,
                torrentArchived,
              ), rows.filter(row => targetIdSet.has(row.id)));
              const directSave = resolveDirectSave(
                remoteAccess,
                rows.filter((row) => targetIdSet.has(row.id)),
                fileActionPending,
                directFileEnabled,
                unavailableReason,
              );
              return (
                <ActionMenuPopover label={localizedMessage("inspection.components.file.table.file.actions")}>
                  <FileActionMenuItems
                    actions={actions}
                    onAction={(actionId) =>
                      void runFileAction(actionId, targetIds)
                    }
                    directSave={directSave}
                    onDirectSave={() => void runDirectSave(targetIds)}
                  />
                </ActionMenuPopover>
              );
            },
          }}
          emptyMessage={fileEmptyMessage(materialization, fileSet?.state)}
          initialSort={{ columnId: "index", direction: "asc" }}
        />
      </TableToolbarSlot.Provider>
    </div>
  );
}

function resolveDirectSave(
  remoteAccess: DesktopRemoteAccess | undefined,
  rows: readonly FileRow[],
  pending: boolean,
  enabled: boolean | null,
  unavailableReason: string | undefined,
) {
  if (remoteAccess?.scope !== "remote") return undefined;
  if (unavailableReason !== undefined) return { disabled: true, disabledReason: unavailableReason };
  if (rows.length !== 1) {
    return { disabled: true, disabledReason: localizedMessage("inspection.components.file.table.select.one.completed.file.to.save") };
  }
  if (rows[0]?.mediaAvailability !== "available") {
    return { disabled: true, disabledReason: localizedMessage("inspection.components.file.table.only.completed.verified.files.can.be.saved") };
  }
  if (remoteAccess.directFileSupported?.() !== true || remoteAccess.saveCompletedFile === undefined) {
    return { disabled: true, disabledReason: localizedMessage("inspection.components.file.table.this.remote.host.does.not.support.direct") };
  }
  if (enabled === null) {
    return { disabled: true, disabledReason: localizedMessage("inspection.components.file.table.checking.direct.file.transfer.settings") };
  }
  if (!enabled) {
    return { disabled: true, disabledReason: localizedMessage("inspection.components.file.table.direct.file.transfers.are.disabled.on.the") };
  }
  if (pending) return { disabled: true, disabledReason: localizedMessage("inspection.components.file.table.another.file.action.is.in.progress") };
  return { disabled: false };
}

function directProgress(written: bigint, length: bigint): number {
  if (length === 0n) return 100;
  return Number((written * 1_000n) / length) / 10;
}

function setsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

function progressBasisPoints(row: FileRow): number {
  try {
    const length = BigInt(row.lengthBytes);
    if (length === 0n) return 10_000;
    return Number((BigInt(row.doneBytes) * 10_000n) / length);
  } catch {
    return 0;
  }
}

function fileEmptyMessage(
  materialization: ViewMaterialization,
  catalogState:
    "metadata_pending" | "available" | "torrent_missing" | undefined,
): string {
  switch (materialization.status) {
    case "not_requested":
      return localizedMessage("inspection.components.file.table.nothing.to.show");
    case "loading":
      return localizedMessage("inspection.components.file.table.loading.files");
    case "unavailable":
    case "unsupported":
      return materialization.reason;
    case "stale":
    case "ready":
      if (catalogState === "metadata_pending")
        return localizedMessage("inspection.components.file.table.files.appear.once.torrent.info.arrives");
      if (catalogState === "torrent_missing")
        return localizedMessage("inspection.components.file.table.the.torrent.is.no.longer.present");
      return localizedMessage("inspection.components.file.table.this.torrent.has.no.files.to.show");
  }
}
