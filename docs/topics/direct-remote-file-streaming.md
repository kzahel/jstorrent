# Direct Remote File Streaming

Tactical [381](../tactical/381-dependency-cleanup-and-security.md) upgrades the
optional/default-product WebRTC graph from rtc 0.20.4 to 0.21.1 with the same
ring backend. The driver supplies explicit monotonic timestamps to the newer
construction, signaling, STUN and DataChannel APIs. Query-only mDNS, its
timeout, the 512-KiB SCTP receive bound, application budgets, direct-only ICE,
verified-file reads and v1/v2 wire formats remain unchanged. The local real-
browser product verifier passes login/resume/revocation and exact completed-
file saving. No new WAN, throughput, installed-platform or package-size claim
is made. The older feasibility measurements below describe their original
0.20.4 graph.

Tactical [313](../tactical/313-completed-remote-video-playback.md) adds remote
completed MP4/M4V **Play** in Files and Library through playsvideo 0.4.7,
authenticated v2 range reads and HLS/MSE. Local Open and remote Save retain
their existing paths. Source reads, read-ahead/cache, parser work, segment output
and player buffers have separate bounds; seeking aborts and drains native
release barriers before the next source read. The player and authenticated
circuit own teardown, with a 12-hour native peer maximum and unchanged request
inactivity/authority limits. The existing media capability still expires after
30 minutes idle or 24 hours absolute. No general Open, partial-file playback,
other-container/transcode qualification, service worker, HTTP gateway or media
relay is added. Chromium local BBB decoded playback, seeking, EOF and cleanup
pass; branded Edge/other browsers, high-bitrate movies and independent-network
qualification remain separate. Exact sources, patches, provenance, limits and
measured evidence are recorded in 313. This supersedes earlier blanket Play
deferrals only within this completed-MP4 scope.

Tactical [312](../tactical/312-reliable-credit-range-streams.md) implements
reliable ordered v2 range streams with cumulative consumption credit, a shared
8-MiB receive budget, independent bounded transport admission, batched writes,
cancellation/release barriers and v1 compatibility. Matched 100-ms-RTT,
16-MiB/s shaped local saves improve from 0.58 to 7.94 MiB/s. Packet-loss saves
retain exact hashes; high-rate bursts and lossy throughput remain limits to
qualify. Rust/web gates and the full authenticated product verifier pass.
General Open, automatic resume, real WAN/picker and mobile hosting remain separate.

Completed local Tactical [309](../tactical/309-direct-file-transport-ceiling.md)
measures 51.77 MiB/s for normal 256-MiB disk saves, 51.11 with generated
ranges and a stable 68.50 raw RTC operating point at 64-KiB outstanding.
Removing reads does not reveal a major disk-save gain. Larger raw buffers are
slower/variable; no universal WebRTC ceiling or library ranking is established.
Production algorithm/limits remain unchanged. Next study targets controlled
RTT/loss, transport diagnostics and a throughput/memory target before further
credit or writer tuning; external-picker/WAN qualification remains with 196.

Topic: `direct-remote-file-streaming`

Completed local Tactical [307](../tactical/307-direct-file-save-throughput.md)
improves completed-file Save with a four-chunk/64-KiB producer window and
independently bounded browser receive work. Repeated local 256-MiB disk saves
improve from 36.82 to 51.70 MiB/s; exact bytes, concurrent/adversarial requests,
actual inactivity, previous-consumer compatibility, authenticated product
verification and Rust/web checks pass. This does not qualify a WAN or external
save picker. Large remote saves target Chrome/Edge's streaming file
writer; Firefox/Safari large-file support is deferred by maintainer direction.
The existing 32-MiB Blob fallback remains. OPFS is a disk-backed benchmark
destination only, not a production save policy. Open/Play stays deferred.

Tactical [301](../tactical/301-remote-save-progress-presentation.md) repairs the
Files Save presentation after an owner reports a successful remote save with
rapid percentage/layout movement. A separate bounded progress row gates
display updates to five per second without throttling DataChannel reads,
writes or acknowledgements. The owner's successful save is useful anecdotal
evidence, not recorded independent-network qualification. Open/Play remains
outside the completed-file Save slice: the range protocol already exists, but
a seeking browser media-consumption adapter still needs implementation and
cross-browser evidence.

Status: Active Tactical
[`196`](../tactical/196-remote-direct-file-product-integration.md) has landed
the first product slice and remains active for qualification. Desktop and
headless leaf products compile the measured WebRTC graph by default while
preserving explicit feature-off graphs. The remote Files surface saves one
completed verified file over authenticated RDF signaling, direct-only ICE,
and 16-KiB DataChannel messages; Remote Access settings own the kill switch,
live resources, stop action, and redacted audit. Public Cloudflare STUN and
strict UUIDv4 `.local` mDNS candidates are implemented lazily. The complete
current-host product verifier plus native Windows and Linux ARM64 builds pass.
An independent-network selected pair and a real streaming save picker remain
bounded evidence gaps, so the capability stays unadvertised. TURN remains
explicitly unplanned.

Completed Tactical
[`195`](../tactical/195-webrtc-direct-file-feasibility-spike.md) retains lower
`webrtc-rs/rtc` 0.20.4 behind the library-optional `direct-file-webrtc`
feature, a lazy supervised endpoint, bounded verified-range codec, and local
real-browser harness. Chromium and Firefox pass. Post-completion Playwright
WebKit reruns also complete ICE, DTLS, DataChannel, and exact range traffic;
their repeatable OPFS failure belongs to Playwright's non-persistent test
context rather than the transport. OPFS is not used by the product.

## Purpose And Ownership

The remote React UI can control and inspect the real RSTorrent application,
and its authenticated relay circuit intentionally carries no torrent payload
or file content. The first direct completed-file Save seam now connects that
control surface to the local media service's bounded verified reads. This
topic owns that transport, its browser presentation, continuing qualification,
and later file-consumption breadth.

Specifically, it owns:

- direct remote file-byte transport from a native desktop or configured
  headless RSTorrent host to an authenticated browser;
- direct-path discovery, selection, fallback posture, and privacy;
- optional compilation, product packaging, and lazy runtime ownership;
- the bounded file-range protocol carried over a non-HTTP transport;
- browser-side download, viewing, seeking, and playback adapters;
- direct-transfer audit, cancellation, and operator visibility; and
- the investigations required before choosing a Rust WebRTC dependency or
  enabling the feature by default.

[`http-file-serving-and-streaming.md`](http-file-serving-and-streaming.md)
continues to own media eligibility, opaque per-file capabilities, verified
logical reads, incomplete-file demand, resource ceilings, and storage
generation fencing. This topic must reuse those authorities rather than create
a second file reader or infer verification from bytes on disk.
[`remote-access-authentication.md`](remote-access-authentication.md) owns the
owner passphrase, host identity, remembered-browser authorization, revocation,
security history, and encrypted control circuit.
[`application-connection-architecture.md`](application-connection-architecture.md)
owns the typed application frames and the rule that bulk file content does not
enter the application control connection.
[`incoming-reachability-and-seeding.md`](incoming-reachability-and-seeding.md)
owns BitTorrent peer-listener reachability. Its mappings and sockets are not
remote-file authority merely because some discovery mechanisms overlap.

## Desired Product Outcome

The landed first slice lets an authorized remote owner select one completed
verified torrent file and choose **Save file...**. The broader desired outcome
is to add eligible **Open** and **Play** consumers without weakening the same
authority and direct-only invariants. For each supported action RSTorrent:

1. creates a short-lived file-scoped capability inside the authenticated
   application circuit;
2. starts a direct endpoint lazily if one is not already suitable for that
   browser;
3. exchanges bounded connectivity and endpoint-authentication material through
   the existing encrypted control circuit;
4. attempts the best direct path available between browser and host;
5. serves only requested verified ranges with explicit backpressure and
   cancellation; and
6. tears down the peer, socket, mapping, reads, and transient download demand
   after revocation, terminal failure, shutdown, or a bounded idle period.

The UI should say whether it is connecting, direct, unavailable, or stopped.
It should not ask the user for an IP address, port, certificate exception, or
second password during the ordinary path. A failed direct-file attempt must
not disconnect or degrade the remote control UI. The first implementation must
not silently send file bytes through the control relay as a fallback.

## Decisions And Invariants In Force

- **Direct first.** The initial product investigation sends file bytes directly
  between browser and host. The deployed opaque relay remains signaling and
  control infrastructure, not a payload proxy.
- **WebRTC DataChannel leads.** It combines a browser-native endpoint, ICE path
  checks, DTLS authentication/encryption, SCTP reliability, congestion control,
  and bidirectional binary messages without requiring audio or video tracks.
- **Signaling stays inside the authenticated circuit.** SDP, ICE candidates,
  DTLS fingerprints, protocol negotiation, and transfer grants are typed and
  bounded messages protected by the existing owner-authenticated channel. No
  new unauthenticated signaling endpoint is introduced.
- **The host embeds the other peer.** Desktop and headless builds
  contain a Rust WebRTC endpoint when compiled with the feature. A hidden
  desktop WebView, browser extension, companion daemon, and Google libwebrtc
  process are not the selected architecture.
- **Compilation and activation are separate.** Tactical `196` accepts the
  measured package cost and compiles the endpoint by default in desktop and
  configured-headless leaf products. Compilation does not bind UDP, enumerate
  interfaces, contact STUN, create a mapping, generate continuing traffic, or
  retain a background task. Runtime work begins only for an authorized file
  request and ends observably.
- **Runtime direct transfer defaults on with a kill switch.** Enabling remote
  access permits an explicit remote Save action to attempt a direct path. The
  operator can disable direct file
  transfers independently; disable cancels and joins active peers without
  disabling ordinary remote control.
- **No unencrypted hole.** UPnP or an IPv6 firewall pinhole may make a UDP
  candidate reachable, but every accepted file byte still travels through the
  endpoint-authenticated DTLS transport. RSTorrent must never publish a plain
  HTTP media listener through a gateway mapping.
- **Existing file authority remains final.** A transport grant names an opaque
  registry entry, never a path. It cannot browse directories, read neighboring
  files, widen a range beyond one logical file, or serve unverified content.
- **No TURN is planned.** NATs that cannot establish a direct candidate pair
  produce a clear unavailable result. Tactical `196` supplies no TURN URL,
  credential, allocation, or relayed candidate and rejects silent byte-relay
  fallback. Any future reversal requires a separate explicit product, privacy,
  abuse, availability, and operating-cost decision.
- **One public STUN service starts the product path.** Tactical `196` selects
  only `stun:stun.cloudflare.com:3478`, which Cloudflare documents as free and
  unlimited. It is contacted lazily by an authenticated file request, learns
  public endpoint/timing metadata but no file or account identity, and cannot
  relay payload. Outage degrades to other direct candidates or a truthful
  unavailable result.
- **No new mobile-host claim.** The first investigation targets the desktop
  and configured headless hosts that already implement remote access. Android
  and iOS hosting, background policy, and platform file presentation remain
  separate.

## Leading WebRTC Shape

WebRTC DataChannels carry SCTP over DTLS over ICE/UDP. That supplies NAT
traversal, confidentiality, endpoint authentication, integrity, reliable or
partially reliable messages, and multiple logical streams independently of
audio/video media. RSTorrent needs the data transport stack, not capture,
rendering, codecs, RTP media tracks, transcoding, or an SFU.

```text
remote React page                     native RSTorrent host
-----------------                     ----------------------
authenticated remote application circuit through opaque relay
    |                                        |
    +-- offer/answer, ICE, fingerprint ------+
    +-- file capability and cancellation ----+

browser RTCPeerConnection             optional Rust WebRTC peer
    |                                        |
    +======= direct ICE/DTLS/SCTP ===========+
                 DataChannel
                                               |
                                    bounded range protocol
                                               |
                                    media capability lease
                                               |
                             verified/active logical-file reader
```

The DTLS certificate should be ephemeral to the direct-peer generation. Its
fingerprint is authenticated by the existing encrypted host/browser circuit;
it is not a second user-entered pin and does not replace the durable RSTorrent
host identity. A new or resumed authorized browser already knows which host it
is controlling before direct negotiation begins.

### Candidate paths

The host and browser should let ICE validate and select among a bounded set of
eligible paths:

1. same-LAN interface candidates;
2. directly reachable public IPv6 candidates;
3. STUN-derived server-reflexive IPv4 or IPv6 candidates and ordinary UDP hole
   punching;
4. a short-lived explicitly advertised UDP mapping created through UPnP IGD v2
   when the library permits it; and
5. a short-lived IPv6 firewall pinhole where the platform, gateway, and
   selected candidate require one.

The existing session reachability code already implements supervised UPnP IGD
v2 TCP/UDP mappings and IPv6 firewall pinholes for the BitTorrent peer
listeners. A future tactical may extract and reuse its deterministic discovery
and gateway protocol components. The direct-file owner must still have its own
ephemeral UDP socket, lease, renewal, generation, cleanup, and audit state. It
must not borrow the torrent peer port or mutate the peer listener's advertised
endpoint.

STUN is rendezvous metadata, not a payload proxy. Its operator can observe the
source address and timing of binding traffic. The authenticated remote browser
also necessarily learns the selected host candidate address. Candidate
disclosure therefore happens only after owner authentication, stays bounded,
and is never copied into ordinary persistent logs. Without TURN, symmetric
NAT, restrictive enterprise filtering, or incompatible UDP policy will remain
honest expected failures.

## Transport Options

| Option | Useful property | Principal limitation | Current posture |
| --- | --- | --- | --- |
| Existing direct HTTPS media route | Preserves native browser `GET`, `HEAD`, Range, download, and media behavior with no new file protocol. | Requires the browser to reach a correctly authenticated HTTPS host origin. It does not discover or traverse arbitrary NAT by itself. | Keep for LAN, private-host, and accepted overlay deployments; use immediately when already reachable. |
| WebRTC DataChannel | Browser-native direct path with ICE checks and fingerprint-authenticated DTLS; needs no media codecs. | Native host must embed ICE, DTLS, SCTP, SDP, UDP, timers, and congestion/backpressure machinery. Some NATs still require TURN. | Leading general investigation. |
| WebTransport over HTTP/3 | Native bidirectional streams and browser-supported certificate hashes could fit the range protocol cleanly. | Supplies no ICE candidate discovery or connectivity checks itself; still needs a reachable UDP endpoint, mapping/public address, and uneven browser support must be proved. | Retain as a focused comparison, especially for public IPv6 or mapped UDP. |
| Per-host DNS plus WebPKI HTTPS | Gives the browser a real URL and keeps the existing HTTP range path. | Requires dynamic DNS, certificate issuance/renewal, inbound reachability, key recovery, and a safely exposed HTTPS listener. A shared wildcard private key must never be distributed to hosts. | Possible later operator/product service; not the first zero-configuration path. |
| User-managed overlay or reverse proxy | Mature connectivity, DNS, TLS, and ordinary HTTP semantics. | Requires installation or network administration and may route through another provider. It is not universal owner UX. | Existing explicit operator mode, not a replacement for direct discovery. |
| TURN or an E2E file relay | Reaches many networks that direct ICE cannot. TURN retains WebRTC endpoint encryption. | Every byte is proxied, creating bandwidth, abuse, availability, and operating-cost obligations. The current control relay is not sized or authorized for it. | Separate opt-in fallback investigation after direct evidence. |
| Binary file records over the current opaque relay | Reuses the established authenticated circuit and works wherever remote control works. | Couples bulk data to control fairness, proxies all bytes, expands relay abuse/cost, and violates the direct-first goal. | Explicit non-goal for the first implementation. |

Plain mapped HTTP is not an option. An unencrypted UPnP opening would expose a
bearer URL and file traffic to active network attackers, conflict with the
HTTPS remote page, and make router state part of file authority.

## Rust Dependency Investigation

The browser supplies its WebRTC peer. The host still needs a conforming
implementation of ICE/STUN, UDP connectivity checks, SDP negotiation, DTLS,
SCTP/DataChannel, retransmission, timers, flow control, and shutdown. This is
substantial protocol code even when no audio/video feature is used; RSTorrent
must not implement that stack ad hoc.

The completed bake-off compared:

- **`webrtc-rs/webrtc`.** The current `0.20.x` line offers an async
  `PeerConnection` API over a Sans-I/O core, includes a Tokio runtime backend,
  and has direct DataChannel examples. It is likely the shortest route to a
  browser interoperability proof, but its resolved and linked media-related
  graph must be measured rather than assuming dead-code elimination makes it
  small.
- **`webrtc-rs/rtc`.** The lower Sans-I/O core may offer a narrower and more
  explicitly owned integration if the high-level driver is too large or
  difficult to supervise. It creates more socket, timer, and event-loop work
  for RSTorrent.
- **`str0m`.** Its `Rtc` value performs no networking, starts no threads or
  async tasks, and exposes network output, events, and timeouts to the caller.
  It supports DataChannels and fits RSTorrent's explicit-owner style, while its
  own documentation notes that peer-to-peer use receives less testing than its
  server/SFU use and that interface enumeration and TURN are caller concerns.

Google's C++ libwebrtc through FFI is not a baseline candidate. Its build,
binary, platform, unsafe-boundary, update, and codec/media surface are
disproportionate for a data-only first slice. Reconsider it only if pure-Rust
options fail recorded browser interoperability or correctness gates.

Tactical `195` records each crate's exact version/revision, transitive graph,
platform crypto providers, unsafe code and native-build requirements, license
and notice obligations, maintenance activity, published security posture, and
known browser interop issues. It imported no source or test fixture.

## Optional Compilation And Packaging

The intended Cargo shape is an additive, leaf-level feature provisionally
called `direct-file-webrtc`; the implementing tactical may refine the name.

- The WebRTC dependency graph is optional and must not enter engine, protocol,
  session, Android, iOS, relay, Wasm, or ordinary CLI artifacts merely because
  those crates share the workspace.
- A small runtime-independent direct-file frame codec may remain separate from
  the optional endpoint, but feature unification must not accidentally pull
  the endpoint into mobile or unrelated binaries.
- Desktop and headless package manifests propagate the feature deliberately.
  Release metadata and the application capability handshake report whether it
  was compiled.
- When absent, the remote UI receives a typed unsupported capability and does
  not offer a path that can fail only at click time.
- When present but runtime-disabled, the setting is visible and no endpoint is
  started. Compilation does not imply operator consent to interface discovery,
  STUN, or UPnP.
- CI must build and test both feature-off and feature-on graphs. The off build
  must prove that WebRTC and its unique crypto/SCTP dependencies are absent.

Tactical `196` promotes the endpoint into default desktop and
configured-headless compilation while preserving the library-optional feature,
explicit feature-off CI, and dependency-tree proof for excluded targets.
Runtime activation remains separate and lazy: compilation alone creates no
certificate, socket, candidate, task, DNS request, or STUN traffic.

### Tactical 195 measured result

Lower `rtc` 0.20.4 with Ring is the retained endpoint dependency. Its isolated
stripped probe added 926,528 bytes, versus 2,499,864 for `str0m` and 2,651,208
for high-level `webrtc`. In the representative macOS ARM64 product link it
adds 3,623,504 stripped bytes to headless and 3,557,672 stripped bytes to
desktop; gzip deltas are 1,603,848 and 1,590,738 bytes. The complete unsigned
desktop app archive grows 1,773,621 bytes (10.70%). The normal/build headless
graph grows from 233 to 315 packages and contains both existing AWS-LC and new
Ring crypto; builders select their provider explicitly.

Compiled-but-unused startup has zero endpoint tasks, UDP sockets, candidates,
STUN traffic, mappings, or queued bytes. The actual start path remains linked
through a dynamic lazy starter. Chromium 151 and Firefox 153 establish a
fingerprint-verified host-candidate path in about 224--229 ms, independently
verify four concurrent ranges and a complete 8-MiB OPFS stream at roughly
23.5--25.1 MiB/s, cancel promptly, and return to zero endpoint owners in
30--39 ms. Chromium also verifies a 64-MiB OPFS stream at 25.8 MiB/s with a
307,374-byte combined queue high water. Active Rust-process RSS rose about
5.2 MiB above each harness idle sample.

The original Playwright WebKit run supplied one remote candidate, selected no
pair, and reached the 20-second negotiation timeout with clean teardown. Two
post-completion reruns then reached `ready`, authenticated the DTLS fingerprint,
opened the DataChannel, and completed the exact concurrent-range corpus before
failing at OPFS startup. A minimal probe reproduces
`navigator.storage.getDirectory()` failure in Playwright's ordinary
non-persistent context and completes OPFS create/write/close in a persistent
context. This makes the earlier timeout an ICE reliability observation, not a
demonstrated lower-rtc/WebKit incompatibility. OPFS remains only a bounded test
sink, not a native Download/Open/Play route. Only completed verified files
were exercised; Tactical `196` stays completed-file-only until active verified
waiting and revocation are separately proved.

## Runtime Ownership And Cancellation

The landed ownership shape is:

```text
application/profile owner
  -> remote-access owner
       -> optional direct-file supervisor (created on first request)
            -> bounded browser-peer generations
                 -> UDP socket + ICE/DTLS/SCTP driver
                 -> bounded mDNS socket/driver
                 -> bounded file-request owners
                      -> media capability lease
                      -> verified completed-file range read
                      -> DataChannel backpressure
```

The default Save consumer negotiates v2: one reliable ordered control channel
and one reliable ordered bulk channel, one whole-file u64 range, cumulative
write-consumption credit and separately batched writes. A shared 8-MiB receive
budget can be divided among up to four arbitrary/overlapping range owners;
callers choose their windows when concurrent ranges are needed. The transport
ceiling is independently bounded at 8 MiB and admits 64 KiB through 2-ms RTT,
then a bounded bandwidth-delay-product allowance. Wire messages are <=16 KiB,
verified reads <=64 KiB and default sink batches 128 KiB. See
[Tactical 312](../tactical/312-reliable-credit-range-streams.md) for the exact
wire layout, limits, generation semantics, API options and measurements.

END/CANCELLED/ERROR follow data on bulk. RELEASED acknowledges owner join on
control; receivers require both barriers before recycling a reservation.
Cancellation rejects the caller promptly while accounting for already-sent
bytes until they drain. Stale credit does not extend inactivity; invalid future
consumption closes the peer. Browser payload, frame count, transient copies,
native preparation and transport queues each have independent bounds. The
8-MiB credit budget is not a promise about total browser/process RSS or the
separately bounded Blob destination. Saved content succeeds only after writer
close. Peer failure cancels and joins all range owners; automatic resume is
not implemented. The opaque version identifies capability generation, not a
payload digest.

The compatibility Save consumer uses one reliable ordered channel and one
sequential range request. Tactical 307 permits four 16-KiB chunks (64 KiB) of unacknowledged
payload per range, overlapping reads/delivery with browser writes while
preserving v1 frames and older consumers' per-chunk ACKs. The retained SCTP
stack does not expose RFC 8260 message interleaving, so chunk size is unchanged.
Only completed browser writes release producer credit, and RangeComplete waits
for final credit. The host accepts only forward ACKs at produced boundaries,
bounds the ACK mailbox to five entries, and rejects floods rather than dropping
credit. The existing 512-KiB application and transport ceilings still apply.

The browser separately caps pending receive frames at 16 and encoded bytes at
128 KiB, rejects oversized frames before conversion, and discards queued work
after failure or cancellation. One current payload copy and any Blob conversion
are additional bounded chunk allocations; these limits are not a ceiling on
the browser's internal SCTP buffers or process RSS. Saved content is committed
only by writer close. The 32-MiB Blob fallback remains intentionally separate.

Cancellation flows from file-request cancel, capability or authorization
revocation, direct-peer replacement, timeout, profile replacement,
remote-access disable, direct-transfer disable, circuit loss, and application
shutdown. The first product does not let a transfer outlive its authenticated
control circuit. Every task, read, capability lease, UDP or mDNS socket, and
queued byte terminates and joins before terminal cleanup is reported.

## File-Range Protocol

DataChannel is message-oriented, not an HTTP URL. The landed v2 binary protocol
preserves a narrow file contract:

- authenticate one file-scoped capability and negotiate the optional v2 dialect
  inside its DTLS peer, retaining legacy fallback;
- expose length and opaque capability generation without granting another file;
- accept monotonic, never-reused IDs and arbitrary half-open u64 byte ranges;
- reserve fixed range windows within shared receive credit, independently of
  wire/read/write batch sizes;
- carry exact DATA offsets and ordered END/CANCELLED/ERROR markers, plus a
  joined RELEASED acknowledgement;
- grant credit only after consumption, ignore stale absolute updates and reject
  future consumption or excess admission;
- provide bounded urgent/bulk fairness without claiming preemption of already
  transmitted ordered bytes; and
- preserve global/per-peer/per-capability read, queue, idle and revocation
  limits and the existing verified-reader storage-generation fencing.

Only completed verified files are qualified in this slice. MIME metadata,
active-file wait/demand, URL/media adapters and reconnect/resume semantics need
separately bounded consumer work and evidence.

The protocol never accepts a filesystem path, URL, HTTP header map, method
string, storage root, SAF identifier, or arbitrary application command. DTLS
protects transfer integrity in flight; only the existing torrent verification
authority decides whether source bytes may be emitted.

## Browser Consumption Is A Separate Gate

A DataChannel cannot be assigned directly to `<video src>`, an `<a download>`
navigation, the built-in PDF viewer, or another URL consumer. A transport proof
alone therefore does not complete remote file viewing. The browser adapter
must be selected and tested explicitly.

Candidate adapters are:

1. **Bounded Blob/object URL.** Simple for small complete images, documents,
   and downloads, but it buffers the entire file and is unacceptable as a
   general large-file path.
2. **Stream-to-file API.** Write a `ReadableStream` to a user-selected file
   where the browser exposes a suitable save-file API. This can bound memory
   but is not a portable assumption across every supported browser.
3. **Service-worker synthetic media route.** Intercept a same-origin ephemeral
   URL, translate `GET`/`HEAD`/Range fetches into page-owned DataChannel range
   requests, and return streaming responses. This most closely preserves the
   existing media-element contract, but worker/page lifetime, navigation,
   reload, multiple ranges, backpressure, cancellation, and browser-specific
   behavior are substantial gates.
4. **Media Source Extensions.** Feed selected audio/video containers to an
   embedded player. This may provide good playback control but is not a general
   file viewer and can require container parsing or segmentation that
   RSTorrent does not otherwise own.
5. **A real direct HTTPS URL.** When an already trusted direct gateway, overlay,
   or future DNS/TLS route is reachable, retain the existing media URL and let
   the browser perform native ranges, download, PDF, audio, and video handling.

The landed Save adapter chooses the stream-to-file API synchronously from the
user gesture when available and otherwise permits only the 32-MiB Blob path.
It never uses OPFS. Browser-independent sink tests prove incremental
write-before-ack and cancellation; real streaming-picker evidence remains a
qualification gate. A later Open/Play tactical must separately prove a
seeking media path in real Chromium, Firefox, and WebKit/Safari-shaped
environments before general viewing or playback support is claimed.

## Security, Privacy, And Audit

- Authenticate the ephemeral DTLS fingerprint, ICE credentials, protocol
  version, authorization ID, host ID, and direct-peer generation inside the
  existing encrypted control transcript. A relay-injected candidate or
  fingerprint must fail closed.
- Admit signaling only after full password login or successful authorized-
  browser resume. A routing name, browser label, candidate, source address, or
  DataChannel message never creates authority.
- Bound hostile SDP/candidate text, candidate count, addresses, mDNS names,
  connectivity checks, retransmission, SCTP streams, message sizes, queued
  bytes, and negotiation time before state growth.
- Expose no file capability, ICE password, DTLS key, exact private address, or
  file path in logs, diagnostics, URLs, support exports, or durable history.
- Record the selected route only as a useful class such as LAN, public IPv6,
  STUN-reflexive, or mapped UDP unless a transient local diagnostic view
  explicitly needs the exact endpoint.
- Surface each live direct peer in the existing remote security view with its
  verified browser authorization, start/last-active time, state, path class,
  active request count, bytes sent, and close action.
- Add bounded security events for negotiation started, connected, rejected,
  failed, revoked, idle-closed, mapping-cleanup uncertainty, and terminal
  shutdown. Persistent events should not include file names or exact ranges by
  default.
- Local individual/global authorization revocation, password-everywhere,
  passphrase change, remote disable, and profile recovery must close matching
  direct peers and revoke their file capabilities before reporting success.
- Do not add a second application-layer content cipher merely by habit. DTLS
  is end-to-end once its fingerprint is authenticated by the existing circuit;
  add another layer only if a concrete threat or implementation boundary
  requires it.

## Required Measurements Before A Dependency Or Default Decision

### Build and distribution

- exact `cargo tree -e features` delta for every candidate and crypto backend;
- stripped executable and compressed installer/archive deltas for macOS arm64,
  Windows x86_64, Linux x86_64, and Linux arm64 desktop/headless targets;
- duplicate TLS, crypto, SCTP, RTP/SRTP, and native-library contribution;
- confirmation that feature-off Android, iOS, relay, Wasm, CLI, and engine
  artifacts are unchanged; and
- license/notice and vulnerability-audit delta for each packaged graph.

### Idle and active runtime

- zero WebRTC tasks, UDP sockets, candidate enumeration, STUN requests, UPnP
  leases, and continuing memory after startup when no direct request exists;
- first-start latency and peak/steady RSS, allocations, task count, socket
  count, queue high water, mapping lifetime, and complete teardown residue;
- large-file throughput, CPU, retransmission, loss behavior, cancellation
  latency, fairness beside torrent traffic, and several concurrent range
  requests; and
- application control responsiveness while a direct transfer is saturated.

### Connectivity and browser behavior

- same-host and same-LAN paths;
- direct public IPv6, ordinary STUN hole punching, UPnP-mapped UDP, restrictive
  NAT failure, firewall denial, interface change, sleep/wake, and route change;
- no-TURN failure classification and success rate across representative home,
  cellular, guest, VPN, CGNAT, and enterprise networks;
- current Chromium, Firefox, and WebKit/Safari offer/answer, trickle ICE,
  DataChannel, message-size, backpressure, restart, and close behavior; and
- complete and active-file head/tail probe, seek, overlap, abandonment,
  publication handoff, revocation, and shutdown through the chosen browser
  adapter.

The release-default decision should be made from this recorded evidence. A
small dependency alone does not justify enabling a fragile or low-success
feature, and a larger dependency may still be justified if it is reliable,
lazy, maintainable, and materially improves remote use.

## Recommended Investigation Sequence

When implementation is authorized, create one bounded tactical before changing
dependencies or code. It should proceed in these stages with explicit stop/go
evidence:

1. Re-read the current WebRTC, ICE, DataChannel, security, and browser contracts;
   pin candidate library sources and licenses; inspect their exact DataChannel
   tests and examples.
2. Build isolated release examples for `webrtc-rs/webrtc`, its lower Sans-I/O
   core if practical, and `str0m`; connect a real browser over loopback and LAN;
   measure stripped/package graph deltas before integrating any candidate.
3. Select one candidate provisionally and prove a lazy supervised endpoint,
   authenticated fingerprint signaling, direct DataChannel echo, cancellation,
   and zero idle residue through the real remote circuit.
4. Define and fuzz the bounded range codec, then reuse the existing media
   capability lease for completed and active verified files.
5. Compare browser consumption adapters and prove bounded download plus seeking
   playback without whole-file buffering.
6. Add STUN, public IPv6, and optionally separate short-lived UPnP UDP/pinhole
   candidates; retain direct-only truthful failure when no pair succeeds.
7. Run packaged platform, browser, network, audit, revocation, resource, and
   shutdown evidence before deciding whether any release enables the Cargo
   feature or runtime setting by default.

Do not begin with TURN, public DNS automation, wildcard certificates, media
relay capacity, Android hosting, transcoding, or a stable public wire promise.
Those choices can be evaluated independently after the direct path has real
cost and success-rate evidence.

## Open Decisions

- How reliable are repeated ICE negotiations in branded Safari and physical
  mobile browsers after Playwright WebKit's corrected transport pass?
- Is UPnP mapping attempted automatically after an authenticated request,
  separately opted in, or omitted from the first product slice?
- Which later browser adapters provide portable large-file saving and
  Open/Play/seek behavior without OPFS, unbounded memory, or container-specific
  code?
- When should Android or iOS act as a remote controller or host, if ever?

## Deliberate Non-Goals

- Replacing the authenticated application WebSocket or sending control frames
  through WebRTC.
- Serving arbitrary host files, directories, storage roots, or unverified
  torrent bytes.
- Publishing the existing loopback HTTP listener through UPnP or exposing an
  unauthenticated LAN/public file server.
- Bundling camera, microphone, capture, codec, transcoding, SFU, RTP
  media-track or screen-control functionality in the host. Browser MP4
  demux/remux and rendering are separately accepted in Tactical 313.
- Sharing a wildcard TLS private key among RSTorrent hosts.
- Claiming that WebRTC always establishes a direct path without TURN.
- Enabling, deploying, or supporting a new feature merely because this design
  topic exists.

## Primary External References

- [RFC 8831, WebRTC Data Channels](https://www.rfc-editor.org/rfc/rfc8831.html)
  defines SCTP over DTLS over ICE/UDP, reliable and partially reliable data
  transfer, multiplexed streams, congestion control, and the file-transfer use
  case.
- [RFC 8445, Interactive Connectivity Establishment](https://www.rfc-editor.org/rfc/rfc8445.html)
  defines host, server-reflexive, peer-reflexive, and relayed candidates plus
  connectivity checks and candidate lifecycle.
- [RFC 8489, Session Traversal Utilities for NAT](https://www.rfc-editor.org/rfc/rfc8489.html)
  defines STUN binding transactions, retransmission, response validation, and
  security behavior.
- The [W3C WebRTC Recommendation](https://www.w3.org/TR/webrtc/) defines the
  browser `RTCPeerConnection` and `RTCDataChannel` API surface.
- The [W3C WebTransport specification](https://www.w3.org/TR/webtransport/)
  defines browser streams/datagrams and optional server certificate hashes;
  it remains an alternative investigation rather than an accepted transport.
- The [W3C Service Workers specification](https://www.w3.org/TR/service-workers/)
  defines intercepted fetch and synthetic response behavior relevant to a
  possible same-origin range adapter.
- [`webrtc-rs/webrtc`](https://github.com/webrtc-rs/webrtc) and
  [`webrtc-rs/rtc`](https://github.com/webrtc-rs/rtc) are the async and Sans-I/O
  pure-Rust candidates observed during the 2026-08-30 survey.
- [`str0m`](https://github.com/algesten/str0m) is the alternative Sans-I/O Rust
  candidate observed during the same survey.
- Cloudflare's official
  [Realtime TURN FAQ](https://developers.cloudflare.com/realtime/turn/faq/)
  documents `stun.cloudflare.com` as a free unlimited STUN service. Tactical
  `196` selects only that unauthenticated STUN endpoint, not Cloudflare TURN.

No external source, fixture, or test data has been copied into RSTorrent.
