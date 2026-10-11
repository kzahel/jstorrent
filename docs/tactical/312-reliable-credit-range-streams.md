# Reliable Credit-Based Range Streams

Status: Active; maintainer-approved implementation.

Topic: `direct-remote-file-streaming`

## Scope And Stopping Condition

Replace the small per-chunk application ACK window with negotiated, reliable
ordered range streams. Keep authenticated file-scoped signaling and verified
media authority. Land the host, reusable browser range consumer, completed-file
Save integration, compatibility, adversarial/lifecycle evidence and repeated
throughput comparisons. Stop after choosing measured defaults and recording
the result. Commit the plan, implementation and evidence as they become ready.

Playback presentation, HTTP/service-worker interception, automatic reconnect
or resume, mobile remote hosting, new RTC dependencies, TURN, deployment and
public-network qualification are outside this slice. Large saves continue to
target Chrome/Edge; the existing small Blob fallback remains.

## Sources And Adopted Lessons

- RFC 8831 sections 6.6/6.7: reliable ordered channels; encoded messages at
  most 16 KiB without an interleaving guarantee. RFC 9110 range semantics:
  arbitrary half-open ranges and representation fencing, without pretending
  this binary transport is an HTTP server. W3C DataChannel buffering is not
  application consumption or successful writer close.
- Pinned libtorrent `7d7fc38fac61177fa5e02148f791b2f65250b09d`:
  `src/peer_connection.cpp::fill_send_buffer` counts queued and reading bytes;
  `incoming_cancel` documents the already-issued disk-job race.
  `test/test_fast_extension.cpp::reject_fast` checks terminal rejection does
  not recreate requests. Adopt bounded preparation, explicit terminal barriers
  and no ID reuse; BitTorrent/TCP is not an SCTP throughput oracle.
- Retained rtc 0.20.4 `src/data_channel/mod.rs::send/outstanding_bytes` and
  `tests/sctp_receive_buffer_deadlock.rs`: cap queued plus unacknowledged
  bytes, avoid large fragmented messages and preserve network/timer polling.
- JSTorrent legacy source now lives at `../jstorrent-typescript`, revision
  `211fd65bd056a4287e61c27162533407d9131d49` (the old sibling name now owns
  this implementation). `packages/engine/src/streaming/torrent-source-session.ts`
  validates arbitrary ranges and propagates disposal/abort.
  Tactical 309 disproves a large storage-read gain on this machine; preserve
  the existing 64-KiB maximum verified read rather than alter engine storage.
  No external source, fixture or dependency is imported.

## Protocol And Compatibility

The existing authenticated Open already binds one file capability to a peer.
An optional HELLO on the existing v1 control channel negotiates v2 and a shared
receive budget (maximum 8 MiB). An old host's exact v1 malformed response to
that HELLO selects v1; no timeout or ambiguous response silently downgrades.
Old consumers that omit HELLO keep v1. After successful negotiation the browser
opens one reliable ordered v2 bulk channel. Control stays on the first channel;
DATA, END, CANCELLED and ERROR stay on the bulk channel in producer order.

OPENED returns length and an opaque capability-generation version, not a
payload digest. READ names a never-reused monotonic ID, [start,end), initial
credit and bounded priority. Offsets and cumulative counters are u64. CREDIT
carries absolute consumed/send-limit counters: stale duplicates are harmless;
future consumption, shrinking grants and grants beyond the admitted window
are invalid. Each range reserves a fixed part of the shared connection budget;
all ranges together fit it. At most four range owners exist.

END means producer completion; Save succeeds only after consumption and writer
close. CANCEL stops new reads, joins its producer, then emits CANCELLED after
already-queued data. Its reservation is retained until the receiver drains or
discards those bytes and acknowledges that barrier. Connection failure fails
every range. Reconnection requires new authorization/version checks; automatic
resume is not implemented here.

## Ownership, Dependencies And Limits

Runtime-independent codecs, cumulative-credit transitions and admission live
in the direct-file crate and depend on no sockets/files/tasks. Endpoint driver
owns RTC, sockets, lane scheduling, task joins and aggregate admission. One
owned cancellable producer holds each media lease and bounded read batch.
Credit updates use a coalescing bounded mailbox, not an unbounded ACK queue.
The driver schedules bounded data work fairly, gives bounded urgent ranges
preference and always services controls/network/timers. Application queue,
transport outstanding bytes and browser retained payload have independent
limits. Wire messages remain <=16 KiB; verified reads <=64 KiB; browser writes
batch separately and flush at short ranges/end/credit starvation.

The browser connection owns both channels and range IDs, accounts queued
payload before async processing, returns credit only after successful sink
consumption and closes all ranges on failure. Cancelled bytes remain charged
until the bulk barrier. Allocation, frame counts and control traffic are
bounded independently. No application DTO changes or Android/iOS engine
semantics change: those surfaces do not host this endpoint and remain feature
off. Existing storage fencing, authorization/revocation and lifecycle owners
remain final.

## Landed Contract

No authenticated application/signaling DTO changes are needed. The already
file-scoped Open supplies authority; HELLO supplies optional transfer dialect
negotiation inside its authenticated DTLS channel. The opaque version is
SHA-256 of the capability generation token, never the token itself. It fences
that lease and does not claim a payload hash or automatic resumability.

All integer fields are big-endian. v2 messages start with version byte 2 and
a tag; range messages then carry a nonzero u32 ID. The file handle is implicit
in the authenticated endpoint, so READ cannot select another file.

| Message | Tag / total bytes | Fields after prefix and ID |
| --- | --- | --- |
| Legacy HELLO probe | version 1, tag 4 / 10 | budget u32, transport ceiling u32; no ID |
| OPENED | 0x80 / 50 | length u64, budget u32, ceiling u32, opaque version 32 bytes; no ID |
| READ | 1 / 27 | start u64, end u64, fixed window u32, priority u8 (0 bulk, 1 urgent) |
| CANCEL | 2 / 6 | none |
| CREDIT | 3 / 22 | consumed absolute offset u64, absolute send limit u64 |
| DATA | 0x82 / 15..16384 | offset u64, 1..16370 payload bytes |
| END | 0x83 / 14 | final produced offset u64 |
| CANCELLED | 0x84 / 14 | final produced offset u64 |
| ERROR | 0xff / 7 | existing bounded error code u8 |
| RELEASED | 0x85 / 6 | none; control-channel acknowledgement after owner join |

The producer sends terminal markers on bulk after its preceding data. The
receiver waits for both the bulk marker/consumption and RELEASED before
recycling a reservation or resolving successful reads. RELEASED may arrive
first on the independent control channel; it cannot bypass the bulk barrier.
Abort rejects the caller promptly while internal accounting still drains; a
whole Save abort closes the connection. Failed writes propagate their original
error and cause no later writes or credit from the failed connection.

Credit duplicates are ignored without extending the progress timeout. The
latest effective credit uses a watch mailbox; future consumption closes the
connection. Admission or ID violations also close rather than ambiguously
reusing state. Owner panic, queue failure or an unconsumed terminal reservation
closes the driver. Error paths run the same cancellation/join cleanup as
ordinary shutdown, including closing producer mailboxes before joining.

The shared receive budget defaults to 8 MiB. Callers can negotiate a smaller
budget and divide fixed windows across four overlapping ranges; there is no
8-MiB-per-range allocation. Browser writes default to 128 KiB, configurable
up to 256 KiB; short/end/starvation paths flush. Verified reads stay <=64 KiB.
The host application queue is <=512 KiB with 4 KiB reserved for controls; each
producer owns at most one 64-KiB read plus one encoded frame. Browser transport-owned
payload is charged against credit, with independently bounded frame overhead
and transient batch copies. The small Blob destination separately retains at
most 32 MiB, as before; successful Blob writes transfer ownership to that sink. It uses the real streaming file writer or the
existing bounded Blob sink, without IndexedDB or whole-file staging.

The negotiated transport ceiling defaults to 8 MiB. Actual bulk admission is
min(ceiling, max(64 KiB, measured RTT * 64 MiB/s)), preserving the measured small
local queue and allowing a delayed path's bandwidth-delay product. This is an
application admission target, not congestion control or a promised rate: SCTP
still controls transmission, recovery and acknowledgement. At most 512 KiB of
independent controls can be outstanding (ordinary traffic is much smaller).
Ready range frames rotate; urgent ranges get at most three preferred turns
before ready bulk work. Already-transmitted ordered data cannot be preempted.

No source/dependency replacement is introduced. SHA-256 was already locked;
its existing optional direct-file dependency becomes available to `webrtc` for
the opaque generation. The already-locked `log` 0.4.33 is linked only by the
experiment to observe numeric SCTP windows/recovery, without retaining log
text, endpoint details or payloads. Product hosts do not install that logger.

## Validation And Restart Checkpoint

Required: deterministic codec/credit/admission edges (u64 overflow, duplicate
and future updates, shared budget, ID reuse), real-browser exact arbitrary,
overlapping and concurrent ranges, slow/failed sink, withheld credit, cancel
with data in flight, connection failure and zero terminal owners. Compare v1
and v2 repeatedly using the actual production consumer with OPFS/checking
drain; measure delayed consumption separately from actual transport delay/loss
and never call an application timer a WAN test. Record memory high-waters.
Run focused feature-on/off checks, Rust baseline, web typecheck/tests and the
authenticated product verifier in proportion to the changes.

Checkpoint: protocol/credit/admission, native owned producers, dual lanes,
browser range consumption and Save integration are implemented. Real Chromium
checks cover four arbitrary/overlapping/empty ranges, owner release before
reuse, cancellation with queued bytes, harmless credit duplicates, faulty
future credit, withheld consumption and zero terminal resources. Existing v1
real-browser checks and old-consumer benchmark compatibility pass. Repeated
local comparisons are recorded below; final corrected network cohorts,
packet-loss recovery and Rust/web validation now pass. Authenticated product
verification and final evidence reconciliation are in progress.


## Experiment Ownership And Model Correction

The experiment can delay actual UDP ingress and egress independently by
0..250 ms, deterministically discard every Nth datagram (N>=20), and shape
outgoing wire bytes at 1..128 MiB/s. This sits below SCTP/DTLS and preserves
reliable retransmission behavior; it is not an application ACK timer. Delayed
queues share a 32-MiB bound and record explicit drops, overflow and high-water.
Ingress and egress own separate queues so shaped egress cannot delay incoming
ACKs accidentally. A 32-KiB token bucket bounds release bursts after a delayed
runtime wakeup; delays/rates remain a same-host simulation, not WAN evidence.

An initial fixed-delay/unbounded-catch-up model yields about 0.4..0.5 MiB/s for
both protocols at 100-ms RTT, including SCTP congestion recovery with no
intentional packet drops. One diagnostic v2 run records six fast-recovery
updates, one retransmission timeout and only a 142,377-byte maximum congestion
window despite ~7-MiB application transport allowance. Shaping initially still
allows overdue packets to catch up in bursts and yields variable 0.52..7.98
MiB/s. These are useful burst/stall observations, not clean throughput-ceiling
or stack-root-cause evidence. A bounded catch-up model gives 7.95/8.04/7.95
MiB/s for 8-MiB v2 OPFS saves at 100-ms RTT/16-MiB/s shaping, with no recovery
updates/timeouts and ~4.2-MiB maximum SCTP congestion windows.

A trial nonblocking receive pump in the product driver does not improve the
fixed-delay case (0.40 MiB/s); it is removed rather than retained as an
unmeasured hot-path optimization. The selected change is range credit, batched
reads/writes and bounded transport admission, not a UDP or RTC replacement.


## Validation Checkpoint

- `cargo fmt --all -- --check`: pass.
- `cargo clippy --workspace -- -D warnings`: pass.
- `cargo test --workspace`: 1,588 pass, 18 ignored; no retry required.
- `cargo clippy -p rstorrent-direct-file --features experiment -- -D warnings`
  and the corresponding `webrtc` check: pass.
- `cargo test -p rstorrent-direct-file --features experiment`: 20 pass,
  one opt-in public-STUN test ignored.
- `cargo check -p rstorrent-direct-file --no-default-features`: pass without
  warnings; the RTC-only payload helper is gated with its consumer.
- `npm run typecheck --prefix clients/web`: pass.
- `npm run test --prefix clients/web`: 508 pass, two skipped.
- Real Chromium v2 concurrent/overlap/empty/release/cancel/stale/future-credit
  and withheld-consumption checks pass, plus the retained full v1 corpus.
  Native credit, queues and owners return to zero. The consumer also saves
  exact bytes against the experiment's legacy-only v1 decoder, including its
  actual unknown-HELLO malformed response, without opening a bulk channel.
  This is native legacy-path evidence, not a historical binary claim.
- JavaScript syntax and `git diff --check`: pass. The authenticated full product
  verifier is running; it also covers the unchanged small Blob destination.
