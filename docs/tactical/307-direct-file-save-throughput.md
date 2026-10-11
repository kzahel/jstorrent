# Measure And Bound Direct File Save Throughput

Status: Complete locally; deployment and Tactical 196 qualification separate.

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

- [RFC 8831](https://www.rfc-editor.org/rfc/rfc8831.html) sections 6.5/6.6:
  reliable ordered SCTP messages and fragmentation;
  preserve the existing 16-KiB payload framing rather than enlarging messages.
- [RFC 8260](https://www.rfc-editor.org/rfc/rfc8260.html): message interleaving
  is a transport facility, not application
  write credit. Do not infer bounded browser memory from SCTP flow control.
- [WebRTC specification](https://w3c.github.io/webrtc-pc/#dom-rtcdatachannel-bufferedamount)
  `RTCDataChannel.bufferedAmount` and [File System specification](https://fs.spec.whatwg.org/#api-filesystemwritablefilestream)
  `FileSystemWritableFileStream`: separately bound application
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

Complete: four chunks/64 KiB selected and implemented, with deterministic
credit validation, bounded ACK/receive queues, repeated sequential measurements,
actual timeout, compatibility and authenticated product evidence. Next work
requires a separate measured slice; Tactical 196 retains external-picker and
independent-network qualification gaps.

## Baseline Evidence

2026-10-11, Apple M4 Pro/macOS ARM64, bundled Chromium 151.0.7922.34,
release Rust, three fresh browser contexts per cell. The endpoint was unchanged
at the one-chunk baseline. The harness transforms the actual production save
module with the existing Vite toolchain, substitutes only local signaling and
destination selection, and disables STUN on both ends. The OPFS writer really
executes `FileSystemWritableFileStream.write`/`close`; drain checks every byte
against the independent deterministic fixture without retaining payload.

| Fixture | Sink | Transfer seconds, three runs | Median MiB/s |
| --- | --- | --- | --- |
| 64 MiB | OPFS writable | 1.766, 1.745, 1.744 | 36.68 |
| 64 MiB | Checking drain | 1.384, 1.378, 1.392 | 46.25 |
| 256 MiB | OPFS writable | 6.911, 6.890, 6.848 | 37.16 |
| 256 MiB | Checking drain | 5.416, 5.412, 5.371 | 47.30 |

OPFS writer calls consume approximately 37% of transfer time; the drain calls
consume 3–4%. Connection setup is measured separately (roughly 0.33 seconds).
Every saved file has the expected SHA-256, every drain byte matches, payload
high-water is 16,384 bytes, host application queue high-water is 16,398 bytes,
and terminal tasks/sockets/requests/application and transport queues are zero.
The existing native transport high-water is sampled before sends and is not
an exact allocation peak. Native selected-pair reporting returns null here;
the browser stats assertion added to the delayed cohort verifies host/host UDP
with no relay. These are same-machine measurements, not WAN or picker evidence.

Commands:

```bash
source ~/.profile
cargo build --release -p rstorrent-direct-file --features experiment \
  --bin rstorrent-direct-file-experiment
node scripts/benchmark-direct-file.mjs --output /tmp/direct-baseline.json
node scripts/benchmark-direct-file.mjs --sizes 8 --repeats 3 \
  --ack-delay-ms 20 --sinks opfs --output /tmp/direct-baseline-delay.json
```

The verifier now selects bundled Chromium directly, removing its previous
installed-Chrome-first fallback in accordance with repository test policy.
`node --check scripts/benchmark-direct-file.mjs` and `git diff --check` pass.
The baseline run exercises the production consumer and existing verified media
reader; no production algorithm changed in this slice.

## Window Experiments And Selected Behavior

The final cohort runs windows sequentially, three fresh browser contexts per
cell, using the same release endpoint and production consumer. An initial
exploratory pair overlapped briefly; those timings are discarded. Connection,
post-save verification and signaling cleanup are excluded from transfer time.

| Window | 64-MiB disk MiB/s | 256-MiB disk MiB/s | 256-MiB drain MiB/s | 8-MiB disk, delayed ACK MiB/s |
| --- | --- | --- | --- | --- |
| 16 KiB / one chunk | 36.58 | 36.82 | 46.73 | 0.54 |
| 32 KiB / two chunks | 51.02 | 50.45 | 57.79 | 1.09 |
| 64 KiB / four chunks | 53.50 | 51.70 | 58.80 | 2.10 |

All values are medians. The three 256-MiB disk transfer times are
6.952/6.944/6.952 seconds at 16 KiB, 5.045/5.074/5.093 at 32 KiB, and
4.896/5.006/4.952 at 64 KiB. The 8-MiB delayed-ACK times are
14.868/14.684/15.786, 8.059/7.212/7.336 and 3.747/3.809/3.857 seconds,
respectively. The delay is a 20-ms application timer after writer completion,
including browser scheduling; it is not a claim about a particular WAN RTT.

Select 64 KiB: the local 256-MiB disk path improves 40%, and delayed-credit
throughput improves about 3.97x. The gain over 32 KiB locally is modest, but
the delayed-credit cohort nearly doubles again for 32 KiB more outstanding
payload. No chunk enlargement, parallel sink writes, wire change, new
dependency, protocol advertisement or user setting is necessary.

The host window holds at most four produced boundaries and accepts only
forward ACKs at those boundaries, including cumulative credit. Four range
owners still admit at most 256 KiB of outstanding payload. Reading/current
encoding copies and RTC's internal buffers are distinct from that credit;
existing endpoint queue ceilings retain their own checks. ACK mailbox capacity
is five; overflow cancels the range and reports Malformed instead of silently
discarding an ACK. A cancelled owner no longer queues repeated flood errors.
The browser bounds both pending encoded bytes (128 KiB) and frames (16), rejects
oversized data before conversion and drops queued work after terminal failure.
One current payload copy and optional Blob conversion add bounded chunk
allocations. These limits do not claim a bound on total browser/host RSS.

All 45 final matrix transfers check byte count, OPFS SHA-256 or every drain
byte, host/host UDP selection and terminal zero owners/queues. At 64 KiB,
observed browser pending payload peaks at 65,536 bytes, application queued
frames at 49,194 bytes, and transport outstanding bytes at 65,618 bytes.
Transport accounting now samples immediately after sends as well as before.
The four-concurrent-range protocol cohort reaches application/transport peaks
of 114,786/259,968 bytes, both below their 512-KiB limits, and zero after close.
It verifies exact independent range hashes, short final chunks, oversized
control rejection, out-of-range rejection, cancellation, future/duplicate/flood
ACK rejection and a consumer stalled at exactly 65,536 bytes with no subsequent
production during the second observation interval.

Reproduce each comparison with:

```bash
node scripts/benchmark-direct-file.mjs --window-kib 16 --output /tmp/window16.json
node scripts/benchmark-direct-file.mjs --window-kib 32 --output /tmp/window32.json
node scripts/benchmark-direct-file.mjs --window-kib 64 --output /tmp/window64.json
# Repeat each window with the delayed-credit cohort:
node scripts/benchmark-direct-file.mjs --window-kib 64 --sizes 8 --sinks opfs \
  --ack-delay-ms 20 --repeats 3 --output /tmp/window64-delay.json
node scripts/benchmark-direct-file.mjs --window-kib 64 --sizes 8 --repeats 1 \
  --protocol-checks
```

The experiment and runner now default to the selected 64 KiB; `--window-kib
16` reproduces the one-chunk baseline. Initial baseline commands above record
the then-unmodified binary's default, not today's experiment default.

Further work is deliberately a new measured slice: instrument native read and
driver costs, then evaluate bounded writer coalescing or larger credit only
with compatibility and global queue-admission evidence. Larger four-range
windows cannot simply consume the whole existing application queue plus
headers. User-configurable limits, external save-picker qualification,
independent-network qualification, Firefox/Safari large saves and playback
remain deferred; this local improvement does not graduate Tactical 196.

## Final Validation

- `cargo fmt --all -- --check`: passes.
- `cargo clippy --workspace -- -D warnings`: passes.
- `cargo clippy -p rstorrent-direct-file --features experiment -- -D warnings`:
  passes, including the experiment-only window selector.
- `cargo test --workspace`: 1,581 pass, 18 existing ignores.
- `cargo test -p rstorrent-direct-file --features experiment`: 13 pass, one
  existing public-STUN ignore. The four new deterministic cases cover bounded
  credit, invalid/no-progress ACKs, cumulative credit/short tails near u64::MAX,
  empty ranges and the one-chunk compatibility mode.
- `cargo check -p rstorrent-headless --no-default-features`: passes.
- `cargo build --release -p rstorrent-direct-file --features experiment
  --bin rstorrent-direct-file-experiment`: passes against final source.
- `npm run typecheck --prefix clients/web`: passes.
- `npm run test --prefix clients/web`: 499 pass, two existing skips. Nine Save
  cases cover the existing path/fallback, destination abort before peer start,
  four queued chunks plus a short tail, write-before-ACK ordering, cancellation
  during a pending write, writer failure, and byte/frame/oversized queue limits.
- `node --check` for both benchmark and product-verifier scripts, and
  `git diff --check`: pass.
- Final benchmark smoke (`--sizes 1 --repeats 1`) passes both sinks. The runner
  now owns a temporary parent for native profiles and removes it even after
  forced termination. A scripted SIGINT during fixture startup exits promptly,
  reaps the child/browser and leaves no new benchmark directory.
- Final `--protocol-checks --inactivity-checks --sizes 8 --repeats 1`: native
  concurrent and adversarial checks pass; withheld credit stops at 65,536
  bytes and returns Inactive after the actual 60-second deadline. Application
  and transport high-waters are 98,388/262,368 bytes, then zero terminal
  owners/queues. This cohort is correctness evidence, not a timed benchmark.
- `--consumer-ref 1202b2f1 --window-kib 64 --sizes 8 --repeats 1`: the previous
  production consumer passes disk SHA-256 and checking-drain integrity against
  the final host. The final 16-KiB matrix also exercises the new consumer with
  old one-chunk host behavior; v1 frames and per-write ACK semantics remain.
- `node scripts/verify-remote-product.mjs`: passes using bundled Chromium,
  actual headless hosting, TLS/WSS and authenticated RDF signaling. Its exact
  1-MiB Blob save, completed audit/zero direct owners, login/resume/browser and
  relay restart, rollback-layout, revocation, changed-host and 256 hostile
  circuit cases pass; relay retains zero payload and no service worker exists.
  Two initial attempts stopped before Save because the runner retained stale
  Workbench/Torrent-library labels. Updating both selectors to the current
  Torrents labels fixes the harness; the final full run passes.
- `VITE_RSTORRENT_REMOTE_RELAY_URL=wss://relay.rstorrent.com/client
  VITE_RSTORRENT_REMOTE_BUILD_ID=local-direct-file-307 npm run build:remote
  --prefix clients/web`: passes, including 15 CSP-safe JavaScript bundles.
  This restores ordinary relay configuration in local ignored build output
  after the verifier's ephemeral localhost build. An initial standalone build
  without the required environment was rejected by the existing Vite guard.

The library/window slice changes no generated application types or native
Android/iOS host semantics. Workspace validation includes their existing
host-native crates; no physical-device or new mobile-host qualification ran.
All benchmark browser contexts/native fixture processes and verifier-owned
profiles/downloads/services are closed and removed. Raw temporary logs/reports
are removed after recording these reproducible aggregate results.
