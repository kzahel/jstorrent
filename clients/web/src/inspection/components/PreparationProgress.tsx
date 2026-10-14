import { message as localizedMessage } from "../../localization/runtime";
import { useEffect, useMemo, useRef, useState } from "react";

import type { DataUnits } from "../appearance";
import { formatBytes } from "../format";
import type {
  MetadataAcquisitionProgress,
  TorrentPreparation,
} from "../model";
import styles from "./PreparationProgress.module.css";

const CELL_SIZE = 5;
const CELL_GAP = 1;
const MAX_DEVICE_PIXEL_RATIO = 3;

export const enum MetadataBlockState {
  Missing = 0,
  Requested = 1,
  Received = 2,
}

export function metadataBlockStateAt(
  packed: Uint8Array,
  blockIndex: number,
): MetadataBlockState {
  const byte = packed[Math.floor(blockIndex / 4)] ?? 0;
  return ((byte >> ((blockIndex % 4) * 2)) & 0b11) as MetadataBlockState;
}

export function PreparationProgress({
  preparation,
  dataUnits,
}: {
  readonly preparation: TorrentPreparation;
  readonly dataUnits: DataUnits;
}) {
  return (
    <div className={styles.stack} aria-label={localizedMessage("inspection.components.preparation.progress.torrent.preparation.activity")}>
      {preparation.metadata === null ? null : (
        <MetadataCard
          metadata={preparation.metadata}
          dataUnits={dataUnits}
        />
      )}
      {preparation.integrity === null ? null : (
        <section className={styles.card} aria-label={localizedMessage("inspection.components.preparation.progress.file.check.data")}>
          <header className={styles.header}>
            <div>
              <h3>
                {preparation.integrity.phase === "waiting_for_peer"
                  ? localizedMessage("inspection.components.preparation.progress.finding.peers")
                  : localizedMessage("inspection.components.preparation.progress.getting.check.data")}
              </h3>
              <p>
                {preparation.integrity.phase === "waiting_for_peer"
                  ? localizedMessage("inspection.components.preparation.progress.getting.data.to.check.files")
                  : localizedMessage("inspection.components.preparation.progress.downloading.data.to.check.files")}
              </p>
            </div>
            <span className={styles.phase}>
              {preparation.integrity.phase === "waiting_for_peer"
                ? localizedMessage("inspection.components.preparation.progress.waiting")
                : localizedMessage("inspection.components.preparation.progress.active")}
            </span>
          </header>
          <dl className={styles.metrics}>
            <Metric
              label={localizedMessage("inspection.components.preparation.progress.hash.ranges.needed")}
              value={preparation.integrity.neededHashRanges.toLocaleString()}
            />
            <Metric
              label={localizedMessage("inspection.components.preparation.progress.active.requests")}
              value={preparation.integrity.activeRequests.toLocaleString()}
            />
          </dl>
        </section>
      )}
    </div>
  );
}

function MetadataCard({
  metadata,
  dataUnits,
}: {
  readonly metadata: MetadataAcquisitionProgress;
  readonly dataUnits: DataUnits;
}) {
  const total = metadata.totalSizeBytes;
  const progress =
    total === null ? null : Math.min(1, metadata.receivedBytes / total);
  const progressText =
    total === null
      ? "Size not known yet"
      : `${formatBytes(metadata.receivedBytes, dataUnits)} of ${formatBytes(total, dataUnits)}`;

  return (
    <section className={styles.card} aria-label={localizedMessage("inspection.components.preparation.progress.torrent.info.progress")}>
      <header className={styles.header}>
        <div>
          <h3>
            {metadata.phase === "discovering"
              ? localizedMessage("inspection.components.preparation.progress.finding.peers")
              : localizedMessage("inspection.components.preparation.progress.getting.torrent.info")}
          </h3>
          <p>
            {metadata.phase === "discovering"
              ? localizedMessage("inspection.components.preparation.progress.looking.for.peers.with.torrent.info")
              : localizedMessage("inspection.components.preparation.progress.file.list.appears.when.done")}
          </p>
        </div>
        <strong className={styles.progressText}>
          {progress === null ? localizedMessage("inspection.components.preparation.progress.waiting") : `${Math.floor(progress * 100)}%`}
        </strong>
      </header>
      <div className={styles.progressRow}>
        <progress
          aria-label={localizedMessage("inspection.components.preparation.progress.torrent.info.received")}
          max={total ?? undefined}
          value={total === null ? undefined : metadata.receivedBytes}
        />
        <span>{progressText}</span>
      </div>
      {metadata.blockCount === 0 ? null : <MetadataBlockMap metadata={metadata} />}
      <dl className={styles.metrics}>
        <Metric
          label={localizedMessage("inspection.components.preparation.progress.peers")}
          value={metadata.activePeers.toLocaleString()}
        />
        <Metric
          label={localizedMessage("inspection.components.preparation.progress.requests.in.flight")}
          value={metadata.requestsInFlight.toLocaleString()}
        />
        <Metric label={localizedMessage("inspection.components.preparation.progress.hash.retries")} value={metadata.hashRetries.toLocaleString()} />
      </dl>
    </section>
  );
}

function MetadataBlockMap({
  metadata,
}: {
  readonly metadata: MetadataAcquisitionProgress;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(640);
  const geometry = useMemo(
    () => blockMapGeometry(width, metadata.blockCount),
    [metadata.blockCount, width],
  );
  const counts = useMemo(() => blockStateCounts(metadata), [metadata]);

  useEffect(() => {
    const element = wrapRef.current;
    if (element === null) return;
    const measure = () => {
      const next = Math.floor(element.getBoundingClientRect().width);
      if (next > 0) setWidth(next);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const frame = requestAnimationFrame(() => {
      drawBlockMap(canvas, geometry, metadata);
    });
    return () => cancelAnimationFrame(frame);
  }, [geometry, metadata]);

  const label = `${metadata.blockCount.toLocaleString()} metadata blocks: ${counts.received.toLocaleString()} received, ${counts.requested.toLocaleString()} requested, ${counts.missing.toLocaleString()} missing`;
  return (
    <div className={styles.mapSection}>
      <div ref={wrapRef} className={styles.canvasWrap}>
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          role="img"
          aria-label={label}
        />
      </div>
      <div className={styles.legend} aria-label={localizedMessage("inspection.components.preparation.progress.legend")}>
        <Legend label={localizedMessage("inspection.components.preparation.progress.missing")} state="missing" />
        <Legend label={localizedMessage("inspection.components.preparation.progress.requested")} state="requested" />
        <Legend label={localizedMessage("inspection.components.preparation.progress.received")} state="received" />
        <span>{localizedMessage("inspection.components.preparation.progress.16.kib.per.block")}</span>
      </div>
    </div>
  );
}

function blockMapGeometry(width: number, blockCount: number) {
  const boundedWidth = Math.max(CELL_SIZE, Math.floor(width));
  const stride = CELL_SIZE + CELL_GAP;
  const columns = Math.max(1, Math.floor((boundedWidth + CELL_GAP) / stride));
  const rows = Math.ceil(blockCount / columns);
  return {
    width: boundedWidth,
    height: rows * stride,
    columns,
    cellSize: CELL_SIZE,
    gap: CELL_GAP,
  };
}

function drawBlockMap(
  canvas: HTMLCanvasElement,
  geometry: ReturnType<typeof blockMapGeometry>,
  metadata: MetadataAcquisitionProgress,
) {
  const ratio = Math.min(
    MAX_DEVICE_PIXEL_RATIO,
    Math.max(1, window.devicePixelRatio || 1),
  );
  canvas.width = Math.ceil(geometry.width * ratio);
  canvas.height = Math.ceil(geometry.height * ratio);
  canvas.style.width = `${geometry.width}px`;
  canvas.style.height = `${geometry.height}px`;
  const context = canvas.getContext("2d");
  if (context === null) return;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, geometry.width, geometry.height);
  const computed = getComputedStyle(canvas);
  const colors = [
    computed.getPropertyValue("--metadata-missing").trim() || "#efebe6",
    computed.getPropertyValue("--metadata-requested").trim() || "#d39a3a",
    computed.getPropertyValue("--metadata-received").trim() || "#1f8eee",
  ];
  const stride = geometry.cellSize + geometry.gap;
  for (let index = 0; index < metadata.blockCount; index += 1) {
    const state = metadataBlockStateAt(metadata.blockStates, index);
    context.fillStyle = colors[state] ?? colors[MetadataBlockState.Missing]!;
    context.fillRect(
      (index % geometry.columns) * stride,
      Math.floor(index / geometry.columns) * stride,
      geometry.cellSize,
      geometry.cellSize,
    );
  }
}

function blockStateCounts(metadata: MetadataAcquisitionProgress) {
  const counts = { missing: 0, requested: 0, received: 0 };
  for (let index = 0; index < metadata.blockCount; index += 1) {
    switch (metadataBlockStateAt(metadata.blockStates, index)) {
      case MetadataBlockState.Requested:
        counts.requested += 1;
        break;
      case MetadataBlockState.Received:
        counts.received += 1;
        break;
      case MetadataBlockState.Missing:
        counts.missing += 1;
        break;
    }
  }
  return counts;
}

function Metric({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Legend({
  label,
  state,
}: {
  readonly label: string;
  readonly state: "missing" | "requested" | "received";
}) {
  return (
    <span>
      <i className={styles.swatch} data-state={state} aria-hidden="true" />
      {label}
    </span>
  );
}
