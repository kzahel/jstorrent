# Android Changelog

## [1.0.33]

- Smaller, faster app: release builds are now optimized and shrunk.
- Security updates to cryptography and networking components.

## [1.0.32]

- Chromebook browser control requires JSTorrent extension 1.1.5 or newer.
- Restore Chromebook companion authentication and download-folder selection.

- Browse videos and music across torrents in the new Library, with search,
  filters, albums, shows, and file actions.
- Export and import torrent lists, share richer links, and set seeding limits.
- Improve transfer cards, background status, navigation after external adds,
  and recovery when the torrent catalog cannot open.
- Add download-safety settings and improve large file selections.

## [1.0.31]

- Fix torrent removal hanging during active downloads with incoming peers.
- Report duplicate adds and offer to restore archived torrents.
- Ask for a download folder when adding without one, then continue the add
  automatically once the folder is chosen.
- Allow removing any download folder while keeping files and torrent progress,
  with an explicit option to remove its torrents and delete their downloads.
- Show when torrents are waiting for an unavailable download folder.

## [1.0.30]

- Improve Android file rows, file priorities and multiple-file selection.
- Show transfer rates in the library and background notification.
- Recover Chromebook setup after cancellation and return to Chrome reliably.
- Fix torrent-detail navigation after removal and feedback checkbox interaction.
- Allow skipping file selection before magnet metadata, and release queued adds
  when file selection is turned off.
- Improve archive, selection, removal and notification feedback.

## [1.0.29]

- Fix a shutdown-related crash when opening torrent details.
- Download all files immediately, or choose files explicitly when adding a
  torrent, without waiting for magnet metadata to download everything.
- Simplify first launch and folder setup, and enable background downloads
  together with their notification permission.
- Consolidate notification settings into one Enable or Manage action.

## [1.0.28]

- Preserve a torrent's paused or running choice when repairing its download
  folder, including after closing and reopening Android.
- Verify retained bytes through normal folder repair with the source offline.
- Candidate preparation; signed artifacts and Play delivery remain pending.

## [1.0.27]

- Close the Android task when Shutdown stops its engine, so a stopped engine
  cannot leave a stale Live library visible.
- Verify normal reopen preserves the library, payload bytes and folder access.
- Original-key local candidate; internal delivery remains on 1.0.26.

## [1.0.26]

- Correct the release-only application label to JSTorrent, including the
  launcher and Android header.
- Validate resolved APK and App Bundle branding before release staging.
- Available to existing internal Play testers; production remains 1.0.23.

## [1.0.25]

- Prepare the in-place JSTorrent package and retained upload certificate lane.
- Best-effort legacy torrent/settings migration and retained SAF roots/grants.
- JSTorrent branding and native Rust engine; store delivery is not yet qualified.

## [0.1.0]

- First independent RSTorrent Canary release packaging for Android and ChromeOS.
- In-process Rust torrent engine with the first-party Android client.
- Separate package and upload signing identity from JSTorrent.
