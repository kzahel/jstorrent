# Measure The Direct File Transport Ceiling

Status: Complete local measurement; product algorithm and limits unchanged.

Topic: `direct-remote-file-streaming`

## Scope And Stopping Condition

Before further tuning Tactical 307's 51.70-MiB/s local save path, establish
where throughput is lost. Compare the existing release endpoint/production
consumer with generated-byte range responses (same framing, 64-KiB credit and
sink) and a generated-byte raw reliable ordered DataChannel producer (same
RTC driver, 16-KiB messages, no file reads, range frames or application ACKs).
Add a browser-to-browser raw control with the same message/queue bounds to
distinguish the retained Rust driver/stack from Chromium transport capacity.
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
independently generated fixture bytes for storage reading; the existing
range-availability check remains.

Raw producer state belongs to the existing driver: a bounded total length,
produced cursor and fixed-size generated messages, with no detached producer
or range task. Admit a message only when RTC outstanding bytes plus its size
fit a selected experiment cap within the existing 512-KiB transport limit.
Sweep smaller raw caps if maximum buffering produces variable/slower results.
Check cancellation while pumping;
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

Completed: generated/raw sources, browser control, alternating full-size
cohorts, smaller raw-buffer sweep, partial cancellation and protocol checks.
Next: a separate RTT/loss/transport-diagnostic slice. Do not optimize verified
reads from source suspicion alone or raise product credit from these local
results. Production remains at four 16-KiB chunks and write-before-ACK.


## Recorded Local Evidence

2026-10-11, Apple M4 Pro/macOS ARM64, release host and bundled Chromium
151.0.7922.34. Each sample uses a fresh context and a 256-MiB independently
generated verified fixture. Three rounds alternate verified, generated, raw
and browser control; two additional three-sample raw-buffer cells follow.
Negotiation and post-save hashing are excluded. Raw timing is first-message
receipt through final checked byte; save timing includes writer close.

| Path | Sink / admitted sender buffer | Seconds, three runs | Median MiB/s |
| --- | --- | --- | --- |
| Production verified reads | Disk-backed OPFS / 64-KiB write credit | 4.945, 5.126, 4.931 | 51.77 |
| Generated ranges | Disk-backed OPFS / 64-KiB write credit | 5.008, 5.033, 4.724 | 51.11 |
| Production verified reads | Checking drain / 64-KiB write credit | 4.628, 4.634, 4.605 | 55.31 |
| Generated ranges | Checking drain / 64-KiB write credit | 4.737, 4.375, 4.199 | 58.52 |
| Raw Rust RTC | Checking receive / 64-KiB outstanding | 3.737, 3.646, 3.788 | 68.50 |
| Raw Rust RTC | Checking receive / 256-KiB outstanding | 11.027, 10.284, 15.569 | 23.21 |
| Raw Rust RTC | Checking receive / 512-KiB outstanding | 4.711, 6.931, 6.021 | 42.52 |
| Chromium to Chromium control | Checking receive / 512-KiB bufferedAmount | 9.660, 9.289, 8.786 | 27.56 |

All completed files match the independently expected SHA-256. Every checking
receiver validates all bytes and length without retaining the payload. All
selected paths are host/host UDP. Native application/transport queues are
within their limits and terminal owners, sockets, requests and queues are zero.
Raw mode creates no range tasks or application payload queue. Observed raw
transport peaks exactly match 64/256/512 KiB respectively; range application
and transport peaks stay below 65,618 bytes. The browser control's unsent
`bufferedAmount` reaches 524,288 bytes; it is not the same measure as Rust's
outstanding counter, which includes unacknowledged SCTP data. Both browser
peers are closed and the native fixture endpoint stays idle in that control.
Raw byte checking totals roughly 0.16–0.19 seconds per 256-MiB transfer, far
shorter than elapsed time. It overlaps transport and is not exclusive CPU
profiling. Raw full-transfer receipt-to-joined-close is 3–7 ms in these cells.

An earlier sequential 15-transfer cohort overlapped unrelated emulator/host
CPU work. Its verified disk median is 38.29 MiB/s and raw samples span
35.95–67.48 MiB/s; exclude it from the comparison above. The alternating
cohort starts after the emulator exits, but normal workstation/browser work
continues. Larger-buffer variability persists: the maximum buffer cannot be
assumed to be the fastest configuration. No packet-loss/retransmission/CPU
profile was captured, so burst loss, congestion behavior and driver scheduling
remain hypotheses. The slower browser control does not prove a universal
Chromium ceiling or a Rust-versus-libwebrtc dependency ranking.

## Interpretation And Next Decision

The storage-read hypothesis does not explain the principal local ceiling:
substituting generated bytes changes disk-save median by -1.3%, within observed
variation, and checking-drain median by +5.8%. Do not pursue a verified-reader
rewrite for a promised major speedup from this evidence. The best tested raw
cell is about 32% faster than normal saves, so removing all file-save machinery
has not revealed an order-of-magnitude faster path in the retained stack.
68.50 MiB/s is a stable measured operating point under these constraints, not
proof of an absolute WebRTC maximum. Further local gains require transport and
application scheduling/writer diagnosis; switching libraries is not selected.

Reliability and useful remote throughput require a different next measurement:
controlled RTT/loss, retransmission/stall diagnostics, bounded receiver credit,
abort/reconnect behavior, simultaneous control responsiveness and independent
LAN evidence. The fixed 64-KiB application credit has a simple ideal bound of
credit/RTT: at 100 ms, roughly 0.625 MiB/s before processing overhead. This is
an analytical bound, not a tested WAN rate. Tactical 307's delayed-ACK result
already shows the latency sensitivity. A later slice should decide an explicit
throughput/RTT target and memory budget before changing credit, ACK batching,
read/write batching or transport. Avoid more local percentage tuning without
a gap to a measured target.

Reproduction (run sources sequentially, with no overlapping performance jobs):

```bash
source ~/.profile
cargo build --release -p rstorrent-direct-file --features experiment \
  --bin rstorrent-direct-file-experiment
# Repeat this source order for three alternating rounds:
for source_kind in verified generated raw browser; do
  node scripts/benchmark-direct-file.mjs --source "$source_kind" \
    --sizes 256 --repeats 1
done
node scripts/benchmark-direct-file.mjs --source raw --raw-buffer-kib 64 \
  --sizes 256 --repeats 3
node scripts/benchmark-direct-file.mjs --source raw --raw-buffer-kib 256 \
  --sizes 256 --repeats 3
node scripts/benchmark-direct-file.mjs --source raw --sizes 64 \
  --cancel-after-mib 1 --repeats 1
node scripts/benchmark-direct-file.mjs --source generated --sizes 8 \
  --protocol-checks --repeats 1
```

The 1-MiB partial raw cancellation closes after 17.7 ms from the last checked
byte, with 1.5 MiB sent, a 512-KiB transport high-water and zero terminal
owners/queues. Generated-mode protocol checks independently verify four exact
ranges, short tails, cancellation, oversized controls, invalid ranges,
future/duplicate/flood ACK rejection and stalled production at 65,536 bytes;
application/transport high-waters are 114,812/262,472 bytes and zero after close.
The full 8-MiB disk and drain saves also pass. No actual inactivity deadline,
external picker, authenticated product verifier, physical device or WAN was
rerun for this experiment-only slice; 307's production qualification remains.

## Validation

- `cargo fmt --all -- --check`: passes.
- `cargo clippy -p rstorrent-direct-file --features experiment -- -D warnings`
  and the same command with `--features webrtc`: pass.
- `cargo check -p rstorrent-direct-file --no-default-features`: passes with
  the existing unused `encoded_chunk_payload_bytes` helper warning.
- `cargo test -p rstorrent-direct-file --features experiment`: 13 pass,
  one existing public-STUN ignore.
- `cargo clippy --workspace -- -D warnings`: passes.
- `cargo test --workspace`: final rerun passes with 1,583 tests
  and 18 existing ignores. Initial run
  stops at an unrelated engine metadata-cancellation test's peer-close timeout.
  `cargo test -p rstorrent-engine --lib
  driver::tests::discovery_metadata::metadata_default_cohort_is_paced_to_thirty_and_cancels_exactly
  -- --exact` passes in isolation, then the full workspace rerun passes.
- Release experiment build and `node --check` for the runner/raw receiver:
  pass. Benchmark integrity, queue/cancellation/terminal checks above pass.
- `git diff --check` and relative documentation links: pass.

No shared web source, generated application boundary or native mobile behavior
changes in this slice. Web consumer behavior is exercised by the real-module
benchmark; web typecheck/unit suites are not rerun for unchanged web code.
Temporary reports/logs/profiles and all owned browser/fixture processes are
removed after recording these results.
