# Peer Discovery And Lifecycle

Topic: `peer-lifecycle`

Status: Tactical `017` completed bounded simultaneous dialing, metadata
acquisition, live content connections, torrent-owned requests, expiry,
replacement, and failover. Tactical `020` completed bounded per-connection
useful-payload feedback and sampled inactivity. Tactical `021` installed
bounded tracker fan-out plus a source-derived 30-peer live set. Tactical `022`
removed the classified duplex command/event backpressure deadlock and passed
3/3 owner-only plus 3/3 paired 50% screens. Tactical `023` completed strict
endgame duplicate-attempt lifecycle, cancellation, and public publication.
Tactical `024` completed bounded exact-generation integrity reputation and
known-bad exclusion. Tactical `025` separated bounded storage work from peer
event progress and disproved storage as the localhost speed owner. Tactical
`026` completed the bounded paired timeline: a source-rich product path held
eight half-open attempts while 119 candidates remained eligible. Tactical
`027` expanded that separate pending cohort to 30. Its complete public
timeline showed DHT results queued outside the registry while storage stayed
saturated. Tactical `028` now owns fair bounded discovery, dial, peer, and
storage service and has closed that defect. Tactical `029` removed redundant
selective hash seeks but retained saturated storage occupancy. Tactical `030`
then installed one complete piece-hash operation boundary without changing
performance. Tactical `031` measures storage service before returning to peer
policy and attributes 93--94% of wall time to serialized storage, dominated by
small writes. Write execution therefore precedes another peer-policy change.
Tactical `035` unifies coherent active-connection observation across the
registry, socket-task owner, and content scheduler without changing peer
policy, and proves that observation through the live headless Peers surface.
Tactical `046` closes the wrapper-level cancellation race that could drop a
metadata or content supervisor before it joined those owners and published
the final empty connection observation.
Tactical `056` derives a bounded display-only client/version hint from the
handshake peer ID without making that spoofable fingerprint an identity or
policy input.
Tactical `078` adds the application-owned, generation-fenced loopback incoming
service. Tactical `082` grows it into a joined multi-peer owner, shares one
descriptor-aware session connection budget with outgoing sockets, schedules
eight bounded upload grants, isolates peer readers and writers, and records
exact physical upload at peer, torrent, and session scope. Full parole
selection, persistent integrity reputation, measured picker policy,
and persistent peer records remain later work. Tactical
[`086`](../tactical/086-long-lived-torrent-peer-runtime.md) completed the
registry and active-connection observation out of the download-operation
lifetime into one task-free engine state and application-generation torrent
runtime. Routed incoming connections now attach to that state and detach only
after their joined upload cleanup; ordinary Peers and Swarm projections now
carry their typed upload facts and exact removal.
Tactical [`088`](../tactical/088-upnp-mapped-external-tcp-seeding.md) changes
no peer-state owner or flag vocabulary. It proves the same routed generation
through a direct off-LAN TCP connection: Peers reports incoming direction,
TCP transport, interest/choke and exact upload activity while Swarm retains
the incoming source as a bounded non-connectable endpoint after disconnect.
Completed Tactical
[`097`](../tactical/097-live-client-settings-and-replaceable-session-generations.md)
makes the shared descriptor-clamped session limit live. Increases admit
immediately; decreases block excess admission first and deterministically
cancel connecting before established generations until the effective-plus-ten
incoming-slack bound is restored. Transport handover retains established peer
tasks and their identities, observations, permits, and exact counters.
Completed Tactical
[`090`](../tactical/090-peer-id-duplicate-connection-resolution.md) adds one
task-free exact peer-ID admission index to that torrent owner. Self IDs and
duplicate losers close before scheduling or upload admission; crossed sockets
use deterministic byte ordering, while same-direction races retain the first
generation. Endpoint records and all accumulated history remain independent.
Tactical [`111`](../tactical/111-mse-peer-stream-encryption.md)'s implemented
slice inserts a bounded MSE phase before that duplicate-admission boundary in
both directions. The existing connection generation owns handshake deadline,
cancellation, socket, peer budget, and terminal observation. One session DH
owner bounds blocking exponentiation to four jobs and drains on shutdown; no
long-lived peer task or parallel registry is added. Outgoing `Prefer` stores
only bounded endpoint capability evidence and permits at most one fresh-socket
early-transport plaintext fallback. Incoming `req2` routing is provisional
until the decrypted BitTorrent handshake validates the same info hash and
ordinary Tactical `090` admission succeeds.
Completed Tactical
[`114`](../tactical/114-session-wide-concurrent-torrent-admission.md) adds
fair session outbound-turn admission above the unchanged peer budget and
activates tracker/DHT/peer discovery only for admitted downloads. One hundred
runnable catalog entries therefore own three content/resource generations and
three active discovery registrations at limit three. A combined 500-complete-
seed, ten-interested-peer, three-download test preserves the 200-connection
ceiling and the existing global seven-regular/one-optimistic upload grants,
then drains every download resource registration.
Completed Tactical
[`124`](../tactical/124-duplex-verified-piece-upload.md) admits routed incoming
content sockets into the same `SwarmState`, picker, request/cancel lifecycle,
contributor attribution, integrity reputation, and connection ceiling as
initiated sockets. One generation-fenced 64-event/16-command bridge leaves
framed IO in the incoming task; nonblocking saturation closes the role instead
of creating a second scheduler or cross-channel wait. Contributor evidence
survives disconnect until delayed hashing resolves, and controlled
complementary transfers prove both directions before completion.
Completed Tactical
[`139`](../tactical/139-incomplete-file-streaming-demand.md) adds a bounded
time-critical pass ahead of ordinary rarest-first scheduling. It selects an
eligible holder by estimated download-queue time, stops beyond a two-second
horizon, obeys the existing rate/request/connection/session ceilings, and may
preempt only bounded untouched ordinary attempts. A slow current block may
own one adaptive duplicate on a different peer; the first accepted response
sends the loser cancel and releases exact attempt ownership. Removing the
final transient demand restores ordinary scheduling without replacing the
peer or download generation.

Completed pure-v2 Tacticals
[`151`](../tactical/151-complete-source-pure-v2-runtime-vertical.md) and
[`155`](../tactical/155-v2-magnet-authenticated-hash-exchange.md) retain those
same peer records, connection generations, discovery sources, transport
selection, and cancellation boundaries. V2 metadata selects exact SHA-256;
hash needs are torrent-owned while each peer holds at most two correlated
attempts and the torrent at most 16. Reject, timeout, disconnect, duplicate,
late, mismatched, and bad-proof outcomes release or fail only their bounded
work. The selected TCP/uTP/MSE/tracker/DHT and both-role pinned-libtorrent
matrix passes without a v2 peer registry or parallel connection owner.

Completed Tactical
[`156`](../tactical/156-hybrid-dual-swarm-runtime-closure.md) gives a hybrid at
most two fixed `SwarmKey` lanes beneath those same owners and limits. Tracker
and DHT observations retain their version into one endpoint-keyed registry;
v2-only observations dial directly, while v1 observations offer the
authenticated reserved-bit upgrade. Incoming v1/v2 routes, initiated TCP/uTP
and MSE generations, hash attempts, payload attempts, cancellation, and
cleanup all attach to one `TorrentPeerHandle`; no parallel registry,
connection scheduler, or per-lane task budget was introduced.

Completed Tactical
[`175`](../tactical/175-retained-swarm-peer-transfer-totals.md) adds two exact
payload contribution counters to that same volatile retained record. A Swarm
snapshot combines the closed-generation base with every matching active
generation; connection removal transfers the final authoritative download and
upload values into the base exactly once. The counters survive disconnect,
backoff, and reconnect, saturate at `u64::MAX`, and disappear with record
eviction or process restart. They are inspection facts only and do not affect
selection, retry, reputation, choking, or request policy.

Completed Tactical
[`177`](../tactical/177-bounded-dry-swarm-recovery.md) retains the ordinary
three-failure ceiling while closing its process-lifetime no-progress trap. An
exact tracker re-observation decrements one consecutive failure without
erasing total history or the scheduled retry deadline. Separately, a content
swarm with no connected, incoming, dialing, eligible, or normally backed-off
peer may spend one existing outbound turn and pending slot on an expired
transient-failure record. Torrent-wide admission then waits 5, 10, 20, 40, and
at most 60 minutes; an admitted handshake resets it. Definite protocol,
identity, integrity, ban, and address-policy exclusions remain absolute.

Completed Tactical
[`181`](../tactical/181-paced-metadata-connection-cohort.md) closes a distinct
metadata-startup bottleneck observed on 2026-08-27. The running service knew
hundreds of peer records from a source-rich swarm, but metadata acquisition
could evaluate only eight combined pending and connected workers; none of the
eight visible initiating attempts connected or contributed payload. Pinned
libtorrent instead gives `downloading_metadata` normal torrent peer admission,
counts half-open work against its 200-connection session limit, and defaults
to 30-attempt startup breadth. RSTorrent now keeps exact global accounting,
bounds the combined metadata cohort at 30, and spaces accepted dials without
burst at a configurable default of ten per second. A scripted 30/31 run reaches
exactly 30 live permits, leaves candidate 31 eligible, and cancels back to zero
tasks and permits. Fast failure, timeout chatter, reject, workspace,
pinned-libtorrent loopback, and maintained Android dual-ABI gates pass.

Completed Tactical
[`182`](../tactical/182-bounded-outbound-attempt-and-metadata-turnover.md)
now bounds all sequential transport and outgoing-handshake phases to one
15-second attempt lifetime. It also adds conservative one-at-a-time turnover
of an oldest zero-contribution metadata worker only when the combined 30-peer
cohort is full, another eligible candidate waits, and the existing no-burst
pacer permits refill. The saturated 30/31 fixture replaces exactly one idle
worker, protects an accepted-block contributor, completes from candidate 31,
and drains to zero. A separate sparse fixture outlives the shortened grace
without churn. The peer cohort, session connection budget, and task owners do
not grow.

## Scope

This topic owns the torrent-engine vocabulary and invariants for peer
observations, accumulated peer records, dial eligibility and selection,
connection attempts, live peer connections, failure history, and bounded
peer-record retention.

It does not own tracker, DHT, PEX, or local-discovery wire protocols; piece
integrity and durable completion; upload policy; product presentation; or
durable application persistence. It owns connection-scoped choke and
availability facts because those determine slot usefulness and request
eligibility. [`download-correctness.md`](download-correctness.md) owns the
corresponding torrent-level request and completion invariants.

## Observed Incidents

### OBS-2026-08-02-001: Paused Torrent Retained Peer Rows

- **Environment:** first-party WebUI observing a live torrent through the
  leased Peers view.
- **Observation:** after the pause command succeeded, connected peer rows
  remained visible instead of being removed.
- **Cause:** session-facing wrappers raced the same cancellation token against
  metadata/content supervisors with biased outer selects. The wrapper could
  drop the owner future before its joined cleanup and final empty observation.
- **Resolution:** Tactical `046` removes those wrapper races, adds terminal
  owner checks, and makes initial metadata discovery cancellation-aware inside
  its supervisor.
- **Closing evidence:** deterministic metadata events reach connected,
  disconnecting, then empty; a content pause closes its TCP peer before the
  receipt and the live view set receives the exact removal plus zero current
  peer aggregates.
- **Status:** closed on 2026-08-02.

## Vocabulary

RSTorrent uses these terms:

- A **peer endpoint** is one validated IP address and listening port that may
  be dialed.
- A **peer observation** is bounded, untrusted evidence from one discovery
  source about an endpoint. An observation is not a live peer.
- A **peer record** is the torrent-scoped accumulation of observations,
  reachability, learned facts, dial state, and history for one endpoint.
- The **peer registry** is the bounded owner of peer records.
- **Dial eligibility** is a derived answer for one record under current time,
  torrent state, and policy. It is not stored as an independently synchronized
  candidate collection.
- A **dial candidate** is a temporary selector result identifying an eligible
  record and endpoint.
- A **dial attempt** is one uniquely identified transition from an eligible
  record into in-progress connection work.
- A **connection generation** is one uniquely identified active
  transport/protocol lifecycle. An outgoing generation begins with a dial
  attempt; a future incoming generation begins when an accepted transport is
  admitted for BitTorrent handshaking.
- A **peer connection** is a connection generation whose transport exists and
  whose peer-wire state is being negotiated or is active. It is not a peer
  record or a content-scheduler membership.
- The **swarm** is the eventual complete per-torrent peer subsystem: registry,
  selector, attempts, and live connections. A peer-record map alone is not the
  whole swarm.

The protocol peer ID learned during the handshake is peer identity evidence,
not the primary key for a discovered endpoint. Multiple endpoints may later
report the same peer ID, and endpoint duplicate policy remains distinct from
identity grouping. While connections overlap, the torrent peer runtime uses
exact equality only to admit one live generation. That volatile index is
generation-fenced, bounded by the connection ceiling, and transfers no source,
retry, integrity, reputation, or ban state.

The same 20-byte value may contain a conventional client fingerprint. The
runtime-independent protocol parser recognizes bounded BEP 20 and selected
mature-client formats, and the application projection exposes the resulting
client/version hint. This derived label is peer-controlled, may be spoofed,
and never changes duplicate detection, trust, scheduling, integrity, bans, or
connection lifecycle. Unknown bytes remain unlabeled instead of becoming an
arbitrary printable fallback.

## Accepted Direction

Discovery protocols translate their results into `PeerObservation` values.
Only the registry merges those observations into engine state. Trackers,
magnet hints, DHT, PEX, incoming connections, cache restore, and manual input
must not grow independent address lists or dial sockets directly.

Repeated observations accumulate a set of sources rather than preserving only
the first source. A later observation may strengthen reachability, such as
when an endpoint first seen on an incoming connection is subsequently
advertised with a listening port. Source-specific trust changes require
explicit policy; an untrusted hint does not become a confirmed fact merely
because it was repeated.

Dial eligibility is derived at selection time. At minimum, a record is not
eligible while non-connectable, dialing, connected, banned, within reconnect
backoff, or at its configured failure ceiling. Selection is deterministic
when policy inputs are equal so controlled tests can explain why one endpoint
was chosen.

The failure ceiling remains absolute for ordinary selection. Matching pinned
libtorrent, a fresh exact tracker observation is trusted to reduce consecutive
failures by one while preserving its prior retry deadline. Other discovery
sources do not rehabilitate failure history. Unlike libtorrent, RSTorrent also
admits one content-only dry-swarm probe after the ordinary deadline only when
every normal connection action is exhausted. That exceptional selector is
restricted to connect, handshake, and remote-close failures, deterministically
prefers credible/fresh records, and is paced per torrent rather than releasing
the failure-limited cohort.

Every dial attempt carries a generation identity. Success, failure, and close
transitions must match that identity so a stale asynchronous completion cannot
mutate a newer connection lifecycle. Tactical `010` exercises one attempt at
a time, but the state model must not require replacing these identities when
parallel dialing arrives.

The registry has a per-torrent capacity from its introduction. It never evicts
a dialing or connected record merely to accept hostile discovery input.
Pruning policy prefers unusable and repeatedly failing idle records before
healthy records. Bans must not be silently forgotten by ordinary capacity
pressure.

Live socket, decoder, peer-wire queues, choke state, and advertised
availability belong to one connection generation. Torrent-level block state,
request assignments, payload reservations, storage acceptance, piece
verification, and completion do not belong to a socket. Connection-independent
history remains in `PeerRecord` when that socket closes. Dynamic peer records
are reconstructible engine state and are not part of the initial SQLite
authority; a later bounded good-peer cache may persist selected endpoint
observations explicitly.

Destination permission is runtime infrastructure rather than peer-record
truth. Observations enter the registry only when allowed by the configured
policy, and the runtime checks again immediately before dialing. `Online`
permits otherwise valid routed unicast endpoints, `LoopbackOnly` isolates
controlled tools, and `Offline` prevents network work. Changing a future
session policy must close active network resources without pretending their
peer records failed.

Tactical `035` makes the active lifecycle vocabulary transport-neutral:

- direction is incoming or outgoing;
- transport is the selected TCP or uTP subattempt and may change to TCP on
  sequential fallback without a new peer noun;
- lifecycle is transport connecting, protocol handshaking, connected, or
  disconnecting; and
- choke, interest, metadata capability, availability, request, stall, and
  usefulness facts remain orthogonal.

The Peers application view contains every active connection generation in
those phases. It retains a disconnecting row until task, registry, scheduler,
request, and payload cleanup finish, then removes it. It contains no
disconnected history. Tactical
[`064`](../tactical/064-registry-backed-swarm-inspection.md) now makes Swarm project
all retained peer records, including eligible, not-connectable, backed-off,
failure-limited, banned, dialing, and connected records, with the registry's
existing 1,000-record bound. It is current retained state, not a connection
history. Semantic registry transitions flow through the coordinator's existing
activity boundary, retry expiry uses its existing deadline/wake path, and one
inactive empty snapshot follows joined terminal cleanup. No view interest,
application state, or browser timer can mutate registry lifecycle.

Tactical `175` extends each retained row with exact useful payload downloaded
from and payload uploaded to that record across all of its connection
generations in the current process. Active generations are added to the
retained closed-generation base at capture time. Finalization adds one
generation exactly once before its active observation disappears, so Swarm
never loses or duplicates contribution at disconnect. These are volatile
record-lifetime totals, not durable endpoint identity or connection history.

The current `PeerRegistry`, `PeerSocketSet`, and `SwarmState` remain valid
subowners with distinct invariants. Tactical
[`086`](../tactical/086-long-lived-torrent-peer-runtime.md) extracted their
cross-owner membership and current-connection observation into one task-free
torrent peer state retained by a session per-torrent lifetime owner. Both
outgoing work and routed incoming connections use that state without folding
socket tasks into deterministic registry or scheduler logic. Completed
Tactical
[`125`](../tactical/125-shared-udp-utp-runtime-and-loopback-interop.md) now
proves that controlled incoming uTP enters that same identity, duplicate-
resolution, upload, and terminal-generation vocabulary. Completed Tactical
[`131`](../tactical/131-bounded-product-utp-composition.md) composes that path
into the application behind a default-off constructor policy. Selected uTP is
published atomically with an outgoing connecting generation; joined fallback
updates that same generation to TCP. Every shipped/default product remains TCP-
only and no second peer model was introduced.
Completed Tactical
[`132`](../tactical/132-utp-default-readiness-evidence.md) adds capability
memory inside that same bounded endpoint record. The dial attempt copies one
task-free `Try` or `TcpWhileSuppressed` decision; only its actual uTP transport
outcome, applied before logical settlement, confirms or suppresses support.
The five-minute-to-one-hour retry deadline uses the existing torrent clock and
wake path. A valid PEX uTP flag refreshes advertised support, while TCP,
cancellation without a transport result, peer-wire failure, and stale or
duplicate completions cannot mutate a newer generation. No peer cache, timer
task, persistence, or endpoint-retention rule was added.
Completed Tactical
[`133`](../tactical/133-utp-product-default-enablement.md) now makes that same
`PreferUtp` path the common application construction default. Desktop,
Android, gateway, and CLI consumers inherit one immutable policy; explicit
`TcpOnly` remains available for transport-isolated diagnostics. The default
change adds no record, generation, permit, task, socket, persistence, or
presentation owner.

Outgoing observation begins before transport work, advances through transport and
BitTorrent handshake, keeps one connection generation through metadata-to-
content handoff, and exposes disconnecting until the socket/worker, scheduler,
request, payload, and registry owners finish exact cleanup. Stale completions
cannot mutate a newer generation. The application `torrent_peers` view maps
that observation rather than independently querying the three subowners; its
row is removed only after the coordinator removes the generation.

Deterministic engine tests cover representable incoming and uTP vocabulary,
outbound lifecycle ordering, handoff, stale generation protection, and exact
removal. Session pressure covers 30 connecting plus 30 connected rows under
the default queue bound. A controlled libtorrent transfer then observes the
same active row through the real React surface and its keyed removal after
verified completion. That remains observation evidence for the ordinary
outbound swarm. Tacticals `078` and `082` supply actual multi-peer incoming TCP
runtime evidence through a separate bounded service, not through the React
Peers view, and do not change dial, picker, or download-request policy.

Tactical `064` adds the companion retained-state evidence. A tracker and DHT
observation merge on one stable registry ID, failed dialing moves that row
through backoff and deadline re-eligibility, and an empty Peers observation
does not remove it from Swarm. The controlled libtorrent browser proof merges
tracker and magnet-hint sources on one loopback endpoint before exact active
connection removal and terminal inactive cleanup. This adds observation only;
registry admission, scoring, eviction, and integrity policy are unchanged.

Tactical `046` adds the missing pause evidence at this same boundary. Public
operation wrappers now request cancellation and await the supervisor that
owns socket, metadata/content worker, discovery, scheduler, request, payload,
and storage cleanup. Deterministic metadata cancellation records connected,
disconnecting, then an empty current collection; a session content pause
closes the scripted TCP peer before returning and delivers the keyed removal
through the existing leased Peers view. A terminal operation also rejects any
remaining peer connection, metadata worker/dial, storage job, request byte, or
payload byte instead of silently reporting joined cleanup.

## Reference Direction

Rasterbar libtorrent `v2.0.13` supplies the mature behavioral reference:
`torrent_peer` is a connection-independent endpoint record, `peer_list` owns
bounded retention and derived connect-candidate policy, discovery sources
accumulate as flags, incoming ephemeral ports remain non-connectable, and
hinted seed state remains separate from confirmed connection facts.

Current JSTorrent provides clearer decomposition vocabulary through
`PeerAddress`, `SwarmPeer`, `Swarm`, `PeerSelector`, `ConnectionManager`, and
`PeerConnection`, but its current first-source-wins and unbounded record-map
behavior are not RSTorrent requirements.

RSTorrent independently implements the public behavior and does not copy
reference source, layouts, raw-pointer ownership, bit packing, per-IP
deduplication defaults, or candidate-cache optimizations.

For the multi-peer campaign, the pinned libtorrent survey begins with
`torrent.cpp`, `peer_connection.cpp`, `bt_peer_connection.cpp`,
`piece_picker.cpp`, `peer_list.cpp`, their corresponding headers, and focused
peer-list, picker, request-queue, timeout, and disconnect tests. These are a
state-transition and edge-case oracle, not an instruction to reproduce
libtorrent's ownership or class graph. JSTorrent remains useful for product
failure history, scripted-swarm patterns, and simpler integration vocabulary.

## Adversarial Development Model

Multi-peer work proceeds from falsifiable failure scenarios rather than from a
broad peer-manager framework. The campaign's central liveness invariant is:

> A torrent continues making progress when peers arrive late, lack pieces,
> choke, stall, disconnect, or return stale data, without exceeding request,
> payload, connection, queue, or task limits.

The implementation establishes only the narrow architectural waist needed to
make those scenarios independently testable:

- one bounded torrent-owned live-connection set and a separately bounded set
  of pending dial attempts;
- stable peer-record, dial-attempt, and connection-generation identities;
- connection-scoped availability, choke, protocol, and socket state;
- torrent-scoped piece/block state and explicit request attempts containing a
  block, connection generation, issuance time, and terminal disposition;
- one global payload allowance and bounded per-peer request windows;
- typed scheduler decisions for dial, request, close, wait-until, verify, and
  complete behavior; and
- supervised connection tasks using bounded commands and events, explicit
  cancellation, and observable joins.

Tactical `023` uses the request-attempt shape to retain multiple bounded
owners for a block during strict endgame. Ordinary scheduling still permits
only one active attempt until every missing block is covered. First response
wins, loser cancels are typed, and every attempt remains charged to the global
payload allowance. Tactical `024` retains the winning dial generation through
stored state, rewards successful contributors, bans a sole corrupt source,
and places ambiguous contributors on bounded parole without falsely banning
them. Do not introduce generic picker, transport, reputation, or policy traits
until a concrete second implementation or measured ownership problem requires
them.

## Adversarial Scenario Families

[`download-correctness.md`](download-correctness.md) owns stable scenario IDs
and required completion results. The peer campaign must cover these families:

### Connection capacity and replacement

- all established slots contain interested peers that never unchoke, then a
  useful candidate arrives;
- all established peers lack the final wanted piece, then a peer advertising
  it arrives;
- pending dial slots contain TCP peers that never complete the handshake;
- peers connect, become briefly useful, and repeatedly churn;
- the registry has many eligible candidates while established and pending
  socket limits remain enforced; and
- no alternative candidate exists, so the engine retains plausible peers and
  discovery schedules instead of cycling connections pointlessly.

An established socket does not earn an indefinite slot merely by remaining
connected. Under capacity pressure, a peer that remains choked, cannot serve
wanted pieces, or makes no request progress becomes replaceable after a
bounded grace period. Unique wanted-piece availability and accepted useful
payload are retention evidence. Without an eligible alternative, the same
state normally produces a waiting deadline rather than reconnect churn or a
blocked result.

### Request ownership and stale work

- choke, disconnect, request expiry, pause, and shutdown with requests in
  every disposition;
- a peer sends keepalives or unrelated messages while withholding one block;
- an expired request is reassigned and the old connection later sends data;
- an event from a closed generation arrives after that endpoint reconnects;
- storage remains slow while multiple peers offer payload; and
- repeated expiry cannot starve one wanted block forever.

### Availability and late discovery

- wanted pieces are split across peers, including a final piece available
  from only one peer;
- bitfield and later `have` messages change which work is schedulable;
- every current peer lacks wanted work while tracker or DHT discovery remains
  scheduled; and
- a late tracker or DHT observation becomes a useful content connection while
  other peers are already active.

### Fairness and resource pressure

- one fast peer does not evict a uniquely useful peer;
- one slow peer cannot reserve the entire torrent payload budget;
- churn cannot grow tasks, decoders, queues, diagnostics, or request history
  without bound;
- hostile observation volume cannot evict active or uniquely useful peers;
  and
- each scheduler pass performs bounded work with a full registry and
  connection set.

### Integrity-facing transitions

Stored blocks retain bounded contributor and dial-generation evidence so a
valid late block is harmless, an unsolicited block cannot consume another
request's reservation, and a failed v1 generation can attribute suspicion
without confusing a replacement socket. Automatic hash retry, asymmetric
trust, known-bad exclusion, bounded endgame duplicates, and cancel messages
now pass pure and scripted evidence. Full parole piece ownership and persisted
reputation remain later slices selected only by adversarial evidence.

## Test And Evidence Strategy

The scenario matrix uses three evidence layers:

1. Runtime-independent scheduler tests use an explicit or virtual clock and
   cover the large transition matrix without Tokio, sockets, storage, or
   sleeps.
2. Scripted loopback swarms exercise representative split availability,
   permanent choke, message-without-payload stall, disconnect, late discovery,
   stale generation, slow storage, cancellation, and exact task cleanup.
3. Controlled libtorrent runs prove that the bounded ordinary multi-peer wire
   path and verified publication remain interoperable.

Every scheduler transition continuously preserves these assertions:

- every active request has exactly one torrent owner, connection generation,
  issuance time, and payload reservation;
- reserved payload equals authoritative outstanding and writing reservations;
- connection, dial, request, queue, task, and history bounds are never
  exceeded;
- stale generations cannot mutate or release current ownership;
- requests target only live unchoked peers advertising the piece;
- storage acceptance and full-piece verification remain the only path to
  durable have state; and
- when an installed mechanism can advance wanted work, the scheduler emits an
  action or a named future deadline.

The first engine slice remains headless. Typed scheduler facts may extend
application snapshots and generated contracts when needed to classify a
stall, but no desktop, web, or Android presentation work is implied.

## Campaign Slicing

The preferred sequence is:

1. **Bounded multi-peer ownership and failover.** Land the live connection
   set, bounded parallel dialing, torrent-owned request attempts, expiry,
   capacity replacement, late discovery, and content completion under the
   initial adversarial matrix.
2. **Endgame and integrity recovery.** Add core cancel messages, bounded
   duplicate attempts, harmless late responses, hash reset/retry, and bounded
   contributor evidence.
3. **Measured picker and connection policy.** Use controlled and paired public
   evidence to tune availability selection, peer retention, connection
   budgets, CPU, memory, and throughput before adding protocol breadth.

Tacticals `078` and `082` complete local incoming connection and bounded
multi-peer payload-upload ownership. Completed Tactical
[`086`](../tactical/086-long-lived-torrent-peer-runtime.md) owns ordinary
incoming swarm/view integration and the per-torrent lifetime boundary it
requires; both now pass controlled interoperability and resource closure.
LSD, NAT traversal, persistent peer caches, and dynamic VPN or metered policy
remain separate future tacticals. The
[`utp-transport-campaign`](utp-transport-campaign.md) topic now owns uTP's
adaptive source, transport-owner, and evidence direction. Completed Tacticals
[`119`](../tactical/119-deterministic-utp-transport-core.md) and
[`121`](../tactical/121-deterministic-utp-loss-congestion-and-mtu.md) supply
the runtime-free bounded transport state. Completed Tactical `125` adds the
controlled shared-UDP runtime and enters incoming uTP into this peer-
connection-generation owner; one pinned-libtorrent seed run observes exactly
one uTP generation and terminal removal. Completed Tactical
[`127`](../tactical/127-mapped-utp-wan-interoperability.md) observes the same
single generation and terminal removal while RSTorrent downloads over a
direct public path from a remotely mapped pinned-libtorrent seed; product
selection remains unchanged. Tactical
[`130`](../tactical/130-utp-transport-solidification.md) is now closed after
proving bounded hostile real-socket pressure, cancellation, generation
replacement, repeated start/stop, and the complementary mapped RSTorrent-
sender direction before product policy. Its lifecycle gate covers endpoint-
scoped spoofed RESET/STATE, duplicate SYN reuse, exact 16 half-open and 64
connection caps, independent 64/256 datagram queues, consumer drop during
retransmission, socket generations, and eight complete restarts. Every case
and the complementary WAN sample end with zero terminal incoming, uTP, UDP,
half-open, connection, and queue ownership and no worker panic.
Completed Tactical
[`131`](../tactical/131-bounded-product-utp-composition.md) adds the default-
off application composition. One incoming and one outgoing product-backed uTP
case each expose exactly one uTP generation; the TCP-only oracle exposes one
outgoing generation that begins with selected uTP, joins that worker to zero,
then reports TCP through handshake and completion. The same attempt, record,
peer-budget permit, cancellation owner, trust result, and terminal cleanup
span both transports. Default TCP/Fast/MSE application regressions still pass
without a uTP service.
Completed Tactical
[`132`](../tactical/132-utp-default-readiness-evidence.md) proves the retained
record and generation across repeated real sockets. One endpoint first joins a
failed uTP subattempt and succeeds over TCP, then reconnects directly over TCP
without another uTP datagram while suppressed, and finally succeeds over uTP
at the exact retry deadline. One permit and generation own each logical dial;
both client/server uTP and UDP owners terminate at zero. Separate deterministic
coverage proves advertised/confirmed/suppressed transitions, PEX recovery,
backoff cap and saturation, overflow, eviction, source removal, and stale or
duplicate outcome rejection. The public metadata-only observation reports
only record-state high waters, never retained peer endpoints.
Completed Tactical
[`133`](../tactical/133-utp-product-default-enablement.md) proves the inherited
default through the same owner model. Default incoming and outgoing uTP each
expose one actual uTP generation; fallback joins the failed uTP subattempt
before the same logical generation reports TCP. Application lifecycle tests
close the fixed service at zero connections, half-opens, queues, admission
tasks, and worker panics, while explicit `TcpOnly` starts no uTP service.

Completed Tactical
[`090`](../tactical/090-peer-id-duplicate-connection-resolution.md) records
mature peer-ID duplicate resolution, and planned Tactical
[`094`](../tactical/094-bounded-bep11-peer-exchange.md) now completes PEX after
that identity boundary and truthful peer advertisement. It does not add peer
scoring or change the authoritative readiness queue. Completed Tactical `092` feeds
the generation-fenced selected TCP endpoint into tracker and DHT discovery;
endpoint selection remains distinct from observed incoming reachability.

## Current Evidence And Gaps

Tactical `051` keeps lifecycle and compact flags as separate application-view
dimensions. Connecting, handshaking, connected, stalled, and disconnecting
remain lifecycle state; incoming direction, transport, negotiated capability,
and known transfer relationship become typed semantic flags computed from the
same coherent connection-generation observation. Reserved scheduler and
integrity flags are not inferred from the current lifecycle vocabulary.

Tactical `006` proved direct `x.pe` resolution, BEP 9 metadata transfer, and
same-socket content handoff. Tactical `010` replaced the remaining ad hoc
address loops with one runtime-independent registry and one diagnostic
runtime owner. Both manual explicit peers and resolved magnet hints now enter
the same observation, selection, attempt, and connection lifecycle.

Deterministic state evidence covers source accumulation, strengthened
reachability, capacity and pruning, active and banned retention, eligibility
and reconnect backoff, successful and failed transitions, stale callbacks,
and checked counter exhaustion. Scripted engine evidence proves failover from
both an unreachable endpoint and an extension-incapable connected endpoint
before the next peer completes verified metadata and content. The controlled
libtorrent `2.0.13.0` metadata/content exchange remains green.

Tactical `011` proved the intended discovery boundary: compact results from a
bounded one-shot UDP tracker announce enter as tracker observations, merge and
deduplicate in the registry, and follow the existing dial and failure
lifecycle. A tracker rejection advances to another tracker; an unreachable
tracker peer advances to the next record; and a successful explicit hint
avoids tracker traffic.

Tactical `014` keeps that same boundary while the tracker manager retries and
reannounces. Tactical `017` now admits those later observations into bounded
parallel dials while existing content connections remain installed.

Tactical `016` adds a session-owned DHT participant and feeds its results
through `PeerSource::Dht`. Controlled trackerless metadata/content completion
passes. Tactical `018` made every registry and metadata-attempt disposition
inspectable, then completed two public trackerless Big Buck Bunny metadata
runs from 93 and 100 candidates after 9 and 12 attempts. Failures were ordinary
connect, handshake, and extension-phase failures; one peer advertised
`ut_metadata`, supplied both blocks, and won while remaining dials were
canceled. The registry remains the authority rather than a diagnostic address
loop.

A subsequent ten-run tracker-only and ten-run trackerless-DHT cohort completed
8/10 and 7/10 respectively. The two tracker timeouts each received two full
16 KiB metadata blocks across four requests but no verified dictionary. The
three DHT timeouts discovered 29–83 candidates and attempted 23–38 peers but
sent zero metadata requests. Tactical `019` responds by replacing independent
per-peer dictionaries with one torrent-owned block table. It retains accepted
sources and request history, reassigns stalled or disconnected blocks, and can
complete from disjoint peer contributions. Public cohorts still need to
separate assembly ownership from candidate and negotiation quality.

Tactical `013` removed the implicit loopback preference and restriction.
Desktop and Android product owners explicitly use `Online`; diagnostic and
controlled runtimes use `LoopbackOnly`. TCP connect, handshake read/write,
complete-message reads across fragmentation, and complete-frame writes now
have bounded deadlines owned by the peer connection. Timely messages can
continue indefinitely because no deadline bounds the torrent's lifetime.

Tactical `017` installs up to eight live connections, three pending dials,
four requests per peer, four active pieces, bounded terminal history, and one
torrent supervisor that owns storage and task joins. Controlled scenarios
prove split availability, disconnect/choke reassignment, request expiry,
harmless late payload, late discovery, handshake silence, full-slot
replacement, no-alternative waiting, and cancellation. Pinned libtorrent
participates in a verified 16-piece completion while a scripted connected
peer remains choked.

Metadata acquisition now keeps up to eight dial/negotiation work items in
flight, continues tracker or DHT discovery, and gives them one bounded
torrent-owned BEP 9 coordinator. Each peer receives at most two requests;
the first is immediate and the second follows a response or a one-second ramp.
Ordinary assignments are unique for three seconds, after which untried peers
are preferred. Disjoint peers can complete one dictionary, disconnect/reject
releases work, and a hash-invalid generation resets with contributor
attribution. The worker delivering the final hash-valid block is preserved for
content while losing work is cooperatively canceled and joined.

Tactical `019` met the public metadata gates. Two independent Big Buck Bunny
tracker cohorts each completed 9/10 for RSTorrent versus 10/10 for libtorrent;
successful RSTorrent medians were 5.72 and 4.12 seconds versus 20.52 and 20.33
seconds, with paired p90 ratios below 1.6x. Ten isolated fresh-DHT RSTorrent
runs completed 10/10; the locked reference produced no torrent candidates in
three contemporaneous attempts despite a populated DHT routing table, so
paired DHT latency remains externally blocked.

The first four-torrent breadth matrix exposed peers that ignored an immediately
pipelined second metadata request. Endpoint-free attempt diagnostics and
`ut_metadata.cpp::maybe_send_request` identified libtorrent's one-request-per-
event/tick cadence. After adding the deterministic request ramp, Cosmos,
Sintel, Tears of Steel, and WIRED CD all completed 3/3 for both owners. Each
RSTorrent run used two requests for two accepted blocks without a hash or
cleanup failure.

`DownloadControl::diagnostic_snapshot` now exposes a bounded read-only peer
registry table and active/recent metadata attempts. Initial BEP 10 handshakes
that omit `ut_metadata` release their slot, metadata rejection is counted, and
unrelated messages cannot extend the independent metadata-progress deadline.
The snapshot is engine diagnostics; product UI projection remains separate.

Tactical `020` installed adaptive per-connection request windows and measured
stall deadlines. A capable public peer now reaches the 50% reference range,
but a clean screen completed only 1/3 while the misses retained four or nine
current candidates and two connections. Tactical `021` therefore owns the
preceding working-set boundary: bounded initial tracker-operation breadth,
multi-response registry intake, and prompt bounded dialing. The registry and
content supervisor remain the owners of candidate history, connection limits,
replacement, and cleanup; tracker success does not prove peer usefulness.

Tracker fan-out then expanded the clean public runs to 14--15 candidates and
five or six live connections, but completed 0/3 at 50%. Each terminal state
had established plus half-open counts equal to the old eight-slot ceiling and
still retained two to five eligible candidates. Pinned libtorrent defaults an
individual torrent to unlimited connections beneath a 200-session cap and
uses a 30-attempt startup boost. RSTorrent now separately bounds eight
half-open attempts and 30 established peers; a pending handshake no longer
occupies a live slot, and late successes at the live ceiling still require a
classified replacement.

The next clean screen remained 0/3 and exhausted every current candidate, so
the larger cap is not sufficient. Four or five of the five or six established
peers were unchoked, yet one peer target reached 360 or 500 and hundreds of
requests remained outstanding. The aggregate sampled rate was incompatible
with wall-clock useful bytes. Following libtorrent's `peer_info` diagnostic
shape, the engine snapshot now retains one endpoint-free row per bounded live
connection with choke, availability, request queue, target, payload, rate,
phase, age, and timeout facts. This observability is separate from policy and
will select the next deterministic owner.

The first clean row-bearing sample did so: the table stopped refreshing after
a one-to-two-second-old state in which one peer had delivered 6.24 MiB and
held 383 requests. The supervisor awaits all commands through a 16-entry
channel before consuming the 64-entry event channel, while the peer task
awaits event delivery before draining more commands. Tactical `022` owns this
duplex cycle; request-window policy is unchanged until transport progress is
restored.

Tactical `022` removed the duplex cycle. Tactical `023` installed strict
endgame attempt ownership and core cancellation through deterministic,
controlled, and public verified-publication gates. Tactical `024` installed
exact-generation contributor reputation, whole-piece retry, and known-bad
exclusion through pure and scripted adversarial gates. Tactical `025` moved
physical storage behind a bounded owner; its delayed-storage scenario proves
two peers can continue delivering while one write is in flight. The corrected
localhost benchmark did not improve, so storage is no longer the leading
explanation for the public completion gap. Tactical `026` added the bounded
paired timeline and completed three exact public pairs. Early common-profile
samples first showed sparse RSTorrent candidate supply, while the product
tracker+DHT path supplied 159 candidates by metadata and retained 119 eligible
records behind exactly eight half-open attempts. That run took roughly 100
content seconds to grow from six to 29 connections while libtorrent's source
defaults offer a 30-attempt startup boost and 30 attempts per second.

Tactical `027` therefore owns one falsifiable admission change: 30 pending
attempts beneath the existing independent 30-established-peer and fixed
payload bounds. It does not change ranking, request windows, storage, or
turnover. Its deterministic position-30 and 30-silent cancellation cases pass.
Three exact 50% screens and one 149.42-second exact completion also pass, but
the complete timeline reported DHT peers long before the content registry
grew. Continuously ready storage is selected before discovery in the biased
supervisor and is the new preceding lifecycle owner.

Tactical `028` admits discovery and begins bounded dials during storage
pressure, then gives safe ready owners explicit rotating service. Its live DHT
counts and registry totals now grow in the same sample and immediately fill 30
dials. Source-rich runs then retain full storage queues and low per-peer rates.
Tactical `029` removed redundant selective-hash seeks without changing that
occupancy. Tactical `030` moved the complete common piece hash behind one
blocking boundary, but controlled timing stayed neutral and the public queue
remained full. Tactical `031` measures queue wait and per-kind service before
connection policy and attributes about 88% of public wall time to 16 KiB write
service. The source-first write owner now precedes another lifecycle change.
Tactical `086` is complete; its retained torrent peer owner and routed
incoming Peers/Swarm observation pass controlled libtorrent/RSTorrent gateway
interoperability and terminal resource closure.
Tactical `088` additionally proves those unchanged observations during an
exact 4,195,035-byte externally dialed transfer through a verified mapping,
followed by retained Swarm history and terminal resource closure.
Tactical `175` additionally proves exact active, disconnect, overlapping,
reconnect, stale-removal, and saturation transitions plus final authoritative
incoming upload capture, generated first-party boundaries, responsive React
presentation, and the repaired installed LAN/tailnet service.
Tactical `177` additionally proves source-specific one-step tracker
rehabilitation, the unchanged ordinary hard ceiling, transient-only dry
selection, deterministic credibility rank, exact backoff/cadence saturation,
and a scripted endpoint that fails three handshakes before the sole probe
completes verified content on attempt four. The success resets peer and probe
state and terminates with zero dialing, connected, or failure-limited counts.
Tactical `092` additionally proves tracker-only, DHT-only, and mapped
wire-port discovery into the same retained peer lifetime. Tactical `097`
additionally proves deterministic live limit reduction and increase plus
incoming and outgoing transfer survival across coordinated transport
handover. Finite upload bandwidth and seeding goals remain later work.
Completed Tactical
[`090`](../tactical/090-peer-id-duplicate-connection-resolution.md) records the
post-handshake duplicate-connection boundary with deterministic, saturated
runtime, generated-contract, and controlled libtorrent evidence. Tactical
[`111`](../tactical/111-mse-peer-stream-encryption.md) proves both MSE methods,
carried bytes, early fallback and no-fallback classifications, collision-safe
incoming routing, frame-commit cipher ownership, live `allow -> required`
replacement, exact terminal byte/exponentiation accounting, and all 28 pinned-
libtorrent policy/method cases. Established generations retain their captured
policy and cipher through later settings changes; the next generation observes
the replacement. Both negotiated methods reuse the same peer owner and derive
the truthful encrypted-or-obfuscated flag from its coherent observation. The
physical Pixel 7a product profile completed five forced-RC4 attempts with a
three-job DH high-water under the four-job ceiling and terminal
`active=waiting=tracked=0`.
Completed follow-up Tactical
[`115`](../tactical/115-mse-policy-advertisement-and-peer-detail.md) adds a
29th RC4-only compatibility case and aligns `allow` selection with stock
libtorrent's plaintext-payload default. Existing generations still retain
their captured method; the exact value now also projects as optional quiet
peer detail.
Tactical
[`091`](../tactical/091-availability-ranked-piece-activation.md) completes the
measured picker refinement with exact availability accounting and preserves
unique unplanned-piece retention across replacement. Tactical
[`094`](../tactical/094-bounded-bep11-peer-exchange.md) now completes PEX's
bounded discovery path through the ordinary registry. It retains exact source
provenance, 50-per-source and 200-per-torrent ceilings, private-transition and
disconnect cleanup, a shared 4,096-event timeline, and one cursor per
negotiated connection. Deterministic PEX-only second-hop coverage and pinned
libtorrent complementary-peer evidence pass. Full parole selection still
requires adversarial evidence that
the existing retry and suspicion policy cannot recover; persisted peer caches
also remain unplanned.

Completed Tactical
[`205`](../tactical/205-durable-dht-and-pex-controls.md) gives every current
and future torrent plus accepted peer one shared default-on live PEX policy.
Disable stops advertisement, receive, and send, purges PEX-only source
provenance without disturbing mixed tracker/DHT/manual/incoming provenance,
and sends a BEP 10 `ut_pex = 0` update to established extension-capable public
peers. Re-enable retains negotiated remote IDs, sends the repeated enabled
update, and resumes bounded cursors without replacing torrent or peer task
generations. Verified private torrents remain blocked independently of the
session setting.
