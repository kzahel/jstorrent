# Incoming Reachability And Seeding

Tactical [366](../tactical/366-bounded-host-shutdown.md) bounds UPnP mapping
and pinhole removal during application shutdown. Removal shares a 2 s budget
with tracker `stopped` announces and ends at once when the host hurries. A
removal ended that way leaves the lease to expire on the router; shutdown
reports it as progress and a warning diagnostic rather than as an error.
Other delete failures remain shutdown errors.

Tactical [357](../tactical/357-rich-share-links.md) reuses reachability for
share-link peer hints. An internet address is offered only after an incoming
connection from a public address reached the current advertised endpoint
(UPnP mapping, public IPv4 listener or global IPv6 listener); otherwise the
RFC 1918 listener address is offered as a local-network hint. Without
NAT-PMP/PCP or BEP 10 `yourip`, a manually forwarded host behind NAT cannot
learn its external address, so it gets no internet hint.

Tactical [344](../tactical/344-seeding-stop-limits.md) adds seeding stop
limits beside the priority-only seed goals of Tactical 201. A finished torrent
stops when its share ratio (`max(downloaded, size)` base) or seeding (finished)
time reaches the session limit or its own override; both default to off. The
admission pass checks running and queued seeds with in-memory accounting and
stops through the ordinary pause path with a durable `seed_limit_stopped`
flag. Resume of a limit-stopped torrent means keep seeding and sets its own
limits to No limit; a user pause is never a limit stop, and raising a limit
restarts nothing. Seed goals still only rank the queue. Inactive/idle limits,
remove-on-limit actions and force start remain deferred.

Tactical [340](../tactical/340-windows-quiet-network-startup.md) selects incoming
and UPnP Off for fresh and first-upgrade Windows desktop profiles. Native VM
Off/On/TCP-only controls, zero Off uTP allocation, atomic Off with preserved UDP,
independently hashed cross-VM outgoing uTP/TCP under persistent firewall denial,
and retained-data migration pass. A listening port after Cancel is not firewall
permission or external reachability. Signed shipping/regrant and unsolicited
external inbound/WAN acceptance remain separate gates; no OS rule automation
or common engine policy change is added.

Tactical [339](../tactical/339-macos-quiet-network-startup.md) makes incoming Off apply to TCP and unsolicited
uTP SYNs, including retirement of existing inbound peers. An Off-only change
retains the shared UDP generation and outgoing peers; explicit port/family
changes retain their existing replacement rules. No listening endpoint is
advertised while Off. Mac native outbound uTP and TCP fallback both complete
with independent payload hashes; Android boundary rejection and builds pass.
Fresh Mac defaults and first upgrade disable listener/UPnP. Windows follows
340; Linux defaults and signed firewall/reachability qualification remain open.

Tactical [332](../tactical/332-windows-listener-test-port-isolation.md) isolates
the automatic repair preference in the fixed-listener application test. Source
CI 38409973610 fails on Windows when the occupied preferred port's successor
returns error 10013. An independent TCP/UDP-probed preference preserves the
fixed-conflict, retained-listener and same-value retry assertions without
changing production allocation policy. Local formatting, workspace Clippy,
1,598 Rust tests (18 ignored), the 394-case session suite (two ignored), and
40 focused runs across four concurrent processes pass. Native Windows ARM64
with Rust 1.99 also passes 40 focused runs and its full 392-case session suite
(two ignored). Hosted x86_64/Rust 1.97 CI has not been rerun; the original
hosted failure remains failed.

Tactical [277](../tactical/277-android-observer-listener-readiness.md) repairs
qualification of269's asynchronous listener startup. Source8c CI and a focused
local reproduction fail the immediate optional snapshot. The unchanged
maintenance owner applies settings asynchronously; the test now observes actual
readiness within five seconds. All15 Android Rust boundary cases, focused
all-target clippy and workspace formatting pass. Protocol, generated boundary
and shipping behavior are unchanged; the original hosted failure remains open
until revised-source CI is authorized and run.

Topic: `incoming-reachability-and-seeding`

Tactical [269](../tactical/269-android-incoming-peer-diagnostic-evidence.md)
is complete locally at application sourceaeaa72f9:15 Android Rust cases/clippy,
normal original-key dual-ABI packaging,122 JVM cases/lint and actual bounded
physical incoming snapshots pass. Full workspace1575 cases/fmt/clippy and
web typecheck/470 cases also pass, with existing ignores/skips retained.
The original failed probe observes zero then one native registration and two
UnknownTorrent rejections for exactly its owned hash; it started before actual
admission. Tactical270 is complete locally: fresh UID/exact-fixture registry
readiness precedes independent upload. Both current-source original large
fixtures verify/upload all28 MiB with120 empty files, retained diagnostic
history/actual filters, joined shutdown and actual reopened Live/owned row,
unchanged SAF registry/payload and cleanup. Readiness takes107.99/166.16 seconds.
All48 portable cases pass; earlier failed receipts remain scoped and intact.
Normal diagnostic warnings intentionally remain across category filters. No
engine/network/admission/retry policy changes. Both full current-APK default
runs subsequently pass under259/273; managed and broader physical acceptance
remain separate.

Both current-APK physical default runs now pass three cold repetitions, the
3,600-second detached hour, full independent 40-MiB download/upload hashes,
retained Warning/Info filters, joined actual Live/owned-row reopen, unchanged
SAF registry/payload and cleanup. Both also pass all seven current-APK recovery
cases. A retains its older fixed 120-second upload driver; B's fresh repeat loads
source `840f421d`/driver `51883b67` with a 172-second upload and one native display wake
inside the original 120-second reopen budget. B's first whole reopen failure
remains recorded unchanged. No managed Play, physical reboot/provider/network/
sleep or final signed desktop/store/public acceptance is inferred.


Tactical272 keeps the measured28-MiB upload's120-second allowance and scales
the40-MiB hourly fixture to172 seconds, below the existing300-second helper
bound. Native admission still has180 seconds; independent file hashes and
joined cleanup remain mandatory. All51 qualification/five transport cases pass.
Both current-source full defaults subsequently pass at their recorded driver
identities; no managed delivery is inferred.

Both source0aa physical cohorts independently hash the installed APK and pass
small foreground/background/reopened upload plus joined Live-library restart,
retained SAF registry and cleanup. This closes Tactical260's bounded local
shutdown evidence, not the failed large-metadata/hour or managed delivery gates.
Tactical266's restored native retained history/Live-library component also passes
both cohorts. Whole upload receipts remain failed; severity/category button
changes alone cannot prove asynchronous filtering. Tactical267 now checks actual
visible filtered rows, with26 passing portable driver cases.

Tactical [267](../tactical/267-physical-upload-and-reopen-evidence.md) strengthens
actual upload transport/readiness/counter and observed retained-settings
navigation evidence. Both source-376 physical runs pass their full 3,600-second
background transfer and whole 40-MiB hash; their subsequent upload phase fails.
No complete end-to-end pass is inferred. Portable delayed-listener/failure
ownership/refusal tests pass; short current-APK trials run before full retries.
No engine/network/seeding policy changes or inherited app/data cleanup occurs.

Tactical [260](../tactical/260-android-shutdown-failure-containment.md) preserves
the existing uncertain IPv6 lease error while containing its propagation in the
Android service after native shutdown. No mapping, pinhole, advertisement or
engine ownership behavior changes. Adapter build/JVM evidence and both bounded physical small-fixture joined
shutdown/Live restart pass;260 is complete locally. Current large-metadata/hour
qualification subsequently passes; managed delivery remains open under259.

Tactical 253's startup follow-up overlaps four read-only file observations
before constructing completed-seed availability. No early seed is admitted;
file order, exact lengths/kinds, padding/selection and verified-piece authority
remain unchanged. Reversed replies, failure filtering and cancellation pass
with four pending requests and zero opened descriptors. Physical Android
startup and saved browser pairing are recorded in the tactical.

September 12 hosted run `34682523287` passes Tactical 212's four application
lifecycle cases and three topology/three checkpoint-crash cohorts with exact
repair and joined cleanup. Tactical 211 also repairs a Windows-exposed test
handoff after force recheck: a directly owned service must join the terminated
checker through application maintenance before expecting seed registration.
The forced-order negative reproduces the timeout; the test-only repair passes
20 concurrent-process repetitions and the complete local session suite.
Corrected run `34684328524` passes the full native Windows session and
package gates; see [the run record](../evidence/release-readiness-ci-2026-09-12.md).

Tactical `212` now also resolves completed-seed repeated checking for verified
oversized files. A one-shot, nonpersistent exact-extent handoff follows joined
successful content work into seed registration; ordinary startup validation
remains strict and peer reads remain bounded by metainfo. Native and Android
provider negative cases pass, as do the complete topology/checkpoint matrix
and four-case application restart/seeding/repair cohort. The ordinary
presubmit and extended/recovery workflows now pass on hosted Linux; see
[the exact record](../evidence/release-readiness-ci-2026-09-12.md).

Completed Tactical
[`212`](../tactical/212-application-lifecycle-verification-gate.md) adds a
complete application process cohort: after source-offline restart, single-file
and cross-file torrents each seed two independently verified libtorrent copies
around a paused corruption check and exact one-piece repair. Joined cleanup
and resource bounds pass. The broader oversized-file topology currently
cycles between completed-seed structural validation and Checking; disabling
seed admission isolates the failure but is not an accepted workaround.

Tactical [`211`](../tactical/211-presubmit-signal-and-build-measurements.md)
strengthens the pure-v2 active-upload regression by forcing joined content-task
termination before the test drives completed-seed admission. A persisted
Complete state alone does not imply that the old generation has been reaped.
The controlled negative case reproduces the hosted timeout, and the corrected
test passes 40 concurrent-process repetitions. Production seeding and Android
semantics are unchanged.

Status: Tacticals
[`078`](../tactical/078-local-single-peer-tcp-seeding.md) and
[`082`](../tactical/082-bounded-multi-peer-upload-ownership.md) complete local
incoming TCP seeding through a bounded multi-peer upload owner with exact
physical-payload accounting. Tactical
[`084`](../tactical/084-persisted-client-connection-and-seeding-settings.md)
completes the first persisted listener, connection-limit, and upload-slot
settings slice through the shared product surface and restarted controlled
seeding. Tactical
[`086`](../tactical/086-long-lived-torrent-peer-runtime.md) is complete.
Its task-free engine peer state and session per-torrent lifetime owner now
survive download-to-seed transitions, and routed incoming connections attach
to that owner with complete upload observations. Ordinary Peers/Swarm mapping
and the unchanged headless product adapter consume those facts; the
authenticated gateway proof follows pinned libtorrent and RSTorrent peers
through exact transfer, removal, pause, and terminal zero ownership. Completed
Tactical
[`143`](../tactical/143-dual-identity-and-persistence-foundation.md) separates
that lifetime owner from the version-tagged v1 `SwarmKey` used by incoming,
tracker, DHT, handshake, and MSE routing. Controlled incoming TCP/uTP,
tracker-only, DHT-only, MSE, seeding, removal, and terminal cleanup evidence
passes with opaque owner routing; no v2 incoming behavior was implied at that
foundation checkpoint. Completed Tacticals
[`151`](../tactical/151-complete-source-pure-v2-runtime-vertical.md),
[`155`](../tactical/155-v2-magnet-authenticated-hash-exchange.md), and
[`156`](../tactical/156-hybrid-dual-swarm-runtime-closure.md) now add pure-v2
and strict hybrid incoming behavior. One hybrid registration installs both
versioned routes atomically, v1 accepts may upgrade only to the identical
owner/metadata v2 route, and active or complete seeds unregister both routes
together. Direct-v2, upgraded-v1, declined-v1, MSE, uTP, restart, padding,
metadata/hash/payload service, and terminal cleanup evidence pass.
Completed Tactical
[`134`](../tactical/134-hierarchical-transfer-rate-enforcement.md) adds live
session/torrent upload and download limits at the common established-peer
boundary for initiated and accepted TCP/uTP streams. Completed Tactical
[`201`](../tactical/201-durable-seeding-goals-and-seed-admission.md) implements
pinned libtorrent global thresholds, durable totals/timers, active-seed rank,
inactivity, and defaults. Reaching any one threshold lowers automatic seed
priority; it does not unregister a seed when capacity remains or rewrite
durable run intent. One combined owner admits downloads first and then ranked
completed seeds under the fixed 500-torrent ceiling. Its durable generation
sink attaches at the exact initiated and accepted peer-I/O boundary, including
active pre-completion upload routes, and coalesces those physical payload bytes
with monotonic activity timers under one session owner.

Completed very-high-priority Tactical
[`124`](../tactical/124-duplex-verified-piece-upload.md) replaces the
whole-torrent upload gate with compact
verified/readable piece authority, serves active selective storage through the
existing bounded upload owner, and carries payload in both directions over
initiated and accepted TCP sockets before completion. Discovery now consumes
an actual active-route `incoming_routable` fact: trackers correct to the
eligible listener port with nonzero `left`, while verified-public DHT announces
only on families with a real TCP endpoint. Typed active-read failure retracts
the advertised epoch and route, and serialized pause/recheck/archive/removal
plus publication handoff close old listener generations before returning.
Controlled ordinary/Fast/MSE pinned-libtorrent and API 34 Android SAF gates
prove complementary sparse exchange, cross-file and part-backed reads,
provider loss/repair, exact hashes, and terminal cleanup.

Tactical
[`088`](../tactical/088-upnp-mapped-external-tcp-seeding.md) is complete. It
adds explicitly eligible non-loopback IPv4 listeners, one session
reachability coordinator, bounded UPnP IGD v2 mapping, and an exact off-LAN
incoming transfer through the observed mechanism. Other mapping protocols
remain later slices.

Completed diagnostic-only Tactical
[`127`](../tactical/127-mapped-utp-wan-interoperability.md) extends that
engine mapping owner from an implicit TCP constant to an explicit TCP/UDP
value. At that checkpoint product reachability remained explicitly TCP. The
successful direction used one finite verified UDP mapping owned by the remote
oracle; the engine's UDP mapping path was diagnostic-only and not invoked.
The result added no persisted setting, advertisement, or ordinary product
listener policy.

Closed diagnostic-only Tactical
[`130`](../tactical/130-utp-transport-solidification.md) exercises the engine's
explicit UDP mapping path on the authorized local gateway with RSTorrent as
the seed/bulk sender. At that checkpoint every product reachability call
remained TCP, and every
diagnostic UDP lease was queried, deleted, and independently confirmed absent
before the next sample.

The first such sample now passes. One exact finite 3,600-second UDP lease
exposed the diagnostic RSTorrent seed, pinned libtorrent on `pimom` downloaded
and hash-verified all 2,097,883 bytes over an ordinary Internet route, joined
shutdown deleted the lease, and an independent exact-port audit found it
absent. An observed reset of the idempotent external-address SOAP query is now
bounded to one retry; mutating mapping ownership and product TCP policy are
unchanged.

The bounded cohort later closed evidence-limited after three captured local-
send successes and two intermittent 180-second timeouts, all with exact lease,
process, and artifact cleanup. The external attempt budget expired before a
compliant three-sample remote-receive summary was retained. No product UDP
mapping, listener, advertisement, setting, or reachability claim follows.

Completed Tactical
[`140`](../tactical/140-incoming-utp-reachability.md) now composes the actual
IPv4 product UDP/uTP listener beside TCP under the existing single UPnP policy.
One reachability owner discovers once, retains no more than one finite lease
per protocol, and keeps each protocol's creation, renewal, failure, uncertain
deletion, and replacement independent. Trackers and BEP 10 continue to use
TCP; IPv4 DHT explicitly announces the selected UDP/uTP endpoint. The existing
mapping status remains TCP and an additive UDP/uTP status crosses Rust,
TypeScript, React, UniFFI, and Kotlin.

Controlled tracker-only TCP and DHT-only uTP cases pass against pinned
libtorrent with exact content and no TCP masking in the DHT case. Both Android
ABIs and the API 34 application status/lifecycle gate pass. An explicitly
authorized physical continuation fixed wildcard UDP mapping eligibility and
the bounded harness, then independently verified a finite product-owned UDP
mapping. Pinned libtorrent on the off-LAN peer downloaded and hash-verified
the exact 2,097,883-byte fixture in 77.347993 seconds over one incoming uTP and
zero TCP peers. Joined shutdown deleted the mapping, an independent inventory
found it absent, and all per-run processes and artifacts were removed. One
preceding mapped dial timed out with zero remote uTP packets and also cleaned
exactly, so the positive single-path result is not a repeatability claim.

Closed evidence-limited Tactical
[`141`](../tactical/141-product-wan-tcp-utp-comparison.md) reused the same
ordinary product owner with simultaneous independently verified TCP and UDP
mappings. Its bounded replacement invocation retained one exact 8 MiB uTP
case, no TCP case, and zero complete pairs after remote-oracle evidence defects
exhausted the attempt budget. Both mappings and every owner/artifact cleaned
after every attempt. Product incoming reachability remains proven by Tactical
`140`; no comparative rate or reachability-policy change follows from
Tactical `141`.

Tactical
[`089`](../tactical/089-coordinated-session-listen-sockets.md) is complete.
Schema version 11 persists a preferred listen port, default `6881`; one
application-generation allocator resolves actual TCP and UDP endpoints under
the shared ten-retry/system-fallback policy; and one bounded UDP receive owner
serves DHT. It provides the transport prerequisite consumed by Tactical `092`.

Completed Tactical
[`092`](../tactical/092-truthful-tracker-and-dht-peer-advertisement.md)
selects mapped-external or actual local TCP ports only
for incoming-routable torrent generations, retains tracker-only discovery on
the explicit port-`1` sentinel otherwise, adds token-authenticated explicit-
port DHT self-announcement, and moves discovery scheduling into the long-lived
torrent/session lifetime. Completed Tactical
[`095`](../tactical/095-bounded-http-https-tracker-transport.md) applies the
same truth to HTTP and HTTPS. At that checkpoint, IPv4 tracker requests could
advertise the eligible IPv4 endpoint while every IPv6 request used port `1`;
returned `peers6` could drive outbound IPv6 TCP transfers. Tactical `112`
supersedes that family-port limitation below.

Completed Tactical
[`097`](../tactical/097-live-client-settings-and-replaceable-session-generations.md)
keeps registrations, peer tasks, upload scheduling/accounting, UDP routing,
DHT, discovery, and endpoint state stable around replaceable TCP/UDP
accept/receive generations. All five persisted settings now reconcile live in
durable and ephemeral profiles. Candidate failure retains the prior effective
transport, mapping cleanup remains finite and non-advertised, and peer and
slot changes preserve stable peer identity and exact counters.

Completed Tactical
[`102`](../tactical/102-ordinary-incoming-listener-settings.md) corrects the
product boundary: ordinary automatic and fixed modes bind TCP and coordinated
UDP on all IPv4 interfaces. The shared product UI exposes only Automatic or
Fixed port selection. Disabled, loopback, and preferred-candidate controls
remain internal facilities for tests and headless tooling, not normal client
settings.

Completed Tactical
[`112`](../tactical/112-dual-stack-transport-and-ipv6-dht.md) adds an
independent TCP/UDP pair bound to one probe-selected eligible global-unicast
IPv6 address beside the IPv4 pair. Each family owns its actual listener and
advertised port; a failed family leaves its sibling serving. IPv6 tracker and
DHT advertisement may now carry the listener-backed `GlobalUnicast` endpoint,
but no pinhole, gateway permission, or observed incoming IPv6 reachability is
implied. Tactical `113` owns that next evidence boundary.

Active Tactical
[`113`](../tactical/113-ipv6-firewall-pinhole-and-incoming-reachability.md)
now implements that mechanism boundary without promoting the evidence claim.
The existing generation-fenced reachability coordinator owns an independent
finite-lease `WANIPv6FirewallControl:1` TCP-pinhole slot beside the IPv4
mapping slot, shares one root-device discovery, and orders both cleanup paths
before listener shutdown. `GlobalUnicast`, gateway-reported `Unfiltered`, and
accepted `Pinholed` are distinct advertisement evidence; none is an observed
incoming connection. Deterministic and scripted-gateway lifecycle,
independence, uncertainty, and zero-owner tests pass. The identity-free
physical harness is committed, but its opt-in off-LAN transfer and gateway
cleanup proof does not pass: the live negative control succeeds, then the
observed gateway returns typed SOAP fault `606` to `AddPinhole` on the safely
correlated control path. No pinhole was created. Tactical `113` remains at its
evidence-limited closure: positive physical capability is unknown on the
current hardware, URL correlation remains unchanged, and incoming IPv6
reachability is not claimed.

## Purpose And Scope

This topic owns the vertical product story from a locally bound BitTorrent
peer listener through useful seeding and externally reachable incoming
connections. It coordinates listener lifecycle, incoming handshake routing,
verified payload upload, upload scheduling and accounting, actual-port
advertisement, gateway port mapping, application settings, product status,
and the evidence required to claim each step.

This is a campaign and readiness record rather than one implementation
tactical. Each implementing tactical must retain one bounded, falsifiable
end-to-end outcome. The suggested sequence below distinguishes completed,
drafted, and prospective slices; drafting and numbering a slice does not by
itself authorize or prioritize implementation.

The topic does not make PEX, local service discovery, BEP 55 hole punching, a
remote daemon, or broad public-swarm seeding part of the first slice. Incoming
MSE/PE has since been implemented as its own bounded Tactical
[`111`](../tactical/111-mse-peer-stream-encryption.md) slice. The separate
[`utp-transport-campaign`](utp-transport-campaign.md) owns uTP's adaptive
direction. Those capabilities may depend on this foundation but keep their own
protocol, ownership, security, and evidence requirements. Completed
Tactical [`093`](../tactical/093-bep6-fast-request-lifecycle.md) records the
Fast upload request/reject lifecycle against the established upload owner,
including terminal cancel/read/shutdown races and controlled pinned-libtorrent
seeding, while completed Tactical
[`094`](../tactical/094-bounded-bep11-peer-exchange.md) adds PEX only after
truthful advertisement and duplicate-connection resolution. Incoming verified
public registrations advertise `ut_pex` and the actual listener `p`; private
registrations omit PEX. Neither changes this campaign's current action.

## Current Truth

RSTorrent can download real v1 torrents and the controlled pure-v2 and strict
hybrid source/magnet subsets through outgoing peers, and can seed controlled
incoming peers locally or through one proven UPnP-mapped public TCP endpoint:

- immutable bootstrap includes internal disabled and automatic/fixed loopback
  policies for controlled use plus ordinary automatic/fixed IPv4 policies;
  ordinary modes bind `0.0.0.0`, retain a best-effort concrete routed address
  for reachability bookkeeping, and report fixed bind failure as typed state;
- clean installed Windows x86_64 `0.1.0` and `0.1.1` do not currently start
  under that fresh ordinary default: the multicast source-selection probe
  returns loopback, the engine rejects it and falls back to `0.0.0.0`, and
  application validation rejects the wildcard. Target-native comparison
  proves a zero-byte documentation-unicast probe selects the active eligible
  adapter and exactly matches Windows' best route. Completed Tactical
  [`160`](../tactical/160-windows-local-network-address-selection.md) lands
  that dependency-free fallback on `main`, removes wildcard publication, and
  adds passing native Windows selector and fresh-default application-service
  coverage. Tactical `158` still must publish and prove a signed repaired
  package before the Windows beta lane is runnable;
- one joined session listener uses a five-entry backlog, bounds eight
  pre-handshake tasks, and routes version-tagged 20-byte v1 or v2 swarm keys
  through up to 1,024 generation-fenced registrations. It admits peers under
  one session budget shared with outgoing connecting and established sockets;
- that listener detects ordinary BitTorrent versus MSE before torrent identity,
  shares the existing handshake deadline and four-job session DH owner, and
  uses a collision-preserving `req2` index for expected `O(1)` provisional
  routing; the decrypted BitTorrent handshake must validate the same info hash
  before ordinary duplicate admission. `disabled` refuses MSE, `allow` and
  `prefer` accept either transport, and `required` refuses new plaintext while
  established generations retain their captured policy;
- the ordinary connection default is 200 after descriptor-aware clamping,
  accepted incoming sockets have exactly ten connections of slack, and all
  loopback sockets consume those limits;
- eligible complete, published, desired-running path- and supported
  SAF-backed torrents register at completion and application open, and
  unregister before lifecycle or storage-authority changes. Both use the
  common logical published-content owner, verified/readable availability,
  session file pool, and read admission;
- complete info-only pure-v2 or hybrid magnets rebuild their descriptor from
  authenticated durable info at application open. Negotiated/direct v2 peers
  can obtain BEP 9 metadata, authenticated piece/leaf hashes, and only
  verified payload through the same bounded registration; a hybrid's v1 lane
  serves the same dual-verified payload and synthetic padding. No complete
  outer metainfo or durable sparse-hash cache is invented;
- admitted metadata-verified incomplete torrents install a generation-fenced
  active route as soon as storage exists. Initiated and accepted peers share
  the ordinary download swarm, dynamic verified/readable availability,
  session choking, ten-read and 40-handle authorities, exact contribution and
  upload accounting, and the same integrity reputation. Publication may close
  those sockets before the published registration replaces the namespace;
- every peer starts choked; one session coordinator grants at most eight
  upload slots, including one automatically derived optimistic slot, using
  pinned libtorrent's fixed-slot, 15/30-second, and complete-seed round-robin
  defaults;
- each unchoked peer may retain exactly 2,000 validated request descriptors;
  ten shared reads, the existing 40-handle storage pool, a 528,396-byte writer
  charge, and 64 writer descriptors independently bound work and memory;
- negotiated Fast peers receive exactly one initial availability state and a
  canonical IPv4 allowed-fast set of at most ten pieces; every valid request
  reaches one piece/reject terminal outcome through choke, cancel, read,
  pressure, pause, and shutdown while ordinary peer behavior remains intact;
- peer, torrent, and session accounting records only physical piece payload
  successfully written, and bounded snapshots expose exact totals and rates;
- pure, storage, socket, lifecycle, application-restart, and simultaneous
  two-RSTorrent/two-libtorrent evidence passes for single-file and cross-file
  content, with all four peers independently verifying 67,109,595 bytes and
  the seed recording the exact 268,438,380 uploaded payload bytes;
- one schema-version-11 atomic settings group persists listener intent,
  explicit disabled-or-UPnP mapping policy, 1--2,000 ordinary peer
  connections, 0--50 upload slots, and a preferred automatic listen port in
  `1024..=65535`; fresh product profiles default to an automatic local-network
  listener on preferred port `6881` with UPnP mapping enabled, while existing
  stored settings and historical migrations remain unchanged and
  active/effective/bound/mapped state stays distinct from configured intent;
- the generated application contract retains the closed internal policies;
  the shared browser/Tauri Settings surface exposes only automatic or fixed
  ordinary port selection, descriptor-derived effective limits, live
  convergence, and typed recoverable bind failure;
- incoming peer tasks now attach routed generations to the retained ordinary
  torrent peer owner and publish complete connection/upload observations;
- existing Peers/Swarm mapping projects the connected incoming generation,
  accepted non-connectable endpoint, identity and negotiated extensions,
  interest/choke/grant, queues, exact upload total/rate, compact flags, and
  exact post-cleanup removal;
- one generation-fenced coordinator owns at most one IGD v2
  `WANIPConnection:2` mapping and one task, requests a 3,600-second finite TCP
  lease, renews at 75 percent, publishes bounded state and diagnostics, and
  deletes before listener shutdown;
- a controlled external peer directly downloaded and hash-verified all 257
  pieces and 4,195,035 payload bytes through the mapped endpoint; ordinary
  Peers/Swarm views observed incoming TCP state, exact physical upload passed,
  independent query proved deletion, and a post-delete connect failed;
- automatic listening begins from the durable preferred port, shares ten
  address-in-use retries across TCP then UDP, requests system-selected ports
  on exhaustion, and never wraps `65535`; fixed listening binds the configured
  TCP and UDP numeric port atomically or reports failure;
- one application-generation socket set attempts an independent TCP/UDP pair
  per enabled family, hands each TCP listener to incoming peers, and hands
  both UDP sockets to one bounded receiver with a 64-datagram DHT route; DHT
  sends through the matching family socket, one-family failure retains its
  sibling, and disabled or failed TCP retains independently bound ephemeral
  DHT UDP service;
- runtime state and diagnostics separately expose configured preferred port,
  actual TCP, actual UDP plus coordination state, mapped external TCP, and
  mapped external UDP/uTP;
  controlled loopback and eligible local-network peers observed the reported
  TCP listener and exact DHT UDP source, with joined terminal ownership;
- UDP, HTTP, and HTTPS tracker announces carry exact current counters plus the
  endpoint selected for their connection family: mapped or listener TCP for
  eligible IPv4, listener-backed `GlobalUnicast` TCP for eligible IPv6, and
  port `1` when that family has no publishable listener;
- tracker address-family selection happens before query construction and
  source binding. An IPv6-literal or AAAA-only tracker therefore receives only
  the IPv6 family's port and uses the probe-selected IPv6 source; it never
  borrows an IPv4 endpoint. Compact `peers6` remains independently useful for
  outbound dialing;
- each DHT node uses its family session UDP transport; eligible IPv4 verified-
  public seeds explicitly announce the independently selected UDP/uTP port,
  while IPv6 retains its listener-backed TCP port until IPv6 uTP exists; and
- PCP, NAT-PMP, IGD v1/WANPPP, positive physical IPv6 pinholes, and positive
  product off-LAN UDP reachability remain absent.

The implementation adds cohesive `peer_io`, `upload`, `seed_content`,
`incoming`, and session `incoming_seeding` owners instead of extending the
download driver or detached diagnostic seed. One application-lifetime peer ID
is shared by outgoing handshakes, tracker announces, and the listener, so
self-connection rejection is local to an application rather than the
RSTorrent client fingerprint.

[`capability-readiness.md`](capability-readiness.md) remains authoritative for
priority and non-exclusive active/ready work sets. Completing these bounded
slices does not silently change the status of settings, advertisement, or
mapping work.

## Desired End State

The completed campaign should let one first-party in-process engine:

1. bind an explicitly configured or automatically selected peer port;
2. accept and route hostile incoming handshakes to eligible torrents;
3. serve only verified metadata and payload under bounded upload policy;
4. retain a supervised seeding owner after download completion and across
   supported restart paths;
5. bind a deliberately eligible non-loopback interface before requesting
   Internet exposure;
6. map that real local endpoint through a supported gateway mechanism when
   mapping is enabled and useful;
7. derive an advertisable endpoint from current listener, interface, and
   mapping state, then supply it to trackers, DHT, and later local discovery;
8. expose configured, bound, mapped, advertised, failed, and
   observed-incoming state
   without conflating them; and
9. stop advertising, accepting, uploading, and mapping through an observable
   joined shutdown path.

Local seeding, LAN reachability, mapped Internet reachability, and observed
incoming success are separate evidence levels. Passing an earlier level must
not be described as proof of a later one.

## Accepted Campaign Invariants

### A listener precedes reachability claims

An actual successful bind is the authority for the local peer port. Tracker,
DHT, extension-handshake, local-discovery, and mapping owners must consume
that observed state rather than a conventional constant or independently
configured copy.

No port is mapped or advertised as reachable before the corresponding
listener is accepting. If a fixed-port bind fails, the product reports that
failure; it does not silently choose another port unless the selected policy
explicitly permits automatic fallback.

A loopback-only listener is not eligible for gateway mapping. Internet
reachability first requires an intentionally selected non-loopback local
interface and a listener that can accept packets forwarded to that address.

A gateway may assign an external port different from the requested local
port. The advertised external port is therefore derived runtime state, not
assumed equality with the listener port and not durable configuration.

### One session owner, bounded torrent routing

The peer listener is shared session infrastructure rather than one listener
per torrent. One identifiable native owner binds it, supervises its accept
loop, bounds pre-handshake work, routes a validated v1 info hash to an
eligible torrent, and joins every intake task during shutdown.

The exact crate and module placement belongs to the first tactical's owner
map, but the hot path remains native and in-process. Platform adapters must
not become socket or piece-payload proxies.

Unknown hashes, inactive or removed torrents, stale registrations, duplicate
connections, and torrents without readable verified content are ordinary
bounded rejection paths. Listener state must not retain a torrent after its
application owner has completed removal or shutdown.

Unregistration joins accepted peer tasks, so teardown must never wait on an
accepted peer that is blocked on a queue the teardown has stopped draining.
An active download closes its inbound content-event queue before it
unregisters its route; Tactical 327 records the Android removal hang this
prevented.

### Completion does not terminate seeding ownership accidentally

Verified download completion and task termination are not synonymous once
seeding exists. A completed torrent that remains eligible to seed needs a
supervised owner capable of reading its verified storage, observing policy,
and terminating on pause, archive, removal, application shutdown, or a
reached seeding goal.

That owner must use the ordinary torrent/session lifecycle. It must not be a
detached diagnostic server that independently opens artifacts and outlives
the application catalog.

### Only verified content is uploaded

Piece verification remains authoritative. Incoming peers may receive only
metadata authorized by the torrent identity and payload ranges backed by
currently verified have state. A bitfield or HAVE message must reflect the
pieces RSTorrent can actually read, including selective-storage cases; it
must not imply that skipped or absent pieces are available.

Every request is validated for message shape, piece index, offset, length,
overflow, verified availability, and negotiated connection state before
storage work is admitted. Cancel, disconnect, pause, recheck, hash-state
change, and removal must make queued reads and responses harmless.

### Unauthenticated intake and upload work are independently bounded

The campaign keeps separate limits for:

- accepted sockets waiting for a handshake;
- handshake bytes and completion time;
- established incoming connections;
- total session and per-torrent connections across both directions;
- queued peer requests and response bytes;
- storage reads in flight;
- peers currently allowed to receive payload;
- aggregate and per-torrent upload bandwidth; and
- diagnostic and recent-history retention.

An incoming connection limit is not an upload-slot limit, and an upload-slot
limit is not a bandwidth or seeding-goal policy. One slow reader or saturated
event consumer must not block listener intake, unrelated peer commands, or
joined shutdown indefinitely.

### Mapping is renewable soft state

UPnP IGD, PCP, and NAT-PMP mappings are volatile leases owned beneath one
session reachability coordinator. They are created only for real bound
protocol endpoints, renewed before expiry, replaced when the relevant
interface or port changes, and removed on clean shutdown when practical
(within the shared shutdown cleanup budget of Tactical 366).
Crash recovery relies on bounded lease expiry and fresh discovery rather than
persisting a mapping as trusted state.

PCP and NAT-PMP share a gateway and transition relationship: a mature client
tries PCP and falls back to NAT-PMP when the gateway explicitly reports an
unsupported version. UPnP IGD is a separate discovery and SOAP/XML control
path. Supporting one path does not justify claiming the others.

The initial TCP campaign does not invent a `listener + 1` UDP convention.
Completed Tactical
[`089`](../tactical/089-coordinated-session-listen-sockets.md) replaces the
independent DHT bind with a libtorrent-informed session socket set: a persisted
preferred port, coordinated TCP/UDP allocation, one bounded UDP receive owner,
and DHT transport consumption. Completed Tactical
[`125`](../tactical/125-shared-udp-utp-runtime-and-loopback-interop.md) now
adds a separate bounded uTP route to that receive owner and proves one
explicitly injected incoming IPv4 loopback stream through the existing peer-
budget, registration, identity, upload, content-read, and cleanup path.
Completed Tactical
[`131`](../tactical/131-bounded-product-utp-composition.md) construction-only
policy now starts that fixed-548 service in the application and proves one
incoming IPv4 loopback transfer through the same ordinary admission owner.
Completed Tactical
[`133`](../tactical/133-utp-product-default-enablement.md) makes that service the
common application construction default. Completed Tactical
[`140`](../tactical/140-incoming-utp-reachability.md) now supplies the truthful
IPv4 product UDP lease and DHT announce policy while retaining TCP tracker
truth. Its controlled gate passes, and one ordinary product-owned finite UDP
mapping now carries an exact off-LAN incoming-uTP transfer with zero TCP
masking and exact cleanup. Public-DHT discovery over that mapped endpoint and
a repeatable WAN cohort remain unproved. Tactical `127`'s temporary remote
diagnostic UDP lease remains the complementary earlier controlled WAN
direction.

### Configuration, actual state, and evidence remain distinct

User intent such as `Automatic` listening is not proof that a socket bound.
A bound listener is not proof that a gateway mapping succeeded. A successful
mapping response is not proof that an external peer connected. Product state
and diagnostics must preserve those distinctions.

Settings are added only with an enforcing owner. Presentation may follow the
semantic contract, but a UI control must not precede behavior or expose an
unenforced placeholder.

## Settings Vocabulary

The campaign should use explicit settings rather than one ambiguous
"seeding limit":

| Setting or policy | Meaning |
| --- | --- |
| Listener policy | `Disabled`, preferred-with-bounded-fallback `Automatic`, or exact `Fixed` local TCP port. |
| Preferred listen port | First TCP/UDP candidate for automatic listening; default `6881`, applied live, and not an actual endpoint. |
| Pending-handshake limit | Maximum unauthenticated sockets admitted before torrent routing. |
| Incoming-connection limit | Maximum established inbound peers, coordinated with total connection budgets. |
| Upload-slot limit | Maximum peers currently allowed to receive requested payload. |
| Upload bandwidth limit | Aggregate and, if evidence requires it, per-torrent payload rate. |
| Seeding goal | Priority-only libtorrent-shaped thresholds (Tactical 201): meeting one lowers seed-queue rank and never stops the torrent. |
| Seeding stop limit | Share ratio or seeding time at which a finished torrent is durably stopped (Tactical 344), session-wide with a per-torrent override. |
| Automatic mapping policy | Whether supported gateway mapping mechanisms may expose real bound endpoints. |

The first local slice may use conservative immutable configuration supplied
by its harness and product bootstrap. Persistence and mutation belong to a
later application-settings slice. Ratio and elapsed-time goals wait for exact
upload accounting and completed-torrent lifecycle; they are not approximated
from diagnostic counters.

Listener and reachability observation should at least distinguish:

- disabled;
- binding;
- listening with an actual local address and port;
- bind failed with bounded actionable context;
- mapping in progress;
- unmapped or mapping unavailable;
- mapped with mechanism, interface, external address, port, and lease age;
- mapping renewal failed while the local listener remains usable; and
- an incoming peer handshake actually observed.

These are runtime observations rather than a single durable status enum.

## Suggested Tactical Implementation Order

The entries below are prospective slices, not created tacticals. Before each
slice begins, its tactical must follow the source-first campaign contract,
settle its owner/task/cancellation map and resource bounds, and name one
falsifiable stopping condition.

### 1. [Local single-peer TCP seeding](../tactical/078-local-single-peer-tcp-seeding.md) — complete

Tactical `078` establishes the smallest real product path from a
session-owned TCP listener to verified upload:

- bind an explicit loopback or controlled local address and report the actual
  port;
- bound accept and pre-handshake intake, route the v1 info hash, and reject
  invalid or unavailable torrents;
- retain or start the supervised torrent upload owner needed after verified
  completion;
- support the minimum peer-wire and BEP 9 behavior needed to advertise
  available pieces and serve bounded verified requests; and
- join the listener, pending handshakes, upload reads, and peer tasks.

The controlled stopping condition passed: libtorrent `2.0.13` verified exact
payload after dialing the listener with its incoming side disabled, and an
RSTorrent magnet leecher acquired BEP 9 metadata plus complete content from
the restarted application seed using only `x.pe`. The fixtures cover ordinary
single-file data and multi-file reads crossing boundaries with a short final
piece. Scripted evidence covers silent and malformed handshakes, unknown and
self hashes/identities, saturation, invalid and excessive requests,
cancellation, lifecycle fences, and joined shutdown.

NAT mapping, public discovery, settings UI, uTP, incoming encryption,
multi-peer choking strategy, and ratio/time goals remain out of scope.

### 2. [Bounded multi-peer upload ownership and accounting](../tactical/082-bounded-multi-peer-upload-ownership.md) — complete

Grow from one useful incoming peer to a coherent bounded upload owner:

- coordinate inbound and outbound session/torrent connection budgets;
- admit, choke, unchoke, and rotate a bounded number of upload slots;
- bound queued requests, reads, and serialized responses per peer and across
  the torrent;
- add exact protocol and physical piece-payload upload accounting plus rates;
- prevent slow readers and storage latency from starving unrelated work; and
- retain prompt pause, completion-policy, removal, and shutdown joins.

Controlled simultaneous RSTorrent and libtorrent evidence now proves exact
content, declared high-water marks, and cleanup. Two peers of each kind
overlapped against one seed and independently verified the 67,109,595-byte
fixture; exact physical upload was four copies, or 268,438,380 bytes. Scripted
ten-peer evidence proves the eight-slot ceiling, one optimistic slot, fair
rotation, slow-writer isolation, cancellation fencing, and joined cleanup.
Downloading-torrent tit-for-tat and public performance tuning remain later.

### 3. Persisted client connection and seeding settings — complete

Tactical
[`084`](../tactical/084-persisted-client-connection-and-seeding-settings.md)
implements one typed, atomic settings group for loopback listener policy, the
ordinary session-wide peer ceiling, and piece-payload upload slots. It adopts
the pinned libtorrent defaults where existing owners have equivalent
semantics. The listener-disabled implementation posture recorded by that
tactical has since been replaced for fresh product profiles by automatic
local-network listening with UPnP mapping.

The slice originally owned validation, typed SQLite persistence,
configured-versus-active restart semantics, startup enforcement, generated
contracts, the shared browser/Tauri Settings surface, and equivalent headless
behavior. Tactical `097` now applies that persisted group live with explicit
configured/effective convergence and no schema change.
Pending-handshake and incoming-slack tuning remain internal safety policy.
Tactical `134` subsequently supplies finite session/torrent peer-transfer
limits. Completed Tactical `201` adds durable payload accounting, fresh
reset/schema policy, global ratio/time priority goals, and combined seed
admission under the exact pinned libtorrent semantics. Its controlled
six-torrent oracle proves limits one and two, threshold reordering, goal-met
continuation, restart-equivalent winners, exact tracker events and payload,
and terminal cleanup.

Controlled product evidence persists automatic/37/one through the production
web gateway, reopens onto an observed nonzero listener, and seeds an exact
2,097,152-byte payload to outbound-only libtorrent. A held fixed port reopens
as typed address-in-use, remains command-accessible, repairs to automatic, and
reopens successfully. Seeding high water remains within all declared
connection, slot, request, read, writer, and 40-handle limits; every joined
generation ends with zero incoming, gateway-connection, storage, cache, and
platform-request owners.

### 4. [Long-lived torrent peer runtime](../tactical/086-long-lived-torrent-peer-runtime.md) — completed

Move ordinary peer state from the active download operation into one
application-generation per-torrent runtime, then use incoming integration as
the vertical proof:

- preserve the current one-active-download policy while making the peer
  registry, connection generations, IDs, and snapshot sink survive download
  completion;
- attach a routed incoming socket to that state after its info hash is known;
- project upload lifecycle, exact totals/rates, endpoints, identity,
  capabilities, choke/interest, and optimistic grant through the existing
  Peers model and compact flags;
- add one bounded non-connectable `incoming` Swarm observation for the remote
  ephemeral endpoint; and
- prove download-to-seed continuity, restart, lifecycle fencing, keyed row
  removal, and joined shutdown with RSTorrent and pinned libtorrent peers.

This slice did not add concurrent multi-torrent work, change any listener or
upload limit, or add advertisement, mapping, protocol, settings, or UI
breadth. Completed Tactical
[`090`](../tactical/090-peer-id-duplicate-connection-resolution.md) subsequently
installed mature duplicate-peer admission at the shared validated-handshake
boundary without changing those reachability owners.

### 5. Non-loopback listener and reachability ownership — complete

Extend listener policy only far enough to bind an explicitly eligible local
IPv4 interface, and introduce one session reachability coordinator that
consumes the resulting bound endpoint and listener generation. Interface
replacement, rebind, cancellation, bind failure, and shutdown must invalidate
dependent work before a stale mapping or advertisement can survive.

This slice must not treat wildcard binding as permission to expose every
interface, infer that a private address is publicly reachable, or feed the
local port directly to public tracker or DHT advertisement. The bound endpoint
is authoritative input to mapping, not yet an externally usable endpoint.

### 6. Observed-network UPnP IGD mapping — complete

Implement the mapping mechanism available on the real validation network
before adding unobserved alternatives. A non-mutating inspection on
2026-08-05 established the first target:

- the default IPv4 gateway answered SSDP as an Internet Gateway Device v2 and
  advertised `WANIPConnection:2`;
- its device description and service schema advertised external-address,
  specific/generic mapping lookup, `AddPortMapping`, `AddAnyPortMapping`,
  delete, and mapping-range operations;
- a read-only `GetExternalIPAddress` SOAP action completed successfully;
- the returned globally routable IPv4 address matched an independent
  Internet-side address observation, with no additional IPv4 CGNAT layer
  observed; and
- three bounded NAT-PMP external-address requests and three PCP `ANNOUNCE`
  requests received no response.

Tactical `088` implements a generic, bounded UPnP
IGD v2 path against the observed `WANIPConnection:2` service: SSDP discovery,
device and service-description parsing, URL resolution, external-address
lookup, TCP add/query/renew/delete behavior, typed SOAP faults, replacement on
listener or interface change, explicit disable, and joined cleanup. The code
must rediscover devices and services; the observed gateway address, UUID,
model, control URL, and external address are evidence, not configuration or
hard-coded product knowledge.

Validation did not stop at a successful SOAP response. A temporary finite
mapping for the real non-loopback listener was independently queried, a
controlled peer outside the LAN dialed the public endpoint and verified exact
torrent payload, and shutdown proved mapping absence, failed reconnect, and
terminal zero ownership. Same-LAN hairpinning was not used as evidence.

PCP and NAT-PMP remain later independent additions. Their specifications and
pinned libtorrent implementations may guide future designs, but source
inspection alone is neither runtime validation nor a protocol-support claim.
They should not precede the UPnP mechanism present on this network. When a
controlled or physical gateway is available, add PCP MAP with nonce, lease,
external endpoint, renewal, and PCP-to-NAT-PMP unsupported-version fallback,
then NAT-PMP external-address and TCP mapping with bounded serial requests and
lease recovery.

One reachability projection must eventually represent multiple successful
mechanisms without treating them as independent listener ports. Deterministic
codecs and state transitions precede scripted gateway servers. Physical-router
evidence remains environment-scoped, and mapping success alone is not an
external incoming-connectivity claim.

### 7. [Coordinated session listen sockets](../tactical/089-coordinated-session-listen-sockets.md) — complete

Before advertisement, replace the independent TCP and DHT UDP bind paths with
one application-generation allocator and one UDP receive owner. Automatic
listening starts from a persisted preferred port, tries the next ten candidates
under the pinned libtorrent policy, then uses an OS-selected port. UDP begins
from the actual TCP port but may diverge after a UDP-only conflict. Exact fixed
mode either binds both transports to its configured port or reports failure.

DHT consumes a bounded route from the shared UDP owner. The slice exposes
configured preference, actual TCP, actual UDP, and mapped external TCP as
separate facts and proves joined shutdown. It deliberately does not replace
the tracker constant, send DHT `announce_peer`, implement uTP, or map UDP.

The completed evidence covers all conflict/fallback modes, one receiver with
a 64-datagram queue and terminal zero ownership, a controlled DHT query whose
source equals the runtime UDP endpoint, and TCP connects to that generation's
reported loopback and eligible local-network listeners. Fixed TCP failure
leaves DHT available on an explicitly independent ephemeral UDP endpoint.

### 8. [Truthful tracker and DHT peer advertisement](../tactical/092-truthful-tracker-and-dht-peer-advertisement.md) — complete

The reachability coordinator now supplies the current eligible listener and,
where active, authoritative mapped endpoint to the long-lived discovery owner:

- tracker announces consume the selected advertised peer port and react to
  listener or mapping changes without independent constants;
- incomplete or otherwise unroutable torrents retain outbound tracker
  discovery through the explicit port-`1` sentinel rather than claiming the
  session listener;
- DHT `announce_peer` begins only after verified public metadata, active
  incoming registration, and an eligible endpoint make the port claim
  truthful;
- private-torrent gating remains exact;
- tracker advertisement stops and DHT reannouncement cancels before listener
  shutdown, mapping invalidation, or torrent ineligibility; and
- mapped external-port changes trigger bounded corrective announcements.

Controlled tracker-only and DHT-only libtorrent leechers now discover and
complete from RSTorrent without an explicit peer hint. In the physical gate,
both wire mechanisms carry the independently queried live mapped TCP port; an
off-LAN verifier uses the tracker-decoded port for an exact 4,195,035-byte
hash-verified transfer. Joined shutdown sends eligible tracker stopped,
cancels DHT reannouncement, deletes the mapping, and leaves the endpoint
unreachable. BEP 10 listen-port advertisement and LSD remain separate.

BEP 5 has no immediate peer-withdrawal query. This slice proves cancellation
of new announces, eventual controlled-node expiry, and failed connection to a
stopped listener rather than claiming deletion of remote soft state.

### 9. Product settings, status, and platform evidence

Expose the proven semantic settings and reachability states through the
appropriate product surfaces. Desktop/web and Android may present different
controls, but both consume the same application meaning.

The UI distinguishes configured port, actual local port, mapped external
endpoint, mapping mechanism and renewal health, and observed incoming
success. Platform work includes Android local-network permission and
foreground lifecycle, interface and VPN changes, desktop firewall guidance,
and accessibility. Physical-device or public-network evidence remains
explicitly authorized and accurately scoped.

## Cross-Topic Ownership

- [`peer-lifecycle.md`](peer-lifecycle.md) owns connection observations,
  records, direction, lifecycle, duplicate-peer treatment, and connection
  usefulness once incoming peers join the swarm.
- [`download-correctness.md`](download-correctness.md) owns verified-piece
  authority, hash failure, request validity, and storage/read correctness.
- [`protocol-support.md`](protocol-support.md) owns the exact peer-wire, BEP 9,
  tracker, DHT, LSD, uTP, and hole-punching support claims.
- [`tracker-discovery.md`](tracker-discovery.md) owns tracker announce state and
  how the current advertised port enters that protocol.
- [`dht-discovery.md`](dht-discovery.md) owns self-announcement, token, private
  gating, and DHT participation once a peer port is usable.
- [`client-persistence.md`](client-persistence.md) owns durable settings,
  completed-torrent restart, counters needed for seeding goals, storage-root
  identity, and recheck authority.
- [`application-control.md`](application-control.md) owns semantic setting and
  lifecycle operations above the engine.
- [`client-surfaces.md`](client-surfaces.md) owns desktop/web and Android
  presentation and platform-specific adaptation.
- [`capability-readiness.md`](capability-readiness.md) owns campaign priority,
  current implementation state, and support-evidence roll-up.

This topic owns the dependency order and end-to-end reachability story across
those boundaries. A tactical updates every focused topic whose truth it
materially changes rather than moving all detail into this document.

## Reference And Source-First Requirements

Each implementing tactical must inspect the exact libtorrent revision pinned
in [`../../reference/pins.toml`](../../reference/pins.toml), including tests,
before finalizing the relevant state shape. The campaign is expected to draw
from, at minimum:

- libtorrent listen-socket, incoming-peer, upload, choking, port mapping,
  tracker-port, DHT announcement, settings, alert, and shutdown paths;
- `reference/libtorrent/src/upnp.cpp`, `src/natpmp.cpp`, and their exact tests
  when mapping enters scope; and
- the local JSTorrent listener, incoming routing, seeding, settings, UPnP,
  PCP, and NAT-PMP paths for first-party product and platform history.

The tactical records exact source and test paths, edge cases adopted,
intentional differences, and license/provenance decisions. Reference code is
a completeness oracle, not an architecture template or source donor.

Normative protocol reading must match the slice: the BitTorrent peer-wire and
extension specifications for upload, tracker and DHT specifications for
advertisement, and the applicable UPnP IGD, PCP, and NAT-PMP specifications
for mapping. No support claim comes from source inspection alone.

## Validation Ladder

Evidence graduates in layers:

1. **Deterministic state and codec tests:** listener policy, handshake routing,
   request validation, verified availability, upload admission, accounting,
   mapping leases, advertisement selection, and stale-event rejection.
2. **Scripted runtime failures:** bind conflicts, silent and malformed peers,
   limit saturation, slow readers, storage delays, cancellation at every
   owner boundary, interface replacement, gateway loss, renewal failure, and
   exact socket/task cleanup.
3. **Controlled interoperability:** RSTorrent-to-RSTorrent and
   RSTorrent-to-libtorrent metadata and payload seeding, then controlled
   tracker/DHT discovery and simulated mapping gateways.
4. **Product and platform evidence:** headless shared web behavior, desktop
   lifecycle, Android AVD behavior, and authorized physical-device checks
   when the slice changes those paths.
5. **Optional representative evidence:** controlled LAN/router and public
   incoming observations under the opt-in live-evidence policy.

Every layer records the exact listener address, advertised endpoint, mapping
mechanism, peer direction, transferred and verified bytes, resource
high-water marks, terminal owner counts, and what the evidence does not prove.

## Open Decisions

After completed Tactical `084`, the campaign direction does not yet settle:

- whether automatic port fallback is ever allowed after a fixed bind fails;
- whether the temporary rule that a desired-running complete torrent seeds
  automatically should become a distinct durable seeding intent;
- whether inactive/idle stop limits or remove-on-limit actions are wanted
  beyond Tactical 344's ratio and seeding-time stop limits;
- how to choose among multiple interfaces or successful external mappings;
- how VPN, metered networks, Android background lifecycle, and local-network
  permission affect listening and mapping;
- whether another mapping mechanism or a repeatable product-owned WAN cohort
  is justified after Tactical `140`'s positive single-path result; and
- when IPv6 firewall pinholes, LSD, or BEP 55 become independently justified
  tacticals. Incoming MSE/PE is implemented in Tactical `111`; bounded PEX is
  complete in Tactical
  [`094`](../tactical/094-bounded-bep11-peer-exchange.md); it does not itself
  authorize those transports or discovery mechanisms.

Tactical `084` resolves the initial default, bounds, persistence authority,
original restart semantics, and corrupt-row behavior. External-port and
multi-interface policy remain focused later slices. Completed Tactical
[`097`](../tactical/097-live-client-settings-and-replaceable-session-generations.md)
settles the live listener, mapping, connection-limit, and upload-slot direction
with explicit rebind, eviction, regrant, desired/effective, and failure
semantics. Its controlled handovers retain incoming and outgoing transfers,
DHT identity, discovery registration, upload counters, and bounded terminal
ownership. The production gateway proof keeps pinned libtorrent 2.0.13 on the
same established connection while the listener moves, advances its payload
counter during convergence, hash-verifies all 8,388,608 bytes, rejects the old
endpoint, accepts the new endpoint, and recovers a later held fixed port live.

## Campaign Checkpoint And Next Action

Tacticals
[`082`](../tactical/082-bounded-multi-peer-upload-ownership.md) and
[`084`](../tactical/084-persisted-client-connection-and-seeding-settings.md)
now complete bounded multi-peer upload ownership and the original persisted
product settings boundary. Tactical
[`086`](../tactical/086-long-lived-torrent-peer-runtime.md) now completes the
long-lived per-torrent peer owner and proves it through truthful incoming
projection in the ordinary Swarm/Peers model. Tactical
[`088`](../tactical/088-upnp-mapped-external-tcp-seeding.md) completes the
non-loopback listener, session reachability owner, UPnP IGD v2 mapping, and
externally dialed exact TCP seeding proof. Tactical
[`089`](../tactical/089-coordinated-session-listen-sockets.md) completes the
preferred-port, coordinated TCP/UDP allocation, bounded session UDP/DHT
owner, and actual-endpoint prerequisite. Tactical
[`092`](../tactical/092-truthful-tracker-and-dht-peer-advertisement.md) now
completes truthful UDP-tracker and explicit-port DHT advertisement across the
long-lived torrent lifetime, mapping correction, and ordered stopping. PCP and
NAT-PMP remain later independent slices until they have suitable runtime
evidence. Tactical
[`095`](../tactical/095-bounded-http-https-tracker-transport.md) now extends the
same port selector and ordering to HTTP/HTTPS and proves the outbound-only IPv6
case through controlled hash-verified transfers and Android product evidence.
Tactical
[`112`](../tactical/112-dual-stack-transport-and-ipv6-dht.md) now completes
dual-stack listener allocation, per-family endpoint selection, IPv6 source
binding, DHT participation, and live outbound evidence. Tactical `113` now
implements the independent IPv6 firewall-pinhole owner and its physical gate;
off-network incoming IPv6 reachability remains unclaimed until that opt-in gate
passes.
Tactical
[`097`](../tactical/097-live-client-settings-and-replaceable-session-generations.md)
now completes live convergence for listener, preferred port, UPnP mapping,
session peer limit, and upload slots through one stable session-network owner.
Tactical `134` extends that owner with finite bandwidth convergence; durable
accounting/reset policy and ratio/time goals remain separate future slices.
Completed Tactical
[`114`](../tactical/114-session-wide-concurrent-torrent-admission.md) keeps
complete-seed registration outside the new download-count gate while sharing
the existing peer, upload, read, and file-handle authorities. Its combined
scale test retains 500 complete registrations beside three active downloads;
ten interested peers receive exactly seven regular and one optimistic grant,
stay beneath the 200-peer and 40-handle ceilings, and drain download-resource
ownership at shutdown. No seed-rank or durable seeding-goal policy is implied.
Completed Tactical
[`116`](../tactical/116-platform-storage-coherence-and-ios-feasibility.md)
closes the prerequisite storage boundary after Tactical `114`: SAF published
content registers through the existing long-lived peer/upload owner and
reuses the session file pool, read admission, exact accounting, and joined
unregistration. AVD and physical runs each upload and independently verify
the exact 133,304-byte fixture through pinned libtorrent. No second seeding
runtime or new reachability policy was added.
Completed Tactical
[`124`](../tactical/124-duplex-verified-piece-upload.md) now closes the
whole-torrent gate. Compact per-piece authority, active selective reads,
initiated and accepted duplex sockets, contributor-ranked ordinary choking,
actual-port active discovery, failure retraction, and joined namespace fences
all use the established session owners. Controlled RSTorrent/libtorrent and
API 34 SAF runs prove complementary payload in both directions before
completion with exact hashes and bounded cleanup. Tactical `134` subsequently
enforces finite bandwidth at those duplex boundaries; ratio/time goals remain
a separate policy tactical.
Completed Tactical
[`140`](../tactical/140-incoming-utp-reachability.md) extends that same stable
session-network owner with independent product TCP and UDP leases and
transport-specific discovery. Deterministic, scripted, controlled DHT-only,
generated-client, and Android evidence passes. Its physical continuation
proves one exact product-owned public incoming-uTP transfer and zero-residue
cleanup; the preceding cleaned timeout keeps repeatability explicitly open.
Tactical `139` subsequently completed. The authoritative next checkpoint is
the readiness queue's selection of another bounded tactical, not an implicit
expansion of reachability or seeding policy.
