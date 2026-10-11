# Completed remote video playback

Status: active. Topic: `direct-remote-file-streaming`.

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

Source review and scope complete. Next: pin dependency, bounded source/player
adapter and reusable authenticated connection, then real product evidence.

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
back buffer 8 seconds, byte goal 16 MiB; media segment output <=16 MiB, duration
<=12 hours and keyframe index <=100,000 entries. Initial MP4/M4V and browser-
supported codecs only; audio requiring transcoding is rejected. No worker,
service worker, OPFS, IndexedDB or media HTTP requests. `media-src blob:` is
added only to the remote document CSP; script/connect/worker authority stays
unchanged. Native peer absolute lifetime increases from ten minutes to twelve
hours; per-request 60-second inactivity, 20-second negotiation, revocation and
circuit-bound cancellation remain intact. Playback ends with cancelled audit
outcome because it does not claim that a file was saved or consumed in full.
