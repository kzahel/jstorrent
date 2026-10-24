# JSTorrent extension changelog

Production releases of the existing JSTorrent Chrome Web Store item
(`dbokmlpefliilbjldladbimlcfgbolhk`). Release with
`scripts/release-extension.sh <version>`; see
[`docs/topics/mixed-version-compatibility.md`](../../docs/topics/mixed-version-compatibility.md).

## [1.1.6]

- Browse videos and music across torrents in the Library, with search,
  filters, and playback for completed local media.
- Improve narrow layouts, navigation, file selection, and connection recovery.
- Add torrent-list import and export, richer share links, and seeding limits
  when the connected app supports them.
- Show clearer download-safety controls and app-version diagnostics.

## [1.1.5]

- The companion accepts fields and row updates a newer JSTorrent app adds,
  so later desktop and Android releases no longer break it.
- Settings and actions an older app cannot perform are hidden or refused
  with an "update JSTorrent there" message instead of breaking the
  connection.
- Works with desktop 0.3.0 and Android 1.0.28 again: their library updates
  no longer fail to load.
- Share links copied through an older app are plain magnet links.

## [1.1.4]

- Production desktop and Android companion updates (Tactical 326).

## [1.1.3]

- Android companion recovery after Shutdown.
