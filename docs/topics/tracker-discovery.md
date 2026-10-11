# Tracker Discovery

Topic: `tracker-discovery`

Status: Tactical `014` replaced the first one-shot operation with a supervised
scheduled UDP tracker lifecycle. Tactical `021` added bounded concurrent
startup operations and classified the remaining live failure at content-peer
admission rather than tracker intake. Tactical `043` makes the deterministic
schedule's retained lifecycle the authoritative inspectable state and proves
it through the live browser surface. Tactical `081` adds persisted BEP 12
metainfo tiers and source attribution. UDP rows enter the existing runtime;
HTTP/HTTPS rows originally remained truthfully visible unsupported
configuration. Completed Tactical
[`092`](../tactical/092-truthful-tracker-and-dht-peer-advertisement.md) moves
application tracker ownership into the long-lived session/torrent lifetime,
supplies its actual selected or explicit outbound-only port, exact current
counters, and completed/stopped lifecycle. Completed Tactical
[`095`](../tactical/095-bounded-http-https-tracker-transport.md) now runs HTTP
and encrypted-but-unauthenticated HTTPS through that same owner, including
IPv4/IPv6 tracker connectivity and IPv6 peer discovery. Completed Tactical
[`098`](../tactical/098-authenticated-https-tracker-platform-trust.md) now
defaults HTTPS trackers to certificate-chain and requested-name validation
through desktop and Android platform trust. One persisted hidden `disabled`
compatibility policy remains explicitly encrypted but unauthenticated; live
changes replace the one bounded family client pair through Tactical `097`'s
stable session-network machinery.
Completed Tactical
[`115`](../tactical/115-mse-policy-advertisement-and-peer-detail.md) adds the
legacy HTTP `supportcrypto=1` capability hint whenever the effective policy
accepts incoming MSE. `disabled` omits it, UDP trackers remain unchanged, and
a live policy change requests one corrective update through the existing
advertisement owner rather than replacing a torrent registration.
Completed Tactical
[`112`](../tactical/112-dual-stack-transport-and-ipv6-dht.md) makes the
advertised endpoint and transport source family-selected. An eligible IPv6
operation binds the probe-selected global-unicast source and advertises that
family's real TCP listener port; an ineligible or disabled family retains
port `1`. This changes no tracker schedule, fan-out, or operation bound.
Closed evidence-limited Tactical
[`113`](../tactical/113-ipv6-firewall-pinhole-and-incoming-reachability.md)
refines that producer-owned IPv6 endpoint with `GlobalUnicast`, `Unfiltered`,
or `Pinholed` evidence while preserving the same listener-backed wire port in
all three cases. Tracker owners consume only the selected endpoint and do not
own or infer gateway state. Scripted coverage passes; off-LAN incoming IPv6
evidence remains pending.
Completed Tactical
[`156`](../tactical/156-hybrid-dual-swarm-runtime-closure.md) lets one central
torrent advertisement registration carry one or two fixed versioned lanes. A
strict hybrid announces its exact v1 key and truncated-v2 key independently
through the existing tier schedule and global operation ceiling; peer results
retain the lane into the common registry. Structured diagnostics record
versioned start/success/failure/retry/cancel phases. The controlled hybrid
tracker observed one exact announce per key and completed through the returned
uTP seed without creating a second torrent or tracker manager.
Completed Tactical
[`140`](../tactical/140-incoming-utp-reachability.md) makes the endpoint source
transport-specific without changing tracker semantics. UDP, HTTP, and HTTPS
trackers still advertise the selected TCP peer-listener port, even when the
independently mapped IPv4 UDP/uTP port differs. The controlled tracker-only
case transfers over TCP and supplies the zero-uTP control for the DHT-only uTP
gate. Trackers do not claim discoverability of a distinct UDP peer port.
Completed Tactical
[`122`](../tactical/122-paired-public-download-performance-cohorts.md) exposed
one narrower integration boundary: the focused resumable download driver's
nested tracker manager dispatched only UDP. Completed Tactical
[`136`](../tactical/136-shared-tracker-operation-executor.md) closes that gap.
It preserves separate application and direct lifecycle owners while sharing
one task-free UDP/HTTP/HTTPS announce executor; the application continues
disabling the nested owner so product torrents do not announce twice. The
direct owner now retains HTTP tracker IDs, sends bounded completed/stopped
announces after successful content, and uses authenticated system trust for
HTTPS.

## Scope

This topic owns tracker URL values, announce inputs and results, tracker
operation lifecycle, retry and scheduling direction, tier policy, tracker
failure history, and the boundary from tracker results into peer
observations.

It does not own peer selection or connections, DHT, PEX, local discovery,
content scheduling, or application presentation. Trackers discover endpoints;
the peer registry remains the only owner of accumulated peer records.

## Vocabulary And Ownership

- A **tracker URL** is a bounded validated description of one tracker
  transport endpoint. It is not a peer endpoint.
- A **tracker announce** is one identified operation carrying torrent
  identity, client identity, transfer counters, event, listening port, key,
  requested peer count, and transport-specific compatibility hints. The HTTP
  MSE hint describes accepted incoming handshakes only; it is not a security
  or reachability claim.
- A **tracker response** is untrusted interval, optional swarm counts, peer
  endpoints, warning, and transport continuation data correlated to one
  announce operation. HTTP may return compact IPv4/IPv6 or noncompact peers;
  UDP retains its address-family-specific compact response.
- A **tracker record** retains URL, synthetic tier, source, failure history,
  announce state, interval, and next eligible monotonic time independently
  from any one in-flight operation.
- The **discovery advertisement service** owns retained tracker records,
  selection, token caching, retry/lifecycle deadlines, cancellation, and an
  eight-operation ceiling across long-lived application torrent generations.
  It has one session task rather than one task or timer per torrent.

## Accepted Direction

Tracker protocol values, binary codecs, URL authority validation, and schedule
transitions remain independent from Tokio, DNS, sockets, clocks, reqwest, and
random-number generation. The runtime supplies transaction IDs and the
announce key, resolves URLs, owns transport resources, enforces deadlines, and
translates accepted endpoints into `PeerObservation` values with
`PeerSource::Tracker`. Explicit enum dispatch shares lifecycle and outcomes
between UDP and HTTP(S); their sockets, token/ID continuation, framing, TLS,
and response mechanics remain cohesive transport-specific implementations
rather than a general trait or plugin framework.

Tracker failure and tracker exhaustion are mechanism outcomes, not necessarily
torrent errors. Application progress assessment must combine tracker status
with peer hints, scheduled retries, and other installed discovery mechanisms.
It may report externally blocked discovery only when none can still act
automatically. Bounded typed tracker events explain attempts and outcomes
without making formatted tracker log text application state.

Peer endpoints from a tracker are untrusted hints. Invalid endpoints are
discarded, duplicates merge through the registry, and a tracker does not
confirm reachability, peer identity, seed status, or integrity merely by
reporting an address.

UDP response correlation requires the expected remote endpoint, transaction
ID, action, minimum length, address-family stride, and peer-count bound.
Unrelated or stale transaction IDs are ignored within the operation deadline;
a malformed packet correlated to the active transaction fails that tracker
operation. Bounded tracker error text may be diagnostic context but never
application state or an allocation authority.

The application registers tracker state before peer selection or dialing and
retains it through download completion and ordinary seeding. Runtime policy is
checked before DNS when offline, after tracker resolution, on every compact
peer observation, and again before peer dialing. One successful response may
add several observations through the same long-lived peer registry used by
other discovery sources. Pause, archive, removal, generation replacement, and
session shutdown explicitly stop and join the registration. Focused direct
engine APIs retain their nested manager for standalone use, but application
driver configurations disable it so the product has only the session owner.
That nested manager supports UDP, HTTP, and authenticated HTTPS through the
same operation executor while retaining its independent schedule, join set,
result queue, and cancellation owner.

Magnet `tr` parameters do not encode BEP 12 tier structure, so retained UDP,
HTTP, and HTTPS trackers form one initially shuffled synthetic tier. Failure
falls through to another eligible record in the same round. After all records
fail, the manager waits for the earliest retry; each record remains eligible
indefinitely under the libtorrent-style quadratic delay
`5 + 12.5 * failures²` seconds, capped at 60 minutes. A valid response,
including a zero-peer response, ends the round, resets that record's failure
count, promotes it, and schedules an ordinary announce from its interval
clamped to five minutes through 24 hours.

Each UDP connect or announce exchange sends immediately, retransmits once
after 15 seconds of silence, and completes after an aggregate 30-second
deadline. Valid connection IDs are cached per remote endpoint for 60 seconds
in a bounded cache. A started event is repeated until acknowledged; later
successful announces use the ordinary event.

## Reference Direction

BEP 15 is normative for the connect and announce packet shapes, network byte
order, transaction correlation, compact IPv4/IPv6 response formats,
connection-token lifetime, and retransmission guidance.

Rasterbar libtorrent `v2.0.13` is the mature behavioral reference. It keeps
URL resolution and sockets outside the codec, rejects unexpected source,
transaction, action, and response stride, tries alternate resolved tracker
addresses, caches connection IDs for 60 seconds, and emits tracker results
through the ordinary peer-list path.

Current JSTorrent provides useful `TrackerManager`, `UdpTracker`, announce
statistics, and `peersDiscovered` vocabulary plus a practical local UDP
tracker fixture. Its current single transaction field, IPv4-only compact
parser, short-packet handling, and missing source check are not RSTorrent
requirements.

No reference source or fixture is copied. RSTorrent independently implements
the public wire behavior and constructs its own deterministic and controlled
interoperability evidence.

## Current Evidence

Tactical `011` established bounded tracker URL retention in both parsed and
SQLite-canonicalized magnets, pure connect/announce codecs, lazy runtime
operation ownership, and the tracker-observation boundary. Deterministic tests
cover URL and packet limits, two-tracker protocol failover, stale and
undersized datagrams, invalid and duplicate compact endpoints, peer dial
failover, explicit-hint precedence, and socket release on timeout and
cancellation.

Three controlled libtorrent `2.0.13.0` runs acquired a 26,686-byte,
two-block info dictionary and every hash-verified content piece from a
tracker-only magnet. The independent Python tracker observed exactly one
connect and one announce per run and all processes and artifacts terminated
cleanly. Android API-28 cross-builds passed for x86_64 and arm64-v8a; this
tactical did not claim a public tracker run or on-device networking evidence.

Tactical `013` retained the controlled loopback exchange while making the
policy choice explicit. Desktop and Android product adapters select `Online`;
engine/session diagnostics and the authenticated browser gateway select
`LoopbackOnly`. An opt-in Big Buck Bunny metadata probe reached a public UDP
tracker operation under online policy, then timed out waiting for that
tracker's connect response. This is evidence that policy no longer rejects
the public route, not evidence of a reachable public swarm.

Tactical `014` adds deterministic schedule tests for fallback, promotion,
quadratic and saturated retry delays, bounded success intervals, and correct
earliest-retry selection. Scripted UDP tests cover dropped connect and
announce requests, retransmission, token reuse and expiry, started-to-ordinary
events, zero-peer success, and cancellation with socket release. Three
controlled libtorrent `2.0.13.0` runs still acquired verified metadata and all
content from a tracker-only magnet with exactly one connect and one announce
per run.

The application now emits typed tracker attempt, retransmit, failure,
fallback, retry, reannounce, success, unusable-response, and peer-dial
diagnostics. Failure retry and successful reannounce are distinct facts. A
retained automatic action with no eligible peer projects as
`waiting/discovery/waiting_for_discovery`, not blocked. Headless Chrome over
the loopback gateway and an owned API 34 arm64 no-window AVD rendered the same
assessment and tracker-filtered timeline. The Android run also passed Activity
recreation/backgrounding and joined foreground shutdown.

A Tactical `018` tracker-only Big Buck Bunny rerun retained the complete
90-second timeline. It discovered no peers: two trackers timed out during UDP
connect, one hostname no longer resolved, and two trackers rejected the
announce because RSTorrent reported port zero. No dial, peer connection, or
BEP 9 request occurred. A follow-up made port `6881` an explicit provisional
announce input. The same headless smoke then received six tracker candidates
within 0.36 seconds and acquired hash-verified metadata in 11.41 seconds.
Ten immediate tracker-only repetitions completed 8/10 within the 90-second
bound. Successful acquisition had a 32.77-second median and 38.41-second mean,
with a 1.71–75.51-second range. Candidate counts ranged from 6 to 131 and did
not predict completion latency. Both timeouts had discovered and attempted six
peers, so they were not tracker-silence failures.

Pinned libtorrent `2.0.13.0` then completed the same metadata-only tracker
scenario 10/10 with a 20.94-second median and a narrow 20.81–21.49-second
range. Its alert timeline spent about 10 seconds apiece timing out against the
first two listed trackers, received 71 peers from the third, and verified
metadata 0.11 seconds later. This reference kept libtorrent's ordinary peer
concurrency while disabling DHT, LSD, PEX, incoming peers, uTP, and NAT
mapping; it is not yet an alternated paired result.

Port `6881` is a compatibility placeholder, not a reachability claim. Tactical
`078` later added one independently configured IPv4 loopback listener, but
tracker announces do not consume its actual port and no NAT mapping is
requested. The reachability campaign now requires an eligible non-loopback
listener and proven external mapping before public discovery consumes an
advertised endpoint. DHT therefore continues to omit `announce_peer` until
that ownership and reachability policy are implemented.

Tactical `020` then showed that a capable peer can reach Big Buck Bunny's 50%
milestone in 24--28 seconds, but the clean post-stall screen completed only
1/3. Its two misses retained only four or nine current tracker candidates and
two connections. The same paired libtorrent profile reached 50% with 16--22
peers. A renewed pinned-source audit found an omitted startup behavior:
libtorrent assigns magnet trackers distinct tiers, queues every
not-yet-working tier in the initial announce pass even with both announce-all
settings disabled, accepts every already-started reply, and invokes a bounded
30-peer connection boost. RSTorrent instead runs one operation and sleeps for
at least five minutes after the first valid response. Tactical `021` owns a
bounded initial fan-out while preserving RSTorrent's documented synthetic
tier and later promoted-tracker policy.

The first Tactical `021` checkpoint installs that bounded fan-out. Pure
tracker records now explicitly distinguish an in-flight update, and one
manager owns up to eight operations with per-record token caches and joined
cancellation. Scripted barriers prove true concurrency, the exact ceiling,
failure-driven admission beyond the ceiling, multi-response peer intake, and
socket release. Endpoint-free probe totals expose response batches, reported
peers, and dial attempts. The first clean live screen received two response
batches and retained 14--15 candidates in every run, versus four to nine
before fan-out. Its 0/3 50% result stopped at the downstream combined
live-plus-pending connection ceiling; tracker startup is no longer the
classified owner.

Tactical `043` extends those same pure tracker records instead of creating a
UI-side tracker authority. Immutable snapshots expose announcing, retry,
reannounce, and inactive lifecycle plus attempts, consecutive failures,
accepted interval and swarm counts, monotonic outcome ages, the next scheduled
action, and bounded error context. The runtime publishes typed snapshots after
every schedule transition and only publishes terminal inactive state after
its UDP operations have been aborted and joined. Diagnostics remain an
independent ordered observation stream.

Completed Tactical
[`300`](../tactical/300-monotonic-tracker-view-deadlines.md) repairs the
application inspection clock without changing that schedule or tracker wire
policy. The synchronous activity sink converts relative snapshot timings once
into application-monotonic deadlines/outcome instants. Leased batches expose
current application time, including replay; React anchors it to its own
monotonic clock per epoch. Unrelated traffic and reopened snapshots therefore
cannot restart an old wait. Deterministic projection/replay and real loopback
gateway/browser tests cover this boundary; Android shared bindings/build pass.

The leased application view retains at most the schedule's existing 32
tracker records. A durable magnet can reconstruct inactive configured rows
after restart, but volatile response and deadline history is deliberately not
persisted. A controlled delayed loopback announce let the live browser observe
the pre-response `announcing` state and then exact response values of one peer,
37 seeds, 11 leeches, and a 30-minute reannounce interval while libtorrent
seeded hash-verified content. This is tracker state and interoperability
evidence, not a claim that a response peer count is a cumulative unique-peer
count or that any returned endpoint is reachable.

Tactical `092` replaces the application's provisional port/counter lifetime.
One generation-fenced session task now retains tracker schedules across
download completion, draws exact current downloaded/uploaded/left counters
from `TorrentRuntime`, uses port `1` only for outbound-only participation, and
uses the mapped external or actual eligible TCP listener port for a matching
incoming seed registration. Corrective `none`, exactly-once eligible
`completed`, imported-complete, and five-second-bounded `stopped` transitions
are deterministic; a correction arriving during the initial started request
is retained.

An independent libtorrent `2.0.13.0` tracker-only leecher announced to the
controlled tracker, received only the decoded RSTorrent seed endpoint,
downloaded the complete fixture, and passed the payload hash without an
explicit peer hint. The opt-in physical run decoded the actual mapped TCP port
from the tracker announce, used that port for an off-LAN 4,195,035-byte
hash-verified transfer, observed stopped before mapping cleanup, and failed to
reconnect afterward. The one-torrent controlled owner records command-queue
and tracker-operation high water `1` under the session ceilings and terminates
with zero tasks, registrations, and operations.

Tactical `095` generalizes the retained catalog and schedule without reopening
that lifetime owner. One session-owned reqwest client set performs HTTP/1.1
and HTTPS announces with exact binary query encoding, bounded Basic auth,
policy/family-aware DNS, five-hop redirect policy, connection reuse, explicit
encoded and decoded body caps, and focused streaming gzip/`x-gzip` support.
Bounded permissive tracker bencode accepts common out-of-order dictionaries,
tracker failures/warnings and IDs, BEP 31 retry advice, optional swarm values,
compact `peers`/`peers6`, and noncompact numeric or hostname peers. HTTPS
deliberately disables certificate and hostname verification only for tracker
clients and is projected as encrypted and unauthenticated.

Scripted evidence covers hostile request/response shapes, redirect credential
stripping and downgrade rejection, cancellation, an AAAA-only tracker,
family-correct port `1`, only-`peers6`, and a wrong-host self-signed HTTPS
tracker. Twelve mixed UDP/HTTP registrations reached the exact shared high
water of eight operations and terminal zero. Application HTTP and HTTPS
verticals hash-verified content from an IPv6 loopback peer; a controlled HTTP
tracker independently introduced the application to pinned libtorrent
`2.0.13.0` for verified metadata, payload, publication, and all lifecycle
events. An owned API 34 arm64 AVD repeated the unauthenticated HTTPS/only-
`peers6` product path through dynamic SAF.

An opt-in 2026-08-06 headless smoke against the official Ubuntu 24.04.4
live-server torrent reached both retained HTTPS tracker rows once, received a
peer from each, and hash-verified metadata in 34.334 seconds before pause and
cleanup. Ubuntu's IPv6-named tracker was dual-stack at the time, so this is
public HTTPS application evidence rather than a routed-IPv6 proof. A preceding
180-second metadata-only add left both rows inactive with zero attempts and
exposed a discovery-activation defect outside the tracker transport.

Tactical `096` repaired that lifecycle by activating the same session-owned
discovery registration while the application actually owns a metadata task,
then restoring durable paused intent after its terminal path. The repeated
metadata-only Ubuntu run verified metadata in 150.736 seconds with zero
payload files. Both HTTPS rows completed started and stopped announces, ended
inactive with two attempts, and retained IPv4 as the actual last successful
connection family. Controlled UDP and AAAA-only HTTP tests independently prove
IPv4/IPv6 family reporting without retaining a tracker or peer address.

Tactical `098` removes the temporary unauthenticated default without changing
the tracker schedule or operation ceiling. Schema version 12 persists
`system_trust` or explicit `disabled`; fresh and migrated profiles select the
secure value. One session reconciler atomically replaces the current
IPv4/IPv6 reqwest pair, fences new insecure work while a secure candidate is
built, retains old pairs only for captured in-flight operations, and never
falls back on verifier construction failure. Thirty-two scripted failures and
recoveries retained command-queue and tracker-operation high water `1` and
terminal zero ownership. A crossing operation proved its captured disabled
pair could finish while new work used and was rejected by the secure pair,
after which the retired pair dropped.

Generated-certificate tests cover valid DNS/IP SANs plus unknown issuer,
validity time, wrong DNS/IP name, missing intermediate, invalid purpose, and
redirect-hop authentication. A controlled authenticated HTTPS tracker then
introduced the application to pinned libtorrent `2.0.13.0` for exact
metadata, payload, and started/completed/stopped lifecycle; HTTP and explicit
disabled-HTTPS profiles passed the same exact-content gate. macOS 26.5.2,
Windows 11 Pro ARM64, and Ubuntu 24.04.4 ARM64 each accepted a public trusted
origin and rejected the controlled invalid certificate before HTTP. The
macOS credential-free Ubuntu tracker request also passed platform trust.

An API 34 arm64 AVD packaged and initialized the version-matched verifier,
rejected the controlled invalid tracker with zero HTTP requests, and accepted
`example.com` through its HTTP 404. Its credential-free Ubuntu tracker attempt
failed with conservative `certificate_rejected`; that is a current AVD
observation rather than a public reliability claim. Explicit disabled mode
completed the controlled pinned-libtorrent SAF transfer and remained
`encrypted_unauthenticated`. Tracker rows otherwise report
`encrypted_system_trust` from the policy captured at operation start, whether
the handshake succeeds or fails.

Tactical `136` moves the former driver-local UDP mechanics into one task-free
operation executor shared by the application and focused owners. The outer
owners still own schedules, tasks, generations, counters, ports, continuation,
and peer registries. Raw magnets retain all bounded UDP/HTTP/HTTPS rows; full
request targets remain private while diagnostics expose a redacted origin.
The focused owner survives the content-discovery handoff and sends
`completed` then bounded `stopped` with `numwant=0` and per-row HTTP tracker-ID
reuse.

A scripted HTTP-only magnet discovered the sole peer and independently
verified exact content through this direct owner. Mixed HTTP-failure-to-UDP
fallback, stalled-HTTP cancellation/socket closure, and clean finalization
after an already exhausted tracker owner pass. A controlled
authenticated HTTPS tracker introduced the direct resumable driver to pinned
libtorrent `2.0.13.0`, exact payload SHA-1
`576143b2992ecf25c780ff41c79552f3bb50941b` passed, and the tracker observed
exactly `started`, `completed`, `stopped`. An untrusted-certificate control
produced zero accepted HTTP requests.

The clean 2026-08-11 Ubuntu 26.04 comparison confirms the original public
boundary is closed: both official HTTPS rows produced two response batches
and two reported peers, the first candidate arrived at 0.148 seconds, first
payload at 4.203 seconds, and six pieces / 1,572,864 bytes verified. RSTorrent
then missed the 10% target at 120.003 seconds while libtorrent reached it in
5.399 seconds. That later one-peer stall is a dated changing-swarm observation,
not tracker failure or authority for a new peer-policy change.

## Current Limits And Next Work

The session owner remains volatile. Current transfer
counters are truthful for the application tracker session but are not durable
lifetime accounting. Port mapping success remains distinct from observed
incoming reachability, a mapped UDP/uTP port remains DHT rather than tracker
peer-port authority, and the port-`1` tracker value remains an explicitly
unconnectable compatibility sentinel rather than an endpoint.

WebSocket transport, proxies, non-Basic authentication, BEP 41 URL data,
scrape, custom roots/pins, client certificates, and a public-tracker
reliability claim remain absent. IPv6 tracker connectivity, outbound peers,
and a listener-backed family endpoint are usable. An IPv6 firewall-pinhole
mechanism now exists and is covered by scripted-gateway evidence, but its
physical gate reaches only the successful negative control: the observed
gateway returns typed `606` to `AddPinhole`, and there is still no observed off-
LAN incoming-reachability claim. One tracker row still selects one operation
family rather than simultaneously announcing each publishable local address.
Full BEP 7 multi-address announcing is therefore absent. The headless public-
torrent comparator remains useful changing-network evidence but cannot replace
controlled protocol and libtorrent tests.

Metadata-only tracker activation now follows the owned metadata task rather
than content-running intent, including bounded terminal deactivation. A
Tactical `112` supplies native-routed source/port evidence and the controlled
AAAA-only path remains the deterministic support gate. Web-seed authentication
must reuse the policy enum only through
its own separately persisted field and transport owner.

Tactical `081` parses and persists every valid unique
`announce-list`/`announce` URL admitted by its
outer byte and calibrated decode-work profiles, preserves compact tier
grouping and metainfo source, and now feeds every operational UDP/HTTP/HTTPS
row into the shared schedule. The bounded paged view projects ordinary
lifecycle plus plaintext or encrypted-unauthenticated security. The full
catalog has no 32-record ceiling, while at most eight tracker operations run
concurrently across every transport. Other tracker wire protocols remain
outside this slice.

The controlled byte-intake proof uploads an exact 26,765-byte metainfo source
whose 40,000-byte payload spans three pieces, observes the expected UDP
connect and announce requests, completes and verifies the payload, restarts
offline from persisted operational metadata, and removes managed data. Pure
tests additionally retain 300 configured trackers across three tiers while
admitting no more than eight UDP operations at once.
