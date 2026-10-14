import { message as localizedMessage } from "../../localization/runtime";
import {
  useEffect,
  useId,
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
import type { DownloadRoot } from "../model";
import {
  WEBTORRENT_TEST_TORRENTS,
  type TestTorrentShortcut,
} from "../testTorrents";
import {
  readTorrentFile,
  torrentFileSizeError,
} from "../torrentFile";
import { validateTorrentInput } from "../torrentInput";
import { Icon } from "./Icon";
import { AddTorrentDialog } from "./AddTorrentDialog";
import { PendingFileSelectionDialog } from "./PendingFileSelectionDialog";
import { MoreActionsMenu } from "./MoreActionsMenu";
import { useTorrentActions } from "./TorrentActionContext";
import styles from "./TorrentActions.module.css";

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

type SinglePendingAdd = PendingMagnetAdd | PendingTorrentFileAdd | PendingExternalAdd;
type PendingAdd = SinglePendingAdd | PendingTestTorrentBatchAdd;

interface TorrentActionsProps {
  readonly showCrostiniStorageHelp: boolean;
  readonly oneCurrentRoot?: boolean;
}

export function TorrentActions({
  showCrostiniStorageHelp,
  oneCurrentRoot = false,
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
    status,
    pendingAction,
    sampleBatchRunning,
    selectedTargetIds,
    actionsFor,
    setStatus,
    runSampleBatch,
    runAction,
  } = useTorrentActions();
  const [torrentInput, setTorrentInput] = useState("");
  const [inputInvalid, setInputInvalid] = useState(false);
  const [adding, setAdding] = useState(false);
  const [pendingAdd, setPendingAdd] = useState<PendingAdd | null>(null);
  const addingRef = useRef(false);
  const addInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const removeButtonRef = useRef<HTMLButtonElement>(null);
  const statusId = useId();
  const resolvedActions = actionsFor();
  const directActions = resolvedActions.filter(
    (action) => action.placement === "direct",
  );
  const overflowActions = resolvedActions.filter(
    (action) => action.placement === "overflow",
  );

  const beginAdd = async (source: string, clearInputOnSuccess: boolean) => {
    if (addingRef.current || sampleBatchRunning) return false;
    const validated = validateTorrentInput(source);
    if (!validated.accepted) {
      setInputInvalid(true);
      setStatus(validated.message);
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
    if (addingRef.current || sampleBatchRunning) return false;
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
      setStatus(result.message);
      if (source.type === "magnet" && source.clearInputOnSuccess) {
        setTorrentInput("");
      }
      return true;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
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
    if (addingRef.current || sampleBatchRunning) return;
    if (torrentInput.trim().length === 0) {
      fileInputRef.current?.click();
      return;
    }
    void beginAdd(torrentInput, true);
  };

  const selectTorrentFile = (file: File) => {
    if (addingRef.current || sampleBatchRunning) return;
    const sizeError = torrentFileSizeError(file.size);
    if (sizeError !== null) {
      setStatus(sizeError);
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

  const addTestTorrent = async (torrent: TestTorrentShortcut) => {
    await beginAdd(torrent.magnet, false);
  };

  const addAllTestTorrents = async () => {
    if (addingRef.current || sampleBatchRunning || pendingAdd !== null) return;
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
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      addingRef.current = false;
      setAdding(false);
    }
  };

  const chooseFolder = async (
    repairRoot?: string,
  ): Promise<DownloadRoot | null> => {
    const result = await execute({
      type: "choose_download_root",
      ...(repairRoot === undefined ? {} : { repairRoot }),
    });
    setStatus(result.message);
    return result.storageRoot ?? null;
  };

  /** Makes the chosen folder the default and stops showing add options. */
  const alwaysUseFolder = async (rootId: string): Promise<string> => {
    try {
      if (rootId !== storage.defaultRoot) {
        await execute({ type: "set_default_download_root", rootId });
      }
      const preference = await execute({
        type: "set_show_add_options",
        show: false,
      });
      return preference.message;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
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
      if (pendingAdd.type === "test_torrent_batch") {
        let message = await runSampleBatch(
          rootId,
          fileSelectionEnabled ? true : startContent,
          fileSelectionEnabled,
        );
        if (alwaysUseThisFolder) {
          message = `${message} ${await alwaysUseFolder(rootId)}`;
        }
        setPendingAdd(null);
        setStatus(message);
        return;
      }
      const result = await executePendingAdd(
        pendingAdd,
        rootId,
        fileSelectionEnabled ? true : startContent,
        fileSelectionEnabled,
      );
      if (result.torrentId !== undefined) revealTorrent(result.torrentId);
      let message = result.message;
      if (alwaysUseThisFolder) {
        message = `${result.message}. ${await alwaysUseFolder(rootId)}.`;
      }
      if (
        pendingAdd.type === "magnet" &&
        pendingAdd.clearInputOnSuccess
      ) {
        setTorrentInput("");
      }
      setPendingAdd(null);
      setStatus(message);
    } catch (error) {
      if (pendingAdd.type === "external") {
        setStatus(error instanceof Error ? error.message : String(error));
      }
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
        setStatus(error instanceof Error ? error.message : String(error));
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
    setStatus(externalIntakeNotice(rejected, overflow));
    externalIntake.consumeNotices();
  }, [externalIntake, externalSnapshot, setStatus]);

  useEffect(() => {
    if (externalIntake === null || demo !== null || sampleBatchRunning) return;
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
    sampleBatchRunning,
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
              aria-describedby={statusId}
              aria-invalid={inputInvalid}
              autoComplete="off"
              spellCheck={false}
              placeholder={localizedMessage("inspection.components.torrent.actions.magnet.link.or.url")}
              onChange={(event) => {
                setTorrentInput(event.currentTarget.value);
                setInputInvalid(false);
              }}
            />
            <input
              ref={fileInputRef}
              hidden
              type="file"
              accept=".torrent,application/x-bittorrent"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file !== undefined) selectTorrentFile(file);
              }}
            />
            <button
              className={styles.addButton}
              type="submit"
              disabled={adding || sampleBatchRunning}
              aria-busy={adding || sampleBatchRunning}
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
                void dispatch({ type: "add_demo_torrent" })
                  .then(setStatus)
                  .catch((error: unknown) =>
                    setStatus(error instanceof Error ? error.message : String(error)),
                  )
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
              disabled={adding || sampleBatchRunning || action.disabled}
              title={action.disabledReason}
              onClick={() => void runAction(action.id)}
            >
              <Icon name={action.icon} /> {action.resolvedLabel}
            </button>
          ))}
        {demo === null || selectedTargetIds.length > 0 ? (
          <MoreActionsMenu
            disabled={adding || sampleBatchRunning}
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
              disabled={adding || sampleBatchRunning || action.disabled}
              title={action.disabledReason}
              onClick={() =>
                void runAction(action.id, undefined, {
                  type: "toolbar",
                  element: removeButtonRef.current,
                })
              }
            >
              <Icon name={action.icon} /> {action.resolvedLabel}
            </button>
          ))}
        <output id={statusId} className={styles.commandStatus} aria-live="polite">
          {status}
        </output>
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
          fileSelectionEnabled={storage.showFileSelection === true}
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
              throw new Error("File metadata is not ready yet");
            }
            const result = await execute({
              type: "confirm_pending_file_selection",
              torrentId: pendingSelectionTorrent.id,
              catalogId,
              base,
              overrides,
              disableFuture,
            });
            setStatus(result.message);
          }}
          onDownloadAll={async (disableFuture) => {
            const result = await execute({
              type: "download_all_pending_add",
              torrentId: pendingSelectionTorrent.id,
              disableFuture,
            });
            setStatus(result.message);
          }}
          onCancel={async () => {
            const result = await execute({
              type: "cancel_pending_add",
              torrentId: pendingSelectionTorrent.id,
            });
            setStatus(result.message);
          }}
        />
      )}
    </>
  );
}

function externalIntakeNotice(rejected: number, overflow: number): string {
  const messages: string[] = [];
  if (rejected > 0) {
    messages.push(
      `${rejected.toLocaleString()} external torrent ${
        rejected === 1 ? "request was" : "requests were"
      } rejected by safety limits`,
    );
  }
  if (overflow > 0) {
    messages.push(
      `${overflow.toLocaleString()} external torrent ${
        overflow === 1 ? "request was" : "requests were"
      } dropped because the intake queue was full`,
    );
  }
  return messages.join("; ");
}
