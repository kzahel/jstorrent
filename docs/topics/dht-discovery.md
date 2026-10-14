# DHT Discovery

Tactical [339](../tactical/339-macos-quiet-network-startup.md) keeps Mac DHT dormant for an empty or entirely
paused/archived/removing library. Wanted torrent intent drives the existing
bounded enable/disable owner and registered-discovery wakeup. Saved DHT
preference is unchanged; effective participation is published through the
current view generation. Existing per-torrent private-DHT policy remains.
Other platforms retain their current startup participation policy.

Topic: `dht-discovery`

Status: Partial and product-integrated. Tactical 016 delivered the bounded
session-owned IPv4 Mainline DHT participant, controlled libtorrent completion,
incoming-query participation, private-torrent gating, and revalidated warm
restart. Tactical 065 added its bounded endpoint-free product observatory.
Tactical 089 moved application DHT traffic behind the bounded session UDP
receive owner and separately reports its actual endpoint. Completed Tactical
[`092`](../tactical/092-truthful-tracker-and-dht-peer-advertisement.md) added
verified-public explicit-TCP-port self-announcement under the long-lived
torrent/session scheduler; Tactical `140` refines IPv4 selection below.
Completed Tactical
[`097`](../tactical/097-live-client-settings-and-replaceable-session-generations.md)
made that UDP transport generation-replaceable while retaining one DHT
actor, node identity, routing state, command route, and observation owner. The
application settings reconciler now performs candidate-first coordinated
TCP/UDP replacement; controlled exchange preserves DHT identity and routing
state and uses the replacement UDP source afterward.
Completed Tactical
[`112`](../tactical/112-dual-stack-transport-and-ipv6-dht.md) makes that one
actor and UDP owner dual-stack. Independent IPv4 and IPv6 nodes own their
identities, routing, tokens, transactions, lookups, peer values, bootstrap,
and persisted samples. Controlled pinned-libtorrent IPv6 DHT discovery and a
bounded public dual-family metadata run pass; incoming IPv6 reachability is
not claimed.
Closed evidence-limited Tactical
[`113`](../tactical/113-ipv6-firewall-pinhole-and-incoming-reachability.md)
refines the existing listener-backed IPv6 advertisement input with
`GlobalUnicast`, `Unfiltered`, or `Pinholed` evidence. The DHT actor retains no
gateway or lease authority and announces the same actual listener port under
each eligible scope. Scripted coverage and the live negative control pass, but
the observed gateway returns typed `606` to `AddPinhole`; no off-LAN incoming
IPv6 claim is made.

Completed Tactical
[`140`](../tactical/140-incoming-utp-reachability.md) separates the peer
advertisement input from tracker/TCP truth. IPv4 `announce_peer` now carries
the explicit active session UDP/uTP endpoint, including its independently
mapped external port; IPv6 retains the TCP endpoint because IPv6 uTP is out of
scope. The DHT actor still owns no gateway or lease state.

Completed Tactical
[`156`](../tactical/156-hybrid-dual-swarm-runtime-closure.md) schedules the one
or two fixed identity lanes from a central torrent advertisement registration
through this same actor. A strict hybrid independently performs `get_peers`
and eligible `announce_peer` for its exact v1 and truncated-v2 keys while
sharing bootstrap, routing, transaction, peer, and global operation bounds.
Returned peers retain their versioned lane into the common registry.
Controlled evidence observed both exact keys, one shared bootstrap, two
lookups and one announcement per key, uTP completion, and joined cleanup.

Completed Tactical
[`205`](../tactical/205-durable-dht-and-pex-controls.md) adds one default-on
durable session setting and a live actor command. Disable cancels bounded
lookups with `NetworkDisabled`, clears transactions and peer values, stops all
queries, replies, bootstrap, and maintenance, and reports the typed Disabled
lifecycle while retaining the same UDP route, node identities, and bounded
warm routing state. Re-enable resolves current bootstrap inputs, bootstraps the
same owner, and wakes registered torrent discovery immediately rather than
waiting for the ordinary lookup interval. Private-torrent exclusion remains
an independent stronger gate.

## Why DHT Was Front-Loaded

Tracker discovery is useful but cannot be the only ordinary peer source.
Public trackers are independently operated, can time out, and may not know all
peers in a swarm. DHT is therefore the highest-value breadth improvement now
that scheduled tracker announces and controlled single-peer downloads exist.

DHT and multi-peer transfer were intentionally adjacent foundations:

- DHT supplies peers when trackers are absent, slow, or incomplete.
- Tactical `017` now lets the transfer engine exploit newly discovered and
  late-arriving peers instead of merely replacing one pre-content connection.
- Endgame and measured piece-picker work remain the next steps near completion
  and at realistic throughput.

Selective reference tooling and the controlled headless DHT harness landed
with this foundation. The broader paired RSTorrent/libtorrent live comparator
remains active proof infrastructure rather than a competing product feature.

## Landed Foundation

The application service now owns one DHT actor for desktop and Android. It
starts with the product network policy, races scheduled trackers where present,
feeds results into `PeerSource::Dht`, retries transient empty traversals, and
persists only bounded address-keyed identities plus responsive samples on
shutdown.
Loopback and offline policies use the same owner and every datagram mutation
and send is policy checked.

Protocol state includes bounded KRPC for `ping`, `find_node`, `get_peers`, and
`announce_peer`; compact IPv4/IPv6 values and separate routing tables; alpha-3
lookup; K=8 fixed-distance buckets and replacement caches; BEP 42 validation;
and BEP 43 read-only parsing/admission behavior. The application runtime
receives through one session-owned UDP service with independently replaceable
IPv4 and IPv6 socket generations and a bounded 64-datagram DHT route; DHT sends
through the matching family socket. The standalone engine constructor composes
that same owner for focused tests. DHT stages native-family restored contacts
before public routers, periodically rebootstraps or refreshes, rotates
current/previous token secrets, bounds each family's peer store and source-rate
state, and reclaims dropped lookup waiters.

One session discovery/advertisement task now owns repeated application lookup
and eligible self-announcement across download completion. It registers
long-lived torrent generations rather than starting a timer per torrent. One
announce traversal retains exactly correlated tokens only for its immediate
phase, selects no more than the K=8 closest token-bearing responders, and
sends the selected family/transport peer port explicitly with
`implied_port = 0`. IPv4 selects the actual UDP/uTP endpoint; IPv6 currently
selects TCP. The query source port remains transport state rather than implied
peer-port authority.

Verified private metadata disables DHT and purges DHT-only peers before content
scheduling. Verified private metadata restored from durable state prevents DHT
from starting for that torrent at all. This deliberately permits premetadata
discovery when private intent is unknowable.

Controlled libtorrent 2.0.13 evidence completes metadata and payload download
from an info-hash-only magnet and independently verifies RSTorrent's incoming
`ping`, `get_peers`, token, and `announce_peer` behavior. A public bootstrap
smoke reaches the deployed DHT. The first public Big Buck Bunny lookup found
many peer values but did not acquire metadata in 120 seconds. After bounded
multi-peer acquisition and inspectable metadata state landed, two subsequent
trackerless attempts acquired and hash-verified the 21,307-byte info dictionary
in two blocks after 31.2 and 45.9 seconds. These changing single-sided public
outcomes are useful live evidence, not a paired reliability or speed claim.

Ten immediate trackerless repetitions completed 7/10 within the 120-second
bound. Successful acquisition ranged from 30.84 to 104.35 seconds, with a
78.69-second median and 72.59-second mean. Across the cohort, 2,759 queries
received 2,223 valid responses and produced final registries of 29–120 peers.
The three timeouts still discovered 29, 79, and 83 peers and attempted 23, 35,
and 38, but never sent a metadata request. This evidence moves the observed
failure boundary downstream from DHT traversal into peer connection,
selection, or extension negotiation.

Pinned libtorrent `2.0.13.0` completed the same trackerless metadata metric
10/10 with a 0.90-second median, 1.08-second mean, and 0.75–2.72-second range.
One additional isolated-process run completed in 0.757 seconds. DHT was the
only discovery source and LSD, PEX, incoming peers, uTP, and NAT mapping were
disabled, but libtorrent retained its ordinary peer and metadata concurrency.
The result is a mature-reference baseline rather than an alternated paired
comparison, and it exposes a large downstream traversal/selection gap.

Tactical `065` now projects the actor's latest immutable observation through
one application-owned joined forwarder. The view contains exact socket byte
and rejection counters, all 160 fixed IPv4 routing buckets, oldest-response
freshness, separately bounded replacements, and at most 16 active lookup
summaries whose convergence considers responded candidates with known IDs.
The product presents shared-prefix depths `0..=31` plus an explicit deeper
tail by default and can teach the transformation with the literal 160-slot
engine order. Neither presentation changes DHT work or exposes endpoints.

Tactical `092` adds deterministic exact-correlation, K=8 selection,
explicit-port, eligibility, endpoint-correction, cancellation, and short-TTL
expiry evidence. An independent libtorrent `2.0.13.0` DHT-only leecher queried
the controlled node, discovered only the RSTorrent seed announcement,
downloaded the complete fixture with no explicit peer hint, and hash-verified
it. In the opt-in physical run, DHT wire traffic carried the independently
queried mapped external TCP port while using a distinct UDP source; an off-LAN
peer completed 4,195,035 bytes through that TCP endpoint and reconnect failed
after joined cancellation and mapping deletion. The one-torrent scheduler
records command-queue and DHT-operation high water `1` and terminates with
zero tasks, registrations, tracker operations, and DHT operations.

Tactical `140` adds the transport-specific successor evidence. A controlled
DHT-only pinned-libtorrent leecher received the RSTorrent UDP/uTP endpoint
without a direct peer hint, completed the exact fixture over one uTP and zero
TCP peer connections, and observed two `get_peers` requests with a one-peer
high water. A tracker-only TCP control proves that the two discovery paths did
not borrow each other's port. Its later product-owned public incoming-uTP proof
used a direct dial to the independently verified mapped endpoint, so that
physical result proves endpoint reachability but does not claim public-DHT
discovery reliability.

Tactical `112` adds independent BEP 32 runtime participation without adding a
second actor, command route, observation owner, or product scheduler. The
controlled IPv6-loopback oracle completed a direct IPv6 download and a DHT-
only libtorrent download discovered through RSTorrent's IPv6 announcement,
then exercised incoming `ping`, all `want` forms of `find_node`, `get_peers`,
and `announce_peer`. One outbound-only public Big Buck Bunny run reached 18
IPv4 and 40 IPv6 routing nodes. The IPv6 leg received 41 valid responses and
reached K=8 in 1.218 seconds but returned no peer value in that sample; the
merged dual-family lookup acquired and verified metadata in 107.553 seconds.
That result is live participation evidence, not a claim that IPv6 supplied
the winning peer or accepted an incoming TCP connection.

## Scope And Protocol Baseline

The initial capability is a session-level BEP 5 participant with bounded,
testable state. It includes:

- strict bencoded KRPC request, response, and error handling;
- transaction correlation and endpoint validation;
- independent IPv4 and IPv6 routing buckets and explicit good, questionable,
  and bad node state;
- bounded iterative `find_node` and `get_peers` traversals;
- token handling sufficient to respond correctly to ordinary queries;
- incoming `ping`, `find_node`, `get_peers`, and `announce_peer` handling;
- bootstrap, refresh, timeout, retry, replacement, and shutdown behavior;
- integration of returned peers through the existing `PeerObservation` and
  registry boundary;
- BEP 42-aware node identity behavior; and
- BEP 27 private-torrent gating before decentralized discovery is enabled.

The internal model and runtime now retain independent IPv4 and IPv6 routing
tables as specified by BEP 32. Family-local state must remain independent even
though product lookups fan out through one command and merge useful results.

Normative starting points are [BEP 5](https://www.bittorrent.org/beps/bep_0005.html),
[BEP 27](https://www.bittorrent.org/beps/bep_0027.html),
[BEP 32](https://www.bittorrent.org/beps/bep_0032.html),
[BEP 42](https://www.bittorrent.org/beps/bep_0042.html), and
[BEP 43](https://www.bittorrent.org/beps/bep_0043.html). The pinned libtorrent
implementation and tests are the required completeness and edge-case oracle;
they do not dictate RSTorrent's module boundaries.

## Ownership And Boundaries

DHT is shared session infrastructure, not per-torrent state.

- Pure protocol values, message codecs, routing-table transitions, traversal
  decisions, token validation, and snapshot values must not depend on Tokio,
  sockets, filesystems, task handles, or application adapters.
- One DHT actor holds routing tables, outstanding transactions, lookup
  budgets, and maintenance timers. One lower session UDP owner alone calls
  `recv_from`, bounds dispatch, and shares only a send handle and bounded route
  upward; DHT does not construct a second application socket.
- Each background task has an explicit cancellation signal and observable
  termination path. Shutdown stops new work, drains or cancels bounded work,
  snapshots eligible state, and closes the socket.
- Torrent discovery requests enter through a bounded engine command or queue.
  Results leave through the same source-neutral peer-observation boundary used
  by trackers and explicit hints.
- The session persistence layer stores a versioned bounded snapshot supplied
  by the engine. Protocol and routing code do not know about SQLite, Android
  storage, desktop paths, or product lifecycle APIs.
- Existing online, loopback-only, and offline egress policy applies to every
  bootstrap, lookup, maintenance, response, and announce operation. Future VPN
  and metered-network policy extends that owner instead of bypassing it.

Before implementation, each tactical records the concrete owner/task/cancel
map and the intended module dependency direction. A module or crate extraction
needs an ownership, dependency, reuse, lifecycle, or testability reason; DHT is
not permission for speculative framework layers.

## Fast Restart

"Fast-resume DHT" means warm session restart of the DHT network position. It is
separate from torrent piece resume.

A clean or recoverable shutdown persists only bounded durable hints:

- the node identity material needed by the selected BEP 42 policy;
- a bounded, diverse sample of recently responsive IPv4 nodes;
- an independently bounded IPv6 sample;
- snapshot schema/version and age information needed to reject stale or
  incompatible state; and
- only additional fields proven necessary by the tactical's restart tests.

Tactical [`179`](../tactical/179-disposable-incubation-state-epoch.md) removes
the snapshot-version-1 reader and its single IPv4 legacy node ID. Only current
version 2 opens: it stores bounded address-keyed identities for each family
and bounded warm contacts. Version 1 and unknown versions reject to the
existing cold-bootstrap path rather than migrating identity material.

Persisted nodes return as untrusted bootstrap candidates. They must be
revalidated before becoming good routing entries. Do not persist transaction
IDs, tokens, in-flight traversals, returned torrent peers, task state, or
socket/runtime details.

Warm startup attempts saved candidates before public routers while retaining a
cold-start fallback. Metainfo bootstrap nodes and peer DHT `PORT` messages are
later bootstrap sources unless the initial tactical can add them without
weakening the owner or validation boundary.

The resume evidence must compare cold and warm starts, including corrupted,
oversized, obsolete, address-family-mismatched, and unreachable saved state.
Useful measures include time to first valid response, time to a small healthy
routing threshold, time to first peer, and persistence size.

## Privacy, Security, And Participation

Decentralized discovery must never be enabled merely because a torrent has an
info hash. The product path must retain and enforce the BEP 27 private flag.
The first tactical must explicitly define pre-metadata magnet behavior because
private intent is not known until verified metadata arrives.

All UDP and bencoded input is hostile. The design must cover malformed and
oversized dictionaries, unexpected types, duplicate or unknown keys, spoofed
endpoints, stale or colliding transactions, unsolicited responses, token
abuse, invalid node IDs, self-addresses, duplicate nodes, and address-policy
violations before mutating trusted state. Tactical `140` also fixes identical-
node bucket-distance selection to avoid a zero-distance arithmetic underflow.

RSTorrent is a useful participant rather than a write-only crawler. Incoming
queries and eligible self-announcement are implemented. Self-announcement
waits for verified public metadata, desired-running state, a matching incoming
registration, and the current eligible family/transport endpoint. IPv4 sends
the selected UDP/uTP port and IPv6 currently sends TCP, both explicitly rather
than inferring authority from the DHT query's source port. Peer lookup remains
useful without eligibility; remote peer entries are expiring soft state
because BEP 5 defines no withdrawal query.

BEP 43 read-only behavior is relevant to a future metered or uncontactable
Android mode. It should fit the session policy model, but it is not a substitute
for normal participation on an unrestricted desktop network.

## Resource And Failure Bounds

The implementing tacticals must choose, name, and test finite limits for:

- routing nodes and replacement candidates per address family;
- concurrent transactions and traversals;
- traversal candidates, outstanding requests, and returned peer values;
- per-torrent and session lookup frequency;
- datagram and decoded-message size;
- token secrets, token lifetime, and accepted previous secrets;
- inbound query work and response amplification;
- bootstrap and maintenance retries;
- saved-node count, snapshot size, and diagnostic history; and
- channels, queues, task count, and shutdown duration.

Timeouts, unreachable bootstrap nodes, network-policy changes, socket errors,
clock movement, process restart, and partial persistence failure are ordinary
state transitions. They must not strand a lookup, leak a task, grow state
without bound, or convert untrusted persisted hints directly into trusted
routing state.

## Campaign And Evidence

The completed foundation followed these stages:

1. **Evidence baseline.** Add selective reference tooling and a controlled
   headless DHT harness, and record the exact pinned libtorrent DHT source and
   tests studied. The broader paired public comparator remains Tactical 015.
2. **Core state.** Land bounded codecs, routing state, transaction ownership,
   traversal behavior, tokens, and deterministic hostile-input tests without a
   product socket runtime.
3. **Session runtime.** Add bootstrap and maintenance lifecycle, query
   responses, cancellation, network-policy integration, and controlled
   interop. Tactical `089` later moved socket receive ownership into the
   shared session UDP waist without changing DHT protocol state.
4. **Warm restart and torrent integration.** Persist bounded bootstrap hints,
   prove cold/warm recovery, enforce private intent, and feed peers into the
   ordinary registry.
5. **Live proof.** Public bootstrap, repeated trackerless metadata completion,
   and retained timeout diagnostics exist. Tactical 015 still owns the paired
   libtorrent comparator and richer resource/timing report.

Each slice follows the feature-work contract in the repository instructions:
normative specifications and exact pinned libtorrent source/tests are studied
before design is finalized; shape-changing edge cases land with the common
path; and support claims follow evidence rather than code existence.

## Deliberate Deferrals

The completed DHT foundation does not imply:

- `announce_peer` before verified public, incoming-routable eligibility;
- BEP 14 LSD, BEP 55 hole punching, or broader NAT traversal;
- DHT scrape, mutable/immutable items, or BEP 45 multi-address announce;
- BEP 5 `PORT` messages, foreign-family saved bootstrap endpoints, or the BEP
  32 cross-family bootstrap optimization;
- UDP firewall pinholes, IPv6 uTP, or an incoming-IPv6 reachability claim from
  the implemented but not yet physically proven TCP firewall-pinhole path;
- per-torrent controls, schedules, or battery/network heuristics;
- a remote daemon or socket control plane; or
- speed-ratio gates that fail CI on normal public-swarm variance.

These deferrals do not permit a disposable lookup client, an unbounded routing
table, or a runtime that cannot be stopped and resumed cleanly.

Completed Tactical [`065`](../tactical/065-dht-observatory.md) adds a read-only
product inspection surface without changing these protocol deferrals.
Tactical `112` keeps its existing bounds independently per active family. It
projects socket counters, lifecycle and identity facts, all 160 XOR-distance
bucket occupancies with oldest-response age, and at most 16 active lookup
summaries per family with closest-responded prefix depth and last-improvement
age. The static visual shows prefix depths `0..=31` directly and preserves
every deeper bucket in an explicit aggregate tail; it does not treat
statistically unlikely depths as unreachable. It exposes no raw routing-node
endpoints. Tactical `205` adds the backed session DHT control to Settings, not
to this inspection view, and does not change the Partial protocol-support
claim.

## Maintenance Contract

Every later DHT tactical updates this topic, the BEP rows in
[`protocol-support.md`](protocol-support.md), the discovery scoreboard in
[`capability-readiness.md`](capability-readiness.md), and the live evidence in
[`performance-and-live-evidence.md`](performance-and-live-evidence.md).

Promotion from Absent requires ordinary engine integration and controlled
interop. Promotion beyond Partial requires the exact participating behavior,
address-family coverage, private policy, and evidence to be named explicitly.
