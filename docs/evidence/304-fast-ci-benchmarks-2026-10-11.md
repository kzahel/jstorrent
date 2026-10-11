# Fast CI Measurements: 2026-10-11

Tactical [304](../tactical/304-fast-pr-feedback-and-ci-benchmarks.md).

## Hosted Baseline

[CI 38128135142](https://github.com/kzahel/rstorrent/actions/runs/38128135142)
completed successfully in 25m54s, with concurrent platform jobs. The Rust job
took 23m32s and restored a 1.5 GB dependency cache in 37 seconds.

| Rust step | Duration |
| --- | ---: |
| Workspace test compilation | 12m07s |
| Workspace test execution | 2m25s |
| Explicit WebRTC graph lint/tests | 3m30s |
| Feature-off graph lint and dependency exclusion | 48s |
| Gateway lifecycle diagnostic build | 1m48s |
| Locked libtorrent transfer | 48s |
| Application lifecycle/corruption repair | 15s |
| Workspace lint and formatting | 32s |

The feature checks exercise the default direct-file/WebRTC-enabled products,
their focused test suites, and deliberately disabled products whose dependency
trees must exclude the RTC implementation. Interop exchanges a deterministic
piece with independent libtorrent. The lifecycle diagnostic owns restart,
retained content, corruption repair and joined shutdown. These remain full CI.

## Local Profile Comparison

Source `1e451f8f940c414522d0c9a8a52356eaba776665`, Rust/Cargo 1.97.0,
macOS arm64, 14 logical CPUs, 48 GiB RAM, four Cargo build jobs. Cargo job count
does not impose a four-CPU limit on compiler internals. Registry downloads and
OS caches were already warm/uncontrolled; target trees began empty. Some
local activity overlapped the first opt-level-1 comparison, so these are bounded
observations, not isolated hardware performance claims. The final comparison
ran without another task-owned compilation or web test process.

Each pair used the same protocol/engine library cohort. The final pair includes
the equivalent lexical test-mutex scope needed by all-target Clippy; no runtime
engine code or test deadlines changed. Candidates were temporary profile entries
and were removed after measurement. The benchmark tool now defines candidates
through Cargo command configuration without editing the manifest.

| Candidate | Ordinary cold target | Candidate cold target | Ordinary first-party rebuild | Candidate first-party rebuild | Candidate tests |
| --- | ---: | ---: | ---: | ---: | --- |
| opt 0, 256 units | 114.179s | 43.191s | 64.625s | 16.160s | **Failed existing five-second hot-path bound** |
| opt 1, 256 units | 98.456s | 92.979s | 57.578s | 59.381s | 866 passed, 13 existing ignores; 10.567s |
| opt 1, 16 units | 98.264s | 95.078s | 59.728s | 61.683s | 866 passed, 13 existing ignores; 10.475s |

The final ordinary-profile execution passed the same 866 tests with 13 existing
ignores in 10.402s. Unchanged no-run repeats took 0.165--0.466s: this describes
the same local checkout, not a fresh Actions checkout or workspace-cache hit.
First-party rebuilds use `cargo clean -p rstorrent-protocol -p rstorrent-engine`
for the applicable profile while retaining dependencies. The cache action
normally excludes workspace crates, making this a useful compilation cohort.

Decision: retain the ordinary optimized profiles. The unoptimized candidate
violates an existing test bound; the passing candidates show no meaningful
first-party compilation improvement. Early feedback comes from selecting tests
for directly changed libraries, linting their dependents, and separating full
qualification and review triggers. Fast CI restores the existing ordinary-CI
dependency and contract caches with the same shared keys and does not save into them.

Bounded raw records:

- [Unoptimized candidate](304-profile-opt0-2026-10-11.json)
- [Light optimization, 256 units](304-profile-opt1-2026-10-11.json)
- [Light optimization, 16 units](304-profile-opt1-units16-2026-10-11.json)

## Qualification Boundary

The representative ordinary-profile protocol/engine/session/gateway command
passes 1,298 tests with 17 existing feature-dependent ignores. All 16 portable
crates pass warnings-denied all-target Clippy. The generated-contract command
produces no drift. Formatting, 12 selection/reviewer/proxy tests, actionlint,
and web typecheck/unit/build pass locally. The isolated CI checkout is based
on canonical-name qualification `726664e6`; Tactical 305 owns rename/provider
identity acceptance and preserves the automatic-review kill switch.

The 3--5 minute warm Fast CI target has not been established on GitHub.
Cold or shared-input changes conservatively select more checks and may exceed
it. Full platform qualification and existing release requirements are retained.
Automatic AI review/cache warming remain disabled during this qualification.

## Initial Hosted Fast Qualification

[Fast CI 38142457026](https://github.com/kzahel/jstorrent/actions/runs/38142457026)
passes on draft [PR 26](https://github.com/kzahel/jstorrent/pull/26), head
`4ac53d407dba9d8d6d0457fb82b978efd64cd429`. Standard free `ubuntu-24.04`
runners, Rust 1.97.0, Node 24.18.0, ordinary optimized profiles. Shared workflow
and tool changes conservatively select all 16 portable library test packages.

Dispatch to completion: **14m02s** (13:15:30--13:29:32 UTC). The Rust job takes
12m50s; scheduling between selection completion and its start costs 34s.
All 1,430 selected unit tests pass with 18 existing feature-dependent ignores;
generated contract has no drift. Web/extension, website, formatting and tool
safety checks all pass; the aggregate requires every selected job.

| Rust step | Duration |
| --- | ---: |
| Dependency cache lookup (miss) | 2s |
| All-target lint | 1m45s |
| Portable unit-test compilation | 7m49s |
| Portable unit-test execution | 55s |
| Generated contract build/check | 1m54s |

The log reports `No cache found` despite an ordinary main cache with the same
key, `v0-rust-ci-rust-ubuntu-24.04-Linux-x64-9f881967-d901f814`. The renamed
checkout is `/home/runner/work/jstorrent/jstorrent`, whereas the earlier cache
used the former repository path. Cache versions include cache paths; the rename
is therefore a likely invalidation cause, not a measured compiler regression.
See the [cache version implementation](https://github.com/actions/toolkit/blob/main/packages/cache/src/internal/cacheUtils.ts)
and [cache scoping documentation](https://github.com/actions/cache/blob/v4/README.md#cache-scopes).
This run establishes neither cache reuse nor focused-change warm latency.

The measured contract step is on the critical path despite being independent
of unit execution. The next layout makes it a required parallel job, restoring
the existing `ci-web-contract-ubuntu-24.04` cache read-only. It retains the same
contract command and drift assertion. Full
[CI 38142457145](https://github.com/kzahel/jstorrent/actions/runs/38142457145)
continues independently; its completion is not inferred from this fast result.
