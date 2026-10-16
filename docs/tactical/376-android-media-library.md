# Tactical 376: Android Media Library

Status: complete, 2026-10-17.

Topics: `media-library`, `client-surfaces`, `application-interface-direction`.

## Trigger, scope and stopping condition

The web UI gained a content-centric Library in Tactical
[363](363-library-media-index.md) and [364](364-library-review-fixes.md):
video and audio across every torrent, with presets, search, filters, sort,
grouping and pages over the host-owned `library_media` projection. Android has
the generated boundary and a reducer for that projection, but no screen.
[`media-library`](../topics/media-library.md) lists that as a known gap, and
the maintainer asked on 2026-10-16 to close it.

The Android app has one hub screen, the torrent list, with every other screen
pushed on top and global screens in the overflow menu. It has no drawer and no
primary navigation. The maintainer accepted this direction:

- Android gets the same two primary destinations as the web UI,
  **Library | Torrents**, in a Material 3 navigation bar at compact widths and
  a navigation rail at 600 dp and wider (ChromeOS windows, tablets, landscape
  phones). No hamburger: two destinations do not justify a drawer, and the
  global screens stay in the overflow menu.
- The torrent list is renamed **Torrents** in code and on screen, so
  "Library" means the media Library on every surface.
- The navigation hides while torrent selection mode owns the bottom bar.
- The Add button is offered on both destinations.
- The app remembers the last primary destination as a UI preference and opens
  on Torrents by default.
- Opening a magnet or `.torrent` file, and a notification for a torrent that
  no longer exists, still land on Torrents.

This slice adds the Library screen: All media, TV shows, Movies, Music and
By torrent presets; search; sort, availability and archived scope; grouped
shows, albums and torrents that open in place with Back; pages; Play for
playable video; and opening an item's source torrent.

Stop when the Library and Torrents destinations work on a phone-width and a
tablet-width emulator against fixture state, the presentation lease is covered
by JVM tests, a real in-process host serves Library pages to the screen on an
emulator, and topics record the result. No release is published.

## Non-goals

- Changes to the Rust host, the `library_media` contract or the generated
  boundary. The projection, its limits and its bindings are Tactical 363's.
- A card or grid layout. Android lists rows; the web's Cards/List choice is a
  presentation preference that is deferred.
- Audio playback. The Android player and its policy accept recognized video
  only. Music worth using needs background playback and a media session,
  which is its own slice. Audio rows open their source torrent.
- Persisting the Library preset, sort or filters across launches. They
  survive configuration changes and process recreation through saved state;
  only the primary destination is remembered.
- Artwork, thumbnails, duration, watched state, Continue watching or
  classification overrides; these remain `media-library` work.
- Renaming the torrent list's existing `library_*` string resource keys. The
  keys are internal and renaming them is churn; new Library strings use
  `media_library_*`, and user-visible torrent-list copy that says "library"
  is corrected.
- iOS.

## Design

### Navigation ownership

`ProductApp` owns the navigation controller and draws the primary navigation
outside the screens: a `NavigationBar` below the navigation host at compact
widths, or a `NavigationRail` beside it at 600 dp and wider. It appears only
on the two primary routes, `media_library` and `torrent_list`, and not while
the Torrents screen reports an active selection. The global snackbar host sits
inside the content area, so snackbars stay above the navigation bar.

The content area consumes the window insets that the bar or rail already
pads, so the screens' own scaffolds do not pad them a second time.

Switching destinations uses the standard pattern: pop to the graph's start
destination saving state, launch single-top and restore state, so each
destination keeps its scroll position and filters. The start destination is
the remembered one. Back from the other primary destination returns to the
start destination, then leaves the app.

Opening a show, album or torrent group is Library screen state with a Back
arrow and a `BackHandler`, not a navigation route. Group IDs are host strings
of up to 512 bytes that would need route encoding, and in-screen state keeps
group, preset and page together in one saved value. Opening an item's source
torrent pushes the existing `torrent_detail/{torrentId}` route.

### Presentation lease

`AndroidPresentationRepository` owns at most one Library subscription:
`ViewSelector.Library(query)` with `ViewProjection.LIBRARY_MEDIA`, a
`CatalogPageRequest(offset, 100)` and a 250 ms delivery interval with the
same 512 KiB bound as the per-torrent catalogs. A new request closes the
previous subscription, waits for its collector to stop, clears the page from
`ProductState`, and then subscribes. A null request releases it.

Each delivered page is stamped with the request it answers, inside the same
state update that reduces it. The screen shows a page only when its stamp
equals the screen's current request. Any other state is shown as loading, so
a page for an earlier preset, search or page is never presented as the answer
to the current one.

Requests pass through the same reserve-before-dispatch ordering as pending
file selection (Tactical 372), so a fast sequence of searches cannot be
reordered by the service's asynchronous startup dispatch. Inside the
repository, a request epoch drops superseded work, as for the torrent detail
and global presentations.

The Library screen presents its request while it is composed and releases it
on dispose, like the Speed and DHT screens. Search text is debounced by
300 ms before it becomes part of the request.

### Query presets

A pure function maps the browse state to the request and mirrors the web's
`libraryMediaRequest`:

| Preset | Kinds | Roles | Top-level grouping |
| --- | --- | --- | --- |
| All media | — | — | none |
| TV shows | video | episode | series, unless "Episodes" is chosen |
| Movies | — | movie | none |
| Music | audio | — | album, unless "Tracks" is chosen |
| By torrent | — | — | torrent |

An opened group adds `group_id`. A torrent group adds `torrent_id` instead.
Shows and albums read in title order regardless of the chosen sort. Text is
trimmed. Archived scope is `include` or `exclude`. Pages hold 100 rows, and
Previous and Next appear when the host's total exceeds one page, like the
Android Files tab.

### Rows

- **Group rows** show an icon for the kind of group, the title, the count
  (episodes and seasons, tracks, or files) and the total size. Tapping a group
  opens it.
- **Item rows** show a kind icon, the title and a secondary line:
  - an episode code and series for episodes;
  - the album and track for tracks;
  - the year for movies;
  - the torrent name otherwise.
- **Size and progress.** A complete file shows its size. An incomplete file
  shows the percentage verified and its size. Partial files are never
  described as available.
- **Archived** items are marked.
- **Play** is offered when the existing Android playback policy allows the
  item: a recognized video extension and `available` or `streamable` media
  availability, with no launch pending. Play uses the existing
  `createMediaUrl` and `PlayerActivity` path.
- **Tapping a row** opens its source torrent's detail.

The screen also shows how many torrents are still fetching metadata, an empty
state for an empty Library, and a no-matches state when filters or search
exclude everything.

## Invariants and limits

- No new task, timer, dependency or durable field. The Library lease is one
  more repository-owned subscription, closed on replacement, release and
  repository close.
- One Library page of at most 100 rows is resident; it is cleared when the
  lease changes or is released.
- The remembered destination is a UI preference in the existing `product_ui`
  SharedPreferences file. An unreadable value takes the default.
- Android hosts its engine in process, so `library_media` is always present;
  no capability gating or mixed-version path applies.

## Validation

- JVM: the request builder for every preset, group opening and paging; the
  repository lease (spec, replacement, release, stamping, close); the
  playback policy for Library items; the reducer's existing Library test.
- Instrumentation on fresh emulators through
  `clients/android/scripts/run-localization-matrix.py`, at API 28
  (`pixel_6`, navigation bar) and API 35 (`pixel_tablet`, navigation rail):
  - switching destinations;
  - selection hiding the navigation;
  - the presets;
  - opening a show and returning with Back;
  - opening a source torrent;
  - pages;
  - Play availability;
  - empty and pending-metadata states.
- Live: a debug build on an emulator with fixture torrents added through the
  app. The in-process host serves Library pages that the screen shows.
- `testDebugUnitTest`, `lintDebug`, `assembleDebug`,
  `assembleDebugAndroidTest`, `node scripts/check-localization.mjs`,
  `git diff --check`.

## Evidence

**Implementation.**
- `PrimaryNavigationScaffold` (`ui/PrimaryNavigation.kt`) draws the bar or
  rail around the navigation host and consumes the insets it pads.
- `ProductApp` owns the controller, the remembered start route and the
  Torrents selection signal.
- `MediaLibraryScreen` and the pure `MediaLibraryBrowse` model own the screen
  and its request.
- `AndroidPresentationRepository.presentLibrary` owns the lease; it is ordered
  by the shared `LatestPresentationRequest`, which pending file selection now
  also uses.
- The torrent list is `TorrentsScreen`, `TorrentFilter` and `TorrentSort`.
- Library Play uses the host's extension rather than the possibly cut file
  name, and the existing playback availability rule.
- Search text is cut to the host's 256-byte, 16-word bound before it is sent.
- No Rust, contract or persistence schema change.

**JVM.** `testDebugUnitTest` runs 218 cases, all passing.

| Area | New cases |
| --- | --- |
| Request builder: presets, the item toggle, opened shows reading in title order, torrent groups keeping the sort, pages, trimmed text and request equality | 3 |
| Search bounds, including repeated words, separators, UTF-8 and surrogate pairs | 1 |
| Item progress | 1 |
| Library Play policy | 1 |
| Repository: the lease spec, stamping, clearing on replacement and release, close, and latest-request ordering across delayed dispatch | 3 |
| Repository: Library added to every-route-terminal-after-close | — |

`lintDebug`, `assembleDebug`, `assembleDebugAndroidTest`,
`node scripts/check-localization.mjs` and `git diff --check` pass.
`clients/android/build.sh debug` rebuilds both native ABIs and bindings from
the current Rust source and passes.

**Instrumentation.** `run-localization-matrix.py --api 28 --api 35 --class
org.rstorrent.bootstrap.ProductNavigationTest` passes all 43 cases on a fresh
API 28 `pixel_6` (1080x2400, navigation bar) and on a fresh API 35
`pixel_tablet` (2560x1600, navigation rail). Four of the cases are new:

1. Switching destinations reports Torrents, Library, Torrents, and selection
   hides the navigation until it is cleared.
2. Presets show loading until a page stamped for their request arrives. A
   show opens in place, and Back closes it. An item opens its source torrent,
   and Back returns to the open show.
3. Play is enabled for a streamable video, disabled for an incomplete one,
   and absent for audio. Next leases page two. Search is debounced into the
   request, and the no-matches, empty and pending-metadata states appear.
4. An external magnet started from the Library lands on Torrents.

The runner removes its AVDs.

The first matrix run failed two cases. Android trims unquoted leading and
trailing spaces in string resources, so the `" · "` separator rendered as
`·`. Quoting the resource fixed it.

**Live.** `tests/interop/android_media_library_surface.py` runs on read-only
headless `jstorrent-dev` (phone) and `jstorrent-tablet` AVDs against a
libtorrent 2.0.13 seed of the Tactical 363 North Shore Stories fixture. On
both, the scenario:

1. declines statistics on the fresh profile;
2. grants a download folder and adds the torrent by magnet;
3. waits for the download to complete;
4. opens the Library through the bar (phone) or rail (tablet);
5. sees the episodes with Play, then TV shows with one show of 5 episodes in
   2 seasons;
6. opens the show, closes it with Back, and plays a completed episode in
   `PlayerActivity` through a created media capability.

Two findings from these runs:

- **Repeated show name.** The phone screenshots showed episode rows repeating
  the show name in both title and detail line. The detail line now omits the
  series when the release-derived title already carries it.
- **Stale preference read in the shared helper.** The `select_controlled_tree`
  helper in `android_reactive_surface.py` checks the SAF preference
  immediately after the picker. Its registry is now encoded and written
  asynchronously, so the new scenario treats the product's own ready folder
  state as the evidence instead. The older reactive scenario's check was not
  changed here.

Each run clears the app, removes the grant folder and its captures, and kills
its emulator.

### Deferred

- Audio playback with background playback and a media session.
- Cards, persisted Library preset and filters, and Library item counts in the
  preset tabs.
- Opening the source torrent directly on its Files tab.
- iOS.
