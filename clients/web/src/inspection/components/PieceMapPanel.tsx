import { formatNumber, message as localizedMessage  } from "../../localization/runtime";
import { useEffect, useMemo, useRef, useState } from "react";

import { useInspectionStore } from "../context";
import type { PieceMapSet, ViewMaterialization } from "../model";
import {
  buildPieceBuckets,
  MAX_DEVICE_PIXEL_RATIO,
  PieceCellState,
  pieceMapGeometry,
} from "./PieceMap";
import styles from "./PieceMapPanel.module.css";

const LEGEND = [
  ["Missing", "var(--piece-missing)", null],
  ["Mixed bucket", "var(--piece-mixed)", "mixed"],
  ["Verified", "var(--piece-verified)", null],
  ["Requested", "var(--piece-requested)", null],
  ["Received", "var(--piece-received)", null],
  ["Stored", "var(--piece-stored)", null],
  ["Hashing", "var(--piece-hashing)", null],
  ["Failed", "var(--piece-failed)", "failed"],
] as const;

export function PieceMapPanel({ torrentId }: { readonly torrentId: string }) {
  const pieces = useInspectionStore((state) => state.piecesByTorrent[torrentId]);
  const materialization = useInspectionStore((state) => state.viewStatus.pieces);
  const torrentName = useInspectionStore(
    (state) => state.torrents[torrentId]?.name ?? "Selected torrent",
  );
  if (pieces === undefined || pieces.pieceCount === 0) {
    return <EmptyPieceMap materialization={materialization} />;
  }
  return (
    <div className={styles.panel}>
      <header className={styles.summary}>
        <div>
          <h2>{localizedMessage("inspection.components.piece.map.panel.piece.availability")}</h2>
          <p>{torrentName}</p>
        </div>
        <div className={styles.counts} aria-label={localizedMessage("inspection.components.piece.map.panel.piece.map.summary")}>
          <span>{formatNumber(countVerified(pieces))}{" "}{localizedMessage("inspection.components.piece.map.panel.verified")}</span>
          <span>{formatNumber(pieces.active.length)}{" "}{localizedMessage("inspection.components.piece.map.panel.active")}</span>
          <span>{formatNumber(pieces.pieceCount)}{" "}{localizedMessage("inspection.components.piece.map.panel.pieces")}</span>
        </div>
      </header>
      <PieceCanvas pieces={pieces} />
    </div>
  );
}

function PieceCanvas({ pieces }: { readonly pieces: PieceMapSet }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(640);
  const geometry = useMemo(
    () => pieceMapGeometry(width, pieces.pieceCount),
    [pieces.pieceCount, width],
  );
  const summary = useMemo(
    () => buildPieceBuckets(pieces, geometry.visualCellCount),
    [geometry.visualCellCount, pieces, pieces.revision],
  );

  useEffect(() => {
    const element = wrapRef.current;
    if (element === null) return;
    const measure = () => {
      const next = Math.floor(element.getBoundingClientRect().width);
      if (next > 0) setWidth(next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const frame = requestAnimationFrame(() => {
      drawPieceMap(canvas, geometry, summary.states);
    });
    return () => cancelAnimationFrame(frame);
  }, [geometry, pieces.revision, summary.states]);

  const label = `${formatNumber(pieces.pieceCount)} pieces: ${formatNumber(summary.verifiedCount)} verified, ${formatNumber(summary.activeCount)} active`;
  return (
    <section className={styles.mapSection} aria-label={localizedMessage("inspection.components.piece.map.panel.piece.map.visualization")}>
      <div ref={wrapRef} className={styles.canvasWrap}>
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          role="img"
          aria-label={label}
        />
      </div>
      <div className={styles.legend} aria-label={localizedMessage("inspection.components.piece.map.panel.piece.state.legend")}>
        {LEGEND.map(([label, color, pattern]) => (
          <span key={label}>
            <i
              className={styles.swatch}
              data-pattern={pattern ?? undefined}
              style={{ "--swatch": color } as React.CSSProperties}
              aria-hidden="true"
            />
            {label}
          </span>
        ))}
      </div>
    </section>
  );
}

function drawPieceMap(
  canvas: HTMLCanvasElement,
  geometry: ReturnType<typeof pieceMapGeometry>,
  states: Uint8Array,
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
  const colors = pieceColors(computed);
  const stride = geometry.cellSize + geometry.gap;
  for (let index = 0; index < states.length; index += 1) {
    const state = states[index] as PieceCellState;
    const x = (index % geometry.columns) * stride;
    const y = Math.floor(index / geometry.columns) * stride;
    context.fillStyle = colors[state];
    context.fillRect(x, y, geometry.cellSize, geometry.cellSize);
    if (state === PieceCellState.Mixed) {
      context.strokeStyle = colors.pattern;
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(x, y + geometry.cellSize);
      context.lineTo(x + geometry.cellSize, y);
      context.stroke();
    } else if (state === PieceCellState.Failed) {
      context.strokeStyle = colors.pattern;
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(x + 1, y + 1);
      context.lineTo(x + geometry.cellSize - 1, y + geometry.cellSize - 1);
      context.moveTo(x + geometry.cellSize - 1, y + 1);
      context.lineTo(x + 1, y + geometry.cellSize - 1);
      context.stroke();
    }
  }
}

function pieceColors(computed: CSSStyleDeclaration) {
  const color = (name: string, fallback: string) =>
    computed.getPropertyValue(name).trim() || fallback;
  return {
    [PieceCellState.Missing]: color("--piece-missing", "#efebe6"),
    [PieceCellState.Mixed]: color("--piece-mixed", "#1f8eee"),
    [PieceCellState.Verified]: color("--piece-verified", "#1f8eee"),
    [PieceCellState.Requested]: color("--piece-requested", "#d39a3a"),
    [PieceCellState.Received]: color("--piece-received", "#80c7ff"),
    [PieceCellState.Stored]: color("--piece-stored", "#6f7fc4"),
    [PieceCellState.Hashing]: color("--piece-hashing", "#9a6aa8"),
    [PieceCellState.Failed]: color("--piece-failed", "#b3402f"),
    pattern: color("--piece-pattern", "#ffffff"),
  };
}

function countVerified(pieces: PieceMapSet): number {
  let count = 0;
  for (const value of pieces.verified) count += value === 1 ? 1 : 0;
  return count;
}

function EmptyPieceMap({
  materialization,
}: {
  readonly materialization: ViewMaterialization;
}) {
  const message =
    materialization.status === "loading"
      ? "Loading verified and active piece state…"
      : materialization.status === "unavailable" ||
          materialization.status === "unsupported"
        ? materialization.reason
        : "Piece geometry will appear after verified metadata is available.";
  return (
    <div className={styles.empty}>
      <strong>{localizedMessage("inspection.components.piece.map.panel.piece.map.unavailable")}</strong>
      <p>{message}</p>
    </div>
  );
}
