# Tactical 356: Precompressed Hosted Web Assets

Status: Complete locally, 2026-10-14. Maintainer-directed follow-up to
Tactical 352.
No release is authorized by this tactical.
Topics: `web-ui-design`, `runtime-configurations-and-headless-deployment`.

## Problem

Tactical 352 measured the gateway serving the web UI uncompressed: every
response's transfer size equals its body size. The generated validator chunk
alone is 1,043 kB on the wire instead of about 88 kB gzip, and after 352 it is
the long pole for library data on slow LAN and tailnet links. The whole first
load is about 1.9 MB.

## Scope

- The hosted web build writes a brotli (`.br`, quality 11) and a gzip
  (`.gz`, level 9) copy beside each compressible file in `dist` using Node's
  built-in `zlib`: `npm run build:hosted`. The headless and Crostini package
  scripts and `./scripts/webui` use it.
- The gateway's static fallback, `tower-http`'s `ServeDir`, serves those
  copies with `precompressed_br()` and `precompressed_gzip()` when the request
  accepts the encoding, and the plain file otherwise.
- Static responses carry `Vary: Accept-Encoding` beside the existing cache
  policy, since `ServeDir` does not add it.

## Non-Goals

- Compressing responses on the fly (`CompressionLayer`): it adds
  `async-compression` and codec crates, costs CPU per request on small hosts,
  and would have to stay away from `/media` ranges, API responses and the
  WebSocket.
- Tauri, which loads the UI from local files and compresses its own embedded
  assets; plain `npm run build` stays unchanged for it.
- The remote page and website, served by their own hosts.
- Changing the generated validators.

## Invariants

- The uncompressed file stays present and is served to clients that do not
  accept brotli or gzip.
- A compressed copy is written only when it is smaller than its source, and
  only for text formats; images and existing `.br`/`.gz` files are skipped.
- Cache policy is unchanged: `index.html` and the boot script are `no-store`,
  hashed assets are immutable for a year.

## Validation

- A gateway test serves one asset with distinct `.br` and `.gz` copies and
  asserts brotli, gzip and plain responses, their `Content-Encoding`, and
  `Vary: Accept-Encoding`.
- `cargo fmt --all -- --check`, `cargo clippy -p rstorrent-gateway -- -D
  warnings`, `cargo test -p rstorrent-gateway`.
- `npm run build:hosted` and a measured first load against a local gateway,
  recorded below.

## Stopping Condition

The headless, Crostini and local development gateways serve brotli or gzip
web assets to browsers that accept them, with the result recorded here.

## Result

`npm run build:hosted` precompresses 39 files: 2,353.9 kB becomes 354.7 kB
brotli and 431.3 kB gzip. `index.html` is under the 1 KB floor and stays
plain. The validator chunk is sent as 57.6 kB brotli instead of 1,043 kB.
`ServeDir` already sets the original file's content type on the compressed
copy; the gateway adds `Vary: Accept-Encoding` to static responses and to
any response with a `Content-Encoding`.

Same harness as Tactical 352 (production build, local offline gateway built
from this change, headless Chromium, medians, milliseconds from navigation;
throttled is 10 Mbit/s, 40 ms latency, 4x CPU):

| | Shell visible | Library data | Transferred |
| --- | --- | --- | --- |
| After 352, throttled | 1,176 | 2,091 | ~1.9 MB |
| After 356, throttled (5 runs) | 561 | 676 | ~0.3 MB |
| After 356, unthrottled (7 runs) | 63 | 78 | ~0.3 MB |

Before Tactical 352 the throttled shell and data both appeared at 2,381 ms.

Validation run: `cargo fmt --all -- --check`; `cargo clippy -p
rstorrent-gateway --all-targets -- -D warnings`; `cargo test -p
rstorrent-gateway` (53 library tests, including the new precompressed
case); `npm run build:hosted` with its CSP check; `curl` header checks and
the measured loads above. The headless and Crostini package scripts were
changed but not run.

