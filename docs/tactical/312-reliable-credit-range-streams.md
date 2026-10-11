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

Checkpoint: source review and plan recorded; next implement pure protocol and
credit state, then native/browser adapters and evidence. Transport cap/pacing
defaults remain to be selected from measurements rather than assuming larger
queues improve throughput.
