import { usePlayback } from "./VideoPlayer";
import { message as localizedMessage } from "../../localization/runtime";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type UIEvent,
} from "react";

import { useInspectionCommand, useInspectionStore } from "../context";
import { formatDecimalProgress, formatExactBytes, torrentVisibleProgress } from "../format";
import type { LayoutMode } from "../layout";
import { episodeLabel, sortFileRows, sortMediaRows } from "../library-media";
import type { FileRow, MediaRow, TorrentRow, ViewMaterialization } from "../model";
import { seedLimitReached } from "../seed-stop";
import { Icon } from "./Icon";
import { useToast } from "./Toast";
import styles from "./LibraryDetailView.module.css";

const OVERSCAN = 5;

export function LibraryDetailView({
  torrent,
  onBack,
}: {
  readonly torrent: TorrentRow;
  readonly onBack: () => void;
}) {
  const playback = usePlayback();
  const visibleProgress = torrentVisibleProgress(torrent);
  const dataUnits = useInspectionStore((state) => state.presentation.dataUnits);
  const layout = useInspectionStore((state) => state.presentation.layout);
  const mode = useInspectionStore(
    (state) => state.presentation.libraryDetailMode,
  );
  const selectMode = useInspectionStore(
    (state) => state.selectLibraryDetailMode,
  );
  const openInWorkbench = useInspectionStore(
    (state) => state.openTorrentInWorkbench,
  );
  const media = useInspectionStore(
    (state) => state.mediaByTorrent[torrent.id],
  );
  const files = useInspectionStore(
    (state) => state.filesByTorrent[torrent.id],
  );
  const mediaStatus = useInspectionStore((state) => state.viewStatus.media);
  const filesStatus = useInspectionStore((state) => state.viewStatus.files);
  const demo = useInspectionStore((state) => state.demo);
  const execute = useInspectionCommand();
  const autoFallback = useRef(torrent.id);
  const playbackRequest = useRef(0);
  const [playbackPendingFile, setPlaybackPendingFile] = useState<number | null>(
    null,
  );
  const toast = useToast();

  useEffect(() => {
    autoFallback.current = torrent.id;
    playbackRequest.current += 1;
    setPlaybackPendingFile(null);
  }, [torrent.id]);

  useEffect(
    () => () => {
      playbackRequest.current += 1;
    },
    [],
  );

  useEffect(() => {
    if (
      mode === "media" &&
      autoFallback.current === torrent.id &&
      media?.state === "available" &&
      media.order.length === 0
    ) {
      autoFallback.current = "";
      selectMode("files");
    }
  }, [media, mode, selectMode, torrent.id]);

  const chooseMode = (next: "media" | "files") => {
    autoFallback.current = "";
    selectMode(next);
  };
  const mediaCount = media?.order.length;
  const playMedia = async (row: MediaRow) => {
    if (
      demo !== null ||
      playbackPendingFile !== null ||
      !isPlaybackEligible(row.mediaAvailability)
    ) {
      return;
    }
    if (playback.canPlay(row.name, row.mediaAvailability)) {
      playback.play({ torrentId: torrent.id, fileIndex: row.fileIndex, fileName: row.name, lengthBytes: row.lengthBytes });
      return;
    }
    // Remote sessions have no new-tab Open to fall back to.
    if (playback.remote) return;
    const request = playbackRequest.current + 1;
    playbackRequest.current = request;
    setPlaybackPendingFile(row.fileIndex);
    try {
      // The player opening is the confirmation; only failures need words.
      await execute({
        type: "open_file",
        torrentId: torrent.id,
        fileIndex: row.fileIndex,
      });
    } catch (error) {
      if (playbackRequest.current === request) {
        toast.show({
          tone: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      if (playbackRequest.current === request) {
        setPlaybackPendingFile(null);
      }
    }
  };

  return (
    <section className={styles.detail} aria-labelledby="library-detail-heading">
      <header className={styles.header}>
        <button
          type="button"
          className={styles.back}
          aria-label={localizedMessage("inspection.components.library.detail.view.back.to.library")}
          autoFocus
          onClick={onBack}
        >
          <Icon name="arrowBack" />
          <span>{localizedMessage("inspection.components.library.detail.view.library")}</span>
        </button>
        <div>
          <h1 id="library-detail-heading">{torrent.name}</h1>
        </div>
        <button
          type="button"
          className={styles.workbench}
          aria-label={localizedMessage("inspection.components.library.detail.view.open.in.workbench")}
          onClick={() => openInWorkbench(torrent.id)}
        >
          <Icon name="transfers" />
          <span>{localizedMessage("inspection.components.library.detail.view.open.in.workbench")}</span>
        </button>
      </header>
      <div className={styles.body}>
        <aside className={styles.summary} aria-label={localizedMessage("inspection.components.library.detail.view.torrent.content.summary")}>
          <div
            className={styles.placeholder}
            data-full={visibleProgress !== null && visibleProgress >= 1 ? true : undefined}
            style={waterLevel(visibleProgress)}
            aria-hidden="true"
          >
            <span>{initials(torrent.name)}</span>
          </div>
          <div className={styles.summaryText}>
            <strong>{torrent.name}</strong>
            <span>{torrentSummary(torrent)}</span>
            <span>
              {torrent.sizeBytes === null
                ? localizedMessage("inspection.components.library.detail.view.size.pending")
                : formatExactBytes(String(torrent.sizeBytes), dataUnits)}
            </span>
            {mediaCount === undefined ? null : (
              <span>
                {mediaCount.toLocaleString()}{" "}{localizedMessage("inspection.components.library.detail.view.recognized.video")}{mediaCount === 1 ? "" : "s"}
              </span>
            )}
          </div>
        </aside>
        <div className={styles.catalog}>
          <div className={styles.tabs} role="tablist" aria-label={localizedMessage("inspection.components.library.detail.view.content.view")}>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "media"}
              onClick={() => chooseMode("media")}
            >{localizedMessage("inspection.components.library.detail.view.media")}</button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "files"}
              onClick={() => chooseMode("files")}
            >{localizedMessage("inspection.components.library.detail.view.all.files")}</button>
          </div>
          {mode === "media" ? (
            <MediaCatalog
              rows={media === undefined ? [] : media.order
                .map((id) => media.rows[id])
                .filter((row): row is MediaRow => row !== undefined)}
              state={media?.state}
              materialization={mediaStatus}
              layout={layout}
              dataUnits={dataUnits}
              playbackPendingFile={playbackPendingFile}
              playbackUnavailableReason={
                demo === null
                  ? undefined
                  : "Playback is unavailable in demo scenarios."
              }
              onPlay={(row) => void playMedia(row)}
            />
          ) : (
            <FileCatalog
              rows={files === undefined ? [] : files.order
                .map((id) => files.rows[id])
                .filter((row): row is FileRow => row !== undefined && !row.padding)}
              state={files?.state}
              total={files?.page.total ?? 0}
              materialization={filesStatus}
              layout={layout}
              dataUnits={dataUnits}
            />
          )}
        </div>
      </div>
    </section>
  );
}

function MediaCatalog({
  rows,
  state,
  materialization,
  layout,
  dataUnits,
  playbackPendingFile,
  playbackUnavailableReason,
  onPlay,
}: {
  readonly rows: readonly MediaRow[];
  readonly state: "metadata_pending" | "available" | "torrent_missing" | undefined;
  readonly materialization: ViewMaterialization;
  readonly layout: LayoutMode;
  readonly dataUnits: "decimal" | "binary";
  readonly playbackPendingFile: number | null;
  readonly playbackUnavailableReason: string | undefined;
  readonly onPlay: (row: MediaRow) => void;
}) {
  if (materialization.status !== "ready") {
    return <CatalogMessage message={materializationMessage(materialization)} />;
  }
  if (state === "metadata_pending") {
    return <CatalogMessage message="Waiting for torrent metadata…" />;
  }
  if (state === "torrent_missing") {
    return <CatalogMessage message="This torrent is no longer in the Library." />;
  }
  const sorted = sortMediaRows(rows);
  if (sorted.length === 0) {
    return <CatalogMessage message="No recognized video files" />;
  }
  return (
    <VirtualCatalog
      rows={sorted.map((row) => ({ kind: "media" as const, row }))}
      layout={layout}
      dataUnits={dataUnits}
      label={localizedMessage("inspection.components.library.detail.view.recognized.video.files")}
      playbackPendingFile={playbackPendingFile}
      playbackUnavailableReason={playbackUnavailableReason}
      onPlay={onPlay}
    />
  );
}

function FileCatalog({
  rows,
  state,
  total,
  materialization,
  layout,
  dataUnits,
}: {
  readonly rows: readonly FileRow[];
  readonly state: "metadata_pending" | "available" | "torrent_missing" | undefined;
  readonly total: number;
  readonly materialization: ViewMaterialization;
  readonly layout: LayoutMode;
  readonly dataUnits: "decimal" | "binary";
}) {
  if (materialization.status !== "ready") {
    return <CatalogMessage message={materializationMessage(materialization)} />;
  }
  if (state === "metadata_pending") {
    return <CatalogMessage message="Waiting for torrent metadata…" />;
  }
  if (state === "torrent_missing") {
    return <CatalogMessage message="This torrent is no longer in the Library." />;
  }
  const sorted = sortFileRows(rows);
  if (sorted.length === 0) return <CatalogMessage message="No files" />;
  return (
    <>
      {total > sorted.length ? (
        <p className={styles.pageNotice}>{localizedMessage("inspection.components.library.detail.view.showing.the.first")}{" "}{sorted.length.toLocaleString()}{" "}{localizedMessage("inspection.components.library.detail.view.of")}{" "}{total.toLocaleString()}{" "}{localizedMessage("inspection.components.library.detail.view.files")}</p>
      ) : null}
      <VirtualCatalog
        rows={sorted.map((row) => ({ kind: "file" as const, row }))}
        layout={layout}
        dataUnits={dataUnits}
        label={localizedMessage("inspection.components.library.detail.view.all.torrent.files")}
      />
    </>
  );
}

type CatalogRow =
  | { readonly kind: "media"; readonly row: MediaRow }
  | { readonly kind: "file"; readonly row: FileRow };

function VirtualCatalog({
  rows,
  layout,
  dataUnits,
  label,
  playbackPendingFile = null,
  playbackUnavailableReason,
  onPlay,
}: {
  readonly rows: readonly CatalogRow[];
  readonly layout: LayoutMode;
  readonly dataUnits: "decimal" | "binary";
  readonly label: string;
  readonly playbackPendingFile?: number | null;
  readonly playbackUnavailableReason?: string | undefined;
  readonly onPlay?: ((row: MediaRow) => void) | undefined;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(640);
  const rowHeight = layout === "phone" ? 104 : 82;

  useEffect(() => {
    const element = viewportRef.current;
    if (element === null) return;
    const measure = () => setHeight(element.clientHeight || 640);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN);
  const count = Math.ceil(height / rowHeight) + OVERSCAN * 2;
  const visible = rows.slice(first, Math.min(rows.length, first + count));
  return (
    <div
      ref={viewportRef}
      className={styles.viewport}
      role="list"
      aria-label={label}
      tabIndex={0}
      onScroll={(event: UIEvent<HTMLDivElement>) =>
        setScrollTop(event.currentTarget.scrollTop)
      }
    >
      <div className={styles.canvas} style={{ height: rows.length * rowHeight }}>
        {visible.map((entry, offset) => (
          <CatalogRowView
            key={`${entry.kind}:${entry.row.id}`}
            entry={entry}
            dataUnits={dataUnits}
            position={first + offset + 1}
            setSize={rows.length}
            playbackPendingFile={playbackPendingFile}
            playbackUnavailableReason={playbackUnavailableReason}
            onPlay={onPlay}
            style={{ transform: `translateY(${(first + offset) * rowHeight}px)` }}
          />
        ))}
      </div>
    </div>
  );
}

function CatalogRowView({
  entry,
  dataUnits,
  position,
  setSize,
  playbackPendingFile,
  playbackUnavailableReason,
  onPlay,
  style,
}: {
  readonly entry: CatalogRow;
  readonly dataUnits: "decimal" | "binary";
  readonly position: number;
  readonly setSize: number;
  readonly playbackPendingFile: number | null;
  readonly playbackUnavailableReason?: string | undefined;
  readonly onPlay?: ((row: MediaRow) => void) | undefined;
  readonly style: CSSProperties;
}) {
  const row = entry.row;
  const label = entry.kind === "media" ? episodeLabel(entry.row) : null;
  const downloaded = row.verifiedBytes === row.lengthBytes;
  const progressState = downloaded
    ? "Downloaded"
    : row.selection === "skipped"
      ? "Not selected"
      : row.doneBytes === "0"
        ? "Not downloaded"
        : "Partially downloaded";
  const playback = usePlayback();
  const playbackReason =
    entry.kind === "media"
      ? playbackDisabledReason(
          entry.row,
          playbackPendingFile,
          playback.remote && !playback.canPlay(row.name, row.mediaAvailability)
            ? localizedMessage("remote.video.completed.mp4") : playbackUnavailableReason,
        )
      : undefined;
  return (
    <article
      className={styles.row}
      style={style}
      role="listitem"
      aria-posinset={position}
      aria-setsize={setSize}
    >
      {entry.kind === "media" ? (
        <button
          type="button"
          className={`${styles.type} ${styles.play}`}
          aria-label={`Play ${row.name}`}
          aria-description={playbackReason}
          title={playbackReason}
          disabled={playbackReason !== undefined}
          onClick={() => onPlay?.(entry.row)}
        >
          <span aria-hidden="true">
            {playbackPendingFile === entry.row.fileIndex ? "…" : "▶"}
          </span>
        </button>
      ) : (
        <span className={styles.type} aria-hidden="true">
          {row.extension.slice(0, 3).toUpperCase() || "FILE"}
        </span>
      )}
      <span className={styles.identity}>
        <span className={styles.rowHeading}>
          {label === null ? null : <b>{label}</b>}
          <strong title={row.name}>{row.name}</strong>
        </span>
        <span title={row.path.join("/")}>{row.folder || "Torrent root"}</span>
        <span className={styles.progress} aria-label={`${row.name} download progress`}>
          <span aria-hidden="true">
            <span style={{ width: formatDecimalProgress(row.doneBytes, row.lengthBytes) }} />
          </span>
          {formatDecimalProgress(row.doneBytes, row.lengthBytes)}{" "}{localizedMessage("inspection.components.library.detail.view.done")}{" "}{formatDecimalProgress(row.verifiedBytes, row.lengthBytes)}{" "}{localizedMessage("inspection.components.library.detail.view.verified")}</span>
      </span>
      <span className={styles.facts}>
        <strong data-downloaded={downloaded || undefined}>
          {progressState}
        </strong>
        <span>{formatExactBytes(row.lengthBytes, dataUnits)}</span>
        <span>
          {selectionLabel(row.selection)} · {availabilityLabel(row.mediaAvailability)}
        </span>
      </span>
    </article>
  );
}

function playbackDisabledReason(
  row: MediaRow,
  pendingFile: number | null,
  unavailableReason?: string,
): string | undefined {
  if (unavailableReason !== undefined) return unavailableReason;
  if (pendingFile === row.fileIndex) return localizedMessage("inspection.components.library.detail.view.opening.this.file.for.playback");
  if (pendingFile !== null) return localizedMessage("inspection.components.library.detail.view.another.media.file.is.opening");
  if (isPlaybackEligible(row.mediaAvailability)) return undefined;
  return `Playback is unavailable: ${availabilityLabel(row.mediaAvailability).toLocaleLowerCase()}.`;
}

function isPlaybackEligible(
  availability: MediaRow["mediaAvailability"],
): boolean {
  return availability === "available" || availability === "streamable";
}

function CatalogMessage({ message }: { readonly message: string }) {
  return (
    <div className={styles.message} role="status">
      <span aria-hidden="true">◇</span>
      <strong>{message}</strong>
    </div>
  );
}

function materializationMessage(materialization: ViewMaterialization): string {
  switch (materialization.status) {
    case "not_requested":
      return localizedMessage("inspection.components.library.detail.view.content.details.are.not.requested");
    case "loading":
      return localizedMessage("inspection.components.library.detail.view.loading.content.details");
    case "unavailable":
    case "unsupported":
      return materialization.reason;
    case "stale":
    case "ready":
      return localizedMessage("inspection.components.library.detail.view.no.content");
  }
}

function torrentSummary(torrent: TorrentRow): string {
  switch (torrent.status) {
    case "metadata": return localizedMessage("inspection.components.library.detail.view.finding.content.details");
    case "downloading": return localizedMessage("inspection.components.library.detail.view.downloading");
    case "complete": return localizedMessage("inspection.components.library.detail.view.available.offline");
    case "paused":
      return seedLimitReached(torrent)
        ? localizedMessage("inspection.components.library.detail.view.seed.limit.reached")
        : localizedMessage("inspection.components.library.detail.view.paused");
    case "checking": return localizedMessage("inspection.components.library.detail.view.checking.downloaded.data");
    case "error": return localizedMessage("inspection.components.library.detail.view.needs.attention");
  }
}

function selectionLabel(selection: "normal" | "high" | "skipped" | null): string {
  if (selection === "high") return localizedMessage("inspection.components.library.detail.view.high.priority");
  if (selection === "skipped") return localizedMessage("inspection.components.library.detail.view.skipped");
  return localizedMessage("inspection.components.library.detail.view.normal.priority");
}

function availabilityLabel(
  availability: MediaRow["mediaAvailability"],
): string {
  switch (availability) {
    case "available": return localizedMessage("inspection.components.library.detail.view.available");
    case "streamable": return localizedMessage("inspection.components.library.detail.view.streamable");
    case "metadata_unavailable": return localizedMessage("inspection.components.library.detail.view.getting.torrent.info");
    case "invalid_file": return localizedMessage("inspection.components.library.detail.view.invalid.file");
    case "padding": return localizedMessage("inspection.components.library.detail.view.padding");
    case "incomplete": return localizedMessage("inspection.components.library.detail.view.incomplete");
    case "checking": return localizedMessage("inspection.components.library.detail.view.checking");
    case "unverified": return localizedMessage("inspection.components.library.detail.view.not.verified");
    case "storage_unavailable": return localizedMessage("inspection.components.library.detail.view.storage.unavailable");
    case "removing": return localizedMessage("inspection.components.library.detail.view.removing");
    case "server_unavailable": return localizedMessage("inspection.components.library.detail.view.server.unavailable");
    case "resource_limit": return localizedMessage("inspection.components.library.detail.view.temporarily.unavailable");
  }
}

function initials(name: string): string {
  const value = name
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.slice(0, 1).toUpperCase())
    .join("");
  return value || "RS";
}

/** The tile is the icon's box: water rises with verified download progress. */
export function waterLevel(progress: number | null): CSSProperties {
  return { "--water-level": `${Math.round(Math.min(1, Math.max(0, progress ?? 0)) * 100)}%` } as CSSProperties;
}
