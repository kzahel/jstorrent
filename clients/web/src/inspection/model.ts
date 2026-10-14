import type {
  ClientSettings,
  ClientSettingsPatch,
  ClientSettingsRuntimeView,
  DiagnosticField,
  DiagnosticSubject,
  DhtInspectionView,
  MediaFileAvailability,
  PeerDisconnectReason,
  PeerFlagView,
  PeerMseMethodView,
  PeerSourceView,
  SpeedCurrentRate,
  SpeedHistoryView,
  SpeedMetric,
  SpeedRange,
  SpeedSeriesView,
  SeedAdmissionView,
  SeedGoalView,
  SwarmCatalogState,
  SwarmCountsView,
  SwarmPeerState,
  TorrentOperationalState,
  TorrentSettingsPatch,
  TorrentTransferLimits,
} from "../api";

export type TorrentStatus =
  | "metadata"
  | "downloading"
  | "paused"
  | "complete"
  | "checking"
  | "error";

export type PeerState =
  | "connecting"
  | "handshaking"
  | "connected"
  | "choked"
  | "stalled"
  | "disconnecting";

export type PeerFlag = PeerFlagView;

export type DetailTab =
  | "general"
  | "trackers"
  | "peers"
  | "swarm"
  | "files"
  | "pieces"
  | "disk"
  | "logs"
  | "speed"
  | "dht";

export type ApplicationDestination = "library" | "transfers" | "workbench";

export type LibraryCategory =
  | "all"
  | "recent"
  | "available"
  | "downloading"
  | "archived";

export type TorrentCategory =
  | "all"
  | "active"
  | "downloading"
  | "completed"
  | "paused"
  | "errors"
  | "archived";

export interface SessionSummary {
  readonly connection: "demo" | "connected" | "reconnecting" | "offline";
  readonly downloadRate: number;
  readonly uploadRate: number | null;
  readonly dhtNodes: number | null;
  readonly knownPeers: number | null;
}

export interface DownloadRoot {
  readonly id: string;
  readonly label: string;
  readonly path: string | null;
  readonly availability: "available" | "unavailable";
}

export interface DownloadStorageSettings {
  readonly roots: readonly DownloadRoot[];
  readonly defaultRoot: string | null;
  readonly showAddOptions: boolean;
  readonly showFileSelection?: boolean;
}

export type ViewMaterialization =
  | { readonly status: "not_requested" }
  | { readonly status: "loading" }
  | { readonly status: "ready" }
  | { readonly status: "unavailable"; readonly reason: string }
  | { readonly status: "unsupported"; readonly reason: string }
  | { readonly status: "stale"; readonly reason: string };

export interface InspectionViewStatus {
  readonly library: ViewMaterialization;
  readonly torrentSummary: ViewMaterialization;
  readonly peers: ViewMaterialization;
  readonly swarm: ViewMaterialization;
  readonly files: ViewMaterialization;
  readonly media: ViewMaterialization;
  readonly trackers: ViewMaterialization;
  readonly pieces: ViewMaterialization;
  readonly disk: ViewMaterialization;
  readonly dht: ViewMaterialization;
  readonly speed: ViewMaterialization;
  readonly logs: ViewMaterialization;
}

export interface DesiredInspectionViews {
  readonly library: boolean;
  readonly torrentId: string | null;
  readonly detail:
    | "general"
    | "trackers"
    | "peers"
    | "swarm"
    | "files"
    | "media"
    | "pieces"
    | "disk"
    | "dht"
    | "speed"
    | "logs"
    | null;
  readonly filePageOffset?: number;
  readonly logCapture: {
    readonly profile: "normal" | "detailed" | "trace";
    readonly torrentId: string | null;
  } | null;
  readonly speed?: {
    readonly range: SpeedRange;
    readonly metrics: readonly SpeedMetric[];
  } | null;
}

export interface DemoState {
  readonly scenarioId: DemoScenarioId;
  readonly elapsedMs: number;
  readonly running: boolean;
  readonly durationMs: number;
}

export type TorrentEta =
  | { readonly state: "estimate"; readonly seconds: string }
  | { readonly state: "warming_up" }
  | { readonly state: "stalled" }
  | { readonly state: "unavailable" };

export type TorrentCheckingPhase =
  | "queued"
  | "preparing"
  | "hashing"
  | "reconciling_storage"
  | "paused"
  | "finalizing";

export interface TorrentCheckingProgress {
  readonly generation: string;
  readonly phase: TorrentCheckingPhase;
  readonly piecesTotal: number;
  readonly piecesProcessed: number;
  readonly piecesMatched: number;
  readonly piecesAbsent: number;
  readonly piecesMismatched: number;
  readonly bytesHashed: string;
  readonly activeHashJobs: number;
  readonly queuedHashJobs: number;
  readonly elapsedMs: number;
  readonly lastAdvanceAgeMs: number;
  readonly oldestActiveJobAgeMs: number | null;
}

export interface MetadataAcquisitionProgress {
  readonly phase: "discovering" | "downloading";
  readonly totalSizeBytes: number | null;
  readonly receivedBytes: number;
  readonly blockCount: number;
  readonly blockStates: Uint8Array;
  readonly activePeers: number;
  readonly requestsInFlight: number;
  readonly hashRetries: number;
}

export interface IntegrityPreparationProgress {
  readonly phase: "acquiring" | "waiting_for_peer";
  readonly neededHashRanges: number;
  readonly activeRequests: number;
}

export interface TorrentPreparation {
  readonly generation: string;
  readonly metadata: MetadataAcquisitionProgress | null;
  readonly integrity: IntegrityPreparationProgress | null;
}

export interface TorrentRow {
  readonly id: string;
  readonly name: string;
  readonly storageRoot?: string;
  readonly status: TorrentStatus;
  readonly operationalState: TorrentOperationalState;
  readonly queuePosition: number | null;
  readonly transferLimits: TorrentTransferLimits;
  readonly sizeBytes: number | null;
  readonly progress: number | null;
  readonly checking: TorrentCheckingProgress | null;
  readonly downloadRate: number;
  readonly uploadRate: number | null;
  readonly downloadedBytes: number;
  readonly uploadedBytes: number | null;
  readonly peersConnected: number;
  readonly peersKnown: number | null;
  readonly configuredTrackerCount: number | null;
  readonly requiredPayloadBytes: string | null;
  readonly remainingPayloadBytes: string | null;
  readonly etaDownloadRateBytes: string;
  readonly eta: TorrentEta;
  readonly lifetimeUploadedBytes: string;
  readonly lifetimeDownloadedBytes: string;
  readonly activeSeconds: string;
  readonly finishedSeconds: string;
  readonly seedingSeconds: string;
  readonly shareRatioHundredths: string | null;
  readonly seedAdmission: SeedAdmissionView;
  readonly seedGoal: SeedGoalView | null;
  readonly addedAtMs: number | null;
  readonly archived: boolean | null;
  readonly removalState: "pending" | "awaiting_platform" | "failed" | null;
  readonly deleteDataSupported: boolean;
  readonly forceRecheckAvailable: boolean;
  readonly awaitingFileSelection?: boolean;
  readonly pendingFileSelectionPosition?: number | null;
  readonly fileCatalogId?: string | null;
  readonly selectableFileCount?: number;
  readonly selectedFileCount?: number;
  readonly selectableFileBytes?: string;
  readonly selectedFileBytes?: string;
  readonly infoHash: string;
  readonly protocolIdentities?: {
    readonly v1?: string | null;
    readonly v2?: string | null;
  };
  readonly error: string | null;
  readonly progressReason: string;
  readonly preparation?: TorrentPreparation | null;
}

export interface PeerRow {
  readonly connectionId: string;
  readonly torrentId: string;
  readonly state: PeerState;
  readonly endpoint: string;
  readonly client: string | null;
  readonly source:
    | "tracker"
    | "dht"
    | "pex"
    | "manual"
    | "incoming"
    | "cache"
    | "unknown";
  readonly progress: number | null;
  readonly downloadRate: number | null;
  readonly uploadRate: number | null;
  readonly downloadedBytes: number | null;
  readonly uploadedBytes: number | null;
  readonly requestsPending: number | null;
  readonly oldestRequestMs: number | null;
  readonly connectedAgeMs: number | null;
  readonly lastPayloadAgeMs: number | null;
  readonly flags: readonly PeerFlag[];
  readonly mseMethod: PeerMseMethodView | null;
  readonly useful: boolean;
}

export interface LogRow {
  readonly id: string;
  readonly timestampMs: number;
  readonly severity: "trace" | "debug" | "info" | "warning" | "error";
  readonly category: string;
  readonly code: string;
  readonly message: string;
  readonly torrentId: string | null;
  readonly subjects: readonly DiagnosticSubject[];
  readonly fields: readonly DiagnosticField[];
}

export interface LogLoss {
  readonly sourceEvictedCount: number;
  readonly retainedFromSequence: string;
  readonly localEvictedCount: number;
  readonly deliveryResetCount: number;
  readonly lastDeliveryResetReason: string | null;
}

export interface PeerSet {
  readonly order: readonly string[];
  readonly rows: Readonly<Record<string, PeerRow>>;
}

export interface SwarmRow {
  readonly recordId: string;
  readonly torrentId: string;
  readonly endpoint: string;
  readonly sources: readonly PeerSourceView[];
  readonly state: SwarmPeerState;
  readonly connectable: boolean;
  readonly firstObservedAgeMs: number;
  readonly lastObservedAgeMs: number;
  readonly retryInMs: number | null;
  readonly dialAttempts: number;
  readonly consecutiveFailures: number;
  readonly totalFailures: number;
  readonly lastDialAgeMs: number | null;
  readonly lastConnectedAgeMs: number | null;
  readonly lastFailure: PeerDisconnectReason | null;
  readonly lastFailureAgeMs: number | null;
  readonly payloadDownloadedBytes: string;
  readonly payloadUploadedBytes: string;
  readonly trustPoints: number;
  readonly hashFailures: number;
  readonly validPieces: number;
  readonly onParole: boolean;
}

export interface SwarmSet {
  readonly state: SwarmCatalogState;
  readonly capturedMillis: number;
  readonly maximumRecords: number;
  readonly counts: SwarmCountsView;
  readonly order: readonly string[];
  readonly rows: Readonly<Record<string, SwarmRow>>;
}

export interface FileRow {
  readonly id: string;
  readonly torrentId: string;
  readonly index: number;
  readonly path: readonly string[];
  readonly name: string;
  readonly folder: string;
  readonly extension: string;
  readonly lengthBytes: string;
  readonly torrentOffsetBytes: string;
  readonly firstPiece: number | null;
  readonly lastPiece: number | null;
  readonly selection: "normal" | "high" | "skipped" | null;
  readonly padding: boolean;
  readonly doneBytes: string;
  readonly verifiedBytes: string;
  readonly mediaAvailability: MediaFileAvailability;
  readonly storagePath: string | null;
}

export interface FileSet {
  readonly state: "metadata_pending" | "available" | "torrent_missing";
  readonly filesystemContentBase: string | null;
  readonly page: CatalogPage;
  readonly order: readonly string[];
  readonly rows: Readonly<Record<string, FileRow>>;
}

export type MediaRole =
  | {
      readonly type: "episode";
      readonly seriesTitleHint: string;
      readonly seasonNumber: number;
      readonly episodeNumber: number;
      readonly endingEpisodeNumber: number | null;
    }
  | { readonly type: "unclassified_video" };

export interface MediaRow {
  readonly id: string;
  readonly torrentId: string;
  readonly fileIndex: number;
  readonly path: readonly string[];
  readonly name: string;
  readonly folder: string;
  readonly extension: string;
  readonly lengthBytes: string;
  readonly selection: "normal" | "high" | "skipped";
  readonly doneBytes: string;
  readonly verifiedBytes: string;
  readonly mediaAvailability: MediaFileAvailability;
  readonly role: MediaRole;
}

export interface MediaSet {
  readonly state: "metadata_pending" | "available" | "torrent_missing";
  readonly totalNonPaddingFiles: number;
  readonly order: readonly string[];
  readonly rows: Readonly<Record<string, MediaRow>>;
}

export interface TrackerRow {
  readonly id: string;
  readonly torrentId: string;
  readonly url: string;
  readonly transport: "udp" | "http" | "https";
  readonly security:
    | "unencrypted"
    | "encrypted_system_trust"
    | "encrypted_unauthenticated";
  readonly source: "magnet" | "metainfo";
  readonly tier: number;
  readonly status:
    | "unsupported"
    | "inactive"
    | "disabled"
    | "idle"
    | "announcing"
    | "retry_wait"
    | "reannounce_wait";
  readonly announceEvent: "started" | "update" | "completed" | "stopped" | null;
  readonly totalAttempts: number;
  readonly consecutiveFailures: number;
  readonly lastConnectionFamily: "ipv4" | "ipv6" | null;
  readonly lastPeerCount: number | null;
  readonly seeders: number | null;
  readonly leechers: number | null;
  readonly intervalSeconds: number | null;
  readonly nextAction: "announce" | "retry" | "reannounce" | null;
  readonly nextActionAtMs: number | null;
  readonly lastSuccessAtMs: number | null;
  readonly lastFailureAtMs: number | null;
  readonly error: string | null;
}

export interface TrackerSet {
  readonly state: "available" | "torrent_missing";
  readonly page: CatalogPage;
  readonly order: readonly string[];
  readonly rows: Readonly<Record<string, TrackerRow>>;
}

export interface CatalogPage {
  readonly offset: number;
  readonly limit: number;
  readonly total: number;
  readonly nextOffset: number | null;
}

export interface DiskPipeline {
  readonly pressure: "idle" | "normal" | "backpressured" | "draining" | "error";
  readonly checkpointStage: "idle" | "syncing" | "committing" | "error";
  readonly intakeBackpressured: boolean;
  readonly sampleMillis: number;
  readonly residentLimitBytes: number;
  readonly residentHighWatermarkBytes: number;
  readonly residentLowWatermarkBytes: number;
  readonly requestedBytes: number;
  readonly residentBytes: number;
  readonly queuedWriteBytes: number;
  readonly writingBytes: number;
  readonly hashingBytes: number;
  readonly checkpointDirtyPieces: number;
  readonly checkpointDirtyBytes: number;
  readonly checkpointDirtyPieceHighWater: number;
  readonly checkpointDirtyByteHighWater: number;
  readonly checkpointOldestDirtyMillis: number;
  readonly checkpointBatchesStarted: number;
  readonly checkpointBatchesCompleted: number;
  readonly checkpointPiecesCompleted: number;
  readonly checkpointSyncOperationsCompleted: number;
  readonly checkpointSyncServiceMicros: number;
  readonly checkpointSyncServiceMaxMicros: number;
  readonly checkpointCommitServiceMicros: number;
  readonly checkpointCommitServiceMaxMicros: number;
  readonly checkpointActiveMicros: number | null;
  readonly storageJobsPending: number;
  readonly receivedBytesTotal: number;
  readonly storedBytesTotal: number;
  readonly verifiedBytesTotal: number;
  readonly receiveRateBytes: number;
  readonly writeRateBytes: number;
  readonly hashRateBytes: number;
  readonly writeOperationsStarted: number;
  readonly writeOperationsCompleted: number;
  readonly hashOperationsStarted: number;
  readonly hashOperationsCompleted: number;
  readonly writeQueueWaitMicros: number;
  readonly writeQueueWaitMaxMicros: number;
  readonly writeServiceMicros: number;
  readonly writeServiceMaxMicros: number;
  readonly hashQueueWaitMicros: number;
  readonly hashQueueWaitMaxMicros: number;
  readonly hashServiceMicros: number;
  readonly hashServiceMaxMicros: number;
  readonly pressureTransitionCount: number;
  readonly backpressuredMillisTotal: number;
  readonly lastError: string | null;
}

export interface DiskPieceRow {
  readonly id: string;
  readonly torrentId: string;
  readonly torrentName: string;
  readonly pieceIndex: number;
  readonly pieceLength: number;
  readonly attempt: number;
  readonly stage:
    | "receiving"
    | "queued"
    | "writing"
    | "stored"
    | "hashing"
    | "checkpoint_dirty"
    | "checkpoint_syncing"
    | "checkpoint_committing"
    | "failed";
  readonly requestedBytes: number;
  readonly receivedBytes: number;
  readonly storedBytes: number;
  readonly ageMillis: number;
  readonly stageAgeMillis: number;
  readonly error: string | null;
}

export interface DiskSet {
  readonly pipeline: DiskPipeline;
  readonly order: readonly string[];
  readonly rows: Readonly<Record<string, DiskPieceRow>>;
}

export type PieceLifecycleStage =
  | "requested"
  | "received"
  | "stored"
  | "hashing"
  | "checkpoint_dirty"
  | "checkpoint_syncing"
  | "checkpoint_committing"
  | "failed";

export interface ActivePieceSummary {
  readonly id: string;
  readonly pieceIndex: number;
  readonly attempt: number;
  readonly pieceLength: number;
  readonly stage: PieceLifecycleStage;
  readonly requestedBytes: number;
  readonly receivedBytes: number;
  readonly storedBytes: number;
  readonly ageMillis: number;
  readonly error: string | null;
}

export interface PieceMapSet {
  readonly torrentId: string;
  readonly pieceCount: number;
  readonly verified: Uint8Array;
  readonly active: readonly ActivePieceSummary[];
  readonly revision: number;
}

export interface SpeedInspectionSeries extends SpeedSeriesView {
  readonly current_rate_bytes: string | null;
}

export interface SpeedInspectionView extends Omit<SpeedHistoryView, "series"> {
  readonly current: readonly SpeedCurrentRate[];
  readonly series: readonly SpeedInspectionSeries[];
}

export interface InspectionSnapshot {
  readonly revision: number;
  readonly durableRevision: string;
  readonly session: SessionSummary;
  readonly demo: DemoState | null;
  readonly storage: DownloadStorageSettings;
  readonly clientSettings: ClientSettingsRuntimeView;
  readonly torrentOrder: readonly string[];
  readonly torrents: Readonly<Record<string, TorrentRow>>;
  readonly peersByTorrent: Readonly<Record<string, PeerSet>>;
  readonly swarmByTorrent: Readonly<Record<string, SwarmSet>>;
  readonly filesByTorrent: Readonly<Record<string, FileSet>>;
  readonly mediaByTorrent: Readonly<Record<string, MediaSet>>;
  readonly trackersByTorrent: Readonly<Record<string, TrackerSet>>;
  readonly piecesByTorrent: Readonly<Record<string, PieceMapSet>>;
  readonly disk: DiskSet;
  readonly dht: DhtInspectionView | null;
  readonly speed: SpeedInspectionView | null;
  readonly logs: readonly LogRow[];
  readonly logLoss: LogLoss;
  readonly viewStatus: InspectionViewStatus;
}

export interface KeyedPatch<T> {
  readonly upsert: readonly T[];
  readonly removed: readonly string[];
}

export type InspectionUpdate =
  | { readonly type: "snapshot"; readonly snapshot: InspectionSnapshot }
  | {
      readonly type: "patch";
      readonly revision: number;
      readonly durableRevision?: string;
      readonly session?: SessionSummary;
      readonly demo?: DemoState;
      readonly storage?: DownloadStorageSettings;
      readonly clientSettings?: ClientSettingsRuntimeView;
      readonly torrents?: KeyedPatch<TorrentRow> & {
        readonly order?: readonly string[];
      };
      readonly peers?: readonly (KeyedPatch<PeerRow> & {
        readonly torrentId: string;
        readonly order?: readonly string[];
      })[];
      readonly swarm?: readonly (KeyedPatch<SwarmRow> & {
        readonly torrentId: string;
        readonly state: SwarmSet["state"];
        readonly capturedMillis: number;
        readonly maximumRecords: number;
        readonly counts: SwarmCountsView;
        readonly order?: readonly string[];
      })[];
      readonly files?: readonly (KeyedPatch<FileRow> & {
        readonly torrentId: string;
        readonly state?: FileSet["state"];
        readonly filesystemContentBase?: string | null;
        readonly order?: readonly string[];
      })[];
      readonly media?: readonly (KeyedPatch<MediaRow> & {
        readonly torrentId: string;
        readonly state?: MediaSet["state"];
        readonly totalNonPaddingFiles?: number;
        readonly order?: readonly string[];
      })[];
      readonly trackers?: readonly (KeyedPatch<TrackerRow> & {
        readonly torrentId: string;
        readonly state?: TrackerSet["state"];
        readonly order?: readonly string[];
      })[];
      readonly pieces?: Readonly<Record<string, PieceMapSet>>;
      readonly disk?: DiskSet;
      readonly speed?: SpeedInspectionView;
      readonly logs?: {
        readonly append: readonly LogRow[];
        readonly sourceEvictedCount: number;
        readonly retainedFromSequence: string;
        readonly deliveryResetCount: number;
        readonly lastDeliveryResetReason: string | null;
      };
    };

export type InspectionCommand =
  | {
      readonly type: "add_magnet";
      readonly magnet: string;
      readonly storageRoot: string;
      readonly startContent: boolean;
      readonly awaitFileSelection?: boolean;
    }
  | {
      readonly type: "add_torrent_bytes";
      readonly source: ArrayBuffer;
      readonly storageRoot: string;
      readonly startContent: boolean;
      readonly awaitFileSelection?: boolean;
    }
  | {
      readonly type: "add_external_torrent";
      readonly activationId: string;
      readonly storageRoot: string;
      readonly startContent: boolean;
      readonly awaitFileSelection?: boolean;
    }
  | {
      readonly type: "set_file_priority";
      readonly torrentId: string;
      readonly fileIndices: readonly number[];
      readonly priority: "high" | "normal" | "skip";
    }
  | {
      readonly type: "download_files";
      readonly torrentId: string;
      readonly fileIndices: readonly number[];
    }
  | {
      readonly type: "open_file";
      readonly torrentId: string;
      readonly fileIndex: number;
    }
  | { readonly type: "choose_download_root"; readonly repairRoot?: string }
  | { readonly type: "set_default_download_root"; readonly rootId: string }
  | { readonly type: "set_show_add_options"; readonly show: boolean }
  | { readonly type: "set_show_file_selection"; readonly show: boolean }
  | {
      readonly type: "confirm_pending_file_selection";
      readonly torrentId: string;
      readonly catalogId: string;
      readonly base: "current" | "all" | "none";
      readonly overrides: readonly {
        readonly start: number;
        readonly endExclusive: number;
        readonly selected: boolean;
      }[];
      readonly disableFuture: boolean;
    }
  | {
      readonly type: "download_all_pending_add";
      readonly torrentId: string;
      readonly disableFuture: boolean;
    }
  | { readonly type: "cancel_pending_add"; readonly torrentId: string }
  | { readonly type: "update_client_settings"; readonly patch: ClientSettingsPatch }
  | { readonly type: "reset_client_settings" }
  | {
      readonly type: "update_torrent_settings";
      readonly torrentId: string;
      readonly patch: TorrentSettingsPatch;
    }
  | { readonly type: "remove_download_root"; readonly rootId: string }
  | { readonly type: "clear_app_data" }
  | { readonly type: "export_magnet"; readonly torrentId: string }
  | { readonly type: "pause"; readonly torrentId: string }
  | { readonly type: "resume"; readonly torrentId: string }
  | { readonly type: "move_download_to_top"; readonly torrentId: string }
  | { readonly type: "move_download_to_bottom"; readonly torrentId: string }
  | { readonly type: "force_recheck"; readonly torrentId: string }
  | { readonly type: "archive"; readonly torrentId: string }
  | { readonly type: "unarchive"; readonly torrentId: string }
  | {
      readonly type: "remove";
      readonly torrentId: string;
      readonly deleteData: boolean;
    }
  | { readonly type: "add_demo_torrent" }
  | { readonly type: "set_demo_scenario"; readonly scenarioId: DemoScenarioId }
  | { readonly type: "set_demo_running"; readonly running: boolean }
  | { readonly type: "advance_demo_clock"; readonly milliseconds: number }
  | { readonly type: "reset_demo" };

export type DemoScenarioId =
  | "healthy-download"
  | "media-library"
  | "checking-progress"
  | "stalled-metadata"
  | "tracker-recovery"
  | "endgame"
  | "piece-retry"
  | "large-swarm"
  | "swarm-lifecycle"
  | "file-progress"
  | "disk-error"
  | "slow-disk-pressure"
  | "diagnostic-console"
  | "speed-steady"
  | "speed-bursty"
  | "speed-idle"
  | "speed-hash-retry"
  | "speed-traffic-breakdown"
  | "speed-history"
  | "speed-unavailable-upload"
  | "speed-stale"
  | "speed-reset"
  | "dht-observatory"
  | "empty-library";

export interface DemoScenarioSummary {
  readonly id: DemoScenarioId;
  readonly title: string;
  readonly description: string;
  readonly durationMs: number;
  readonly autoplay: boolean;
}

export interface CommandResult {
  readonly accepted: boolean;
  readonly message: string;
  readonly requestId?: string;
  readonly resultingRevision?: string;
  readonly storageRoot?: DownloadRoot | null;
  readonly torrentId?: string;
  readonly magnetExport?: MagnetExport;
  readonly addDisposition?:
    | { readonly type: "added" }
    | { readonly type: "already_present" }
    | {
        readonly type: "selection_expanded";
        readonly newlyWantedCount?: number | null;
      };
}

export interface MagnetExport {
  readonly magnet: string;
  readonly source: "verbatim" | "canonicalized" | "synthesized";
  readonly omittedTrackerCount: number;
}
