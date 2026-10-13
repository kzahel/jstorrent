import {
  formatList,
  message as localizedMessage,
} from "../../localization/runtime";
import { useEffect, useRef } from "react";

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
import type { DesktopRemoteAccess } from "../remote-access/types";
import { DETAIL_TABS } from "../tabs";
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
    <section className={styles.detail} aria-label={localizedMessage("inspection.components.detail.pane.torrent.details")}>
      <div className={styles.mobileHeading}>
        <button type="button" onClick={closeDetail}>
          <span aria-hidden="true">←</span>
          <span>{localizedMessage("inspection.components.detail.pane.torrents")}</span>
        </button>
        <strong>{torrent?.name ?? localizedMessage("inspection.components.detail.pane.torrent.details")}</strong>
      </div>
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
      <div
        className={styles.panel}
        id={`panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`tab-${activeTab}`}
      >
        {torrent === undefined &&
        activeTab !== "logs" &&
        activeTab !== "disk" &&
        activeTab !== "speed" &&
        activeTab !== "dht" ? (
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
          <GeneralDetail torrent={torrent} />
        ) : activeTab === "logs" ? (
          <LogConsole />
        ) : (
          <UnavailableDetail />
        )}
      </div>
    </section>
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

  const checking = torrent.status === "checking" ? torrent.checking : null;
  const visibleProgress = torrentVisibleProgress(torrent);
  const progressLabel =
    torrent.status === "checking"
      ? checkingStatusLabel(torrent)
      : formatProgress(torrent.progress);

  return (
    <div className={styles.general}>
      <section className={styles.summaryCard}>
        <div>
          <p className={styles.eyebrow}>
            {torrent.status === "checking" ? localizedMessage("inspection.components.detail.pane.current.check") : localizedMessage("inspection.components.detail.pane.current.transfer")}
          </p>
          <h2>{torrent.name}</h2>
          <p>
            {torrent.status === "checking"
              ? checkingStatusLabel(torrent)
              : torrent.progressReason}
          </p>
        </div>
        <div className={styles.largeProgress}>
          <strong>{progressLabel}</strong>
          <span
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
        </div>
      </section>
      {torrent.preparation == null ? null : (
        <PreparationProgress
          preparation={torrent.preparation}
          dataUnits={dataUnits}
        />
      )}
      {checking === null ? null : (
        <dl className={`${styles.metrics} ${styles.checkingMetrics}`}>
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
          label={localizedMessage("inspection.components.detail.pane.status")}
          value={
            torrentRemovalLabel(torrent) ?? operationalStateLabel(torrent.operationalState)
          }
        />
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
        <Metric label={localizedMessage("inspection.components.detail.pane.finished.time")} value={formatElapsedSeconds(torrent.finishedSeconds)} />
        <Metric label={localizedMessage("inspection.components.detail.pane.seeding.time")} value={formatElapsedSeconds(torrent.seedingSeconds)} />
        <Metric
          label={localizedMessage("inspection.components.detail.pane.download.speed")}
          value={formatRate(torrent.downloadRate, dataUnits)}
        />
        <Metric
          label={localizedMessage("inspection.components.detail.pane.upload.speed")}
          value={formatRate(torrent.uploadRate, dataUnits)}
        />
        <Metric
          label={localizedMessage("inspection.components.detail.pane.connected.peers")}
          value={torrent.peersConnected.toLocaleString()}
        />
        <Metric
          label={localizedMessage("inspection.components.detail.pane.known.peers")}
          value={torrent.peersKnown?.toLocaleString() ?? "—"}
        />
        {torrent.seedGoal === null ? null : (
          <Metric
            label={localizedMessage("inspection.components.detail.pane.seeding")}
            value={`${seedAdmissionLabel(torrent.seedAdmission)} · ${
              torrent.seedGoal.status === "met"
                ? localizedMessage("inspection.components.detail.pane.goal.reached")
                : localizedMessage("inspection.components.detail.pane.goal.not.reached")
            }`}
          />
        )}
      </dl>
      {torrent.seedGoal === null ? null : (
        <p>{seedGoalsReached(torrent.seedGoal)}</p>
      )}
      {torrent.protocolIdentities?.v1 != null &&
      torrent.protocolIdentities.v2 != null ? (
        <>
          <div className={styles.identity}>
            <span>{localizedMessage("inspection.components.detail.pane.info.hash.v1")}</span>
            <code>{torrent.protocolIdentities.v1}</code>
          </div>
          <div className={styles.identity}>
            <span>{localizedMessage("inspection.components.detail.pane.info.hash.v2")}</span>
            <code>{torrent.protocolIdentities.v2}</code>
          </div>
        </>
      ) : (
        <div className={styles.identity}>
          <span>{localizedMessage("inspection.components.detail.pane.info.hash")}</span>
          <code>{torrent.infoHash}</code>
        </div>
      )}
      {torrent.error === null ? null : (
        <div ref={errorRef} className={styles.error} role="alert" tabIndex={-1}>
          <strong>{localizedMessage("inspection.components.detail.pane.storage.needs.attention")}</strong>
          <span>{torrent.error}</span>
        </div>
      )}
    </div>
  );
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
      <strong>{localizedMessage("inspection.components.detail.pane.select.a.torrent.to.inspect.it")}</strong>
      <p>{localizedMessage("inspection.components.detail.pane.the.detail.surface.preserves.its.tab.and")}</p>
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
