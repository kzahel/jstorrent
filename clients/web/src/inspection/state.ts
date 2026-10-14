import { createStore, type StoreApi } from "zustand/vanilla";

import { DEFAULT_CLIENT_SETTINGS_RUNTIME_VIEW } from "../api";

import {
  DEFAULT_COLOR_THEME,
  DEFAULT_DATA_UNITS,
  DEFAULT_INTERFACE_SIZE,
  loadAppearancePreferences,
  saveAppearancePreferences,
  type AppearancePreferences,
  type AppearanceStorage,
  type ColorTheme,
  type DataUnits,
  type InterfaceSize,
} from "./appearance";
import type {
  ApplicationDestination,
  DetailTab,
  InspectionSnapshot,
  InspectionUpdate,
  LibraryCategory,
  LogRow,
  DiskSet,
  FileSet,
  MediaSet,
  PeerSet,
  SwarmSet,
  TrackerSet,
  PieceMapSet,
  TorrentCategory,
  TorrentRow,
} from "./model";
import {
  loadNavigationPreferences,
  saveNavigationPreferences,
  type NavigationPreferences,
} from "./navigation";
import {
  DEFAULT_SPEED_METRICS,
  DEFAULT_SPEED_RANGE,
  loadSpeedPreferences,
  saveSpeedPreferences,
} from "./speed-preferences";
import {
  loadDhtVisualizationMode,
  saveDhtVisualizationMode,
  type DhtVisualizationMode,
} from "./dht-preferences";
import type { SpeedMetric, SpeedRange } from "../api";

export interface PresentationState {
  readonly destination: ApplicationDestination;
  readonly libraryCategory: LibraryCategory;
  readonly transfersCategory: TorrentCategory;
  readonly workbenchCategory: TorrentCategory;
  readonly currentTorrentId: string | null;
  readonly torrentSelectionInitialized: boolean;
  readonly selectedTorrentIds: readonly string[];
  readonly pendingRevealTorrentId: string | null;
  readonly currentPeerId: string | null;
  readonly activeTab: DetailTab;
  readonly detailPanePercent: number;
  readonly detailOpen: boolean;
  readonly libraryDetailOpen: boolean;
  readonly libraryDetailMode: "media" | "files";
  readonly detailTarget: {
    readonly type: "torrent_error";
    readonly torrentId: string;
  } | null;
  readonly sidebarOpen: boolean;
  readonly layout: "wide" | "compact" | "phone";
  readonly interfaceSize: InterfaceSize;
  readonly colorTheme: ColorTheme;
  readonly dataUnits: DataUnits;
  readonly logCaptureProfile: "normal" | "detailed" | "trace";
  readonly logCaptureTorrentId: string | null;
  readonly logMinimumSeverity: LogRow["severity"];
  readonly logCategoryPrefix: string;
  readonly logSearch: string;
  readonly logDisplayScope: "all" | "current";
  readonly logExpandedIds: readonly string[];
  readonly logClearThroughSequence: string | null;
  readonly logFollowing: boolean;
  readonly speedRange: SpeedRange;
  readonly speedMetrics: readonly SpeedMetric[];
  readonly dhtVisualizationMode: DhtVisualizationMode;
}

export interface InspectionState extends InspectionSnapshot {
  readonly presentation: PresentationState;
}

export interface InspectionActions {
  readonly applyUpdate: (update: InspectionUpdate) => void;
  readonly selectDestination: (destination: ApplicationDestination) => void;
  readonly selectLibraryCategory: (category: LibraryCategory) => void;
  readonly selectTorrentCategory: (category: TorrentCategory) => void;
  readonly setTorrentSelection: (
    torrentIds: readonly string[],
    currentTorrentId: string | null,
  ) => void;
  readonly selectOnlyTorrent: (torrentId: string) => void;
  readonly revealTorrent: (torrentId: string) => void;
  readonly openTorrentDetail: (torrentId: string) => void;
  readonly openLibraryTorrentDetail: (torrentId: string) => void;
  readonly closeLibraryTorrentDetail: () => void;
  readonly selectLibraryDetailMode: (mode: "media" | "files") => void;
  readonly openTorrentInWorkbench: (torrentId: string) => void;
  readonly openTorrentErrorDetail: (torrentId: string) => void;
  readonly clearDetailTarget: () => void;
  readonly clearTorrentSelection: () => void;
  readonly setCurrentPeer: (connectionId: string | null) => void;
  readonly selectTab: (tab: DetailTab) => void;
  readonly setDetailPanePercent: (percent: number) => void;
  readonly closeDetail: () => void;
  readonly toggleSidebar: () => void;
  readonly closeSidebar: () => void;
  readonly setLayout: (layout: PresentationState["layout"]) => void;
  readonly setInterfaceSize: (interfaceSize: InterfaceSize) => void;
  readonly setColorTheme: (colorTheme: ColorTheme) => void;
  readonly setDataUnits: (dataUnits: DataUnits) => void;
  readonly setLogCaptureProfile: (
    profile: PresentationState["logCaptureProfile"],
  ) => void;
  readonly setLogCaptureTorrent: (torrentId: string | null) => void;
  readonly setLogMinimumSeverity: (severity: LogRow["severity"]) => void;
  readonly setLogCategoryPrefix: (prefix: string) => void;
  readonly setLogSearch: (search: string) => void;
  readonly setLogDisplayScope: (scope: "all" | "current") => void;
  readonly toggleLogExpanded: (sequence: string) => void;
  readonly clearVisibleLogs: () => void;
  readonly setLogFollowing: (following: boolean) => void;
  readonly setSpeedRange: (range: SpeedRange) => void;
  readonly toggleSpeedMetric: (metric: SpeedMetric) => void;
  readonly resetSpeedPreferences: () => void;
  readonly setDhtVisualizationMode: (mode: DhtVisualizationMode) => void;
}

export type InspectionStore = InspectionState & InspectionActions;
export type InspectionStoreApi = StoreApi<InspectionStore>;

export const DEFAULT_DETAIL_PANE_PERCENT = 57;
export const MIN_DETAIL_PANE_PERCENT = 25;
export const MAX_DETAIL_PANE_PERCENT = 80;

const EMPTY_SNAPSHOT: InspectionSnapshot = {
  revision: 0,
  durableRevision: "0",
  session: {
    connection: { type: "connecting" },
    downloadRate: 0,
    uploadRate: 0,
    dhtNodes: null,
    knownPeers: 0,
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
    library: { status: "not_requested" },
    torrentSummary: { status: "not_requested" },
    peers: { status: "not_requested" },
    swarm: { status: "not_requested" },
    files: { status: "not_requested" },
    media: { status: "not_requested" },
    trackers: { status: "not_requested" },
    pieces: { status: "not_requested" },
    disk: { status: "not_requested" },
    dht: { status: "not_requested" },
    speed: { status: "not_requested" },
    logs: { status: "not_requested" },
  },
};

const DEFAULT_PRESENTATION: PresentationState = {
  destination: "workbench",
  libraryCategory: "all",
  transfersCategory: "all",
  workbenchCategory: "all",
  currentTorrentId: null,
  torrentSelectionInitialized: false,
  selectedTorrentIds: [],
  pendingRevealTorrentId: null,
  currentPeerId: null,
  activeTab: "peers",
  detailPanePercent: DEFAULT_DETAIL_PANE_PERCENT,
  detailOpen: false,
  libraryDetailOpen: false,
  libraryDetailMode: "media",
  detailTarget: null,
  sidebarOpen: false,
  layout: "wide",
  interfaceSize: DEFAULT_INTERFACE_SIZE,
  colorTheme: DEFAULT_COLOR_THEME,
  dataUnits: DEFAULT_DATA_UNITS,
  logCaptureProfile: "normal",
  logCaptureTorrentId: null,
  logMinimumSeverity: "info",
  logCategoryPrefix: "",
  logSearch: "",
  logDisplayScope: "current",
  logExpandedIds: [],
  logClearThroughSequence: null,
  logFollowing: true,
  speedRange: DEFAULT_SPEED_RANGE,
  speedMetrics: DEFAULT_SPEED_METRICS,
  dhtVisualizationMode: "normalized",
};

export function createInspectionStore(
  appearanceStorage?: AppearanceStorage | null,
): InspectionStoreApi {
  const appearance =
    appearanceStorage === undefined
      ? loadAppearancePreferences()
      : loadAppearancePreferences(appearanceStorage);
  const navigation =
    appearanceStorage === undefined
      ? loadNavigationPreferences()
      : loadNavigationPreferences(appearanceStorage);
  const speedPreferences =
    appearanceStorage === undefined
      ? loadSpeedPreferences()
      : loadSpeedPreferences(appearanceStorage);
  const dhtVisualizationMode =
    appearanceStorage === undefined
      ? loadDhtVisualizationMode()
      : loadDhtVisualizationMode(appearanceStorage);
  const initialPresentation = {
    ...DEFAULT_PRESENTATION,
    ...navigation,
    ...appearance,
    speedRange: speedPreferences.range,
    speedMetrics: speedPreferences.metrics,
    dhtVisualizationMode,
  };
  const persistAppearance = (preferences: AppearancePreferences) => {
    if (appearanceStorage === undefined) saveAppearancePreferences(preferences);
    else saveAppearancePreferences(preferences, appearanceStorage);
  };
  const persistNavigation = (preferences: NavigationPreferences) => {
    if (appearanceStorage === undefined) saveNavigationPreferences(preferences);
    else saveNavigationPreferences(preferences, appearanceStorage);
  };
  return createStore<InspectionStore>()((set) => ({
    ...EMPTY_SNAPSHOT,
    presentation: initialPresentation,
    applyUpdate: (update) => {
      set((state) => reduceInspectionUpdate(state, update));
    },
    selectDestination: (destination) => {
      set((state) => {
        const presentation = {
          ...state.presentation,
          destination,
          libraryDetailOpen:
            destination === "library"
              ? state.presentation.libraryDetailOpen
              : false,
          sidebarOpen: false,
          detailTarget: null,
        };
        persistNavigation(navigationPreferencesFor(presentation));
        return { presentation };
      });
    },
    selectLibraryCategory: (libraryCategory) => {
      set((state) => {
        const presentation = {
          ...state.presentation,
          libraryCategory,
          libraryDetailOpen: false,
          sidebarOpen: false,
        };
        persistNavigation(navigationPreferencesFor(presentation));
        return { presentation };
      });
    },
    selectTorrentCategory: (category) => {
      set((state) => {
        if (state.presentation.destination === "library") return state;
        // Drop selected torrents the new category hides so bulk actions
        // only reach rows the user can see.
        const selection = normalizeTorrentSelection(
          state.presentation.selectedTorrentIds.filter((torrentId) => {
            const torrent = state.torrents[torrentId];
            return (
              torrent !== undefined && torrentMatchesCategory(torrent, category)
            );
          }),
          state.presentation.currentTorrentId,
          state.torrents,
        );
        const currentChanged =
          selection.currentTorrentId !== state.presentation.currentTorrentId;
        const presentation = {
          ...state.presentation,
          ...(state.presentation.destination === "transfers"
            ? { transfersCategory: category }
            : { workbenchCategory: category }),
          ...selection,
          ...(currentChanged
            ? {
                currentPeerId: null,
                detailTarget: null,
                detailOpen:
                  selection.currentTorrentId === null
                    ? false
                    : state.presentation.detailOpen,
              }
            : {}),
          sidebarOpen: false,
        };
        persistNavigation(navigationPreferencesFor(presentation));
        return { presentation };
      });
    },
    setTorrentSelection: (torrentIds, currentTorrentId) => {
      set((state) => {
        const selection = normalizeTorrentSelection(
          torrentIds,
          currentTorrentId,
          state.torrents,
        );
        return {
          presentation: {
            ...state.presentation,
            ...selection,
            torrentSelectionInitialized: true,
            currentPeerId:
              selection.currentTorrentId === state.presentation.currentTorrentId
                ? state.presentation.currentPeerId
                : null,
            detailOpen:
              selection.currentTorrentId === null
                ? false
                : state.presentation.detailOpen,
            detailTarget: null,
          },
        };
      });
    },
    selectOnlyTorrent: (torrentId) => {
      set((state) =>
        state.torrents[torrentId] === undefined
          ? state
          : {
              presentation: {
                ...state.presentation,
                currentTorrentId: torrentId,
                torrentSelectionInitialized: true,
                selectedTorrentIds: [torrentId],
                currentPeerId: null,
                detailTarget: null,
              },
            },
      );
    },
    revealTorrent: (torrentId) => {
      set((state) => ({
        presentation: revealTorrentPresentation(
          state.presentation,
          torrentId,
          state.torrents[torrentId],
        ),
      }));
    },
    openTorrentDetail: (torrentId) => {
      set((state) => {
        if (state.torrents[torrentId] === undefined) return state;
        return {
          presentation: {
            ...state.presentation,
            currentTorrentId: torrentId,
            torrentSelectionInitialized: true,
            selectedTorrentIds: state.presentation.selectedTorrentIds.includes(
              torrentId,
            )
              ? state.presentation.selectedTorrentIds
              : [torrentId],
            currentPeerId: null,
            detailOpen: true,
            libraryDetailOpen: false,
            detailTarget: null,
          },
        };
      });
    },
    openLibraryTorrentDetail: (torrentId) => {
      set((state) => {
        if (state.torrents[torrentId] === undefined) return state;
        return {
          presentation: {
            ...state.presentation,
            destination: "library",
            currentTorrentId: torrentId,
            torrentSelectionInitialized: true,
            selectedTorrentIds: [torrentId],
            currentPeerId: null,
            libraryDetailOpen: true,
            libraryDetailMode: "media",
            detailTarget: null,
            sidebarOpen: false,
          },
        };
      });
    },
    closeLibraryTorrentDetail: () => {
      set((state) => ({
        presentation: {
          ...state.presentation,
          libraryDetailOpen: false,
        },
      }));
    },
    selectLibraryDetailMode: (libraryDetailMode) => {
      set((state) => ({
        presentation: {
          ...state.presentation,
          libraryDetailMode,
        },
      }));
    },
    openTorrentInWorkbench: (torrentId) => {
      set((state) => {
        if (state.torrents[torrentId] === undefined) return state;
        const presentation = {
          ...state.presentation,
          destination: "workbench" as const,
          currentTorrentId: torrentId,
          torrentSelectionInitialized: true,
          selectedTorrentIds: [torrentId],
          currentPeerId: null,
          detailOpen: true,
          libraryDetailOpen: false,
          detailTarget: null,
          sidebarOpen: false,
        };
        persistNavigation(navigationPreferencesFor(presentation));
        return { presentation };
      });
    },
    openTorrentErrorDetail: (torrentId) => {
      set((state) => {
        const torrent = state.torrents[torrentId];
        if (torrent === undefined || torrent.error === null) return state;
        const presentation = {
          ...state.presentation,
          destination: "workbench" as const,
          currentTorrentId: torrentId,
          torrentSelectionInitialized: true,
          selectedTorrentIds: [torrentId],
          currentPeerId: null,
          activeTab: "general" as const,
          detailOpen: true,
          libraryDetailOpen: false,
          detailTarget: { type: "torrent_error" as const, torrentId },
          sidebarOpen: false,
        };
        persistNavigation(navigationPreferencesFor(presentation));
        return { presentation };
      });
    },
    clearDetailTarget: () => {
      set((state) =>
        state.presentation.detailTarget === null
          ? state
          : {
              presentation: {
                ...state.presentation,
                detailTarget: null,
              },
            },
      );
    },
    clearTorrentSelection: () => {
      set((state) => ({
        presentation: {
          ...state.presentation,
          currentTorrentId: null,
          torrentSelectionInitialized: true,
          selectedTorrentIds: [],
          currentPeerId: null,
          detailOpen: false,
          libraryDetailOpen: false,
          detailTarget: null,
        },
      }));
    },
    setCurrentPeer: (connectionId) => {
      set((state) => ({
        presentation: { ...state.presentation, currentPeerId: connectionId },
      }));
    },
    selectTab: (activeTab) => {
      set((state) => ({
        presentation: { ...state.presentation, activeTab, detailTarget: null },
      }));
    },
    setSpeedRange: (speedRange) => {
      set((state) => {
        const speed = {
          range: speedRange,
          metrics: state.presentation.speedMetrics,
        };
        if (appearanceStorage === undefined) saveSpeedPreferences(speed);
        else saveSpeedPreferences(speed, appearanceStorage);
        return { presentation: { ...state.presentation, speedRange } };
      });
    },
    toggleSpeedMetric: (metric) => {
      set((state) => {
        const selected = state.presentation.speedMetrics;
        const speedMetrics = selected.includes(metric)
          ? selected.length === 1
            ? selected
            : selected.filter((candidate) => candidate !== metric)
          : selected.length >= 8
            ? selected
            : [...selected, metric];
        const speed = {
          range: state.presentation.speedRange,
          metrics: speedMetrics,
        };
        if (appearanceStorage === undefined) saveSpeedPreferences(speed);
        else saveSpeedPreferences(speed, appearanceStorage);
        return { presentation: { ...state.presentation, speedMetrics } };
      });
    },
    resetSpeedPreferences: () => {
      const speed = { range: DEFAULT_SPEED_RANGE, metrics: DEFAULT_SPEED_METRICS };
      if (appearanceStorage === undefined) saveSpeedPreferences(speed);
      else saveSpeedPreferences(speed, appearanceStorage);
      set((state) => ({
        presentation: {
          ...state.presentation,
          speedRange: speed.range,
          speedMetrics: speed.metrics,
        },
      }));
    },
    setDhtVisualizationMode: (dhtVisualizationMode) => {
      if (appearanceStorage === undefined) {
        saveDhtVisualizationMode(dhtVisualizationMode);
      } else {
        saveDhtVisualizationMode(dhtVisualizationMode, appearanceStorage);
      }
      set((state) => ({
        presentation: { ...state.presentation, dhtVisualizationMode },
      }));
    },
    setDetailPanePercent: (percent) => {
      set((state) => ({
        presentation: {
          ...state.presentation,
          detailPanePercent: clampDetailPanePercent(percent),
        },
      }));
    },
    closeDetail: () => {
      set((state) => ({
        presentation: {
          ...state.presentation,
          detailOpen: false,
          detailTarget: null,
        },
      }));
    },
    toggleSidebar: () => {
      set((state) => ({
        presentation: {
          ...state.presentation,
          sidebarOpen: !state.presentation.sidebarOpen,
        },
      }));
    },
    closeSidebar: () => {
      set((state) => ({
        presentation: { ...state.presentation, sidebarOpen: false },
      }));
    },
    setLayout: (layout) => {
      set((state) => ({
        presentation: { ...state.presentation, layout },
      }));
    },
    setInterfaceSize: (interfaceSize) => {
      set((state) => {
        persistAppearance({
          interfaceSize,
          colorTheme: state.presentation.colorTheme,
          dataUnits: state.presentation.dataUnits,
        });
        return {
          presentation: { ...state.presentation, interfaceSize },
        };
      });
    },
    setColorTheme: (colorTheme) => {
      set((state) => {
        persistAppearance({
          interfaceSize: state.presentation.interfaceSize,
          colorTheme,
          dataUnits: state.presentation.dataUnits,
        });
        return {
          presentation: { ...state.presentation, colorTheme },
        };
      });
    },
    setDataUnits: (dataUnits) => {
      set((state) => {
        persistAppearance({
          interfaceSize: state.presentation.interfaceSize,
          colorTheme: state.presentation.colorTheme,
          dataUnits,
        });
        return {
          presentation: { ...state.presentation, dataUnits },
        };
      });
    },
    setLogCaptureProfile: (logCaptureProfile) => {
      set((state) => ({
        presentation: { ...state.presentation, logCaptureProfile },
      }));
    },
    setLogCaptureTorrent: (logCaptureTorrentId) => {
      set((state) => ({
        presentation: { ...state.presentation, logCaptureTorrentId },
      }));
    },
    setLogMinimumSeverity: (logMinimumSeverity) => {
      set((state) => ({
        presentation: { ...state.presentation, logMinimumSeverity },
      }));
    },
    setLogCategoryPrefix: (logCategoryPrefix) => {
      set((state) => ({
        presentation: { ...state.presentation, logCategoryPrefix },
      }));
    },
    setLogSearch: (logSearch) => {
      set((state) => ({
        presentation: { ...state.presentation, logSearch },
      }));
    },
    setLogDisplayScope: (logDisplayScope) => {
      set((state) => ({
        presentation: { ...state.presentation, logDisplayScope },
      }));
    },
    toggleLogExpanded: (sequence) => {
      set((state) => {
        const expanded = state.presentation.logExpandedIds.includes(sequence);
        return {
          presentation: {
            ...state.presentation,
            logExpandedIds: expanded
              ? state.presentation.logExpandedIds.filter(
                  (id) => id !== sequence,
                )
              : [...state.presentation.logExpandedIds, sequence],
          },
        };
      });
    },
    clearVisibleLogs: () => {
      set((state) => ({
        presentation: {
          ...state.presentation,
          logClearThroughSequence: state.logs.at(-1)?.id ?? null,
          logExpandedIds: [],
        },
      }));
    },
    setLogFollowing: (logFollowing) => {
      set((state) => ({
        presentation: { ...state.presentation, logFollowing },
      }));
    },
  }));
}

export function reduceInspectionUpdate(
  state: InspectionState,
  update: InspectionUpdate,
): Partial<InspectionState> {
  if (update.type === "snapshot") {
    const previousCurrent = state.presentation.currentTorrentId;
    const torrentPresentation = repairTorrentPresentation(
      previousCurrent,
      state.presentation.selectedTorrentIds,
      state.presentation.torrentSelectionInitialized,
      update.snapshot.torrentOrder,
      update.snapshot.torrents,
    );
    const didReveal = state.presentation.pendingRevealTorrentId !== null &&
      update.snapshot.torrents[state.presentation.pendingRevealTorrentId] !== undefined
    const presentation = didReveal
        ? revealTorrentPresentation(
            state.presentation,
            state.presentation.pendingRevealTorrentId,
            update.snapshot.torrents[state.presentation.pendingRevealTorrentId],
          )
        : { ...state.presentation, ...torrentPresentation };
    const currentPeerId = repairCurrentPeerId(
      presentation.currentTorrentId === previousCurrent
        ? state.presentation.currentPeerId
        : null,
      presentation.currentTorrentId,
      update.snapshot.peersByTorrent,
    );
    return {
      ...update.snapshot,
      presentation: {
        ...presentation,
        currentPeerId,
        detailOpen:
          didReveal || torrentPresentation.currentTorrentId === previousCurrent
            ? state.presentation.detailOpen
            : false,
        libraryDetailOpen:
          torrentPresentation.currentTorrentId === previousCurrent
            ? state.presentation.libraryDetailOpen
            : false,
        detailTarget:
          torrentPresentation.currentTorrentId === previousCurrent
            ? state.presentation.detailTarget
            : null,
      },
    };
  }

  let torrents = state.torrents;
  let torrentOrder = state.torrentOrder;
  let peersByTorrent = state.peersByTorrent;
  let swarmByTorrent = state.swarmByTorrent;
  let filesByTorrent = state.filesByTorrent;
  let mediaByTorrent = state.mediaByTorrent;
  let trackersByTorrent = state.trackersByTorrent;
  let piecesByTorrent = state.piecesByTorrent;
  let disk = state.disk;
  let speed = state.speed;
  let logs = state.logs;
  let logLoss = state.logLoss;

  if (update.torrents !== undefined) {
    torrents = applyRows(
      state.torrents,
      update.torrents.upsert,
      update.torrents.removed,
      (row) => row.id,
    );
    torrentOrder =
      update.torrents.order ??
      state.torrentOrder.filter((id) => torrents[id] !== undefined);
  }

  if (update.peers !== undefined) {
    const nextPeerSets = { ...state.peersByTorrent };
    for (const patch of update.peers) {
      const current = state.peersByTorrent[patch.torrentId] ?? EMPTY_PEER_SET;
      const rows = applyRows(
        current.rows,
        patch.upsert,
        patch.removed,
        (row) => row.connectionId,
      );
      nextPeerSets[patch.torrentId] = {
        rows,
        order:
          patch.order ?? current.order.filter((id) => rows[id] !== undefined),
      };
    }
    peersByTorrent = nextPeerSets;
  }

  if (update.swarm !== undefined) {
    const nextSwarmSets = { ...state.swarmByTorrent };
    for (const patch of update.swarm) {
      const current = state.swarmByTorrent[patch.torrentId] ?? EMPTY_SWARM_SET;
      const rows = applyRows(
        current.rows,
        patch.upsert,
        patch.removed,
        (row) => row.recordId,
      );
      nextSwarmSets[patch.torrentId] = {
        state: patch.state,
        capturedMillis: patch.capturedMillis,
        maximumRecords: patch.maximumRecords,
        counts: patch.counts,
        rows,
        order:
          patch.order ?? current.order.filter((id) => rows[id] !== undefined),
      };
    }
    swarmByTorrent = nextSwarmSets;
  }

  if (update.files !== undefined) {
    const nextFileSets = { ...state.filesByTorrent };
    for (const patch of update.files) {
      const current = state.filesByTorrent[patch.torrentId] ?? EMPTY_FILE_SET;
      const rows = applyRows(
        current.rows,
        patch.upsert,
        patch.removed,
        (row) => row.id,
      );
      nextFileSets[patch.torrentId] = {
        state: patch.state ?? current.state,
        filesystemContentBase:
          patch.filesystemContentBase === undefined
            ? current.filesystemContentBase
            : patch.filesystemContentBase,
        page: current.page,
        rows,
        order:
          patch.order ?? current.order.filter((id) => rows[id] !== undefined),
      };
    }
    filesByTorrent = nextFileSets;
  }

  if (update.media !== undefined) {
    const nextMediaSets = { ...state.mediaByTorrent };
    for (const patch of update.media) {
      const current = state.mediaByTorrent[patch.torrentId] ?? EMPTY_MEDIA_SET;
      const rows = applyRows(
        current.rows,
        patch.upsert,
        patch.removed,
        (row) => row.id,
      );
      nextMediaSets[patch.torrentId] = {
        state: patch.state ?? current.state,
        totalNonPaddingFiles:
          patch.totalNonPaddingFiles ?? current.totalNonPaddingFiles,
        rows,
        order:
          patch.order ?? current.order.filter((id) => rows[id] !== undefined),
      };
    }
    mediaByTorrent = nextMediaSets;
  }

  if (update.trackers !== undefined) {
    const nextTrackerSets = { ...state.trackersByTorrent };
    for (const patch of update.trackers) {
      const current =
        state.trackersByTorrent[patch.torrentId] ?? EMPTY_TRACKER_SET;
      const rows = applyRows(
        current.rows,
        patch.upsert,
        patch.removed,
        (row) => row.id,
      );
      nextTrackerSets[patch.torrentId] = {
        state: patch.state ?? current.state,
        page: current.page,
        rows,
        order:
          patch.order ?? current.order.filter((id) => rows[id] !== undefined),
      };
    }
    trackersByTorrent = nextTrackerSets;
  }

  if (update.disk !== undefined) {
    disk = update.disk;
  }
  if (update.speed !== undefined) {
    speed = update.speed;
  }

  if (update.pieces !== undefined) {
    piecesByTorrent = update.pieces;
  }

  if (update.logs !== undefined) {
    const combined = [...state.logs, ...update.logs.append];
    const overflow = Math.max(0, combined.length - 2_048);
    logs = overflow === 0 ? combined : combined.slice(overflow);
    logLoss = {
      sourceEvictedCount: update.logs.sourceEvictedCount,
      retainedFromSequence: update.logs.retainedFromSequence,
      localEvictedCount: state.logLoss.localEvictedCount + overflow,
      deliveryResetCount: update.logs.deliveryResetCount,
      lastDeliveryResetReason: update.logs.lastDeliveryResetReason,
    };
  }

  const currentId = state.presentation.currentTorrentId;
  const torrentPresentation = repairTorrentPresentation(
    currentId,
    state.presentation.selectedTorrentIds,
    state.presentation.torrentSelectionInitialized,
    torrentOrder,
    torrents,
  );
  const revealedPresentation =
    state.presentation.pendingRevealTorrentId !== null &&
    torrents[state.presentation.pendingRevealTorrentId] !== undefined
      ? revealTorrentPresentation(
          state.presentation,
          state.presentation.pendingRevealTorrentId,
          torrents[state.presentation.pendingRevealTorrentId],
        )
      : { ...state.presentation, ...torrentPresentation };
  const currentPeerId = repairCurrentPeerId(
    revealedPresentation.pendingRevealTorrentId === null &&
      revealedPresentation.currentTorrentId !== currentId
      ? null
      : torrentPresentation.currentTorrentId === currentId
        ? state.presentation.currentPeerId
        : null,
    revealedPresentation.currentTorrentId,
    peersByTorrent,
  );

  return {
    revision: update.revision,
    durableRevision: update.durableRevision ?? state.durableRevision,
    session: update.session ?? state.session,
    demo: update.demo ?? state.demo,
    storage: update.storage ?? state.storage,
    clientSettings: update.clientSettings ?? state.clientSettings,
    torrents,
    torrentOrder,
    peersByTorrent,
    swarmByTorrent,
    filesByTorrent,
    mediaByTorrent,
    trackersByTorrent,
    piecesByTorrent,
    disk,
    speed,
    logs,
    logLoss,
    presentation: {
      ...revealedPresentation,
      currentPeerId,
      detailOpen:
        revealedPresentation.pendingRevealTorrentId === null &&
        revealedPresentation.currentTorrentId !== torrentPresentation.currentTorrentId
          ? state.presentation.detailOpen
          : torrentPresentation.currentTorrentId === currentId
          ? state.presentation.detailOpen
          : false,
      libraryDetailOpen:
        torrentPresentation.currentTorrentId === currentId
          ? state.presentation.libraryDetailOpen
          : false,
      detailTarget:
        torrentPresentation.currentTorrentId === currentId
          ? state.presentation.detailTarget
          : null,
    },
  };
}

function revealTorrentPresentation(
  presentation: PresentationState,
  torrentId: string,
  torrent: TorrentRow | undefined,
): PresentationState {
  if (torrent === undefined) {
    return { ...presentation, pendingRevealTorrentId: torrentId };
  }
  const category = torrent.archived ? "archived" : "all";
  return {
    ...presentation,
    ...(presentation.destination === "library"
      ? {
          libraryCategory: torrentMatchesLibraryCategory(
            torrent,
            presentation.libraryCategory,
            torrent.addedAtMs,
          )
            ? presentation.libraryCategory
            : category,
        }
      : presentation.destination === "transfers"
        ? {
            transfersCategory: torrentMatchesCategory(
              torrent,
              presentation.transfersCategory,
            )
              ? presentation.transfersCategory
              : category,
          }
        : {
            workbenchCategory: torrentMatchesCategory(
              torrent,
              presentation.workbenchCategory,
            )
              ? presentation.workbenchCategory
              : category,
          }),
    currentTorrentId: torrentId,
    selectedTorrentIds: [torrentId],
    torrentSelectionInitialized: true,
    pendingRevealTorrentId: null,
    currentPeerId: null,
    detailTarget: null,
  };
}

export function torrentMatchesCategory(
  torrent: TorrentRow,
  category: TorrentCategory,
): boolean {
  if (category === "archived") return torrent.archived === true;
  if (torrent.archived === true) return false;
  switch (category) {
    case "all":
      return true;
    case "active":
      return torrent.status === "metadata" || torrent.status === "downloading";
    case "downloading":
      return torrent.status === "downloading";
    case "completed":
      return torrent.status === "complete";
    case "paused":
      return torrent.status === "paused";
    case "errors":
      return torrent.status === "error";
  }
}

export function torrentMatchesLibraryCategory(
  torrent: TorrentRow,
  category: LibraryCategory,
  newestAddedAtMs: number | null,
): boolean {
  if (category === "archived") return torrent.archived === true;
  if (torrent.archived === true) return false;
  switch (category) {
    case "all":
      return true;
    case "recent":
      return (
        torrent.addedAtMs !== null &&
        newestAddedAtMs !== null &&
        torrent.addedAtMs >= newestAddedAtMs - 30 * 24 * 60 * 60 * 1_000
      );
    case "available":
      return torrent.status === "complete" && torrent.progress === 1;
    case "downloading":
      return torrent.status === "metadata" || torrent.status === "downloading";
  }
}

function navigationPreferencesFor(
  presentation: PresentationState,
): NavigationPreferences {
  return {
    destination: presentation.destination,
    libraryCategory: presentation.libraryCategory,
    transfersCategory: presentation.transfersCategory,
    workbenchCategory: presentation.workbenchCategory,
  };
}

function repairTorrentPresentation(
  currentTorrentId: string | null,
  selectedTorrentIds: readonly string[],
  initialized: boolean,
  torrentOrder: readonly string[],
  torrents: Readonly<Record<string, TorrentRow>>,
): Pick<
  PresentationState,
  "currentTorrentId" | "selectedTorrentIds" | "torrentSelectionInitialized"
> {
  const existing = uniqueExistingTorrentIds(selectedTorrentIds, torrents);
  const fallback = initialized
    ? (existing[0] ?? null)
    : (torrentOrder[0] ?? null);
  const current =
    currentTorrentId !== null &&
    torrents[currentTorrentId] !== undefined &&
    existing.includes(currentTorrentId)
      ? currentTorrentId
      : fallback;
  return {
    currentTorrentId: current,
    selectedTorrentIds:
      current === null ? [] : existing.includes(current) ? existing : [current],
    torrentSelectionInitialized: initialized || current !== null,
  };
}

function normalizeTorrentSelection(
  torrentIds: readonly string[],
  requestedCurrentId: string | null,
  torrents: Readonly<Record<string, TorrentRow>>,
): Pick<PresentationState, "currentTorrentId" | "selectedTorrentIds"> {
  const selectedTorrentIds = uniqueExistingTorrentIds(torrentIds, torrents);
  const currentTorrentId =
    requestedCurrentId !== null &&
    selectedTorrentIds.includes(requestedCurrentId)
      ? requestedCurrentId
      : (selectedTorrentIds[0] ?? null);
  return { currentTorrentId, selectedTorrentIds };
}

function uniqueExistingTorrentIds(
  torrentIds: readonly string[],
  torrents: Readonly<Record<string, TorrentRow>>,
): string[] {
  const seen = new Set<string>();
  const existing: string[] = [];
  for (const torrentId of torrentIds) {
    if (seen.has(torrentId) || torrents[torrentId] === undefined) continue;
    seen.add(torrentId);
    existing.push(torrentId);
  }
  return existing;
}

function repairCurrentPeerId(
  currentPeerId: string | null,
  currentTorrentId: string | null,
  peersByTorrent: Readonly<Record<string, PeerSet>>,
): string | null {
  if (currentPeerId === null || currentTorrentId === null) return null;
  return peersByTorrent[currentTorrentId]?.rows[currentPeerId] === undefined
    ? null
    : currentPeerId;
}

function applyRows<T>(
  current: Readonly<Record<string, T>>,
  upsert: readonly T[],
  removed: readonly string[],
  getId: (row: T) => string,
): Readonly<Record<string, T>> {
  if (upsert.length === 0 && removed.length === 0) return current;
  const next = { ...current };
  for (const id of removed) delete next[id];
  for (const row of upsert) next[getId(row)] = row;
  return next;
}

const EMPTY_PEER_SET: PeerSet = { order: [], rows: {} };
const EMPTY_SWARM_SET: SwarmSet = {
  state: "inactive",
  capturedMillis: 0,
  maximumRecords: 1_000,
  counts: {
    total: 0,
    eligible: 0,
    not_connectable: 0,
    dialing: 0,
    connected: 0,
    backed_off: 0,
    failure_limited: 0,
    banned: 0,
  },
  order: [],
  rows: {},
};
const EMPTY_FILE_SET: FileSet = {
  state: "metadata_pending",
  filesystemContentBase: null,
  page: { offset: 0, limit: 1024, total: 0, nextOffset: null },
  order: [],
  rows: {},
};
const EMPTY_MEDIA_SET: MediaSet = {
  state: "metadata_pending",
  totalNonPaddingFiles: 0,
  order: [],
  rows: {},
};
const EMPTY_TRACKER_SET: TrackerSet = {
  state: "available",
  page: { offset: 0, limit: 1024, total: 0, nextOffset: null },
  order: [],
  rows: {},
};

export function emptyDiskSet(): DiskSet {
  return {
    pipeline: {
      pressure: "idle",
      checkpointStage: "idle",
      intakeBackpressured: false,
      sampleMillis: 0,
      residentLimitBytes: 0,
      residentHighWatermarkBytes: 0,
      residentLowWatermarkBytes: 0,
      requestedBytes: 0,
      residentBytes: 0,
      queuedWriteBytes: 0,
      writingBytes: 0,
      hashingBytes: 0,
      checkpointDirtyPieces: 0,
      checkpointDirtyBytes: 0,
      checkpointDirtyPieceHighWater: 0,
      checkpointDirtyByteHighWater: 0,
      checkpointOldestDirtyMillis: 0,
      checkpointBatchesStarted: 0,
      checkpointBatchesCompleted: 0,
      checkpointPiecesCompleted: 0,
      checkpointSyncOperationsCompleted: 0,
      checkpointSyncServiceMicros: 0,
      checkpointSyncServiceMaxMicros: 0,
      checkpointCommitServiceMicros: 0,
      checkpointCommitServiceMaxMicros: 0,
      checkpointActiveMicros: null,
      storageJobsPending: 0,
      receivedBytesTotal: 0,
      storedBytesTotal: 0,
      verifiedBytesTotal: 0,
      receiveRateBytes: 0,
      writeRateBytes: 0,
      hashRateBytes: 0,
      writeOperationsStarted: 0,
      writeOperationsCompleted: 0,
      hashOperationsStarted: 0,
      hashOperationsCompleted: 0,
      writeQueueWaitMicros: 0,
      writeQueueWaitMaxMicros: 0,
      writeServiceMicros: 0,
      writeServiceMaxMicros: 0,
      hashQueueWaitMicros: 0,
      hashQueueWaitMaxMicros: 0,
      hashServiceMicros: 0,
      hashServiceMaxMicros: 0,
      pressureTransitionCount: 0,
      backpressuredMillisTotal: 0,
      lastError: null,
    },
    order: [],
    rows: {},
  };
}

export function emptyPieceMapSet(torrentId: string): PieceMapSet {
  return {
    torrentId,
    pieceCount: 0,
    verified: new Uint8Array(0),
    active: [],
    revision: 0,
  };
}

function clampDetailPanePercent(percent: number): number {
  if (!Number.isFinite(percent)) return DEFAULT_DETAIL_PANE_PERCENT;
  return Math.min(
    MAX_DETAIL_PANE_PERCENT,
    Math.max(MIN_DETAIL_PANE_PERCENT, Math.round(percent)),
  );
}
