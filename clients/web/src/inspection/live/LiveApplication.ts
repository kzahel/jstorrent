import { message as localizedMessage } from "../../localization/runtime";
import { markStartup } from "../../startup-timing";
import type {
  AddTorrentBytesRequest,
  ApiHello,
  ClientSettingsRuntimeView,
  CheckingProgressView,
  DiagnosticEvent,
  FileView,
  MagnetExportOptions,
  MediaItemView,
  PeerSourceView,
  PeerView,
  RequestEnvelope,
  ResponseEnvelope,
  SessionCurrentRatesView,
  SpeedHistoryView,
  SpeedMetric,
  StorageRootSnapshot,
  StorageSettingsSnapshot,
  SwarmPeerView,
  TorrentListImportReport,
  TorrentListImportTarget,
  TorrentState,
  TorrentPreparationView,
  TorrentView,
  TrackerView,
  ViewSnapshot,
  ViewSpec,
} from "../../api";
import { DEFAULT_CLIENT_SETTINGS_RUNTIME_VIEW } from "../../api/generated/v1";
import type { ApplicationViewClient } from "../../api/client";
import type {
  ViewController,
  ViewControllerOptions,
} from "../../view-controller";
import {
  abortableDelay,
  viewStopReason,
  type ViewConnectionStatus,
} from "../../view-connection";
import type { ViewSetState } from "../../view-set-reducer";
import type { InspectionApplication } from "../application";
import { supportedCommand, supportedPatch } from "../host-capabilities";
import { UNSUPPORTED_CALL_MESSAGE } from "../../api";
import { ApplicationViewError } from "../../api/errors";
import type {
  CommandResult,
  DesiredInspectionViews,
  DiskPieceRow,
  DiskSet,
  DownloadRoot,
  DownloadStorageSettings,
  InspectionCommand,
  InspectionSnapshot,
  InspectionUpdate,
  FileRow,
  FileSet,
  MediaRow,
  MediaSet,
  LogRow,
  MagnetShareOptions,
  PeerFlag,
  PeerRow,
  PeerSet,
  SwarmRow,
  SwarmSet,
  PieceMapSet,
  SessionConnection,
  SpeedInspectionView,
  TorrentCheckingProgress,
  TorrentPreparation,
  TorrentRow,
  TrackerRow,
  TrackerSet,
  ViewMaterialization,
} from "../model";
import { emptyDiskSet } from "../state";
import { DEFAULT_SPEED_METRICS } from "../speed-preferences";
import { mapPieceActivity, type MappedPieceActivity } from "./pieces";

const LIBRARY_VIEW_ID = "library";
const SUMMARY_VIEW_ID = "torrent-summary";
const PREPARATION_VIEW_ID = "torrent-preparation";
const PEERS_VIEW_ID = "torrent-peers";
const SWARM_VIEW_ID = "torrent-swarm";
const FILES_VIEW_ID = "torrent-files";
const MEDIA_VIEW_ID = "torrent-media";
const TRACKERS_VIEW_ID = "torrent-trackers";
const PIECES_VIEW_ID = "torrent-pieces";
const DISK_VIEW_ID = "session-disk";
const DHT_VIEW_ID = "session-dht";
const SPEED_VIEW_ID = "session-speed";
const SESSION_RATES_VIEW_ID = "session-rates";
const LOGS_VIEW_ID = "logs";

/**
 * A client loaded on the first attach, so its transport and the generated
 * validators stay off the first render (Tactical 352).
 */
export interface DeferredApplicationClient {
  readonly load: () => Promise<ApplicationViewClient>;
  /** Whether the loaded client exports and imports torrent list bundles. */
  readonly torrentListBundles: boolean;
}

export interface LiveApplicationOptions extends ViewControllerOptions {
  readonly initialViews?: DesiredInspectionViews;
  readonly storagePolicy?: "portable" | "one_current_root";
}

export class LiveApplication implements InspectionApplication {
  readonly kind = "live" as const;
  readonly scenarios = [];

  private readonly listeners = new Set<(update: InspectionUpdate) => void>();
  private controller: ViewController | null = null;
  private desired: DesiredInspectionViews;
  private snapshot: InspectionSnapshot;
  private connection: SessionConnection = { type: "connecting" };
  private trackerClock: {
    readonly viewSetId: string;
    readonly epoch: string;
    readonly offsetMs: number;
  } | null = null;
  private mappedFiles: {
    readonly source: Extract<ViewSnapshot, { type: "files" }>;
    readonly value: FileSet;
  } | null = null;
  private mappedMedia: {
    readonly source: Extract<ViewSnapshot, { type: "media" }>;
    readonly value: MediaSet;
  } | null = null;
  private mappedPieces: MappedPieceActivity | null = null;
  private hello: ApiHello | null = null;
  // False after the connection drops, until hello is read again.
  private helloCurrent = false;
  private client: ApplicationViewClient | null;
  private readonly loadClient: () => Promise<ApplicationViewClient>;
  private closed = false;
  private readonly lifetime = new AbortController();
  private readonly requestInstanceId = generateRequestInstanceId();
  private requestSequence = 1;
  private removeWakeHints: (() => void) | null = null;
  // Settles once `hello` and the view set exist; rejects on close or stop.
  private readonly attached: Promise<void>;
  private settleAttached!: (error?: Error) => void;
  private attaching: Promise<void> | null = null;
  private attachWake: AbortController | null = null;
  readonly exportTorrentList: (() => Promise<boolean>) | undefined;
  readonly importTorrentBundle:
    | ((
        target: TorrentListImportTarget,
        chooseFile: () => Promise<ArrayBuffer | null>,
      ) => Promise<TorrentListImportReport | null>)
    | undefined;

  private constructor(
    source: ApplicationViewClient | DeferredApplicationClient,
    initialViews: DesiredInspectionViews,
    private readonly storagePolicy: "portable" | "one_current_root",
  ) {
    this.desired = initialViews;
    this.snapshot = emptyLiveSnapshot(initialViews, this.connection);
    this.attached = new Promise<void>((resolve, reject) => {
      this.settleAttached = (error) => (error === undefined ? resolve() : reject(error));
    });
    // Commands await this; an unawaited rejection is not a startup failure.
    this.attached.catch(() => {});
    let exportSupported: boolean;
    let importSupported: boolean;
    if ("load" in source) {
      this.client = null;
      this.loadClient = source.load;
      exportSupported = source.torrentListBundles;
      importSupported = source.torrentListBundles;
    } else {
      this.client = source;
      this.loadClient = async () => source;
      exportSupported = source.exportTorrentList !== undefined;
      importSupported = source.importTorrentBundle !== undefined;
    }
    this.exportTorrentList = !exportSupported
      ? undefined
      : async () => {
          const client = await this.attachedClient();
          if (client.exportTorrentList === undefined) {
            throw new Error(localizedMessage("inspection.live.live.application.live.controller.is.unavailable"));
          }
          return client.exportTorrentList(this.lifetime.signal);
        };
    this.importTorrentBundle = !importSupported
      ? undefined
      : async (target, chooseFile) => {
          const client = await this.attachedClient();
          if (client.importTorrentBundle === undefined) {
            throw new Error(localizedMessage("inspection.live.live.application.live.controller.is.unavailable"));
          }
          try {
            return await client.importTorrentBundle(
              target,
              chooseFile,
              this.lifetime.signal,
            );
          } finally {
            this.controller?.requestImmediatePoll();
          }
        };
  }

  /** Attaches before resolving and rejects if the first attempt fails. */
  static async open(
    client: ApplicationViewClient,
    options: LiveApplicationOptions = {},
  ): Promise<LiveApplication> {
    const application = LiveApplication.create(client, options);
    await application.attach(options);
    return application;
  }

  /**
   * Returns at once in `connecting` so a shell can render, then attaches in
   * the background. Failed attempts retry with backoff as `reconnecting`;
   * signed-out and contract failures stop.
   */
  static connect(
    client: ApplicationViewClient | DeferredApplicationClient,
    options: LiveApplicationOptions = {},
  ): LiveApplication {
    const application = LiveApplication.create(client, options);
    application.attaching = application.attachWithRetry(options);
    return application;
  }

  private static create(
    client: ApplicationViewClient | DeferredApplicationClient,
    options: LiveApplicationOptions,
  ): LiveApplication {
    return new LiveApplication(
      client,
      options.initialViews ?? {
        library: true,
        torrentId: null,
        detail: null,
        logCapture: null,
        speed: null,
      },
      options.storagePolicy ?? "portable",
    );
  }

  private async attach(options: ViewControllerOptions): Promise<void> {
    const [client, { ViewController }] = await Promise.all([
      this.client ?? this.loadClient(),
      import("../../view-controller"),
    ]);
    // Owned from here, so close() releases it even if this attach fails.
    this.client = client;
    markStartup("client_loaded");
    this.ensureOpen();
    this.hello = await client.hello(this.lifetime.signal);
    this.helloCurrent = true;
    markStartup("hello");
    this.ensureOpen();
    this.snapshot = withHost(this.snapshot, this.hello);
    const opened = { ...this.desired };
    const controller = await ViewController.open(
      client,
      this.viewSpecs(opened),
      (state) => this.acceptState(state),
      (error) => this.markStale(error),
      options,
      (status) => this.acceptStatus(status),
    );
    if (this.closed) {
      await controller.close().catch(() => {});
      throw new Error("live application closed");
    }
    this.controller = controller;
    markStartup("view_set_open");
    this.acceptStatus({ type: "connected" });
    this.settleAttached();
    if (!sameViews(opened, this.desired)) {
      await this.syncViews().catch(() => {});
    }
  }

  private async attachWithRetry(options: ViewControllerOptions): Promise<void> {
    const base = options.retryBaseMillis ?? 250;
    const maximum = options.retryMaximumMillis ?? 30_000;
    let retryMillis = base;
    let since: number | null = null;
    while (!this.closed) {
      try {
        await this.attach(options);
        return;
      } catch (error) {
        if (this.closed) return;
        const failure = asError(error);
        console.warn("JSTorrent could not connect to its library:", failure);
        const reason = viewStopReason(failure);
        if (reason !== null) {
          this.acceptStatus({ type: "stopped", reason });
          this.settleAttached(failure);
          return;
        }
        since ??= Date.now();
        const wake = new AbortController();
        this.attachWake = wake;
        this.acceptStatus({
          type: "retrying",
          since,
          nextAttemptAt: Date.now() + retryMillis,
        });
        await abortableDelay(retryMillis, this.lifetime.signal, wake.signal);
        if (this.attachWake === wake) this.attachWake = null;
        if (this.closed) return;
        this.acceptStatus({ type: "retrying", since, nextAttemptAt: null });
        retryMillis = Math.min(retryMillis * 2, maximum);
      }
    }
  }

  subscribe(listener: (update: InspectionUpdate) => void): () => void {
    this.ensureOpen();
    this.listeners.add(listener);
    listener({ type: "snapshot", snapshot: this.snapshot });
    return () => this.listeners.delete(listener);
  }

  async setViews(views: DesiredInspectionViews): Promise<void> {
    this.ensureOpen();
    if (sameViews(this.desired, views)) return;
    this.desired = { ...views };
    // Before attaching, the view set opens with the latest desired views.
    if (this.controller === null) return;
    await this.syncViews();
  }

  private async syncViews(): Promise<void> {
    const controller = this.controller;
    if (controller === null) return;
    const views = this.desired;
    this.snapshot = transitionSnapshot(
      this.snapshot,
      this.desired,
      this.capabilities(),
    );
    this.emit({ type: "snapshot", snapshot: this.snapshot });
    try {
      await controller.setViews(this.viewSpecs(views));
    } catch (error) {
      this.markStale(asError(error));
      throw error;
    }
  }

  async dispatch(command: InspectionCommand): Promise<CommandResult> {
    this.ensureOpen();
    // Commands issued while connecting wait. Once attached nothing awaits
    // here, so open_file keeps its user activation.
    if (this.controller === null) {
      try {
        await this.attached;
      } catch (error) {
        return { accepted: false, message: asError(error).message };
      }
    }
    const client = this.client;
    if (client === null) {
      return { accepted: false, message: localizedMessage("inspection.live.live.application.live.controller.is.unavailable") };
    }
    if (command.type === "open_file") {
      const createMediaUrl = client.createMediaUrl?.bind(client);
      const prepareMediaOpen = client.prepareMediaOpen?.bind(client);
      if (createMediaUrl === undefined || prepareMediaOpen === undefined) {
        return {
          accepted: false,
          message: localizedMessage("inspection.live.live.application.opening.files.is.unavailable.on.this.connection"),
        };
      }
      let target;
      try {
        target = prepareMediaOpen();
      } catch (error) {
        return { accepted: false, message: asError(error).message };
      }
      try {
        const response = await createMediaUrl(
          {
            torrent_id: command.torrentId,
            file_index: command.fileIndex,
          },
          this.lifetime.signal,
        );
        if (response.outcome.type === "unavailable") {
          target.cancel();
          return {
            accepted: false,
            message: mediaUnavailableMessage(response.outcome.reason),
          };
        }
        await target.open(response.outcome.url);
        return { accepted: true };
      } catch (error) {
        target.cancel();
        return { accepted: false, message: asError(error).message };
      }
    }
    if (command.type === "choose_download_root") {
      try {
        const root = await client.chooseDownloadRoot({
          ...(command.repairRoot === undefined
            ? {}
            : { repair_root: command.repairRoot }),
        });
        if (root === null) {
          return {
            accepted: true,
            storageRoot: null,
          };
        }
        const mapped = mapStorageRoot(root);
        const roots = this.snapshot.storage.roots.filter(
          (candidate) => candidate.id !== mapped.id,
        );
        this.snapshot = {
          ...this.snapshot,
          storage: {
            ...this.snapshot.storage,
            roots: [...roots, mapped],
            defaultRoot:
              this.storagePolicy === "one_current_root"
                ? mapped.id
                : (this.snapshot.storage.defaultRoot ?? mapped.id),
          },
        };
        this.emit({ type: "snapshot", snapshot: this.snapshot });
        return {
          accepted: true,
          storageRoot: mapped,
        };
      } catch (error) {
        return { accepted: false, message: asError(error).message };
      }
    }
    if (command.type === "add_torrent_bytes") {
      if (client.addTorrentBytes === undefined) {
        return {
          accepted: false,
          message: localizedMessage("inspection.live.live.application.torrent.file.upload.is.unavailable.on.this"),
        };
      }
      const request: AddTorrentBytesRequest = {
        version: 1,
        request_id: `web-${this.requestInstanceId}-${this.requestSequence++}`,
        storage_root: command.storageRoot,
        start_content: command.startContent,
        await_file_selection: command.awaitFileSelection ?? false,
        selection: { type: "all" },
        source_length: command.source.byteLength,
      };
      const response = await client.addTorrentBytes(
        request,
        command.source,
        this.lifetime.signal,
      );
      this.controller?.requestImmediatePoll();
      if (response.status === "error") {
        return { accepted: false, message: response.error.message };
      }
      this.snapshot = {
        ...this.snapshot,
        storage: mapStorage(response.snapshot.storage),
      };
      this.emit({ type: "snapshot", snapshot: this.snapshot });
      return addCommandResult(response);
    }
    if (command.type === "add_external_torrent") {
      if (client.addExternalTorrent === undefined) {
        return {
          accepted: false,
          message: localizedMessage("inspection.live.live.application.external.torrent.intake.is.unavailable.on.this"),
        };
      }
      const response = await client.addExternalTorrent(
        {
          activation_id: command.activationId,
          request_id: `desktop-${this.requestInstanceId}-${this.requestSequence++}`,
          storage_root: command.storageRoot,
          start_content: command.startContent,
          await_file_selection: command.awaitFileSelection ?? false,
        },
        this.lifetime.signal,
      );
      this.controller?.requestImmediatePoll();
      if (response.status === "error") {
        return { accepted: false, message: response.error.message };
      }
      this.snapshot = {
        ...this.snapshot,
        storage: mapStorage(response.snapshot.storage),
      };
      this.emit({ type: "snapshot", snapshot: this.snapshot });
      return addCommandResult(response);
    }
    if (
      command.type !== "add_magnet" &&
      command.type !== "set_file_priority" &&
      command.type !== "download_files" &&
      command.type !== "set_default_download_root" &&
      command.type !== "set_show_add_options" &&
      command.type !== "set_show_file_selection" &&
      command.type !== "confirm_pending_file_selection" &&
      command.type !== "download_all_pending_add" &&
      command.type !== "cancel_pending_add" &&
      command.type !== "update_client_settings" &&
      command.type !== "reset_client_settings" &&
      command.type !== "update_torrent_settings" &&
      command.type !== "remove_download_root" &&
      command.type !== "clear_app_data" &&
      command.type !== "export_magnet" &&
      command.type !== "pause" &&
      command.type !== "resume" &&
      command.type !== "move_download_to_top" &&
      command.type !== "move_download_to_bottom" &&
      command.type !== "force_recheck" &&
      command.type !== "archive" &&
      command.type !== "unarchive" &&
      command.type !== "remove"
    ) {
      return {
        accepted: false,
        message: localizedMessage("inspection.live.live.application.this.command.is.available.only.in.named"),
      };
    }
    if (
      (command.type === "update_client_settings" ||
        command.type === "update_torrent_settings") &&
      Object.keys(command.patch).length > 0 &&
      Object.keys(
        supportedPatch(
          command.patch,
          command.type === "update_client_settings"
            ? "client_settings"
            : "torrent_settings",
          this.capabilities(),
        ),
      ).length === 0
    ) {
      return {
        accepted: false,
        message: localizedMessage("inspection.live.live.application.setting.needs.newer.host"),
      };
    }
    const request: RequestEnvelope = {
      version: 1,
      request_id: `web-${this.requestInstanceId}-${this.requestSequence++}`,
      ...(command.type === "update_client_settings" ||
      command.type === "update_torrent_settings"
        ? { expected_revision: this.snapshot.durableRevision }
        : {}),
      command:
        command.type === "add_magnet"
          ? {
              type: "add_magnet",
              magnet: command.magnet,
              storage_root: command.storageRoot,
              start_content: command.startContent,
              await_file_selection: command.awaitFileSelection ?? false,
              skip_files: [],
            }
          : command.type === "set_file_priority"
            ? {
                type: "set_file_priority",
                torrent_id: command.torrentId,
                file_indices: [...command.fileIndices].sort(
                  (left, right) => left - right,
                ),
                priority: command.priority,
              }
            : command.type === "download_files"
              ? {
                  type: "download_files",
                  torrent_id: command.torrentId,
                  file_indices: [...command.fileIndices].sort(
                    (left, right) => left - right,
                  ),
                }
              : command.type === "set_default_download_root"
                ? {
                    type: "set_default_storage_root",
                    storage_root: command.rootId,
                  }
            : command.type === "set_show_add_options"
              ? { type: "set_show_add_options", show: command.show }
            : command.type === "set_show_file_selection"
              ? { type: "set_show_file_selection", show: command.show }
            : command.type === "confirm_pending_file_selection"
              ? {
                  type: "confirm_pending_file_selection",
                  torrent_id: command.torrentId,
                  catalog_id: command.catalogId,
                  base: command.base,
                  overrides: command.overrides.map((entry) => ({
                    range: {
                      start: entry.start,
                      end_exclusive: entry.endExclusive,
                    },
                    selected: entry.selected,
                  })),
                  disable_future: command.disableFuture,
                }
            : command.type === "download_all_pending_add"
              ? {
                  type: "download_all_pending_add",
                  torrent_id: command.torrentId,
                  disable_future: command.disableFuture,
                }
            : command.type === "cancel_pending_add"
              ? {
                  type: "cancel_pending_add",
                  torrent_id: command.torrentId,
                }
              : command.type === "update_client_settings"
                ? {
                    type: "update_client_settings",
                    patch: supportedPatch(
                      command.patch,
                      "client_settings",
                      this.capabilities(),
                    ),
                  }
              : command.type === "reset_client_settings"
                ? { type: "reset_client_settings" }
              : command.type === "update_torrent_settings"
                ? {
                    type: "update_torrent_settings",
                    torrent_id: command.torrentId,
                    patch: supportedPatch(
                      command.patch,
                      "torrent_settings",
                      this.capabilities(),
                    ),
                  }
              : command.type === "remove_download_root"
                ? {
                    type: "remove_storage_root",
                    storage_root: command.rootId,
                  }
                : command.type === "clear_app_data"
                  ? { type: "clear_app_data" }
                : command.type === "export_magnet"
                  ? {
                      type: "export_magnet",
                      torrent_id: command.torrentId,
                      ...(command.options === undefined
                        ? {}
                        : { options: magnetExportOptions(command.options) }),
                    }
                : command.type === "move_download_to_top" ||
                    command.type === "move_download_to_bottom"
                  ? {
                      type: command.type,
                      torrent_id: command.torrentId,
                    }
                : command.type === "remove"
                  ? {
                      type: "remove_torrent",
                      torrent_id: command.torrentId,
                      data: command.deleteData ? "delete_data" : "keep",
                    }
                  : {
                      type:
                        command.type === "unarchive"
                          ? "restore_archive"
                          : command.type,
                      torrent_id: command.torrentId,
                    },
    };
    let response;
    try {
      response = await this.controller?.dispatch({
        ...request,
        command: supportedCommand(request.command, this.capabilities()),
      });
    } catch (error) {
      // A host may refuse one call, for example a command it predates,
      // without closing the connection.
      if (error instanceof ApplicationViewError && error.code === "invalid_call") {
        return {
          accepted: false,
          message:
            error.detail === UNSUPPORTED_CALL_MESSAGE
              ? localizedMessage("inspection.live.live.application.request.needs.newer.host")
              : error.detail,
        };
      }
      throw error;
    }
    if (response === undefined) {
      return { accepted: false, message: localizedMessage("inspection.live.live.application.live.controller.is.unavailable") };
    }
    if (response.status === "error") {
      return {
        accepted: false,
        message: response.error.message,
        code: response.error.code,
      };
    }
    if (command.type === "export_magnet") {
      return magnetCommandResult(response);
    }
    if (
      command.type === "update_client_settings" ||
      command.type === "update_torrent_settings"
    ) {
      this.controller?.requestImmediatePoll();
    }
    this.snapshot = {
      ...this.snapshot,
      storage: mapStorage(response.snapshot.storage),
    };
    this.emit({ type: "snapshot", snapshot: this.snapshot });
    if (command.type === "add_magnet") {
      return addCommandResult(response);
    }
    return {
      accepted: true,
      ...(command.type === "update_client_settings" ||
      command.type === "update_torrent_settings"
        ? {
            requestId: response.request_id,
            resultingRevision: response.revision,
          }
        : {}),
    };
  }

  requestImmediatePoll(): void {
    if (this.closed) return;
    this.attachWake?.abort("immediate attach requested");
    this.controller?.requestImmediatePoll();
  }

  reconnectNow(): void {
    this.requestImmediatePoll();
  }

  installBrowserWakeHints(targetWindow: Window, targetDocument: Document): void {
    this.ensureOpen();
    this.removeWakeHints?.();
    const wake = () => this.requestImmediatePoll();
    const visibility = () => {
      if (targetDocument.visibilityState === "visible") wake();
    };
    targetWindow.addEventListener("online", wake);
    targetWindow.addEventListener("pageshow", wake);
    targetDocument.addEventListener("visibilitychange", visibility);
    this.removeWakeHints = () => {
      targetWindow.removeEventListener("online", wake);
      targetWindow.removeEventListener("pageshow", wake);
      targetDocument.removeEventListener("visibilitychange", visibility);
    };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.lifetime.abort("live application closed");
    this.removeWakeHints?.();
    this.removeWakeHints = null;
    this.listeners.clear();
    this.settleAttached(new Error("live application closed"));
    await this.attaching?.catch(() => {});
    await this.controller?.close();
    await this.client?.close();
  }

  private acceptState(state: ViewSetState): void {
    if (this.closed) return;
    if (
      this.trackerClock?.viewSetId !== state.viewSetId ||
      this.trackerClock.epoch !== state.epoch
    ) {
      // One clock translation per epoch: retained/partial updates cannot move deadlines.
      this.trackerClock = {
        viewSetId: state.viewSetId,
        epoch: state.epoch,
        offsetMs: performance.now() - safeNumber(state.serverNowMillis),
      };
    }
    const files = projection(state, FILES_VIEW_ID, "files");
    const fileSet = this.mapFiles(files);
    const media = projection(state, MEDIA_VIEW_ID, "media");
    const mediaSet = this.mapMedia(media);
    const pieces = projection(state, PIECES_VIEW_ID, "piece_activity");
    const pieceSet = this.mapPieces(pieces, state.epoch);
    if (state.views[LIBRARY_VIEW_ID] !== undefined) markStartup("first_library");
    this.snapshot = mapViewState(
      state,
      this.desired,
      this.capabilities(),
      this.connection,
      fileSet,
      mediaSet,
      pieceSet,
      this.snapshot.storage,
      this.snapshot.clientSettings,
      this.trackerClock.offsetMs,
    );
    this.snapshot = withHost(this.snapshot, this.hello);
    this.emit({ type: "snapshot", snapshot: this.snapshot });
  }

  private mapPieces(
    source: Extract<ViewSnapshot, { type: "piece_activity" }> | null,
    epoch: string,
  ): PieceMapSet | null {
    if (source === null) {
      this.mappedPieces = null;
      return null;
    }
    if (this.mappedPieces?.source === source && this.mappedPieces.epoch === epoch) {
      return this.mappedPieces.value;
    }
    const value = mapPieceActivity(source, this.mappedPieces, epoch);
    this.mappedPieces = { source, value, epoch };
    return value;
  }

  private mapFiles(
    source: Extract<ViewSnapshot, { type: "files" }> | null,
  ): FileSet | null {
    if (source === null) {
      this.mappedFiles = null;
      return null;
    }
    if (this.mappedFiles?.source === source) return this.mappedFiles.value;
    const value = mapFiles(source, this.mappedFiles);
    this.mappedFiles = { source, value };
    return value;
  }

  private mapMedia(
    source: Extract<ViewSnapshot, { type: "media" }> | null,
  ): MediaSet | null {
    if (source === null) {
      this.mappedMedia = null;
      return null;
    }
    if (this.mappedMedia?.source === source) return this.mappedMedia.value;
    const rows = source.items.map((item) => mapMediaItem(source.torrent_id, item));
    const value: MediaSet = {
      state: source.state,
      totalNonPaddingFiles: source.total_non_padding_files,
      order: rows.map((row) => row.id),
      rows: Object.fromEntries(rows.map((row) => [row.id, row])),
    };
    this.mappedMedia = { source, value };
    return value;
  }

  private acceptStatus(status: ViewConnectionStatus): void {
    if (this.closed) return;
    if (status.type === "retrying") this.helloCurrent = false;
    // A host can restart with another version or capabilities while the
    // view set reconnects, so read its hello again.
    if (status.type === "connected" && !this.helloCurrent && this.controller !== null) {
      this.helloCurrent = true;
      void this.refreshHello();
    }
    this.connection =
      status.type === "retrying"
        ? {
            type: "reconnecting",
            since: status.since,
            nextAttemptAt: status.nextAttemptAt,
          }
        : status;
    this.snapshot = {
      ...this.snapshot,
      session: { ...this.snapshot.session, connection: this.connection },
    };
    this.emit({ type: "snapshot", snapshot: this.snapshot });
  }

  private async refreshHello(): Promise<void> {
    const client = this.client;
    if (client === null) return;
    let hello: ApiHello;
    try {
      hello = await client.hello(this.lifetime.signal);
    } catch (error) {
      if (this.closed) return;
      this.helloCurrent = false;
      console.warn("JSTorrent could not refresh its host facts:", asError(error));
      return;
    }
    if (this.closed) return;
    const capabilitiesChanged = !sameStrings(this.hello?.capabilities ?? [], hello.capabilities);
    this.hello = hello;
    this.snapshot = withHost(this.snapshot, hello);
    this.emit({ type: "snapshot", snapshot: this.snapshot });
    if (capabilitiesChanged) await this.syncViews().catch(() => {});
  }

  private markStale(error: Error): void {
    if (this.closed) return;
    this.snapshot = {
      ...this.snapshot,
      viewStatus: {
        library: staleIfMaterialized(this.snapshot.viewStatus.library, error),
        torrentSummary: staleIfMaterialized(
          this.snapshot.viewStatus.torrentSummary,
          error,
        ),
        peers: staleIfMaterialized(this.snapshot.viewStatus.peers, error),
        swarm: staleIfMaterialized(this.snapshot.viewStatus.swarm, error),
        files: staleIfMaterialized(this.snapshot.viewStatus.files, error),
        media: staleIfMaterialized(this.snapshot.viewStatus.media, error),
        trackers: staleIfMaterialized(
          this.snapshot.viewStatus.trackers,
          error,
        ),
        pieces: staleIfMaterialized(this.snapshot.viewStatus.pieces, error),
        disk: staleIfMaterialized(this.snapshot.viewStatus.disk, error),
        dht: staleIfMaterialized(this.snapshot.viewStatus.dht, error),
        logs: staleIfMaterialized(this.snapshot.viewStatus.logs, error),
        speed: staleIfMaterialized(this.snapshot.viewStatus.speed, error),
      },
    };
    this.emit({ type: "snapshot", snapshot: this.snapshot });
  }

  private async attachedClient(): Promise<ApplicationViewClient> {
    this.ensureOpen();
    await this.attached;
    const client = this.client;
    if (client === null) {
      throw new Error(localizedMessage("inspection.live.live.application.live.controller.is.unavailable"));
    }
    return client;
  }

  private capabilities(): ReadonlySet<string> {
    return new Set(this.hello?.capabilities ?? []);
  }

  private viewSpecs(views: DesiredInspectionViews): ViewSpec[] {
    const capabilities = this.capabilities();
    const specs: ViewSpec[] = [];
    const selectedSpeedMetrics = views.speed?.metrics ?? DEFAULT_SPEED_METRICS;
    if (views.library && capabilities.has("torrent_list")) {
      specs.push({
        type: "torrent_list",
        view_id: LIBRARY_VIEW_ID,
        delivery: { min_interval_millis: 100 },
      });
    }
    if (views.torrentId !== null && capabilities.has("torrent_summary")) {
      specs.push({
        type: "torrent_summary",
        view_id: SUMMARY_VIEW_ID,
        torrent_id: views.torrentId,
        delivery: { min_interval_millis: 100 },
      });
    }
    if (
      views.detail === "general" &&
      views.torrentId !== null &&
      capabilities.has("torrent_preparation")
    ) {
      specs.push({
        type: "torrent_preparation",
        view_id: PREPARATION_VIEW_ID,
        torrent_id: views.torrentId,
        delivery: { min_interval_millis: 100 },
      });
    }
    if (
      views.detail === "peers" &&
      views.torrentId !== null &&
      capabilities.has("torrent_peers")
    ) {
      specs.push({
        type: "torrent_peers",
        view_id: PEERS_VIEW_ID,
        torrent_id: views.torrentId,
        delivery: { min_interval_millis: 100 },
      });
    }
    if (
      wantsSwarm(views.detail) &&
      views.torrentId !== null &&
      capabilities.has("torrent_swarm")
    ) {
      specs.push({
        type: "torrent_swarm",
        view_id: SWARM_VIEW_ID,
        torrent_id: views.torrentId,
        delivery: { min_interval_millis: views.detail === "swarm" ? 100 : 1_000 },
      });
    }
    if (
      views.detail === "trackers" &&
      views.torrentId !== null &&
      capabilities.has("torrent_trackers")
    ) {
      specs.push({
        type: "torrent_trackers",
        view_id: TRACKERS_VIEW_ID,
        torrent_id: views.torrentId,
        delivery: { min_interval_millis: 250 },
      });
    }
    if (
      views.detail === "files" &&
      views.torrentId !== null &&
      capabilities.has("torrent_files")
    ) {
      specs.push({
        type: "torrent_files",
        view_id: FILES_VIEW_ID,
        torrent_id: views.torrentId,
        page: { offset: views.filePageOffset ?? 0, limit: 1_024 },
        delivery: { min_interval_millis: 250 },
      });
    }
    if (
      views.detail === "media" &&
      views.torrentId !== null &&
      capabilities.has("torrent_media")
    ) {
      specs.push({
        type: "torrent_media",
        view_id: MEDIA_VIEW_ID,
        torrent_id: views.torrentId,
        delivery: { min_interval_millis: 250 },
      });
    }
    if (
      views.detail === "pieces" &&
      views.torrentId !== null &&
      capabilities.has("piece_activity")
    ) {
      specs.push({
        type: "piece_activity",
        view_id: PIECES_VIEW_ID,
        torrent_id: views.torrentId,
        delivery: { min_interval_millis: 100 },
      });
    }
    if (views.detail === "disk" && capabilities.has("session_disk")) {
      specs.push({
        type: "session_disk",
        view_id: DISK_VIEW_ID,
        delivery: { min_interval_millis: 100 },
      });
    }
    if (wantsDht(views.detail) && capabilities.has("session_dht")) {
      specs.push({
        type: "session_dht",
        view_id: DHT_VIEW_ID,
        delivery: { min_interval_millis: views.detail === "dht" ? 500 : 1_000 },
      });
    }
    if (
      views.detail === "speed" &&
      capabilities.has("session_speed_history")
    ) {
      const range = views.speed?.range ?? "seconds30";
      specs.push({
        type: "session_speed_history",
        view_id: SPEED_VIEW_ID,
        range,
        metrics: [...selectedSpeedMetrics],
        delivery: {
          min_interval_millis:
            range === "seconds30" ? 100 : range === "minutes2" ? 500 : 1_000,
        },
      });
    }
    if (views.detail === "logs" && capabilities.has("diagnostics")) {
      const capture = views.logCapture ?? {
        profile: "normal" as const,
        torrentId: null,
      };
      specs.push({
        type: "diagnostics",
        view_id: LOGS_VIEW_ID,
        torrent_id: capture.torrentId,
        filter: {
          profile: capture.profile,
          minimum_severity:
            capture.profile === "trace"
              ? "trace"
              : capture.profile === "detailed"
                ? "debug"
                : "info",
          categories: [],
        },
        delivery: { min_interval_millis: 100 },
      });
    }
    if (capabilities.has("session_current_rates")) {
      const currentMetrics = new Set<SpeedMetric>([
        "payload_received",
        "payload_uploaded",
      ]);
      if (views.detail === "speed") {
        selectedSpeedMetrics.forEach((metric) => currentMetrics.add(metric));
      }
      specs.push({
        type: "session_current_rates",
        view_id: SESSION_RATES_VIEW_ID,
        metrics: [...currentMetrics],
        delivery: { min_interval_millis: 1_000 },
      });
    }
    // Rust view sets intentionally require at least one view. A detail-only
    // unsupported state keeps the selected summary as navigation context.
    if (specs.length === 0 && capabilities.has("torrent_list")) {
      specs.push({
        type: "torrent_list",
        view_id: LIBRARY_VIEW_ID,
        delivery: { min_interval_millis: 100 },
      });
    }
    return specs;
  }

  private emit(update: InspectionUpdate): void {
    for (const listener of this.listeners) listener(update);
  }

  private ensureOpen(): void {
    if (this.closed) throw new Error("live inspection application is closed");
  }
}

function addCommandResult(response: ResponseEnvelope): CommandResult {
  const result = response.result;
  if (result?.type !== "add_torrent") {
    return { accepted: true };
  }
  const disposition = result.result.disposition;
  if (disposition.type === "already_present") {
    return {
      accepted: true,
      torrentId: result.result.torrent_id,
      addDisposition: { type: "already_present" },
    };
  }
  if (disposition.type === "selection_expanded") {
    const count = disposition.newly_wanted_count;
    return {
      accepted: true,
      torrentId: result.result.torrent_id,
      addDisposition: {
        type: "selection_expanded",
        ...(count === undefined ? {} : { newlyWantedCount: count }),
      },
    };
  }
  return {
    accepted: true,
    torrentId: result.result.torrent_id,
    addDisposition: { type: "added" },
  };
}

function magnetCommandResult(response: ResponseEnvelope): CommandResult {
  const result = response.result;
  if (result?.type !== "export_magnet") {
    return {
      accepted: false,
      message: localizedMessage("inspection.live.live.application.magnet.export.response.did.not.contain.a"),
    };
  }
  return {
    accepted: true,
    magnetExport: {
      magnet: result.result.magnet,
      source: result.result.source,
      omittedTrackerCount: result.result.omitted_tracker_count,
      ...(result.result.peer_hints === undefined
        ? {}
        : { peerHints: result.result.peer_hints }),
      ...(result.result.peer_hint_omission == null
        ? {}
        : { peerHintOmission: result.result.peer_hint_omission }),
    },
  };
}

function magnetExportOptions(options: MagnetShareOptions): MagnetExportOptions {
  return {
    ...(options.includeSize === true ? { include_size: true } : {}),
    ...(options.fileIndices === undefined || options.fileIndices.length === 0
      ? {}
      : { file_indices: [...options.fileIndices] }),
    ...(options.peerHint === true ? { peer_hint: true } : {}),
  };
}

function withHost(snapshot: InspectionSnapshot, hello: ApiHello | null): InspectionSnapshot {
  const host = hello?.product ?? null;
  const hostCapabilities = hello?.capabilities ?? null;
  if (
    (snapshot.session.host ?? null) === host &&
    (snapshot.session.hostCapabilities ?? null) === hostCapabilities
  ) {
    return snapshot;
  }
  return { ...snapshot, session: { ...snapshot.session, host, hostCapabilities } };
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function mapViewState(
  state: ViewSetState,
  desired: DesiredInspectionViews,
  capabilities: ReadonlySet<string>,
  connection: SessionConnection,
  fileSet: FileSet | null,
  mediaSet: MediaSet | null,
  pieceSet: PieceMapSet | null,
  previousStorage: DownloadStorageSettings,
  previousClientSettings: ClientSettingsRuntimeView,
  trackerClockOffsetMs: number,
): InspectionSnapshot {
  const library = projection(state, LIBRARY_VIEW_ID, "torrent_list");
  const summary = projection(state, SUMMARY_VIEW_ID, "torrent");
  const preparation = projection(
    state,
    PREPARATION_VIEW_ID,
    "torrent_preparation",
  );
  const peers = projection(state, PEERS_VIEW_ID, "peers");
  const swarm = projection(state, SWARM_VIEW_ID, "swarm");
  const files = projection(state, FILES_VIEW_ID, "files");
  const media = projection(state, MEDIA_VIEW_ID, "media");
  const trackers = projection(state, TRACKERS_VIEW_ID, "trackers");
  const pieces = projection(state, PIECES_VIEW_ID, "piece_activity");
  const disk = projection(state, DISK_VIEW_ID, "session_disk");
  const dht = projection(state, DHT_VIEW_ID, "session_dht");
  const speed = projection(state, SPEED_VIEW_ID, "session_speed_history");
  const sessionRates = projection(
    state,
    SESSION_RATES_VIEW_ID,
    "session_current_rates",
  );
  const diagnostics = projection(state, LOGS_VIEW_ID, "diagnostics");
  const torrentRows = new Map<string, TorrentRow>();
  if (library !== null) {
    for (const torrent of library.torrents) {
      torrentRows.set(torrent.torrent_id, mapTorrent(torrent));
    }
  }
  if (summary?.torrent !== null && summary?.torrent !== undefined) {
    const torrent = mapTorrent(summary.torrent);
    torrentRows.set(
      summary.torrent.torrent_id,
      preparation?.torrent_id === summary.torrent.torrent_id
        ? { ...torrent, preparation: mapPreparation(preparation.preparation) }
        : torrent,
    );
  }
  const peerSet = peers === null ? null : mapPeers(peers.peers);
  const logs = diagnostics?.events.map(mapLog) ?? [];
  const torrents = Object.fromEntries(torrentRows);
  const torrentOrder = library?.torrents.map((torrent) => torrent.torrent_id) ?? [];
  const peersByTorrent =
    peerSet === null || desired.torrentId === null || peers?.torrent_id !== desired.torrentId
      ? {}
      : { [desired.torrentId]: peerSet };
  const swarmSet = swarm === null ? null : mapSwarm(swarm);
  const swarmByTorrent =
    swarmSet === null || desired.torrentId === null || swarm?.torrent_id !== desired.torrentId
      ? {}
      : { [desired.torrentId]: swarmSet };
  const filesByTorrent =
    fileSet === null || desired.torrentId === null || files?.torrent_id !== desired.torrentId
      ? {}
      : { [desired.torrentId]: fileSet };
  const mediaByTorrent =
    mediaSet === null ||
    desired.torrentId === null ||
    media?.torrent_id !== desired.torrentId
      ? {}
      : { [desired.torrentId]: mediaSet };
  const trackerSet = trackers === null
    ? null
    : mapTrackers(trackers, trackerClockOffsetMs);
  const trackersByTorrent =
    trackerSet === null ||
    desired.torrentId === null ||
    trackers?.torrent_id !== desired.torrentId
      ? {}
      : {
          [desired.torrentId]: {
            ...trackerSet,
            state: trackers.state,
          },
        };
  const piecesByTorrent =
    pieceSet === null ||
    desired.torrentId === null ||
    pieces?.torrent_id !== desired.torrentId
      ? {}
      : { [desired.torrentId]: pieceSet };
  const rows = [...torrentRows.values()];
  const speedDownloadRate = currentSpeedRate(
    sessionRates?.rates,
    "payload_received",
  );
  const speedUploadRate = currentSpeedRate(
    sessionRates?.rates,
    "payload_uploaded",
  );
  return {
    revision: safeNumber(state.durableRevision),
    durableRevision: state.durableRevision,
    session: {
      connection,
      downloadRate: speedDownloadRate === null
        ? rows.reduce((total, row) => total + row.downloadRate, 0)
        : speedDownloadRate,
      uploadRate: speedUploadRate,
      dhtNodes: dht?.inspection.families.reduce(
        (total, family) => total + family.routing_nodes,
        0,
      ) ?? null,
      knownPeers: null,
    },
    demo: null,
    storage: library === null ? previousStorage : mapStorage(library.storage),
    clientSettings:
      library === null ? previousClientSettings : library.client_settings,
    torrentOrder,
    torrents,
    peersByTorrent,
    swarmByTorrent,
    filesByTorrent,
    mediaByTorrent,
    trackersByTorrent,
    piecesByTorrent,
    disk: disk === null ? emptyDiskSet() : mapDisk(disk),
    dht: dht?.inspection ?? null,
    speed:
      speed === null
        ? null
        : mapSpeedHistory(speed.history, sessionRates?.rates),
    logs,
    logLoss: {
      sourceEvictedCount:
        diagnostics === null
          ? 0
          : safeNumber(diagnostics.retention.source_evicted_count),
      retainedFromSequence:
        diagnostics?.retention.retained_from_sequence ?? "1",
      localEvictedCount: 0,
      deliveryResetCount: state.deliveryResetCount,
      lastDeliveryResetReason: state.lastDeliveryResetReason,
    },
    viewStatus: {
      library: materialization(
        desired.library,
        capabilities.has("torrent_list"),
        library !== null,
        "Torrent library is unavailable",
      ),
      torrentSummary: materialization(
        desired.torrentId !== null,
        capabilities.has("torrent_summary"),
        summary !== null,
        "Torrent summary is unavailable",
      ),
      peers: materialization(
        desired.detail === "peers",
        capabilities.has("torrent_peers"),
        peers?.torrent_id === desired.torrentId,
        "Peer inspection is unavailable",
      ),
      swarm: materialization(
        wantsSwarm(desired.detail),
        capabilities.has("torrent_swarm"),
        swarm?.torrent_id === desired.torrentId,
        "Swarm inspection is unavailable",
      ),
      files: materialization(
        desired.detail === "files",
        capabilities.has("torrent_files"),
        files?.torrent_id === desired.torrentId,
        "File inspection is unavailable",
      ),
      media: materialization(
        desired.detail === "media",
        capabilities.has("torrent_media"),
        media?.torrent_id === desired.torrentId,
        "Media details are unavailable",
      ),
      trackers: materialization(
        desired.detail === "trackers",
        capabilities.has("torrent_trackers"),
        trackers?.torrent_id === desired.torrentId,
        "Tracker inspection is unavailable",
      ),
      pieces: materialization(
        desired.detail === "pieces",
        capabilities.has("piece_activity"),
        pieces?.torrent_id === desired.torrentId,
        "Piece inspection is unavailable",
      ),
      disk: materialization(
        desired.detail === "disk",
        capabilities.has("session_disk"),
        disk !== null,
        "Disk inspection is unavailable",
      ),
      dht: materialization(
        wantsDht(desired.detail),
        capabilities.has("session_dht"),
        dht !== null,
        "DHT inspection is unavailable",
      ),
      speed: materialization(
        desired.detail === "speed",
        capabilities.has("session_speed_history"),
        speed !== null,
        "Speed history is unavailable",
      ),
      logs: materialization(
        desired.detail === "logs",
        capabilities.has("diagnostics"),
        diagnostics !== null,
        "Diagnostic logs are unavailable",
      ),
    },
  };
}

function currentSpeedRate(
  current: SessionCurrentRatesView | undefined,
  metric: SpeedMetric,
): number | null {
  const value = current?.rates.find((rate) => rate.metric === metric)?.bytes;
  return value === null || value === undefined ? null : safeNumber(value);
}

function mapSpeedHistory(
  history: SpeedHistoryView,
  current: SessionCurrentRatesView | undefined,
): SpeedInspectionView {
  const currentByMetric = new Map(
    current?.rates.map((rate) => [rate.metric, rate.bytes] as const) ?? [],
  );
  return {
    ...history,
    current: current?.rates ?? [],
    series: history.series.map((series) => ({
      ...series,
      current_rate_bytes: currentByMetric.get(series.metric) ?? null,
    })),
  };
}

function projection<T extends ViewSnapshot["type"]>(
  state: ViewSetState,
  viewId: string,
  type: T,
): Extract<ViewSnapshot, { type: T }> | null {
  const view = state.views[viewId];
  return view?.type === type
    ? (view as Extract<ViewSnapshot, { type: T }>)
    : null;
}

function materialization(
  requested: boolean,
  supported: boolean,
  present: boolean,
  unavailableReason: string,
): ViewMaterialization {
  if (!requested) return { status: "not_requested" };
  if (!supported) {
    return { status: "unsupported", reason: unavailableReason };
  }
  if (present) return { status: "ready" };
  return { status: "loading" };
}

function transitionSnapshot(
  current: InspectionSnapshot,
  desired: DesiredInspectionViews,
  capabilities: ReadonlySet<string>,
): InspectionSnapshot {
  const selected =
    desired.torrentId === null ? undefined : current.torrents[desired.torrentId];
  const libraryRows = desired.library
    ? current.torrentOrder
        .map((id) => current.torrents[id])
        .filter((row): row is TorrentRow => row !== undefined)
    : [];
  const rows = new Map(libraryRows.map((row) => [row.id, row]));
  if (selected !== undefined) rows.set(selected.id, selected);
  return {
    ...current,
    torrentOrder: desired.library ? libraryRows.map((row) => row.id) : [],
    torrents: Object.fromEntries(rows),
    peersByTorrent: {},
    swarmByTorrent: {},
    filesByTorrent: {},
    mediaByTorrent: {},
    trackersByTorrent: {},
    piecesByTorrent: {},
    disk: current.disk,
    dht: current.dht,
    speed: current.speed,
    logs: [],
    logLoss: {
      ...current.logLoss,
      localEvictedCount: 0,
    },
    viewStatus: {
      library: transitionStatus(
        desired.library,
        capabilities.has("torrent_list"),
        current.viewStatus.library,
      ),
      torrentSummary: transitionStatus(
        desired.torrentId !== null,
        capabilities.has("torrent_summary"),
      ),
      peers: transitionStatus(
        desired.detail === "peers",
        capabilities.has("torrent_peers"),
      ),
      swarm: transitionStatus(
        wantsSwarm(desired.detail),
        capabilities.has("torrent_swarm"),
      ),
      files: transitionStatus(
        desired.detail === "files",
        capabilities.has("torrent_files"),
      ),
      media: transitionStatus(
        desired.detail === "media",
        capabilities.has("torrent_media"),
      ),
      trackers: transitionStatus(
        desired.detail === "trackers",
        capabilities.has("torrent_trackers"),
      ),
      pieces: transitionStatus(
        desired.detail === "pieces",
        capabilities.has("piece_activity"),
      ),
      disk: transitionStatus(
        desired.detail === "disk",
        capabilities.has("session_disk"),
        current.viewStatus.disk,
      ),
      dht: transitionStatus(
        wantsDht(desired.detail),
        capabilities.has("session_dht"),
        current.viewStatus.dht,
      ),
      speed: transitionStatus(
        desired.detail === "speed",
        capabilities.has("session_speed_history") &&
          capabilities.has("session_current_rates"),
        current.viewStatus.speed,
      ),
      logs: transitionStatus(
        desired.detail === "logs",
        capabilities.has("diagnostics"),
      ),
    },
  };
}

function transitionStatus(
  requested: boolean,
  supported: boolean,
  retained?: ViewMaterialization,
): ViewMaterialization {
  if (!requested) return { status: "not_requested" };
  if (!supported) return { status: "unsupported", reason: localizedMessage("inspection.live.live.application.view.is.unsupported") };
  if (retained?.status === "ready" || retained?.status === "stale") return retained;
  return { status: "loading" };
}

function mapTorrent(torrent: TorrentView): TorrentRow {
  const pieceCount = torrent.piece_count;
  const infoHash =
    torrent.protocol_identities.v1 ?? torrent.protocol_identities.v2;
  if (infoHash == null) {
    throw new Error("torrent has no protocol identity");
  }
  return {
    id: torrent.torrent_id,
    storageRoot: torrent.storage_root,
    name:
      torrent.display_name ??
      torrent.source_display_name ??
      `Torrent ${torrent.torrent_id.slice(0, 12)}`,
    status: mapTorrentState(torrent.state, torrent.progress),
    operationalState: torrent.operational_state,
    queuePosition: torrent.download_queue_position ?? null,
    transferLimits: torrent.transfer_limits,
    sizeBytes:
      torrent.total_size_bytes === null
        ? null
        : safeNumber(torrent.total_size_bytes),
    sourceSizeBytes:
      torrent.source_size_bytes === undefined ||
      torrent.source_size_bytes === null
        ? null
        : safeNumber(torrent.source_size_bytes),
    progress:
      pieceCount === 0 ? null : torrent.verified_piece_count / pieceCount,
    checking:
      torrent.checking === undefined || torrent.checking === null
        ? null
        : mapCheckingProgress(torrent.checking),
    downloadRate: safeNumber(torrent.payload_download_rate_bytes),
    uploadRate: null,
    downloadedBytes: safeNumber(torrent.received_bytes),
    uploadedBytes: null,
    peersConnected: torrent.active_peer_connections,
    peersKnown: null,
    configuredTrackerCount: torrent.configured_tracker_count ?? null,
    requiredPayloadBytes: torrent.required_payload_bytes,
    remainingPayloadBytes: torrent.remaining_payload_bytes,
    etaDownloadRateBytes: torrent.eta_payload_download_rate_bytes,
    eta: mapTorrentEta(torrent.eta),
    lifetimeUploadedBytes: torrent.lifetime.uploaded_payload_bytes,
    lifetimeDownloadedBytes: torrent.lifetime.downloaded_payload_bytes,
    activeSeconds: torrent.lifetime.active_seconds,
    finishedSeconds: torrent.lifetime.finished_seconds,
    seedingSeconds: torrent.lifetime.seeding_seconds,
    shareRatioHundredths: torrent.lifetime.share_ratio_hundredths,
    seedAdmission: torrent.seeding.admission,
    seedGoal: torrent.seeding.goal ?? null,
    seedStop: torrent.seeding.stop ?? null,
    addedAtMs: null,
    archived: torrent.archived,
    removalState: torrent.removal_state ?? null,
    deleteDataSupported: torrent.delete_data_supported,
    forceRecheckAvailable: torrent.force_recheck_available,
    privateTorrent: torrent.private_torrent ?? false,
    awaitingFileSelection: torrent.awaiting_file_selection,
    pendingFileSelectionPosition:
      torrent.pending_file_selection_position ?? null,
    fileCatalogId: torrent.file_catalog_id ?? null,
    selectableFileCount: torrent.selectable_file_count,
    selectedFileCount: torrent.selected_file_count,
    selectableFileBytes: torrent.selectable_file_bytes,
    selectedFileBytes: torrent.selected_file_bytes,
    infoHash,
    protocolIdentities: torrent.protocol_identities,
    error: torrent.error ?? null,
    progressReason: torrent.progress.reason.replaceAll("_", " "),
  };
}

function mapPreparation(
  preparation: TorrentPreparationView | null,
): TorrentPreparation | null {
  if (preparation === null) return null;
  const metadata = preparation.metadata ?? null;
  return {
    generation: preparation.generation,
    metadata:
      metadata === null
        ? null
        : {
            phase: metadata.phase,
            totalSizeBytes:
              metadata.total_size_bytes === undefined ||
              metadata.total_size_bytes === null
                ? null
                : safeNumber(metadata.total_size_bytes),
            receivedBytes: safeNumber(metadata.received_bytes),
            blockCount: metadata.block_count,
            blockStates: Uint8Array.from(atob(metadata.block_states), (byte) =>
              byte.charCodeAt(0),
            ),
            activePeers: metadata.active_peers,
            requestsInFlight: metadata.requests_in_flight,
            hashRetries: metadata.hash_retries,
          },
    integrity:
      preparation.integrity === undefined || preparation.integrity === null
        ? null
        : {
            phase: preparation.integrity.phase,
            neededHashRanges: preparation.integrity.needed_hash_ranges,
            activeRequests: preparation.integrity.active_requests,
          },
  };
}

function mapCheckingProgress(
  checking: CheckingProgressView,
): TorrentCheckingProgress {
  return {
    generation: checking.generation,
    phase: checking.phase,
    piecesTotal: checking.pieces_total,
    piecesProcessed: checking.pieces_processed,
    piecesMatched: checking.pieces_matched,
    piecesAbsent: checking.pieces_absent,
    piecesMismatched: checking.pieces_mismatched,
    bytesHashed: checking.bytes_hashed,
    activeHashJobs: checking.active_hash_jobs,
    queuedHashJobs: checking.queued_hash_jobs,
    elapsedMs: safeNumber(checking.elapsed_millis),
    lastAdvanceAgeMs: safeNumber(checking.last_advance_age_millis),
    oldestActiveJobAgeMs: safeNullableNumber(
      checking.oldest_active_job_age_millis ?? null,
    ),
  };
}

function mapTorrentEta(eta: TorrentView["eta"]): TorrentRow["eta"] {
  if (eta.state !== "estimate") return eta;
  if (!/^[1-9][0-9]{0,19}$/.test(eta.seconds)) {
    return { state: "unavailable" };
  }
  return eta;
}

function mapStorage(settings: StorageSettingsSnapshot): DownloadStorageSettings {
  return {
    roots: settings.roots.map(mapStorageRoot),
    defaultRoot: settings.default_root ?? null,
    showAddOptions: settings.show_add_options,
    showFileSelection: settings.show_file_selection,
  };
}

function mapStorageRoot(root: StorageRootSnapshot): DownloadRoot {
  return {
    id: root.root_id,
    label: root.label,
    path: root.display_path ?? null,
    availability: root.availability,
  };
}

function mapTorrentState(
  state: TorrentState,
  progress: TorrentView["progress"],
): TorrentRow["status"] {
  switch (state) {
    case "awaiting_metadata":
      return "metadata";
    case "checking":
      return "checking";
    case "complete":
      return "complete";
    case "paused":
      return "paused";
    case "needs_repair":
    case "error":
      return "error";
    case "awaiting_storage":
      return progress.disposition === "blocked" ? "error" : "downloading";
    case "downloading":
      return "downloading";
  }
}

function generateRequestInstanceId(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function mapPeers(peers: readonly PeerView[]): PeerSet {
  const rows = peers.map(mapPeer);
  return {
    order: rows.map((peer) => peer.connectionId),
    rows: Object.fromEntries(rows.map((peer) => [peer.connectionId, peer])),
  };
}

function mapSwarm(
  snapshot: Extract<ViewSnapshot, { type: "swarm" }>,
): SwarmSet {
  const rows = snapshot.peers.map(mapSwarmPeer);
  return {
    state: snapshot.state,
    capturedMillis: safeNumber(snapshot.captured_millis),
    maximumRecords: snapshot.maximum_records,
    counts: { ...snapshot.counts },
    order: rows.map((peer) => peer.recordId),
    rows: Object.fromEntries(rows.map((peer) => [peer.recordId, peer])),
  };
}

function mapSwarmPeer(peer: SwarmPeerView): SwarmRow {
  return {
    recordId: peer.peer_record_id,
    torrentId: peer.torrent_id,
    endpoint: peer.endpoint,
    sources: peer.sources,
    state: peer.state,
    connectable: peer.connectable,
    firstObservedAgeMs: safeNumber(peer.first_observed_age_millis),
    lastObservedAgeMs: safeNumber(peer.last_observed_age_millis),
    retryInMs: safeNullableNumber(peer.retry_in_millis),
    dialAttempts: peer.dial_attempts,
    consecutiveFailures: peer.consecutive_failures,
    totalFailures: peer.total_failures,
    lastDialAgeMs: safeNullableNumber(peer.last_dial_age_millis),
    lastConnectedAgeMs: safeNullableNumber(peer.last_connected_age_millis),
    lastFailure: peer.last_failure,
    lastFailureAgeMs: safeNullableNumber(peer.last_failure_age_millis),
    payloadDownloadedBytes: peer.payload_downloaded_bytes,
    payloadUploadedBytes: peer.payload_uploaded_bytes,
    trustPoints: peer.trust_points,
    hashFailures: peer.hash_failures,
    validPieces: peer.valid_pieces,
    onParole: peer.on_parole,
  };
}

function mapFiles(
  snapshot: Extract<ViewSnapshot, { type: "files" }>,
  previous: {
    readonly source: Extract<ViewSnapshot, { type: "files" }>;
    readonly value: FileSet;
  } | null = null,
): FileSet {
  if (canPatchMappedFiles(previous, snapshot)) {
    let rows: Record<string, FileRow> | null = null;
    for (let index = 0; index < snapshot.files.length; index += 1) {
      const file = snapshot.files[index];
      if (file === undefined || file === previous.source.files[index]) continue;
      rows ??= { ...previous.value.rows };
      rows[file.file_id] = mapFile(
        file,
        snapshot.torrent_id,
        snapshot.filesystem_content_base,
      );
    }
    return rows === null ? previous.value : { ...previous.value, rows };
  }
  const rows = snapshot.files.map((file) =>
    mapFile(file, snapshot.torrent_id, snapshot.filesystem_content_base),
  );
  return {
    state: snapshot.state,
    filesystemContentBase: snapshot.filesystem_content_base,
    page: {
      offset: snapshot.page.offset,
      limit: snapshot.page.limit,
      total: snapshot.page.total,
      nextOffset: snapshot.page.next_offset,
    },
    order: rows.map((file) => file.id),
    rows: Object.fromEntries(rows.map((file) => [file.id, file])),
  };
}

function mapDisk(
  snapshot: Extract<ViewSnapshot, { type: "session_disk" }>,
): DiskSet {
  const rows = snapshot.pieces.map(
    (piece): DiskPieceRow => ({
      id: piece.row_id,
      torrentId: piece.torrent_id,
      torrentName: piece.torrent_name,
      pieceIndex: piece.piece_index,
      pieceLength: piece.piece_length,
      attempt: piece.attempt,
      stage: piece.stage,
      requestedBytes: safeNumber(piece.requested_bytes),
      receivedBytes: safeNumber(piece.received_bytes),
      storedBytes: safeNumber(piece.stored_bytes),
      ageMillis: safeNumber(piece.age_millis),
      stageAgeMillis: safeNumber(piece.stage_age_millis),
      error: piece.error ?? null,
    }),
  );
  const pipeline = snapshot.pipeline;
  return {
    pipeline: {
      pressure: pipeline.pressure,
      checkpointStage: pipeline.checkpoint_stage,
      intakeBackpressured: pipeline.intake_backpressured,
      sampleMillis: safeNumber(pipeline.sample_millis),
      residentLimitBytes: safeNumber(pipeline.resident_limit_bytes),
      residentHighWatermarkBytes: safeNumber(
        pipeline.resident_high_watermark_bytes,
      ),
      residentLowWatermarkBytes: safeNumber(
        pipeline.resident_low_watermark_bytes,
      ),
      requestedBytes: safeNumber(pipeline.requested_bytes),
      residentBytes: safeNumber(pipeline.resident_bytes),
      queuedWriteBytes: safeNumber(pipeline.queued_write_bytes),
      writingBytes: safeNumber(pipeline.writing_bytes),
      hashingBytes: safeNumber(pipeline.hashing_bytes),
      checkpointDirtyPieces: safeNumber(pipeline.checkpoint_dirty_pieces),
      checkpointDirtyBytes: safeNumber(pipeline.checkpoint_dirty_bytes),
      checkpointDirtyPieceHighWater: safeNumber(
        pipeline.checkpoint_dirty_piece_high_water,
      ),
      checkpointDirtyByteHighWater: safeNumber(
        pipeline.checkpoint_dirty_byte_high_water,
      ),
      checkpointOldestDirtyMillis: safeNumber(
        pipeline.checkpoint_oldest_dirty_millis,
      ),
      checkpointBatchesStarted: safeNumber(
        pipeline.checkpoint_batches_started,
      ),
      checkpointBatchesCompleted: safeNumber(
        pipeline.checkpoint_batches_completed,
      ),
      checkpointPiecesCompleted: safeNumber(
        pipeline.checkpoint_pieces_completed,
      ),
      checkpointSyncOperationsCompleted: safeNumber(
        pipeline.checkpoint_sync_operations_completed,
      ),
      checkpointSyncServiceMicros: safeNumber(
        pipeline.checkpoint_sync_service_micros,
      ),
      checkpointSyncServiceMaxMicros: safeNumber(
        pipeline.checkpoint_sync_service_max_micros,
      ),
      checkpointCommitServiceMicros: safeNumber(
        pipeline.checkpoint_commit_service_micros,
      ),
      checkpointCommitServiceMaxMicros: safeNumber(
        pipeline.checkpoint_commit_service_max_micros,
      ),
      checkpointActiveMicros:
        pipeline.checkpoint_active_micros === undefined ||
        pipeline.checkpoint_active_micros === null
          ? null
          : safeNumber(pipeline.checkpoint_active_micros),
      storageJobsPending: safeNumber(pipeline.storage_jobs_pending),
      receivedBytesTotal: safeNumber(pipeline.received_bytes_total),
      storedBytesTotal: safeNumber(pipeline.stored_bytes_total),
      verifiedBytesTotal: safeNumber(pipeline.verified_bytes_total),
      receiveRateBytes: safeNumber(pipeline.receive_rate_bytes),
      writeRateBytes: safeNumber(pipeline.write_rate_bytes),
      hashRateBytes: safeNumber(pipeline.hash_rate_bytes),
      writeOperationsStarted: safeNumber(pipeline.write_operations_started),
      writeOperationsCompleted: safeNumber(pipeline.write_operations_completed),
      hashOperationsStarted: safeNumber(pipeline.hash_operations_started),
      hashOperationsCompleted: safeNumber(pipeline.hash_operations_completed),
      writeQueueWaitMicros: safeNumber(pipeline.write_queue_wait_micros),
      writeQueueWaitMaxMicros: safeNumber(pipeline.write_queue_wait_max_micros),
      writeServiceMicros: safeNumber(pipeline.write_service_micros),
      writeServiceMaxMicros: safeNumber(pipeline.write_service_max_micros),
      hashQueueWaitMicros: safeNumber(pipeline.hash_queue_wait_micros),
      hashQueueWaitMaxMicros: safeNumber(pipeline.hash_queue_wait_max_micros),
      hashServiceMicros: safeNumber(pipeline.hash_service_micros),
      hashServiceMaxMicros: safeNumber(pipeline.hash_service_max_micros),
      pressureTransitionCount: safeNumber(
        pipeline.pressure_transition_count,
      ),
      backpressuredMillisTotal: safeNumber(
        pipeline.backpressured_millis_total,
      ),
      lastError: pipeline.last_error ?? null,
    },
    order: rows.map((row) => row.id),
    rows: Object.fromEntries(rows.map((row) => [row.id, row])),
  };
}

function canPatchMappedFiles(
  previous: {
    readonly source: Extract<ViewSnapshot, { type: "files" }>;
    readonly value: FileSet;
  } | null,
  snapshot: Extract<ViewSnapshot, { type: "files" }>,
): previous is {
  readonly source: Extract<ViewSnapshot, { type: "files" }>;
  readonly value: FileSet;
} {
  if (
    previous === null ||
    previous.source.torrent_id !== snapshot.torrent_id ||
    previous.source.state !== snapshot.state ||
    previous.source.filesystem_content_base !== snapshot.filesystem_content_base ||
    previous.source.page.offset !== snapshot.page.offset ||
    previous.source.page.limit !== snapshot.page.limit ||
    previous.source.page.total !== snapshot.page.total ||
    previous.source.page.next_offset !== snapshot.page.next_offset ||
    previous.source.files.length !== snapshot.files.length
  ) {
    return false;
  }
  return snapshot.files.every(
    (file, index) => previous.source.files[index]?.file_id === file.file_id,
  );
}

function mapFile(
  file: FileView,
  torrentId: string,
  filesystemContentBase: string | null,
): FileRow {
  const name = file.path.at(-1) ?? "";
  const separator = name.lastIndexOf(".");
  return {
    id: file.file_id,
    torrentId,
    index: file.file_index,
    path: file.path,
    name,
    folder: file.path.slice(0, -1).join("/"),
    extension:
      separator <= 0 || separator === name.length - 1
        ? ""
        : name.slice(separator + 1).toLocaleLowerCase(),
    lengthBytes: file.length_bytes,
    torrentOffsetBytes: file.torrent_offset_bytes,
    firstPiece: file.first_piece,
    lastPiece: file.last_piece,
    selection: file.selection,
    padding: file.padding,
    doneBytes: file.done_bytes,
    verifiedBytes: file.verified_bytes,
    mediaAvailability: file.media_availability,
    storagePath:
      filesystemContentBase === null
        ? null
        : [filesystemContentBase, ...file.path].join("/"),
  };
}

function mapMediaItem(torrentId: string, item: MediaItemView): MediaRow {
  const name = item.path.at(-1) ?? "";
  return {
    id: item.media_id,
    torrentId,
    fileIndex: item.file_index,
    path: item.path,
    name,
    folder: item.path.slice(0, -1).join("/"),
    extension: item.extension,
    lengthBytes: item.length_bytes,
    selection: item.selection,
    doneBytes: item.done_bytes,
    verifiedBytes: item.verified_bytes,
    mediaAvailability: item.media_availability,
    role:
      item.role.type === "episode"
        ? {
            type: "episode",
            seriesTitleHint: item.role.series_title_hint,
            seasonNumber: item.role.season_number,
            episodeNumber: item.role.episode_number,
            endingEpisodeNumber: item.role.ending_episode_number,
          }
        : { type: "unclassified_video" },
  };
}

function mediaUnavailableMessage(reason: import("../../api").MediaFileAvailability): string {
  switch (reason) {
    case "available":
      return localizedMessage("inspection.live.live.application.the.file.is.available");
    case "streamable":
      return localizedMessage("inspection.live.live.application.the.file.is.ready.to.stream");
    case "metadata_unavailable":
      return localizedMessage("inspection.live.live.application.file.list.not.available.yet");
    case "invalid_file":
      return localizedMessage("inspection.live.live.application.the.selected.file.no.longer.exists");
    case "padding":
      return localizedMessage("inspection.live.live.application.padding.files.cannot.be.opened");
    case "incomplete":
      return localizedMessage("inspection.live.live.application.the.file.has.not.finished.downloading");
    case "checking":
      return localizedMessage("inspection.live.live.application.the.file.cannot.be.opened.while.its");
    case "unverified":
      return localizedMessage("inspection.live.live.application.the.file.is.not.fully.verified.yet");
    case "storage_unavailable":
      return localizedMessage("inspection.live.live.application.the.file.s.storage.is.unavailable");
    case "removing":
      return localizedMessage("inspection.live.live.application.the.torrent.is.being.removed");
    case "server_unavailable":
      return localizedMessage("inspection.live.live.application.http.file.serving.is.unavailable");
    case "resource_limit":
      return localizedMessage("inspection.live.live.application.too.many.files.are.already.open.try");
    case "available":
    case "streamable":
      return localizedMessage("inspection.live.live.application.the.file.is.temporarily.unavailable");
  }
}

function mapTrackers(
  snapshot: Extract<ViewSnapshot, { type: "trackers" }>,
  clockOffsetMs: number,
): TrackerSet {
  const rows = snapshot.trackers.map((tracker) =>
    mapTracker(tracker, snapshot.torrent_id, clockOffsetMs),
  );
  return {
    state: "available",
    page: {
      offset: snapshot.page.offset,
      limit: snapshot.page.limit,
      total: snapshot.page.total,
      nextOffset: snapshot.page.next_offset,
    },
    order: rows.map((tracker) => tracker.id),
    rows: Object.fromEntries(rows.map((tracker) => [tracker.id, tracker])),
  };
}

function mapTracker(
  tracker: TrackerView,
  torrentId: string,
  clockOffsetMs: number,
): TrackerRow {
  return {
    id: tracker.tracker_id,
    torrentId,
    url: tracker.url,
    transport: tracker.transport,
    security: tracker.security,
    source: tracker.source,
    tier: tracker.tier,
    status: tracker.status,
    announceEvent: tracker.announce_event,
    totalAttempts: tracker.total_attempts,
    consecutiveFailures: tracker.consecutive_failures,
    lastConnectionFamily: tracker.last_connection_family,
    lastPeerCount: tracker.last_peer_count,
    seeders: tracker.seeders,
    leechers: tracker.leechers,
    intervalSeconds: tracker.interval_seconds,
    nextAction: tracker.next_action,
    nextActionAtMs: trackerInstant(tracker.next_action_at_millis, clockOffsetMs),
    lastSuccessAtMs: trackerInstant(tracker.last_success_at_millis, clockOffsetMs),
    lastFailureAtMs: trackerInstant(tracker.last_failure_at_millis, clockOffsetMs),
    error: tracker.last_error,
  };
}

function trackerInstant(value: string | null, clockOffsetMs: number): number | null {
  const instant = safeNullableNumber(value);
  return instant === null ? null : clockOffsetMs + instant;
}

function mapPeer(peer: PeerView): PeerRow {
  const state: PeerRow["state"] =
    peer.lifecycle === "transport_connecting"
      ? "connecting"
      : peer.lifecycle === "protocol_handshaking"
        ? "handshaking"
        : peer.lifecycle === "disconnecting"
          ? "disconnecting"
          : peer.request_phase === "stalled"
            ? "stalled"
            : peer.remote_choking === true
              ? "choked"
              : "connected";
  return {
    connectionId: peer.connection_id,
    torrentId: peer.torrent_id,
    state,
    endpoint: peer.remote_endpoint,
    client: peer.client_name,
    source: mapPeerSource(peer.sources),
    progress: null,
    downloadRate: safeNullableNumber(peer.payload_download_rate_bytes),
    uploadRate: safeNullableNumber(peer.payload_upload_rate_bytes),
    downloadedBytes: safeNullableNumber(peer.payload_downloaded_bytes),
    uploadedBytes: safeNullableNumber(peer.payload_uploaded_bytes),
    requestsPending: peer.pending_requests,
    oldestRequestMs: safeNullableNumber(peer.oldest_request_age_millis),
    connectedAgeMs: safeNullableNumber(peer.connected_age_millis),
    lastPayloadAgeMs: safeNullableNumber(peer.last_payload_age_millis),
    flags: mapPeerFlags(peer),
    mseMethod: peer.mse_method ?? null,
    useful:
      safeNullableNumber(peer.payload_downloaded_bytes) !== null &&
      safeNullableNumber(peer.payload_downloaded_bytes)! > 0,
  };
}

function mapPeerFlags(peer: PeerView): readonly PeerFlag[] {
  if (peer.peer_flags !== undefined) return peer.peer_flags;

  const flags: PeerFlag[] = [];
  if (peer.direction === "incoming") flags.push("incoming");
  if (peer.mse_method !== undefined && peer.mse_method !== null) {
    flags.push("encrypted");
  }
  if (peer.local_interested === true) {
    if (peer.remote_choking === false) flags.push("download_allowed");
    if (peer.remote_choking === true) flags.push("download_choked");
  }
  if (peer.remote_interested === true) {
    if (peer.local_choking === false) flags.push("upload_allowed");
    if (peer.local_choking === true) flags.push("upload_choked");
  }
  if (peer.supports_extensions === true) flags.push("extension_protocol");
  if (peer.supports_ut_metadata === true) flags.push("metadata_extension");
  if (peer.transport === "utp") flags.push("utp");
  return flags;
}

function mapPeerSource(sources: readonly PeerSourceView[]): PeerRow["source"] {
  if (sources.includes("tracker")) return "tracker";
  if (sources.includes("dht")) return "dht";
  if (sources.includes("peer_exchange")) return "pex";
  if (sources.includes("manual") || sources.includes("magnet_hint")) return "manual";
  if (sources.includes("incoming")) return "incoming";
  if (sources.includes("cache")) return "cache";
  return "unknown";
}

function mapLog(event: DiagnosticEvent): LogRow {
  return {
    id: event.sequence,
    timestampMs: safeNumber(event.timestamp_millis),
    severity: event.severity,
    category: event.category,
    code: event.code,
    message: event.message,
    torrentId: event.torrent_id ?? null,
    subjects: event.subjects,
    fields: event.fields,
  };
}

function staleIfMaterialized(
  status: ViewMaterialization,
  error: Error,
): ViewMaterialization {
  return status.status === "ready" || status.status === "stale"
    ? { status: "stale", reason: error.message.slice(0, 240) }
    : status;
}

function safeNullableNumber(value: string | null): number | null {
  return value === null ? null : safeNumber(value);
}

function safeNumber(value: string): number {
  try {
    const parsed = BigInt(value);
    if (parsed < 0n) return 0;
    return Number(parsed > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : parsed);
  } catch {
    return 0;
  }
}

function emptyLiveSnapshot(
  desired: DesiredInspectionViews,
  connection: SessionConnection,
): InspectionSnapshot {
  return {
    revision: 0,
    durableRevision: "0",
    session: {
      connection,
      downloadRate: 0,
      uploadRate: null,
      dhtNodes: null,
      knownPeers: null,
    },
    demo: null,
    storage: { roots: [], defaultRoot: null, showAddOptions: true },
    clientSettings: structuredClone(DEFAULT_CLIENT_SETTINGS_RUNTIME_VIEW),
    torrentOrder: [],
    torrents: {},
    peersByTorrent: {},
    swarmByTorrent: {},
    filesByTorrent: {},
    mediaByTorrent: {},
    trackersByTorrent: {},
    piecesByTorrent: {},
    disk: emptyDiskSet(),
    dht: null,
    speed: null,
    logs: [],
    logLoss: {
      sourceEvictedCount: 0,
      retainedFromSequence: "1",
      localEvictedCount: 0,
      deliveryResetCount: 0,
      lastDeliveryResetReason: null,
    },
    viewStatus: {
      library: desired.library ? { status: "loading" } : { status: "not_requested" },
      torrentSummary:
        desired.torrentId === null ? { status: "not_requested" } : { status: "loading" },
      peers: desired.detail === "peers" ? { status: "loading" } : { status: "not_requested" },
      swarm: wantsSwarm(desired.detail) ? { status: "loading" } : { status: "not_requested" },
      files: desired.detail === "files" ? { status: "loading" } : { status: "not_requested" },
      media: desired.detail === "media" ? { status: "loading" } : { status: "not_requested" },
      trackers:
        desired.detail === "trackers"
          ? { status: "loading" }
          : { status: "not_requested" },
      pieces:
        desired.detail === "pieces"
          ? { status: "loading" }
          : { status: "not_requested" },
      disk: desired.detail === "disk" ? { status: "loading" } : { status: "not_requested" },
      dht: wantsDht(desired.detail) ? { status: "loading" } : { status: "not_requested" },
      speed:
        desired.detail === "speed"
          ? { status: "loading" }
          : { status: "not_requested" },
      logs: desired.detail === "logs" ? { status: "loading" } : { status: "not_requested" },
    },
  };
}

// The Trackers tab also lists peers by source and this torrent's DHT search.
function wantsSwarm(detail: DesiredInspectionViews["detail"]): boolean {
  return detail === "swarm" || detail === "trackers";
}

function wantsDht(detail: DesiredInspectionViews["detail"]): boolean {
  return detail === "dht" || detail === "trackers";
}

function sameViews(
  left: DesiredInspectionViews,
  right: DesiredInspectionViews,
): boolean {
  return (
    left.library === right.library &&
    left.torrentId === right.torrentId &&
    left.detail === right.detail &&
    left.logCapture?.profile === right.logCapture?.profile &&
    left.logCapture?.torrentId === right.logCapture?.torrentId
    && left.speed?.range === right.speed?.range
    && sameMetricSelection(left.speed?.metrics, right.speed?.metrics)
  );
}

function sameMetricSelection(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  return left === right ||
    (left !== undefined && right !== undefined && left.length === right.length &&
      left.every((metric, index) => metric === right[index]));
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
