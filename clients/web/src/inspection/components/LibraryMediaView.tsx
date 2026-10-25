import { message as localizedMessage, useProductLocale } from "../../localization/runtime";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import type { LibraryAvailabilityFilter, LibraryMediaSort } from "../../api";
import type { DataUnits } from "../appearance";
import { useInspectionStore } from "../context";
import { formatBytes } from "../format";
import {
  libraryMediaRequest,
  presetGroups,
  sameLibraryRequest,
  type LibraryBrowseState,
  type LibraryPreset,
} from "../library-browse";
import type { LibraryGroupRow, LibraryItemRow, LibraryMediaSet } from "../model";
import { Icon, type IconName } from "./Icon";
import { SegmentedControl } from "./SegmentedControl";
import { VirtualTable, type VirtualColumn } from "./VirtualTable";
import { isPlaybackEligible, useMediaPlayback } from "./useMediaPlayback";
import styles from "./LibraryMediaView.module.css";

const SEARCH_DELAY_MILLIS = 250;

/**
 * The cross-torrent Library (Tactical 363): one host query, shown as cards or
 * a list, with groups for shows, albums and torrents.
 */
export function LibraryMediaView({
  returnFocusItemId = null,
  onOpenTorrent,
}: {
  /** The item whose source torrent was opened, focused again on return. */
  readonly returnFocusItemId?: string | null;
  readonly onOpenTorrent: (torrentId: string, itemId: string) => void;
}) {
  const browse = useInspectionStore((state) => state.presentation.libraryBrowse);
  const update = useInspectionStore((state) => state.updateLibraryBrowse);
  const media = useInspectionStore((state) => state.libraryMedia);
  const status = useInspectionStore((state) => state.viewStatus.libraryMedia);
  const dataUnits = useInspectionStore((state) => state.presentation.dataUnits);
  const request = libraryMediaRequest(browse);
  const current = media !== null && sameLibraryRequest(media.request, request);
  const grouped = request.query.grouping !== "none";

  return (
    <section className={styles.library} aria-labelledby="library-media-heading">
      <header className={styles.heading}>
        {browse.group === null ? null : (
          <button
            type="button"
            className={styles.back}
            // Narrow layouts show only the arrow.
            aria-label={localizedMessage("inspection.components.library.media.back", {
              preset: presetLabel(browse.preset),
            })}
            onClick={() => update({ group: null })}
          >
            <Icon name="arrowBack" />
            <span aria-hidden="true">
              {localizedMessage("inspection.components.library.media.back", {
                preset: presetLabel(browse.preset),
              })}
            </span>
          </button>
        )}
        <div className={styles.title}>
          <h1 id="library-media-heading">
            {browse.group?.title ?? presetLabel(browse.preset)}
          </h1>
          <p aria-live="polite">{summary(media, status.status, grouped, browse.preset)}</p>
        </div>
        <SegmentedControl
          name="library-layout"
          label={localizedMessage("inspection.components.library.media.layout")}
          value={browse.layout}
          options={[
            {
              value: "grid",
              label: localizedMessage("inspection.components.library.media.layout.grid"),
            },
            {
              value: "list",
              label: localizedMessage("inspection.components.library.media.layout.list"),
            },
          ]}
          onChange={(layout) => update({ layout, page: browse.page })}
        />
      </header>
      <Toolbar browse={browse} />
      <div
        className={styles.viewport}
        aria-busy={status.status === "loading" || undefined}
        data-stale={(media !== null && !current) || undefined}
        data-layout={
          !grouped && browse.layout === "list" && (media?.items.length ?? 0) > 0
            ? "list"
            : undefined
        }
      >
        <LibraryContent
          media={media}
          status={status}
          grouped={grouped}
          browse={browse}
          dataUnits={dataUnits}
          onOpenGroup={(group) =>
            update({ group: { id: group.id, title: group.title } })
          }
          returnFocusItemId={returnFocusItemId}
          onOpenTorrent={onOpenTorrent}
        />
      </div>
      {media === null ? null : (
        <Pager
          media={media}
          onPage={(page) => update({ page })}
        />
      )}
    </section>
  );
}

function Toolbar({ browse }: { readonly browse: LibraryBrowseState }) {
  const update = useInspectionStore((state) => state.updateLibraryBrowse);
  const [text, setText] = useState(browse.text);

  useEffect(() => {
    if (text === browse.text) return;
    const timer = globalThis.setTimeout(
      () => update({ text }),
      SEARCH_DELAY_MILLIS,
    );
    return () => globalThis.clearTimeout(timer);
  }, [browse.text, text, update]);

  return (
    <div className={styles.toolbar}>
      <input
        type="search"
        className={styles.search}
        aria-label={localizedMessage("inspection.components.library.media.search.label")}
        placeholder={localizedMessage("inspection.components.library.media.search.placeholder")}
        value={text}
        maxLength={256}
        onChange={(event) => setText(event.currentTarget.value)}
      />
      {presetGroups(browse.preset) && browse.preset !== "torrents" && browse.group === null ? (
        <SegmentedControl
          name="library-grouping"
          label={localizedMessage("inspection.components.library.media.grouping")}
          value={browse.grouped ? "groups" : "items"}
          options={[
            { value: "groups", label: groupingLabel(browse.preset, true) },
            { value: "items", label: groupingLabel(browse.preset, false) },
          ]}
          onChange={(value) => update({ grouped: value === "groups" })}
        />
      ) : null}
      <SegmentedControl
        name="library-availability"
        label={localizedMessage("inspection.components.library.media.availability")}
        value={browse.availability}
        options={(["any", "offline", "incomplete"] as const).map((availability) => ({
          value: availability,
          label: availabilityLabel(availability),
        }))}
        onChange={(availability) => update({ availability })}
      />
      <label className={styles.sort}>
        <span>{localizedMessage("inspection.components.library.media.sort.label")}</span>
        <select
          value={browse.sort}
          onChange={(event) =>
            update({ sort: event.currentTarget.value as LibraryMediaSort })
          }
        >
          {(["title", "size", "source"] as const).map((sort) => (
            <option key={sort} value={sort}>
              {sortLabel(sort)}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className={styles.toggle}
        aria-pressed={browse.descending}
        title={localizedMessage("inspection.components.library.media.sort.descending")}
        onClick={() => update({ descending: !browse.descending })}
      >
        <span aria-hidden="true">{browse.descending ? "↓" : "↑"}</span>
        {localizedMessage("inspection.components.library.media.sort.descending")}
      </button>
      <label className={styles.archived}>
        <input
          type="checkbox"
          checked={browse.includeArchived}
          onChange={(event) =>
            update({ includeArchived: event.currentTarget.checked })
          }
        />
        <span>{localizedMessage("inspection.components.library.media.archived")}</span>
      </label>
    </div>
  );
}

function LibraryContent({
  media,
  status,
  grouped,
  browse,
  dataUnits,
  returnFocusItemId,
  onOpenGroup,
  onOpenTorrent,
}: {
  readonly media: LibraryMediaSet | null;
  readonly status: { readonly status: string; readonly reason?: string };
  readonly grouped: boolean;
  readonly browse: LibraryBrowseState;
  readonly dataUnits: DataUnits;
  readonly returnFocusItemId: string | null;
  readonly onOpenGroup: (group: LibraryGroupRow) => void;
  readonly onOpenTorrent: (torrentId: string, itemId: string) => void;
}) {
  if (media === null) {
    return (
      <LibraryMessage
        message={
          status.status === "loading" || status.status === "not_requested"
            ? localizedMessage("inspection.components.library.media.loading")
            : (status.reason ??
              localizedMessage("inspection.components.library.media.unavailable"))
        }
      />
    );
  }
  const rows = grouped ? media.groups.length : media.items.length;
  if (rows === 0) {
    return (
      <LibraryMessage
        message={
          media.facets.items === 0 && media.request.query.text === ""
            ? localizedMessage("inspection.components.library.media.empty.library")
            : localizedMessage("inspection.components.library.media.empty.filters")
        }
        detail={
          media.facets.metadata_pending === 0
            ? undefined
            : localizedMessage("inspection.components.library.media.pending", {
                count: media.facets.metadata_pending,
              })
        }
      />
    );
  }
  if (grouped) {
    return (
      <ul className={styles.grid} aria-label={presetLabel(browse.preset)}>
        {media.groups.map((group) => (
          <li key={group.id} className={styles.card}>
            <button type="button" onClick={() => onOpenGroup(group)}>
              <span
                className={styles.art}
                data-full={group.offlineCount === group.itemCount || undefined}
                style={waterLevel(group.offlineCount, group.itemCount)}
                aria-hidden="true"
              >
                <Icon className={styles.kind} name={groupIcon(group.id)} />
              </span>
              <span className={styles.cardBody}>
                <strong title={group.title}>{group.title}</strong>
                <span>{groupFacts(group, browse.preset)}</span>
                <span>
                  {localizedMessage("inspection.components.library.media.group.offline", {
                    offline: group.offlineCount,
                    count: group.itemCount,
                  })}{" "}
                  · {formatBytes(Number(group.totalBytes), dataUnits)}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    );
  }
  return browse.layout === "list" ? (
    <ItemList
      items={media.items}
      dataUnits={dataUnits}
      returnFocusItemId={returnFocusItemId}
      onOpenTorrent={onOpenTorrent}
    />
  ) : (
    <ItemGrid
      items={media.items}
      dataUnits={dataUnits}
      returnFocusItemId={returnFocusItemId}
      onOpenTorrent={onOpenTorrent}
    />
  );
}

function ItemGrid({
  items,
  dataUnits,
  returnFocusItemId,
  onOpenTorrent,
}: {
  readonly items: readonly LibraryItemRow[];
  readonly dataUnits: DataUnits;
  readonly returnFocusItemId: string | null;
  readonly onOpenTorrent: (torrentId: string, itemId: string) => void;
}) {
  const playback = useMediaPlayback();
  const focusReturn = useReturnFocus(returnFocusItemId);
  return (
    <ul
      className={styles.grid}
      aria-label={localizedMessage("inspection.components.library.media.items")}
    >
      {items.map((item) => (
        <li key={item.id} className={styles.card}>
          <div className={styles.itemCard}>
            <span
              className={styles.art}
              data-full={item.offline || undefined}
              style={waterLevel(Number(item.verifiedBytes), Number(item.lengthBytes))}
            >
              <Icon
                className={styles.kind}
                name={item.kind === "audio" ? "music" : "film"}
                aria-hidden="true"
              />
              <PlayButton item={item} playback={playback} />
            </span>
            <button
              type="button"
              className={styles.cardBody}
              aria-label={localizedMessage("inspection.components.library.media.item.open", {
                title: item.title,
              })}
              ref={item.id === returnFocusItemId ? focusReturn : undefined}
              onClick={() => onOpenTorrent(item.torrentId, item.id)}
            >
              <strong title={item.fileName}>{item.title}</strong>
              <span>{itemContext(item)}</span>
              <span>
                {itemState(item)} · {formatBytes(Number(item.lengthBytes), dataUnits)}
              </span>
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Host sorts behind the list headers; other columns do not sort. */
const SORT_COLUMNS: Readonly<Record<string, LibraryMediaSort>> = {
  title: "title",
  size: "size",
  torrent: "source",
};

function ItemList({
  items,
  dataUnits,
  returnFocusItemId,
  onOpenTorrent,
}: {
  readonly items: readonly LibraryItemRow[];
  readonly dataUnits: DataUnits;
  readonly returnFocusItemId: string | null;
  readonly onOpenTorrent: (torrentId: string, itemId: string) => void;
}) {
  const playback = useMediaPlayback();
  const focusReturn = useReturnFocus(returnFocusItemId);
  const browse = useInspectionStore((state) => state.presentation.libraryBrowse);
  const update = useInspectionStore((state) => state.updateLibraryBrowse);
  const interfaceSize = useInspectionStore((state) => state.presentation.interfaceSize);
  const [currentId, setCurrentId] = useState<string | null>(returnFocusItemId);
  const locale = useProductLocale();
  const columns = useMemo(
    (): readonly VirtualColumn<LibraryItemRow>[] => [
      {
        id: "play",
        label: localizedMessage("inspection.components.library.media.column.play"),
        width: 52,
        minimumWidth: 52,
        sortable: false,
        listRole: "trailing",
        listLabel: null,
        render: (item) => <PlayButton item={item} playback={playback} />,
      },
      {
        id: "title",
        label: localizedMessage("inspection.components.library.media.column.title"),
        width: 320,
        sortValue: (item) => item.title,
        listRole: "title",
        render: (item) => <span title={item.fileName}>{item.title}</span>,
      },
      {
        id: "context",
        label: localizedMessage("inspection.components.library.media.column.context"),
        width: 260,
        sortable: false,
        listRole: "subtitle",
        render: (item) => itemContext(item),
      },
      {
        id: "size",
        label: localizedMessage("inspection.components.library.media.column.size"),
        width: 96,
        align: "right",
        sortValue: (item) => Number(item.lengthBytes),
        listRole: "detail",
        render: (item) => formatBytes(Number(item.lengthBytes), dataUnits),
      },
      {
        id: "status",
        label: localizedMessage("inspection.components.library.media.column.status"),
        width: 160,
        sortable: false,
        listRole: "detail",
        render: (item) => itemState(item),
      },
      {
        id: "torrent",
        label: localizedMessage("inspection.components.library.media.column.torrent"),
        width: 240,
        sortValue: (item) => item.torrentName,
        listRole: "detail",
        render: (item) => (
          <button
            type="button"
            className={styles.link}
            ref={item.id === returnFocusItemId ? focusReturn : undefined}
            aria-label={localizedMessage("inspection.components.library.media.item.open", {
              title: item.title,
            })}
            onClick={() => onOpenTorrent(item.torrentId, item.id)}
          >
            {item.torrentName}
          </button>
        ),
      },
    ],
    [locale, dataUnits, focusReturn, onOpenTorrent, playback, returnFocusItemId],
  );
  const columnId =
    Object.entries(SORT_COLUMNS).find(([, sort]) => sort === browse.sort)?.[0] ?? "title";
  return (
    <div className={styles.tableWrap}>
      <VirtualTable
        tableId="library-media"
        label={localizedMessage("inspection.components.library.media.items")}
        rows={items}
        getRowId={(item) => item.id}
        columns={columns}
        interfaceSize={interfaceSize}
        currentRowId={currentId}
        onActivate={(item) => setCurrentId(item.id)}
        emptyMessage={localizedMessage("inspection.components.library.media.empty.filters")}
        formatCount={(count) =>
          localizedMessage("inspection.components.library.media.count.items", { count })
        }
        externalSort={{
          sort: { columnId, direction: browse.descending ? "desc" : "asc" },
          onChange: (sort) =>
            update({
              sort: sort === null ? "title" : (SORT_COLUMNS[sort.columnId] ?? "title"),
              descending: sort?.direction === "desc",
            }),
        }}
      />
    </div>
  );
}

/** Focuses the returning item's button once, when it first renders. */
function useReturnFocus(itemId: string | null) {
  const focused = useRef<string | null>(null);
  return useCallback(
    (element: HTMLButtonElement | null) => {
      if (element === null || itemId === null || focused.current === itemId) return;
      focused.current = itemId;
      element.focus();
    },
    [itemId],
  );
}

function PlayButton({
  item,
  playback,
}: {
  readonly item: LibraryItemRow;
  readonly playback: ReturnType<typeof useMediaPlayback>;
}) {
  const opening =
    playback.pending?.torrentId === item.torrentId &&
    playback.pending.fileIndex === item.fileIndex;
  const reason = playback.demo
    ? localizedMessage("inspection.components.library.media.play.demo")
    : opening
      ? localizedMessage("inspection.components.library.media.play.opening")
      : playback.pending !== null
        ? localizedMessage("inspection.components.library.media.play.busy")
        : !isPlaybackEligible(item.mediaAvailability)
          ? localizedMessage("inspection.components.library.media.play.unavailable")
          : playback.playback.remote &&
              !playback.playback.canPlay(item.fileName, item.mediaAvailability)
            ? localizedMessage("remote.video.completed.mp4")
            : undefined;
  return (
    <button
      type="button"
      className={styles.play}
      aria-label={localizedMessage("inspection.components.library.media.play", {
        title: item.title,
      })}
      aria-description={reason}
      title={reason}
      disabled={reason !== undefined}
      onClick={() =>
        void playback.play({
          torrentId: item.torrentId,
          fileIndex: item.fileIndex,
          name: item.fileName,
          lengthBytes: item.lengthBytes,
          mediaAvailability: item.mediaAvailability,
        })
      }
    >
      <span aria-hidden="true">{opening ? "…" : "▶"}</span>
    </button>
  );
}

function Pager({
  media,
  onPage,
}: {
  readonly media: LibraryMediaSet;
  readonly onPage: (page: number) => void;
}) {
  const { offset, limit, total } = media.page;
  if (total <= limit && offset === 0) return null;
  const page = Math.floor(offset / limit);
  const last = Math.min(total, offset + limit);
  return (
    <nav
      className={styles.pager}
      aria-label={localizedMessage("inspection.components.library.media.pages")}
    >
      <span>
        {localizedMessage("inspection.components.library.media.range", {
          first: total === 0 ? 0 : offset + 1,
          last,
          total,
        })}
      </span>
      <button type="button" disabled={page === 0} onClick={() => onPage(page - 1)}>
        {localizedMessage("inspection.components.library.media.previous")}
      </button>
      <button
        type="button"
        disabled={media.page.nextOffset === null}
        onClick={() => onPage(page + 1)}
      >
        {localizedMessage("inspection.components.library.media.next")}
      </button>
    </nav>
  );
}

function LibraryMessage({
  message,
  detail,
}: {
  readonly message: string;
  readonly detail?: string | undefined;
}) {
  return (
    <div className={styles.message} role="status">
      <Icon name="library" />
      <strong>{message}</strong>
      {detail === undefined ? null : <p>{detail}</p>}
    </div>
  );
}

export function presetLabel(preset: LibraryPreset): string {
  switch (preset) {
    case "all":
      return localizedMessage("inspection.components.library.media.preset.all");
    case "shows":
      return localizedMessage("inspection.components.library.media.preset.shows");
    case "movies":
      return localizedMessage("inspection.components.library.media.preset.movies");
    case "music":
      return localizedMessage("inspection.components.library.media.preset.music");
    case "torrents":
      return localizedMessage("inspection.components.library.media.preset.torrents");
  }
}

function groupingLabel(preset: LibraryPreset, grouped: boolean): string {
  if (preset === "music") {
    return grouped
      ? localizedMessage("inspection.components.library.media.grouping.albums")
      : localizedMessage("inspection.components.library.media.grouping.tracks");
  }
  return grouped
    ? localizedMessage("inspection.components.library.media.grouping.shows")
    : localizedMessage("inspection.components.library.media.grouping.episodes");
}

function availabilityLabel(availability: LibraryAvailabilityFilter): string {
  switch (availability) {
    case "any":
      return localizedMessage("inspection.components.library.media.availability.any");
    case "offline":
      return localizedMessage("inspection.components.library.media.availability.offline");
    case "incomplete":
      return localizedMessage("inspection.components.library.media.availability.incomplete");
  }
}

function sortLabel(sort: LibraryMediaSort): string {
  switch (sort) {
    case "title":
      return localizedMessage("inspection.components.library.media.sort.title");
    case "size":
      return localizedMessage("inspection.components.library.media.sort.size");
    case "source":
      return localizedMessage("inspection.components.library.media.sort.source");
  }
}

function summary(
  media: LibraryMediaSet | null,
  status: string,
  grouped: boolean,
  preset: LibraryPreset,
): string {
  if (media === null) {
    return status === "loading"
      ? localizedMessage("inspection.components.library.media.loading")
      : "";
  }
  const count = media.page.total;
  if (!grouped) {
    return localizedMessage("inspection.components.library.media.count.items", { count });
  }
  switch (preset) {
    case "shows":
      return localizedMessage("inspection.components.library.media.count.shows", { count });
    case "music":
      return localizedMessage("inspection.components.library.media.count.albums", { count });
    default:
      return localizedMessage("inspection.components.library.media.count.torrents", { count });
  }
}

function groupFacts(group: LibraryGroupRow, preset: LibraryPreset): string {
  if (preset === "shows") {
    return localizedMessage("inspection.components.library.media.group.show", {
      episodes: group.itemCount,
      seasons: group.seasonCount,
    });
  }
  if (preset === "music") {
    return group.year === null
      ? localizedMessage("inspection.components.library.media.group.tracks", {
          count: group.itemCount,
        })
      : localizedMessage("inspection.components.library.media.group.album", {
          count: group.itemCount,
          year: String(group.year),
        });
  }
  return localizedMessage("inspection.components.library.media.group.files", {
    count: group.itemCount,
  });
}

/** Where an item belongs: its episode code and show, album and track, or year. */
export function itemContext(item: LibraryItemRow): string {
  if (item.role === "episode" && item.seasonNumber !== null && item.episodeNumber !== null) {
    const code = `S${pad(item.seasonNumber)} · E${pad(item.episodeNumber)}${
      item.endingEpisodeNumber === null ? "" : `–${pad(item.endingEpisodeNumber)}`
    }`;
    return item.seriesTitle === null ? code : `${code} · ${item.seriesTitle}`;
  }
  if (item.role === "track") {
    const track =
      item.trackNumber === null
        ? null
        : localizedMessage("inspection.components.library.media.item.track", {
            number: item.trackNumber,
          });
    return [item.albumTitle, track].filter((part) => part !== null).join(" · ") ||
      item.torrentName;
  }
  return item.year === null ? item.torrentName : `${item.year} · ${item.torrentName}`;
}

function itemState(item: LibraryItemRow): string {
  if (item.offline) {
    return item.archived
      ? localizedMessage("inspection.components.library.media.item.offline.archived")
      : localizedMessage("inspection.components.library.media.item.offline");
  }
  const length = BigInt(item.lengthBytes);
  const percent = length === 0n ? 0 : Number((BigInt(item.verifiedBytes) * 100n) / length);
  return item.archived
    ? localizedMessage("inspection.components.library.media.item.partial.archived", {
        percent,
      })
    : localizedMessage("inspection.components.library.media.item.partial", { percent });
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function groupIcon(groupId: string): IconName {
  if (groupId.startsWith("album:")) return "music";
  if (groupId.startsWith("series:")) return "film";
  return "library";
}

/** The art is the item's box: water rises with verified progress. */
function waterLevel(done: number, total: number): CSSProperties {
  const level = total <= 0 ? 0 : Math.min(1, Math.max(0, done / total));
  return { "--water-level": `${Math.round(level * 100)}%` } as CSSProperties;
}
