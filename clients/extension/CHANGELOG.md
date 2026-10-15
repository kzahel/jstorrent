# JSTorrent extension changelog

Production releases of the existing JSTorrent Chrome Web Store item
(`dbokmlpefliilbjldladbimlcfgbolhk`). Release with
`scripts/release-extension.sh <version>`; see
[`docs/topics/mixed-version-compatibility.md`](../../docs/topics/mixed-version-compatibility.md).

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
