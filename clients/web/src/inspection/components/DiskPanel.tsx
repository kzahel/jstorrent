import { formatNumber, message as localizedMessage, useProductLocale  } from "../../localization/runtime";
import { useMemo, type CSSProperties } from "react";

import { useInspectionStore } from "../context";
import type { DataUnits } from "../appearance";
import { formatBytes, formatRate } from "../format";
import type { DiskPieceRow, DiskPipeline, ViewMaterialization } from "../model";
import { VirtualTable, type VirtualColumn } from "./VirtualTable";
import styles from "./DiskPanel.module.css";

const diskColumns = (
  dataUnits: DataUnits,
): readonly VirtualColumn<DiskPieceRow>[] => [
  {
    id: "torrent",
    listRole: "title",
    label: localizedMessage("inspection.components.disk.panel.torrent"),
    width: 210,
    minimumWidth: 130,
    maximumWidth: 520,
    sortValue: (row) => row.torrentName,
    render: (row) => <span title={row.torrentName}>{row.torrentName}</span>,
  },
  {
    id: "piece",
    listRole: "subtitle",
    label: localizedMessage("inspection.components.disk.panel.piece"),
    width: 76,
    align: "right",
    sortKind: "number",
    sortValue: (row) => row.pieceIndex,
    render: (row) => formatNumber(row.pieceIndex),
  },
  {
    id: "stage",
    listRole: "trailing",
    label: localizedMessage("inspection.components.disk.panel.state"),
    width: 112,
    sortValue: (row) => row.stage,
    sortOrder: [
      "failed",
      "checkpoint_committing",
      "checkpoint_syncing",
      "checkpoint_dirty",
      "hashing",
      "writing",
      "queued",
      "receiving",
      "stored",
    ],
    render: (row) => (
      <span className={styles.stage} data-stage={row.stage}>
        <span aria-hidden="true" />
        {titleCase(row.stage)}
      </span>
    ),
  },
  {
    id: "requested",
    listRole: "detail",
    label: localizedMessage("inspection.components.disk.panel.requested"),
    width: 96,
    align: "right",
    sortKind: "number",
    sortValue: (row) => row.requestedBytes,
    render: (row) => formatBytes(row.requestedBytes, dataUnits),
  },
  {
    id: "received",
    listRole: "detail",
    label: localizedMessage("inspection.components.disk.panel.received"),
    width: 92,
    align: "right",
    sortKind: "number",
    sortValue: (row) => row.receivedBytes,
    render: (row) => formatBytes(row.receivedBytes, dataUnits),
  },
  {
    id: "stored",
    listRole: "detail",
    label: localizedMessage("inspection.components.disk.panel.stored"),
    width: 88,
    align: "right",
    sortKind: "number",
    sortValue: (row) => row.storedBytes,
    render: (row) => formatBytes(row.storedBytes, dataUnits),
  },
  {
    id: "queueAge",
    label: localizedMessage("inspection.components.disk.panel.state.age"),
    width: 90,
    align: "right",
    sortKind: "number",
    sortValue: (row) => row.stageAgeMillis,
    render: (row) => formatDuration(row.stageAgeMillis),
  },
  {
    id: "age",
    label: localizedMessage("inspection.components.disk.panel.age"),
    width: 86,
    align: "right",
    defaultVisible: false,
    sortKind: "number",
    sortValue: (row) => row.ageMillis,
    render: (row) => formatDuration(row.ageMillis),
  },
  {
    id: "attempt",
    label: localizedMessage("inspection.components.disk.panel.attempt"),
    width: 82,
    align: "right",
    defaultVisible: false,
    sortKind: "number",
    sortValue: (row) => row.attempt,
    render: (row) => formatNumber(row.attempt),
  },
  {
    id: "error",
    label: localizedMessage("inspection.components.disk.panel.error"),
    width: 300,
    minimumWidth: 140,
    maximumWidth: 680,
    sortValue: (row) => row.error,
    render: (row) => (
      <span title={row.error ?? undefined}>{row.error ?? "—"}</span>
    ),
  },
];

export function DiskPanel() {
  const disk = useInspectionStore((state) => state.disk);
  const materialization = useInspectionStore((state) => state.viewStatus.disk);
  const interfaceSize = useInspectionStore(
    (state) => state.presentation.interfaceSize,
  );
  const dataUnits = useInspectionStore((state) => state.presentation.dataUnits);
  const locale = useProductLocale();
  const displayColumns = useMemo(() => diskColumns(dataUnits), [locale, dataUnits]);
  const rows = useMemo(
    () =>
      disk.order
        .map((id) => disk.rows[id])
        .filter((row): row is DiskPieceRow => row !== undefined),
    [disk],
  );
  return (
    <div className={styles.panel}>
      <DiskSummary
        pipeline={disk.pipeline}
        activePieces={rows.length}
        dataUnits={dataUnits}
      />
      <section
        className={styles.tableSection}
        aria-labelledby="active-disk-pieces"
      >
        <div className={styles.tableHeading}>
          <div>
            <h2 id="active-disk-pieces">{localizedMessage("inspection.components.disk.panel.active.storage.pieces")}</h2>
          </div>
          <span>{formatNumber(rows.length)}{" "}{localizedMessage("inspection.components.disk.panel.active")}</span>
        </div>
        <VirtualTable
          tableId="session-disk-pieces"
          label={localizedMessage("inspection.components.disk.panel.active.storage.pieces")}
          rows={rows}
          getRowId={(row) => row.id}
          columns={displayColumns}
          interfaceSize={interfaceSize}
          emptyMessage={diskEmptyMessage(materialization)}
          initialSort={{ columnId: "queueAge", direction: "desc" }}
        />
      </section>
    </div>
  );
}

function DiskSummary({
  pipeline,
  activePieces,
  dataUnits,
}: {
  readonly pipeline: DiskPipeline;
  readonly activePieces: number;
  readonly dataUnits: DataUnits;
}) {
  const pipelineMaximum = Math.max(
    1,
    pipeline.residentLimitBytes,
    pipeline.requestedBytes,
    pipeline.residentBytes,
  );
  const stages = [
    [localizedMessage("inspection.components.disk.panel.stage.label.requested"), pipeline.requestedBytes],
    [localizedMessage("inspection.components.disk.panel.stage.label.resident"), pipeline.residentBytes],
    [localizedMessage("inspection.components.disk.panel.stage.label.queued.write"), pipeline.queuedWriteBytes],
    [localizedMessage("inspection.components.disk.panel.stage.label.writing"), pipeline.writingBytes],
    [localizedMessage("inspection.components.disk.panel.stage.label.hashing"), pipeline.hashingBytes],
    [localizedMessage("inspection.components.disk.panel.stage.label.checkpoint.dirty"), pipeline.checkpointDirtyBytes],
  ] as const;
  const pressureLabel = titleCase(pipeline.pressure);
  return (
    <section className={styles.summary} aria-labelledby="disk-pipeline-title">
      <div className={styles.summaryHeading}>
        <div>
          <p className={styles.eyebrow}>{localizedMessage("inspection.components.disk.panel.session.storage")}</p>
          <h2 id="disk-pipeline-title">{localizedMessage("inspection.components.disk.panel.receive.write.verify.checkpoint")}</h2>
        </div>
        <span className={styles.pressure} data-pressure={pipeline.pressure}>
          <span aria-hidden="true" />
          {pressureLabel}
        </span>
      </div>
      <div
        className={styles.pipeline}
        aria-label={localizedMessage("inspection.components.disk.panel.presentation.pressure.description", { pressure: pressureLabel })}
      >
        {stages.map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{formatBytes(value, dataUnits)}</strong>
            <span className={styles.bar} aria-hidden="true">
              <span
                style={
                  {
                    "--disk-fill": `${value === 0 ? 0 : Math.max(2, Math.min(100, (value / pipelineMaximum) * 100))}%`,
                  } as CSSProperties
                }
              />
            </span>
          </div>
        ))}
      </div>
      <dl className={styles.metrics}>
        <Metric
          label={localizedMessage("inspection.components.disk.panel.resident.limit")}
          value={`${formatBytes(pipeline.residentBytes, dataUnits)} / ${formatBytes(pipeline.residentLimitBytes, dataUnits)}`}
          detail={localizedMessage("inspection.components.disk.panel.presentation.watermarks", { high: formatBytes(pipeline.residentHighWatermarkBytes, dataUnits), low: formatBytes(pipeline.residentLowWatermarkBytes, dataUnits) })}
        />
        <Metric
          label={localizedMessage("inspection.components.disk.panel.receive.write")}
          value={`${formatRate(pipeline.receiveRateBytes, dataUnits)} / ${formatRate(pipeline.writeRateBytes, dataUnits)}`}
          detail={localizedMessage("inspection.components.disk.panel.presentation.sample.duration", { duration: formatDuration(pipeline.sampleMillis) })}
        />
        <Metric
          label={localizedMessage("inspection.components.disk.panel.stored.verified")}
          value={`${formatBytes(pipeline.storedBytesTotal, dataUnits)} / ${formatBytes(pipeline.verifiedBytesTotal, dataUnits)}`}
          detail={localizedMessage("inspection.components.disk.panel.presentation.verify.rate", { rate: formatRate(pipeline.hashRateBytes, dataUnits) })}
        />
        <Metric
          label={localizedMessage("inspection.components.disk.panel.pending.work")}
          value={localizedMessage("inspection.components.disk.panel.presentation.pending.counts", { jobs: pipeline.storageJobsPending, pieces: activePieces })}
          detail={localizedMessage("inspection.components.disk.panel.presentation.pressure.transitions", { count: pipeline.pressureTransitionCount })}
        />
        <Metric
          label={localizedMessage("inspection.components.disk.panel.write.queue.wait")}
          value={formatMicros(pipeline.writeQueueWaitMaxMicros)}
          detail={localizedMessage("inspection.components.disk.panel.presentation.queue.cumulative", { duration: formatMicros(pipeline.writeQueueWaitMicros) })}
        />
        <Metric
          label={localizedMessage("inspection.components.disk.panel.write.service")}
          value={formatMicros(pipeline.writeServiceMaxMicros)}
          detail={localizedMessage("inspection.components.disk.panel.presentation.write.operations", { completed: pipeline.writeOperationsCompleted, started: pipeline.writeOperationsStarted })}
        />
        <Metric
          label={localizedMessage("inspection.components.disk.panel.hash.service")}
          value={formatMicros(pipeline.hashServiceMaxMicros)}
          detail={localizedMessage("inspection.components.disk.panel.presentation.hash.operations", { completed: pipeline.hashOperationsCompleted, started: pipeline.hashOperationsStarted })}
        />
        <Metric
          label={localizedMessage("inspection.components.disk.panel.checkpoint.backlog")}
          value={localizedMessage("inspection.components.disk.panel.presentation.checkpoint.backlog.value", { pieces: pipeline.checkpointDirtyPieces, bytes: formatBytes(pipeline.checkpointDirtyBytes, dataUnits) })}
          detail={localizedMessage("inspection.components.disk.panel.presentation.checkpoint.backlog.detail", { duration: formatDuration(pipeline.checkpointOldestDirtyMillis), pieces: pipeline.checkpointDirtyPieceHighWater, bytes: formatBytes(pipeline.checkpointDirtyByteHighWater, dataUnits) })}
        />
        <Metric
          label={localizedMessage("inspection.components.disk.panel.checkpoint.stage")}
          value={titleCase(pipeline.checkpointStage)}
          detail={
            pipeline.checkpointActiveMicros === null
              ? localizedMessage("inspection.components.disk.panel.presentation.checkpoint.batches", { completed: pipeline.checkpointBatchesCompleted, started: pipeline.checkpointBatchesStarted })
              : localizedMessage("inspection.components.disk.panel.presentation.checkpoint.active", { duration: formatMicros(pipeline.checkpointActiveMicros) })
          }
        />
        <Metric
          label={localizedMessage("inspection.components.disk.panel.disk.sync")}
          value={formatMicros(pipeline.checkpointSyncServiceMaxMicros)}
          detail={localizedMessage("inspection.components.disk.panel.presentation.sync.cumulative", { duration: formatMicros(pipeline.checkpointSyncServiceMicros), count: pipeline.checkpointSyncOperationsCompleted })}
        />
        <Metric
          label={localizedMessage("inspection.components.disk.panel.checkpoint.commit")}
          value={formatMicros(pipeline.checkpointCommitServiceMaxMicros)}
          detail={localizedMessage("inspection.components.disk.panel.presentation.commit.cumulative", { duration: formatMicros(pipeline.checkpointCommitServiceMicros), count: pipeline.checkpointPiecesCompleted })}
        />
        <Metric
          label={localizedMessage("inspection.components.disk.panel.backpressured")}
          value={formatDuration(pipeline.backpressuredMillisTotal)}
          detail={
            pipeline.intakeBackpressured
              ? localizedMessage("inspection.components.disk.panel.presentation.intake.paused")
              : localizedMessage("inspection.components.disk.panel.presentation.intake.open")
          }
        />
      </dl>
      {pipeline.lastError === null ? null : (
        <div className={styles.error} role="alert">
          <strong>{localizedMessage("inspection.components.disk.panel.storage.error")}</strong>
          <span>{pipeline.lastError}</span>
        </div>
      )}
    </section>
  );
}

function Metric({
  label,
  value,
  detail,
}: {
  readonly label: string;
  readonly value: string;
  readonly detail: string;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        <span>{value}</span>
        <small>{detail}</small>
      </dd>
    </div>
  );
}

function diskEmptyMessage(materialization: ViewMaterialization): string {
  switch (materialization.status) {
    case "not_requested":
      return localizedMessage("inspection.components.disk.panel.disk.state.is.not.requested");
    case "loading":
      // Blank, like the peer table: a loading label only flickers.
      return "";
    case "unavailable":
    case "unsupported":
      return materialization.reason;
    case "stale":
    case "ready":
      return localizedMessage("inspection.components.disk.panel.no.pieces.are.waiting.on.storage");
  }
}

function formatMicros(micros: number): string {
  return formatDuration(micros / 1_000);
}

function formatDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return localizedMessage("inspection.components.disk.panel.0.ms");
  if (milliseconds < 1_000) return `${Math.round(milliseconds)} ms`;
  if (milliseconds < 60_000) {
    const digits = milliseconds < 10_000 ? 1 : 0;
    return `${formatNumber(milliseconds / 1_000, { useGrouping: false, minimumFractionDigits: digits, maximumFractionDigits: digits })} s`;
  }
  return `${Math.floor(milliseconds / 60_000)}m ${Math.floor((milliseconds % 60_000) / 1_000)}s`;
}

function titleCase(value: string): string {
  switch (value) {
    case "receiving": return localizedMessage("inspection.components.disk.panel.value.receiving");
    case "queued": return localizedMessage("inspection.components.disk.panel.value.queued");
    case "writing": return localizedMessage("inspection.components.disk.panel.value.writing");
    case "stored": return localizedMessage("inspection.components.disk.panel.value.stored");
    case "hashing": return localizedMessage("inspection.components.disk.panel.value.hashing");
    case "checkpoint_dirty": return localizedMessage("inspection.components.disk.panel.value.checkpoint.dirty");
    case "checkpoint_syncing": return localizedMessage("inspection.components.disk.panel.value.checkpoint.syncing");
    case "checkpoint_committing": return localizedMessage("inspection.components.disk.panel.value.checkpoint.committing");
    case "failed": return localizedMessage("inspection.components.disk.panel.value.failed");
    case "idle": return localizedMessage("inspection.components.disk.panel.value.idle");
    case "normal": return localizedMessage("inspection.components.disk.panel.value.normal");
    case "backpressured": return localizedMessage("inspection.components.disk.panel.value.backpressured");
    case "draining": return localizedMessage("inspection.components.disk.panel.value.draining");
    case "error": return localizedMessage("inspection.components.disk.panel.value.error");
    case "syncing": return localizedMessage("inspection.components.disk.panel.value.syncing");
    case "committing": return localizedMessage("inspection.components.disk.panel.value.committing");
    default: return value.slice(0, 1).toUpperCase() + value.slice(1).replaceAll("_", " ");
  }
}
