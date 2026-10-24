# Local MP4 native playback

Status: complete (local Chromium qualification).
Topic: `http-file-serving-and-streaming`.

## Scope and stopping condition

Fix the maintainer's completed Big Buck Bunny MP4 failing with the audio
transcoding error in the browser Library. Stop when the actual file plays
with audio and decoded frames, forward/back seeks and close/reopen pass,
regressions cover native selection and disposal, and web checks pass.

## Findings and design

The local file is H.264 (`avc1.640029`) with primary stereo MP3 and secondary
six-channel AC-3. Bundled Chromium reports native MP4/MP3 support but rejects
MP3 in an MP4 MediaSource. The existing integration offers only HLS remuxing;
its audio rejection is correct for that path but does not describe native
file playback. The previously qualified 313/362 fixture was H.264/AAC.

Use pinned playsvideo 0.4.7 `loadWithOptions` with a `direct-url` MP4 option
and HLS fallback for local MP4/M4V. Its `playback-selection.js` checks parsed
video and primary audio codecs with `canPlayType`, separately from MSE.
`engine.js::startSourcePipeline/startPassthrough` selects the native URL;
`extractEmbeddedSubtitlesFromDemux` then disposes the now-unused parser.
Parser disposal must not close the independently owned local player.

## Ownership, invariants and non-goals

The dialog's abort controller and explicit close own the local session.
Parser disposal cancels its own bounded range reads; session close destroys
the engine, clears the element and drains reads. Keep the existing parser,
range and remux limits. Native playback uses the same verified, file-scoped
media capability and the browser's byte-range loader. No new endpoint,
authority, dependency, contract, migration or host behavior.

MKV and remote DataChannel playback retain the bounded remux path. No audio
transcoding, track-selection UI, new container claims or Android/desktop
player changes. This is a browser consumer fix; Android's native media player
and generated boundary are unaffected. Libtorrent is not a container or media
playback oracle, and no engine work is involved.

## Validation plan

- Reproduce rejection with the actual local file before changing playback.
- Unit checks for native MP4/M4V options, MKV/remote remux-only behavior,
  parser disposal without session close, abort and explicit close.
- Opt-in headless Chromium regression using an external local media file:
  parsed codec evidence, decoded frames and audio, forward/back seeking,
  parser-release survival, close and reopen. No media fixture is imported.
- Web typecheck, unit suite, production build/CSP and diff whitespace check.

## Evidence

The existing 276,134,947-byte Big Buck Bunny file was inspected through the
locked mediabunny demuxer without modification. It has H.264 1920×1080,
stereo MP3 at 48 kHz, and a second six-channel AC-3 track at 48 kHz.
Bundled Playwright Chromium on macOS reports `canPlayType` support for
MP4/MP3 while `MediaSource.isTypeSupported('audio/mp4; codecs="mp3"')`
returns false. No detection override or transcoding is needed.

The opt-in `tests/video-playback.spec.ts` reproduced the exact reported
transcoding error before the fix. After the fix it passes native URL
selection, more than five decoded video frames, nonzero decoded audio bytes,
75% and 10% seeks with compositor frame times within two seconds of target,
source detachment on close, and successful reopen without errors. The test
uses the production adapter and file bytes served through bounded intercepted
same-origin ranges; it does not exercise a new gateway or public swarm.
No media bytes were copied into the repository, and the original download
was retained untouched. This qualifies this sample in bundled Chromium;
other browsers and native containers/codecs require their own evidence.

`media-url-playback.test.ts` covers MP4/M4V options, remux-only MKV and remote
sources, parser disposal without player destruction, explicit/idempotent
close, abort after handoff, already aborted requests and fatal engine errors.

Passing commands:

```bash
npm run typecheck --prefix clients/web
npm run test --prefix clients/web
npm run build --prefix clients/web
# From clients/web, with an isolated Vite server on port 4399:
RSTORRENT_PLAYWRIGHT_BASE_URL=http://127.0.0.1:4399 \
RSTORRENT_PLAYBACK_FILE='<existing Big Buck Bunny.mp4>' \
  npm exec -- playwright test tests/video-playback.spec.ts
git diff --check
```

Unit suite: 801 passed, four skipped. Build includes the pinned source patch
check and CSP bundle check. Rust and platform builds are inapplicable to this
browser-only consumer change; the generated application contract is unchanged.
