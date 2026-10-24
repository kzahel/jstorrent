# Running and debugging the engine

Use this guide for torrent behavior without starting a product window. See
[testing](testing.md) for the validation layers and the
[scenario map](../../tests/interop/README.md) to select a controlled failure.
Commands run from the repository root.

## Where behavior lives

| Layer | Owner | What to investigate |
| --- | --- | --- |
| Protocol | [`rstorrent-protocol`](../../crates/rstorrent-protocol/src) | Parsing, identities, codecs, geometry and deterministic protocol state |
| Runtime | [`rstorrent-engine`](../../crates/rstorrent-engine/src) | Peers, discovery, scheduling, hashing, storage and task lifetimes |
| Application | [`rstorrent-session`](../../crates/rstorrent-session/src) | Commands, durable intent, resume, roots and application views |
| Platform | [`clients/`](../../clients), [`rstorrent-platform`](../../crates/rstorrent-platform/src) | Lifecycle, permissions, file access and OS integration |

Protocol and deterministic state depend inward; they do not own sockets,
filesystem handles or platform tasks. The
[engineering principles](../engineering-principles.md) own that contract.

## One foreground download

```bash
source ~/.profile
cargo build --locked --release -p rstorrent-session --bin rstorrent-download
target/release/rstorrent-download --help
target/release/rstorrent-download --output /path/to/downloads file.torrent
target/release/rstorrent-download --output /path/to/downloads \
  'magnet:?xt=urn:btih:...'
```

This is a finite downloader using the ordinary application service with
in-memory state. It exits after verified selected completion without seeding;
later invocations recheck existing content rather than loading a resume profile.
Files are written directly to their final paths, so incomplete files can be
visible. All non-padding files are selected unless a magnet supplies `so`.

The output directory defaults to the current directory. A cooperative lock
coordinates same-user `rstorrent-download` processes, not other torrent clients;
do not let another torrent client write the same content concurrently.

For persistent state, restart behavior or completed seeding, use the controlled
application scenarios or the [headless service](headless.md).

## Investigating a report

Start with the reported action, expected outcome, build, platform and smallest
reproduction. Distinguish discovery, peer transfer, verification, storage,
application state and presentation failures before selecting a harness.

- Use the product's Peers, Trackers, Files, Disk and Logs views to locate the
  stalled layer. [Support diagnostics](../user-support.md#reporting-a-problem)
  provide build/update facts; they are not an engine trace.
- Reproduce with a controlled fixture from the scenario map. Restart and
  corruption bugs need a durable application profile; a stateless successful
  download cannot establish resume correctness.
- Retain a regression at the owner of the invariant. Use a pure transition
  test when possible, then a runtime or platform scenario for the integration
  that failed. [Download correctness](../topics/download-correctness.md) owns
  integrity and recovery expectations.
- Keep temporary profiles, payloads and captures task-owned, remove them when
  finished, and record exactly which checks ran. Keep private source URLs,
  credentials, paths and peer identifiers out of public reports.

Public-swarm observations are opt-in and variable. Read the
[live-evidence policy](../topics/performance-and-live-evidence.md) before using
them to diagnose a failure or claim performance.

## Debugger and build timing

Ordinary dev/test profiles retain assertions and file/line backtraces but
omit full debugger information and incremental compilation. For source-level
debugging, use the separate profile:

```bash
cargo test --profile debugging -p rstorrent-engine
cargo run --profile debugging -p rstorrent-desktop
cargo clean --profile debugging
```

The last command removes only `target/debugging`. To separate Rust compilation
cost from test execution:

```bash
cargo test --locked --workspace --no-run --timings
cargo test --locked --workspace
```

Cargo timing reports live under `target/cargo-timings/`.

## Specifications and independent peers

The [reference map](../../reference/README.md) explains how to obtain pinned
BEP sources and libtorrent implementation/tests. [Reference policy](../references.md)
owns source use and provenance. Read the exact feature's topic and the
[engine campaign runbook](../topics/oracle-driven-engine-campaign.md) for
feature design; execution history is not part of this runtime guide.
