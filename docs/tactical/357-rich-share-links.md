# Tactical 357: Rich Share Links

Status: Complete locally, 2026-10-14. Maintainer-directed follow-up to Tactical
[350](350-share-links-and-private-hint.md). No release or website deployment
is authorized by this tactical.
Topics: `application-view-api`, `web-ui-design`,
`android-jstorrent-replacement`, `incoming-reachability-and-seeding`,
`localization`, `client-persistence`.

## Problem

A share link today carries only what the magnet export carried: the info
hash, the name and some trackers. The recipient's page and client cannot
show a size before metadata, a link cannot point at one file, the sharer
cannot help the recipient reach them directly, and sharing means copying
text: there is no system share sheet, Web Share or QR code.

## Maintainer Decisions, 2026-10-14

- Implement single-file and selected-file shares, total size, a peer hint,
  the Android share sheet, Web Share, QR codes and the share page's
  "didn't open?" fallback. Short links are out: they need server storage.
- Display-only keys use a reserved `jst.` prefix (`jst.file`, `jst.size`).
  The page shows them and strips them before rebuilding the magnet.
- The peer hint is opt-in. The first share-link copy asks, with a
  "Remember my choice" checkbox; the remembered choice can be changed in
  Settings.

## Link Shape

```
https://jstorrent.com/share/#xt=urn:btih:<hex>&dn=<torrent name>&xl=<total bytes>
  &tr=<tracker>&so=<file indices>&x.pe=<ip:port>&jst.file=<file name>&jst.size=<file bytes>
```

| Key | Standard | Producer | Meaning |
|---|---|---|---|
| `xt`, `dn`, `tr` | BEP 9 | engine export | as today |
| `xl` | BEP 9 | engine export | verified total size in bytes |
| `so` | BEP 53 | engine export | selected file indices, verified against the file list |
| `x.pe` | BEP 9 | engine export | sharer's endpoint, opt-in, never for private torrents |
| `jst.file`, `jst.size` | none | client | display name and size of a single shared file |

The fragment is the magnet query string plus `jst.*` keys. The page rebuilds
the magnet as `magnet:?` plus every non-`jst.` parameter. Sharer-supplied
`jst.*`, `xl` and `dn` values are claims until metadata arrives: the page
says "shared as", and a client never presents them as verified.

## Engine Contract

`export_magnet` gains optional `options`:

- `include_size`: add `xl` from verified metadata.
- `file_indices`: add `so` for those files; reject indices outside the
  verified file list; bound the count.
- `peer_hint`: add `x.pe` for the sharer's endpoints. Internet addresses
  only when the engine has confirmed incoming reachability for that address
  family; local-network addresses for the listening port. At most two
  addresses. Never for a private torrent.

Without options the export is unchanged, so Tactical 107's byte-for-byte
preservation of a verified retained magnet still holds for Copy magnet link.
With options the engine replaces any existing `xl`, `so` and `x.pe` in the
exported magnet. The result reports which peer hints were included and, when
none were, why (`private_torrent`, `not_reachable`, `no_address`).

`TorrentView.source_size_bytes` carries a magnet's `xl` for a torrent whose
metadata has not arrived, the way `source_display_name` carries `dn`. It is
absent once metadata is verified; clients label it as coming from the link.

## Clients

- Web: Files tab **Share file** / **Share files** for the selection. A
  **Share** panel from the General header's link icon offers the link,
  Copy, the system share sheet where `navigator.share` exists, a QR code
  and an "Include my address" checkbox that starts from the saved choice
  without changing it. The magnet icon still copies at once. Share-link
  copies from menus ask about the peer hint with "Remember my choice";
  Settings → Connection & seeding → Sharing changes the choice.
- Android: the same actions, the system share sheet (`ACTION_SEND`), a QR
  code, the first-copy dialog and a Settings row.
- Website: show `jst.file`/`jst.size`, `xl` and a selected-files note, say
  when a direct address is included, strip `jst.*` from the magnet, and after
  **Open in JSTorrent** offer install links if nothing happened.

## Decisions Made During Implementation

- No address question and no hint request when no target has metadata or
  any target is private: the engine cannot or must not add one.
- A host older than this contract ignores `options` rather than rejecting
  them. A whole-torrent share then copies a plain share link. A file share
  whose export comes back without `so` is refused with "The JSTorrent
  you're connected to needs an update to share single files." rather than
  copying a whole-torrent link under one file's name.
- The remembered choice is a client preference, not engine state: web
  `rstorrent.presentation.share` (`{version: 1, peerHint}`) in local storage,
  Android `product_share`/`peer_hint_choice` in SharedPreferences. Values are
  `ask`, `include` and `omit`; unreadable or newer values read as `ask` and
  are not rewritten. Clear app data (web) and Clear all data (Android) remove
  it; web Restore defaults keeps it, as that copy promises to keep privacy
  choices.
- QR codes use new dependencies: web `uqr` 0.1.3 (MIT, no dependencies,
  about 4.5 KB gzip, loaded only with the lazy Share panel) rendered as React
  SVG rects, and Android `com.google.zxing:core` 3.5.4 (Apache-2.0, no
  runtime dependencies), listed by the Android notices pipeline. Both render
  dark on white with a four-module quiet zone in either theme.

## Invariants

- Copy and share only what the engine exported, plus `jst.*` display keys.
- A link's sizes and names are never shown as verified.
- The peer hint is never included without the user's choice, never for a
  private torrent, and never for an internet address that is not confirmed
  reachable.
- Peer-controlled and link-controlled values are bounded before use.

## Reference Study

Pinned libtorrent `7d7fc38fac61177fa5e02148f791b2f65250b09d`
(`reference/pins.toml`; the local checkout's `HEAD` matches), BEP 9 and
BEP 53 at `bittorrent.org` `7b7b41f4`.

- `src/magnet_uri.cpp` `make_magnet_uri(add_torrent_params const&)` writes
  `&x.pe=` with `print_endpoint` (`1.2.3.4:6881`, `[::1]:6881`, brackets
  not escaped) for every `atp.peers` entry, and `&so=` only when some file
  priority is `dont_download`: comma-separated runs of wanted indices, a run
  as `a-b`, in file-index order. The handle and `torrent_info` overloads
  write no peers and no `so`. Nothing writes `xl`.
- `parse_magnet_uri` strips a `.<digits>` suffix from a name (split at the
  first `.`, so `so.1` means `so`, while `x.pe` and `x.pe.1` are unchanged).
  `so` is dropped whole unless it is only digits, `-` and `,`; then each bad
  token (`-4`, `3-`, `7-4`, an index above `max_index = 10000`) is skipped,
  values from repeated `so` accumulate, and every other file defaults to
  not downloaded. `x.pe` takes IP literals only via `parse_endpoint`;
  invalid ones are skipped and the count is unbounded. `xl` is ignored.
- `test/test_magnet.cpp`: `parse_peer` (valid IPv4 and bracketed IPv6,
  invalid skipped), `parse_magnet_select_only*` (overlap, multiple `so`,
  inverted range, `100000000` bound, `-4`, `3-`, `a`, empty, quoted),
  `select_only` (`so=1`, `so=0`, `0,2-4`, `0-1,3-5`, `0,2,4`, none when all
  are wanted), `peers` (export order), `magnet_tr_x_uri` (`tr.N`).
- BEP 9 gives `x.pe` as `hostname:port`, `ipv4-literal:port` or
  `[ipv6-literal]:port` and says to include it only when the client knows
  its public address and reachability. BEP 53 gives zero-based indices with
  inclusive ranges. No BEP defines `xl`; Transmission
  (`magnet-metainfo.cc`), rqbit and the JSTorrent TypeScript engine ignore
  it, and JSTorrent never exported `x.pe`.

Adopted:

- `xl` parses like `dn`: the first acceptable value, decimal digits only,
  1 to `i64::MAX` (bencoded lengths are signed 64-bit); anything else is
  ignored without rejecting the magnet.
- `x.pe` and `so` use libtorrent's spelling: `ipv4:port`, `[ipv6]:port`,
  IP literals only, and sorted, merged `0,2-4` ranges. Our exporter takes
  selected indices rather than priorities, so `so` is written for any
  non-empty selection.
- With options, every `xl`, `so` and `x.pe` is removed, including
  `so.N`/`xl.N`, which libtorrent would read as `so`/`xl`; `x.pe.N` is kept
  because libtorrent does not treat it as `x.pe`. Other parameters keep their
  bytes and order.
- A gap made only of BEP 47 padding files joins its neighbours (`0-2` for
  files 0 and 2 around a pad file). No client downloads a padding file, and
  our importer skips them.
- Requested indices are bounded at 4096 (the existing file-selection bound)
  so the importer's 4096-entry expansion limit is never exceeded, and the
  result must stay within the 16 KiB magnet bound.

Differences recorded:

- libtorrent ignores `so` indices above 10000. A share of such a file
  selects nothing in libtorrent-based clients; RSTorrent accepts indices up
  to 374,997. Not restricted.
- `so` uses the `FileView::file_index` space. For a hybrid torrent that is
  the v2 file tree, which has no padding files, while libtorrent's hybrid
  file list includes the v1 padding files, so a hybrid `so` can name
  different files there. The importer's duplicate-add path also reads hybrid
  indices from the v1 list; it predates this tactical and is unchanged.
- The peer hint offers a private (RFC 1918) address of the listening port,
  as the maintainer decided, although BEP 9 describes only public endpoints.

## Evidence

### Engine Evidence

- Contract: `export_magnet` takes optional `options` (`include_size`,
  `file_indices`, `peer_hint`); `MagnetExportResult` adds `peer_hints`
  (`endpoint`, `scope`: `internet` | `local_network`, at most two) and
  `peer_hint_omission` (`private_torrent`, `metadata_pending`,
  `incoming_disabled`, `not_reachable`, `no_address`). Both are absent on
  the wire unless a hint was requested. `TorrentView.source_size_bytes` and
  `TorrentFieldUpdate::SourceSizeBytes` carry the magnet's `xl` until
  metadata is recorded. The operational magnet now keeps `xl`, and older
  rows recover it from the verified retained source as they do `dn`; no
  schema change.
- Peer hints come from the advertised-endpoint selector. An internet
  address needs a completed incoming connection from a public address of
  that family on the current endpoint: the healthy, unexpired UPnP mapping's
  external endpoint, a public IPv4 listener, or the global IPv6 listener.
  A mapping alone, an unhealthy renewal or a LAN peer is not enough. A uTP
  peer counts for IPv4 only when the UDP endpoint equals the TCP endpoint.
  A listener or mapping change clears the evidence. Local-network hints
  are RFC 1918 IPv4 listener addresses; loopback, link-local, CGNAT
  (`100.64/10`) and documentation ranges are never hinted.
- Tests: protocol `xl` bounds and first-acceptable fallback, share-key
  replacement and round trip, `SelectOnly` construction bounds; selector
  evidence from public, LAN, uTP and wrong-port peers, withdrawal on
  renewal failure, expiry, remapping, listener replacement and stop, and
  IPv6 confirmation; pure hint selection, omission reasons and the IPv4
  special-range classifier; store export before and after metadata
  (verbatim without options, `xl`/`so`/`x.pe` replacement, padding bridge,
  index, padding, order, duplicate and count rejection, offline omission,
  private omission, wire absence); `source_size_bytes` projection, patch
  withdrawal on verified metadata, row-update diff and startup projection
  before and after metadata. Web validation, mapping and reducer cases.
- Validation: `cargo fmt --all -- --check`; `cargo clippy --workspace
  --all-targets -- -D warnings` (temporary empty `clients/web/dist`);
  `cargo test -p rstorrent-protocol` (266 passed, 4 ignored),
  `-p rstorrent-session` (439 passed, 2 ignored), `-p rstorrent-gateway`,
  `-p rstorrent-android`, `-p rstorrent-ios`; `npm run typecheck` and
  `npm run test` (652 passed, 2 skipped) in `clients/web`;
  `clients/android/build.sh debug` (177 unit tests) and
  `:app:compileDebugAndroidTestKotlin`; `node scripts/check-localization.mjs`.
  Not run: iOS build, device instrumentation, live reachability.

### Web Evidence

- `npm run typecheck`; `npm run test` (680 passed, 2 skipped), including
  seven new `App.test.tsx` share cases (ask, include and remember, omit,
  private skip, older-host retry, Files share, Share panel QR, Web Share
  present and absent, size from the link) and unit tests for `share-link`,
  `share-export`, `share-preferences` and `command-error`;
  `check:localization` (1,499 web messages); `tests/inspection-demo.spec.ts`
  (33 passed, axe on the Share panel and ask dialog, clipboard checks)
  against a local dev server. Light, dark, 1100 px and 390 px captures of
  the panel, dialog, Files menu and size label were reviewed and removed.

### Android Evidence

- `clients/android/build.sh debug` (192 unit tests, including `ShareFlow`,
  `ShareQr`, `ShareLink` `jst.*` vectors and `TorrentActions`) and
  `:app:compileDebugAndroidTestKotlin`. Copy share link, **Share…** (system
  chooser), **Show QR code** (share panel with Copy and Share), Files
  **Share file(s)**, a Settings → Network & privacy → Share links row, and
  "(from the link, not verified)" sizes in Details. Not run on a device.

### Website Evidence

- `npm test` in `website` (92 passed, 28 share-link cases: `jst.*`
  stripping, bidi and control-character names, `xl`, `so` bounds, `x.pe`
  scope and floods, legacy formats); `npm run check`; `npm run build`; a
  local Playwright pass over rich, selected-files, legacy and hostile links
  and the "Didn't open?" fallback in light and dark, desktop and mobile.
