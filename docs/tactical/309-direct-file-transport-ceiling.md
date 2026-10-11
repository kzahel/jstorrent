# Measure The Direct File Transport Ceiling

Status: Active measurement; production behavior unchanged.

Topic: `direct-remote-file-streaming`

## Scope And Stopping Condition

Before further tuning Tactical 307's 51.70-MiB/s local save path, establish
where throughput is lost. Compare the existing release endpoint/production
consumer with generated-byte range responses (same framing, 64-KiB credit and
sink) and a generated-byte raw reliable ordered DataChannel producer (same
RTC driver, 16-KiB messages, no file reads, range frames or application ACKs).
Stop after repeated verified local cohorts, cancellation/resource evidence,
a reproducible harness and a documented next decision. This measures the
current stack/driver/browser ceiling, not a universal WebRTC maximum.

No production optimization, dependency change, larger product credit, wire
revision, deployment, playback, browser support expansion, public network,
physical-device run or supported capability claim belongs to this slice.

## Source Dossier

- Read Tactical 307 and the direct-remote-file-streaming,
  performance-and-live-evidence and oracle-driven-engine-campaign topics.
- RFC 8831 sections 6.6/6.7 and the W3C WebRTC DataChannel send/buffering
  contract: retain reliable ordered delivery, 16-KiB messages, explicit
  sender backpressure and teardown. Raw transport completion is browser byte
  receipt, not a committed file save.
- Pinned libtorrent `7d7fc38fac61177fa5e02148f791b2f65250b09d`,
  `src/peer_connection.cpp::fill_send_buffer`, including queued plus reading
  bytes, and `test/test_alert_types.cpp::performance_warning`, including
  send-buffer-watermark diagnostics. Adopt independent producer limits; its
  TCP/BitTorrent uploader does not benchmark SCTP or browser saving.
- Retained `rtc` 0.20.4, `src/data_channel/mod.rs::send/outstanding_bytes`
  and `tests/sctp_receive_buffer_deadlock.rs`: outstanding bytes include the
  app/core/SCTP pipeline; fragment reassembly and receive-buffer stalls matter.
  Do not enlarge messages or interpret a local success as loss resilience.
- JSTorrent `211fd65bd056a4287e61c27162533407d9131d49`,
  `packages/engine/src/streaming/torrent-source-session.ts`: bounded ranges,
  abort propagation and disposal inform lifecycle; no direct RTC ceiling test
  is supplied by that adapter. No external source or fixture is imported.
- Current `VerifiedFileReader::read_range` performs a blocking observation
  job followed by another blocking metadata/read job for every 16-KiB chunk.
  This is a candidate bottleneck, not an established causal diagnosis.

## Ownership And Bounds

Experiment-only source selection lives behind the existing `experiment`
feature. Ordinary factories retain verified media reads and the exact product
limits. Generated ranges retain capability/range validation, all request
ownership, write-before-ACK, timeout and cancellation. They substitute only
independently generated fixture bytes for storage waiting/reading.

Raw producer state belongs to the existing driver: a bounded total length,
produced cursor and fixed-size generated messages, with no detached producer
or range task. Admit a message only when RTC outstanding bytes plus its size
fit the existing 512-KiB transport limit. Check cancellation while pumping;
continue polling network/timers. Raw receive messages are rejected. The local
runner owns the child/browser contexts and temporary profiles, reaps them on
success/failure/signal, and uses bundled Playwright Chromium.

Browser raw reception verifies each deterministic byte in order without
retaining the whole payload; report its checking time separately. Raw has no
write-credit bound on browser internal buffering and cannot replace product
flow control. Native counters/high-waters and zero terminal owners are required
in both modes; a partial raw transfer must cancel/join successfully.

Mobile hosting remains absent/feature-off. No generated application boundary
or Android storage behavior changes. This experiment is inapplicable to native
Android/iOS engine parity; no hardware evidence is claimed.

## Validation And Decision

Run release builds, focused feature-on/off Rust checks, syntax checks and
existing range-protocol tests. Measure at least three fresh contexts for the
256-MiB baseline, generated ranges (disk/checking drain), and raw transport;
exclude negotiation and post-save verification from transfer timing. Retain
byte integrity, selected direct pair, queue limits and terminal ownership.

If generated ranges substantially exceed baseline, profile/batch verified
reads next. If only raw exceeds generated ranges, investigate application
credit, event handling and writer batching. If raw is similarly limited,
profile the RTC driver/SCTP/crypto and compare another implementation in a
separate bounded study before redesigning the product. All results are
same-machine observations; LAN/RTT/loss/recovery qualification stays separate.

## Restart Checkpoint

Plan recorded. Next: add experiment-only generated/raw sources and run the
sequential release cohort; preserve unrelated Android and release work.
