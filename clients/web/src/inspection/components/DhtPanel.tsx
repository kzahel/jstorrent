import { message as localizedMessage } from "../../localization/runtime";
import { useEffect, useMemo, useRef, useState } from "react";

import type {
  DhtAddressFamilyView,
  DhtBucketView,
  DhtFamilyInspectionView,
  DhtInspectionView,
} from "../../api";
import { useInspectionStore } from "../context";
import { formatExactBytes, formatTime } from "../format";
import type { DhtVisualizationMode } from "../dht-preferences";
import styles from "./DhtPanel.module.css";

const K = 8;
const QUESTIONABLE_AGE_MILLIS = 15 * 60 * 1_000;

export function DhtPanel() {
  const inspection = useInspectionStore((state) => state.dht);
  const status = useInspectionStore((state) => state.viewStatus.dht);
  const mode = useInspectionStore(
    (state) => state.presentation.dhtVisualizationMode,
  );
  const setMode = useInspectionStore((state) => state.setDhtVisualizationMode);
  const dataUnits = useInspectionStore((state) => state.presentation.dataUnits);
  const [selectedFamily, setSelectedFamily] = useState<DhtAddressFamilyView>("ipv4");

  if (status.status === "unsupported" || status.status === "unavailable") {
    return <div className={styles.message}>{status.reason}</div>;
  }
  if (inspection === null) {
    return <div className={styles.message}>{localizedMessage("inspection.components.dht.panel.preparing.dht.observation")}</div>;
  }
  const family = inspection.families.find(
    (candidate) => candidate.family === selectedFamily,
  ) ?? inspection.families[0];
  if (family === undefined) {
    return <div className={styles.message}>{localizedMessage("inspection.components.dht.panel.no.dht.address.family.is.active")}</div>;
  }

  return (
    <div className={styles.panel} aria-label={localizedMessage("inspection.components.dht.panel.session.dht.observatory")}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>{localizedMessage("inspection.components.dht.panel.session.mainline.ipv4.ipv6")}</p>
          <h2>{localizedMessage("inspection.components.dht.panel.dht.observatory")}</h2>
          <p className={styles.subtitle}>{localizedMessage("inspection.components.dht.panel.routing.space.coverage.node.freshness.and.live")}</p>
        </div>
        <div className={styles.modeControl} aria-label={localizedMessage("inspection.components.dht.panel.dht.address.family")}>
          <span>{localizedMessage("inspection.components.dht.panel.network")}</span>
          <div>
            {inspection.families.map((candidate) => (
              <button
                key={candidate.family}
                type="button"
                aria-pressed={family.family === candidate.family}
                onClick={() => setSelectedFamily(candidate.family)}
              >
                {familyLabel(candidate.family)}
              </button>
            ))}
          </div>
        </div>
        <div className={styles.modeControl} aria-label={localizedMessage("inspection.components.dht.panel.routing.visualization")}>
          <span>{localizedMessage("inspection.components.dht.panel.encoding")}</span>
          <div>
            <button
              type="button"
              aria-pressed={mode === "normalized"}
              onClick={() => setMode("normalized")}
            >{localizedMessage("inspection.components.dht.panel.depth.normalized")}</button>
            <button
              type="button"
              aria-pressed={mode === "literal"}
              onClick={() => setMode("literal")}
            >{localizedMessage("inspection.components.dht.panel.buckets.literal")}</button>
          </div>
        </div>
      </header>

      <StatusFacts inspection={inspection} family={family} stale={status.status === "stale"} />
      <RoutingDistribution inspection={inspection} family={family} mode={mode} />
      <OperationalFacts inspection={inspection} dataUnits={dataUnits} />
      <LookupTable inspection={inspection} />
      <ExactBucketTable family={family} />
    </div>
  );
}

function StatusFacts({
  inspection,
  family,
  stale,
}: {
  readonly inspection: DhtInspectionView;
  readonly family: DhtFamilyInspectionView;
  readonly stale: boolean;
}) {
  const questionable = sum(
    family.buckets,
    (bucket) => bucket.questionable_nodes,
  );
  const aging = family.buckets.filter((bucket) => {
    const age = decimalNumber(bucket.oldest_live_response_age_millis);
    return bucket.questionable_nodes === 0 && age >= 12 * 60 * 1_000;
  }).length;
  return (
    <div className={styles.statusFacts} aria-label={localizedMessage("inspection.components.dht.panel.dht.status.facts")}>
      <Fact
        label={localizedMessage("inspection.components.dht.panel.participant")}
        value={lifecycleLabel(inspection.lifecycle)}
        detail={`${policyLabel(inspection.network_policy)}${stale ? " · stale" : ""}`}
        tone={inspection.lifecycle === "participating" ? "good" : "neutral"}
      />
      <Fact
        label={localizedMessage("inspection.components.dht.panel.routing.nodes")}
        value={family.routing_nodes.toLocaleString()}
        detail={`${family.occupied_buckets} occupied bands · ${familyLabel(family.family)}`}
      />
      <Fact
        label={localizedMessage("inspection.components.dht.panel.deepest.prefix")}
        value={
          family.deepest_shared_prefix_bits === null
            ? "—"
            : `${family.deepest_shared_prefix_bits} bits`
        }
        detail="Shared with local ID"
      />
      <Fact
        label={localizedMessage("inspection.components.dht.panel.freshness")}
        value={questionable === 0 ? "Current" : `${questionable} questionable`}
        detail={`${aging} aging band${aging === 1 ? "" : "s"}`}
        tone={questionable > 0 || aging > 0 ? "warning" : "good"}
      />
      <Fact
        label={localizedMessage("inspection.components.dht.panel.live.work")}
        value={`${inspection.active_lookups} lookup${inspection.active_lookups === 1 ? "" : "s"}`}
        detail={`${inspection.active_transactions} transactions`}
      />
    </div>
  );
}

function Fact({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  readonly label: string;
  readonly value: string;
  readonly detail: string;
  readonly tone?: "neutral" | "good" | "warning";
}) {
  return (
    <div className={styles.fact} data-tone={tone}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function RoutingDistribution({
  inspection,
  family,
  mode,
}: {
  readonly inspection: DhtInspectionView;
  readonly family: DhtFamilyInspectionView;
  readonly mode: DhtVisualizationMode;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const tail = useMemo(
    () => summarizeTail(family.buckets),
    [family],
  );
  const description =
    mode === "normalized"
      ? `Normalized shared-prefix depth zero through 31, followed by a 128-band tail. ${tail.live} live nodes occupy the tail.`
      : "Literal engine bucket indices zero through 159. Equal pixel widths represent engine slots, not equal keyspace volumes.";

  useEffect(() => {
    const element = wrapRef.current;
    if (element === null) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setWidth(Math.max(320, entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    drawRouting(canvas, family, mode, width);
  }, [family, mode, width]);

  return (
    <section className={styles.routing} aria-labelledby="dht-routing-title">
      <div className={styles.sectionHeading}>
        <div>
          <h3 id="dht-routing-title">{familyLabel(family.family)}{" "}{localizedMessage("inspection.components.dht.panel.routing.space.distribution")}</h3>
          <p>{localizedMessage("inspection.components.dht.panel.live.nodes.rise.above.the.baseline.replacements")}</p>
        </div>
        <div className={styles.capture}>{localizedMessage("inspection.components.dht.panel.captured")}{" "}{formatTime(decimalNumber(inspection.captured_millis))}{" "}{localizedMessage("inspection.components.dht.panel.utc")}</div>
      </div>
      <div ref={wrapRef} className={styles.canvasWrap} data-mode={mode}>
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          height={300}
          aria-label={description}
          role="img"
        />
      </div>
      <div className={styles.legend} aria-label={localizedMessage("inspection.components.dht.panel.routing.chart.legend")}>
        <span data-kind="good">{localizedMessage("inspection.components.dht.panel.good.live")}</span>
        <span data-kind="questionable">{localizedMessage("inspection.components.dht.panel.questionable.live")}</span>
        <span data-kind="replacement">{localizedMessage("inspection.components.dht.panel.replacements")}</span>
        <span data-kind="freshness">{localizedMessage("inspection.components.dht.panel.oldest.response.age.0.15.min")}</span>
      </div>
      <p className={styles.encodingNote}>
        {mode === "normalized"
          ? localizedMessage("inspection.components.dht.panel.depth.159.bucket.index.moving.right.adds")
          : localizedMessage("inspection.components.dht.panel.all.160.engine.slots.are.shown.in")}
      </p>
    </section>
  );
}

function drawRouting(
  canvas: HTMLCanvasElement,
  family: DhtFamilyInspectionView,
  mode: DhtVisualizationMode,
  cssWidth: number,
) {
  const context = canvas.getContext("2d");
  if (context === null) return;
  const height = 300;
  const ratio = Math.min(3, globalThis.devicePixelRatio || 1);
  canvas.width = Math.round(cssWidth * ratio);
  canvas.height = Math.round(height * ratio);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${height}px`;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, cssWidth, height);
  const tokens = getComputedStyle(canvas);
  const colors = {
    text: tokens.getPropertyValue("--text-muted").trim() || "#718096",
    grid: tokens.getPropertyValue("--border-soft").trim() || "#334155",
    good: tokens.getPropertyValue("--dht-good").trim() || "#1f8eee",
    questionable: tokens.getPropertyValue("--dht-questionable").trim() || "#d39a3a",
    replacement: tokens.getPropertyValue("--dht-replacement").trim() || "#9a9187",
    fresh: tokens.getPropertyValue("--dht-fresh").trim() || "#1f8eee",
    aging: tokens.getPropertyValue("--dht-aging").trim() || "#d39a3a",
    surface: tokens.getPropertyValue("--surface-secondary").trim() || "#111827",
  };
  const left = 42;
  const right = 16;
  const top = 24;
  const baseline = 142;
  const liveHeight = 92;
  const replacementHeight = 48;
  const railY = baseline + replacementHeight + 16;
  const bottomLabelY = 274;

  context.font = "10px system-ui, sans-serif";
  context.textBaseline = "middle";
  context.strokeStyle = colors.grid;
  context.fillStyle = colors.text;
  context.lineWidth = 1;
  for (const tick of [0, 4, 8]) {
    const y = baseline - (tick / K) * liveHeight;
    context.beginPath();
    context.moveTo(left, y + 0.5);
    context.lineTo(cssWidth - right, y + 0.5);
    context.stroke();
    context.fillText(String(tick), 14, y);
  }
  context.beginPath();
  context.moveTo(left, baseline + 0.5);
  context.lineTo(cssWidth - right, baseline + 0.5);
  context.stroke();
  context.fillText("live", 9, top + 4);
  context.fillText("repl.", 9, baseline + replacementHeight / 2);

  if (mode === "normalized") {
    const tailWidth = Math.min(168, Math.max(114, cssWidth * 0.2));
    const gap = 14;
    const plotRight = cssWidth - right - tailWidth - gap;
    const columnWidth = (plotRight - left) / 32;
    for (let depth = 0; depth < 32; depth += 1) {
      const bucket = family.buckets[159 - depth]!;
      drawBucket(context, bucket, left + depth * columnWidth, columnWidth, {
        baseline,
        liveHeight,
        replacementHeight,
        railY,
        colors,
      });
      if (depth % 4 === 0 || depth === 31) {
        context.fillStyle = colors.text;
        context.textAlign = "center";
        context.fillText(
          String(depth),
          left + (depth + 0.5) * columnWidth,
          bottomLabelY,
        );
      }
    }
    context.textAlign = "left";
    context.fillStyle = colors.text;
    context.fillText("shared prefix depth", left, 292);
    drawTail(
      context,
      summarizeTail(family.buckets),
      plotRight + gap,
      tailWidth,
      baseline,
      colors,
    );
  } else {
    const columnWidth = (cssWidth - left - right) / 160;
    for (let index = 0; index < 160; index += 1) {
      drawBucket(
        context,
        family.buckets[index]!,
        left + index * columnWidth,
        columnWidth,
        {
          baseline,
          liveHeight,
          replacementHeight,
          railY,
          colors,
        },
      );
    }
    for (const index of [0, 40, 80, 120, 159]) {
      context.fillStyle = colors.text;
      context.textAlign = "center";
      context.fillText(
        String(index),
        left + (index + 0.5) * columnWidth,
        bottomLabelY,
      );
    }
    context.textAlign = "left";
    context.fillText("engine bucket index · closest → farthest", left, 292);
  }
}

interface DrawPalette {
  readonly text: string;
  readonly grid: string;
  readonly good: string;
  readonly questionable: string;
  readonly replacement: string;
  readonly fresh: string;
  readonly aging: string;
  readonly surface: string;
}

function drawBucket(
  context: CanvasRenderingContext2D,
  bucket: DhtBucketView,
  x: number,
  width: number,
  geometry: {
    readonly baseline: number;
    readonly liveHeight: number;
    readonly replacementHeight: number;
    readonly railY: number;
    readonly colors: DrawPalette;
  },
) {
  const barWidth = Math.max(1, width - Math.min(3, width * 0.18));
  const offset = (width - barWidth) / 2;
  const goodHeight = (bucket.good_nodes / K) * geometry.liveHeight;
  const questionableHeight =
    (bucket.questionable_nodes / K) * geometry.liveHeight;
  context.fillStyle = geometry.colors.good;
  context.fillRect(
    x + offset,
    geometry.baseline - goodHeight,
    barWidth,
    goodHeight,
  );
  context.fillStyle = geometry.colors.questionable;
  context.fillRect(
    x + offset,
    geometry.baseline - goodHeight - questionableHeight,
    barWidth,
    questionableHeight,
  );
  if (questionableHeight > 2 && barWidth > 2) {
    context.strokeStyle = geometry.colors.surface;
    context.lineWidth = 1;
    for (
      let y = geometry.baseline - goodHeight - questionableHeight + 2;
      y < geometry.baseline - goodHeight;
      y += 4
    ) {
      context.beginPath();
      context.moveTo(x + offset, y);
      context.lineTo(
        x + offset + barWidth,
        y + Math.min(3, questionableHeight),
      );
      context.stroke();
    }
  }
  const replacementHeight =
    (bucket.replacement_candidates / K) * geometry.replacementHeight;
  context.fillStyle = geometry.colors.replacement;
  context.globalAlpha = 0.68;
  context.fillRect(
    x + offset,
    geometry.baseline + 2,
    barWidth,
    replacementHeight,
  );
  context.globalAlpha = 1;
  if (bucket.oldest_live_response_age_millis !== null) {
    const age = Math.min(
      QUESTIONABLE_AGE_MILLIS,
      decimalNumber(bucket.oldest_live_response_age_millis),
    );
    context.fillStyle =
      age >= 12 * 60 * 1_000 ? geometry.colors.aging : geometry.colors.fresh;
    context.globalAlpha = 0.35 + (0.65 * age) / QUESTIONABLE_AGE_MILLIS;
    context.fillRect(x + offset, geometry.railY, barWidth, 5);
    context.globalAlpha = 1;
  }
}

function drawTail(
  context: CanvasRenderingContext2D,
  tail: TailSummary,
  x: number,
  width: number,
  baseline: number,
  colors: DrawPalette,
) {
  context.fillStyle = colors.surface;
  context.globalAlpha = 0.75;
  context.fillRect(x, 37, width, 197);
  context.globalAlpha = 1;
  context.strokeStyle = colors.grid;
  context.strokeRect(x + 0.5, 37.5, width - 1, 196);
  context.textAlign = "left";
  context.fillStyle = colors.text;
  context.font = "600 10px system-ui, sans-serif";
  context.fillText("DEPTHS 32–159", x + 11, 55);
  context.font = "600 18px system-ui, sans-serif";
  context.fillStyle = tail.live > 0 ? colors.good : colors.text;
  context.fillText(`${tail.live} live`, x + 11, 88);
  context.font = "10px system-ui, sans-serif";
  context.fillStyle = colors.text;
  context.fillText("128 deeper bands", x + 11, 109);
  context.fillText(`${tail.replacements} replacements`, x + 11, baseline + 28);
  context.fillText(`max occupancy ${tail.maximum}`, x + 11, baseline + 48);
  context.fillText(
    tail.deepest === null
      ? "no occupied outlier"
      : `deepest ${tail.deepest} bits`,
    x + 11,
    baseline + 68,
  );
}

interface TailSummary {
  readonly live: number;
  readonly replacements: number;
  readonly maximum: number;
  readonly deepest: number | null;
}

function summarizeTail(buckets: readonly DhtBucketView[]): TailSummary {
  let live = 0;
  let replacements = 0;
  let maximum = 0;
  let deepest: number | null = null;
  for (const bucket of buckets.slice(0, 128)) {
    const occupancy = bucket.good_nodes + bucket.questionable_nodes;
    live += occupancy;
    replacements += bucket.replacement_candidates;
    maximum = Math.max(maximum, occupancy);
    if (occupancy > 0)
      deepest = Math.max(deepest ?? 0, 159 - bucket.bucket_index);
  }
  return { live, replacements, maximum, deepest };
}

function OperationalFacts({
  inspection,
  dataUnits,
}: {
  readonly inspection: DhtInspectionView;
  readonly dataUnits: import("../appearance").DataUnits;
}) {
  return (
    <section
      className={styles.operations}
      aria-labelledby="dht-operations-title"
    >
      <h3 id="dht-operations-title">{localizedMessage("inspection.components.dht.panel.cumulative.session.activity")}</h3>
      <dl>
        <Metric label={localizedMessage("inspection.components.dht.panel.queries.sent")} value={inspection.queries_sent} />
        <Metric
          label={localizedMessage("inspection.components.dht.panel.responses.received")}
          value={inspection.responses_received}
        />
        <Metric label={localizedMessage("inspection.components.dht.panel.queries.received")} value={inspection.queries_received} />
        <Metric
          label={localizedMessage("inspection.components.dht.panel.datagram.traffic")}
          value={`${formatExactBytes(inspection.datagram_bytes_received, dataUnits)} in · ${formatExactBytes(inspection.datagram_bytes_sent, dataUnits)} out`}
        />
        <Metric label={localizedMessage("inspection.components.dht.panel.peers.discovered")} value={inspection.discovered_peers} />
        <Metric label={localizedMessage("inspection.components.dht.panel.malformed")} value={inspection.malformed_received} />
        <Metric label={localizedMessage("inspection.components.dht.panel.family.mismatches")} value={inspection.family_mismatched} />
        <Metric label={localizedMessage("inspection.components.dht.panel.rate.limited")} value={inspection.rate_limited} />
        <Metric
          label={localizedMessage("inspection.components.dht.panel.bootstrap.attempts")}
          value={inspection.bootstrap_attempts}
        />
        <Metric
          label={localizedMessage("inspection.components.dht.panel.routing.refreshes")}
          value={inspection.routing_refreshes}
        />
        <Metric
          label={localizedMessage("inspection.components.dht.panel.announcements")}
          value={`${inspection.announces_succeeded} succeeded · ${inspection.announces_failed} failed`}
        />
      </dl>
      <p>{localizedMessage("inspection.components.dht.panel.traffic.is.complete.udp.datagram.bytes.at")}</p>
    </section>
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

function LookupTable({
  inspection,
}: {
  readonly inspection: DhtInspectionView;
}) {
  return (
    <section className={styles.lookups} aria-labelledby="dht-lookups-title">
      <div className={styles.sectionHeading}>
        <div>
          <h3 id="dht-lookups-title">{localizedMessage("inspection.components.dht.panel.active.lookups")}</h3>
          <p>{localizedMessage("inspection.components.dht.panel.closest.progress.includes.responded.candidates.with.known")}</p>
        </div>
        <span>{inspection.lookups.length}{" "}{localizedMessage("inspection.components.dht.panel.of.32.combined")}</span>
      </div>
      {inspection.lookups.length === 0 ? (
        <div className={styles.quiet}>{localizedMessage("inspection.components.dht.panel.no.lookup.is.active")}</div>
      ) : (
        <div className={styles.tableWrap}>
          <table>
            <thead>
              <tr>
                <th>{localizedMessage("inspection.components.dht.panel.family")}</th>
                <th>{localizedMessage("inspection.components.dht.panel.target")}</th>
                <th>{localizedMessage("inspection.components.dht.panel.convergence")}</th>
                <th>{localizedMessage("inspection.components.dht.panel.candidates")}</th>
                <th>{localizedMessage("inspection.components.dht.panel.elapsed.left")}</th>
                <th>{localizedMessage("inspection.components.dht.panel.peers")}</th>
              </tr>
            </thead>
            <tbody>
              {inspection.lookups.map((lookup) => (
                <tr key={`${lookup.family}-${lookup.lookup_id}`}>
                  <td>{familyLabel(lookup.family)}</td>
                  <td>
                    <code title={lookup.target_id}>
                      {abbreviateId(lookup.target_id)}
                    </code>
                    <small>{localizedMessage("inspection.components.dht.panel.lookup")}{" "}{lookup.lookup_id}</small>
                  </td>
                  <td>
                    <strong>
                      {lookup.closest_responded_prefix_bits === null
                        ? localizedMessage("inspection.components.dht.panel.no.response")
                        : `${lookup.closest_responded_prefix_bits} shared bits`}
                    </strong>
                    <small>
                      {lookup.last_convergence_improvement_age_millis === null
                        ? localizedMessage("inspection.components.dht.panel.no.improvement.yet")
                        : `${formatDuration(lookup.last_convergence_improvement_age_millis)} since improvement`}
                    </small>
                  </td>
                  <td>
                    <CandidateBar lookup={lookup} />
                  </td>
                  <td>
                    <strong>{formatDuration(lookup.age_millis)}</strong>
                    <small>
                      {formatDuration(lookup.deadline_in_millis)}{" "}{localizedMessage("inspection.components.dht.panel.left")}</small>
                  </td>
                  <td>
                    <strong>{lookup.discovered_peers}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function CandidateBar({
  lookup,
}: {
  readonly lookup: DhtInspectionView["lookups"][number];
}) {
  const parts = [
    ["unqueried", lookup.unqueried_candidates, "Unqueried"],
    ["flight", lookup.in_flight_candidates, "In flight"],
    ["responded", lookup.responded_candidates, "Responded"],
    ["failed", lookup.failed_candidates, "Failed"],
  ] as const;
  const total = parts.reduce((sum, [, count]) => sum + count, 0);
  return (
    <div
      className={styles.candidates}
      aria-label={parts
        .map(([, count, label]) => `${label} ${count}`)
        .join(", ")}
    >
      <div aria-hidden="true">
        {parts.map(([kind, count]) =>
          count === 0 ? null : (
            <i
              key={kind}
              data-kind={kind}
              style={{ flexGrow: count / Math.max(1, total) }}
            />
          ),
        )}
      </div>
      <small>{parts.map(([, count]) => count).join(" / ")}</small>
    </div>
  );
}

function ExactBucketTable({
  family,
}: {
  readonly family: DhtFamilyInspectionView;
}) {
  return (
    <table className={styles.srOnly}>
      <caption>{localizedMessage("inspection.components.dht.panel.exact")}{" "}{familyLabel(family.family)}{" "}{localizedMessage("inspection.components.dht.panel.dht.routing.bucket.observations")}</caption>
      <thead>
        <tr>
          <th>{localizedMessage("inspection.components.dht.panel.shared.prefix.depth")}</th>
          <th>{localizedMessage("inspection.components.dht.panel.bucket.index")}</th>
          <th>{localizedMessage("inspection.components.dht.panel.good")}</th>
          <th>{localizedMessage("inspection.components.dht.panel.questionable")}</th>
          <th>{localizedMessage("inspection.components.dht.panel.replacements")}</th>
          <th>{localizedMessage("inspection.components.dht.panel.oldest.response.age")}</th>
        </tr>
      </thead>
      <tbody>
        {family.buckets.map((bucket) => (
          <tr key={bucket.bucket_index}>
            <td>{159 - bucket.bucket_index}</td>
            <td>{bucket.bucket_index}</td>
            <td>{bucket.good_nodes}</td>
            <td>{bucket.questionable_nodes}</td>
            <td>{bucket.replacement_candidates}</td>
            <td>
              {bucket.oldest_live_response_age_millis === null
                ? localizedMessage("inspection.components.dht.panel.empty")
                : formatDuration(bucket.oldest_live_response_age_millis)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function sum(
  buckets: readonly DhtBucketView[],
  read: (bucket: DhtBucketView) => number,
): number {
  return buckets.reduce((total, bucket) => total + read(bucket), 0);
}

function decimalNumber(value: string | null): number {
  if (value === null) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatDuration(value: string): string {
  const millis = decimalNumber(value);
  if (millis < 1_000) return `${Math.round(millis)} ms`;
  const seconds = Math.round(millis / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder === 0 ? `${minutes}m` : `${minutes}m ${remainder}s`;
}

function lifecycleLabel(lifecycle: DhtInspectionView["lifecycle"]): string {
  switch (lifecycle) {
    case "disabled":
      return localizedMessage("inspection.components.dht.panel.disabled");
    case "offline":
      return localizedMessage("inspection.components.dht.panel.offline");
    case "bootstrap_empty":
      return localizedMessage("inspection.components.dht.panel.bootstrapping");
    case "participating":
      return localizedMessage("inspection.components.dht.panel.participating");
    case "inactive":
      return localizedMessage("inspection.components.dht.panel.inactive");
    case "suspended":
      return localizedMessage("inspection.components.dht.panel.suspended");
  }
}

function policyLabel(policy: DhtInspectionView["network_policy"]): string {
  switch (policy) {
    case "offline":
      return localizedMessage("inspection.components.dht.panel.network.disabled");
    case "loopback_only":
      return localizedMessage("inspection.components.dht.panel.loopback.only");
    case "online":
      return localizedMessage("inspection.components.dht.panel.online.policy");
  }
}

function familyLabel(family: DhtAddressFamilyView): string {
  return family === "ipv4" ? "IPv4" : "IPv6";
}

function abbreviateId(id: string): string {
  return `${id.slice(0, 8)}…${id.slice(-6)}`;
}
