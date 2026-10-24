import type { LibraryFacetsView } from "../../api";
import type {
  FileRow,
  InspectionSnapshot,
  LibraryGroupRow,
  LibraryItemRow,
  LibraryMediaRequest,
  LibraryMediaSet,
} from "../model";

const VIDEO = ["mp4", "mkv", "avi", "webm", "mov", "m4v"];
const AUDIO = ["mp3", "flac", "m4a", "aac", "ogg", "opus", "wav"];

/**
 * A small in-browser stand-in for the host's Library index, so demo
 * scenarios show the cross-torrent Library. The host classifier and query
 * evaluation in `library_views.rs` remain the contract.
 */
export function demoLibraryMedia(
  source: InspectionSnapshot,
  request: LibraryMediaRequest,
): LibraryMediaSet {
  const query = request.query;
  const words = normalized(query.text).split(" ").filter(Boolean);
  const kinds = query.kinds.length === 0 ? ["video", "audio"] : query.kinds;
  const all = source.torrentOrder.flatMap((torrentId) => {
    const torrent = source.torrents[torrentId];
    const files = source.filesByTorrent[torrentId];
    if (torrent === undefined || files === undefined) return [];
    const inScope =
      query.torrent_id != null
        ? torrentId === query.torrent_id
        : query.archived === "include" ||
          (query.archived === "only") === (torrent.archived === true);
    if (!inScope) return [];
    return items(torrentId, torrent.name, torrent.archived === true, files.order
      .map((id) => files.rows[id])
      .filter((row): row is FileRow => row !== undefined), source);
  });
  const scoped = all.filter(
    (item) =>
      (item.offline || item.wanted) &&
      words.every((word) => item.search.includes(word)),
  );
  const facets: LibraryFacetsView = {
    items: scoped.length,
    video: count(scoped, (item) => item.row.kind === "video"),
    audio: count(scoped, (item) => item.row.kind === "audio"),
    episodes: count(scoped, (item) => item.row.role === "episode"),
    movies: count(scoped, (item) => item.row.role === "movie"),
    other_videos: count(scoped, (item) => item.row.role === "other"),
    tracks: count(scoped, (item) => item.row.role === "track"),
    offline: count(scoped, (item) => item.offline),
    incomplete: count(scoped, (item) => !item.offline),
    series: new Set(scoped.flatMap((item) => item.row.seriesId ?? [])).size,
    albums: new Set(scoped.flatMap((item) => item.row.albumId ?? [])).size,
    torrents: new Set(scoped.map((item) => item.row.torrentId)).size,
    metadata_pending: 0,
  };
  const matched = scoped
    .filter(
      (item) =>
        kinds.includes(item.row.kind) &&
        (query.roles.length === 0 || query.roles.includes(item.row.role)) &&
        (query.availability === "any" ||
          (query.availability === "offline") === item.offline) &&
        (query.group_id == null ||
          item.row.seriesId === query.group_id ||
          item.row.albumId === query.group_id),
    )
    .sort((left, right) => compare(left, right, query.sort));
  if (query.descending) matched.reverse();
  const groups = query.grouping === "none" ? null : group(matched, query.grouping);
  const total = groups === null ? matched.length : groups.length;
  const end = Math.min(total, request.offset + request.limit);
  return {
    request,
    page: {
      offset: request.offset,
      limit: request.limit,
      total,
      nextOffset: end < total ? end : null,
    },
    facets,
    items:
      groups === null
        ? matched.slice(request.offset, end).map((item) => item.row)
        : [],
    groups: groups === null ? [] : groups.slice(request.offset, end),
  };
}

interface DemoItem {
  readonly row: LibraryItemRow;
  readonly wanted: boolean;
  readonly offline: boolean;
  readonly search: string;
  readonly sortKey: string;
}

function items(
  torrentId: string,
  torrentName: string,
  archived: boolean,
  files: readonly FileRow[],
  source: InspectionSnapshot,
): DemoItem[] {
  const media = source.mediaByTorrent[torrentId];
  const mediaFiles = files.filter(
    (file) =>
      !file.padding &&
      [...VIDEO, ...AUDIO].includes(file.extension) &&
      !/(^|[-._ ])sample$/i.test(file.name.replace(/\.[^.]+$/, "")),
  );
  const episodes = mediaFiles.some(
    (file) => media?.rows[file.id]?.role.type === "episode",
  );
  const looseVideos = mediaFiles.filter(
    (file) =>
      VIDEO.includes(file.extension) &&
      media?.rows[file.id]?.role.type !== "episode",
  ).length;
  return mediaFiles.map((file) => {
    const role = media?.rows[file.id]?.role;
    const audio = AUDIO.includes(file.extension);
    const album = audio && file.path.length > 1 ? file.path[file.path.length - 2]! : null;
    const year = /(?:19|20)\d{2}/.exec(file.name)?.[0];
    const offline = file.verifiedBytes === file.lengthBytes;
    const row: LibraryItemRow = {
      id: `${torrentId}:${file.index}`,
      torrentId,
      torrentName,
      fileIndex: file.index,
      fileName: file.name,
      // Like the host: the release name up to its first tag.
      title: file.name
        .replace(/\.[^.]+$/, "")
        .replace(/[._ -](?:2160p|1080p|720p|480p|WEB-DL|WEB|x264|x265)\b.*$/i, "")
        .replace(/[._]+/g, " "),
      kind: audio ? "audio" : "video",
      role: audio
        ? "track"
        : role?.type === "episode"
          ? "episode"
          : (looseVideos === 1 && !episodes) || year !== undefined
            ? "movie"
            : "other",
      seriesTitle: role?.type === "episode" ? role.seriesTitleHint : null,
      seriesId:
        role?.type === "episode" ? `series:${normalized(role.seriesTitleHint)}` : null,
      seasonNumber: role?.type === "episode" ? role.seasonNumber : null,
      episodeNumber: role?.type === "episode" ? role.episodeNumber : null,
      endingEpisodeNumber: role?.type === "episode" ? role.endingEpisodeNumber : null,
      albumTitle: album,
      albumId: album === null ? null : `album:${normalized(album)}`,
      discNumber: null,
      trackNumber: audio ? Number(/^\d{1,3}/.exec(file.name)?.[0] ?? NaN) || null : null,
      year: year === undefined ? null : Number(year),
      extension: file.extension,
      lengthBytes: file.lengthBytes,
      verifiedBytes: file.verifiedBytes,
      offline,
      archived,
      mediaAvailability: file.mediaAvailability,
    };
    const primary = row.seriesTitle ?? row.albumTitle ?? row.title;
    return {
      row,
      wanted: file.selection !== "skipped",
      offline,
      search: normalized([torrentName, ...file.path].join(" ")),
      sortKey: [
        normalized(primary),
        String(row.seasonNumber ?? 0).padStart(5, "0"),
        String(row.episodeNumber ?? row.trackNumber ?? 0).padStart(5, "0"),
        normalized(row.title),
      ].join("\u0001"),
    };
  });
}

function group(
  matched: readonly DemoItem[],
  grouping: "series" | "album" | "torrent",
): LibraryGroupRow[] {
  const groups = new Map<string, LibraryGroupRow & { seasons: Set<number>; torrents: Set<string> }>();
  for (const { row, offline } of matched) {
    const id =
      grouping === "series"
        ? row.seriesId
        : grouping === "album"
          ? row.albumId
          : `torrent:${row.torrentId}`;
    if (id === null) continue;
    const title =
      grouping === "series"
        ? row.seriesTitle!
        : grouping === "album"
          ? row.albumTitle!
          : row.torrentName;
    const current = groups.get(id) ?? {
      id,
      title,
      itemCount: 0,
      offlineCount: 0,
      totalBytes: "0",
      seasonCount: 0,
      torrentCount: 0,
      year: row.year,
      seasons: new Set<number>(),
      torrents: new Set<string>(),
    };
    if (row.seasonNumber !== null) current.seasons.add(row.seasonNumber);
    current.torrents.add(row.torrentId);
    groups.set(id, {
      ...current,
      itemCount: current.itemCount + 1,
      offlineCount: current.offlineCount + (offline ? 1 : 0),
      totalBytes: (BigInt(current.totalBytes) + BigInt(row.lengthBytes)).toString(),
      seasonCount: grouping === "series" ? current.seasons.size : 0,
      torrentCount: current.torrents.size,
    });
  }
  return [...groups.values()].map(
    ({ seasons: _seasons, torrents: _torrents, ...row }) => row,
  );
}

function compare(left: DemoItem, right: DemoItem, sort: "title" | "size" | "source"): number {
  switch (sort) {
    case "title":
      return left.sortKey.localeCompare(right.sortKey);
    case "size": {
      const difference = BigInt(left.row.lengthBytes) - BigInt(right.row.lengthBytes);
      return difference === 0n
        ? left.sortKey.localeCompare(right.sortKey)
        : difference < 0n
          ? -1
          : 1;
    }
    case "source":
      return (
        left.row.torrentName.localeCompare(right.row.torrentName) ||
        left.row.fileIndex - right.row.fileIndex
      );
  }
}

function normalized(value: string): string {
  return value
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .join(" ");
}

function count<T>(values: readonly T[], predicate: (value: T) => boolean): number {
  return values.reduce((total, value) => total + (predicate(value) ? 1 : 0), 0);
}
