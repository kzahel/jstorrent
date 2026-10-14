import { message as localizedMessage } from "../../localization/runtime";
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
    label: localizedMessage("inspection.components.disk.panel.torrent"),
    width: 210,
    minimumWidth: 130,
    maximumWidth: 520,
    sortValue: (row) => row.torrentName,
    render: (row) => <span title={row.torrentName}>{row.torrentName}</span>,
  },
  {
    id: "piece",
    label: localizedMessage("inspection.components.disk.panel.piece"),
    width: 76,
    align: "right",
    sortKind: "number",
    sortValue: (row) => row.pieceIndex,
    render: (row) => row.pieceIndex.toLocaleString(),
  },
  {
    id: "stage",
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
    label: localizedMessage("inspection.components.disk.panel.requested"),
    width: 96,
    align: "right",
    sortKind: "number",
    sortValue: (row) => row.requestedBytes,
    render: (row) => formatBytes(row.requestedBytes, dataUnits),
  },
  {
    id: "received",
    label: localizedMessage("inspection.components.disk.panel.received"),
    width: 92,
    align: "right",
    sortKind: "number",
    sortValue: (row) => row.receivedBytes,
    render: (row) => formatBytes(row.receivedBytes, dataUnits),
  },
  {
    id: "stored",
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
    render: (row) => row.attempt.toLocaleString(),
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
  const displayColumns = useMemo(() => diskColumns(dataUnits), [dataUnits]);
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
          <span>{rows.length.toLocaleString()}{" "}{localizedMessage("inspection.components.disk.panel.active")}</span>
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
    ["Requested", pipeline.requestedBytes],
    ["Resident", pipeline.residentBytes],
    ["Queued write", pipeline.queuedWriteBytes],
    ["Writing", pipeline.writingBytes],
    ["Hashing", pipeline.hashingBytes],
    ["Checkpoint dirty", pipeline.checkpointDirtyBytes],
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
        aria-label={`Disk pressure ${pressureLabel}`}
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
          detail={`high ${formatBytes(pipeline.residentHighWatermarkBytes, dataUnits)} · low ${formatBytes(pipeline.residentLowWatermarkBytes, dataUnits)}`}
        />
        <Metric
          label={localizedMessage("inspection.components.disk.panel.receive.write")}
          value={`${formatRate(pipeline.receiveRateBytes, dataUnits)} / ${formatRate(pipeline.writeRateBytes, dataUnits)}`}
          detail={`${formatDuration(pipeline.sampleMillis)} sample`}
        />
        <Metric
          label={localizedMessage("inspection.components.disk.panel.stored.verified")}
          value={`${formatBytes(pipeline.storedBytesTotal, dataUnits)} / ${formatBytes(pipeline.verifiedBytesTotal, dataUnits)}`}
          detail={`${formatRate(pipeline.hashRateBytes, dataUnits)} verify rate`}
        />
        <Metric
          label={localizedMessage("inspection.components.disk.panel.pending.work")}
          value={`${pipeline.storageJobsPending.toLocaleString()} jobs · ${activePieces.toLocaleString()} pieces`}
          detail={`${pipeline.pressureTransitionCount.toLocaleString()} pressure transitions`}
        />
        <Metric
          label={localizedMessage("inspection.components.disk.panel.write.queue.wait")}
          value={formatMicros(pipeline.writeQueueWaitMaxMicros)}
          detail={`${formatMicros(pipeline.writeQueueWaitMicros)} cumulative`}
        />
        <Metric
          label={localizedMessage("inspection.components.disk.panel.write.service")}
          value={formatMicros(pipeline.writeServiceMaxMicros)}
          detail={`${pipeline.writeOperationsCompleted.toLocaleString()} / ${pipeline.writeOperationsStarted.toLocaleString()} operations`}
        />
        <Metric
          label={localizedMessage("inspection.components.disk.panel.hash.service")}
          value={formatMicros(pipeline.hashServiceMaxMicros)}
          detail={`${pipeline.hashOperationsCompleted.toLocaleString()} / ${pipeline.hashOperationsStarted.toLocaleString()} operations`}
        />
        <Metric
          label={localizedMessage("inspection.components.disk.panel.checkpoint.backlog")}
          value={`${pipeline.checkpointDirtyPieces.toLocaleString()} pieces · ${formatBytes(pipeline.checkpointDirtyBytes, dataUnits)}`}
          detail={`oldest ${formatDuration(pipeline.checkpointOldestDirtyMillis)} · high ${pipeline.checkpointDirtyPieceHighWater.toLocaleString()} pieces / ${formatBytes(pipeline.checkpointDirtyByteHighWater, dataUnits)}`}
        />
        <Metric
          label={localizedMessage("inspection.components.disk.panel.checkpoint.stage")}
          value={titleCase(pipeline.checkpointStage)}
          detail={
            pipeline.checkpointActiveMicros === null
              ? `${pipeline.checkpointBatchesCompleted.toLocaleString()} / ${pipeline.checkpointBatchesStarted.toLocaleString()} batches`
              : `${formatMicros(pipeline.checkpointActiveMicros)} active`
          }
        />
        <Metric
          label={localizedMessage("inspection.components.disk.panel.disk.sync")}
          value={formatMicros(pipeline.checkpointSyncServiceMaxMicros)}
          detail={`${formatMicros(pipeline.checkpointSyncServiceMicros)} cumulative · ${pipeline.checkpointSyncOperationsCompleted.toLocaleString()} targets`}
        />
        <Metric
          label={localizedMessage("inspection.components.disk.panel.checkpoint.commit")}
          value={formatMicros(pipeline.checkpointCommitServiceMaxMicros)}
          detail={`${formatMicros(pipeline.checkpointCommitServiceMicros)} cumulative · ${pipeline.checkpointPiecesCompleted.toLocaleString()} pieces`}
        />
        <Metric
          label={localizedMessage("inspection.components.disk.panel.backpressured")}
          value={formatDuration(pipeline.backpressuredMillisTotal)}
          detail={
            pipeline.intakeBackpressured
              ? "intake paused now"
              : "intake is open"
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
      return localizedMessage("inspection.components.disk.panel.loading.disk.state");
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
  if (milliseconds < 60_000)
    return `${(milliseconds / 1_000).toFixed(milliseconds < 10_000 ? 1 : 0)} s`;
  return `${Math.floor(milliseconds / 60_000)}m ${Math.floor((milliseconds % 60_000) / 1_000)}s`;
}

function titleCase(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1).replaceAll("_", " ");
}
