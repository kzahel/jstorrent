# Completed remote video playback

Status: complete (local Chromium qualification). Topic: `direct-remote-file-streaming`.

## Scope and stopping condition

User authorizes autonomous completed-file playback, Big Buck Bunny seeking
validation, commits and push. Integrate playsvideo through authenticated v2
ranges; expose remote Play in Files and Library, with a closeable player.
Stop when real Chromium playback/seek/failure/reopen evidence, bounded resources,
license/source provenance and proportional Rust/web validation are recorded.
Chrome/Edge are the initial scope. No progressive torrent playback, general
Open, service worker, HTTP gateway, media relay, automatic reconnect, transcoding
or extra platform hosting. Existing local Open and Save remain compatible.
Android hosting is absent and feature-off; this browser-only consumer changes
no Android engine/storage/generated boundary semantics.

## Sources and adopted behavior

MSE ISO-BMFF specification sections 3–5 require initialization and fragmented
media segments; arbitrary normal MP4 chunks are not directly appendable.
https://www.w3.org/TR/mse-byte-stream-format-isobmff/

playsvideo npm 0.4.7 (MIT) and local reference e1bb9212ee5afb0e1cddfaf71474ab0f5400d970:
`src/source.ts`, `engine.ts::loadSource/startSourcePipeline/requestSourceSegment`,
`pipeline/demux.ts::SourceAdapter/getKeyframeIndex`, and the custom HLS fragment
loader. Adopt custom Source reads, remux and cancellation; do not copy the
legacy UI. Published package is inspected separately from the working checkout.
Old JSTorrent TypeScript reference `packages/client/src/components/VideoPlayer.tsx`
and `utils/create-source-from-session.ts` prove custom Source integration and
cleanup; lessons include per-segment signals, disposal and source URL optionality.

Pinned libtorrent 7d7fc38fac61177fa5e02148f791b2f65250b09d:
`src/peer_connection.cpp::incoming_cancel/fill_send_buffer` and
`test/test_fast_extension.cpp::reject_fast` reaffirm queued-byte cancellation
races and bounded producer admission. No engine scheduling changes; libtorrent
is not an MSE/container implementation oracle. Retain 312 range integrity,
consumption credit and cancellation barriers.

Big Buck Bunny: Blender Foundation / peach.blender.org, CC BY 3.0, official
https://download.blender.org/peach/bigbuckbunny_movies/BigBuckBunny_320x180.mp4.zip
and https://peach.blender.org/about/. Fetch into disposable test directories;
record exact hash/codec/duration and remove downloaded media after validation.
No media fixture is committed. playsvideo dependencies: mediabunny MPL-2.0,
hls.js Apache-2.0; preserve notices and reproducible exact lock pins.

## Ownership, bounds and dependency direction

Player modal owns engine, source and AbortController. Source owns serialized,
bounded reads and bounded read-ahead/cache; wire transport owns credit until
bytes move into that separately bounded consumer. Seek cancels old reads;
closing/replacement/unmount/fatal failure aborts work and closes authenticated
peer. Extract existing Save peer setup/teardown into shared browser connection
owner, keeping request identities and truthful audit outcomes. No extra runtime
host task; existing supervisor joins on disable/revoke/disconnect/shutdown.
Extend bounded peer lifetime for movies while retaining negotiation/request
inactivity deadlines and circuit authority. Idle pauses retain only bounded
resources and terminate at the absolute lifetime.

Protocol/domain remains runtime independent. React depends on playback adapter;
playback adapter depends on authenticated connection and v2 ranges; source maps
half-open numeric offsets to checked bigint ranges. Library/player dependencies
are lazy. Unsupported codec/container/oversized parser reads fail clearly.
Bound source allocations/read-ahead, pending request count, remux segments and
HLS forward/back buffers independently; 8 MiB transport credit is not a total
browser memory claim. Concrete dependency/patch and numeric limits are recorded
before their implementation below.

## Required evidence

Deterministic invalid offsets, allocation limits, queued/active abort, failed
read/disposal and connection teardown; unchanged Save/fallback tests. Actual
Chromium (bundled Playwright, not installed browser), authenticated host/relay,
verified BBB file, decoded frames, forward/back/repeated seeks and EOF, close
while connecting/reading, reopen, disconnect and disabled transfers. Record
startup/seek times, transferred bytes/high-water resources and zero terminal
owners; never infer general WAN or browser support. Verify tail-moov behavior
with an independently remuxed copy if source metadata is front-loaded.

## Execution checkpoint

Implementation and local qualification complete. See the completed evidence
and deliberate limits below; no further implementation action remains.

### Concrete implementation limits

playsvideo 0.4.7 is an exact npm dependency; hls.js 1.7.3 and mediabunny fork
cd3cd2beb9c122dfa6fa89edbd7a73f2fa9df7a0 are locked. The fork uses an explicit
HTTPS override. `clients/web/scripts/patch-playsvideo.mjs` records original and
modified SHA-256 per upstream file, applies independently authored product
limits and late-init disposal guards, and rejects unexpected sources. This
bounded adaptation avoids depending on an unpublished sibling working tree.

Source: <=4 admitted reads, serialized; <=8 MiB requested allocation, 256 KiB
read-ahead and one 256 KiB cache; fixed <=1 MiB wire window. Wait for the full
native cancellation release before admitting another source read. Initial
parser/segment requests total <=32 MiB, subsequent segment requests <=16 MiB;
these conservatively count repeated parser accesses too. Reject unsupported
large metadata/samples or unusually long GOPs clearly. These are encoded-data
bounds, not an exact total browser RSS limit. HLS forward goal 12 seconds,
back buffer 8 seconds, forward flush threshold 16 seconds, byte goal 16 MiB;
media segment output <=16 MiB, duration
<=12 hours and keyframe index <=100,000 entries. Initial MP4/M4V and browser-
supported codecs only; audio requiring transcoding is rejected. No worker,
service worker, OPFS, IndexedDB or media HTTP requests. `media-src blob:` is
added only to the remote document CSP; script/connect/worker authority stays
unchanged. Native peer absolute lifetime increases from ten minutes to twelve
hours; per-request 60-second inactivity, 20-second negotiation, revocation and
circuit-bound cancellation remain intact. Playback ends with cancelled audit
outcome because it does not claim that a file was saved or consumed in full.

## Completed evidence and deliberate limits

The authenticated installed-headless/relay/product runner passes with the
actual playsvideo browser consumer in bundled Chromium 151.0.7922.34 on
macOS arm64 / Apple M4 Pro. BBB is 64,657,027 bytes, H.264/AAC, 320×180,
SHA-256 `f78f39603e6774907f2faafabf26a667f4a6fc31769ec304a8a8f7c62d280508`.
Its `moov` is at offset 64,312,833 after `mdat`, so the original fixture proves
startup without front-loaded metadata. No second remuxed fixture is needed.

The final local run reaches a decoded frame in 772.3 ms.
Seeks to 75%, 10%, 50%, 90% and 2% take
91.0, 75.8, 74.8, 57.8, 133.2 ms respectively. Each asserts the
compositor frame's media timestamp near its target, not just currentTime.
Rapid 85%→20%→65% seeks settle, EOF emits `ended`, close/reopen succeeds,
closing during connection setup releases owners, and administrative circuit
closure terminates the player and peer before successful page reload/resume.
Operator disabling transfers rejects a subsequent Library Play with a clear
host-disabled error and zero owners; re-enabling restores playback.
Files and Library **Play** traverse real authenticated signaling/capability-backed
reads.
At EOF after this seek sequence, 36,520,058 wire bytes were sent:
startup did not require a full-file download. This is one controlled local
sample, not WAN, branded Edge, high-bitrate or universal browser evidence.

100-ms CDP sampling observes V8 used-size peak 15,941,188,
backing storage 27,716,344, and
embedder heap 5,674,512 bytes.
These are distinct browser counters, not a total process/RSS cap. Retained
media ranges peak at 20.00 seconds. The first measurement
exposed 43.84 seconds of stale future ranges after seeking: explicitly setting
hls.js `frontBufferFlushThreshold: 16` bounds that retention. Segment
quantization and transient append/eviction mean this threshold is not a strict
instantaneous total-buffer duration cap. Source inspection
of pinned hls.js 1.7.3 `src/config.ts` and
`src/controller/buffer-controller.ts::onFragChanged/trimBuffers/flushFrontBuffer`
confirms the front and back eviction contract; HLS byte size remains a goal,
with source/request and segment-output limits providing separate defenses.

BBB's video lasts 596.458333 seconds but audio ends at 596.245333.
The original pipeline stalls at the shorter buffered endpoint. The bounded
adapter normalizes an earlier audio endpoint only when the mismatch is <=1
second, giving this file a 596.245334-second playable timeline and clean EOF.
That may trim up to one second of trailing silent video; larger track-end
mismatches are not qualified by this slice. The scoped package adaptation also
prevents late initialization from attaching a destroyed player, checks output
before allocation, limits duration/index, rejects audio transcoding and removes
unused worker/FFmpeg/custom-controls exports. Remote bundles contain no FFmpeg
JS/WASM or playback workers and still pass the no-eval/Function/require scan.
Only `media-src blob:` is added to the remote CSP; zero service workers and
zero relay-retained media payloads are observed.

Native requests/tasks/sockets/queued bytes return to zero after each teardown.
The shared browser connection now subscribes to authenticated circuit closure;
peers do not wait for RTC inactivity to discover parent authority loss. The
close subscription is removable and notified once. Save/v1 fallback tests
remain unchanged. One early fixture preparation failed because two profiles'
add operations shared the same durable request ID; the harness now derives
that ID from the fixture info hash. No product admission policy changed. Library qualification exposed the old
browser wrapper hiding `torrent_media` along with unsupported file URLs. The
wrapper now preserves this metadata-only catalog capability; media-URL and
platform file-opening methods remain excluded and server-side prohibited.

Validation run:

- `cargo fmt --all -- --check`.
- `cargo clippy --workspace -- -D warnings`.
- `cargo test --workspace`: 1,588 passed, 18 ignored.
- `cargo clippy -p rstorrent-direct-file --features experiment -- -D warnings`.
- `cargo test -p rstorrent-direct-file --features experiment`: 20 passed,
  one public-STUN test ignored.
- `npm ci --prefix clients/web`: clean HTTPS immutable git install,
  checksum-checked package patch, zero npm vulnerability findings.
- Web typecheck and full Vitest: 521 passed, two skipped. New tests cover
  source bounds/cache/queue/active and queued abort/release/failed reads,
  modal late-result disposal, fatal media error cleanup, eligibility,
  unavailable-transfer admission, and
  circuit-close subscription. Rust notice provenance is also exercised to keep
  the npm Git exception separate from Cargo notices.
- Web localization validation across repository catalogs.
- Normal web and remote builds, including their CSP checks.
- `python3 -m unittest discover -s scripts -p test_distribution_review.py`:
  28 passed; full desktop release notice generation validates 461 Rust and
  34 npm inputs for aarch64-apple-darwin.
  Only the exact reviewed mediabunny public Git commit may omit npm tarball
  integrity; notices retain its preferred-source archive and playsvideo patch.
- `node --test scripts/website-security.test.mjs`: three passed.
- Authenticated `node scripts/verify-remote-product.mjs --playback-file
  /absolute/BigBuckBunny_320x180.mp4`: decoded playback/seek/EOF/cancel/reopen/
  circuit shutdown plus existing login, resume, relay restart, rollback,
  revocation, changed-host and invalid-circuit flood evidence passes.
- Command-driven screenshot reviewed for modal, controls, film frame and status.
- Documentation links and `git diff --check`.

Temporary media, zip, captures, profiles and logs are removed; runner children
are reaped. This does not deploy a host, publish a release, or qualify new
Android/iOS hosting. Generic remote Open, incomplete files, MKV, transcode,
large A/V endpoint mismatches, prolonged 12-hour soak, high-bitrate/high-GOP
movies and independent-network/browser qualification remain deliberate follow-ups.
No further implementation action remains in this tactical.
