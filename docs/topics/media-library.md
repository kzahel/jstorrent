# Media Library

Topic: `media-library`

Status: accepted direction, 2026-10-15. Completed Tactical
[363](../tactical/363-library-media-index.md) implements the first slice: a
host-owned cross-torrent media index for video and audio, the
`library_media` projection with search, filters, sorting, grouping and pages,
and a web Library built on it. 100,000 files index in about 17 MB and
120 ms, and a page query takes 2–5 ms once its sort exists. Probing,
artwork, watched state, an added-at time and folder indexing remain open.
Tactical [376](../tactical/376-android-media-library.md) adds the Android
Library on the same projection.

## Scope

The Library is the content-centric destination described by
[`application-interface-direction`](application-interface-direction.md). This
topic owns what the Library lists and how it is computed: the media item
model, cross-torrent grouping, the query contract, where derived and
user-authored data live, and the slices that remain. The web presentation
belongs to [`web-ui-design`](web-ui-design.md) and the Android presentation
to [`client-surfaces`](client-surfaces.md); the leased-view mechanics belong
to [`application-view-api`](application-view-api.md).

## Decisions

### The unit is a media file, not a torrent

A Library item is one video or audio file of a torrent in the profile,
identified by its torrent and file index. The torrent is one attribute of the
item. Torrent-specific browsing remains as a filter (`torrent: <name>`) and as
a by-torrent grouping, and the per-torrent Library detail of Tactical `072`
remains for opening a source.

### The host owns one in-memory index

The view hub keeps every torrent's file list resident (the
[consumer scale envelope](product-direction.md#consumer-scale-envelope-accepted-2026-10-15)),
so the index is derived in memory from that state and rebuilt only for
torrents whose catalog, name or archived flag changed. Clients never receive
the whole set. They lease `library_media` with a query and a page and receive
the page, its total, and facet counts. A future host may answer the same
query from a persisted index; no client may assume residency.

Computing the index on the host, not by merging per-torrent projections in a
client, keeps remote and relayed clients from receiving every row, and gives
Android the same semantics through the generated boundary.

### Three homes for three kinds of data

| Data | Examples | Home |
| --- | --- | --- |
| Derived from metainfo | kind, title, series, season and episode, album and track, group keys | In-memory index, rebuilt on start |
| Derived from file contents | video/audio track presence, duration, embedded art, thumbnails | Later: a disposable `library-cache.db`, versioned, never migrated, safe to delete |
| Authored by the user | watched state, resume position, group overrides, saved views | Later: `product.db` under the durable-data migration rules |

Only the first exists. The cache must probe verified data only and key entries
by info hash, file index and length.

### Kind comes from the extension, for now

Video and audio are classified by file extension. Ambiguous containers
(`.mp4`, `.mkv`, `.webm`, `.ogg`) are classified by their usual content: `.ogg`
and `.oga` are audio, `.mka` is audio, `.ogv` and the video containers are
video. Track inspection to correct audio-only MP4/Matroska/WebM files belongs
to the probe cache.

### Conservative grouping, merged across torrents

- **Series.** Episodes group by a normalized series title (case-folded,
  separators collapsed, a trailing year, `Season N`, `SNN` or `Complete`
  removed), so a season pack and a lone episode from another torrent form one
  show.
- **The torrent's folder counts.** A multi-file torrent's paths start below
  its own folder, which still names the show, album or movie, so
  classification treats it as the outermost folder (Tactical
  [364](../tactical/364-library-review-fixes.md)). A single-file torrent has
  no folder.
- **Albums.** Audio groups by its nearest meaningful folder, skipping disc
  folders such as `CD1` or `Disc 2`, with bracketed tags and format tokens
  removed from the key. Audio with no folder has no album.
- **Movies.** A video that is not an episode or a sample is a movie when its
  name carries a year, or it is the only such video in a torrent without
  episodes; other videos, such as a season's extras, are plain videos.
- **Samples** (a `Sample` folder, or a name ending in `sample`), empty files,
  and skipped files that are not completely downloaded are not Library
  items.

Duplicates, such as one episode in two torrents, remain separate rows inside
one group. Wrong merges are possible; user overrides need `product.db` and are
deferred, so group keys stay deterministic.

### One query model; views are presets

Every Library view is a preset of one query: words to match, kinds, roles,
availability, archived scope, source torrent, group, grouping, sort and
direction. All media, TV shows, Movies, Music and By torrent differ only in
their preset, and opening a show or album is the same query with a group
filter. Cards and list are a client presentation choice over the same page.

The host returns only the kinds and roles a client asks for, and an empty list
means the original video and audio sets, so a later kind such as images does
not reach clients that do not know it.

## Invariants

- Items exist only for verified metadata; a torrent still fetching metadata
  is counted, not listed.
- `offline` means every byte of the file is verified. Partial files are never
  presented as available.
- A page holds at most 128 items or groups, and every string in a row is
  bounded, so a hostile name cannot make a page exceed the delivery queue.
- Progress-only changes patch rows already in a delivered page; they never
  re-evaluate a query. Membership, order, totals and facets change only
  through a replacement snapshot.

## Known Gaps

- No added-at time exists for torrents, so Recently added is not offered by
  the live host. Adding one is a schema step with its own tactical.
- Search folds case and separators, not diacritics.
- No probing, artwork, thumbnails, duration, watched state or saved views.
- No user correction of a wrong series, album or movie classification.
- Android lists rows only, plays video only (audio needs a player with
  background playback), and keeps the preset and filters for the session
  rather than across launches (Tactical
  [376](../tactical/376-android-media-library.md)).
- iOS has no Library presentation.
- Indexing a download folder outside the profile's torrents is not planned.

## Recommended Next Work

1. Exercise the new Library with real libraries and adjust the classifier
   from what goes wrong.
2. A durable added-at time, enabling Recently added and a date sort.
3. The probe cache: track-based kind and duration.
4. Artwork: images inside torrents first, then embedded art, then frames.
5. Watched and resume state with Continue watching.
