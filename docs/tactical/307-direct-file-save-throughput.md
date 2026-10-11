# Measure And Bound Direct File Save Throughput

Status: Active; authorized implementation and incremental commits.

Topic: `direct-remote-file-streaming`

## Scope And Stopping Condition

Record the current production save path, build a repeatable local benchmark,
and retain a measured optimization only after integrity, cancellation and
resource-bound evidence pass. Compare release-mode host transfers with the
actual `clients/web/src/direct-file-save.ts` consumer, using a disposable
verified torrent and browser profile. Stop with reproducible measurements,
bounded production behavior, validation and the owning records reconciled.

Large remote saves target Chrome/Edge's streaming file writer. Firefox and
Safari large-file support is deferred by maintainer direction; retain the
existing 32-MiB Blob fallback. Playback/Open, PlaysVideo integration, IndexedDB,
OPFS as a production destination, TURN, deployments and releases are non-goals.
No new dependency or user setting is required by this slice.

## References And Design Review

Read the direct-remote-file-streaming, http-file-serving-and-streaming,
application-connection-architecture, client-surfaces, web-ui-design and
application-view-api topics and the oracle-driven-engine-campaign runbook.

- RFC 8831 sections 6.5/6.6: reliable ordered SCTP messages and fragmentation;
  preserve the existing 16-KiB payload framing rather than enlarging messages.
- RFC 8260: message interleaving is a transport facility, not application
  write credit. Do not infer bounded browser memory from SCTP flow control.
- WebRTC specification `RTCDataChannel.bufferedAmount` and File System
  specification `FileSystemWritableFileStream`: separately bound application
  credit and transport buffering; acknowledge only completed writer calls,
  and report completion only after writer close.
- Pinned libtorrent `7d7fc38fac61177fa5e02148f791b2f65250b09d`,
  `src/peer_connection.cpp::fill_send_buffer`: account for queued plus reading
  bytes before starting more reads. `test/test_alert_types.cpp`'s
  `performance_warning` case verifies the low-watermark diagnostic. Searching
  pinned tests/simulation finds no direct watermark throughput test. Libtorrent
  has no browser DataChannel/save writer; its BitTorrent transport is not an
  executable oracle for this path. Adopt bounded production rather than its
  dynamic upload-rate watermark. No reference source is imported.
- JSTorrent `211fd65bd056a4287e61c27162533407d9131d49`,
  `packages/engine/src/streaming/torrent-source-session.ts`,
  `streaming-playback-session.ts` and client `VideoPlayer.tsx`: range ownership,
  cancellation, bounded current/next demand and actual PlaysVideo integration
  inform the deferred playback seam, not an alternative save authority.

## Ownership, Dependencies And Bounds

The factory starts the lazy UDP/RTC driver; the driver owns endpoint lifetime,
the outbound queues and up to four range tasks. Each range task owns its media
lease, read cursor and acknowledgement state. Endpoint cancellation joins all
range tasks and closes sockets; request cancellation interrupts reads/waits.
The browser transfer owns its peer, sink and abort subscription and closes all
three on terminal outcome. No detached producer or unbounded prefetch is added.

The deterministic window state belongs beside the codec, independent of Tokio,
media storage and RTC. Endpoint runtime depends inward on it; client save code
continues to depend on the existing typed signaling seam. Media verification,
capability revocation and storage-generation fencing retain their current owner.

Start with the existing one-chunk baseline. Experiment with two/four chunks
(32/64 KiB) of outstanding payload per range without changing v1 frames or
write-before-ack. Four 64-KiB windows plus headers leave room under the existing
512-KiB endpoint application and 512-KiB transport ceilings. Bound the ACK
mailbox and browser pending messages explicitly. Acknowledgements must name a
sent boundary, move forward, and never acknowledge beyond sent bytes; preserve
the inactivity deadline and reject floods without growing memory.

Android/iOS remote hosting is absent and feature-off, so this host-only window
does not change their engine/storage semantics or generated boundary. Browser
save behavior applies to the shared remote React consumer. Mobile hosting and
native presentation parity remain separate work.

## Benchmark And Validation

Use bundled Playwright Chromium, release Rust, temporary profiles and an
independently generated 64/256-MiB verified fixture. Separate connection time,
transfer/writer-close time and post-save SHA-256 verification. Compare a real
disk-backed OPFS writable used only as a harness substitute for destination
selection with a bounded checking drain; label the substitute honestly, since
this does not qualify the external save picker. Test repeated cohorts and an
artificial delayed-ACK cohort (not a simulated WAN). Record queue high-water
marks, bytes, selected direct pair and zero terminal owners. No public swarm,
primary browser, installed profile or relay payload is involved.

Exercise invalid/duplicate/future ACKs, partial final chunks, concurrent ranges,
slow sinks, queue overflow, cancellation and terminal cleanup. Run focused then
workspace Rust checks, web typecheck/tests, and the existing production-shaped
remote verifier where proportionate. Keep raw reproducible metrics in the
tactical or an associated tracked report, remove temporary artifacts, and
commit plan, baseline and measured implementation separately.

## Restart Checkpoint

Plan recorded. Next: benchmark the unmodified one-chunk endpoint and actual
production consumer, then compare bounded windows against that baseline.
