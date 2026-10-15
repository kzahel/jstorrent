# Library review fixes

Status: complete. Topics: `media-library`, `web-ui-design`,
`http-file-serving-and-streaming`.

## Scope and stopping condition

The maintainer reviewed the Tactical
[363](363-library-media-index.md) Library on 2026-10-15:

- cards showed initials (`BB`, `CL`) as art;
- Music counted 0 in the sidebar while listing 16 tracks;
- music should play inline as video does;
- the toggles did not match the app's segmented controls, and "Offline" read
  oddly;
- the list was a plain table without the torrent list's header sorting;
- there was no way to add a torrent from the Library.

Stop when each is fixed, deterministic tests cover them, and a live gateway
plays an album track inline after adding it from the Library.

## Non-goals

- Artwork, a persistent mini player, queues or gapless album playback.
- Remote (relayed) audio playback; remote Play stays MP4/M4V.
- An add control in the narrow header; narrow layouts keep the field in the
  Torrents bar.

## Changes

**Torrent folder as root.** A multi-file torrent's paths start below its own
folder, so songs at its top level had no album and bare episodes no show.
The file catalog now records that folder (any layout other than a single
file named like the torrent), and `classify_library` takes it as the
outermost folder. Series keys also drop a trailing `Season N`, `SNN` or
`Complete`. Search reads the whole relative path; the torrent name is
searched per torrent.

**Sidebar counts** are now files per preset (episodes, movies, tracks), and
torrents for By torrent; the heading still counts what the view lists.

**Art** shows a film or music icon, or a library icon for a torrent group,
under the water level, instead of initials.

**Inline audio.** `canPlayLocalFile` accepts MP3, M4A/M4B, AAC, FLAC, Ogg,
Opus and WAV, and the shared player dialog plays them with a native
`<audio>` element on the file's media URL (`LocalVideoPlayback.mediaUrl`).
The media route now names M4B, AAC and Opus with audio types.

**Controls.** A shared `SegmentedControl` (native radios drawn as segments)
replaces the Library's buttons and is what `SegmentedSetting` draws in
Settings. Availability reads All, Complete and Incomplete; items read
Complete or `N% downloaded`; groups `N of M complete`.

**List.** The list is a `VirtualTable` with Play, Title, Show or album, Size,
Status and Torrent columns, column settings and the narrow list rendering.
`VirtualTable` gains `externalSort`: Title, Size and Torrent headers set the
host sort (title, size, source) for every page instead of sorting one page.

**Adding.** `TorrentAddProvider` now owns adding for the whole app: the
field's state, the Add and file-selection dialogs and desktop external
intake, which previously ran only while Torrents was open. `AddTorrentForm`
sits in the header beside the brand on wide and compact layouts and in the
Torrents bar on narrow ones; `TorrentActions` keeps only torrent actions.

## Evidence

- Rust: `rstorrent-media-catalog` 17 tests (new: torrent folder names
  albums, shows and movies; series key season words), `rstorrent-session`
  library tests 16 (new: a multi-file torrent's folder names its album, a
  single-file torrent has none), media MIME test; `cargo fmt --check` and
  `cargo clippy --workspace --all-targets -D warnings` pass.
- Web: `npm run typecheck`, `npm run test` (776 passed, 4 skipped) and
  `npm run check:localization` pass. New tests: `VirtualTable` external
  sort keeps the caller's order and reports header sorts; local audio plays
  in the dialog from the media URL without the video engine; adding from the
  header works on the Library and the field is mounted once.
- Demo Playwright suite: 34 of 34 pass, including the three phone tests
  363 recorded as failing.
- Live, against a development gateway with a production web build and a
  libtorrent 2.0.13 seed: `browser_media_library_surface.py` passes. A
  temporary run seeded `Test Album (2024)` with two WAV tracks at the
  torrent's top level, added it from the Library header, and saw Music count
  2 tracks and one `Test Album` card reading `2 tracks · 2024` and
  `2 of 2 complete`. Play opened the dialog; the `<audio>` element reached
  `readyState` 2 or more, reported a 3.00 s duration and advanced past
  0.3 s. The temporary spec and fixture were deleted afterwards.
