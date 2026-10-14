import { formatList, message as localizedMessage } from "../../localization/runtime";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";

import type { DesktopExternalActivation } from "../../desktop-external-intake";
import {
  useInspectionCommand,
  useInspectionController,
  useInspectionDispatch,
  useInspectionStore,
} from "../context";
import { useDesktopExternalIntake } from "../desktop-external-intake-context";
import { useNarrowViewport } from "../layout";
import type { CommandResult, DownloadRoot } from "../model";
import {
  WEBTORRENT_TEST_TORRENTS,
  type TestTorrentShortcut,
} from "../testTorrents";
import {
  readTorrentFile,
  torrentFileSizeError,
} from "../torrentFile";
import { magnetLabel, splitTorrentInputList, validateTorrentInput } from "../torrentInput";
import { Icon } from "./Icon";
import { AddTorrentDialog } from "./AddTorrentDialog";
import { PendingFileSelectionDialog } from "./PendingFileSelectionDialog";
import { MoreActionsMenu } from "./MoreActionsMenu";
import { useTorrentActions, type AddBatchEntry } from "./TorrentActionContext";
import { useToast } from "./Toast";
import styles from "./TorrentActions.module.css";

const ADD_INPUT_TOAST = "add-input";

interface PendingMagnetAdd {
  readonly type: "magnet";
  readonly magnet: string;
  readonly clearInputOnSuccess: boolean;
}

interface PendingTorrentFileAdd {
  readonly type: "torrent_file";
  readonly file: File;
}

interface PendingExternalAdd {
  readonly type: "external";
  readonly activation: DesktopExternalActivation;
}

interface PendingTestTorrentBatchAdd {
  readonly type: "test_torrent_batch";
}

/** Several torrent files or magnet links added together. */
interface PendingBatchAdd {
  readonly type: "batch";
  readonly entries: readonly AddBatchEntry[];
  readonly clearInputOnSuccess: boolean;
}

type SinglePendingAdd = PendingMagnetAdd | PendingTorrentFileAdd | PendingExternalAdd;
type PendingAdd = SinglePendingAdd | PendingTestTorrentBatchAdd | PendingBatchAdd;

interface TorrentActionsProps {
  readonly showCrostiniStorageHelp: boolean;
  readonly oneCurrentRoot?: boolean;
  /** Receives the end of the bar, where the torrent table puts its controls. */
  readonly tableToolbarRef?: (element: HTMLDivElement | null) => void;
}

export function TorrentActions({
  showCrostiniStorageHelp,
  oneCurrentRoot = false,
  tableToolbarRef,
}: TorrentActionsProps) {
  const demo = useInspectionStore((state) => state.demo);
  const storage = useInspectionStore((state) => state.storage);
  const dispatch = useInspectionDispatch();
  const execute = useInspectionCommand();
  const controller = useInspectionController();
  const revealTorrent = useInspectionStore((state) => state.revealTorrent);
  const dataUnits = useInspectionStore((state) => state.presentation.dataUnits);
  const pendingSelectionTorrent = useInspectionStore((state) =>
    Object.values(state.torrents)
      .filter((torrent) => torrent.awaitingFileSelection === true)
      .sort(
        (left, right) =>
          (left.pendingFileSelectionPosition ?? Number.MAX_SAFE_INTEGER) -
          (right.pendingFileSelectionPosition ?? Number.MAX_SAFE_INTEGER),
      )[0],
  );
  const pendingSelectionFiles = useInspectionStore((state) =>
    pendingSelectionTorrent === undefined
      ? undefined
      : state.filesByTorrent[pendingSelectionTorrent.id],
  );
  const pendingSelectionCount = useInspectionStore(
    (state) =>
      Object.values(state.torrents).filter(
        (torrent) => torrent.awaitingFileSelection === true,
      ).length,
  );
  const { intake: externalIntake, snapshot: externalSnapshot } =
    useDesktopExternalIntake();
  const {
    pendingAction,
    batchRunning,
    selectedTargetIds,
    actionsFor,
    runSampleBatch,
    runAddBatch,
    runAction,
  } = useTorrentActions();
  const toast = useToast();
  const showError = (error: unknown) =>
    toast.show({
      tone: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  const [torrentInput, setTorrentInput] = useState("");
  const [inputInvalid, setInputInvalid] = useState(false);
  const [adding, setAdding] = useState(false);
  const [pendingAdd, setPendingAdd] = useState<PendingAdd | null>(null);
  const addingRef = useRef(false);
  const addInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const removeButtonRef = useRef<HTMLButtonElement>(null);
  const resolvedActions = actionsFor();
  // Narrow bars keep one row: actions show their icons alone.
  const narrow = useNarrowViewport();
  const directActions = resolvedActions.filter(
    (action) => action.placement === "direct",
  );
  const overflowActions = resolvedActions.filter(
    (action) => action.placement === "overflow",
  );

  const beginAdd = async (source: string, clearInputOnSuccess: boolean) => {
    if (addingRef.current || batchRunning) return false;
    const list = splitTorrentInputList(source);
    if (list !== null) {
      setInputInvalid(false);
      toast.dismiss(ADD_INPUT_TOAST);
      return beginBatch(
        list.map((item): AddBatchEntry => {
          const validated = validateTorrentInput(item);
          return validated.accepted
            ? {
                label: magnetLabel(validated.magnet),
                source: { type: "magnet", magnet: validated.magnet },
              }
            : {
                label: magnetLabel(item),
                source: { type: "invalid", message: validated.message },
              };
        }),
        clearInputOnSuccess,
      );
    }
    const validated = validateTorrentInput(source);
    if (!validated.accepted) {
      setInputInvalid(true);
      toast.show({ key: ADD_INPUT_TOAST, tone: "error", message: validated.message });
      return false;
    }
    setInputInvalid(false);
    const defaultRoot = storage.roots.find(
      (root) =>
        root.id === storage.defaultRoot && root.availability === "available",
    );
    if (
      (!oneCurrentRoot && storage.showAddOptions) ||
      defaultRoot === undefined
    ) {
      setPendingAdd({
        type: "magnet",
        magnet: validated.magnet,
        clearInputOnSuccess,
      });
      return true;
    }
    return addToRoot(
      {
        type: "magnet",
        magnet: validated.magnet,
        clearInputOnSuccess,
      },
      defaultRoot.id,
      true,
      storage.showFileSelection === true,
    );
  };

  const addToRoot = async (
    source: SinglePendingAdd,
    storageRoot: string,
    startContent = true,
    awaitFileSelection = false,
  ) => {
    if (addingRef.current || batchRunning) return false;
    addingRef.current = true;
    setAdding(true);
    try {
      const result = await executePendingAdd(
        source,
        storageRoot,
        startContent,
        awaitFileSelection,
      );
      if (result.torrentId !== undefined) revealTorrent(result.torrentId);
      showAddResult(result);
      if (source.type === "magnet" && source.clearInputOnSuccess) {
        setTorrentInput("");
      }
      return true;
    } catch (error) {
      showError(error);
      return false;
    } finally {
      addingRef.current = false;
      setAdding(false);
    }
  };

  const executePendingAdd = async (
    source: SinglePendingAdd,
    storageRoot: string,
    startContent: boolean,
    awaitFileSelection: boolean,
  ) => {
    if (source.type === "magnet") {
      return execute({
        type: "add_magnet",
        magnet: source.magnet,
        storageRoot,
        startContent,
        ...(awaitFileSelection ? { awaitFileSelection: true } : {}),
      });
    }
    if (source.type === "external") {
      try {
        return await execute({
          type: "add_external_torrent",
          activationId: source.activation.id,
          storageRoot,
          startContent,
          ...(awaitFileSelection ? { awaitFileSelection: true } : {}),
        });
      } finally {
        await externalIntake?.synchronize();
      }
    }
    const bytes = await readTorrentFile(source.file);
    return execute({
      type: "add_torrent_bytes",
      source: bytes,
      storageRoot,
      startContent,
      ...(awaitFileSelection ? { awaitFileSelection: true } : {}),
    });
  };

  const addTorrent = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (addingRef.current || batchRunning) return;
    if (torrentInput.trim().length === 0) {
      fileInputRef.current?.click();
      return;
    }
    void beginAdd(torrentInput, true);
  };

  const selectTorrentFile = (file: File) => {
    if (addingRef.current || batchRunning) return;
    const sizeError = torrentFileSizeError(file.size);
    if (sizeError !== null) {
      toast.show({ tone: "error", message: sizeError });
      return;
    }
    setInputInvalid(false);
    const source: PendingTorrentFileAdd = { type: "torrent_file", file };
    const defaultRoot = storage.roots.find(
      (root) =>
        root.id === storage.defaultRoot && root.availability === "available",
    );
    if (
      (!oneCurrentRoot && storage.showAddOptions) ||
      defaultRoot === undefined
    ) {
      setPendingAdd(source);
      return;
    }
    void addToRoot(
      source,
      defaultRoot.id,
      true,
      storage.showFileSelection === true,
    );
  };

  /**
   * Several torrents share one folder choice: the default folder, or one
   * Add dialog when add options are shown. None waits for file selection.
   */
  const beginBatch = async (
    entries: readonly AddBatchEntry[],
    clearInputOnSuccess: boolean,
  ) => {
    if (addingRef.current || batchRunning || pendingAdd !== null) return false;
    const defaultRoot = storage.roots.find(
      (root) =>
        root.id === storage.defaultRoot && root.availability === "available",
    );
    if ((!oneCurrentRoot && storage.showAddOptions) || defaultRoot === undefined) {
      setPendingAdd({ type: "batch", entries, clearInputOnSuccess });
      return true;
    }
    addingRef.current = true;
    setAdding(true);
    try {
      const summary = await runAddBatch(entries, defaultRoot.id, true);
      if (clearInputOnSuccess && summary.failed === 0) setTorrentInput("");
      return true;
    } catch (error) {
      showError(error);
      return false;
    } finally {
      addingRef.current = false;
      setAdding(false);
    }
  };

  const selectTorrentFiles = (files: readonly File[]) => {
    const [first] = files;
    if (first === undefined) return;
    if (files.length === 1) {
      selectTorrentFile(first);
      return;
    }
    setInputInvalid(false);
    void beginBatch(
      files.map((file) => ({
        label: file.name,
        source: { type: "torrent_file", file },
      })),
      false,
    );
  };

  const addTestTorrent = async (torrent: TestTorrentShortcut) => {
    await beginAdd(torrent.magnet, false);
  };

  const addAllTestTorrents = async () => {
    if (addingRef.current || batchRunning || pendingAdd !== null) return;
    const defaultRoot = storage.roots.find(
      (root) =>
        root.id === storage.defaultRoot && root.availability === "available",
    );
    if ((!oneCurrentRoot && storage.showAddOptions) || defaultRoot === undefined) {
      setPendingAdd({ type: "test_torrent_batch" });
      return;
    }
    addingRef.current = true;
    setAdding(true);
    try {
      await runSampleBatch(
        defaultRoot.id,
        true,
        storage.showFileSelection === true,
      );
    } catch (error) {
      showError(error);
    } finally {
      addingRef.current = false;
      setAdding(false);
    }
  };

  /** A new torrent is revealed in the list, so only other outcomes speak. */
  const showAddResult = (result: CommandResult) => {
    if (!result.accepted || result.torrentId === undefined) return;
    const disposition = result.addDisposition;
    if (disposition?.type === "selection_expanded") {
      const count = disposition.newlyWantedCount;
      toast.show({
        message:
          count === undefined || count === null
            ? localizedMessage("feedback.add.selection.expanded")
            : localizedMessage("feedback.add.files.selected", { count }),
      });
      return;
    }
    if (disposition?.type !== "already_present") return;
    const torrentId = result.torrentId;
    if (controller.store.getState().torrents[torrentId]?.archived !== true) {
      toast.show({ message: localizedMessage("feedback.add.already.present") });
      return;
    }
    toast.show({
      message: localizedMessage("feedback.add.already.archived"),
      action: {
        label: localizedMessage("feedback.restore"),
        onAction: () => void runAction("restore", [torrentId]),
      },
    });
  };

  const chooseFolder = async (
    repairRoot?: string,
  ): Promise<DownloadRoot | null> => {
    const result = await execute({
      type: "choose_download_root",
      ...(repairRoot === undefined ? {} : { repairRoot }),
    });
    return result.storageRoot ?? null;
  };

  /** Makes the chosen folder the default and stops showing add options. */
  const alwaysUseFolder = async (rootId: string): Promise<void> => {
    try {
      if (rootId !== storage.defaultRoot) {
        await execute({ type: "set_default_download_root", rootId });
      }
      await execute({ type: "set_show_add_options", show: false });
    } catch (error) {
      showError(error);
    }
  };

  const confirmAdd = async (
    rootId: string,
    alwaysUseThisFolder: boolean,
    startContent: boolean,
  ) => {
    if (pendingAdd === null || addingRef.current) return;
    addingRef.current = true;
    setAdding(true);
    try {
      const fileSelectionEnabled = storage.showFileSelection === true;
      if (pendingAdd.type === "batch") {
        const summary = await runAddBatch(pendingAdd.entries, rootId, startContent);
        if (alwaysUseThisFolder) await alwaysUseFolder(rootId);
        if (pendingAdd.clearInputOnSuccess && summary.failed === 0) {
          setTorrentInput("");
        }
        setPendingAdd(null);
        return;
      }
      if (pendingAdd.type === "test_torrent_batch") {
        await runSampleBatch(
          rootId,
          fileSelectionEnabled ? true : startContent,
          fileSelectionEnabled,
        );
        if (alwaysUseThisFolder) await alwaysUseFolder(rootId);
        setPendingAdd(null);
        return;
      }
      const result = await executePendingAdd(
        pendingAdd,
        rootId,
        fileSelectionEnabled ? true : startContent,
        fileSelectionEnabled,
      );
      if (result.torrentId !== undefined) revealTorrent(result.torrentId);
      if (alwaysUseThisFolder) await alwaysUseFolder(rootId);
      if (
        pendingAdd.type === "magnet" &&
        pendingAdd.clearInputOnSuccess
      ) {
        setTorrentInput("");
      }
      setPendingAdd(null);
      showAddResult(result);
    } catch (error) {
      if (pendingAdd.type === "external") showError(error);
      throw error;
    } finally {
      addingRef.current = false;
      setAdding(false);
    }
  };

  const cancelPendingAdd = () => {
    const source = pendingAdd;
    if (source === null) return;
    if (source.type !== "external" || externalIntake === null) {
      setPendingAdd(null);
      return;
    }
    if (addingRef.current) return;
    addingRef.current = true;
    setAdding(true);
    void externalIntake
      .cancel(source.activation.id)
      .then(() => setPendingAdd(null))
      .catch((error: unknown) => {
        showError(error);
        if (
          !externalIntake
            .getSnapshot()
            .pending.some(({ id }) => id === source.activation.id)
        ) {
          setPendingAdd(null);
        }
      })
      .finally(() => {
        addingRef.current = false;
        setAdding(false);
      });
  };

  useEffect(() => {
    if (externalIntake === null) return;
    const rejected = externalSnapshot.rejectedCount;
    const overflow = externalSnapshot.overflowCount;
    if (rejected === 0 && overflow === 0) return;
    toast.show({ message: externalIntakeNotice(rejected, overflow) });
    externalIntake.consumeNotices();
  }, [externalIntake, externalSnapshot, toast]);

  useEffect(() => {
    if (externalIntake === null || demo !== null || batchRunning) return;
    if (pendingAdd?.type === "external") {
      const stillPending = externalSnapshot.pending.some(
        ({ id }) => id === pendingAdd.activation.id,
      );
      if (!stillPending && !addingRef.current) setPendingAdd(null);
      return;
    }
    if (pendingAdd !== null || addingRef.current) return;
    const activation = externalSnapshot.pending[0];
    if (activation === undefined) return;
    const source: PendingExternalAdd = { type: "external", activation };
    const defaultRoot = storage.roots.find(
      (root) =>
        root.id === storage.defaultRoot && root.availability === "available",
    );
    if (
      (!oneCurrentRoot && storage.showAddOptions) ||
      defaultRoot === undefined
    ) {
      setPendingAdd(source);
      return;
    }
    void addToRoot(
      source,
      defaultRoot.id,
      true,
      storage.showFileSelection === true,
    ).then((accepted) => {
      if (
        !accepted &&
        externalIntake
          .getSnapshot()
          .pending.some(({ id }) => id === activation.id)
      ) {
        setPendingAdd(source);
      }
    });
  }, [
    adding,
    demo,
    externalIntake,
    externalSnapshot,
    pendingAdd,
    storage.defaultRoot,
    storage.roots,
    storage.showAddOptions,
    storage.showFileSelection,
    batchRunning,
  ]);

  useEffect(() => {
    if (pendingSelectionTorrent === undefined) {
      controller.clearPendingFileSelection();
      return;
    }
    controller.showPendingFileSelection(pendingSelectionTorrent.id, 0);
    return () => controller.clearPendingFileSelection();
  }, [controller, pendingSelectionTorrent?.id]);

  return (
    <>
      <div className={styles.toolbar}>
        {demo === null ? (
          <form
            className={styles.addForm}
            aria-label={localizedMessage("inspection.components.torrent.actions.add.torrent")}
            onSubmit={(event) => void addTorrent(event)}
          >
            <input
              ref={addInputRef}
              className={styles.addInput}
              type="text"
              value={torrentInput}
              aria-label={localizedMessage("inspection.components.torrent.actions.magnet.link.or.torrent.url")}
              aria-invalid={inputInvalid}
              autoComplete="off"
              spellCheck={false}
              placeholder={localizedMessage("inspection.components.torrent.actions.magnet.link.or.url")}
              onChange={(event) => {
                setTorrentInput(event.currentTarget.value);
                setInputInvalid(false);
                toast.dismiss(ADD_INPUT_TOAST);
              }}
              onPaste={(event) => {
                // A one-line field drops line breaks, which would join a
                // pasted list of links; keep them apart with spaces.
                const pasted = event.clipboardData.getData("text");
                if (!/[\r\n]/.test(pasted.trim())) return;
                event.preventDefault();
                const field = event.currentTarget;
                const start = field.selectionStart ?? field.value.length;
                const end = field.selectionEnd ?? start;
                setTorrentInput(
                  field.value.slice(0, start) +
                    pasted.trim().replace(/\s+/g, " ") +
                    field.value.slice(end),
                );
                setInputInvalid(false);
                toast.dismiss(ADD_INPUT_TOAST);
              }}
            />
            <input
              ref={fileInputRef}
              hidden
              type="file"
              multiple
              accept=".torrent,application/x-bittorrent"
              onChange={(event) => {
                const files = [...(event.currentTarget.files ?? [])];
                event.currentTarget.value = "";
                selectTorrentFiles(files);
              }}
            />
            <button
              className={styles.addButton}
              type="submit"
              disabled={adding || batchRunning}
              aria-busy={adding || batchRunning}
            >
              {localizedMessage("inspection.components.torrent.actions.add")}
            </button>
          </form>
        ) : (
          <>
            <button
              type="button"
              className={styles.primaryAction}
              onClick={() =>
                void dispatch({ type: "add_demo_torrent" }).catch(showError)
              }
            >
              <Icon name="plus" />{" "}{localizedMessage("inspection.components.torrent.actions.add.demo")}</button>
            <span className={styles.divider} aria-hidden="true" />
          </>
        )}
        {directActions
          .filter((action) => action.id !== "remove")
          .map((action) => (
            <button
              key={action.id}
              type="button"
              disabled={adding || batchRunning || action.disabled}
              title={action.disabledReason ?? action.resolvedLabel}
              aria-label={narrow ? action.resolvedLabel : undefined}
              onClick={() => void runAction(action.id)}
            >
              <Icon name={action.icon} />
              {narrow ? null : <> {action.resolvedLabel}</>}
            </button>
          ))}
        {demo === null || selectedTargetIds.length > 0 ? (
          <MoreActionsMenu
            disabled={adding || batchRunning}
            actions={overflowActions}
            showTestTorrents={demo === null}
            addTestDisabled={pendingAction !== null}
            onAction={(actionId, trigger) => void runAction(actionId, undefined, {
              type: "toolbar",
              element: trigger,
            })}
            onAddTestTorrent={addTestTorrent}
            onAddAllTestTorrents={addAllTestTorrents}
          />
        ) : null}
        {directActions
          .filter((action) => action.id === "remove")
          .map((action) => (
            <button
              key={action.id}
              ref={removeButtonRef}
              type="button"
              disabled={adding || batchRunning || action.disabled}
              title={action.disabledReason ?? action.resolvedLabel}
              aria-label={narrow ? action.resolvedLabel : undefined}
              onClick={() =>
                void runAction(action.id, undefined, {
                  type: "toolbar",
                  element: removeButtonRef.current,
                })
              }
            >
              <Icon name={action.icon} />
              {narrow ? null : <> {action.resolvedLabel}</>}
            </button>
          ))}
        {tableToolbarRef === undefined ? null : (
          <div ref={tableToolbarRef} className={styles.tableToolbar} />
        )}
      </div>
      {pendingAdd === null ? null : (
        <AddTorrentDialog
          roots={storage.roots}
          defaultRoot={storage.defaultRoot}
          oneCurrentRoot={oneCurrentRoot}
          returnFocus={addInputRef}
          externalKind={
            pendingAdd.type === "external"
              ? pendingAdd.activation.kind
              : undefined
          }
          showCrostiniStorageHelp={showCrostiniStorageHelp}
          fileSelectionEnabled={
            pendingAdd.type !== "batch" && storage.showFileSelection === true
          }
          onChooseFolder={chooseFolder}
          onCancel={cancelPendingAdd}
          onConfirm={confirmAdd}
        />
      )}
      {pendingSelectionTorrent === undefined ? null : (
        <PendingFileSelectionDialog
          torrent={pendingSelectionTorrent}
          files={pendingSelectionFiles}
          rootLabel={
            storage.roots.find(
              (root) => root.id === pendingSelectionTorrent.storageRoot,
            )?.label ?? pendingSelectionTorrent.storageRoot ?? "Current folder"
          }
          queuedCount={Math.max(0, pendingSelectionCount - 1)}
          dataUnits={dataUnits}
          onPage={(offset) =>
            controller.showPendingFileSelection(
              pendingSelectionTorrent.id,
              offset,
            )
          }
          onConfirm={async (base, overrides, disableFuture) => {
            const catalogId = pendingSelectionTorrent.fileCatalogId;
            if (catalogId === null || catalogId === undefined) {
              throw new Error(localizedMessage("feedback.file.selection.not.ready"));
            }
            await execute({
              type: "confirm_pending_file_selection",
              torrentId: pendingSelectionTorrent.id,
              catalogId,
              base,
              overrides,
              disableFuture,
            });
          }}
          onDownloadAll={async (disableFuture) => {
            await execute({
              type: "download_all_pending_add",
              torrentId: pendingSelectionTorrent.id,
              disableFuture,
            });
          }}
          onCancel={async () => {
            await execute({
              type: "cancel_pending_add",
              torrentId: pendingSelectionTorrent.id,
            });
          }}
        />
      )}
    </>
  );
}

function externalIntakeNotice(rejected: number, overflow: number): string {
  const messages: string[] = [];
  if (rejected > 0) {
    messages.push(localizedMessage("feedback.external.rejected", { count: rejected }));
  }
  if (overflow > 0) {
    messages.push(localizedMessage("feedback.external.dropped", { count: overflow }));
  }
  return formatList(messages, { type: "unit" });
}
