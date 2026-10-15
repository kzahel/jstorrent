# Performance And Live Evidence

Topic: `performance-and-live-evidence`

Status: Active measurement contract. The completed catalog-backed paired
RSTorrent/libtorrent comparator emits milestone, geometry, diagnostic,
cleanup, and classification JSON without opening a product surface. Its first
controlled and public full-download baselines are recorded below.
Tactical `122` adds direct-metainfo inputs, matched encryption/connection
profiles, independent piece verification, process resources, atomic owner
checkpoints, and a bounded quick real-torrent comparison. Public-swarm speed
remains a measured baseline, not a CI pass threshold.
Completed Tactical `127` additionally records one 82.239-second remote-mapped
uTP WAN transfer as a bounded observation, not a throughput threshold.
Closed Tactical `130` records the complementary bulk-send direction, an
evidence-limited bidirectional cohort, passing fixed real-socket impairment
profiles, and controlled diagnostic MTU measurements. These remain controlled
observations rather than public-swarm or product performance claims.
Completed Tactical `132` records one 2.862-second metadata-only ordinary-swarm
uTP readiness observation with both transports, bounded resources, and exact
cleanup. It is not a throughput baseline.
Completed Tactical
[`201`](../tactical/201-durable-seeding-goals-and-seed-admission.md) adds a
policy/resource qualification rather than a throughput claim. A 503-torrent
accounting model and the 497-seed/three-download hard-cap case retain the
existing 200-peer and 40-handle ceilings with no task, timer, or handle per
queued seed. The installed API-35 case observes 145 baseline, 168 high-water,
and 143 final process file descriptors, with SAF ownership at 11 of 40 handles
and two pending requests. The exact accounting wake tail is 1 MiB, the timer
tail is four seconds, and the real goal-crossing final flush is seven bytes.
Completed Tactical `137` records a controlled product-MTU comparison: five
alternating exact 2,097,883-byte pairs reduce median RSTorrent DATA datagrams
from 3,978 at fixed 548 to 1,473 at dynamic 1,457 bytes, a 62.97% reduction.
Median active time falls from 7.646 to 2.994 seconds and sampled seed CPU from
0.15 to 0.06 seconds; median RSS stays near 10.7 MiB and queue high waters do
not grow. This is a controlled packetization baseline, not a public-WAN speed
claim.
Closed evidence-limited Tactical `141` attempted a same-session public-WAN
TCP/uTP comparison. Its replacement budget retained one exact 8,389,339-byte
uTP case at 0.096759 MiB/s active and 0.094237 MiB/s connection-inclusive,
but no TCP case and no complete pair. The result supplies neither a ratio nor
a tuning direction; every attempt removed both mappings and all artifacts.
Completed Tactical `142` replaces that narrow attempt with a case-addressable
64-cell baseline across both engines, roles, physical directions, transports,
and 8 MiB through 1 GiB sizes. Its reusable lab retains host storage and route
calibration, per-case process/transport telemetry, atomic resume, and exact
cleanup. The initial complete 8 MiB grid selected focused Tactical `144`'s
long-RTT sender-window repair. That child is now complete: continuously queued
new DATA fills the admitted window, the unchanged upload-writer bound reserves
both possible Piece frames, and each uTP connection has measured ingress
headroom within the shared-UDP bound. Three rotating affected repetitions
improve 2.72x--4.48x; all four 64 MiB affected cells complete at
1.015--1.310 MiB/s, and the formerly churning remote RSTorrent/RSTorrent cell
improves 10.1x with one connection and zero drops/retry exhaustion.

The post-repair matrix then completed 56 exact cells and 13.125 GiB: full
8/64/256 MiB grids and all eight remote-seed 1 GiB cases. At remote-seed
1 GiB, all TCP pairings reach 2.609--2.641 MiB/s and libtorrent/libtorrent uTP
reaches 2.739 MiB/s. RSTorrent seed to libtorrent uTP reaches 1.200 MiB/s,
libtorrent seed to RSTorrent reaches 0.750 MiB/s, and RSTorrent/RSTorrent
reaches 1.107 MiB/s. Thus the remaining gap is neither the Pi disk nor the WAN
path ceiling.

Long cells instead expose RSTorrent connection turnover. Remote
libtorrent-seed/RSTorrent-leech uTP starts 2, 4, and 17 connections at
64/256/1,024 MiB and records 1, 3, and 16 retry-exhausted connections, with
the peer-wire terminal reason classified as `protocol`. RSTorrent/RSTorrent
shows the same size-dependent shape at lower counts. Connection-datagram drops
remain zero and queue high water stays at most 128 of 256. A composed transfer
through repeated 16-bit uTP sequence cycles is now the leading targeted
reproduction because only local arithmetic wrap tests exist; it is a
hypothesis, not yet a diagnosis. One local-seed 1 GiB libtorrent-only uTP
control was interrupted after 8,828 seconds with successful cleanup and is
excluded from ratios; the remaining seven local-seed 1 GiB cells are deferred.
Then-ready Tactical
[`145`](../tactical/145-sustained-utp-reliability-and-throughput-near-parity.md)
records the collection provenance, makes single-connection sustained
reliability the first gate, and then targets at least `0.85x` the alternating
matched libtorrent/libtorrent uTP median for every RSTorrent-containing
pairing. Controller-policy changes remain review-gated behind causal A/B
fairness evidence.

Tactical `145` has since repaired two release recovery defects. The second
allows an ACK/SACK-selected fast retransmission to bypass a congestion window
that loss reduction moved below the already admitted later flight, while
timer retransmission and new DATA retain ordinary admission. The exact
256 MiB RSTorrent/RSTorrent WAN verification stays on one connection, sends
766 recovery datagrams with zero retry exhaustion or peer error, and improves
from 1.154 to 1.504 MiB/s. This is one reliability sample, not the required
three-repetition throughput cohort.

WAN preparation also no longer compiles on the constrained peer. A guarded
Ubuntu 24.04 ARM64 UTM guest builds exact committed archives with Rust 1.97.0
and a persistent cache. The host and Pi fence every artifact by architecture,
glibc direction, size, SHA-256, dynamic dependencies, and revision before an
atomic install. The first full cached VM-to-Pi preparation took 87.880 seconds
and left no per-revision builder/upload stage or Pi compiler process.

The first repeated post-fast-recovery cohort then rotates three remote-seed
256 MiB forced-uTP repetitions at exact revision `c665835`. All 12 cells pass
integrity and cleanup, every RSTorrent role remains on one connection, and no
RSTorrent role reports retry exhaustion, peer failure, or content error.
Median active rates are 2.741 MiB/s libtorrent/libtorrent, 2.701 MiB/s
libtorrent/RSTorrent, 2.130 MiB/s RSTorrent/libtorrent, and 1.519 MiB/s
RSTorrent/RSTorrent. Those are 100.0%, 98.5%, 77.7%, and 55.4% of the matched
oracle; RSTorrent/RSTorrent's three samples span only 1.505--1.539 MiB/s.

The RSTorrent sender emits 220,461--224,277 DATA datagrams to libtorrent but
318,008--322,143 to RSTorrent for nearly equal wire bytes and equal roughly
650 KiB maximum flight. The latter composition also processes about four
times the ACK events and turns one or two loss reductions into 750--778
retransmissions, 614--638 timeout collapses, and 746--776 receive-reorder
rejections. The corresponding packetization A/B rejects copying libtorrent's
complete full-payload wait: that rule misses the clean 160 ms completion
ceiling and reduces TCP-like competitor overlap share to 58.26%. Suppressing
only residual fragments smaller than half the intended payload passes at
18.316 seconds and 70.37% competitor share without changing the controller. A
controlled 64 MiB product transfer then completes at 1.206339 MiB/s with
47,076 DATA datagrams, zero loss/drop, exact integrity, one connection per
role, and cleanup.

Three exact WAN RSTorrent/RSTorrent 256 MiB repetitions at `b6c69cd` span
1.562916--1.564864 MiB/s. Relative to the pre-repair medians, rate improves
2.94%, DATA datagrams fall 40.84%, congestion ACK events fall 39.73%, and
retransmissions, timeout collapses, and too-far-ahead drops each fall about
47%. All cases remain on one connection and clean up. The residual median
461-packet/663 KiB flight still produces 398 too-far drops beyond a 64-packet
reorder distance despite at least 925 KiB of advertised receive credit. The
next existing owner is a resource-accounted reorder-position bound; controller
constants remain unchanged and review-gated.

The bounded receive repair derives 953 positions from the unchanged 1 MiB
credit. Across 64 connections, payload ownership remains 64 MiB and the
conservative position-metadata allowance is at most 14.891 MiB. New runtime
high waters make both dimensions visible. Three exact WAN
RSTorrent/RSTorrent repetitions at `dba2677` use 462--464 positions and
664,614--668,205 bytes, complete at 2.136027--2.139756 MiB/s, stay on one
connection, and clean up. Relative to the packetization cohort median, rate
improves 36.85%, retransmissions fall 399 to one, and timeout collapses and
too-far drops fall to zero. The resulting 2.139183 MiB/s median is 78.0% of
the retained oracle and matches the earlier RSTorrent-to-libtorrent result;
residual work returns to sender utilization and review-gated startup policy.

WAN milestone telemetry then makes startup causal: with a full 1 MiB
application queue and no sender-underfill or remote-window limitation, 95,678
of 95,857 feedback events are congestion limited and the 256 MiB sender needs
roughly 90 seconds to reach path-rate flight. A test-only comparator leaves
ordinary product construction unchanged. The direct libtorrent-style startup
finishes the clean 80 ms one-way 8 MiB profile in 4.454 seconds instead of
18.382, but its 193.750 ms p95 queue delay fails the 150 ms gate.

The selected diagnostic candidate exits exponential growth on a 10 ms queue
signal and retains 30% of the pre-exit window, then uses the unchanged linear
controller. Three paired 70/80/90 ms one-way samples improve completion
1.88x--1.90x, retain zero loss/drop and exact integrity, and keep maximum
queue delay at 45 ms. The existing TCP-like foreground share improves from
70.37% to 82.65%; recovery remains within ten RTTs. Scripted 1% loss and
dynamic-MTU black-hole profiles preserve retry, loss, and isolated-probe
bounds. This was controlled policy-selection evidence, not a WAN throughput
claim. Maintainer approval selected the bounded candidate; completed Tactical
[`150`](../tactical/150-bounded-utp-sender-startup.md) promotes it to
production and supplies the missing WAN result.

The stable remote-seed 256 MiB cohort completes all 24 TCP/uTP cells across
four pairings and three repetitions. RSTorrent-containing uTP medians reach
100.74%, 97.34%, and 94.85% of matched libtorrent uTP and at least 98.49% of
their own TCP medians. Every RSTorrent sender sample remains on one connection
without retry exhaustion or terminal failure; queue-delay high water is at
most 80.150 ms and RSS remains below 20 MiB. Fourteen exact 1 GiB cells then
place bounded RSTorrent-containing observations at 98.87%--100.27% of the
corresponding oracle and corroborate scale without forming a stable second
cohort. The campaign stops after 20 GiB exact payload because more volume no
longer selects a repair. A reverse local-seed smoke stops before payload on
typed absence of an accepted UPnP IGD service on the current network, cleans
exactly, and makes no reverse throughput claim.

Planned Tactical
[`153`](../tactical/153-wired-lan-utp-data-plane-scalability.md) owns a later
wired-LAN packet-rate ceiling measurement. The initial physical topology is
gigabit-effective because the development Mac has a 1 GbE USB-C adapter even
when the workstation negotiates 2.5 GbE. It uses both physical directions,
forced TCP/uTP, pinned libtorrent and own-TCP controls, 8 or 16 GiB stable
fixtures, native Linux or Windows, and a separate native Windows epoch when
available. It does not alter the completed WAN result or the status of other
active or ready work.

Completed Tactical
[`152`](../tactical/152-ios-multifile-selected-root-coordination.md) records a
product live-correctness result, not a speed baseline. The exact catalog Big
Buck Bunny magnet downloaded all 276,445,467 bytes and verified 1,055 of
1,055 pieces on the attached iPhone beneath a qualified external root. One
mid-run UI sample reported 13.7 MB/s, but changing public-swarm throughput is
not retained as a threshold. Publication, three-file visibility, advancing
Apple Files video playback, managed deletion, and empty-root cleanup pass.

Completed Tactical
[`128`](../tactical/128-controlled-tcp-performance-diagnosis.md) pauses uTP and
returns to byte-identical TCP-only loopback fixtures. It reproduces the
sustained large-transfer gap, rejects checkpoint sync, observation overhead,
resumable semantics, and storage-worker count as primary causes, and selects
storage intake backlog for ready Tactical
[`129`](../tactical/129-bounded-storage-intake-watermark.md). Explicit
maintainer direction subsequently superseded that unimplemented bounded plan
with completed near-parity Tactical
[`135`](../tactical/135-controlled-tcp-storage-near-parity.md). It retains the
independent watermark as its first stage and required at least `0.95x` pinned
libtorrent on both matched sustained plaintext and forced-RC4 cohorts before
closing. The final retained cohorts exceed both gates.

## Hierarchical Transfer-Rate Evidence: 2026-08-11

Completed Tactical
[`134`](../tactical/134-hierarchical-transfer-rate-enforcement.md) extends the
release multi-torrent comparator with restart-applied rate policy. A 256-KiB/s
session cap and a 256-KiB/s torrent cap under a 1-MiB/s session each admitted
2,099,608 counted bytes for exact 2-MiB content in 8.087 and 8.047 seconds,
using 99.0% and 99.5% of the effective rate interval. Both remained below the
declared burst-aware upper bound and terminated with zero waiters/queued
bytes.

The two-torrent fairness case used a 512-KiB/s session limit and unequal three-
peer/one-peer source counts. Exact outputs completed in 8.433 and 8.202
seconds, a 2.8% skew; 4,393,387 admitted bytes remained below the 4,963,998-
byte declared bound with 99.3% utilization, four peer connections at high
water, and terminal zero waiters/queued bytes. This gate exposed and corrected
a peer-count-sensitive initial allocator before completion.

A separate 64-KiB pinned-libtorrent full-duplex case combined 24-KiB/s session
and 16-KiB/s torrent limits in both directions. Exact content completed in
4.083 seconds with 65,746 upload and 65,918 download bytes admitted, both
below the 99,669-byte bound, positive throttling, and terminal zero queues.
The API 34 arm64 no-window Android product profile restored a 24-KiB/s session
download limit, completed three exact torrents in 23.671 seconds, admitted
393,363 bytes below its 622,692-byte bound, and ended with zero active
downloads, waiters, and queued bytes. These controlled rate-policy results are
cap/fairness/lifecycle evidence, not maximum-throughput baselines.

## Controlled TCP Storage-Intake Diagnosis: 2026-08-10

The retained release harness compares one focused RSTorrent process, the
application-shaped resumable process, and pinned libtorrent `2.0.13.0` against
one loopback libtorrent seed. Every result independently verifies all v1
piece hashes and the whole file, records one TCP and zero uTP peers, rotates
order, and removes its output before the next owner.

Three-run 1 GiB plaintext medians across 256 KiB, 1 MiB, 4 MiB, and 16 MiB
pieces placed the focused RSTorrent path at `0.839`, `0.910`, `0.848`, and
`0.838` of libtorrent. The resumable path measured `0.908`, `0.867`, `0.764`,
and `0.670`. Both retained the same 500-request/8,192,000-byte request window.
At 64 and 256 MiB payloads RSTorrent beat the reference's fixed startup cost;
the deficit appeared at 1 GiB sustained transfer.

Increasing write/hash workers above `2/2` did not close the gap. Six-run
alternating controls measured checkpoint-sync bypass at `0.988x` enabled,
summary activity observation at `0.974x` detailed, and resumable execution at
`1.103x` the same-probe nonresumable path. Those results reject durability
sync, instrumentation, and resume semantics as the first optimization owner.

The causal control was payload/storage backlog. With only the allowance
changed, 8/16/32/64 MiB produced monotonic 1 GiB/16 MiB-piece medians of
398.9/376.3/355.6/332.6 MiB/s. Corresponding payload high waters were
6/12/24/48 MiB and storage-job high waters were 399/782/1,550/3,083. The final
plaintext cohort measured libtorrent at 487.9 MiB/s, 64 MiB RSTorrent at 332.9
(`0.682x`), and the 8 MiB control at 394.4 (`0.808x`). Forced RC4 measured
371.3, 283.0 (`0.762x`), and 315.4 MiB/s (`0.849x`). The lower-backlog control
also roughly halved RSTorrent RSS without increasing median CPU demand.

This did not select an 8 MiB total memory limit. Tactical `135` subsequently
held a 64 MiB diagnostic resident ceiling and its 4,096-block channel capacity
constant while varying only the separate intake high point. Four alternating
1 GiB/16 MiB-piece plaintext repetitions measured libtorrent at 494.8 MiB/s;
RSTorrent reached 449.3/443.8/415.4/402.1/413.3 MiB/s at 1/2/4/6/8 MiB, or
`0.908x`/`0.897x`/`0.840x`/`0.813x`/`0.835x`. The 1 MiB control bounded payload
at exactly 1 MiB and jobs at 79, versus 527 jobs at 8 MiB.

The selected 1 MiB value then reached 341.9 MiB/s against 375.1 MiB/s forced
RC4 (`0.911x`). Plaintext 256 KiB, 1 MiB, and 4 MiB-piece controls reached
`0.945x`, `1.001x`, and `0.933x`, clearing the tactical's `0.90x` secondary
floor. Every case retained exact payload, one TCP and zero uTP peers,
publication, joined cleanup, zero failed/redundant bytes, and rotating order.
The release evidence is clean commit `b7dadad` on the Apple M4 Pro/APFS host
with pinned libtorrent `2.0.13.0`; raw JSON and payload artifacts were removed
after recording the results.

This selects a 1 MiB high and two-thirds low point without changing the 32 MiB
desktop or 16 MiB Android resident ceilings, request target, or channel cap.
It does not yet satisfy near parity. One same-config 1 MiB run naturally
packed 65,536 blocks into 6,294 write jobs (10.4 blocks/job) and reached 480.6
MiB/s against that run's 491.2 MiB/s libtorrent result. The other repetitions
used 10,647--10,794 jobs (about 6.1 blocks/job) and were slower. Tactical `135`
therefore tests bounded cooperative batch fill next; it does not infer that
the filesystem or SHA-1 arithmetic is the bottleneck.

That control is now rejected. A stronger version reduced write jobs from
roughly 10,700 to 4,954--5,618 and raised fill from about 6.1 to 11.7--13.2
blocks/job, yet its four-run median was 449.5 MiB/s against libtorrent at
500.9 MiB/s (`0.897x`). This was no improvement over the retained 449.3 MiB/s
baseline, and all candidate code was removed.

The next inspection found that each logical piece-hash operation dispatched
and allocated one blocking task per 16 KiB positional read. Amortizing those
reads into one fixed-buffer blocking task per physical file span reduced the
primary single-file geometry from 65,536 to 64 blocking dispatches. Four
alternating 1 GiB/16 MiB-piece plaintext repetitions then measured RSTorrent
at 565.7 MiB/s against libtorrent at 493.6 MiB/s (`1.146x`), a 25.9% gain over
the retained 449.3 MiB/s baseline. Aggregate hash service fell from roughly
7.0--7.6 seconds to 1.00--1.21 seconds for all 64 pieces. One included
RSTorrent outlier reached 298.1 MiB/s when write service doubled; the declared
median remained above parity. Every output independently verified, used one
TCP and zero uTP peers, published, joined, and cleaned up with no failed or
redundant payload. Tactical `135` retains this causal change and proceeds to
the remaining gates.

Clean commit `25e3761` clears the full controlled performance matrix. Four-run
alternating medians were 461.1 versus 376.5 MiB/s (`1.225x`) for forced RC4 at
16 MiB pieces. Plaintext 256 KiB, 1 MiB, and 4 MiB pieces reached 653.2 versus
489.1 (`1.336x`), 589.3 versus 485.8 (`1.213x`), and 628.9 versus 509.5 MiB/s
(`1.234x`). Together with the primary `1.146x` plaintext result, every
required performance row is above its gate and above the applicable
pre-change control. All 40 outputs retained exact independent verification,
method and TCP-only evidence, publication, joined shutdown, cleanup, and zero
failed/redundant bytes. RSTorrent's intake remained exactly 1 MiB, storage-job
high water was at most 72, command/completion queues at most 49/69, and RSS at
most 32,440,320 bytes. Raw reports and payloads were removed after recording
the result. Pending-write read-through is not selected without a remaining
causal gap; correctness/liveness, repository, and Android gates still precede
Tactical `135` closure.

The schema-v2 comparator now isolates each owner in a fresh process and the
orchestrator itself does not import libtorrent. A release-mode direct-metainfo
multi-file control passes plaintext and forced-RC4 publication for both owners
with independent piece verification, actual RC4 payload-contributor evidence,
bounded process telemetry, and cleanup. The retained small fixture is an
adapter gate.

The required 1 GiB control also passes. On the same warm loopback fixture,
RSTorrent/libtorrent publication was 2.573/1.830 seconds for plaintext and
3.680/1.957 seconds for forced RC4. Peak RSS was 135.9/960.3 MiB and
127.8/1,014.5 MiB respectively. All four outputs independently verified the
full 1,073,741,824-byte logical payload and exact method, then joined and were
removed. These single-run loopback ratios validate the harness and provide a
controlled context; they are not a public-swarm baseline or regression floor.

The reviewed schema-v2 catalog now pins nine exact official metainfo
identities: five WebTorrent works plus current Debian, Ubuntu, Arch Linux, and
Linux Mint distribution images. Every HTTPS source was independently parsed
and revalidated against its recorded outer SHA-256, v1 info hash, geometry,
and discovery set before public payload work. Arch's 468-entry web-seed set is
pinned by the outer hash but intentionally represented as `null`; its
`dht-only` profile disables web seeds and the report does not need to retain
hundreds of third-party URLs. No payload or metainfo artifact is committed.

The first catalog-backed public smoke completed exact Big Buck Bunny
publication for both matched-plaintext owners from clean commit `6b94a5a`.
RSTorrent published in 16.438 seconds; libtorrent published in 417.640 seconds
after waiting 406.738 seconds for its first candidate. Both independently
verified all 1,055 pieces and 276,445,467 logical bytes, used only TCP
plaintext payload streams, stayed within process and wire bounds, joined, and
cleaned up. The 0.039 publication-time ratio is therefore dominated by one
reference discovery delay and is retained as a paired public observation, not
a stable throughput or regression claim.

An attempted repeated `standard` cohort then showed that 30-minute
all-purpose owner deadlines and final-only report writing are unsuitable for
an interactive client comparison. It was interrupted after about 2.5 hours,
cleaned completely, and produced no retained structured result; process
turnover observed while it ran is not performance evidence. The corrected
contract checkpoints each completed owner atomically, limits the required
public pair to 120 seconds per owner, and reports discovery time separately
from active-transfer time. The required public work is now one Big Buck Bunny
complete pair and one Ubuntu 10% pair under matched settings, not a multi-hour
cohort.

That corrected `quick` comparison completed from clean commit `58a9891` in
about three minutes. Big Buck Bunny classified `both_reached`: RSTorrent and
libtorrent independently verified all 276,445,467 bytes in 26.959 and 58.932
seconds wall time. Discovery to first payload was 16.557 and 50.195 seconds;
the isolated active phases were 10.402 seconds at 25.34 MiB/s and 8.737
seconds at 30.18 MiB/s. RSTorrent was therefore about 19% slower during active
payload transfer in this pair while discovering payload sooner. Peak RSS was
29.2 MiB and 308.2 MiB.

Ubuntu Server classified `reference_only`. Libtorrent found candidates in
0.157 seconds and verified 293,289,984 bytes at the 10% milestone in 4.731
seconds, averaging 63.04 MiB/s during its 4.437-second active phase. RSTorrent
received no tracker response or candidate and timed out at 120.003 seconds.
The exact implementation boundary at that commit explains the result: the
resumable path could carry HTTP(S) tracker configurations, but its direct
tracker manager rejected non-UDP endpoints. Ubuntu's official metainfo
supplies only HTTPS trackers. This identified a discovery integration gap and
produced no Ubuntu throughput ratio.

Completed Tactical `136` authorized one clean, bounded repeat after closing
that gap. On 2026-08-11 both official HTTPS rows returned two response batches
and two reported peers; RSTorrent saw its first candidate at 0.148 seconds,
first payload at 4.203 seconds, and verified six pieces / 1,572,864 bytes. It
then timed out at 120.003 seconds without reaching 10%. Libtorrent reached
292,651,008 verified bytes at the target in 5.399 seconds. The pair remains
`reference_only`, now because RSTorrent stalled after successful discovery
rather than before it. This closes the HTTP(S) dispatch gap but still yields
no comparable Ubuntu throughput ratio. One changing-swarm stall is not a
performance regression claim or authority for a peer-policy change. Both
workers cleaned without forced termination, the repository remained clean,
and the 292-KiB raw report was removed after reconciliation.

## Purpose

Real swarms expose discovery, scheduling, timeout, completion, CPU, memory, and
disk behavior that isolated fixtures cannot reproduce completely. They are
valuable smoke evidence even though peer populations and network conditions
vary between runs.

This topic defines how to collect that evidence without confusing a noisy
observation with a correctness claim. It also keeps performance work tied to
end-to-end product outcomes instead of isolated micro-optimization.

[`oracle-driven-engine-campaign.md`](oracle-driven-engine-campaign.md) owns the
active source-first execution runbook, parity gates, and restart checkpoint.
This topic owns the measurement and evidence contract consumed by that
campaign.

## Evidence Roles

Use several complementary layers:

- **Deterministic tests** own codecs, state transitions, bounds, picker rules,
  retry decisions, persistence validation, and hostile inputs.
- **Scripted runtime tests** own sockets, timing, task cancellation, disk
  behavior, process restart, and reproducible failure injection.
- **Controlled interoperability** with the pinned libtorrent version owns
  protocol exchange and completion against an independent implementation.
- **Live public smokes** expose behavior against diverse peers and services.
  They can find failures and establish trends but cannot prove why two runs
  differed without supporting telemetry.

Correct bytes, verified piece hashes, successful publication, and explainable
termination are hard gates. Public download speed and reference ratios are
reported distributions until the harness has enough repeated evidence to set a
stable regression policy.

## Browser Adapter Throughput Evidence: 2026-08-03

Tactical `060` adds
`tests/interop/application_transport_throughput.py`, an opt-in paired browser
adapter smoke. It generates one deterministic multi-file v1 torrent with a
large payload, keeps one pinned libtorrent 2.0.13 seeder, starts a clean
gateway/profile for each adapter, and drives the production web build through
headless Playwright. Each case must publish the exact payload SHA-1 and cleanly
join before the next begins. The report records hardware, run order, semantic
HTTP requests, WebSocket upgrades, gateway frame/byte counters and queue/
latency high waters. It deliberately defines no pass floor from a single
cohort.

On `kmacbook` (Apple M4 Pro, 14 logical CPUs, 48 GiB) the retained HTTP-then-
WebSocket run used a 1 GiB payload, 1 MiB pieces and warm uncontrolled OS page
cache. HTTP completed in 3.348 seconds at 305.9 MiB/s and made 38 semantic API
requests. WebSocket completed in 2.815 seconds at 363.8 MiB/s, a 1.189
throughput ratio, with exactly one application upgrade and zero semantic HTTP
requests. It carried 24 view batches and acknowledgements, 20,102 encoded
view-batch bytes, an 846-byte largest outbound message and 62 microseconds
maximum enqueue-to-send latency. Both outputs matched SHA-1
`5c60b5002d23d55a1f6ca8498c4fa16d40e163bd`; both gateways and payload roots
cleaned up.

The ordinary controlled browser transfer separately crossed Transfers and
Workbench, observed Files and Peers, and published its 122-file fixture using
one WebSocket and no semantic HTTP requests. The adversarial 4,096-file
snapshot encoded to 1,426,924 bytes while an adjacent command completed in
11,835 microseconds. These are direct loopback observations, not remote
latency or codec claims.

The reproducible full command is:

```bash
source ~/.profile
uv run --project tests/interop \
  tests/interop/application_transport_throughput.py \
  --size-mib 1024 --piece-size-kib 1024 --timeout-seconds 240 \
  --output /tmp/rstorrent-application-transport-1g.json
```

## Production UI WebSocket Bandwidth Evidence: 2026-08-27

Tactical `183` adds `tests/interop/application_ui_bandwidth.py`, a bounded
production-browser application-byte baseline rather than another engine
throughput comparison. It starts a clean gateway and production web preview,
preloads 11 unchanged stopped torrents, and adds one 64 MiB direct-peer
transfer through the ordinary React UI. The pinned libtorrent 2.0.13 seed is
limited to 256 KiB/s so the same active transfer spans equal eight-second idle,
Transfers, Peers, General, Files, Pieces, and Normal Logs windows.

On `zblinux` (AMD Ryzen AI 9 365, 20 logical CPUs, 24.3 GB) clean commit
`5435c66196983bb29936f89de3b8ec6a38ebac50` completed in 75.3 seconds. One
WebSocket and no semantic HTTP carried 5,268,042 server payload bytes and
30,124 client payload bytes in 529 messages per direction. The browser totals
matched the gateway's independent per-frame-family counters exactly. The
active torrent advanced from 1% to 20%; resets, binary frames, heartbeat
timeouts, and cleanup failures were zero. Maximum gateway outbound message
size was 68,781 bytes.

| Eight-second steady window | Server application KiB/s | Batches/s |
| --- | ---: | ---: |
| idle Transfers | 5.28 | 1.00 |
| active Transfers | 12.84 | 7.37 |
| Peers | 114.05 | 16.11 |
| General | 101.86 | 5.62 |
| Files | 113.31 | 8.24 |
| Pieces | 147.93 | 14.61 |
| Normal Logs | 103.23 | 6.99 |

These are exact UTF-8 application payload rates on one controlled local run.
The report's WebSocket estimate adds only base framing and client masking; it
does not measure TLS, TCP/IP, retransmission, cellular billing, radio energy,
or a real WAN. Transition bursts are separately retained: initial Library was
18,938 bytes and entering Peers, Files, Pieces, and Logs was respectively
73,736, 91,376, 9,703, and 101,976 bytes while the active transfer continued.

Standalone semantic attribution explains the steady result. Idle traffic was
almost entirely a roughly 5 KiB/s complete session-rate history replacement.
In General, Library and selected Summary each contributed about 48 KiB/s; in
Pieces they each exceeded 51 KiB/s while Piece activity added 36.9 KiB/s.
Normal Logs themselves added only 0.42 KiB/s steady. Inspection confirms that
the view-set accumulator coalesces only an immediately adjacent same-view
patch, while ordinary hub publication interleaves Library, Summary, and detail
IDs. Thus the 100 ms cadence delayed but did not merge 390 compatible Library
patches and 390 Summary replacements observed in General. This is the first
causal optimization target; sparse rows, delivery profiles, and codecs remain
post-coalescing measurements.

Tactical `184` completed that isolated repair and repeated the exact fixture at
clean commit `4151c837`. Server application bytes fell from 5,268,042 to
1,239,166 (-76.48%) while gateway view batches remained nearly constant at 515
versus 520. Peers, General, Files, Pieces, and Normal Logs fell respectively
70.34%, 85.58%, 85.87%, 81.20%, and 84.54%. The run had zero duplicate-view
batches, one update per view per batch maximum, zero resets, exact browser/
gateway agreement, and progress from 1% to 20%. The report SHA-256 is
`64172265b2c1eafc6565f4fd742b067f6a34fc744e2c82c938dd17bcf18838dc`.

Residual standalone attribution now selects complete Torrent, Peer, File, and
active-piece rows for Tactical `185`'s typed sparse semantic updates. Complete
session-rate history still costs roughly 5 KiB/s and remains a separate
projection-specific candidate. Binary encoding remains a later measurement-
driven codec decision; current semantic diffs must not depend on JSON paths or
Rust enum layout.

Tactical `185` completed the typed sparse-row repair and repeated the same
fixture at clean commit `fe6a1d4959f3f0c0ce3f499dc46e53a7eb7a562e`.
Server application payload fell from the post-coalescing 1,239,166 bytes to
783,539 (-36.77%); gateway view-batch payload fell from 1,212,277 to 756,650
(-37.58%). Browser and gateway totals agreed exactly. The run retained 506
streamed batches, zero duplicate-view batches, zero resets, progress from 1%
to 20%, a 52,891-byte maximum outbound message, and clean shutdown. Its report
SHA-256 is
`79aa0f26bfeebd709c4285697d442c2d8bec51507061ff67a2bdcca83ef0d73f`.

| Eight-second steady window | Post-coalescing KiB/s | Sparse KiB/s | Reduction |
| --- | ---: | ---: | ---: |
| idle Transfers | 5.28 | 5.28 | 0.00% |
| active Transfers | 13.14 | 8.22 | 37.43% |
| Peers | 33.83 | 15.59 | 53.92% |
| General | 14.69 | 8.58 | 41.64% |
| Files | 16.02 | 10.12 | 36.79% |
| Pieces | 27.81 | 16.75 | 39.73% |
| Normal Logs | 15.96 | 9.02 | 43.46% |

The causal attribution is correspondingly narrow: total Library, selected
Summary, Peer, and active-piece semantic bytes fell 63.71%, 72.13%, 68.06%,
and 47.35%, while file updates in the Files window fell 35.87%. Idle did not
move because it contains only the still-complete session-rate projection.
That roughly 5 KiB/s history replacement selected the next payload candidate:
compare an incremental rate-window contract against delivery-profile/hidden-
client policy before considering a binary codec. Binary remains a broader
payload/CPU/complexity decision rather than a response to the original row-
repetition bug.

Tactical `186` removes the overloaded rate projection and repeats the exact
fixture at clean commit `7c84c5b57629130059c28876450f4092ebfb8812`.
`SessionCurrentRates` now carries only complete latest requested metrics, while
the independently interest-selected `SessionSpeedHistory` sends one bounded
fixed-window snapshot followed by every completed bucket as an exact
position-validated append. The ordinary React UI does not select graph history
outside Speed.

Server application payload falls from 783,539 to 454,581 bytes (-41.98%);
client payload is 29,152 bytes. The 75.16-second run retains 502 streamed
batches, zero duplicate-view batches, zero resets, exact browser/gateway byte
agreement, progress from 1% to 20%, 74 ordinary logs, a 52,891-byte maximum
outbound message, and clean shutdown. The report SHA-256 is
`f6a202382f4d59f8670cff0bf936c9fa18f78a3c834fa0f58b1c96cd1fadb456`.

| Eight-second steady window | Sparse KiB/s | Split-rate KiB/s | Reduction |
| --- | ---: | ---: | ---: |
| idle Transfers | 5.28 | 0.41 | 92.22% |
| active Transfers | 8.22 | 2.88 | 64.92% |
| Peers | 15.59 | 10.81 | 30.69% |
| General | 8.58 | 3.66 | 57.29% |
| Files | 10.12 | 5.05 | 50.05% |
| Pieces | 16.75 | 11.97 | 28.52% |
| Normal Logs | 9.02 | 4.09 | 54.63% |

The next bandwidth-policy experiment should start from this smaller residual
and measure a named background/cellular profile with selected-view removal,
server-enforced cadence, immediate foreground refresh, convergence latency,
queue pressure, and resets. A negotiated binary codec remains later and must
preserve these semantic snapshots, appends, cursors, and acknowledgements.

The reproducible command is:

```bash
source ~/.profile
uv run --project tests/interop --locked \
  tests/interop/application_ui_bandwidth.py \
  --output /tmp/rstorrent-ui-bandwidth-baseline.json
```

## Headless Comparator

The comparator is a CLI or application-service harness. It must not launch the
Tauri window, foreground Android UI, Chrome window, or a physical-device flow.
It runs each implementation in an isolated temporary profile and download
directory, captures machine-readable results, and cleans ordinary payload and
runtime artifacts after extracting the report.

The initial catalog is the small set of public test torrents recorded in
[`../test-torrents.md`](../test-torrents.md). Catalog entries identify the
stable info hash, expected name and size when known, enabled discovery modes,
and any license/source provenance. A failed public swarm is never silently
removed from the report.

Runs are sequential by default so the two implementations do not contend for
the same local bandwidth and disk. Repeated comparisons alternate or randomize
implementation order and record the order. Both sides use explicit time,
bandwidth, disk, connection, and storage bounds.

## Comparison Modes

Two general modes answer different questions:

### Common Denominator

Configure libtorrent to use only capabilities RSTorrent currently claims for
the scenario. For the initial tracker baseline this means the same magnet,
tracker set, TCP peer transport, and compatible storage behavior, with DHT,
PEX, LSD, web seeds, and other extra discovery disabled on the reference side.

This mode compares the implementation of shared behavior and avoids attributing
libtorrent's broader feature set to transfer efficiency.

### Full Reference

Run libtorrent with its ordinary production capabilities and RSTorrent with
its currently supported production capabilities. This measures the user-visible
gap, including missing discovery and scheduling breadth. The report must list
the enabled capabilities so the result is not described as an algorithm-only
comparison.

### Trackerless DHT

For the DHT campaign, remove tracker parameters and run the same info hash with
DHT as the peer source. Compare cold and warm session starts. Record time to
first valid DHT response, a defined routing-health threshold, first discovered
peer, metadata availability, first verified piece, and completion.

The exact reference configuration and command line are part of every result.
Reference defaults must not change silently when the pinned libtorrent version
changes.

## DHT Foundation Evidence: 2026-07-31

The controlled `tests/interop/dht_magnet.py` scenario uses an independent
Python KRPC router and libtorrent 2.0.13 peer. An info-hash-only magnet issued
one `find_node` and one `get_peers`, acquired 26,686 bytes of metadata in two
blocks, verified and published three pieces and 40,000 payload bytes, and then
answered independent `ping`, `get_peers`, token, and `announce_peer` probes.
The process-cleanup assertion passed; the recorded run took 0.815 seconds.

The opt-in public bootstrap test first exposed a deployed compatibility issue:
a libtorrent router returned a valid DHT dictionary in noncanonical key order.
RSTorrent's DHT-only bounded parser now tolerates ordering while rejecting
duplicate keys; strict canonical metainfo parsing is unchanged. The corrected
bootstrap reached a BEP 42-valid public node in 0.12 seconds.

A subsequent 120-second trackerless Big Buck Bunny RSTorrent probe built a
16-node routing table, received 830 valid DHT responses, and observed 1,563
peer values, but no contacted peer completed metadata. It was single-sided and
therefore has no paired classification under the table below. It is retained
as an honest historical outcome, not a public completion or speed claim.

Tactical `018` added a coherent peer-registry and BEP 9 acquisition snapshot,
then reran the trackerless smoke twice. The runs discovered 93 and 100 bounded
peer records, attempted 9 and 12 peers, and acquired the hash-verified
21,307-byte info dictionary in two requests and two blocks after 31.2 and 45.9
seconds. The latter DHT traversal retained 8 routing nodes, sent 80 queries,
received 56 valid responses, and discovered 100 peer values. Its 12 attempts
ended as 3 connection refusals, 3 connect timeouts, 3 handshake or extension-
phase resets, 1 verified metadata source, and 2 canceled losing dials. Final
metadata request, dial, worker, transaction, and lookup counts were zero.

A separate 90-second tracker-only rerun discovered no peers and made no dials.
Two trackers timed out, one no longer resolved, and two explicitly rejected
RSTorrent's port-zero announce. After scheduled announces began carrying the
provisional compatibility port `6881`, the same tracker-only smoke received
six candidates within 0.36 seconds and acquired hash-verified metadata in
11.41 seconds. RSTorrent still owns no incoming listener or NAT mapping, so
this is outbound metadata-acquisition evidence rather than inbound
reachability or seeding evidence. Neither single-sided result replaces the
still-pending paired comparator.

An immediate 20-run cohort then exercised the same fixed Big Buck Bunny
magnet ten times with trackers only and ten times with trackers absent and a
fresh public DHT owner. These are unpaired, changing-public-swarm samples with
different timeout bounds:

| Discovery | Completed | Bound | Successful latency min / median / mean / max | Final candidates median / range |
| --- | ---: | ---: | ---: | ---: |
| UDP trackers only | 8/10 | 90 s | 1.71 / 32.77 / 38.41 / 75.51 s | 12.5 / 6–131 |
| DHT only | 7/10 | 120 s | 30.84 / 78.69 / 72.59 / 104.35 s | 88 / 29–120 |

Both tracker failures ended with six attempted and zero eligible candidates,
four metadata requests, and two received 16 KiB blocks totaling 32,768 bytes,
but no verified dictionary. One later tracker success received 37,691 bytes,
consistent with an abandoned full first block plus a complete 21,307-byte
dictionary from another attempt. This is evidence for inspecting per-source
metadata progress and multi-source policy, not proof that aggregate blocks
can safely be combined.

All three DHT failures had successful lookup traffic and peer values: they
ended with 29, 79, and 83 candidates and 23, 35, and 38 dial attempts, but
zero metadata requests. Across all ten DHT runs, 2,759 queries received 2,223
valid responses (80.6%) and produced 906 final candidate records. The failure
boundary is therefore peer connection, selection, or extension negotiation,
not an empty DHT lookup. Every successful DHT run needed exactly two metadata
requests and two blocks once a usable peer was reached.

The same metadata-only metric was then run ten times per discovery mode
through pinned libtorrent `2.0.13.0`. Each run used a fresh temporary session
and storage root; LSD, PEX, UPnP, NAT-PMP, incoming peer connections, and uTP
were disabled. Tracker mode disabled DHT and used the same five UDP URLs; DHT
mode omitted every tracker. Libtorrent otherwise retained its ordinary peer
and metadata scheduler, including substantially more connection concurrency
than RSTorrent's three metadata work slots.

| Implementation and discovery | Completed | Bound | Successful latency min / median / mean / max |
| --- | ---: | ---: | ---: |
| RSTorrent, UDP trackers | 8/10 | 90 s | 1.71 / 32.77 / 38.41 / 75.51 s |
| libtorrent, UDP trackers | 10/10 | 90 s | 20.81 / 20.94 / 21.01 / 21.49 s |
| RSTorrent, DHT | 7/10 | 120 s | 30.84 / 78.69 / 72.59 / 104.35 s |
| libtorrent, DHT | 10/10 | 120 s | 0.75 / 0.90 / 1.08 / 2.72 s |

One isolated-process libtorrent DHT repetition completed in 0.757 seconds,
ruling out reuse of a preceding session's routing table. A tracker alert
timeline explained the reference's stable 21-second result: the first two
trackers each timed out after about 10 seconds, the third returned 71 peers,
and verified metadata arrived 0.11 seconds later. The RSTorrent and libtorrent
cohorts were sequential rather than alternated, so these are a reference
baseline and a large observed gap, not yet Tactical `015`'s paired comparator.

All figures above stop at hash-verified `ut_metadata`. The actual torrent is
276,445,467 payload bytes in 1,055 pieces across three files. Neither cohort
measured full payload verification or publication; a ten-run cohort for both
implementations would transfer about 5.53 GB before protocol overhead.

### First Alternating Comparator Evidence: 2026-07-31

The Tactical `015` runner completed its first common-denominator pair through
the same machine-readable schema. RSTorrent ran first; both owners used the
UDP-only magnet, TCP outgoing connections, no DHT, no LSD, no incoming
connections, and isolated temporary storage. Both acquired the same verified
metadata geometry: 276,445,467 bytes, 1,055 pieces of 262,144 bytes, and three
files. Owned tasks and payload roots were removed.

RSTorrent reached verified metadata in 51.32 seconds and libtorrent in 20.63
seconds, a 2.49x ratio for this one changing-swarm sample. At the RSTorrent
milestone, its bounded snapshot held 128 candidates, 110 still eligible, 20
metadata attempts, two metadata requests, and the two blocks comprising the
21,307-byte info dictionary. This is comparable paired evidence and confirms
the harness contract, but one sample is not a distribution or a parity claim.
It points the next source-first slice at metadata candidate concurrency and
torrent-wide request ownership.

### Torrent-Owned Metadata Result: 2026-07-31

Tactical `019` replaced per-peer dictionaries with one bounded torrent owner
and added endpoint-free per-attempt diagnostics to temporary comparator
reports. Two independent ten-pair Big Buck Bunny tracker cohorts each
completed 9/10 for RSTorrent versus 10/10 for libtorrent. RSTorrent medians
were 5.72 and 4.12 seconds versus 20.52 and 20.33 seconds. Median paired ratios
were 0.28x and 0.20x; p90 ratios were 1.50x and 1.58x. Each RSTorrent miss
retained the first 16 KiB block from six exhausted candidates and had no hash,
cleanup, or resource-bound failure. Tracker metadata therefore meets both the
functional and two-cohort comparable gates.

Three contemporaneous fresh-DHT pairs completed for RSTorrent but timed out
for libtorrent with zero torrent candidates. Giving the reference adapter the
same three bootstrap hosts documented by libtorrent and used by RSTorrent did
not change that result; a separate exact-settings session populated its DHT
routing table, so the retained boundary is live info-hash lookup evidence, not
an empty bootstrap table. The comparator now supports `--owner` to preserve
the same catalog, deadline, diagnostics, identity, cleanup, and JSON contract
without repeatedly running a blocked counterpart. Ten isolated RSTorrent DHT
runs completed 10/10 in 31.40–66.96 seconds, with a 56.64-second median and
59.80-second p90. All had exact identity, zero hash failures, and clean
shutdown. This is functional evidence, not a paired DHT latency claim.

The initial three-pair breadth run completed only 0/3 Cosmos, 2/3 Sintel, 1/3
Tears of Steel, and 2/3 WIRED CD for RSTorrent, while libtorrent completed all
twelve. Every miss retained block zero and repeatedly requested block one from
a capable peer until the 15-second progress deadline. Pinned source showed
libtorrent emits one metadata request per event/tick even though it permits
two outstanding. RSTorrent had filled both slots immediately. After a
deterministic one-request-at-a-time peer and a one-second request ramp were
added, the identical breadth matrix completed 12/12 for each owner. Every
RSTorrent run used exactly two requests and two accepted blocks, with zero
hash and cleanup failures. This before/after result is the causal evidence for
the pacing change.

### Paced Metadata Connection Cohort: 2026-08-27

Tactical `181` addresses a later source-rich product observation without
promoting changing-swarm timing to a threshold. The running service had
hundreds of peer records and a tracker reporting more than 300 seeders, but
its metadata owner could evaluate only eight combined pending and connected
workers. None of the eight attempts visible in the initiating sample connected
or contributed payload; three failed and five were canceled after a later peer
completed the dictionary.

Pinned libtorrent source confirms `downloading_metadata` uses ordinary torrent
peer admission, half-open work counts against the default 200-session
connection limit, and the reference offers 30-attempt startup breadth.
RSTorrent now retains global accounting while bounding metadata at 30 combined
pending/connected peers and spacing accepted attempts at a conservative
no-burst default of ten per second. A deterministic saturation run reaches an
exact 30 connection-permit high water in 2.93 seconds, leaves candidate 31
eligible, and cancels every engine owner and permit to zero.

The retained loopback `magnet_metadata.py` gate passes against pinned
libtorrent `2.0.13.0`: RSTorrent receives the exact 26,686-byte two-block
dictionary, verifies and publishes three pieces and 40,000 payload bytes in
0.299 seconds, then serves the byte-identical dictionary back to libtorrent in
two requests in 0.080 seconds. Both directions verify identity/content and
clean their temporary roots. These are controlled correctness timings, not a
public-swarm latency claim. No new public traffic was run for this tactical.

Completed Tactical `182` then removes sequential timeout multiplication
without widening the cohort. One absolute 15-second outbound-attempt lifetime
contains a three-second preferred-uTP fallback and ten-second outgoing
handshake sub-budget. A deterministic saturated case admits 31 lifetime
attempts through the unchanged 30-slot owner, replaces exactly one oldest
zero-contribution worker, protects the contributing worker, and ends with
zero pending dials, workers, and active attempts. A sparse case retains one
idle worker beyond its shortened grace when no replacement waits.

The retained pinned-libtorrent `2.0.13.0` loopback gate passes again:
RSTorrent verifies the exact 26,686-byte two-block dictionary and 40,000-byte
three-piece payload in 0.311 seconds and serves two exact metadata requests
back in the same run. Android x86_64 and arm64-v8a builds also pass. These
remain controlled correctness and resource-shape observations; Tactical `182`
ran no public traffic and makes no changing-swarm latency claim.

### First Full-Download Comparator Evidence: 2026-07-31

A controlled loopback fixture first ran both exact adapters against one
libtorrent seed. Both independently verified and published a 79,000-byte,
two-file, three-piece torrent, matched the output file hashes, produced
`both_reached`, and cleaned up. This validates the completion schema and
publication checks; its sub-second timings are not public speed evidence.

The first public full pair used the common-denominator Big Buck Bunny profile
with a 900-second deadline per owner. RSTorrent verified metadata at 16.71
seconds and its first piece at 24.15 seconds. It then timed out at 461 of 1,055
verified pieces and 120,848,384 of 276,445,467 bytes (43.7%), before the 50%
milestone. Its terminal snapshot reported one connected, unchoked peer, four
requests, no writes in flight, 9,491 missing blocks, and
`requestwindowsfull`. An external read-only process sample saw about 15 MiB
RSS and low CPU, so neither unbounded buffering nor a spin explained the wait.

Libtorrent independently reached verified metadata at 20.57 seconds, first
piece at 20.62, 50% at 24.75, 95% at 28.88, 99% at 29.91, and verified
publication at 30.88 seconds. It downloaded 276,445,467 wanted bytes and the
published file geometry matched. The pair is `reference_only`: the swarm was
healthy enough for the constrained reference, while RSTorrent exposed a
sustained connection/request-width gap well before endgame. The earlier user
observation of a 99.9% stall remains relevant to endgame, but it was not the
first limiting boundary in this run.

### Sustained-Transfer Pre-Change Screen: 2026-07-31

Tactical `020` began with three alternating common-denominator Big Buck Bunny
pairs to first verified piece. Both owners completed 3/3. RSTorrent reached
the milestone in 0.74, 75.85, and 0.81 seconds versus libtorrent's 20.83,
20.40, and 20.68 seconds. The slow RSTorrent result spent 75.47 seconds in
tracker and metadata acquisition; the transfer interval from verified
metadata to first piece was only 0.22--0.38 seconds in all three samples.

Every RSTorrent terminal snapshot nevertheless reported one unchoked peer,
four outstanding requests, a 65,536-byte payload high-water mark, and
`requestwindowsfull`. First-piece startup is functional. Combined with the
older 43.7%-after-900-seconds run, the repeatable internal boundary is the
static sustained request window rather than initial piece selection.

The first adaptive-window screen completed 3/3 first-piece pairs and grew the
live RSTorrent request target to 21--46 with 344--754 KiB high-water. The next
three-pair 50% screen classified one `both_reached` and two `reference_only`.
The successful RSTorrent run reached 50% in 28.14 seconds versus 27.98 for
libtorrent (1.006x), verifying 529 pieces under an 8.68 MiB high-water mark.

The two RSTorrent timeouts stopped at 90 and 101 pieces. At 300 seconds each
still had two unchoked peers, 712 or 772 outstanding requests, 11.68 or 12.66
MiB high-water, and no stalled peer despite no further useful completion.
Those peers had delivered about 26 MiB and grown near the 500-request cap.
This is source-aligned evidence for adaptive connection inactivity detection,
not for reducing the now-proven healthy-peer window. All three libtorrent runs
reached 50% in 25.06--27.98 seconds with 16--22 peers at their milestones.

After sampled inactivity landed, a clean RSTorrent-only three-run screen
reached 50% once in 24.09 seconds and timed out twice at 8.5% and 23.1%. The
misses retained only four or nine current content candidates and two
connections; no unused candidate was eligible. The 23.1% run was receiving
about 4.45 MiB/s at termination, reinforcing that useful-peer throughput is no
longer the broad failure owner. Pinned libtorrent tracker startup and connect
boost behavior selects initial peer working-set breadth for Tactical `021`.

Bounded tracker fan-out produced two response batches, 14--15 candidates, and
17--19 dial attempts in every run of the next clean screen. It still reached
50% in 0/3 at 180 seconds, stopping at 36, 135, and 186 pieces. Five or six
connections and two or three pending dials exactly filled the former combined
eight-slot admission check even though two to five candidates remained
eligible. All terminal samples were receiving roughly 3.2--4.0 MiB/s. This is
evidence to separate half-open and established capacity and adopt a bounded
30-peer working set before changing transfer scheduling again.

The clean post-admission screen remained 0/3, at 25, 55, and 96 pieces after
180 seconds. It consumed all 14--15 candidates across five or six established,
six to eight dialing, and up to three backed-off records; none was eligible.
Four or five established peers were unchoked, but 479--710 requests remained
outstanding and the largest peer target reached 360 or 500. Aggregate sampled
rates of 3.0--4.1 MiB/s conflict with only 7.6--26.2 MiB of useful payload over
the full attempts. The headless snapshot therefore gains bounded endpoint-free
per-peer queue, utility, rate, phase, and age rows before another policy
change.

The first clean row-bearing run timed out at 24 pieces, but selected a local
deterministic owner. The final retained table was only one to two seconds old:
a fast peer had delivered 6.24 MiB, grown to a 385-request target, and held
383 requests, after which no newer swarm observation appeared during the
180-second wall clock. The 16-command supervisor channel and 64-event peer
channel can fill in opposite directions. Tactical `022` owns restoring duplex
progress before any rate, queue-target, or picker experiment.

Tactical `022` removed that cycle. Its clean owner-only 50% screen completed
3/3 at 34.70--55.37 seconds with current terminal peer tables and exact
cleanup. The alternating screen also completed 3/3 for both owners: RSTorrent
took 30.74, 34.14, and 45.82 seconds versus libtorrent's 24.00, 25.80, and
24.82, producing 1.28x--1.85x paired ratios. This passes the bounded tactical
screen but is not yet the campaign's two-cohort comparable confirmation.
Tactical `023` then reached verified publication in one clean owner-only run
at 72.66 seconds and all three alternating pairs. RSTorrent took 80.22, 82.53,
and 123.18 seconds versus libtorrent's 29.80, 29.93, and 30.32 seconds. The
2.76x median and 4.06x maximum paired ratios miss the comparable gate, while
exact integrity, publication, cleanup, and bounded endgame counters pass. This
is retained performance debt.

Tactical `024` then completed bounded piece-hash recovery without changing
transfer policy. Its clean public health screen published all 276,445,467
bytes and 1,055 pieces in 86.05 seconds, with metadata at 3.27 seconds, first
piece at 4.49, 50% at 40.18, and zero content hash failures. Exact integrity,
publication, task cleanup, and a 13,516,800-byte payload high water passed.

A controlled 32 MiB single-piece RSTorrent download from a local libtorrent
seed took 3.829 seconds, about 8.4 MiB/s. Source inspection found the content
supervisor awaits each 16 KiB physical write and every piece reread/hash before
consuming another peer event, whereas pinned libtorrent transfers accepted
blocks to a bounded asynchronous disk owner and releases peer progress from
write completion. Tactical `025` tests this owner with three-run before/after
evidence before any peer-window, picker, or discovery tuning.

### Bounded Storage Result: 2026-08-01

Tactical `025` corrected that large-piece harness to time only the RSTorrent
subprocess. The prior 3.829-second total included Python payload generation,
torrent construction, and seed startup and therefore was not an engine
ceiling. Three transfer-only runs of the synchronous commit took 0.646, 0.326,
and 0.331 seconds (0.331-second median); the bounded asynchronous owner took
0.745, 0.426, and 0.426 seconds (0.426-second median). The 29% regression
rejects storage as a speed improvement in this localhost profile.

The owner is retained for a separate causal result: with a 250 ms first-write
delay, two peers deliver their complete payloads to the supervisor within 100
ms while the write remains in flight. An 80-block saturation case reached the
declared 64-command and 66-job high waters, completed exact content, and
returned every queue to zero. Cancellation during queued writes and hashing
joins the owner exactly. This establishes peer-event liveness and bounded byte
ownership without claiming throughput.

The controlled paired publication remained exact at 44.66 ms for RSTorrent
and 86.57 ms for pinned libtorrent. A clean common-denominator Big Buck Bunny
owner screen published all 276,445,467 bytes in 153.72 seconds with zero hash,
publication, cleanup, or bound failures. Its storage command, completion, job,
and payload high waters were 64, 1, 66, and 8,781,824 bytes. The result is
slower than the prior 86.05-second public health screen, but one changed swarm
cannot attribute that delta. It retains completion evidence and selects a
time-series peer working-set comparison rather than further storage tuning.

### Product Pipeline Budget Correction: 2026-08-01

Tactical `039` found that the product application still used a 32 KiB
allowance inherited from the original controlled harness. Outstanding peer
requests retained that same allowance through storage completion, so the
entire desktop torrent could reserve only two ordinary 16 KiB blocks. Earlier
live campaign commands commonly supplied larger explicit allowances--their
8.8--13.5 MiB high waters therefore did not validate the product default.

Pinned libtorrent keeps its four-request initial peer window, three-second
adaptive target, 500-request per-peer maximum, and received disk queue as
separate controls. RSTorrent now follows that resource separation with explicit
product profiles: desktop permits 256 MiB of outstanding requests, 32 MiB of
received resident payload, and a 256 MiB active-piece working set; Android uses
128 MiB, 16 MiB, and 128 MiB respectively. The storage job bound is derived
from its resident byte allowance instead of the historical fixed 64-command
and 66-job limits.

Deterministic and delayed-storage tests prove that all 30 default peers can
receive four initial requests, request reservations release when accepted
payload changes owner, the active-piece byte set refills, and resident payload
remains independently bounded. This is a correctness and capacity correction,
not a new public-swarm throughput or parity claim. Historical measurements
below retain the resource model of the commits on which they were captured.

### Paired Utility Timeline: 2026-08-01

Tactical `026` added a one-second, 1,024-sample bounded endpoint-free timeline
to both comparator owners. Exact milestone times remain separate; older
interior samples are deterministically coalesced if the bound is reached.
Fields cover candidate, connection, request, payload, verification, and
storage/disk aggregates with explicit `null` where an owner cannot expose an
equivalent meaning. The controlled paired publication and deterministic Rust
and Python aggregation, rate, bound, and scrubbing tests pass.

Three alternating common-profile Big Buck Bunny full pairs reached verified
publication and clean shutdown for both owners. RSTorrent took 132.89, 134.43,
and 138.24 seconds; libtorrent took 30.87, 30.89, and 31.11 seconds. The median
paired ratio is 4.35x, so functional completion remains green but comparable
latency remains open.

Libtorrent spent about 20.3--20.6 seconds reaching metadata and transferred
content in only 10.3--10.6 seconds. Three to five content seconds after
metadata, RSTorrent knew 10--16 peers, had three or four connections and two
useful peers, and received roughly 2.2--2.7 MB/s. Libtorrent knew 60--65 peers,
had 17--20 connections and 11--14 useful peers, and ramped to roughly 12--29
MB/s. RSTorrent had no idle eligible candidates in that interval, selecting
candidate supply before ranking or request policy for the isolated tracker
profile.

The product tracker+DHT path supplied a different state. One source-timed 50%
screen had 159 candidates by metadata; after one content second, 119 remained
eligible, eight were dialing, and six were connected. DHT supplied another
148 observations around content second 30, mostly merging existing tracker
records. RSTorrent held exactly eight half-open attempts while growing to 29
connections over about 100 seconds, then reached 50% at 143.94 seconds with 30
connections and 92 candidates still eligible. This selects Tactical `027`'s
source-derived 30-attempt startup cohort. Continuously saturated 64-command
storage and 66-job high waters remain a measured secondary hypothesis if
broader admission does not improve service.

### Expanded Cohort Result: 2026-08-01

Tactical `027` changed only the pending-dial default from eight to 30. A useful
peer at position 30 behind 29 silent handshakes completed a controlled transfer
in about 50 ms; 30 silent attempts also canceled and joined exactly. Three
product-path 50% screens completed in 61.47--68.34 seconds, but supplied only
12--16 candidates and therefore do not attribute their 64.21-second median to
the wider cohort.

One product-path completion published all 276,445,467 bytes in 149.42 seconds
with zero hash failures and drained request and storage queues. Its timeline
reported 171 cumulative DHT peers near content second 30 and 340 near second
120, while the content registry stayed at 12 known peers until the final
sample. Storage remained at its 66-job high water throughout. The supervisor's
storage-backpressured branch receives only storage completions, and its
ordinary biased selection also places storage before peer and discovery
events. Tactical `028` therefore owns prompt bounded discovery admission and
explicit safe event-owner fairness before further storage or request tuning.

### Fair Intake Result: 2026-08-01

Tactical `028` rotates safe ready storage, peer, and discovery owners and
starts bounded dials independently from storage-command readiness. A scripted
case admits and dials a delayed DHT peer while all 66 storage jobs remain
occupied, then publishes exact content and drains every queue.

Three live 50% screens put each first DHT result and registry increase in the
same sample. A 149-peer DHT result produced 302 known peers; 145 and 148-peer
results produced 157 and 161. All immediately reached 30 pending attempts, so
the delayed-intake defect is closed. Two screens reached 50% in 69.15 and
69.29 seconds; a source-rich screen took 282.74 seconds. One full screen timed
out at 300 seconds with 399 pieces and 104,595,456 verified bytes, zero hash
failures, 30 connections, 91 requests, 65 writes, and 66 storage jobs.

Tactical `029` now maps each piece once and reduces a common 256 KiB
multi-file hash from 16 seeks to one while retaining 16 fixed 16 KiB reads.
Its representative 32 MiB controlled medians were 1.101 seconds before and
1.121 seconds after, so no speed improvement is claimed. Three public 50%
screens still reached 66 occupied storage jobs; two reached the milestone at
77.76 and 77.89 seconds, while one timed out at 506 of 1,055 pieces. A full
screen published all 276,445,467 exact bytes at 180.64 seconds with zero hash
failures and drained queues.

Tactical `030` now executes a complete all-wanted piece hash in one bounded
blocking positional-I/O job. The 32 MiB controlled median remained neutral at
1.139 seconds versus Tactical `029`'s 1.121. Two public 50% samples took 79.47
and 223.85 seconds; a third timed out at 359 of 1,055 pieces. A complete screen
timed out at 375 pieces and 98,304,000 verified bytes. All terminal snapshots
retained 66 storage jobs, all had zero hash failures, and cleanup was exact.

Full queue occupancy has now survived two hash operation-shape changes without
a controlled speed improvement. It was not sufficient attribution. Tactical
`031` now records command queue wait, complete write service, complete hash
service, and the active operation age without changing scheduling.

### Storage Duration Attribution: 2026-08-01

Controlled write/hash delays, queued cancellation, saturation, nullable
libtorrent schema fields, and exact active-operation cleanup all pass. The
paired controlled publication remained exact. Both Android targets also pass
compilation checks through the shared engine path.

Three tracker+DHT Big Buck Bunny screens targeted 50% with a 300-second limit.
One reached 528 of 1,055 pieces in 82.48 seconds; two ended at 425 and 458
pieces. All retained zero hash failures, exact cleanup, and no active storage
operation at termination. Write service consumed 87.7%, 88.2%, and 87.7% of
wall time. Hash service consumed 5.5%, 5.5%, and 5.7%, making combined
serialized service 93.2%, 93.7%, and 93.3%.

Average 16 KiB writes took 8.5, 38.3, and 35.1 ms, with maxima of 272.5,
842.0, and 697.4 ms. The queue reached its 66-job bound and individual waits
reached 0.95--8.16 seconds. Summed wait is overlapping backlog evidence and is
not compared directly with wall time. Serialized service time is comparable
and selects write execution shape or bounded concurrency as the next owner;
hashing, peer ranking, and request policy remain unchanged until that owner is
measured.

## Application View Delivery Costs

The live inspection direction adds a second performance surface: engine facts
must become bounded application projections, cross the selected codec, reduce
into a local store, and render without distorting the engine being observed.
Tactical `034` measured deterministic frontend rendering only. Its 2,000
torrent / 10,000 peer scenario did not measure Rust projection work, view-hub
locking, JSON accounting/encoding, gateway delivery, or live reducer volume.

Current source inspection records these costs as **observed in code but
unmeasured**, not as proven bottlenecks:

- individual activity and progress updates clone the complete `ViewHub`
  torrent `BTreeMap` while holding its central mutex;
- torrent models copy nested strings, verified ranges, and active-piece
  vectors during broad comparisons;
- both legacy subscriptions and view sets serialize values to JSON to account
  queue bytes before the transport encodes a response;
- exact replay intentionally retains and clones one emitted unacknowledged
  batch under the declared bound;
- the TypeScript view-set reducer clones its keyed view record per batch and
  rebuilds torrent-list arrays; and
- the inspection reducer clones the selected torrent's peer-row record when a
  peer patch changes it; and
- diagnostics are independently retained in the view reducer and mapped
  inspection store, rebuild bounded arrays on append, and currently discard
  structured context only after paying its decode/retention cost.

Tactical `035` removes the full torrent-map clone from targeted high-frequency
publication before adding live peer cadence, while preserving coherent
snapshots and legacy consumers. Its deterministic source-rich snapshot uses
30 connecting plus 30 connected rows. One representative optimized run spent
479 microseconds publishing the projection and 501 microseconds opening and
materializing the selected snapshot; its encoded update and queue high-water
were both 79,230 bytes beneath the 256 KiB default, with zero resets. These
single-machine timings are observations, not regression thresholds.

Tactical `049` measures the diagnostic path while unifying its frontend record
shape, raising a deliberately bounded console history, batching ordered append
delivery, and virtualizing visible entries. Its results are recorded below;
they do not justify additional indexing, binary encoding, or frame-coalesced
rendering.

The unchanged Tactical `034` 2,000-torrent/10,000-peer scenario remains the
frontend pressure evidence: at most 100 rendered rows, 840 DOM elements,
30,727,035 bytes of sampled used JavaScript heap, a 247 ms initial render, a
50 ms simulated update and paint, and zero observed long tasks. Tactical `035`
adds controlled live evidence rather than another scale measurement: the
production web build observed one libtorrent 2.0.13.0 connection, pending
requests, verified three-piece completion, and row cleanup in 27.7 seconds.

The same controlled run withheld browser client operations past an explicit
500 ms test lease. It observed the stale/reconnecting presentation, a distinct
replacement view-set identity and epoch, coherent fresh-snapshot recovery,
and joined gateway cleanup. The normal five-minute lease and single reaper
task remain unchanged. More detailed lock-hold, allocation, selector-
notification, and live multi-peer browser profiles are still unmeasured and
must not be inferred from these bounded results.

Replay retention remains a deliberate bounded correctness cost. Field masks,
entity sharding, mutable versioned containers, streaming, animation-frame
delivery, and binary codecs remain later measured responses rather than
assumed fixes.

### Diagnostic Console Evidence: 2026-08-02

Tactical `049` attempted 10,000 deterministic diagnostic records through both
source and browser pressure fixtures. The Rust ring retained the newest 2,048,
reported 7,952 source evictions, and occupied 733,185 encoded bytes, below its
2 MiB ceiling. The Zustand projection independently retained 2,048 and
reported 7,952 local evictions. The wide browser viewport mounted 500 DOM
elements including 24 virtualized records and sampled 26,019,809 bytes of used
JavaScript heap. Deterministic browser checks retain ceilings of 1,500 DOM
elements, 60 rendered records, and 256 MiB sampled heap. These are bounded
development observations, not whole-product memory guarantees.

The controlled libtorrent 2.0.13.0 run observed a real successful UDP tracker
record, expanded its exact URL and announce interval, and changed producer
capture and display-category controls while the verified transfer continued.
The 122-file, three-piece payload showed first Done at 9,036 ms and first
Verified at 9,041 ms, and the browser proof completed in 34.1 seconds with
joined cleanup. Its first invocation hit the already-recorded one-shot UDP
tracker timing transient; the unchanged rerun passed. This proves bounded live
inspection and structured context, not public-swarm throughput.

### File Projection Evidence: 2026-08-01

Tactical `041` adds a larger but still bounded application-view shape. The
4,096-row long-path Rust fixture encoded to 1,481,877 bytes. Its coherent
snapshot is retained under a separate 16 MiB ceiling instead of raising the
512 KiB steady-state patch queue. Static Rust catalog geometry is shared by
`Arc`; stored, verified, and failed piece transitions derive only intersected
complete rows. Piece checkpoints now publish a targeted durable update rather
than reconstructing the complete SQLite-backed service snapshot on every
verified piece.

The deterministic browser scenario retained 4,096 semantic rows, hid one
padding row, and mounted 690 DOM elements. Headless Chrome sampled 66,468,705
bytes of JavaScript heap; a complete ten-second scenario rebuild and paint
took 55 ms. The table remained keyboard-resizable, correctly sorted exact
decimal values beyond JavaScript's safe integer range, and serious/critical
axe findings were empty. These values are observations from one development
run, not hard regression thresholds.

The live adapter caches the mapped file catalog by projection identity, so a
high-frequency torrent-summary patch does not remap 4,096 file DTOs. A Files
patch maps only source rows whose identity changed. Two bounded shallow O(n)
costs remain: the generic TypeScript view-set reducer rebuilds the generated
file DTO array for a keyed patch, and the normalized inspection record copies
its key table when one or more rows change. At the current 4,096-file ceiling
and 250 ms minimum Files delivery interval this is acceptable initial
evidence, not proof that entity sharding is unnecessary. Retain this item for
profiling before raising file-count or update-cadence limits.

The controlled libtorrent 2.0.13.0 proof transferred 26,731 bytes of
multi-block metadata, a 7,000-byte nested prefix, and a 40,000-byte payload
across 122 files and three pieces. Piece zero crossed the two nonempty files.
From selecting Files, first Done appeared at 20,406 ms and first Verified at
20,413 ms. A deliberate 500 ms lease expiry reopened from a fresh snapshot
while transfer continued; final payload display was 39.0 KiB Done and
Verified, both external content comparisons matched, and every child joined
and cleaned up. The seed's 4 KiB/s upload limit makes these interoperability
milestones diagnostic rather than product throughput measurements.

### Tracker Projection Evidence: 2026-08-01

Tactical `043` adds at most 32 small complete tracker rows at a 250 ms minimum
selected-view cadence. One delivered monotonic deadline is mapped to a local
wall-clock target, so the UI's one-second countdown does not create host
updates, queue traffic, or JSON encoding work. Same-catalog piece checkpoints
preserve the tracker projection instead of rebuilding it from durable state.

The deterministic tracker-recovery browser suite passed at wide, compact, and
phone viewports. Its scale scenario retained 855 DOM elements, sampled about
32.7 MiB of JavaScript heap, rendered initially in 258 ms, and applied its
simulated update in 68 ms; one 50 ms long task was observed. These are
single-machine smoke observations, not thresholds. The responsive proof also
caught and closed a phone-width overflow that exposed a sliver of the inactive
library pane.

The controlled live browser proof delayed its owned UDP tracker response for
three seconds so the UI could observe `announcing`, then displayed the exact
response of one peer, 37 seeds, 11 leeches, and a 30-minute reannounce
deadline. It completed and hash-verified the same 40,000-byte payload. This
run validates state delivery and presentation; its seeded transfer timing is
not a throughput comparison.

### Disk Projection Evidence: 2026-08-02

Tactical `044` adds a global session projection composed from bounded
torrent-owner snapshots. Engine emission may occur at block transitions, but
view-set delivery coalesces semantic replacements at the requested cadence and
the browser receives piece-attempt rows rather than 16 KiB jobs or payload.
The generic Rust projection currently rebuilds the small active-piece vector
and the TypeScript reducer rebuilds its keyed array on a patch. Those costs are
bounded by active working-set limits but remain unprofiled for future
concurrent multi-torrent scheduling; do not infer that the current one-active-
download application proves aggregate scalability.

The deterministic `slow-disk-pressure` fixture retained 64 active piece rows,
mounted fewer than 100 virtual grid rows, and passed serious/critical axe
checks at wide, compact, and phone sizes. A controlled production-web proof
used a libtorrent `2.0.13.0` loopback seed, a 4 MiB payload plus a 7,000-byte
prefix, 17 pieces, a 128 KiB resident cap, and a 150 ms test-only write delay.
It observed pressure exactly at 96 KiB, paused intake, then exact verified
completion, idle recovery, empty active rows, matching external SHA-1, and
joined cleanup. This is backpressure and inspection evidence, not a disk
throughput benchmark.

## Result Classification

Classify each paired attempt before interpreting speed:

| Libtorrent | RSTorrent | Classification |
| --- | --- | --- |
| Completes | Completes | Comparable; report correctness and performance metrics. |
| Completes | Fails or times out | Actionable RSTorrent gap; retain diagnostics. |
| Fails or times out | Fails or times out | Inconclusive public-swarm attempt. |
| Fails or times out | Completes | Record RSTorrent success; reference comparison is inconclusive. |

A timeout is not automatically a product defect or a success. The report must
retain the last progress, active discovery state, peer counts, request state,
and terminal reason needed to distinguish no peers, slow peers, a scheduler
stall, integrity recovery, and harness failure.

## Required Measurements

Capture the following when the owner exists:

- repository commit, dirty state, platform, architecture, toolchain, wall
  clock, implementation order, catalog version, and exact configuration;
- torrent identity, expected and verified bytes, completion and publication
  result, final hash/integrity status, and terminal reason;
- time to first discovery response, peer, metadata, requested block, verified
  piece, 50%, 95%, 99%, and 100%;
- discovery-source counts, connection attempts, established peers, useful
  peers, and disconnect/failure reasons;
- useful payload bytes, duplicate bytes, rejected/late bytes, hash failures,
  and retransmitted or reassigned requests;
- aggregate and interval throughput, while avoiding precision unsupported by
  the sampling period;
- process peak RSS and CPU time or utilization;
- storage bytes, disk-write volume when available, and internal buffer/queue
  high-water marks; and
- DHT routing, transaction, lookup, and saved-state high-water marks for DHT
  scenarios.

Missing metrics are emitted as unavailable, not zero. Adding a metric follows
the owner that can report it accurately; the harness must not infer internal
facts from UI text.

## Performance Policy

Optimize only after correctness and ownership are visible. A proposed
optimization should identify:

1. the end-to-end symptom or measured resource cost;
2. the owner and hot path responsible;
3. the baseline workload and metric;
4. the correctness and resource invariants that must remain true; and
5. before/after controlled results plus representative live observations when
   useful.

CPU, memory, disk, allocation, wakeup, connection, and queue costs all matter.
Throughput alone is insufficient if it depends on unbounded buffering or work.
Do not add speculative abstraction, caching, unsafe code, or concurrency for an
unmeasured gain.

Initial public results are not required to beat libtorrent. The useful signal
is whether RSTorrent completes correctly, where time is spent, whether resource
use remains bounded, and whether repeated changes improve or regress the same
scenario. Stable hard performance gates may be introduced only after enough
controlled samples establish a defensible threshold.

## Execution And Artifact Safety

- Live network tests are opt-in and never part of the default unit-test run.
- Runs use explicit maximum duration, payload size, connections, bandwidth,
  disk space, and retained-log limits.
- The harness must be independently stoppable and leave no engine tasks or
  listeners behind.
- Ordinary runs use background processes only. Visible desktop, browser,
  emulator, and physical-device automation require a surface-specific reason
  and the authority already required by repository instructions.
- Downloaded payload, temporary profiles, databases, packet captures, and raw
  logs stay in ignored or temporary paths and are removed after the report is
  extracted unless the user explicitly asks to retain them.
- Committed summaries contain no peer IP addresses, tokens, machine-specific
  paths, or large binary artifacts.

## Controlled uTP WAN Preflight: 2026-08-10

Closed evidence-limited Tactical
[`126`](../tactical/126-controlled-outbound-utp-wan-evidence.md) applied the
live-evidence safety contract before staging a payload or adding a WAN
diagnostic. Its authorized read-only `ssh pimom` preflight completed in 4.5
seconds with forwarding disabled and reported Linux/aarch64, Python `3.13.5`,
and an assigned IPv4 set consisting only of loopback, RFC 1918 LAN, and
Tailscale/shared-range addresses. It found no directly assigned global IPv4
endpoint and no installed Python libtorrent package.

The SSH/Tailscale address was control-plane only and was rejected as the uTP
data endpoint. No public-IP service, tracker, DHT node, swarm, or other host
was contacted. No directory, fixture, listener, background process, package,
checkout, firewall, router, or VPN state was created or changed, and no uTP
packet was sent. The result is a bounded external precondition observation,
not WAN interoperability or performance evidence.

## Controlled Mapped uTP WAN Result: 2026-08-10

Completed Tactical
[`127`](../tactical/127-mapped-utp-wan-interoperability.md) corrects the
direct-interface premise and establishes libtorrent `2.0.13.0` in an isolated
user-owned environment on the authorized NATed peer. One named, finite UDP
UPnP lease exposed its forced-uTP seed. The local RSTorrent route to the
redacted external endpoint used the ordinary Internet interface rather than
Tailscale, and SSH remained control-plane only.

RSTorrent downloaded and hash-verified the exact 2,097,883-byte fixture in
82.239 seconds. Both owners observed exactly one uTP peer and zero TCP peers.
Libtorrent reported 1,807 outbound and 909 inbound uTP packets with zero loss,
timeout, fast-retransmit, or resend counters. RSTorrent classified every
received UDP datagram as uTP with zero drops, observed 155.655--168.723 ms
smoothed RTT, 0--2.211 ms queue delay, a fixed 548-byte MTU, and zero
retransmission/loss/timeout high-waters. Terminal task, connection, half-open,
and queue ownership was zero.

The 82-second elapsed time is recorded as an observation, not a stable
performance baseline or acceptance threshold. RSTorrent was the leecher and
sent only request/control traffic; its observed fixed 1,056-byte send
congestion window therefore does not measure RSTorrent's bulk-send controller.
That observation selected a complementary WAN direction with RSTorrent as seed
before product transport policy.

The exact lease was deleted and query-confirmed absent. An independent audit
also found no owned helper process or per-run directory. Raw endpoint,
gateway, peer-ID, and packet data were not retained. The reusable isolated
oracle environment is the only intentional remote residue.

Closed Tactical
[`130`](../tactical/130-utp-transport-solidification.md) adds the first
complementary observation with RSTorrent as the locally mapped bulk sender.
Pinned libtorrent downloaded the exact fixture in 92.140 seconds over the
ordinary public route with one uTP peer, zero TCP peers, exact hash and upload
accounting. RSTorrent observed 153.315--156.719 ms smoothed RTT, 0--1.090 ms
queue delay, a 1,056--6,864-byte congestion window, fixed 548-byte MTU, and
zero transport drops or retransmission high-waters; libtorrent recorded one
timeout. Joined deletion plus an independent audit proved the exact finite
local UDP mapping absent, and all local/remote transient resources were
removed. Treat this as one sample; the tactical's fresh bidirectional cohort
still owns any range or median.

That cohort attempt is now evidence-limited. Three separately captured
local-send successes have 85.798--92.140-second whole-case times (90.957
median); the two instrumented active transfers are 58.777 and 64.528 seconds.
They retain exact hashes, one uTP/zero TCP peers, 153.315--177.030 ms observed
smoothed-RTT extrema, 0.807--2.793 ms maximum queue delay, 6,864--8,209-byte
maximum congestion windows, fixed 548-byte MTU, and zero RSTorrent
retransmission/loss-collapse high-waters. Two other local-send attempts hit
the unchanged 180-second bound, each with exact cleanup; diagnostic retries
immediately around them passed. The external attempt budget expired before a
compliant three-sample remote-receive summary was retained. These data are a
stability gap, not a performance baseline or threshold.

Completed Tactical
[`140`](../tactical/140-incoming-utp-reachability.md) adds one ordinary
product-owned incoming sample after explicit maintainer direction reopened its
initially evidence-limited physical stage. The product session created and
independently verified one finite 3,600-second UDP mapping for its actual
shared UDP/uTP socket. Pinned libtorrent `2.0.13.0` on the off-LAN peer dialed
the redacted public endpoint over the ordinary Internet route, with
SSH/Tailscale used only for control, and downloaded and SHA-1-verified all
2,097,883 bytes in 77.347993 seconds. Both sides observed one uTP and zero TCP
peers. Libtorrent recorded 1,494 incoming and 1,586 outgoing uTP packets,
including 1,493 incoming payload packets, with one timeout and zero loss, fast
retransmit, or resend. Joined shutdown deleted the exact mapping, an
independent inventory found it absent, and local and remote processes,
directories, and temporary artifacts were absent.

One preceding product-owned mapped dial reached the unchanged 180-second
limit with zero libtorrent uTP packets and also cleaned exactly. Bounded
product UDP/uTP counters now survive controlled shutdown to distinguish a
future gateway-path loss from local classification or admission failure. The
passing run proves one product-owned public incoming-uTP path. It does not
establish a timing or throughput baseline, public-DHT discovery, or a
repeatable WAN cohort.

The controlled loopback transport matrix passes six deterministic real-socket
profiles against pinned libtorrent in 72.868 seconds on its final rerun.
Clean, alternating delay/jitter, one-percent sparse DATA loss, exact
duplicate/reorder ordinals, three-packet burst loss, and the fixed 548-byte
black-hole baseline all transfer and hash-verify the exact fixture with
bounded queues and terminal zero ownership. The impairment rows exercise
RSTorrent retransmission and once-per-RTT congestion reduction without a
timeout collapse; every ordinary profile retains selected and candidate MTU
548 with zero probe counters.

The separate diagnostic profile completes in 4.200 active seconds. Its
controlled 1,280-byte black hole drops three oversized probes and forwards
three same-sequence fragmentable retries. Six total probes split into three
acknowledgements and three failures, converge to a 1,269-byte proven floor,
and produce zero congestion reductions or timeout collapses. This measures the
runtime state/feedback loop, not Internet PMTU: the portable shared UDP sender
does not apply per-emission fragmentation intent to the OS socket. Ordinary
runtime therefore remains fixed at 548 bytes.

Completed Tactical
[`137`](../tactical/137-product-utp-path-mtu-discovery.md) closes that bounded
product follow-up. The verified clean path selects 1,457 bytes and emits 1,471
DATA packets in 2.996 seconds; the controlled 1,280-byte black hole selects
1,269 bytes after three acknowledged and three failed probes plus three exact
fragmentable retries. Five alternating clean-path pairs reduce median DATA
packets from 3,978 fixed to 1,473 dynamic, a 62.97% reduction, while median
time and CPU improve and RSS/queue high waters do not materially grow. Exact
hashes, rate-limit preservation, pinned-libtorrent application transfers in
both roles, and terminal cleanup pass. These remain controlled packetization
measurements, not a public-WAN speed claim.

## Public Product-uTP Metadata Observation: 2026-08-11

Completed Tactical
[`132`](../tactical/132-utp-default-readiness-evidence.md) ran exactly one
explicit `product-utp` profile from clean commit `c4034f0`. It used the stable
catalogued Big Buck Bunny magnet, no peer hints, a fresh temporary root, a
metadata-only target, 30 peer/pending slots, a 64 MiB buffered-payload ceiling,
a 512 MiB wire ceiling, a 180-second owner deadline, and one ten-second total
cleanup deadline. It did not map or advertise an incoming endpoint.

Verified metadata arrived in 2.862383 seconds and the process exited in
2.876334 seconds. Two tracker response batches supplied 147 peers and the
engine made 50 logical dial attempts. Endpoint-free peer high waters were one
connected, one TCP, one uTP, seven confirmed-uTP records, eight suppressed
records, and 142 unknown records. This changing swarm therefore exercised
both successful uTP selection and TCP fallback; the retained per-endpoint
counts reveal no addresses.

The fixed uTP owner reached 30 connection workers, sent 137 datagrams/3,127
bytes, retransmitted 56 datagrams/1,120 bytes, and selected exactly 548 bytes.
Its connection-datagram and retransmission queues reached 16 and one;
delivered, unsent, and sent-byte high waters were 8,448, 110, and 119. Shared
session UDP reached two tasks, a DHT queue of five, and a uTP route queue of
16. It received 303 datagrams/91,812 bytes, classified 69 uTP datagrams/23,281
bytes, and reported zero malformed, unknown-connection, stale-generation,
route, DHT, or uTP drops and zero worker panics. Terminal connections, half-
opens, UDP tasks, DHT queue entries, and uTP queue entries were all zero;
stderr and the output root were empty, and the root was removed.

IPv4 DHT reached 12 nodes and 228 responses; IPv6 participated with one node
and one response. Neither family supplied a peer value during the short run,
so tracker discovery owned this sample. These numbers are dated compatibility
and default-readiness evidence. They do not establish incoming UDP
reachability, congestion fairness, stable discovery latency, or a performance
threshold, and no repeat public attempt is authorized by the completed
tactical.

## Comparator Outcome

Tactical `015` added the smallest harness that can:

1. select a catalog entry and comparison mode;
2. run a bounded libtorrent reference download and a bounded RSTorrent
   download headlessly in isolated temporary directories;
3. validate identity, verified completion, and output size;
4. emit the paired classification and core timing/resource metadata as JSON;
5. retain bounded diagnostic evidence on an actionable mismatch; and
6. exercise one available tracker-based catalog entry.

Selective pinned-reference checkout tooling and the single-sided DHT harness
landed as prerequisites. Deterministic catalog, classification, threshold,
order, and summary tests, a controlled full comparison, the first paired
metadata run, and the first bounded public full pair now pass or produce an
honest classified result. The comparator does not add product UI, establish a
CI speed gate, or change DHT scheduling itself.

## Bounded Write-Batch Evidence: 2026-08-01

Tactical `032` separates logical accepted blocks from physical write batches.
It drains no more than 16 already-admitted blocks or 256 KiB without waiting,
coalesces exact adjacent same-piece ranges, and retains per-block completions
and verification fences.

Three controlled 32 MiB selective-hash runs published exact content and
cleaned up at 1.354, 1.143, and 1.124 seconds. Their 1.143-second median is a
neutral 4.4% improvement over the preceding 1.196-second measurement, below
the predeclared 20% claim threshold. The shape did change materially: every
run reduced 2,048 logical blocks to 144--154 physical writes, reached the
16-block/256 KiB caps, and spent 0.232--0.331 seconds in write service.

The retained three-pair product tracker+DHT Big Buck Bunny cohort used a newly
built probe and 300-second owner limits. All reference owners reached 50% in
27.26--29.94 seconds. All RSTorrent owners timed out at 345--351 of 1,055
pieces with zero piece-hash failures and successful cleanup. Each reduced
5,648--5,740 logical blocks to 500--509 physical writes. Write service consumed
51.4--54.9% and hash service 39.1--41.6% of wall time, leaving combined
serialized storage service at 93.0--94.2%. This is a structural batching claim,
not a latency, functional-parity, or protocol claim.

[`storage-throughput-architecture.md`](storage-throughput-architecture.md)
now records the source-derived end-state needed to test the next causal slices:
batched durability outside hash service, immutable positional spans,
independent bounded write/hash queues, optional pending-write read-through,
and eventual session/root fairness. The proposal does not convert this evidence
into an implementation or speed claim.

## Batched-Checkpoint Controlled Evidence: 2026-08-02

Tactical `052` adds two retained 128 MiB loopback profiles before changing
behavior. The three-file engine-only profile uses 512 256 KiB pieces and
8,192 blocks and completed three exact runs in 36.564--38.896 seconds, with a
37.594-second median. Its serialized write service consumed
31.108--34.088 seconds while 8,192 logical blocks became 542--546 physical
writes. It retains the current execution baseline independently from SQLite.

The application-service profile runs a separate 512-piece multi-file torrent
through the path-backed session and `synchronous=FULL` SQLite checkpoint sink.
The exact `e618d2b` pre-change executable completed three runs in
50.019--50.301 seconds, with a 50.085-second median and exactly 514
post-metadata revisions every time: 512 per-piece have transactions plus two
final state transitions. Its SHA-256 fingerprint was
`323722b2e925ffc9e7844a624af5d8f1fe2601dda59d61983a8c264b97bb28c6`.
An earlier 12.707--13.370-second observation came from a stale binary and is
explicitly rejected.

After the joined checkpoint owner removed per-piece payload sync and batched
have persistence, the source-matched executable completed three exact runs in
44.580--45.282 seconds, with a 45.221-second median and only 16--18
post-metadata revisions. That is a 9.7% controlled median reduction and a
28.6--32.1x transaction-amplification reduction. Payload hashes, raw info,
complete have geometry, publication and cleanup matched in all six retained
runs. Latency remains a single-machine development observation rather than a
product threshold; positional and concurrent storage work is still pending.

The final graduation cohort used current executable SHA-256
`b0aa5215db00ee32243a241c12f50bc68f0b1942fba88a4326958d70eb04de63`.
It completed at 45.740, 46.735 and 46.380 seconds, for a 46.380-second median
and exactly 18 post-metadata revisions every time. This remains 7.4% below the
exact pre-change median with a 28.6x revision reduction. All three runs matched
the 512-piece have geometry, exact payload SHA-1, raw info, publication and
cleanup.

The contemporaneous engine-only control also records an intentionally rejected
noisy cohort. Current code first measured a 41.959-second median, but an
isolated rebuild of exact pre-change commit `e618d2b` then measured 36.530
seconds and the current binary immediately followed at 36.326 seconds. Exact
content and batch geometry held, so there is no persistent raw write/hash
regression attributable to the checkpoint split. The public comparator is not
causal for this tactical because its RSTorrent owner is the non-resumable
engine probe and never instantiates the SQLite checkpoint path; public
full-download comparison resumes when later slices change that shared hot
path.

## Immutable Positional-Plan Evidence: 2026-08-02

Tactical `053` replaced ordinary single-file, wanted-file and part-file
payload writes plus every piece-hash read with immutable positional plans over
retained handles. It deliberately retained one executing operation, so this is
a foundation and service-cost result rather than a worker-concurrency claim.

The final 128 MiB engine cohort used executable SHA-256
`d6244ffca595fe57251a45254ba7ed7b3a74d7f500cd184629fd312b873ae8ea`.
It completed at 33.679, 34.134 and 33.279 seconds, for a 33.679-second median,
5.9% below the exact 35.792-second pre-change median. All 8,192 blocks reached
the 16-block/256 KiB batch caps, all three file hashes matched and cleanup was
exact. Physical calls varied from 562 to 566 versus 544--548 before, while
serialized write service fell from 30.928--31.979 seconds to
27.131--28.353 seconds. The service reduction, rather than call count alone,
is the retained causal observation.

The SQLite-backed application cohort used executable SHA-256
`42247bbcdfc91bac4964eb975d7b0a038f89203228616589fe44860d23ab5594`.
Its 46.069, 45.594 and 45.590-second transfers produced a 45.594-second
median, 1.7% below Tactical `052`'s final 46.380-second median. Every run
retained exact 512-piece state, payload SHA-1
`9224038c2041d03f6f8eb46a7f618fc32cf34e67`, publication and cleanup, with
17--18 post-metadata revisions. Checkpoint policy and transaction shape did
not change.

Three selective-file runs additionally proved the wanted/skipped/padding
join, part-file reopen and materialization with exact piece/file hashes. The
mixed-source and controlled paired-publication cases passed, three forced
restarts retained conservative have state, and all pre-sync,
post-sync/pre-commit and post-commit crash outcomes remained one-sided. The
next profile-changing slice is bounded independent write/hash execution; it
must retain these exact fingerprints, integrity outcomes and cleanup bounds.

## Large Local Throughput Baseline: 2026-08-02

Tactical `054` adds
`tests/interop/local_throughput_compare.py` as the retained large-transfer
screen. It uses one pinned libtorrent `2.0.13` loopback seeder, a materialized
deterministic single-file source, one direct peer, no discovery, alternating
client order (rotating when several RSTorrent points are present), immediate
per-output cleanup and exact whole-file SHA-1. Transfer
time excludes fixture construction, torrent hashing and final validation.

Schema `2` can run multiple RSTorrent `WRITE/HASH` concurrency points against
one libtorrent observation per workload while rotating order across
repetitions. Each raw result carries its point; the report emits medians,
RSTorrent/libtorrent ratios and an optional executable minimum-throughput or
minimum-ratio gate. Tactical `054` treats this simple large-transfer matrix as
the first optimization gate. The current-machine graduation command uses
three repetitions and a 170.667 MiB/s RSTorrent floor, which is 10 GiB in 60
seconds; exact bytes, SHA-1, publication and cleanup remain unconditional.

The first 1 GiB/256 KiB RSTorrent run failed to finish in more than four
minutes because full swarm geometry was recomputed after each event. Two later
10 GiB process samples exposed per-piece whole-block contributor scans and
active-piece scans that included pieces with no missing request. Checked
incremental phase/request/contributor indexes, a 100 ms maintenance snapshot
cadence and a requestable-active-piece index removed those costs. The
10 GiB/256 KiB row moved from 119.525 seconds immediately before the final
index to 30.042 seconds after it.

The final one-run-per-point screen used executable SHA-256
`1ac603546048301173505dc784b77a073379878bb6642c339ab240f3d95fa097`:

| Size | Piece | RSTorrent MiB/s | libtorrent MiB/s | RST/libtorrent |
| --- | ---: | ---: | ---: | ---: |
| 1 GiB | 256 KiB | 479.5 | 477.9 | 100.3% |
| 1 GiB | 1 MiB | 638.5 | 485.9 | 131.4% |
| 1 GiB | 4 MiB | 609.5 | 504.5 | 120.8% |
| 1 GiB | 16 MiB | 342.3 | 484.4 | 70.7% |
| 10 GiB | 256 KiB | 340.9 | 362.6 | 94.0% |
| 10 GiB | 1 MiB | 490.1 | 520.6 | 94.1% |
| 10 GiB | 4 MiB | 597.0 | 959.0 | 62.3% |
| 10 GiB | 16 MiB | 288.9 | 948.4 | 30.5% |

Every one of the 16 transfers reported exact bytes, zero failed/redundant
payload, the expected full-file SHA-1, complete publication and successful
cleanup. All RSTorrent 10 GiB rows finished in 17.151--35.451 seconds, meeting
the maintainer's informal under-one-minute screen. This cohort used a warm,
uncontrolled operating-system page cache and only one run per point, so it is
a baseline and causal scaling result rather than a stable parity or hardware
ceiling claim. The larger-piece write-service gap remains open for Tactical
`054`'s raw-stage and concurrency sweeps.

The first common-fixture concurrency discriminator used 10 GiB/4 MiB, three
runs and `4/4` versus `8/4`. RSTorrent medians were 23.631 seconds (433.3
MiB/s) and 16.136 seconds (634.6 MiB/s), while libtorrent's median was 9.627
seconds (1,063.6 MiB/s). The six RSTorrent samples spanned 15.477--27.850
seconds despite the common fixture. The candidate therefore remains `8/4`,
but the result also demonstrates why isolated rows cannot select a default;
the full rotating matrix and repeated finalist cohort remain required.

The retained raw comparator now consists of the
`rstorrent-storage-stage-profile` diagnostic and
`tests/interop/storage_stage_profile.py`. Its default 10 GiB/4 MiB workload
uses a deterministic bijection to permute every 256 KiB positional write, a
bounded write-complete-per-piece hash queue, the engine's 16 KiB positional
hash reads, full allocation, exact piece hashes and cleanup. Sync is measured
after and separately from the transfer-like interval; file hashes are labeled
warm-cache observations.

The first one-run five-point screen measured combined throughput of 1,017.4,
1,008.0, 2,020.9, 1,987.3 and 2,237.1 MiB/s at `1/1`, `2/2`, `4/4`, `8/4`
and `8/8`. Raw writes were 3,369.9--4,018.5 MiB/s; warm file SHA-1 scaled from
1,278.7 MiB/s at one worker to 8,051.7 MiB/s at eight. Every stage used exact
operation counts and hashes and cleaned both materialized 10 GiB files. The
integrated 10 GiB/4 MiB `4/4` median is therefore only 21.4% of its raw
combined point. SHA-1 hardware capacity is not the current owner; integrated
write-service inflation and scheduling remain to be profiled.

The resulting five-second integrated process sample found that the supervisor
still scanned all blocks in a piece to locate the first missing request,
refresh requestability, detect idleness and confirm hash eligibility. Checked
per-piece missing/active counts and a retry-safe first-missing cursor now make
those hot decisions scalar. The existing generation join already proves one
successful write completion for every planned block before hashing; test-only
recomputation independently validates the cached values from block phases.

With executable SHA-256
`7bf6b1f3f129dff1e5e3eba5c5cc802680db12120743003428d6c1119db32ac7`,
the final three-run `4/4` medians are:

| Size | Piece | RSTorrent MiB/s | libtorrent MiB/s | RST/libtorrent |
| --- | ---: | ---: | ---: | ---: |
| 1 GiB | 256 KiB | 506.3 | 481.6 | 105.1% |
| 1 GiB | 1 MiB | 699.3 | 497.5 | 140.6% |
| 1 GiB | 4 MiB | 757.6 | 515.3 | 147.0% |
| 1 GiB | 16 MiB | 715.3 | 491.4 | 145.6% |
| 10 GiB | 256 KiB | 336.2 | 471.5 | 71.3% |
| 10 GiB | 1 MiB | 804.4 | 559.2 | 143.8% |
| 10 GiB | 4 MiB | 1,031.6 | 1,074.4 | 96.0% |
| 10 GiB | 16 MiB | 720.3 | 1,031.8 | 69.8% |

All 24 RSTorrent observations passed exact-byte, whole-file SHA-1, zero
failed/redundant payload, publication and cleanup checks. Every 10 GiB run
finished in 9.408--31.652 seconds. A final 10 GiB/4 MiB concurrency cohort
measured `4/4` at 1,074.1 MiB/s, `8/4` at 1,028.6 MiB/s and libtorrent at
1,061.4 MiB/s. The retained desktop selection is therefore `4/4`; the former
`8/4` advantage disappeared with the scheduling correction.

The selected point's SQLite-backed application profile initially remained far
slower than its engine control: three 128 MiB transfers took 6.894, 7.006 and
7.044 seconds, while the SQLite-independent steady median was 0.555 seconds.
A process sample attributed the application gap to synchronous full Disk view
projection on nearly every block transition, not payload sync, SQLite or
SHA-1. Ordinary storage observations are now coalesced to 100 ms while
checkpoint transitions, errors and terminal state force immediate delivery.

The source-fingerprinted application executable
`b7ab993953f760219b35d9f00cabf3d71cb6877ed7fd1108f11e4853fa081516`
then completed three transfers in 0.567, 0.534 and 0.524 seconds: a
0.534-second median, or 239.7 MiB/s. Each run retained exact payload SHA-1,
512 pieces, four post-metadata durable revisions, publication and cleanup.
This is a controlled application-path result rather than a public-swarm claim.

Tactical `054` closed with one authorized headless full-reference Big Buck
Bunny pair against changing public peers. RSTorrent ran first. Both clients
published the catalog's exact 276,445,467 bytes, 1,055 pieces and three files
with successful cleanup:

| Implementation | Metadata | Publication | Post-metadata payload interval |
| --- | ---: | ---: | ---: |
| RSTorrent | 17.264 s | 29.323 s | 12.059 s |
| libtorrent 2.0.13 | 22.723 s | 36.599 s | 13.875 s |

RSTorrent reported zero piece-hash failures, 4,849,664 redundant bytes,
2.323 seconds summed write service, 1.011 seconds summed hash service and exact
16-block/256 KiB batch high waters. Libtorrent reported zero failed bytes and
21,036,611 redundant bytes. The 0.801 publication-time ratio is one
source-order- and peer-population-dependent observation, not evidence that
RSTorrent is generally faster or a new public regression threshold.

## Hardware Performance Baselines: 2026-08-03

Tactical `057` turns the Tactical `054` matrix into explicit, reviewable
performance policy. Profiles under `tests/perf/baselines` select exact rows,
repetitions and hardware/runner requirements; they keep observed calibration
separate from required floors. An inapplicable environment exits before
fixture allocation and reports `not_applicable`. Hostname, CPU, memory,
temporary filesystem, toolchain, commit, binary SHA-256 and uncontrolled cache
policy remain evidence rather than implicit profile selectors.

The local retained commands are:

```bash
uv run --project tests/interop --locked python \
  tests/interop/local_throughput_compare.py \
  --baseline-profile kmacbook-m4pro --profile-tier smoke \
  --output /tmp/rstorrent-engine-throughput.json

uv run --project tests/interop --locked python \
  tests/interop/application_view_throughput.py \
  --baseline-profile kmacbook-m4pro --profile-tier full \
  --output /tmp/rstorrent-application-views.json
```

`smoke` protects 1 GiB/256 KiB at `4/4`; `full` retains the three-run 1 GiB
and 10 GiB matrix at 256 KiB, 1 MiB, 4 MiB and 16 MiB. The local smoke after
profile integration measured RSTorrent at 615.6 MiB/s and libtorrent at
485.1 MiB/s, passed the row's 275 MiB/s and 0.50-ratio floors, and retained
exact bytes, whole-file SHA-1, zero failed/redundant payload, publication and
cleanup.

The application runner holds one deterministic 1 GiB/256 KiB fixture and
pinned libtorrent seed while rotating three runs over idle, each production
view combination, every view, and a one-second all-view consumer. Every one of
the 39 application transfers verified 4,096 pieces, compared the exact
published payload and removed its case root. The calibrated medians are:

| Mode | MiB/s | Idle ratio | Serialized/batch stream | Maximum resets |
| --- | ---: | ---: | ---: | ---: |
| idle | 177.9 | 100.0% | 0 | 0 |
| library | 166.4 | 93.5% | 49 KB | 0 |
| general | 160.2 | 90.0% | 1.43 MB | 898 |
| peers | 158.7 | 89.2% | 2.96 MB | 902 |
| trackers | 158.3 | 89.0% | 1.60 MB | 900 |
| disk | 154.7 | 86.9% | 65.3 MB | 924 |
| files | 152.1 | 85.5% | 50.1 MB | 1,000 |
| logs-normal | 134.8 | 75.8% | 397.4 MB | 914 |
| logs-detailed | 126.6 | 71.1% | 547.6 MB | 921 |
| pieces | 123.6 | 69.5% | 48.6 MB | 1,231 |
| slow-all | 122.3 | 68.8% | 9.21 MB | 9 |
| logs-trace | 98.4 | 55.3% | 1.081 GB | 1,287 |
| all | 74.0 | 41.6% | 1.742 GB | 1,737 |

Library alone stays incremental. Summary introduces repeated overflow resets;
trace Diagnostics is the worst individual throughput and serialized-volume
offender, and the all-view adversary compounds the costs. The profile accepts
the measured behavior with regression headroom while the application-view
topic owns reducing it; those ceilings do not classify the reset storm as an
efficient target.

`.github/workflows/performance-baseline.yml` runs the uncalibrated, generous
GitHub Ubuntu 24.04 x64 smoke on relevant pull requests, the full tier weekly,
and either tier on manual dispatch. It validates explicit runner identity,
runs both comparators and uploads only JSON evidence. Its initial 20 MiB/s,
0.10 libtorrent-ratio and 3--10 MiB/s application floors are catastrophe
detectors, not hosted-hardware performance claims; calibration requires a
retained CI cohort.

The first hosted manual smoke on 2026-08-22 exposed a stale ownership
assumption in `application_view_throughput.py`: the diagnostic still treated a
v1 protocol info hash as both the application torrent owner and publication
directory. Application owners are opaque `t1-...` IDs and published payloads
use the verified metainfo name. The corrected diagnostic adds the magnet
paused, obtains the returned owner, opens owner-scoped views, resumes at the
measurement boundary, and validates both the protocol identity and publication
name. A local Apple M4 Pro smoke then passed idle, all-view, and delayed
all-view gates with exact payload hashes and clean teardown; hosted Ubuntu
then exposed a separate cold-build problem: the diagnostic's internal
two-minute build timeout could expire before measurement. The workflow now
builds both diagnostics explicitly outside measured time, retains the build
cache, and pins the uv executable.

The replacement manual hosted smoke
[`32568169955`](https://github.com/kzahel/rstorrent/actions/runs/32568169955)
then passed on Ubuntu 24.04 x64 and retained artifact
`performance-32568169955-1`. Its 1 GiB engine pair measured RSTorrent at
201.2 MiB/s and pinned libtorrent 2.0.13 at 341.5 MiB/s with exact SHA-1,
zero failed/redundant payload, bounded `4/4` storage ownership, publication,
and cleanup. Its 512 MiB application smoke measured idle at 59.5 MiB/s,
all views at 25.6 MiB/s, and the one-second delayed all-view consumer at
43.0 MiB/s; all three verified 2,048 pieces, the exact SHA-1, and cleanup.
This proves the repaired workflow and generous hosted catastrophe gates by
manual dispatch. It does not substitute for the first successful weekly
scheduled run or calibrate hosted performance claims.

## Availability-Ranked Activation: 2026-08-05

Tactical [`091`](../tactical/091-availability-ranked-piece-activation.md)
graduates rarest-first through deterministic operation counts, release CPU and
memory profiles, and a controlled skewed-availability transfer. The picker
retains ten bytes per piece: the 2,097,152-piece maximum uses 20,971,520 bytes.
Build/rebuild profiles remained linear from 131,072 through 2,097,152 pieces;
the maximum built in 28 ms and rebuilt an alternating dense update in 17 ms.
Four maximum states retained 83,886,080 bytes, built and queried in 92 ms, and
produced 101,367,808 bytes maximum RSS under `/usr/bin/time -l` with no swaps.

The hostile active trace places the only usable block after all 2,048 active
pieces. One hundred thousand selections make exactly 204,800,000 active
visits with zero inactive visits, picker comparisons, rebuilds, mutations, or
candidate inspections. Five release samples measured rarest-first at `0.995x`
the in-order median and `1.001x` p95, below the tactical's `1.10x` and `1.20x`
ceilings. Connection filtering separately stops at 256 ranked candidates per
maintenance pass and advances its sweep in the same heap allocation, avoiding
both a one-tick full scan and repeated-prefix starvation.

The controlled libtorrent `2.0.13.0` run used eight 64-KiB pieces. A choked
scripted metadata peer advertised pieces 0--6 before gated libtorrent exposed
all eight, making piece 7 the sole availability-one candidate and its only
useful source. RSTorrent verified piece 7 first, then published all 524,288
exact bytes with 65,536 resident payload bytes under the 262,144-byte limit.
The retained mixed-peer gate also repassed its exact 1-MiB publication.

A 2026-08-06 follow-up found that a full peer request window still caused an
inactive scan across the bounded detailed lookahead after each received block.
The scheduler now reuses one capacity-filtered fair connection order for its
active and inactive phases and never enters inactive activation without a
request slot. A 100,000-attempt hostile trace with all 256 planned pieces
reports zero inactive visits. Three-run 1-GiB cohorts improved from 397.6 to
447.5 MiB/s at 256-KiB pieces and from 369.2 to 469.7 MiB/s at 1-MiB pieces;
the matching exact pre-091 cohorts were 475.1 and 476.1 MiB/s. Hash-service
time returned close to the pre-091 range. These warm-uncontrolled measurements
are revision-comparison evidence, not replacement calibrated floors.

## MSE/PE Cost: 2026-08-09

Tactical [`111`](../tactical/111-mse-peer-stream-encryption.md) extends the
controlled loopback comparator with a release-only paired encryption mode. It
runs identical RSTorrent and pinned-libtorrent cohorts in alternating ordinary-
plain and forced-RC4 order, balances which implementation runs first, verifies
the exact method on both libtorrent endpoints and the payload hash, and reports
the median of within-pair throughput ratios. Schema 6 retains the process-tree
CPU seconds, core-equivalents, and host-capacity-normalized utilization
introduced in Schema 5 and adds the oracle-relative retention comparison.

On Apple M4 Pro / macOS 26.5.2 / Rust 1.97, six alternating 1 GiB pairs with
1 MiB pieces and storage `4/4` measured RSTorrent at 473.781 MiB/s plain and
364.813 MiB/s RC4. Its median within-pair ratio was `0.779873`, a 22.013%
regression. Pinned libtorrent `2.0.13.0` measured 493.383 MiB/s plain and
366.520 MiB/s RC4, with a `0.758292` median paired ratio and 24.171%
regression. RSTorrent retained 2.158 percentage points more of its plain
throughput, or `1.028x` the oracle's relative RC4 retention. This misses the
10% diagnostic target but clears the accepted 75%-of-plain catastrophe floor
and is not worse than the mature oracle, so the paired result does not justify
further RC4 optimization. Median process-tree load was 2.087 plain versus
2.077 RC4 core-equivalents for RSTorrent and 2.754 versus 2.615 for libtorrent;
throughput retention, not the wall-time-normalized CPU rate, is the decision
authority. Every run verified the 1 GiB SHA-1, asserted the required method on
both libtorrent endpoints, and cleaned up.

After profiling, the scalar RC4 loop uses an inline `u16` S-box and a 16-byte
unrolled production path. The final release microprofile measured 0.990 GiB/s
contiguous, 1.515 GiB/s in production-shaped 16 KiB chunks, and 5.629 GiB/s
across four independent streams. The 1 GiB paired outcome remains the
graduation authority: the contiguous microprofile's 1% diagnostic miss does
not override it. DH-768 public and shared-secret work measured 0.021 ms median
and 0.023 ms p95 over 100 samples each, so no keypair pre-generation pool is
justified.

Same-host setup added 0.447 ms with RSTorrent initiating and 2.075 ms with
libtorrent initiating, both below the 25 ms diagnostic target. A proxy with a
fixed 25 ms one-way delay observed two delayed turns for ordinary setup and
four for MSE: the measured 62.346 ms addition was within 20 ms of the expected
50 ms extra round trip. These are controlled local measurements, not a public-
swarm or permanent CI throughput claim.

Post-graduation Tactical
[`115`](../tactical/115-mse-policy-advertisement-and-peer-detail.md) uses that
evidence to avoid the RC4 payload cost under compatibility-only `allow`:
when both methods are offered, its responder now matches stock libtorrent's
plaintext-payload default. `prefer` and `required` retain RC4, and RC4-only
offers remain interoperable. No new throughput threshold or measurement is
introduced by that policy correction.

The final physical product gate ran on an API 37 Pixel 7a with five forced-RC4
oracle sessions. It observed a session DH high-water of three under the
four-job ceiling, full DH-owner drain, process descriptor high-water 177,
storage ownership high-water 6 under the 40-handle limit, one pending storage
request, exact publication, and cleanup. This is physical resource and product
evidence, not a mobile throughput comparison.

## Dual-Stack DHT Evidence: 2026-08-09

Tactical
[`112`](../tactical/112-dual-stack-transport-and-ipv6-dht.md) extends the
headless public probe with one session UDP owner and independent IPv4/IPv6 DHT
nodes. Its per-family report records lifecycle, local and externally observed
address, routing-node count, time to first valid response, time to K=8, query
and response counts, peer values, and datagram bytes. This is participation and
stall-localization evidence; it is not a latency comparison between families.

One bounded metadata-only Big Buck Bunny run completed in 107.553 seconds and
verified the exact 21,307-byte info dictionary for 276,445,467 payload bytes,
1,055 pieces, and three files. It issued two metadata requests, accepted two
blocks, had zero metadata hash failures, created no payload file, and cleaned
up.

| Family | Local endpoint | Externally observed address | Nodes | First response | K=8 | Queries / responses | Peer values | Datagram bytes sent / received |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| IPv4 | ephemeral wildcard | public address, not retained | 18 | 0.621 s | 0.621 s | 189 / 149 | 72 | 19,191 / 48,719 |
| IPv6 | selected global address, ephemeral port | matched selected address; value not retained | 40 | 0.621 s | 1.218 s | 60 / 41 | 0 | 7,308 / 17,293 |

The IPv6 node demonstrably bootstrapped and participated, while the useful
peer result in this sample came from the merged lookup rather than from an
IPv6 peer value. Controlled pinned-libtorrent `2.0.13.0` evidence supplies the
stronger IPv6 discovery gate: a DHT-only IPv6-loopback leecher discovered the
RSTorrent announcement and hash-verified exact payload. A separate direct
IPv6 transfer completed in 0.739 seconds, and incoming BEP 32 probes observed
one `find_node`, three `get_peers`, two `announce_peer`, and eight query forms.
Neither controlled loopback nor outbound public evidence claims an
off-network incoming IPv6 TCP path; Tactical `113` owns that gate.

## Concurrent-Torrent Admission Evidence: 2026-08-09

Completed Tactical
[`114`](../tactical/114-session-wide-concurrent-torrent-admission.md) adds a
release-build local comparator for one, two, three, four, and eight simultaneous
RSTorrent downloads from independent pinned-libtorrent `2.0.13.0` source
sessions. Independent oracle sessions prevent a single libtorrent session
thread from becoming the measured bottleneck. The authoritative Mac16,7 arm64,
macOS 26.5.2/APFS run used 128 MiB per torrent, 1 MiB pieces, one warm-up, and
five recorded repetitions per case.

| Active downloads | Median aggregate MiB/s | Median CPU cores | Maximum RSS bytes |
| ---: | ---: | ---: | ---: |
| 1, configured limit 1 | 218.319 | 0.972 | 47,267,840 |
| 1, configured limit 3 | 214.419 | 0.956 | 46,776,320 |
| 2 | 236.122 | 1.081 | 132,562,944 |
| 3 | 179.632 | 1.190 | 135,856,128 |
| 4 | 154.563 | 1.223 | 151,781,376 |
| 8 | 134.915 | 1.221 | 162,856,960 |

The limit-three/limit-one single-torrent ratio is `0.9821`, above the `0.95`
gate, and the two-torrent/one-torrent aggregate ratio is `1.0815`, above the
`0.90` gate. Every concurrent torrent produced 3--17 progress samples. Sweep
maxima were 41,762,816 request bytes, 33,554,432 payload bytes, 193,986,560
active-piece bytes/185 pieces, four writes, four hashes, eight registered
generations, eight peers, eight open files, and 0.011074-second shutdown;
terminal resource counters were zero. Throughput saturation above two is a
recorded limit of this host, not evidence to increase the default.

The physical API 37 Pixel 7a `product-concurrent-downloads` run observed
configured three/effective two, two active and one queued, automatic promotion,
three exact published hashes, and terminal zero resource ownership. Android
high-waters were 193,304 request bytes, 32,768 payload bytes, 257,768 active-
piece bytes/nine pieces, two writes, two hashes, and two registered generations.
The shared 40-handle pool held per-storage high-waters of 12, 12, and 18 with
pending high-water two. This is bounded physical resource/product evidence,
not an Android/desktop throughput comparison.

## IPv6 Firewall-Pinhole Evidence Gate

Tactical
[`113`](../tactical/113-ipv6-firewall-pinhole-and-incoming-reachability.md)
adds an opt-in, identity-free physical gate rather than treating a successful
SOAP response as reachability evidence. It preserves one listener while
checking a pre-pinhole failed off-LAN dial, one finite pinhole created through
the ordinary live settings path, a hash-verified exact 4,195,035-byte incoming
transfer, positive gateway packet count, deletion, typed `704`, a post-delete
failed dial, and terminal zero task/mapping/pinhole ownership. The ordinary
production path performs no packet polling; the two diagnostics exist only in
the retained test process and expose no gateway-assigned ID.

The harness and deterministic/scripted resource assertions are implemented.
Its structured no-opt-in skip and identity-free SSH/Python/IPv6-socket
preflight pass. On 2026-08-09, the reachable off-LAN verifier proved the
pre-pinhole dial fails. The gateway then advertised the expected service and
permissive firewall state but returned typed SOAP fault `606` at the
`AddPinhole` stage. Joined shutdown completed and no pinhole was created. No
positive timing, throughput, resource high-water, packet-count, cleanup-`704`,
or incoming-reachability result is recorded. The tactical stops at its explicit
authorization/control-transport boundary and closes with positive physical
capability unknown on the current hardware. Future evidence requires different
listener-side gateway hardware or a separately authorized transport study.

## Maintenance Contract

Feature tacticals add measurements only when their owner can report them
honestly. DHT, multi-peer, endgame, picker, storage, and performance work update
the relevant scenario definitions and append summarized evidence without
turning this topic into a raw run log.

When results motivate a queue change, update
[`capability-readiness.md`](capability-readiness.md) and the relevant focused
topic. Public-swarm evidence never upgrades a protocol claim by itself.
