# Library media index

Status: complete. Topics: `media-library`, `application-view-api`,
`application-interface-direction`, `web-ui-design`.

## Scope and stopping condition

The maintainer asked on 2026-10-15 for a Library of content rather than
torrents: every video and audio file across the profile's torrents, archived
ones included on request, with search, type filters, sorting, cards and a
list, pagination, and focused views such as TV shows grouped across torrents.
[`media-library`](../topics/media-library.md) records the accepted direction.

This slice adds:

- audio classification, titles, samples, track numbers and grouping keys in
  `rstorrent-media-catalog`;
- a host-owned in-memory Library index and the `library_media` projection,
  leased with a query and a page, delivered through view sets and the legacy
  subscription boundary that Android uses;
- a web Library built on it, with All media, TV shows, Movies, Music and By
  torrent presets, search, filters, sort, grid and list, pages, Play for
  playable files, and a fallback to the torrent-backed Library on hosts
  without the projection.

Stop when a live host serves the projection to the web UI and the Android
boundary, deterministic tests cover classification, query evaluation,
snapshot/patch delivery and the UI, and a 100,000-file fixture records the
index memory, build time and query latency.

## Non-goals

- Probing file contents, duration, thumbnails or artwork.
- Watched state, resume, saved views, user overrides of classification.
- A torrent added-at time and Recently added.
- Android Compose presentation; the Android evidence is the generated
  boundary, its build, and a subscription through it.
- Indexing folders outside the profile's torrents.
- Changing `torrent_media` or the per-torrent Library detail.

## Contract

`ViewSpec::LibraryMedia { view_id, query, page, delivery }`, advertised as
`library_media` in the hello's view capabilities and gated by clients on it.
It maps to `ViewSelector::Library { query }` with
`ViewProjection::LibraryMedia` and a required catalog page for the legacy
subscription boundary.

`LibraryMediaQuery` fields all default: `text` (at most 256 bytes and 16
words, all of which must match), `kinds` and `roles` (empty means the v1
sets: video and audio; episode, movie, other, track), `availability`
(`any`, `offline`, `incomplete`), `archived` (`exclude`, `include`, `only`;
a torrent filter implies `include`), `torrent_id`, `group_id` (at most 512
bytes), `grouping` (`none`, `series`, `album`, `torrent`), `sort` (`title`,
`size`, `source`) and `descending`. Pages hold 1 to 128 rows and default to
the first 100.

The snapshot carries the page, facets and either items (no grouping) or
groups. Facets count the scope selected by text, archived scope and torrent,
before kind, role, availability and group filters: items, video, audio,
episodes, movies, tracks, offline, incomplete, distinct series and albums,
torrents with items, and torrents still fetching metadata. The patch carries
only `upsert` of items already on the page.

Items carry a stable `item_id` (`<torrent_id>:<file_index>`), the torrent ID
and name, file index, bounded title and file name, kind, role, series, season
and episode numbers, album, disc and track numbers, year, extension, length,
verified bytes, `offline`, `archived` and the existing per-file
`media_availability`. Strings are cut to 256 bytes on a character boundary.

Groups carry `group_id` (`series:`, `album:` or `torrent:` prefixed), title,
item and offline counts, total bytes, distinct seasons and torrents.

### Compatibility

New variants of `ViewSpec`, `ViewSnapshot` and `ViewPatch` are strict-client
exposures. A client receives them only after requesting `library_media`,
which no released client does, so they are recorded as reviewed exposures
beside the existing ones and do not change the release hold. Companion
connections (ChromeOS companion, desktop control) strip `library_media` with
`torrent_media`; they do not present media. Clients ask only for kinds and
roles they know, so later additions stay invisible to them.

## Design

### Ownership

`HubState` owns a `LibraryIndex` and a result memo. The index is rebuilt for
a torrent when its file catalog pointer, display name or archived flag
changes, inside the hub publish that observed the change; global orders are
re-sorted only when some torrent changed. There is no task, channel or lock
beyond the hub mutex, and no I/O.

The memo holds the last result of each live `(query, page)`. Its invariant:
after every publish, each live entry equals evaluation against the current
state. Publishes that change catalogs, names, archive flags or verified
pieces re-evaluate live queries; a changed page, total, order, facets or
group list is delivered as a snapshot, and otherwise changed rows as an
upsert. Piece verification that does not change any item's `offline` state
takes a fast path that only rebuilds rows already on memoized pages. A query
with no memo entry gets a snapshot. Entries for queries no consumer holds are
dropped on each publish.

### Dependency direction

`rstorrent-media-catalog` (pure parsing) ← `library_views` in
`rstorrent-session` (DTOs, index, evaluation, no locks) ← the view hub
(memo, publication) ← gateway, Android and web. Evaluation reads progress
from `FileProgressModel` through a narrow accessor rather than building file
rows.

### Limits

- Text 256 bytes, 16 words; group ID 512 bytes; at most 2 kinds and 4 roles.
- Page 1 to 128 rows; row strings 256 bytes.
- Memo entries are bounded by live consumers: view sets are limited by the
  existing view-set limits.

## Validation

- Classifier unit tests: audio extensions, album and disc folders, track and
  disc numbers, samples, movie titles and years, group-key normalization.
- Index and evaluation unit tests: filters, words, grouping, sorts, facets,
  archived scope, metadata pending, skipped files, bounded strings, paging.
- Hub tests: snapshot on open, row patch on verification, snapshot on
  completion, archive and removal, memo pruning, legacy subscription.
- 100,000-file fixture: index bytes, build time and query latency.
- Web: contract generation, validation, reducer, live mapping, App tests for
  presets, search, pages, fallback; typecheck, tests, localization check.
- Android: generated bindings, Kotlin compilation and unit tests.
- Live: a gateway with real torrents served to the web UI.

## Evidence

The host serves `library_media` and the web Library browses it. On a host
without the projection (and in the demo with `library=cards`) the Library
keeps its torrent cards.

**Classifier.** `rstorrent-media-catalog` classifies video and audio by
extension, drops samples, takes episode names or the release name up to its
first tag (`North Shore Stories S01E01`), movie titles and years from the
name or a dated release folder, and track and disc numbers with the nearest
meaningful album folder. A lone video beside episodes is an extra, not a
movie. Series keys drop a trailing year; album keys drop bracketed tags,
years and format words. 16 unit tests, including hostile names.

**Index and evaluation** (`library_views.rs`, 10 tests): filters, words
matched against the item or its torrent, grouping across torrents, all three
sorts both ways, facets, archived scope, metadata-pending counts, skipped
files, pages and bounded strings. Progress is read only from the catalog the
entries index, and comparing a torrent on each publish allocates nothing.

**Scale.** 1,000 torrents of 100 files (100,000 Library items; a third each
episodes, FLAC tracks and lecture videos), `cargo test` optimized profile on
an Apple M5, two runs:

| Measure | Result |
| --- | --- |
| Index size | 16,964,134 bytes, 169 per file |
| Build | 114–131 ms |
| First title query, including the sort | 49–50 ms |
| Later title query, 100-row page | 2.6 ms |
| Three-word search | 4.6–4.9 ms |
| Series grouping (334 shows) | 3.5–3.7 ms |

The sorted orders add 8 bytes per item each, built on first use. The
measurement counts owned strings and inline sizes, not allocator overhead.

**Delivery** (`views/tests/library.rs`, 4 tests): an open snapshot; a piece
that leaves a file incomplete patches its row; a piece of a non-media file
sends nothing; completing a file replaces the page; archiving empties the
default scope; renaming patches rows; the memo is dropped with its last
consumer; invalid pages, projections and queries are refused; view sets
replace a page when the query changes.

**Web.** Contract regenerated; validators, reducer, live mapping and query
builder tests; App tests browse presets, open a show and return, search,
switch to the list, open the source torrent and restore focus, and page
through a 250-item host result. `npm run typecheck`, `npm run test` (771
passed, 4 skipped) and `npm run check:localization` pass. The demo
Playwright suite passes 31 of 34, including a new wide and phone Library
test with no serious axe violations. The three phone tests that fail
(`phone destinations…`, `phone navigation opens…`, `Workbench detail has a
return path…`) fail identically on an export of `dfb6071f`, the commit this
change starts from: since `7507ee35`, choosing a destination leaves the
narrow drawer open over the list.

**Android.** `clients/android/build.sh debug` regenerates the Kotlin
bindings, builds both ABIs and passes its 193 unit tests, including a
reducer test that leases `ViewSelector.Library`, applies a page and patches a
row. There is no Compose Library screen.

**iOS.** `clients/ios/scripts/test.sh` regenerates the Swift bindings and
passes on the simulator; the Swift reducers ignore the new view.

**Live.** `tests/interop/browser_media_library_surface.py` (libtorrent
2.0.13 seed, development gateway, production web build, Playwright
Chromium) passes: the new Library shows the pending-metadata count, then six
items; an item opens its torrent's detail and focus returns to it; TV shows
lists one show with 5 episodes in 2 seasons; a search narrows to one item;
the rest of the flow (priority, Play, Files, completion, removal) passes with
no serious axe violations. The opt-in spec had drifted from the product
before this change; it now turns off add-time file selection, waits for the
added row instead of a removed status, and expects Play on a verified file
of a still-downloading torrent to open it in a new tab, which is the
Tactical 362 contract for streamable files.

`cargo fmt --check`, `cargo clippy --workspace --all-targets -D warnings`
and `cargo test --workspace` (1,691 passed) pass. One engine test,
`metadata_default_cohort_is_paced_to_thirty_and_cancels_exactly`, timed out
once while other builds ran and passed three of three runs alone; this
change does not touch the engine.

### Deferred

- Recently added and a date sort need a durable added-at time.
- Probing, duration, thumbnails, watched state, saved views and overrides.
- Compose and SwiftUI Library screens.
- Diacritic folding in search.
