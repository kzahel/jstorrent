import type {
  LibraryFacetsView,
  LibraryMediaItemView,
  ViewSnapshot,
} from "../api";

export const LIBRARY_TORRENT_ID = "t1-000102030405060708090a0b0c0d0e0f";

export function libraryItemView(
  fileIndex: number,
  overrides: Partial<LibraryMediaItemView> = {},
): LibraryMediaItemView {
  return {
    item_id: `${LIBRARY_TORRENT_ID}:${fileIndex}`,
    torrent_id: LIBRARY_TORRENT_ID,
    torrent_name: "North Shore Stories",
    file_index: fileIndex,
    file_name: `North.Shore.Stories.S01E${String(fileIndex + 1).padStart(2, "0")}.mkv`,
    title: `Episode ${fileIndex + 1}`,
    kind: "video",
    role: "episode",
    series_title: "North Shore Stories",
    series_id: "series:north shore stories",
    season_number: 1,
    episode_number: fileIndex + 1,
    extension: "mkv",
    length_bytes: "1000",
    verified_bytes: "0",
    offline: false,
    archived: false,
    media_availability: "unverified",
    ...overrides,
  };
}

export function libraryFacets(
  overrides: Partial<LibraryFacetsView> = {},
): LibraryFacetsView {
  return {
    items: 0,
    video: 0,
    audio: 0,
    episodes: 0,
    movies: 0,
    other_videos: 0,
    tracks: 0,
    offline: 0,
    incomplete: 0,
    series: 0,
    albums: 0,
    torrents: 0,
    metadata_pending: 0,
    ...overrides,
  };
}

export function librarySnapshot(
  items: readonly LibraryMediaItemView[],
  total = items.length,
  offset = 0,
): Extract<ViewSnapshot, { type: "library_media" }> {
  const limit = 100;
  const end = Math.min(total, offset + limit);
  return {
    type: "library_media",
    page: { offset, limit, total, next_offset: end < total ? end : null },
    facets: libraryFacets({
      items: total,
      video: total,
      episodes: total,
      incomplete: total,
      series: 1,
      torrents: 1,
    }),
    items: [...items],
    groups: [],
  };
}
