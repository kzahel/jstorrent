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

The compilation timing artifact also shows why warming dependencies alone
cannot make this broad run meet the target. Its longest compiler units are
first-party test binaries: engine 295.91s, session 266.64s and gateway 217.84s.
These elapsed unit durations overlap under compiler contention and must not be
summed. The engine's non-test library takes 100.41s. This broad graph is not a
measurement of an engine-only change.

Selection against the actual workspace metadata chooses seven lint packages
for an engine-only source change: direct-file, engine, gateway, headless, media,
remote-host and session. Only the engine library's 603 tests execute, alongside
web checks and the required parallel contract job. A web-only source change
selects no Rust checks, and a docs-only Markdown change selects only tool safety
checks. Hosted focused-change latency still needs measurement after the lane
is available on main and a representative dependency cache has completed.

The measured contract step is on the critical path despite being independent
of unit execution. The next layout makes it a required parallel job, restoring
the existing `ci-web-contract-ubuntu-24.04` cache read-only. It retains the same
contract command and drift assertion. Full
[CI 38142457145](https://github.com/kzahel/jstorrent/actions/runs/38142457145)
continues independently; its completion is not inferred from this fast result.

## Parallel Contract Qualification

[Fast CI 38143665744](https://github.com/kzahel/jstorrent/actions/runs/38143665744)
passes the parallel layout at `80d581db356ec1e21555382b1d19d5dc2bfd6ed7`.
Dispatch to completion is **14m23s** (13:33:41--13:48:04 UTC); all 1,430
portable tests and all selected surfaces pass. Rust still misses the ordinary
dependency cache. Lint takes 2m10s and test compilation 10m06s, versus 1m45s
and 7m49s initially. Consequently this pair does not demonstrate a total-time
improvement or isolate runner variation from other uncontrolled differences.

The required contract job restores the ordinary contract cache with an exact
match in 9s and completes in 2m17s, including 1m46s of exporter compilation.
It completes alongside Rust rather than extending the post-test critical path.
The aggregate succeeds only after both jobs and every other selected surface
pass. The follow-up [full CI](https://github.com/kzahel/jstorrent/actions/runs/38143665947)
is independent and was still running at this measurement. The 3--5 minute
focused warm-run target remains unqualified; automatic reviews remain off.

## Merged Lane And First Focused Probe

[PR 26](https://github.com/kzahel/jstorrent/pull/26) merged at
`6ad208d4b2ee471ae6a300840232c85c9650daae` after every qualification job
passed. At its exact head `e347cce291fd822e7079bc311fb709930e48e5c5`,
[Fast CI 38144727853](https://github.com/kzahel/jstorrent/actions/runs/38144727853)
took 12m39s and
[full CI 38144728289](https://github.com/kzahel/jstorrent/actions/runs/38144728289)
took 56m05s. Fast feedback finished 43m26s earlier on this broad workflow PR.
The full run includes a cold Windows release/package build; this is not a
controlled comparison against the older 25m54s baseline.

The first focused [probe PR 27](https://github.com/kzahel/jstorrent/pull/27)
changes only four fixture lines in the existing canonical TorrentId test.
Production code and test assertions remain equivalent. Head
`3a7d2b4bdb6f48754b747cf596144ad1e9bddbec` passes
[Fast CI 38148581335](https://github.com/kzahel/jstorrent/actions/runs/38148581335)
in **9m34s** (14:47:01--14:56:35 UTC). Selection is seven portable lint
packages, the engine library's 603 tests, generated contract, web and tool checks;
extension and website checks are correctly unselected.

The Rust job takes **4m01s**, restoring the ordinary 1,563,978,108-byte main
cache in 21s. Lint takes 55s, test compilation 2m09s, and execution 15s:
603 pass, zero fail, nine existing feature-dependent ignores. The contract
restores its 379,541,410-byte cache and compiles the exporter in 1m09s without
generated drift. Web and workflow/reviewer safety checks also pass.

Rust waits **4m55s** between child-job scheduling and runner start
(14:47:29--14:52:24 UTC), while main and probe full qualification are running.
The disposable probe's redundant full matrix is cancelled at 14:52:09 UTC;
its build jobs start shortly afterward. Main qualification continues. Therefore
this is an intervened benchmark, not proof of ordinary 3--5 minute end-to-end
feedback. Queue contention is a concrete follow-up; build performance must be
reported separately from scheduling latency.

Automatic reviews are enabled after merge. The exact successful Fast CI event
starts [review 38149228310](https://github.com/kzahel/jstorrent/actions/runs/38149228310)
two seconds later. The cold reviewer run completes in **6m03s**, with 3m48s
inside the model/tool step. OIDC enrollment, the gateway 401 boundary, isolation,
inference and publication pass. Its
[COMMENT review](https://github.com/kzahel/jstorrent/pull/27#pullrequestreview-5483770047)
is bound to the probe head, reports no introduced bugs, and builds/runs all ten
focused Rust identity tests offline. It also checks the diff and unchanged
production source. The image lacks rustfmt; the reviewer reports that limitation
instead of claiming formatting ran. Fast CI already verifies formatting.

This first review misses its separate container build cache; the ordinary
Fast CI cache hit does not establish reviewer-cache reuse.

## Trusted-Main Reviewer Cache Qualification

The push-event retry of
[run 38148525890](https://github.com/kzahel/jstorrent/actions/runs/38148525890)
passes the `warm-cache` job on trusted main `6ad208d4`. Its first cache lookup
misses. The isolated container fetches locked Rust dependencies, installs locked
web dependencies and runs `cargo test --locked --workspace --no-run` successfully
in **23m05s**. This compiles tests; it does not execute the workspace suite.
The cache save takes 46s and publishes a 2,245,621,249-byte main-only cache at
15:11:57 UTC. The key includes the pinned image/lockfile digest and main SHA;
PR reviewers restore but never save. No tailnet enrollment or model credentials
are introduced during warming.

## Focused Repeat And Warm Reviewer

The repeat head `abc14750b8cd8aaec5c3366e33ceda49097303cb` changes the same
fixture consistently to `0xef`. Production code and assertion coverage remain
unchanged.
[Fast CI 38150423038](https://github.com/kzahel/jstorrent/actions/runs/38150423038)
passes in **4m00s** (15:14:08--15:18:08 UTC), including all 603 engine tests,
zero failures and nine existing ignores. Rust starts two seconds after its
job is created and takes 3m24s. Its 1.5 GB cache restores in 34s, lint takes
38s, compilation 1m35s and execution 14s. Contract, web, formatting and tool
checks pass. This meets the target on this focused warm-dependency repeat.

The disposable probe's redundant full and performance workflows are cancelled
early; main qualification continues. Fast build jobs already have runners
before those cancellations complete. This is a controlled repeat with available
capacity, not a guarantee that ordinary concurrent PR/main matrices will avoid
the queueing measured in the first run. Profiles, runner sizes, test deadlines,
assertion coverage and qualification coverage remain unchanged.

The successful Fast CI event starts
[review 38150705796](https://github.com/kzahel/jstorrent/actions/runs/38150705796)
one second later. Its log confirms an exact-key hit and successful restoration
of the 2,245,621,249-byte trusted-main reviewer cache in **37s**. The workflow
passes in **7m21s**, including 4m04s in the model/tool step. Its
[COMMENT review](https://github.com/kzahel/jstorrent/pull/27#pullrequestreview-5483837979)
is bound to the exact repeat head, reports no introduced bugs, and reports
that all ten focused identity tests pass offline. It also reports recovering
from the absent shell profile/Rust login-shell PATH by sourcing
`/usr/local/cargo/env`; rustfmt remains absent. Fast CI independently checks
formatting. These are concrete reviewer-tooling follow-ups.

Cache reuse is established, but this pair does **not** demonstrate reduced
review duration: the cold review takes 6m03s and the warm review takes 7m21s.
Image build, cache transfer and model/tool behavior vary, and the fixture heads
differ. The bounded slice is qualified: fast feedback, green-only exact-head
automatic review, real inference/publication and trusted-main cache warming/
restoration work on free runners. Scheduling full qualification after fast
feedback and installing/bootstrapping reviewer tools remain follow-ups.
