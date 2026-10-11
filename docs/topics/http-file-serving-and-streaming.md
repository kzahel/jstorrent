# HTTP File Serving And Future Streaming

Remote completed-file MP4 playback now uses the separate authenticated
DataChannel consumer in [313](../tactical/313-completed-remote-video-playback.md),
not this loopback HTTP listener. Its browser Source performs byte-range reads,
and playsvideo remuxes to HLS/MSE. Local Open, Android playback and progressive
HTTP authority remain unchanged; general remote Open is still unavailable.

Topic: `http-file-serving-and-streaming`

Status: Implemented on 2026-08-11 through completed Tacticals
[`138`](../tactical/138-verified-http-file-serving.md) and
[`139`](../tactical/139-incomplete-file-streaming-demand.md). Bounded
capabilities now serve both published files and eligible active incomplete
files through verified-only progressive HTTP reads. Completed Tactical
[`202`](../tactical/202-android-progressive-media-playback.md) now composes the
same listener and router into Android on first playback use.

## Purpose And Scope

RSTorrent lets an authorized client hand a browser, media element, media
player, or ordinary HTTP client a URL for one torrent file. Published content
uses the immutable verified reader. Eligible active incomplete content adds
bounded transient demand, waits for exact piece verification, and reads only
through the live generation-fenced storage owner.

This topic owns:

- the relationship between logical torrent-file reads, HTTP byte ranges, and
  torrent scheduling;
- listener and port selection for browser-hosted and in-process clients;
- per-file capability authorization and its relationship to existing host
  authentication;
- verified-only response, storage, lifecycle, cancellation, and resource
  invariants;
- incomplete-file demand, verification waits, and publication handoff without
  changing the HTTP identity model; and
- the required separation between local media serving and future remote owner
  access.

[`application-connection-architecture.md`](application-connection-architecture.md)
continues to own typed application calls, WebSocket and Tauri adapters, and
authenticated client context. [`application-control.md`](application-control.md)
owns the semantic operation that may create or revoke a file URL.
[`storage-throughput-architecture.md`](storage-throughput-architecture.md) and
[`android-saf-storage.md`](android-saf-storage.md) own the path/SAF storage and
bounded file-acquisition mechanisms beneath logical reads.
[`remote-access-authentication.md`](remote-access-authentication.md) owns any
future nonlocal principal, encryption, relay, or device-authentication design.
[`direct-remote-file-streaming.md`](direct-remote-file-streaming.md) owns the
proposed optional browser-to-host byte transport, direct-path discovery,
browser range adapter, packaging cost, and audit above this unchanged file
authority.

HTTP file serving is not an application-control side channel. The listener
does not accept torrent commands, expose views, browse storage roots, or make
filesystem paths authoritative. It serves bytes only after an authenticated
application client has created a narrowly scoped capability.

## Reference Findings

Rasterbar libtorrent supplies torrent-side streaming primitives rather than an
HTTP file server. Its `torrent_handle::read_piece()` asynchronously reads a
completed piece, `have_piece()` reports completion, and
`set_piece_deadline()` drives time-critical piece acquisition. Its streaming
design explains why deadline-driven requests across suitable peers are more
appropriate than merely enabling sequential download:

- pinned `reference/libtorrent/include/libtorrent/torrent_handle.hpp`,
  `read_piece`, `have_piece`, `set_piece_deadline`,
  `reset_piece_deadline`, and `clear_piece_deadlines`; and
- pinned `reference/libtorrent/docs/streaming.rst`, especially streaming
  versus sequential download, time-critical piece picking, queue-time
  estimation, and adaptive request duplication.

Libtorrent's web-seed support is the inverse role: libtorrent acts as an HTTP
client fetching torrent content. It does not expose downloaded files to media
players. An embedding product must map file byte ranges to pieces, wait for
verification, read storage, and implement HTTP itself.

The local JSTorrent reference implements that product layer explicitly:

- `desktop/io-daemon/src/media.rs` registers opaque stream tokens, serves
  `GET`/`HEAD`, implements HTTP ranges, and emits bounded response chunks;
- `packages/engine/src/core/streaming-scheduler.ts` merges tokenized transient
  demand without rewriting durable Skip selection;
- `packages/engine/src/node-io-daemon/engine-http-stream-bridge.ts` binds a
  stream session to one torrent/file and waits for requested verified ranges;
- `packages/engine/src/streaming/streaming-playback-session.ts` owns playhead
  current/ahead demand and cancellation; and
- `packages/engine/src/node-io-daemon/daemon-runtime.ts` performs progressive
  wait-then-read response fulfillment.

Adopt the separation among HTTP response ownership, stream-session demand,
and torrent scheduling. Do not inherit JSTorrent's companion-daemon topology:
RSTorrent's first-party clients normally run the Rust engine in-process.

RSTorrent now has a reusable verified logical-file reader in
`crates/rstorrent-engine/src/seed_content.rs` alongside conservative peer-
upload reads and internal selective-storage ranges. The reader observes the
published path or platform representation, checks exact kind and length,
confines reads to one logical file, and uses the shared bounded file pool. The
application and HTTP layers refer to that reader rather than routing arbitrary
paths around storage ownership.

No source, fixture, or test data is imported from either reference.

Completed Tactical
[`176`](../tactical/176-durable-high-file-priority.md) confirms the same
separation for durable file priority. High affects only ordinary weighted
rarest-first activation; current and ahead streaming demand remains the
stronger transient owner with its existing preemption, peer-capacity,
duplicate, and cleanup bounds. Streaming is therefore not represented as an
extra persistent priority level.

## Accepted Architecture

### One logical service, two hosting modes

The same bounded media router has two deployment modes:

1. **Existing HTTP gateway.** When the product already hosts an HTTP gateway,
   mount `/media/v1/<capability>` on that listener. Browser-hosted and private
   deployments therefore retain one address, port, origin, TLS termination,
   process lifetime, and graceful-shutdown owner.
2. **In-process client without an HTTP gateway.** A client such as Tauri or
   Android may start one media-only listener on `127.0.0.1:0`. Port `0` asks
   the operating system for an available ephemeral port. This is a narrow
   byte-serving exception to the ordinary no-application-socket posture, not
   a reason to expose the application API over loopback. Android starts its
   listener lazily on the first accepted media-URL request and retains it until
   joined application shutdown.

The service must not multiplex HTTP onto the BitTorrent peer listener. It must
not introduce a native host, IO daemon, companion process, or filesystem
proxy. Platform lifecycle integration requires its own bounded evidence before
support is claimed. Android is now qualified by Tactical `202`; other
platforms retain that requirement.

### Port policy

- There is no permanent or reserved default RSTorrent media port.
- Reuse the configured gateway port when a gateway exists.
- Otherwise bind exact IPv4 loopback with an OS-assigned port.
- Do not probe, scan, increment, or fall back across candidate ports.
- Do not persist an ephemeral port. A new process generation may receive a
  new value and invalidates every prior URL.
- Return the complete URL from the authorized semantic operation; clients do
  not derive or discover it from a conventional port.
- A later explicit fixed-loopback-port option for controlled automation may be
  considered separately. An unavailable explicit port fails rather than
  silently choosing another value.
- LAN, wildcard, multicast, public, UPnP-mapped, or relay exposure is not
  implied by local serving.

### Authority chain

```text
authenticated application client
  -> create capability for profile generation + torrent + file
  -> bounded in-memory capability registry
  -> GET/HEAD /media/v1/<capability>
  -> verified logical-file range reader
  -> path or SAF storage owner
```

The HTTP request contains no storage-root locator or relative filesystem path.
Torrent identity and file index remain registry state rather than URL fields.
The storage boundary maps logical file offsets to its currently authoritative
published or managed representation.

## Authentication And Authorization

### Every URL is a file-scoped capability

An already authenticated application client explicitly requests a URL for one
torrent file. The returned path contains an opaque bearer capability with at
least 128 bits of cryptographically random entropy.

Each registry entry is:

- bound to one application/profile generation, torrent identity, and file
  index;
- retained only in memory and never included in durable state or request
  receipts;
- reusable for the multiple `HEAD` and `GET` requests, reconnects, probes, and
  seeks a normal media player performs;
- subject to finite idle and absolute lifetimes;
- bounded in count globally/per profile and in simultaneous requests per
  capability;
- revocable explicitly and automatically on torrent removal, profile close,
  service replacement, or application shutdown; and
- compared and handled without placing its value in diagnostics, access logs,
  generated assets, telemetry, crash context, or normal application state.

A capability is not a durable share link. Restart changes the port and server
generation and invalidates it. Missing, malformed, expired, revoked, or
mismatched capabilities all return the same `404` response without revealing
whether a torrent, file, or profile exists.

The capability is required even on loopback. A media element or external
player cannot reliably attach the application connection's bearer header, and
an unauthenticated localhost URL would permit drive-by requests from unrelated
web pages or local callers.

### Relationship to host authentication

- An exact-loopback media-only listener may treat the unguessable file
  capability as its request credential. It accepts no capability-creation
  operation and exposes no route that can enumerate content.
- A loopback application gateway may exempt only the capability media route
  from an application bearer header when direct media clients cannot supply
  it. The route remains exact-loopback, capability-required, method-limited,
  non-CORS, and outside the semantic application API.
- A hosted/private gateway requires both its existing HTTPS/Basic boundary and
  the file capability. Basic credentials must not be copied into a URL.
- Any future remote or relay mode additionally requires the principal,
  authenticated encryption, host identity, and authorization selected by the
  remote-access topic. A capability alone must never authorize a nonloopback
  listener.

Origin checking is useful for application connections but is not sufficient
for media bytes: nonbrowser players may send no `Origin`, and browsers can
initiate cross-origin media requests. Host validation, exact binding, and the
unguessable capability are the local media authority.

## Base Verified-File Contract

The base implementation exposes only verified readable content. A successful
response never contains bytes merely received, written, cached, sparse, or
present on disk without the engine's integrity authority.

The first HTTP contract is deliberately narrow:

- `HEAD` and `GET` only;
- a complete representation or one RFC-compatible byte range;
- `200`, `206`, exact `Content-Length`, `Content-Range`, and
  `Accept-Ranges: bytes` behavior;
- deterministic rejection of malformed, multiple, or unsatisfiable ranges;
- bounded response chunks, bounded concurrent reads, transport backpressure,
  and cancellation when the consumer disconnects;
- `Cache-Control: private, no-store` and `Referrer-Policy: no-referrer`;
- no directory listing, path resolution, write method, upload, archive, or
  content mutation;
- no permissive CORS; and
- a truthful bounded MIME type derived from the logical filename, falling back
  to `application/octet-stream` without content probing.

Creating or reading a URL does not start, resume, restore, relocate, unskip,
repair, recheck, or otherwise mutate a torrent. Tactical `138` accepts a
non-padding published file when every intersecting piece is verified; the
whole torrent need not be complete. Paused and archived content remains
readable, current Skip selection does not invalidate already authoritative
bytes, and active/staging, checking, removing, incomplete, errored, or
unavailable-root content does not qualify. The rule is typed and visible to
the caller and rechecked at capability creation rather than inferred from an
HTTP failure.

Path-backed and SAF-backed content must share logical semantics. The server
cannot assume a stable path or lend a path to the client. Symlink, replacement,
length, generation, grant-loss, and dynamic-handle behavior stay behind the
existing storage authorities.

## Implemented Incomplete-File Streaming

Incomplete streaming extends the verified reader; it does not weaken it. An
HTTP request for an absent range registers bounded transient demand, waits
until all intersecting pieces are hash verified, and only then reads and emits
the bytes. Completed Tactical
[`139`](../tactical/139-incomplete-file-streaming-demand.md) records the exact
implementation, bounds, source review, controlled wire evidence, and platform
gates.

The stream-session owner must:

- map logical file byte ranges to exact piece and boundary-file geometry;
- represent current and bounded look-ahead demand independently from durable
  High/Normal/Skip file selection and ordinary picker policy;
- prioritize time-critical pieces using measured peer capacity and deadlines,
  not only a global sequential-download switch;
- support initial probes near both the start and end of a media file;
- replace obsolete demand after a seek and cancel waits after disconnect;
- arbitrate several request generations and concurrent streams within explicit
  torrent/session bounds;
- retain ordinary integrity, retry, corruption attribution, storage pressure,
  and peer resource limits;
- reject skipped, paused, archived, removing, errored, unavailable-root, or
  otherwise ineligible content through typed policy rather than implicitly
  rewriting user intent; and
- join every wait and remove every temporary scheduling overlay when the HTTP
  body, capability, torrent, profile, or application terminates.

Players commonly open more than one range, seek, probe container metadata at
the tail, and abandon responses. Tactical `139` therefore requires scripted
HTTP clients and real player-shaped traces; completing pieces in monotonically
increasing order is not sufficient evidence.

## Ownership And Cancellation

```text
application/profile owner
  -> optional media server
       -> listener accept owner
       -> bounded capability registry
       -> bounded HTTP request owners
            -> verified logical-range read
            -> stream-demand lease + verified-range wait
  -> profile/torrent/storage generation authorities
  -> shutdown
       -> stop accepts
       -> revoke capabilities
       -> cancel requests and demand leases
       -> join reads/waits
       -> join listener
```

An HTTP response must capture and revalidate the relevant profile, torrent,
file, storage, and stream generations. Late completion from a replaced owner
cannot emit bytes for a newer capability or storage generation.

## Security And Privacy Invariants

- Treat method, headers, range syntax, host, and capability text as hostile and
  bound them before parsing or allocation.
- Never serve unverified bytes or infer verification from file existence.
- Never reveal arbitrary filesystem paths, root locators, SAF document IDs,
  tracker credentials, private source parameters, or neighboring torrent
  content.
- Prevent traversal by design: URLs name an opaque registry entry, not a path.
- Do not log capability values, authorization headers, or query strings.
- A response is scoped to one logical file even when storage pieces cross file
  boundaries.
- Exact loopback HTTP is acceptable for the ephemeral local capability. Every
  nonloopback deployment requires authenticated HTTPS plus the independently
  reviewed remote authorization boundary.
- Port mapping and peer reachability never publish the media listener.
- Shutdown and revocation are observable and terminal; an abandoned body
  cannot retain storage handles or scheduling priority indefinitely.

## Evidence Record

The verified-serving evidence includes:

- pure range parsing for complete, open-ended, suffix, malformed, overflow,
  multiple, empty, and unsatisfiable inputs;
- exact `HEAD`, full `GET`, and partial `GET` response evidence;
- invalid/expired/revoked/cross-file capability indistinguishability;
- token redaction and host/bind/authentication tests;
- path and platform-storage logical reads, replacement races, root loss,
  disconnect cancellation, torrent removal, profile replacement, and shutdown;
- bounded slow-reader, abandoned-body, concurrent-session, large-file, and
  descriptor/read high-water evidence;
- browser media-element and ordinary external HTTP client interoperability;
  and
- unchanged workspace, adapters, hosted gateway, Tauri, and proportional
  Android build evidence.

Tactical `139` adds passing deterministic seek/probe/look-ahead traces,
piece-boundary and padding fixtures, corruption and retry, stalled peers,
storage pressure, several concurrent streams, exact hash verification, and
controlled libtorrent scheduling comparison. Public swarms are optional and
cannot substitute for deterministic ownership evidence.

## Deliberate Non-Goals

- An arbitrary filesystem server, directory browser, WebDAV endpoint, static
  payload-root mount, or path-bearing application API.
- A separate daemon, native host, companion server, REST control plane, or
  socket proxy.
- Public/LAN exposure, UPnP media mapping, stable share links, friend sharing,
  relay delivery, accounts, or multi-user authorization.
- Transcoding, remuxing, thumbnails, codecs, playback UI, media metadata
  enrichment, subtitles policy, or container probing.
- Serving unverified sparse bytes, implicit torrent lifecycle changes, or
  persistent streaming priority.
- Multipart ranges, uploads, writes, or general HTTP compatibility beyond the
  bounded media contract unless later evidence requires them.

## Implemented Contract And Evidence

Completed Tactical `138` added typed file-view eligibility plus one ephemeral
`create_media_url` application call. The application owns at most 128
memory-only 256-bit file capabilities with 30-minute idle and 24-hour absolute
lifetimes. The shared router admits at most 16 bodies globally, four per
capability, and eight logical reads, prepares one 64-KiB chunk per response,
and uses the existing 40-handle storage pool. It implements exact full and
single-range `GET`/`HEAD`, deterministic `416`, bounded MIME mapping, security
headers, Host enforcement, cancellation, and revocation.

The existing gateway mounts the route under its authentication and hosting
policy. Tauri owns one media-only `127.0.0.1:0` listener and validates the
exact current URL before the system opener. React Files exposes `Open` only
for typed `available` rows; browser mode uses an opener-isolated new tab.
Completed Tactical `202` gives Android the same media-only listener on lazy
first use. Its private Media3 activity consumes the complete Rust-created URL,
while the existing completed-file `content://` **Open** path remains available.

Completed Tactical `139` adds `streamable` as a distinct typed eligibility
fact. Each active body owns one current interval and at most 4 MiB/16 pieces
of ahead demand, schedules current before ahead and ordinary rarest-first
work, may preempt only bounded untouched ordinary work, selects peers by a
two-second queue horizon with a safe slowest-decile filter, and permits one
adaptive duplicate on a different peer. The first 64-KiB chunk is verified
and read before successful headers; later chunks wait under the same
120-second progress bound. Completion hands the same URL and byte position to
the exact immutable publication.

The controlled pinned-libtorrent trace serves exact concurrent head, tail,
seek, and overlap ranges from an incomplete 393,549-byte multi-file fixture,
then completes one full active `GET` across publication. The serial workspace,
web generation/typecheck/unit/build/Playwright gates, Tauri tests and Clippy,
both Android native ABIs, and the API 34 AVD pass. The tactical execution
record contains the exact request ordering, latencies, high waters, commands,
and deliberate deferrals.

## Recommended Next Work

Stable sharing, remote exposure, embedded desktop playback, iOS progressive
presentation, subtitles, and transcoding remain independent product decisions.
The direct remote path
and its browser presentation investigation now live in
[`direct-remote-file-streaming.md`](direct-remote-file-streaming.md). A future
embedded player may provide real presentation deadlines through the existing
bounded demand seam; byte offsets alone remain insufficient to invent them.
