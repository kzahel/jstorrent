import { formatList, message as localizedMessage } from "../../localization/runtime";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  useInspectionCommand,
  useInspectionDispatch,
  useInspectionStore,
} from "../context";
import type { InspectionCommand, TorrentRow } from "../model";
import { WEBTORRENT_TEST_TORRENTS } from "../testTorrents";
import {
  TORRENT_ACTIONS,
  orderedSelectedTorrentRows,
  torrentActionAvailability,
  type TorrentActionDefinition,
  type TorrentActionId,
} from "../torrent-actions";
import { RemoveTorrentDialog } from "./RemoveTorrentDialog";
import { TorrentSettingsDialog } from "./TorrentSettingsDialog";
import { useToast } from "./Toast";

const MAX_FAILURE_DETAILS = 5;
const SAMPLE_BATCH_TOAST = "sample-batch";

export interface ResolvedTorrentAction extends TorrentActionDefinition {
  readonly resolvedLabel: string;
  readonly disabled: boolean;
  readonly disabledReason?: string;
}

export type TorrentActionOrigin =
  | { readonly type: "toolbar"; readonly element: HTMLElement | null }
  | {
      readonly type: "row";
      readonly tableId: string;
      readonly rowId: string;
    };

interface RemoveRequest {
  readonly targets: readonly TorrentRow[];
  readonly origin: TorrentActionOrigin;
}

interface SettingsRequest {
  readonly torrentId: string;
}

interface TorrentActionContextValue {
  readonly pendingAction: TorrentActionId | null;
  readonly sampleBatchRunning: boolean;
  readonly selectedTargetIds: readonly string[];
  readonly actionsFor: (targetIds?: readonly string[]) => readonly ResolvedTorrentAction[];
  readonly runSampleBatch: (
    storageRoot: string,
    startContent: boolean,
    awaitFileSelection: boolean,
  ) => Promise<void>;
  readonly runAction: (
    actionId: TorrentActionId,
    targetIds?: readonly string[],
    origin?: TorrentActionOrigin,
  ) => Promise<void>;
}

type SequentialActionId = Exclude<TorrentActionId, "copy_magnet" | "remove" | "settings">;

interface SequentialOptions {
  /** Torrents to resume after the action, as Undo of an archive does. */
  readonly resume?: ReadonlySet<string>;
  readonly offerUndo?: boolean;
}

const TorrentActionContext = createContext<TorrentActionContextValue | null>(
  null,
);

export function TorrentActionProvider({ children }: { readonly children: ReactNode }) {
  const order = useInspectionStore((state) => state.torrentOrder);
  const torrents = useInspectionStore((state) => state.torrents);
  const selectedTargetIds = useInspectionStore(
    (state) => state.presentation.selectedTorrentIds,
  );
  const dispatch = useInspectionDispatch();
  const execute = useInspectionCommand();
  const revealTorrent = useInspectionStore((state) => state.revealTorrent);
  const toast = useToast();
  const [sampleBatchRunning, setSampleBatchRunning] = useState(false);
  const sampleBatchRef = useRef(false);
  const [pendingAction, setPendingActionState] = useState<TorrentActionId | null>(
    null,
  );
  const pendingRef = useRef<TorrentActionId | null>(null);
  const [removeRequest, setRemoveRequest] = useState<RemoveRequest | null>(null);
  const [settingsRequest, setSettingsRequest] = useState<SettingsRequest | null>(null);
  const removeOriginRef = useRef<TorrentActionOrigin>({
    type: "toolbar",
    element: null,
  });
  const settingsOriginRef = useRef<TorrentActionOrigin>({
    type: "toolbar",
    element: null,
  });
  const mountedRef = useRef(true);

  useEffect(() => {
    if (settingsRequest !== null && torrents[settingsRequest.torrentId] === undefined) {
      setSettingsRequest(null);
    }
  }, [settingsRequest, torrents]);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const setPendingAction = useCallback((actionId: TorrentActionId | null) => {
    pendingRef.current = actionId;
    if (mountedRef.current) setPendingActionState(actionId);
  }, []);

  const targetRows = useCallback(
    (targetIds: readonly string[]) =>
      orderedSelectedTorrentRows(order, torrents, new Set(targetIds)),
    [order, torrents],
  );

  const actionsFor = useCallback(
    (requestedIds: readonly string[] = selectedTargetIds) => {
      const targets = targetRows(requestedIds);
      return TORRENT_ACTIONS.map((action): ResolvedTorrentAction => {
        const availability = torrentActionAvailability(action.id, targets);
        const busy = pendingAction !== null || sampleBatchRunning;
        return {
          ...action,
          resolvedLabel: action.label(targets),
          disabled: busy || availability.disabled,
          ...(busy
            ? { disabledReason: localizedMessage("inspection.components.torrent.action.context.another.torrent.action.is.still.in.progress") }
            : availability.reason === undefined
              ? {}
              : { disabledReason: availability.reason }),
        };
      });
    },
    [pendingAction, sampleBatchRunning, selectedTargetIds, targetRows],
  );

  const runSampleBatch = useCallback(async (
    storageRoot: string,
    startContent: boolean,
    awaitFileSelection: boolean,
  ) => {
    if (sampleBatchRef.current || pendingRef.current !== null) {
      throw new Error(localizedMessage("inspection.components.torrent.action.context.another.torrent.action.is.still.in.progress"));
    }
    sampleBatchRef.current = true;
    setSampleBatchRunning(true);
    let added = 0;
    let alreadyPresent = 0;
    const failures: string[] = [];
    try {
      for (const [index, torrent] of WEBTORRENT_TEST_TORRENTS.entries()) {
        if (!mountedRef.current) break;
        toast.show({
          key: SAMPLE_BATCH_TOAST,
          message: localizedMessage("inspection.components.torrent.actions.adding.sample.torrents", {
            current: index + 1,
            total: WEBTORRENT_TEST_TORRENTS.length,
          }),
          progress: (index / WEBTORRENT_TEST_TORRENTS.length) * 100,
        });
        try {
          const result = await execute({
            type: "add_magnet",
            magnet: torrent.magnet,
            storageRoot,
            startContent,
            ...(awaitFileSelection ? { awaitFileSelection: true } : {}),
          });
          if (mountedRef.current && result.torrentId !== undefined) {
            revealTorrent(result.torrentId);
          }
          if (result.addDisposition?.type === "already_present") alreadyPresent += 1;
          else added += 1;
        } catch (error) {
          const detail = errorText(error);
          failures.push(failureDetail(torrent.menuLabel, detail.slice(0, 160)));
        }
      }
      const summary = localizedMessage("inspection.components.torrent.actions.sample.torrents.result", {
        added,
        alreadyPresent,
        failed: failures.length,
      });
      if (mountedRef.current) {
        toast.show({
          key: SAMPLE_BATCH_TOAST,
          ...(failures.length === 0
            ? { message: summary }
            : { message: `${summary} ${formatList(failures, { type: "unit" })}`, tone: "error" }),
        });
      }
    } finally {
      sampleBatchRef.current = false;
      if (mountedRef.current) setSampleBatchRunning(false);
    }
  }, [execute, revealTorrent, toast]);

  /** Undo runs from a toast; it never offers another Undo. */
  const undoRef = useRef<(
    actionId: SequentialActionId,
    targets: readonly TorrentRow[],
    options: SequentialOptions,
  ) => void>(() => undefined);

  const runSequential = useCallback(
    async (
      actionId: SequentialActionId,
      targets: readonly TorrentRow[],
      options: SequentialOptions = {},
    ): Promise<void> => {
      setPendingAction(actionId);
      let failureCount = 0;
      const failures: string[] = [];
      const succeeded: TorrentRow[] = [];
      const fail = (target: TorrentRow, error: unknown) => {
        failureCount += 1;
        if (failures.length < MAX_FAILURE_DETAILS) {
          failures.push(failureDetail(target.name, errorText(error)));
        }
      };
      try {
        for (const target of targets) {
          if (!mountedRef.current) break;
          try {
            await dispatch(commandFor(actionId, target.id));
            succeeded.push(target);
          } catch (error) {
            fail(target, error);
          }
        }
        for (const target of succeeded) {
          if (!mountedRef.current) break;
          if (options.resume?.has(target.id) !== true) continue;
          try {
            await dispatch({ type: "resume", torrentId: target.id });
          } catch (error) {
            fail(target, error);
          }
        }
        if (!mountedRef.current) return;
        if (failureCount > 0) {
          toast.show({
            tone: "error",
            message: failureMessage(targets.length, failureCount, failures),
          });
          return;
        }
        if (options.offerUndo !== true || succeeded.length === 0) return;
        if (actionId === "archive") {
          const resume = new Set(
            succeeded.filter(runningBeforeArchive).map((target) => target.id),
          );
          toast.show({
            message: localizedMessage("feedback.torrents.archived", {
              count: succeeded.length,
              name: succeeded[0]!.name,
            }),
            action: {
              label: localizedMessage("feedback.undo"),
              onAction: () => undoRef.current("restore", succeeded, { resume }),
            },
          });
        } else if (actionId === "restore") {
          toast.show({
            message: localizedMessage("feedback.torrents.restored", {
              count: succeeded.length,
              name: succeeded[0]!.name,
            }),
            action: {
              label: localizedMessage("feedback.undo"),
              onAction: () => undoRef.current("archive", succeeded, {}),
            },
          });
        }
      } finally {
        setPendingAction(null);
      }
    },
    [dispatch, setPendingAction, toast],
  );

  undoRef.current = (actionId, targets, options) => {
    if (pendingRef.current !== null || sampleBatchRef.current) {
      toast.show({
        message: localizedMessage("inspection.components.torrent.action.context.another.torrent.action.is.still.in.progress"),
      });
      return;
    }
    void runSequential(actionId, targets, options);
  };

  const copyMagnets = useCallback(
    async (targets: readonly TorrentRow[]) => {
      setPendingAction("copy_magnet");
      try {
        const clipboard = navigator.clipboard;
        if (clipboard === undefined) {
          throw new Error(localizedMessage("feedback.clipboard.unavailable"));
        }
        const exported = (async () => {
          const magnets: string[] = [];
          let omittedTrackerCount = 0;
          for (const target of targets) {
            const result = await execute({
              type: "export_magnet",
              torrentId: target.id,
            });
            if (result.magnetExport === undefined) {
              throw new Error(localizedMessage("feedback.magnet.export.missing"));
            }
            magnets.push(result.magnetExport.magnet);
            omittedTrackerCount += result.magnetExport.omittedTrackerCount;
          }
          return { text: magnets.join("\n"), omittedTrackerCount };
        })();
        let exportResult: Awaited<typeof exported>;
        if (
          typeof clipboard.write === "function" &&
          typeof ClipboardItem !== "undefined"
        ) {
          await clipboard.write([
            new ClipboardItem({
              "text/plain": exported.then(
                ({ text }) => new Blob([text], { type: "text/plain" }),
              ),
            }),
          ]);
          exportResult = await exported;
        } else {
          exportResult = await exported;
          await clipboard.writeText(exportResult.text);
        }
        if (mountedRef.current) {
          toast.show({
            message:
              exportResult.omittedTrackerCount === 0
                ? localizedMessage("feedback.magnet.copied", { links: targets.length })
                : localizedMessage("feedback.magnet.copied.trackers.omitted", {
                    links: targets.length,
                    trackers: exportResult.omittedTrackerCount,
                  }),
          });
        }
      } catch (error) {
        if (mountedRef.current) {
          toast.show({
            tone: "error",
            message: localizedMessage("feedback.magnet.copy.failed", { error: errorText(error) }),
          });
        }
      } finally {
        setPendingAction(null);
      }
    },
    [execute, setPendingAction, toast],
  );

  const runAction = useCallback(
    async (
      actionId: TorrentActionId,
      requestedIds: readonly string[] = selectedTargetIds,
      origin: TorrentActionOrigin = { type: "toolbar", element: null },
    ) => {
      const uniqueTargetIds = new Set(requestedIds);
      const targets = targetRows(requestedIds);
      if (targets.length !== uniqueTargetIds.size) {
        toast.show({ message: localizedMessage("inspection.components.torrent.action.context.a.selected.torrent.is.no.longer.available") });
        return;
      }
      const availability = torrentActionAvailability(actionId, targets);
      if (pendingRef.current !== null || sampleBatchRef.current) {
        toast.show({ message: localizedMessage("inspection.components.torrent.action.context.another.torrent.action.is.still.in.progress") });
        return;
      }
      if (availability.disabled) {
        toast.show({ message: availability.reason ?? localizedMessage("feedback.torrent.action.unavailable") });
        return;
      }
      if (actionId === "copy_magnet") {
        await copyMagnets(targets);
      } else if (actionId === "settings") {
        settingsOriginRef.current = origin;
        setSettingsRequest({ torrentId: targets[0]!.id });
      } else if (actionId === "remove") {
        removeOriginRef.current = origin;
        setRemoveRequest({ targets, origin });
      } else {
        await runSequential(actionId, targets, { offerUndo: true });
      }
    },
    [copyMagnets, runSequential, selectedTargetIds, targetRows, toast],
  );

  const removeTargets = useCallback(
    async (deleteData: boolean) => {
      const request = removeRequest;
      if (request === null) return;
      setPendingAction("remove");
      let completed = 0;
      let failureCount = 0;
      const failures: { readonly target: TorrentRow; readonly message: string }[] = [];
      try {
        for (const target of request.targets) {
          if (!mountedRef.current) break;
          try {
            await dispatch({
              type: "remove",
              torrentId: target.id,
              deleteData,
            });
            completed += 1;
          } catch (error) {
            failureCount += 1;
            failures.push({ target, message: errorText(error) });
          }
        }
        if (!mountedRef.current) return;
        if (failures.length === 0) {
          toast.show({
            message: localizedMessage("feedback.torrents.removed", {
              count: completed,
              name: request.targets[0]?.name ?? "",
            }),
          });
          setRemoveRequest(null);
          return;
        }
        // The removal dialog stays open on the failed targets and shows this.
        const message = failureMessage(
          request.targets.length,
          failureCount,
          failures
            .slice(0, MAX_FAILURE_DETAILS)
            .map((failure) => failureDetail(failure.target.name, failure.message)),
        );
        setRemoveRequest({
          targets: failures.map((failure) => failure.target),
          origin: request.origin,
        });
        throw new Error(message);
      } finally {
        setPendingAction(null);
      }
    },
    [dispatch, removeRequest, setPendingAction, toast],
  );

  const value = useMemo<TorrentActionContextValue>(
    () => ({
      pendingAction,
      sampleBatchRunning,
      selectedTargetIds,
      actionsFor,
      runSampleBatch,
      runAction,
    }),
    [actionsFor, pendingAction, runAction, runSampleBatch, sampleBatchRunning, selectedTargetIds],
  );

  const returnRemoveFocus = useCallback(
    () => focusOrigin(removeOriginRef.current),
    [],
  );

  const returnSettingsFocus = useCallback(
    () => focusOrigin(settingsOriginRef.current),
    [],
  );

  return (
    <TorrentActionContext.Provider value={value}>
      {children}
      {removeRequest === null ? null : (
        <RemoveTorrentDialog
          targets={removeRequest.targets}
          deleteDataSupported={removeRequest.targets.every(
            (target) => target.deleteDataSupported,
          )}
          returnFocus={returnRemoveFocus}
          onCancel={() => setRemoveRequest(null)}
          onConfirm={removeTargets}
        />
      )}
      {settingsRequest === null || torrents[settingsRequest.torrentId] === undefined ? null : (
        <TorrentSettingsDialog
          torrent={torrents[settingsRequest.torrentId]!}
          returnFocus={returnSettingsFocus}
          onClose={() => setSettingsRequest(null)}
        />
      )}
    </TorrentActionContext.Provider>
  );
}

export function useTorrentActions(): TorrentActionContextValue {
  const value = useContext(TorrentActionContext);
  if (value === null) throw new Error("TorrentActionProvider is missing");
  return value;
}

function commandFor(
  actionId: SequentialActionId,
  torrentId: string,
): InspectionCommand {
  switch (actionId) {
    case "start":
      return { type: "resume", torrentId };
    case "pause":
      return { type: "pause", torrentId };
    case "force_recheck":
      return { type: "force_recheck", torrentId };
    case "move_to_top":
      return { type: "move_download_to_top", torrentId };
    case "move_to_bottom":
      return { type: "move_download_to_bottom", torrentId };
    case "archive":
      return { type: "archive", torrentId };
    case "restore":
      return { type: "unarchive", torrentId };
  }
}

/** Android's `runningBeforeArchive`: Undo resumes only these. */
function runningBeforeArchive(target: TorrentRow): boolean {
  return (
    target.archived !== true &&
    target.removalState === null &&
    (target.operationalState === "queued" ||
      target.operationalState === "starting" ||
      target.operationalState === "downloading" ||
      target.operationalState === "seeding")
  );
}

function failureDetail(name: string, error: string): string {
  return localizedMessage("feedback.failure.detail", { name, error });
}

function failureMessage(
  total: number,
  failureCount: number,
  details: readonly string[],
): string {
  const remaining = Math.max(0, failureCount - details.length);
  const listed =
    remaining === 0
      ? details
      : [...details, localizedMessage("feedback.list.more", { count: remaining })];
  return localizedMessage("feedback.torrents.failed", {
    failed: failureCount,
    total,
    details: formatList(listed, { type: "unit" }),
  });
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function focusOrigin(origin: TorrentActionOrigin): void {
  if (origin.type === "toolbar") {
    if (origin.element?.isConnected) origin.element.focus();
    return;
  }
  const table = Array.from(
    document.querySelectorAll<HTMLElement>("[data-table-id]"),
  ).find((candidate) => candidate.dataset.tableId === origin.tableId);
  const row = Array.from(
    table?.querySelectorAll<HTMLElement>("[data-row-id]") ?? [],
  ).find((candidate) => candidate.dataset.rowId === origin.rowId);
  const current = table?.querySelector<HTMLElement>(`[data-current="true"]`);
  (row ?? current ?? table)?.focus();
}
