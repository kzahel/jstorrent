# Local browser inline video playback

Status: complete (local Chromium qualification). Topic: `http-file-serving-and-streaming`.

## Scope and stopping condition

The maintainer selected an in-app player for the browser-hosted web UI on
2026-10-15. Local **Open** hands a file to a new tab; completed videos should
also play in a modal inside the page. This slice adds **Play** for completed
MP4, M4V and MKV files in the browser-hosted web UI and Library, reusing the
playsvideo dialog from Tactical
[313](313-completed-remote-video-playback.md). The dialog offers the existing
new-tab Open as its fallback.

Stop when the shared dialog plays local completed files through the existing
file-scoped media capability URL, MKV demuxing is admitted within the 313
bounds, deterministic tests cover the range adapter and presentation, and a
real Chromium run against a live gateway records decoded frames and seeks for
an MP4 and an MKV file.

## Non-goals

- Desktop (Tauri) inline playback. Its CSP has no `media-src`, and the
  `tauri://` document scheme may block loopback HTTP as mixed content; that is
  a separate investigation. Desktop keeps the system-handler Open.
- Incomplete or streamable files, playback-position-driven piece priority and
  presentation deadlines. Play is offered only for typed `available` files.
- Audio transcoding (AC-3, DTS and others stay rejected), WebM, AVI, TS,
  subtitles, audio-track choice, resume position, playlists, thumbnails.
- Any shipped host change. The page uses the existing `create_media_url`
  command and media route, so no host capability, contract field or migration
  is added. Only the development gateway's media origin changes.
- Remote eligibility. Remote Play stays MP4/M4V as qualified by 313.

## Design

The browser bootstrap supplies a lazy local playback adapter beside the
existing remote one. The adapter asks the live application for a media URL,
then feeds playsvideo through the 313 `DirectFilePlaybackSource`, whose
serialized reads, 256 KiB read-ahead, 8 MiB per-read and 32/16 MiB parser and
segment bounds are unchanged. A new HTTP range reader satisfies the same
range interface with one `fetch` per read: it sends a single `Range`, requires
`206`, an exact `Content-Range` with the expected total, and never accepts
more bytes than requested. The 313 source admits at most one read at a time,
within the host's four-requests-per-capability limit.

The media URL must be on the page's origin; the media route deliberately sends
no CORS headers. That holds when the gateway serves the page, as in the shipped
browser product and `./scripts/webui`. Development gateways
(`unauthenticated_loopback_development`) now mint media URLs on their
configured visible origin instead of their own listener, and Vite proxies
`/media` with the visible Host in both the reload and preview profiles, as
Tactical [226](226-live-webui-hot-reload.md) intended. Vite pre-bundles
playsvideo at startup so the first Play does not reload the dev page.

`patch-playsvideo.mjs` widens the demuxer from `[MP4]` to `[MP4, MATROSKA]`
and makes the transcoding rejection message product-neutral. Duration,
keyframe-count and segment-size limits apply to both containers.

### Ownership and cancellation

The dialog owns the adapter session and its `AbortController`. Closing,
replacing or unmounting the dialog aborts the in-flight fetch and the media-URL
request, destroys the engine and clears the video element. A fatal element or
engine error closes the session. The capability expires after the host's
30-minute idle timeout; a long pause then fails the next read and the dialog
reports it. No background task outlives the dialog.

Dependency direction: React presentation depends on the playback adapter
interface; the adapter depends on the application's media-URL call and on the
playback source; the source depends only on the range interface.

## Validation

- Unit: HTTP range reader accepts exact `206` ranges and rejects `200`,
  mismatched `Content-Range`, oversized bodies and aborts.
- Unit: dialog plays through the local adapter, offers Open in a new tab and
  closes the session; Files shows Play before Open for completed local videos.
- Live: bundled Playwright Chromium against a gateway serving the built UI,
  with Big Buck Bunny MP4 and an MKV remuxed from it without re-encoding.
- `npm run typecheck`, `npm run test` and the localization check.

## Evidence

Files and Library now offer **Play** for completed MP4, M4V and MKV files when
the browser-hosted UI has a local playback adapter. Files lists Play before
Open, and Open keeps its new-tab icon. Remote Play is unchanged. Tauri passes
no adapter, so desktop behavior is unchanged.

The live run used the debug gateway with
`unauthenticated_loopback_development`, a fresh profile, the built hosted UI
served same-origin, `loopback_only` networking, and bundled Playwright
Chromium (headless) on macOS arm64. The fixtures were the 313 Big Buck Bunny
MP4 (64,657,027 bytes, SHA-256
`f78f39603e6774907f2faafabf26a667f4a6fc31769ec304a8a8f7c62d280508`) and an
MKV remuxed from it by mediabunny 1.38.1 without re-encoding (H.264/AAC,
64,729,432 bytes). A generated v1 torrent over both files was added through
the UI against the existing data, which verified to Complete.

| Path | First frame | Seeks 50% / 10% / 90% | Landed within |
| --- | --- | --- | --- |
| MKV, Files Play | 245 ms | 56 / 66 / 75 ms | 0.02 s |
| MP4, Library Play | 130 ms | 45 / 41 / 50 ms | 0.01 s |

Each seek waited for `seeked` and then a `requestVideoFrameCallback` media
time near the target. The dialog's Open in new tab opened a popup on the media
route. Escape and Close detached each dialog; the page logged no errors and
the gateway log had none. Fixtures, profile and the generated torrent were
deleted afterwards. This is one local sample on one browser; it does not claim
other browsers, cross-origin pages, high-bitrate files or AC-3/DTS audio,
which playsvideo rejects without transcoding.

The first commit was qualified only against a same-origin built UI. In the
maintainer's `./scripts/webui --reload` session, Play failed: the page on the
Vite origin fetched the gateway's private port and was blocked by CORS, and the
first Play also triggered Vite's dependency re-optimization, which reloaded the
page. After the follow-up, the same Chromium drive ran against an isolated
`./scripts/webui --reload` (port 4391, fresh data root, cold Vite start). MKV
from Files reached a frame in 325 ms with 61–75 ms seeks, MP4 from Library in
134 ms with 46–51 ms seeks. All 173 media requests used the visible Vite
origin, the new-tab Open returned 200 through the proxy, and the Vite log
showed no playsvideo re-optimization. The opt-in live Library spec now opens
the dialog and uses its new-tab Open. A gateway unit test covers the
development media origin and its Host check.

Deterministic coverage: `http-range-reader.test.ts` (exact `206`, rejected
`200`, mismatched or resized `Content-Range`, expired link, long and short
bodies, invalid ranges, abort), `VideoPlayer.test.tsx` (local play, new-tab
Open and its failure, remote precedence, eligibility) and an `App.test.tsx`
case for Play before Open. `npm run typecheck`, `npm run test` (754 passed,
3 skipped) and `npm run check:localization` pass. The patch script applies to
the pristine 0.4.7 package and upgrades installs carrying the 313 output in
place; both paths were checked against recorded hashes.
