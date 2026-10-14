import { message as localizedMessage } from "../../localization/runtime";
import { useEffect, useMemo, useRef, useState } from "react";

import type { SpeedMetric, SpeedRange } from "../../api";
import type { SpeedInspectionView } from "../model";
import type { DataUnits } from "../appearance";
import { useInspectionStore } from "../context";
import { formatBytes, formatExactBytes } from "../format";
import {
  DEFAULT_SPEED_METRICS,
  isDefaultSpeedPreferences,
} from "../speed-preferences";
import {
  contiguousRuns,
  decayedScaleMaximum,
  monotoneTangents,
} from "./speed-geometry";
import styles from "./SpeedPanel.module.css";

const RANGES: readonly { value: SpeedRange; label: string }[] = [
  { value: "seconds30", label: localizedMessage("inspection.components.speed.panel.30.sec") },
  { value: "minutes2", label: localizedMessage("inspection.components.speed.panel.2.min") },
  { value: "minutes10", label: localizedMessage("inspection.components.speed.panel.10.min") },
  { value: "hour1", label: localizedMessage("inspection.components.speed.panel.1.hour") },
  { value: "hours24", label: localizedMessage("inspection.components.speed.panel.24.hours") },
  { value: "days30", label: localizedMessage("inspection.components.speed.panel.30.days") },
  { value: "years2", label: localizedMessage("inspection.components.speed.panel.2.years") },
];

const METRIC_LABELS: Readonly<Record<SpeedMetric, string>> = {
  payload_received: "Download",
  staged_write: "Staged write",
  payload_verified: "Verified",
  peer_wire_received: "Peer wire in",
  peer_wire_sent: "Peer wire out",
  peer_protocol_received: "Peer protocol in",
  peer_protocol_sent: "Peer protocol out",
  metadata_payload_received: "Metadata in",
  metadata_payload_sent: "Metadata out",
  peer_unclassified_received: "Peer unclassified in",
  peer_unclassified_sent: "Peer unclassified out",
  dht_received: "DHT in",
  dht_sent: "DHT out",
  tracker_received: "Tracker in",
  tracker_sent: "Tracker out",
  logical_hash_read: "Hash read",
  payload_redundant: "Redundant payload",
  payload_hash_failed: "Hash-failed payload",
  payload_uploaded: "Upload",
};

// Series colors are `--speed-<metric>` tokens in SpeedPanel.module.css.
function seriesColor(metric: string): string {
  return `var(--speed-${metric}, var(--viz-neutral))`;
}

export function SpeedPanel() {
  const history = useInspectionStore((state) => state.speed);
  const status = useInspectionStore((state) => state.viewStatus.speed);
  const range = useInspectionStore((state) => state.presentation.speedRange);
  const selected = useInspectionStore(
    (state) => state.presentation.speedMetrics,
  );
  const setRange = useInspectionStore((state) => state.setSpeedRange);
  const toggleMetric = useInspectionStore((state) => state.toggleSpeedMetric);
  const resetPreferences = useInspectionStore(
    (state) => state.resetSpeedPreferences,
  );
  const dataUnits = useInspectionStore((state) => state.presentation.dataUnits);
  const current = useMemo(
    () =>
      new Map(
        history?.current.map((entry) => [
          entry.metric,
          entry.bytes === null ? null : number(entry.bytes),
        ]),
      ),
    [history],
  );

  return (
    <div className={styles.panel} aria-label={localizedMessage("inspection.components.speed.panel.session.speed.history")}>
      <header className={styles.header}>
        <span className={styles.scope}>{localizedMessage("inspection.components.speed.panel.all.torrents")}</span>
        <label className={styles.range}>
          <span>{localizedMessage("inspection.components.speed.panel.history")}</span>
          <select
            value={range}
            onChange={(event) => setRange(event.target.value as SpeedRange)}
          >
            {RANGES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </header>

      {status.status === "unsupported" || status.status === "unavailable" ? (
        <div className={styles.message}>{status.reason}</div>
      ) : history === null ? (
        <div className={styles.message}>{localizedMessage("inspection.components.speed.panel.preparing.speed.history")}</div>
      ) : (
        <>
          <SpeedCanvas
            history={history}
            stale={status.status === "stale"}
            dataUnits={dataUnits}
          />
          <WindowSummaries history={history} dataUnits={dataUnits} />
        </>
      )}

      <section className={styles.seriesPicker} aria-label={localizedMessage("inspection.components.speed.panel.chart.series")}>
        <div className={styles.sectionHeading}>
          <div>
            <strong>{localizedMessage("inspection.components.speed.panel.series")}</strong>
            <span>{selected.length}{" "}{localizedMessage("inspection.components.speed.panel.of.8")}</span>
          </div>
          {history?.persistence === "degraded" ? (
            <span className={styles.warning}>{localizedMessage("inspection.components.speed.panel.history.persistence.interrupted")}</span>
          ) : null}
          {isDefaultSpeedPreferences({ range, metrics: selected }) ? null : (
            <button
              type="button"
              className={styles.reset}
              onClick={resetPreferences}
            >
              {localizedMessage("inspection.components.speed.panel.reset.to.default")}
            </button>
          )}
        </div>
        <div className={styles.chips}>
          {defaultsFirst(history?.catalog ?? []).map((entry) => {
            const active = selected.includes(entry.metric);
            return (
              <button
                key={entry.metric}
                type="button"
                aria-pressed={active}
                disabled={!entry.available || (!active && selected.length >= 8)}
                title={entry.reason ?? undefined}
                onClick={() => toggleMetric(entry.metric)}
              >
                <i style={{ background: seriesColor(entry.metric) }} />
                {METRIC_LABELS[entry.metric]}
              </button>
            );
          })}
        </div>
      </section>

      {history === null ? null : (
        <TrafficBreakdown
          history={history}
          current={current}
          dataUnits={dataUnits}
        />
      )}
    </div>
  );
}

function SpeedCanvas({
  history,
  stale,
  dataUnits,
}: {
  history: SpeedInspectionView;
  stale: boolean;
  dataUnits: DataUnits;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const phaseRef = useRef({ complete: "", started: performance.now() });
  const scaleRef = useRef({ maximum: 1_024, updated: performance.now() });
  const [cursor, setCursor] = useState<number | null>(null);
  const [captureStale, setCaptureStale] = useState(false);
  const [size, setSize] = useState({ width: 800, height: 310 });
  const bucketMillis = number(history.bucket_millis);
  const samples = history.series[0]?.values.length ?? 0;
  const frozen = stale || captureStale;

  useEffect(() => {
    setCaptureStale(false);
    if (!history.live || stale) return;
    const staleAfter = history.range === "seconds30" ? 1_000 : 3_000;
    const timer = setTimeout(() => setCaptureStale(true), staleAfter);
    return () => clearTimeout(timer);
  }, [history.captured_millis, history.live, history.range, stale]);

  useEffect(() => {
    const element = wrapRef.current;
    if (element === null) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) return;
      setSize({ width: Math.max(320, entry.contentRect.width), height: 310 });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (phaseRef.current.complete !== history.complete_through_millis) {
      phaseRef.current = {
        complete: history.complete_through_millis,
        started: performance.now(),
      };
    }
    const reduced =
      globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ??
      false;
    let frame = 0;
    const render = (now: number) => {
      const animating =
        history.live &&
        !frozen &&
        !reduced &&
        document.visibilityState === "visible";
      const phase = animating
        ? Math.min(1, (now - phaseRef.current.started) / bucketMillis)
        : 1;
      drawChart(
        canvasRef.current,
        history,
        size,
        phase,
        cursor,
        scaleRef.current,
        now,
        animating,
        dataUnits,
      );
      if (animating && phase < 1) frame = requestAnimationFrame(render);
    };
    const visibilityChanged = () => {
      cancelAnimationFrame(frame);
      render(performance.now());
    };
    document.addEventListener("visibilitychange", visibilityChanged);
    render(performance.now());
    return () => {
      document.removeEventListener("visibilitychange", visibilityChanged);
      cancelAnimationFrame(frame);
    };
  }, [bucketMillis, cursor, dataUnits, frozen, history, size]);

  const selectAt = (clientX: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (rect === undefined || samples === 0) return;
    const plotLeft = 58;
    const plotRight = Math.max(plotLeft + 1, rect.width - 18);
    const index = Math.round(
      ((clientX - rect.left - plotLeft) / (plotRight - plotLeft)) *
        (samples - 1),
    );
    setCursor(Math.max(0, Math.min(samples - 1, index)));
  };

  return (
    <div
      className={styles.chartWrap}
      ref={wrapRef}
      data-stale={frozen || undefined}
    >
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        role="img"
        tabIndex={0}
        aria-label={localizedMessage("inspection.components.speed.panel.speed.history.chart.use.left.and.right")}
        onPointerMove={(event) => selectAt(event.clientX)}
        onPointerLeave={() => setCursor(null)}
        onFocus={() => setCursor((value) => value ?? Math.max(0, samples - 1))}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          const delta = event.key === "ArrowLeft" ? -1 : 1;
          setCursor((value) =>
            Math.max(0, Math.min(samples - 1, (value ?? samples - 1) + delta)),
          );
        }}
      />
      {cursor === null ? null : (
        <ExactSample history={history} index={cursor} dataUnits={dataUnits} />
      )}
      {frozen ? <span className={styles.stale}>{localizedMessage("inspection.components.speed.panel.frozen.stale")}</span> : null}
    </div>
  );
}

function drawChart(
  canvas: HTMLCanvasElement | null,
  history: SpeedInspectionView,
  size: { width: number; height: number },
  phase: number,
  cursor: number | null,
  scale: { maximum: number; updated: number },
  now: number,
  animateScale: boolean,
  dataUnits: DataUnits,
): void {
  if (canvas === null) return;
  const ratio = Math.min(3, globalThis.devicePixelRatio || 1);
  canvas.width = Math.round(size.width * ratio);
  canvas.height = Math.round(size.height * ratio);
  canvas.style.width = `${size.width}px`;
  canvas.style.height = `${size.height}px`;
  const context = canvas.getContext("2d");
  if (context === null) return;
  context.scale(ratio, ratio);
  const css = getComputedStyle(canvas);
  const text = css.getPropertyValue("--text-muted").trim() || "#87909f";
  const grid = css.getPropertyValue("--border-soft").trim() || "#29313d";
  const background =
    css.getPropertyValue("--surface-secondary").trim() || "#111720";
  context.fillStyle = background;
  context.fillRect(0, 0, size.width, size.height);
  const left = 58;
  const right = size.width - 18;
  const top = 20;
  const bottom = size.height - 34;
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);
  const bucket = number(history.bucket_millis);
  const rates = history.series.map((series) =>
    series.values.map((value) =>
      value === null ? null : (number(value) * 1000) / bucket,
    ),
  );
  const visibleMaximum = Math.max(
    0,
    ...rates.flatMap((values) => values.filter(isNumber)),
  );
  const targetMaximum = Math.max(1_024, niceMaximum(visibleMaximum * 1.1));
  const maximum = decayedScaleMaximum(
    scale.maximum,
    targetMaximum,
    now - scale.updated,
    animateScale,
  );
  scale.maximum = maximum;
  scale.updated = now;
  context.font = "11px ui-sans-serif, system-ui, sans-serif";
  context.fillStyle = text;
  context.strokeStyle = grid;
  context.lineWidth = 1;
  for (let line = 0; line <= 4; line += 1) {
    const y = top + (height * line) / 4;
    context.beginPath();
    context.moveTo(left, y + 0.5);
    context.lineTo(right, y + 0.5);
    context.stroke();
    context.textAlign = "right";
    context.textBaseline = "middle";
    context.fillText(
      `${formatBytes(maximum * (1 - line / 4), dataUnits)}/s`,
      left - 8,
      y,
    );
  }
  const count = Math.max(1, rates[0]?.length ?? 1);
  const spacing = width / count;
  context.save();
  context.beginPath();
  context.rect(left, top, width, height);
  context.clip();
  history.series.forEach((series, seriesIndex) => {
    const values = rates[seriesIndex] ?? [];
    const color =
      css.getPropertyValue(`--speed-${series.metric}`).trim() ||
      css.getPropertyValue("--viz-neutral").trim() ||
      "#9a9187";
    context.strokeStyle = color;
    context.lineWidth = series.metric === "payload_received" ? 2.4 : 1.8;
    context.lineJoin = "round";
    context.lineCap = "round";
    for (const run of contiguousRuns(values)) {
      const path = curvePath(
        run.start,
        run.values,
        left,
        bottom,
        spacing,
        height,
        maximum,
        phase,
      );
      if (series.metric === "payload_received" && run.values.length > 1) {
        const fill = new Path2D(path);
        fill.lineTo(
          left + (run.start + run.values.length + 1 - phase) * spacing,
          bottom,
        );
        fill.lineTo(left + (run.start + 2 - phase) * spacing, bottom);
        fill.closePath();
        const gradient = context.createLinearGradient(0, top, 0, bottom);
        gradient.addColorStop(0, `${color}35`);
        gradient.addColorStop(1, `${color}03`);
        context.fillStyle = gradient;
        context.fill(fill);
      }
      context.stroke(path);
    }
  });
  context.restore();
  if (cursor !== null && count > 1) {
    const x = left + (cursor + 1) * spacing;
    context.strokeStyle = `${text}99`;
    context.beginPath();
    context.moveTo(x, top);
    context.lineTo(x, bottom);
    context.stroke();
  }
  context.fillStyle = text;
  context.textBaseline = "top";
  context.textAlign = "left";
  context.fillText(timeLabel(history, 0), left, bottom + 11);
  context.textAlign = "right";
  context.fillText(timeLabel(history, count - 1), right, bottom + 11);
}

function curvePath(
  startIndex: number,
  values: readonly number[],
  left: number,
  bottom: number,
  spacing: number,
  height: number,
  maximum: number,
  phase: number,
): Path2D {
  const path = new Path2D();
  const tangents = monotoneTangents(values);
  const x = (index: number) =>
    left + (startIndex + index + 2 - phase) * spacing;
  const y = (value: number) => bottom - (value / maximum) * height;
  path.moveTo(x(0), y(values[0] ?? 0));
  for (let index = 0; index < values.length - 1; index += 1) {
    path.bezierCurveTo(
      x(index) + spacing / 3,
      y((values[index] ?? 0) + (tangents[index] ?? 0) / 3),
      x(index + 1) - spacing / 3,
      y((values[index + 1] ?? 0) - (tangents[index + 1] ?? 0) / 3),
      x(index + 1),
      y(values[index + 1] ?? 0),
    );
  }
  return path;
}

function ExactSample({
  history,
  index,
  dataUnits,
}: {
  history: SpeedInspectionView;
  index: number;
  dataUnits: DataUnits;
}) {
  const bucketMillis = number(history.bucket_millis);
  const timestamp = number(history.start_millis) + (index + 1) * bucketMillis;
  return (
    <div className={styles.tooltip} role="status" aria-live="polite">
      <strong>
        {new Date(timestamp).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })}
      </strong>
      {history.series.map((series) => (
        <span key={series.metric}>
          <i style={{ background: seriesColor(series.metric) }} />
          {METRIC_LABELS[series.metric]}
          <b>{sampleLabel(series.values[index], bucketMillis, dataUnits)}</b>
        </span>
      ))}
    </div>
  );
}

function WindowSummaries({
  history,
  dataUnits,
}: {
  history: SpeedInspectionView;
  dataUnits: DataUnits;
}) {
  const bucketMillis = number(history.bucket_millis);
  return (
    <section
      className={styles.windowSummary}
      aria-label={localizedMessage("inspection.components.speed.panel.selected.speed.window.summaries")}
    >
      <div className={styles.summaryHeader} aria-hidden="true">
        <span>{localizedMessage("inspection.components.speed.panel.series")}</span>
        <span>{localizedMessage("inspection.components.speed.panel.current")}</span>
        <span>{localizedMessage("inspection.components.speed.panel.average")}</span>
        <span>{localizedMessage("inspection.components.speed.panel.peak")}</span>
        <span>{localizedMessage("inspection.components.speed.panel.total")}</span>
      </div>
      {history.series.map((series) => {
        const covered = series.values.filter(
          (value): value is string => value !== null,
        );
        const total = covered.reduce((sum, value) => sum + BigInt(value), 0n);
        const rates = covered.map(
          (value) => (number(value) * 1_000) / bucketMillis,
        );
        const average =
          covered.length === 0
            ? 0
            : (Number(total) * 1_000) / (covered.length * bucketMillis);
        const peak = rates.length === 0 ? 0 : Math.max(...rates);
        return (
          <div className={styles.summaryRow} key={series.metric}>
            <strong>
              <i style={{ background: seriesColor(series.metric) }} />
              {METRIC_LABELS[series.metric]}
              {covered.length === series.values.length ? null : (
                <small>
                  {covered.length}/{series.values.length}{" "}{localizedMessage("inspection.components.speed.panel.covered")}</small>
              )}
            </strong>
            <span data-label={localizedMessage("inspection.components.speed.panel.current")}>
              {nullableSpeedRate(
                series.current_rate_bytes === null
                  ? null
                  : number(series.current_rate_bytes),
                dataUnits,
              )}
            </span>
            <span data-label={localizedMessage("inspection.components.speed.panel.average")}>{speedRate(average, dataUnits)}</span>
            <span data-label={localizedMessage("inspection.components.speed.panel.peak")}>{speedRate(peak, dataUnits)}</span>
            <span data-label={localizedMessage("inspection.components.speed.panel.total")}>
              {formatExactBytes(total.toString(), dataUnits)}
            </span>
          </div>
        );
      })}
    </section>
  );
}

function TrafficBreakdown({
  history,
  current,
  dataUnits,
}: {
  history: SpeedInspectionView;
  current: ReadonlyMap<SpeedMetric, number | null>;
  dataUnits: DataUnits;
}) {
  const rows: readonly [string, SpeedMetric, SpeedMetric][] = [
    ["Peer wire", "peer_wire_received", "peer_wire_sent"],
    ["Peer protocol", "peer_protocol_received", "peer_protocol_sent"],
    ["Metadata payload", "metadata_payload_received", "metadata_payload_sent"],
    ["DHT", "dht_received", "dht_sent"],
    ["Tracker", "tracker_received", "tracker_sent"],
  ];
  return (
    <details className={styles.breakdown}>
      <summary>{localizedMessage("inspection.components.speed.panel.traffic.breakdown")}</summary>
      <div
        className={styles.breakdownGrid}
        aria-label={localizedMessage("inspection.components.speed.panel.current.traffic.breakdown")}
      >
        <span>{localizedMessage("inspection.components.speed.panel.source")}</span>
        <span>{localizedMessage("inspection.components.speed.panel.in")}</span>
        <span>{localizedMessage("inspection.components.speed.panel.out")}</span>
        {rows.map(([label, incoming, outgoing]) => (
          <div className={styles.breakdownRow} key={label}>
            <strong>{label}</strong>
            <span>{nullableSpeedRate(current.get(incoming), dataUnits)}</span>
            <span>{nullableSpeedRate(current.get(outgoing), dataUnits)}</span>
          </div>
        ))}
        <div className={styles.breakdownRow}>
          <strong>{localizedMessage("inspection.components.speed.panel.hash.read")}</strong>
          <span>
            {nullableSpeedRate(current.get("logical_hash_read"), dataUnits)}
          </span>
          <span>—</span>
        </div>
        <div className={styles.breakdownRow}>
          <strong>{localizedMessage("inspection.components.speed.panel.redundant.failed")}</strong>
          <span>
            {nullableSpeedRate(current.get("payload_redundant"), dataUnits)}
          </span>
          <span>
            {nullableSpeedRate(current.get("payload_hash_failed"), dataUnits)}
          </span>
        </div>
      </div>
      {history.catalog.find((entry) => entry.metric === "payload_uploaded")
        ?.available === false ? (
        <p>{localizedMessage("inspection.components.speed.panel.upload.history.unavailable")}</p>
      ) : null}
    </details>
  );
}

function defaultsFirst<T extends { readonly metric: SpeedMetric }>(
  catalog: readonly T[],
): T[] {
  const isDefault = (entry: T) => DEFAULT_SPEED_METRICS.includes(entry.metric);
  return [...catalog.filter(isDefault), ...catalog.filter((entry) => !isDefault(entry))];
}

function timeLabel(history: SpeedInspectionView, index: number): string {
  const timestamp =
    number(history.start_millis) + index * number(history.bucket_millis);
  if (!history.live) {
    return new Date(timestamp).toLocaleDateString([], {
      month: "short",
      day: "numeric",
    });
  }
  const seconds = Math.max(
    0,
    Math.round((number(history.complete_through_millis) - timestamp) / 1000),
  );
  return seconds === 0 ? "now" : `−${seconds}s`;
}

function sampleLabel(
  value: string | null | undefined,
  bucketMillis: number,
  dataUnits: DataUnits,
): string {
  if (value === null || value === undefined) return localizedMessage("inspection.components.speed.panel.gap");
  return `${speedRate((number(value) * 1_000) / bucketMillis, dataUnits)} · ${formatExactBytes(value, dataUnits)}`;
}

function speedRate(value: number, dataUnits: DataUnits): string {
  return `${formatBytes(Math.max(0, value), dataUnits)}/s`;
}

function nullableSpeedRate(
  value: number | null | undefined,
  dataUnits: DataUnits,
): string {
  return value === null || value === undefined
    ? "—"
    : speedRate(value, dataUnits);
}

function niceMaximum(value: number): number {
  const exponent = 10 ** Math.floor(Math.log10(value));
  const normalized = value / exponent;
  const nice =
    normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return nice * exponent;
}

function number(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function isNumber(value: number | null): value is number {
  return value !== null;
}
