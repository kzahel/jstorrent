# Tactical 349: General Tab Compact Header And Links

Status: Complete locally, 2026-10-14. Maintainer-directed web presentation
slice. No release is authorized by this tactical.
Topics: `web-ui-design`, `localization`.

## Problem

Maintainer feedback, 2026-10-14, on a seeding torrent's General tab: the
header is an oversized card and the tab repeats itself. One complete,
seeding torrent showed its state five times: the card's `complete` line,
100% with a full bar, Status `Seeding`, the Seeding row
`Seeding (idle) · Goal reached`, and the sentence
`Goals reached: seeding time vs. download time.` The card's
`Current transfer` label is filler, Finished time and Seeding time printed
the same value, Known peers was usually `—`, and the info hash was plain
text. There was no way to copy a magnet link from the tab and no share link
at all; the old JSTorrent app offered both.

## Scope

- Replace the summary card with a compact header: the name on one line,
  one status line, the percentage and a thin progress bar, and icon buttons
  that copy the magnet link and the share link.
- One status line. While seeding, it uses the seeding state (`Seeding
  (idle)`) instead of the operational state. It adds the progress reason
  only while the torrent is still working toward completion, where the
  reason is information (`discovering peers`, `waiting for storage`); for
  seeding, paused and stopping it repeated the status.
- The metric grid drops the duplicates: Status and the Seeding row move into
  the status line, the goals sentence becomes one `Seeding goals` metric,
  download and upload speed become one `Speed` metric, connected and known
  peers become one `Peers` metric, and Finished time appears only when it
  differs from Seeding time. The grid flows label/value pairs without cell
  borders so a variable count never leaves a broken last row.
- Info hash rows (one, or v1 and v2 for hybrids) get a copy button.
- Share link format (below), built in the client from the existing
  `export_magnet` command. No engine or contract change.

## Non-Goals

- The website `/share/` page. It still reads only the legacy keys, so a new
  share link opens a page that cannot use it until that page is rebuilt.
  That rebuild is a required follow-up before a release ships this button.
- A private-torrent hint. Torrent rows do not project the private flag.
- Android. Android already copies magnet links; a share action there is a
  separate per-feature decision.
- Toast feedback. Tactical 346 is in progress and owns the toast host; this
  slice confirms copies on the button itself and moves to the toast when
  346 lands.

## Share Link Format

The old JSTorrent app (`archive/legacy-app/js/torrent.js`, `getShareLink`
in the `jstorrent-typescript` sibling) produced:

```
https://jstorrent.com/share/#hash=<btih hex>&dn=<name>&magnet_uri=<encoded magnet>
```

`hash` and `dn` repeat the magnet, and the magnet is percent-encoded a
second time. New links put the magnet's own query string in the fragment:

```
https://jstorrent.com/share/#xt=urn:btih:<hex>&dn=<name>&tr=<tracker>
```

The page reconstructs the magnet as `magnet:?` plus the fragment. Nothing is
encoded twice, v2 `btmh` and trackers pass through unchanged, and the
fragment is never sent to the server. The export is the engine's
source-aware magnet (Tactical 107), so tracker trimming and verbatim
preservation are inherited. Characters a fragment may not carry are
percent-encoded; existing escapes are kept.

The rebuilt page must accept both shapes: the new fragment when it starts
with `xt=`, and the legacy `hash`/`dn`/`magnet_uri` keys (plus the
protocol-handler `#magnet_uri=` and the TypeScript rewrite's `#magnet=`)
otherwise, so links already in circulation keep working.

## Invariants

- Copy writes only what the engine exported; the client never synthesizes a
  magnet from the info hash.
- The clipboard write starts inside the click so WebKit keeps the user
  activation while the export command is in flight, as the toolbar copy does.
- All new copy is in the message catalog under the Tactical 333 plain-copy
  check.

## Validation

- `share-link.test.ts`: fragment construction, v2 and tracker pass-through,
  escaping, rejection of a non-magnet export.
- `App.test.tsx`: General status line, merged metrics, magnet and share copy
  through the demo export.
- `npm run typecheck`, `npm run test`, `check:localization`.

## Evidence

- `npm run typecheck` and `npm run test`: 80 files, 561 cases pass,
  including the new share-link cases and the General status, metric and
  copy cases in `App.test.tsx`.
- `npm run check:localization` passes. The web catalog goes from 1,352 to
  1,358 messages: 10 removed, 16 added, two goal messages reworded.
- `tests/inspection-demo.spec.ts`, 31 cases including axe, pass against a
  local dev server. The live-gateway and bandwidth-baseline specs were not
  run; their General assertions changed only from `Current transfer` to the
  Copy magnet link button.
- Demo renderer screenshots at 1100 px of a downloading and a seeding
  torrent: one header line, one status line, a ten-cell metric flow and the
  info hash row; the share copy put
  `https://jstorrent.com/share/#xt=urn:btih:a962f460…&dn=Big%20Buck%20Bunny%201080p%20surround`
  on the clipboard.

## Follow-Ups

Tactical [350](350-share-links-and-private-hint.md) completes all four
non-goals: the website share page, toast feedback through one shared copy
action, Android share links and the private-torrent hint.
