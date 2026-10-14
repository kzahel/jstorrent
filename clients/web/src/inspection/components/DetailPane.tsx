import {
  formatList,
  message as localizedMessage,
} from "../../localization/runtime";
import { useEffect, useRef, useState, type MouseEvent } from "react";

import type { DataUnits } from "../appearance";
import { copyText } from "../clipboard";
import { useInspectionStore } from "../context";
import {
  checkingStatusLabel,
  formatBytes,
  formatDuration,
  formatElapsedSeconds,
  formatExactBytes,
  formatProgress,
  formatRate,
  formatShareRatio,
  torrentRemovalLabel,
  torrentVisibleProgress,
} from "../format";
import type { DetailTab } from "../model";
import { seedLimitReached, seedStopSummary } from "../seed-stop";
import type { DesktopRemoteAccess } from "../remote-access/types";
import { DETAIL_TABS, isSessionTab } from "../tabs";
import { PeerTable } from "./PeerTable";
import { SwarmTable } from "./SwarmTable";
import { FileTable } from "./FileTable";
import { TrackerTable } from "./TrackerTable";
import { DiskPanel } from "./DiskPanel";
import { PieceMapPanel } from "./PieceMapPanel";
import { PreparationProgress } from "./PreparationProgress";
import { LogConsole } from "./LogConsole";
import { SpeedPanel } from "./SpeedPanel";
import { DhtPanel } from "./DhtPanel";
import { Icon, type IconName } from "./Icon";
import { useToast } from "./Toast";
import { useTorrentActions } from "./TorrentActionContext";
import { TorrentActionMenuItems } from "./TorrentActionMenuItems";
import { TableToolbarSlot } from "./VirtualTable";
import {
  ActionMenuPopover,
  ActionMenuTrigger,
  OverlayButton,
} from "./overlays/AnchoredOverlay";
import styles from "./DetailPane.module.css";

export function DetailPane({
  remoteAccess,
}: {
  readonly remoteAccess?: DesktopRemoteAccess | undefined;
}) {
  const currentTorrentId = useInspectionStore(
    (state) => state.presentation.currentTorrentId,
  );
  const torrent = useInspectionStore((state) =>
    state.presentation.currentTorrentId === null
      ? undefined
      : state.torrents[state.presentation.currentTorrentId],
  );
  const activeTab = useInspectionStore((state) => state.presentation.activeTab);
  const layout = useInspectionStore((state) => state.presentation.layout);
  const interfaceSize = useInspectionStore(
    (state) => state.presentation.interfaceSize,
  );
  const detailOpen = useInspectionStore(
    (state) => state.presentation.detailOpen,
  );
  const selectTab = useInspectionStore((state) => state.selectTab);
  const closeDetail = useInspectionStore((state) => state.closeDetail);
  const tabsRef = useRef<HTMLDivElement>(null);
  const [toolbarSlot, setToolbarSlot] = useState<HTMLDivElement | null>(null);
  const sessionView = isSessionTab(activeTab);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const tabList = tabsRef.current;
      const active = tabList?.querySelector<HTMLElement>(
        `[data-tab-id="${activeTab}"]`,
      );
      if (tabList === null || active === null || active === undefined) return;
      const left = Math.max(
        0,
        active.offsetLeft - (tabList.clientWidth - active.offsetWidth) / 2,
      );
      if (typeof tabList.scrollTo === "function") {
        tabList.scrollTo({ left });
      } else {
        active.scrollIntoView?.({ block: "nearest", inline: "nearest" });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [activeTab, detailOpen, interfaceSize, layout]);

  const selectAdjacentTab = (tab: DetailTab, direction: -1 | 1) => {
    const index = DETAIL_TABS.findIndex((candidate) => candidate.id === tab);
    const next =
      DETAIL_TABS[
        (index + direction + DETAIL_TABS.length) % DETAIL_TABS.length
      ];
    if (next === undefined) return;
    selectTab(next.id);
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(`[data-tab-id="${next.id}"]`)
        ?.focus();
    });
  };

  return (
    <section
      className={styles.detail}
      aria-label={localizedMessage("inspection.components.detail.pane.torrent.details")}
      data-session-view={sessionView}
    >
      {layout !== "phone" ? null : (
        <div className={styles.appBar}>
          <button
            type="button"
            className={styles.appBarButton}
            aria-label={localizedMessage("inspection.components.detail.pane.back")}
            title={localizedMessage("inspection.components.detail.pane.back")}
            onClick={closeDetail}
          >
            <Icon name="arrowBack" />
          </button>
          <strong>
            {sessionView
              ? DETAIL_TABS.find((tab) => tab.id === activeTab)?.label
              : (torrent?.name ??
                localizedMessage("inspection.components.detail.pane.torrent.details"))}
          </strong>
          {sessionView || torrent === undefined ? null : (
            <DetailAppBarActions torrentId={torrent.id} />
          )}
        </div>
      )}
      <div className={styles.tabBar}>
        <div
          ref={tabsRef}
          className={styles.tabs}
          role="tablist"
          aria-label={localizedMessage("inspection.components.detail.pane.torrent.detail.views")}
        >
          {DETAIL_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`tab-${tab.id}`}
              data-tab-id={tab.id}
              data-tab-scope={tab.scope}
              aria-label={tab.label}
              aria-selected={activeTab === tab.id}
              aria-controls={`panel-${tab.id}`}
              tabIndex={activeTab === tab.id ? 0 : -1}
              onClick={() => selectTab(tab.id)}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  selectAdjacentTab(tab.id, -1);
                } else if (event.key === "ArrowRight") {
                  event.preventDefault();
                  selectAdjacentTab(tab.id, 1);
                }
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div ref={setToolbarSlot} className={styles.tableToolbarSlot} />
      </div>
      <TableToolbarSlot.Provider value={layout === "phone" ? null : toolbarSlot}>
        <div
          className={styles.panel}
          id={`panel-${activeTab}`}
          role="tabpanel"
          aria-labelledby={`tab-${activeTab}`}
        >
          {torrent === undefined && !sessionView ? (
            <EmptyDetail />
          ) : activeTab === "peers" && currentTorrentId !== null ? (
            <PeerTable torrentId={currentTorrentId} />
          ) : activeTab === "swarm" && currentTorrentId !== null ? (
            <SwarmTable torrentId={currentTorrentId} />
          ) : activeTab === "trackers" && currentTorrentId !== null ? (
            <TrackerTable torrentId={currentTorrentId} />
          ) : activeTab === "files" && currentTorrentId !== null ? (
            <FileTable torrentId={currentTorrentId} remoteAccess={remoteAccess} />
          ) : activeTab === "pieces" && currentTorrentId !== null ? (
            <PieceMapPanel torrentId={currentTorrentId} />
          ) : activeTab === "disk" ? (
            <DiskPanel />
          ) : activeTab === "speed" ? (
            <SpeedPanel />
          ) : activeTab === "dht" ? (
            <DhtPanel />
          ) : activeTab === "general" && torrent !== undefined ? (
            <GeneralDetail key={torrent.id} torrent={torrent} />
          ) : activeTab === "logs" ? (
            <LogConsole />
          ) : (
            <UnavailableDetail />
          )}
        </div>
      </TableToolbarSlot.Provider>
    </section>
  );
}

/** The narrow app bar's Start or Pause, with every other action under ⋮. */
function DetailAppBarActions({ torrentId }: { readonly torrentId: string }) {
  const { actionsFor, runAction } = useTorrentActions();
  const actions = actionsFor([torrentId]);
  const toggle = ["pause", "start"]
    .map((id) => actions.find((action) => action.id === id))
    .find((action) => action !== undefined && !action.disabled);
  const menuRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      {toggle === undefined ? null : (
        <button
          type="button"
          className={styles.appBarButton}
          aria-label={toggle.resolvedLabel}
          title={toggle.resolvedLabel}
          onClick={(event) =>
            void runAction(toggle.id, [torrentId], {
              type: "toolbar",
              element: event.currentTarget,
            })
          }
        >
          <Icon name={toggle.icon} />
        </button>
      )}
      <ActionMenuTrigger>
        <OverlayButton
          ref={menuRef}
          className={styles.appBarButton!}
          aria-label={localizedMessage("inspection.components.detail.pane.more.actions")}
        >
          <Icon name="moreVertical" />
        </OverlayButton>
        <ActionMenuPopover
          label={localizedMessage("inspection.components.detail.pane.more.actions")}
        >
          <TorrentActionMenuItems
            actions={actions.filter((action) => action !== toggle)}
            onAction={(actionId) =>
              void runAction(actionId, [torrentId], {
                type: "toolbar",
                element: menuRef.current,
              })
            }
          />
        </ActionMenuPopover>
      </ActionMenuTrigger>
    </>
  );
}

function GeneralDetail({
  torrent,
}: {
  readonly torrent: NonNullable<ReturnType<typeof useCurrentTorrent>>;
}) {
  const detailTarget = useInspectionStore(
    (state) => state.presentation.detailTarget,
  );
  const clearDetailTarget = useInspectionStore(
    (state) => state.clearDetailTarget,
  );
  const dataUnits = useInspectionStore((state) => state.presentation.dataUnits);
  const seedStopRatio = useInspectionStore(
    (state) => state.clientSettings.configured.seed_stop_ratio_percent,
  );
  const seedStopTime = useInspectionStore(
    (state) => state.clientSettings.configured.seed_stop_time_seconds,
  );
  const { runAction } = useTorrentActions();
  const toast = useToast();
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (
      detailTarget?.type !== "torrent_error" ||
      detailTarget.torrentId !== torrent.id
    ) {
      return;
    }
    const error = errorRef.current;
    if (error !== null) {
      error.scrollIntoView?.({ block: "nearest" });
      error.focus({ preventScroll: true });
    }
    clearDetailTarget();
  }, [clearDetailTarget, detailTarget, torrent.id]);

  const copyLink = (
    actionId: "copy_magnet" | "copy_share_link",
    element: HTMLElement,
  ) => {
    void runAction(actionId, [torrent.id], { type: "toolbar", element });
  };

  const copyInfoHash = (value: string) => {
    copyText(value).then(
      () =>
        toast.show({
          message: localizedMessage("inspection.components.detail.pane.info.hash.copied"),
        }),
      () =>
        toast.show({
          tone: "error",
          message: localizedMessage("inspection.components.detail.pane.copy.failed"),
        }),
    );
  };

  const checking = torrent.status === "checking" ? torrent.checking : null;
  const visibleProgress = torrentVisibleProgress(torrent);
  const progressLabel =
    torrent.status === "checking"
      ? checkingStatusLabel(torrent)
      : formatProgress(torrent.progress);
  const showFinished = torrent.finishedSeconds !== torrent.seedingSeconds;

  return (
    <div className={styles.general}>
      <header className={styles.generalHeader}>
        <div className={styles.generalTitle}>
          <h2 title={torrent.name}>{torrent.name}</h2>
          <div className={styles.copyActions}>
            <CopyButton
              icon="magnet"
              label={localizedMessage("inspection.components.detail.pane.copy.magnet.link")}
              onClick={(event) => copyLink("copy_magnet", event.currentTarget)}
            />
            <CopyButton
              icon="link"
              label={localizedMessage("inspection.components.detail.pane.copy.share.link")}
              onClick={(event) => copyLink("copy_share_link", event.currentTarget)}
            />
          </div>
        </div>
        <div className={styles.generalStatus}>
          <span>{generalStatusLabel(torrent)}</span>
          {visibleProgress === null ? null : (
            <strong>{formatProgress(visibleProgress)}</strong>
          )}
        </div>
        <span
          className={styles.generalProgress}
          data-indeterminate={visibleProgress === null || undefined}
          role="progressbar"
          aria-label={`${torrent.name} ${torrent.status === "checking" ? localizedMessage("inspection.components.detail.pane.checking") : localizedMessage("inspection.components.detail.pane.download")} progress: ${progressLabel}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={
            visibleProgress === null
              ? undefined
              : Math.round(visibleProgress * 100)
          }
        >
          {visibleProgress === null ? null : (
            <span style={{ width: `${Math.round(visibleProgress * 100)}%` }} />
          )}
        </span>
        {torrent.privateTorrent ? (
          <p className={styles.privateHint}>
            {localizedMessage("inspection.components.detail.pane.private.hint")}
          </p>
        ) : null}
      </header>
      {torrent.preparation == null ? null : (
        <PreparationProgress
          preparation={torrent.preparation}
          dataUnits={dataUnits}
        />
      )}
      {checking === null ? null : (
        <dl className={styles.metrics}>
          <Metric
            label={localizedMessage("inspection.components.detail.pane.pieces.checked")}
            value={`${checking.piecesProcessed.toLocaleString()} / ${checking.piecesTotal.toLocaleString()}`}
          />
          <Metric label={localizedMessage("inspection.components.detail.pane.matched")} value={checking.piecesMatched.toLocaleString()} />
          <Metric label={localizedMessage("inspection.components.detail.pane.absent")} value={checking.piecesAbsent.toLocaleString()} />
          <Metric
            label={localizedMessage("inspection.components.detail.pane.mismatched")}
            value={checking.piecesMismatched.toLocaleString()}
          />
          <Metric label={localizedMessage("inspection.components.detail.pane.checker.activity")} value={checkerActivity(checking)} />
        </dl>
      )}
      <dl className={styles.metrics}>
        <Metric
          label={localizedMessage("inspection.components.detail.pane.size")}
          value={formatBytes(torrent.sizeBytes, dataUnits)}
        />
        <Metric
          label={localizedMessage("inspection.components.detail.pane.downloaded")}
          value={formatExactBytes(torrent.lifetimeDownloadedBytes, dataUnits)}
        />
        <Metric
          label={localizedMessage("inspection.components.detail.pane.uploaded")}
          value={formatExactBytes(torrent.lifetimeUploadedBytes, dataUnits)}
        />
        <Metric label={localizedMessage("inspection.components.detail.pane.share.ratio")} value={formatShareRatio(torrent.shareRatioHundredths)} />
        <Metric label={localizedMessage("inspection.components.detail.pane.active.time")} value={formatElapsedSeconds(torrent.activeSeconds)} />
        {showFinished ? (
          <Metric label={localizedMessage("inspection.components.detail.pane.finished.time")} value={formatElapsedSeconds(torrent.finishedSeconds)} />
        ) : null}
        <Metric label={localizedMessage("inspection.components.detail.pane.seeding.time")} value={formatElapsedSeconds(torrent.seedingSeconds)} />
        {torrent.seedGoal === null ? null : (
          <Metric
            label={localizedMessage("inspection.components.detail.pane.seeding.goals")}
            value={seedGoalsReached(torrent.seedGoal)}
          />
        )}
        <Metric
          label={localizedMessage("inspection.components.detail.pane.speed")}
          value={transferSpeed(torrent, dataUnits)}
        />
        <Metric
          label={localizedMessage("inspection.components.detail.pane.peers")}
          value={
            torrent.peersKnown === null
              ? torrent.peersConnected.toLocaleString()
              : localizedMessage("inspection.components.detail.pane.peers.value", {
                  connected: torrent.peersConnected.toLocaleString(),
                  known: torrent.peersKnown.toLocaleString(),
                })
          }
        />
      </dl>
      {torrent.seedGoal === null && torrent.seedStop?.stopped !== true ? null : (
        <section
          className={styles.seedStop}
          aria-label={localizedMessage("inspection.components.detail.pane.stop.seeding")}
        >
          {seedStopSummary(torrent, {
            seed_stop_ratio_percent: seedStopRatio,
            seed_stop_time_seconds: seedStopTime,
          }).map((line) => (
            <p key={line}>{line}</p>
          ))}
        </section>
      )}
      <dl className={styles.identities}>
        {infoHashes(torrent).map(({ id, label, copyLabel, value }) => (
          <div key={id}>
            <dt>{label}</dt>
            <dd>
              <code>{value}</code>
              <CopyButton
                icon="copy"
                label={copyLabel}
                onClick={() => copyInfoHash(value)}
              />
            </dd>
          </div>
        ))}
      </dl>
      {torrent.error === null ? null : (
        <div ref={errorRef} className={styles.error} role="alert" tabIndex={-1}>
          <strong>{localizedMessage("inspection.components.detail.pane.storage.needs.attention")}</strong>
          <span>{torrent.error}</span>
        </div>
      )}
    </div>
  );
}

/** One line for the torrent's state; seeding uses the seeding state. */
function generalStatusLabel(
  torrent: NonNullable<ReturnType<typeof useCurrentTorrent>>,
): string {
  const removal = torrentRemovalLabel(torrent);
  if (removal !== null) return removal;
  if (seedLimitReached(torrent)) {
    return localizedMessage("inspection.components.detail.pane.state.seed.limit.reached");
  }
  if (torrent.status === "checking") {
    return torrent.checking?.phase === "hashing"
      ? operationalStateLabel("checking")
      : checkingStatusLabel(torrent);
  }
  if (torrent.operationalState === "seeding") {
    return seedAdmissionLabel(torrent.seedAdmission);
  }
  const state = operationalStateLabel(torrent.operationalState);
  // While working toward completion the reason says what is happening;
  // otherwise it repeats the state.
  return (torrent.operationalState === "downloading" ||
    torrent.operationalState === "starting") &&
    torrent.progressReason !== ""
    ? `${state} · ${torrent.progressReason}`
    : state;
}

function infoHashes(
  torrent: NonNullable<ReturnType<typeof useCurrentTorrent>>,
): readonly {
  readonly id: string;
  readonly label: string;
  readonly copyLabel: string;
  readonly value: string;
}[] {
  const identities = torrent.protocolIdentities;
  if (identities?.v1 != null && identities.v2 != null) {
    return [
      {
        id: "v1",
        label: localizedMessage("inspection.components.detail.pane.info.hash.v1"),
        copyLabel: localizedMessage("inspection.components.detail.pane.copy.info.hash.v1"),
        value: identities.v1,
      },
      {
        id: "v2",
        label: localizedMessage("inspection.components.detail.pane.info.hash.v2"),
        copyLabel: localizedMessage("inspection.components.detail.pane.copy.info.hash.v2"),
        value: identities.v2,
      },
    ];
  }
  return [
    {
      id: "hash",
      label: localizedMessage("inspection.components.detail.pane.info.hash"),
      copyLabel: localizedMessage("inspection.components.detail.pane.copy.info.hash"),
      value: torrent.infoHash,
    },
  ];
}

function CopyButton({
  icon,
  label,
  onClick,
}: {
  readonly icon: IconName;
  readonly label: string;
  readonly onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      className={styles.copyButton}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <Icon name={icon} />
    </button>
  );
}

function transferSpeed(
  torrent: NonNullable<ReturnType<typeof useCurrentTorrent>>,
  dataUnits: DataUnits,
): string {
  const download = formatRate(torrent.downloadRate, dataUnits);
  const upload = formatRate(torrent.uploadRate, dataUnits);
  const downloading = torrent.downloadRate > 0;
  const uploading = (torrent.uploadRate ?? 0) > 0;
  if (downloading && uploading) {
    return localizedMessage("inspection.components.detail.pane.speed.value", {
      download,
      upload,
    });
  }
  if (downloading) {
    return localizedMessage("inspection.components.detail.pane.speed.down", { download });
  }
  if (uploading) {
    return localizedMessage("inspection.components.detail.pane.speed.up", { upload });
  }
  return "—";
}

function operationalStateLabel(
  state: NonNullable<ReturnType<typeof useCurrentTorrent>>["operationalState"],
): string {
  switch (state) {
    case "queued":
      return localizedMessage("inspection.components.detail.pane.state.queued");
    case "starting":
      return localizedMessage("inspection.components.detail.pane.state.starting");
    case "downloading":
      return localizedMessage("inspection.components.detail.pane.state.downloading");
    case "checking":
      return localizedMessage("inspection.components.detail.pane.state.checking");
    case "stopping":
      return localizedMessage("inspection.components.detail.pane.state.stopping");
    case "seeding":
      return localizedMessage("inspection.components.detail.pane.state.seeding");
    case "paused":
      return localizedMessage("inspection.components.detail.pane.state.paused");
    case "error":
      return localizedMessage("inspection.components.detail.pane.state.error");
  }
}

function seedAdmissionLabel(
  admission: NonNullable<ReturnType<typeof useCurrentTorrent>>["seedAdmission"],
): string {
  switch (admission) {
    case "active":
      return localizedMessage("inspection.components.detail.pane.seed.state.seeding");
    case "queued":
      return localizedMessage("inspection.components.detail.pane.seed.state.queued");
    case "inactive_exempt":
      return localizedMessage("inspection.components.detail.pane.seed.state.idle");
    case "ineligible":
      return localizedMessage("inspection.components.detail.pane.seed.state.not.seeding");
  }
}

function seedGoalsReached(
  goal: NonNullable<
    NonNullable<ReturnType<typeof useCurrentTorrent>>["seedGoal"]
  >,
): string {
  const reached = [
    goal.share_ratio_met ? localizedMessage("inspection.components.detail.pane.goal.share.ratio") : null,
    goal.finished_download_ratio_met
      ? localizedMessage("inspection.components.detail.pane.goal.seeding.download.time")
      : null,
    goal.finished_time_met ? localizedMessage("inspection.components.detail.pane.goal.seeding.time") : null,
  ].filter((value): value is string => value !== null);
  return reached.length === 0
    ? localizedMessage("inspection.components.detail.pane.goals.none.reached")
    : localizedMessage("inspection.components.detail.pane.goals.reached", { goals: formatList(reached) });
}

function checkerActivity(
  checking: NonNullable<ReturnType<typeof useCurrentTorrent>>["checking"],
): string {
  if (checking === null) return localizedMessage("inspection.components.detail.pane.waiting");
  if (checking.oldestActiveJobAgeMs !== null) {
    return `${checking.activeHashJobs.toLocaleString()} active · oldest ${formatDuration(checking.oldestActiveJobAgeMs)}`;
  }
  if (checking.queuedHashJobs > 0) {
    return `${checking.queuedHashJobs.toLocaleString()} queued · last advance ${formatDuration(checking.lastAdvanceAgeMs)} ago`;
  }
  return `Last advance ${formatDuration(checking.lastAdvanceAgeMs)} ago`;
}

function useCurrentTorrent() {
  return useInspectionStore((state) =>
    state.presentation.currentTorrentId === null
      ? undefined
      : state.torrents[state.presentation.currentTorrentId],
  );
}

function Metric({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function EmptyDetail() {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyMark} aria-hidden="true">
        ↙
      </span>
      <strong>{localizedMessage("inspection.components.detail.pane.select.a.torrent.to.see.its.details")}</strong>
    </div>
  );
}

function UnavailableDetail() {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyMark} aria-hidden="true">
        ◇
      </span>
      <strong>{localizedMessage("inspection.components.detail.pane.nothing.to.show")}</strong>
    </div>
  );
}
