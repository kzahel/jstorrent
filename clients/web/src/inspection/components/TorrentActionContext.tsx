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
import { copyText } from "../clipboard";
import type { FileRow, InspectionCommand, TorrentRow } from "../model";
import {
  exportShareLink,
  peerHintDecision,
  sharedLinksMessage,
  type ShareExport,
  type ShareFiles,
} from "../share-export";
import {
  loadPeerHintPreference,
  savePeerHintPreference,
} from "../share-preferences";
import { WEBTORRENT_TEST_TORRENTS } from "../testTorrents";
import { readTorrentFile, type TorrentFileSource } from "../torrentFile";
import {
  TORRENT_ACTIONS,
  orderedSelectedTorrentRows,
  torrentActionAvailability,
  type TorrentActionDefinition,
  type TorrentActionId,
} from "../torrent-actions";
import { PeerHintDialog } from "./PeerHintDialog";
import { RemoveTorrentDialog } from "./RemoveTorrentDialog";
import { TorrentSettingsDialog } from "./TorrentSettingsDialog";
import { useToast } from "./Toast";

const MAX_FAILURE_DETAILS = 5;
const SAMPLE_BATCH_TOAST = "sample-batch";
const ADD_BATCH_TOAST = "add-batch";

/** One torrent of a several-at-once add. */
export interface AddBatchEntry {
  /** Names the torrent in the failure list. */
  readonly label: string;
  readonly source:
    | { readonly type: "magnet"; readonly magnet: string }
    | { readonly type: "torrent_file"; readonly file: TorrentFileSource }
    /** Input that could not be added at all, such as a malformed link. */
    | { readonly type: "invalid"; readonly message: string };
}

export interface AddBatchSummary {
  readonly added: number;
  readonly alreadyPresent: number;
  readonly failed: number;
}

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

/** A share-link copy waiting for the address choice. */
interface PeerHintRequest {
  readonly targets: readonly TorrentRow[];
  readonly files?: ShareFiles;
  readonly origin: TorrentActionOrigin;
}

interface TorrentActionContextValue {
  readonly pendingAction: TorrentActionId | null;
  /** A sample or several-torrent add is in progress. */
  readonly batchRunning: boolean;
  readonly selectedTargetIds: readonly string[];
  readonly actionsFor: (targetIds?: readonly string[]) => readonly ResolvedTorrentAction[];
  readonly runSampleBatch: (
    storageRoot: string,
    startContent: boolean,
    awaitFileSelection: boolean,
  ) => Promise<void>;
  /** Adds each entry in turn and reports them in one notification. */
  readonly runAddBatch: (
    entries: readonly AddBatchEntry[],
    storageRoot: string,
    startContent: boolean,
  ) => Promise<AddBatchSummary>;
  readonly runAction: (
    actionId: TorrentActionId,
    targetIds?: readonly string[],
    origin?: TorrentActionOrigin,
  ) => Promise<void>;
  /**
   * Copies a share link that selects these files of one torrent. Call it
   * inside the user's click: the clipboard write starts synchronously.
   */
  readonly shareFiles: (
    torrentId: string,
    files: readonly FileRow[],
    origin?: TorrentActionOrigin,
  ) => void;
}

type SequentialActionId = Exclude<
  TorrentActionId,
  "copy_magnet" | "copy_share_link" | "remove" | "settings"
>;

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
  const [batchRunning, setBatchRunning] = useState(false);
  const batchRef = useRef(false);
  const [pendingAction, setPendingActionState] = useState<TorrentActionId | null>(
    null,
  );
  const pendingRef = useRef<TorrentActionId | null>(null);
  const [removeRequest, setRemoveRequest] = useState<RemoveRequest | null>(null);
  const [settingsRequest, setSettingsRequest] = useState<SettingsRequest | null>(null);
  const [peerHintRequest, setPeerHintRequest] = useState<PeerHintRequest | null>(null);
  const peerHintOriginRef = useRef<TorrentActionOrigin>({
    type: "toolbar",
    element: null,
  });
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
    (targetIds: readonly string[]) => {
      const ordered = orderedSelectedTorrentRows(
        order,
        torrents,
        new Set(targetIds),
      );
      // A narrow detail stops the list subscription, so its torrent can
      // be known without a place in the order.
      return ordered.length > 0 || targetIds.length !== 1
        ? ordered
        : targetIds
            .map((id) => torrents[id])
            .filter((row): row is TorrentRow => row !== undefined);
    },
    [order, torrents],
  );

  const actionsFor = useCallback(
    (requestedIds: readonly string[] = selectedTargetIds) => {
      const targets = targetRows(requestedIds);
      return TORRENT_ACTIONS.map((action): ResolvedTorrentAction => {
        const availability = torrentActionAvailability(action.id, targets);
        const busy = pendingAction !== null || batchRunning;
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
    [pendingAction, batchRunning, selectedTargetIds, targetRows],
  );

  /**
   * Adds entries one after another through the ordinary add commands, with
   * one progress notification replaced by one summary.
   */
  const runBatch = useCallback(async (
    entries: readonly AddBatchEntry[],
    storageRoot: string,
    startContent: boolean,
    awaitFileSelection: boolean,
    copy: {
      readonly toastKey: string;
      readonly progress: (current: number, total: number) => string;
      readonly summary: (summary: AddBatchSummary, failures: readonly string[]) => string;
    },
  ): Promise<AddBatchSummary> => {
    if (batchRef.current || pendingRef.current !== null) {
      throw new Error(localizedMessage("inspection.components.torrent.action.context.another.torrent.action.is.still.in.progress"));
    }
    batchRef.current = true;
    setBatchRunning(true);
    let added = 0;
    let alreadyPresent = 0;
    const failures: string[] = [];
    try {
      for (const [index, entry] of entries.entries()) {
        if (!mountedRef.current) break;
        toast.show({
          key: copy.toastKey,
          message: copy.progress(index + 1, entries.length),
          progress: (index / entries.length) * 100,
        });
        try {
          const source = entry.source;
          if (source.type === "invalid") throw new Error(source.message);
          const result = await execute(
            source.type === "magnet"
              ? {
                  type: "add_magnet",
                  magnet: source.magnet,
                  storageRoot,
                  startContent,
                  ...(awaitFileSelection ? { awaitFileSelection: true } : {}),
                }
              : {
                  type: "add_torrent_bytes",
                  source: await readTorrentFile(source.file),
                  storageRoot,
                  startContent,
                  ...(awaitFileSelection ? { awaitFileSelection: true } : {}),
                },
          );
          if (mountedRef.current && result.torrentId !== undefined) {
            revealTorrent(result.torrentId);
          }
          if (result.addDisposition?.type === "already_present") alreadyPresent += 1;
          else added += 1;
        } catch (error) {
          failures.push(failureDetail(entry.label, errorText(error).slice(0, 160)));
        }
      }
      const summary = { added, alreadyPresent, failed: failures.length };
      if (mountedRef.current) {
        toast.show({
          key: copy.toastKey,
          message: copy.summary(summary, failures),
          ...(failures.length === 0 ? {} : { tone: "error" as const }),
        });
      }
      return summary;
    } finally {
      batchRef.current = false;
      if (mountedRef.current) setBatchRunning(false);
    }
  }, [execute, revealTorrent, toast]);

  const runSampleBatch = useCallback(async (
    storageRoot: string,
    startContent: boolean,
    awaitFileSelection: boolean,
  ) => {
    await runBatch(
      WEBTORRENT_TEST_TORRENTS.map((torrent) => ({
        label: torrent.menuLabel,
        source: { type: "magnet", magnet: torrent.magnet },
      })),
      storageRoot,
      startContent,
      awaitFileSelection,
      {
        toastKey: SAMPLE_BATCH_TOAST,
        progress: (current, total) =>
          localizedMessage("inspection.components.torrent.actions.adding.sample.torrents", {
            current,
            total,
          }),
        summary: ({ added, alreadyPresent, failed }, failures) => {
          const summary = localizedMessage("inspection.components.torrent.actions.sample.torrents.result", {
            added,
            alreadyPresent,
            failed,
          });
          return failures.length === 0
            ? summary
            : `${summary} ${formatList(failures, { type: "unit" })}`;
        },
      },
    );
  }, [runBatch]);

  const runAddBatch = useCallback(
    (entries: readonly AddBatchEntry[], storageRoot: string, startContent: boolean) =>
      runBatch(entries, storageRoot, startContent, false, {
        toastKey: ADD_BATCH_TOAST,
        progress: (current, total) =>
          localizedMessage("feedback.add.batch.progress", { current, total }),
        summary: ({ added, alreadyPresent, failed }, failures) => {
          const summary = localizedMessage("feedback.add.batch.result", {
            added,
            alreadyPresent,
          });
          if (failed === 0) return summary;
          const listed = failures.slice(0, MAX_FAILURE_DETAILS);
          const remaining = failed - listed.length;
          const details = formatList(
            remaining === 0
              ? listed
              : [...listed, localizedMessage("feedback.list.more", { count: remaining })],
            { type: "unit" },
          );
          return `${summary} ${localizedMessage("feedback.add.batch.failed", { failed, details })}`;
        },
      }),
    [runBatch],
  );

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
    if (pendingRef.current !== null || batchRef.current) {
      toast.show({
        message: localizedMessage("inspection.components.torrent.action.context.another.torrent.action.is.still.in.progress"),
      });
      return;
    }
    void runSequential(actionId, targets, options);
  };

  /** Copies magnet links, one per line, in selection order. */
  const copyMagnets = useCallback(
    async (targets: readonly TorrentRow[]) => {
      setPendingAction("copy_magnet");
      try {
        // Start the clipboard write before the exports resolve so WebKit
        // keeps the click's user activation.
        const exported = (async () => {
          const links: string[] = [];
          let omittedTrackerCount = 0;
          for (const target of targets) {
            const result = await execute({
              type: "export_magnet",
              torrentId: target.id,
            });
            if (result.magnetExport === undefined) {
              throw new Error(localizedMessage("feedback.magnet.export.missing"));
            }
            links.push(result.magnetExport.magnet);
            omittedTrackerCount += result.magnetExport.omittedTrackerCount;
          }
          return { text: links.join("\n"), omittedTrackerCount };
        })();
        await copyText(exported.then(({ text }) => text));
        const { omittedTrackerCount } = await exported;
        if (mountedRef.current) {
          toast.show({
            message: copiedMagnetsMessage(targets, omittedTrackerCount),
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

  /**
   * Copies share links (Tactical 357), one per line, in selection order.
   * The clipboard write starts before any await so the caller's click keeps
   * its user activation.
   */
  const copyShareLinks = useCallback(
    async (
      targets: readonly TorrentRow[],
      files: ShareFiles | undefined,
      peerHint: boolean,
    ) => {
      setPendingAction("copy_share_link");
      try {
        const exported = (async () => {
          const results: ShareExport[] = [];
          for (const target of targets) {
            results.push(
              await exportShareLink(execute, {
                torrentId: target.id,
                peerHint: peerHint && target.privateTorrent !== true,
                ...(files === undefined ? {} : { files }),
              }),
            );
          }
          return results;
        })();
        await copyText(
          exported.then((results) => results.map((result) => result.link).join("\n")),
        );
        const results = await exported;
        if (mountedRef.current) {
          toast.show({ message: sharedLinksMessage(targets, results, peerHint) });
        }
      } catch (error) {
        if (mountedRef.current) {
          toast.show({
            tone: "error",
            message: localizedMessage("feedback.share.link.copy.failed", { error: errorText(error) }),
          });
        }
      } finally {
        setPendingAction(null);
      }
    },
    [execute, setPendingAction, toast],
  );

  /** Copies share links now, or asks about the address first. */
  const startShare = useCallback(
    (
      targets: readonly TorrentRow[],
      files: ShareFiles | undefined,
      origin: TorrentActionOrigin,
    ): Promise<void> => {
      const decision = peerHintDecision(targets, loadPeerHintPreference());
      if (decision === "ask") {
        peerHintOriginRef.current = origin;
        setPeerHintRequest({
          targets,
          ...(files === undefined ? {} : { files }),
          origin,
        });
        return Promise.resolve();
      }
      return copyShareLinks(targets, files, decision);
    },
    [copyShareLinks],
  );

  const choosePeerHint = useCallback(
    (include: boolean, remember: boolean) => {
      const request = peerHintRequest;
      if (request === null) return;
      if (remember) savePeerHintPreference(include ? "include" : "omit");
      setPeerHintRequest(null);
      // The dialog button's click is the user activation for this copy.
      void copyShareLinks(request.targets, request.files, include);
    },
    [copyShareLinks, peerHintRequest],
  );

  const shareFiles = useCallback(
    (
      torrentId: string,
      files: readonly FileRow[],
      origin: TorrentActionOrigin = { type: "toolbar", element: null },
    ) => {
      const target = targetRows([torrentId])[0];
      if (target === undefined || files.length === 0) {
        toast.show({ message: localizedMessage("inspection.components.torrent.action.context.a.selected.torrent.is.no.longer.available") });
        return;
      }
      if (pendingRef.current !== null || batchRef.current) {
        toast.show({ message: localizedMessage("inspection.components.torrent.action.context.another.torrent.action.is.still.in.progress") });
        return;
      }
      const single = files.length === 1 ? files[0]! : null;
      void startShare(
        [target],
        {
          fileIndices: files.map((file) => file.index),
          ...(single === null
            ? {}
            : { display: { fileName: single.name, fileSize: single.lengthBytes } }),
        },
        origin,
      );
    },
    [startShare, targetRows, toast],
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
      if (pendingRef.current !== null || batchRef.current) {
        toast.show({ message: localizedMessage("inspection.components.torrent.action.context.another.torrent.action.is.still.in.progress") });
        return;
      }
      if (availability.disabled) {
        toast.show({ message: availability.reason ?? localizedMessage("feedback.torrent.action.unavailable") });
        return;
      }
      if (actionId === "copy_magnet") {
        await copyMagnets(targets);
      } else if (actionId === "copy_share_link") {
        await startShare(targets, undefined, origin);
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
    [copyMagnets, runSequential, selectedTargetIds, startShare, targetRows, toast],
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
      batchRunning,
      selectedTargetIds,
      actionsFor,
      runSampleBatch,
      runAddBatch,
      runAction,
      shareFiles,
    }),
    [actionsFor, pendingAction, runAction, runAddBatch, runSampleBatch, batchRunning, selectedTargetIds, shareFiles],
  );

  const returnRemoveFocus = useCallback(
    () => focusOrigin(removeOriginRef.current),
    [],
  );

  const returnSettingsFocus = useCallback(
    () => focusOrigin(settingsOriginRef.current),
    [],
  );

  const returnPeerHintFocus = useCallback(
    () => focusOrigin(peerHintOriginRef.current),
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
      {peerHintRequest === null ? null : (
        <PeerHintDialog
          returnFocus={returnPeerHintFocus}
          onChoose={choosePeerHint}
          onCancel={() => setPeerHintRequest(null)}
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

function copiedMagnetsMessage(
  targets: readonly TorrentRow[],
  omittedTrackerCount: number,
): string {
  const links = targets.length;
  if (omittedTrackerCount > 0) {
    return localizedMessage("feedback.magnet.copied.trackers.omitted", {
      links,
      trackers: omittedTrackerCount,
    });
  }
  // A private torrent's links only work inside its tracker's community.
  if (targets.some((target) => target.privateTorrent)) {
    return localizedMessage("feedback.magnet.copied.private", { links });
  }
  return localizedMessage("feedback.magnet.copied", { links });
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
