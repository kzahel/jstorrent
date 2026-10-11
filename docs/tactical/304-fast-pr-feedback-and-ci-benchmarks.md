# Tactical 304: Fast PR Feedback And CI Benchmarks

Status: **Complete (2026-10-11).** Merged lane, focused hosted measurements,
automatic exact-head reviews and trusted-main cache warming/restoration qualify.
The 3--5 minute target is met on the controlled focused repeat; queueing under
concurrent qualification and reviewer-tooling gaps remain explicit follow-ups.

Topics: `beta-release-readiness`, `agent-pr-review`

## Scope And Stopping Condition

Add a credential-free Fast CI workflow on the existing free hosted runners.
Lint affected portable Rust crates and their portable dependents; unit test
directly changed libraries, run format and applicable web/tool checks.
Successful fast PR checks may trigger the isolated reviewer without waiting for native packaging,
mobile builds or interoperability qualification. Full CI remains independently
visible. This first slice preserves full PR/main qualification alongside early
feedback. Post-merge-only scheduling remains a later policy decision.

Stop when change selection and success/staleness gates have negative tests,
workflow lint passes, representative commands are measured on an unchanged
source snapshot, and documentation distinguishes measured results from the
3--5 minute warm-run target. Hosted qualification requires an authorized push;
local timings do not establish hosted performance.

## Non-Goals And Invariants

- No paid/larger runners, new runner fleet, release, signing, or deployment.
- No branch-protection changes or claim that fast checks qualify a release.
- Preserve full workspace, feature-off/WebRTC, interop, lifecycle, desktop,
  Android and iOS checks. Platform evidence remains required where applicable.
- Controller and publisher remain trusted-main code; only successful Fast CI
  pull-request runs may automatically select an exact current eligible head.
- Failure/cancellation/skips must not turn into successful reviewer triggers.
- Unknown executable/configuration paths select conservative checks; deletions
  and renamed old paths count. Documentation-only PRs may skip product builds.
- Fast Rust compilation retains debug assertions, overflow checks, bounded
  backtraces and existing test deadlines. Profile candidates are benchmarked
  independently; none changes ordinary development or full qualification.
- Cache reuse is a measured optimization, not authority over test results.
  Avoid saving PR code into trusted-main reviewer caches.

## References And Baseline

Read Tacticals 159, 211 and 212, DEVELOPMENT.md, the owning topics, pinned
Swatinem rust-cache README/action policy, Cargo profile documentation and GitHub
workflow_run semantics. This changes build orchestration, not engine behavior;
no protocol/reference-source design change is involved.

Run 38128135142: Rust job 23m32s, test compilation 12m07s, workspace execution
2m25s, additional feature-graph checks 4m18s, diagnostic build 1m48s. A 1.5 GB
dependency cache restored; workspace artifacts are excluded by its default.
Run 38136308656: sample review inference/tools 1m55s, dispatch-to-completion
6m05s, reviewer build cache missed. Automatic reviewer/cache warming is off.

## Validation And Benchmark Plan

Use deterministic change-selection tests (transitive dependents, shared inputs,
docs, native-only changes, deletions and unknown paths), reviewer event tests
(failed/cancelled/wrong-workflow/stale), and actionlint for affected workflows.
Measure the same Rust package cohort with ordinary and candidate fast profiles:
target-cold compile, unchanged rerun, first-party rebuild, and test runtime.
Record machine, job parallelism, source SHA, profile, commands and cache state.
Retain only bounded JSON/Markdown evidence; remove temporary build trees/logs.
Choose the profile from build plus runtime evidence, not compilation alone.

## Execution Checkpoint

The separate Fast CI workflow and green-only automatic reviewer selection are
merged. Full CI job names, platform/release coverage and repository
protection remain unchanged. Fast lint follows portable transitive dependents;
unit execution is limited to directly changed libraries. Shared/unknown inputs
select all portable libraries. Contract regeneration is selected when gateway
dependencies are affected; web/extension/website jobs are separately selected.
Documentation-only runs still require workflow/reviewer safety checks.

The opt-level-0 candidate builds faster but fails the existing five-second
maximum-active hot-path test. Both opt-level-1 candidates pass all 866 core tests
but offer no meaningful compilation improvement. The selected lane therefore
retains ordinary optimized profiles and restores the existing full-CI dependency
cache, read-only. Bounded measurements and exact limitations are in
[the evidence record](../evidence/304-fast-ci-benchmarks-2026-10-11.md).

All-target lint found an existing test guard with an explicit `drop` that Clippy
still considers live across await. Replace it with an equivalent lexical scope;
no production engine behavior, assertion or deadline changes.

Current validation: 12 deterministic selection/aggregate/reviewer/proxy tests,
workflow lint and formatting pass; all 16 portable crates pass all-target Clippy
with warnings denied; web typecheck/unit/build pass. The temporary candidate
Cargo configuration also compiles protocol tests successfully. The default
profile's protocol/engine/session/gateway cohort passes 1,298 tests with 17
existing feature-dependent ignores; the contract command has no generated drift.
The initial qualification branch was rebased onto canonical-name qualification
`726664e6`; Tactical 305 owns provider identity acceptance. Qualification began
with automatic review disabled independently of the draft PR.

Draft [PR 26](https://github.com/kzahel/jstorrent/pull/26), initial head
`4ac53d407dba9d8d6d0457fb82b978efd64cd429`, passes all Fast CI jobs in 14m02s
on free Ubuntu runners. Shared CI inputs select all 16 portable libraries;
1,430 unit tests pass with 18 existing ignores. The dependency cache misses.
This is broad/cold qualification, not evidence for the 3--5 minute warm target.
The contract check costs 1m54s after unit tests, so move it to a required parallel
job that restores the ordinary full-CI contract cache read-only. Aggregate
negative tests now also reject failed/cancelled/skipped selected contract jobs.
The parallel layout at `80d581db356ec1e21555382b1d19d5dc2bfd6ed7` passes all
checks in [run 38143665744](https://github.com/kzahel/jstorrent/actions/runs/38143665744).
It takes 14m23s with another Rust dependency-cache miss; compilation is slower
than the first run, so there is no demonstrated total-duration improvement.
The contract job restores an exact cache match and completes in 2m17s alongside
Rust. Full CI continues independently. Next: after this lane lands on main,
measure a representative focused PR with a completed dependency cache before
claiming the 3--5 minute target or enabling automatic reviews.

PR 26 is merged at `6ad208d4` after exact-head Fast CI (12m39s) and full
qualification (56m05s) pass. Automatic review is enabled. The focused probe
PR 27 passes 603 engine tests and every selected fast check; its Rust job takes
4m01s with the ordinary 1.5 GB main cache restored. Total Fast CI takes 9m34s,
including 4m55s waiting for the Rust runner. The disposable probe's full matrix
is cancelled to isolate build latency, while main qualification continues.
This does not establish ordinary 3--5 minute end-to-end feedback.

The exact successful Fast CI event automatically starts review 38149228310;
real inference, offline Rust identity tests and commit-bound publication pass.
The cold reviewer workflow takes 6m03s. Trusted-main reviewer cache warming
passes: locked workspace tests compile in 23m05s and a 2.25 GB main-only cache
is saved. The second focused measurement passes in 4m00s, including 603 engine
tests. Rust takes 3m24s with a two-second runner wait. The probe's redundant
full/performance runs are cancelled early; this does not guarantee low queue
latency under ordinary concurrent PR/main qualification. A missing rustfmt component
is reported rather than treated as successful formatting; Fast CI supplies that
check. Keep runner scheduling and reviewer format/lint components as explicit
bounded follow-ups. Detailed timings and cache distinctions are in the evidence
record; the ordinary optimized profiles and full qualification coverage remain
unchanged.

Automatic repeat review 38150705796 restores the 2.25 GB trusted-main cache in
37s and publishes a COMMENT bound to `abc14750`. It reports all ten focused
identity tests passing offline. The workflow takes 7m21s versus 6m03s for the
cold review, so cache reuse is verified without claiming a speedup. The reviewer
also reports an absent shell profile/Rust login-shell PATH and recovers through
`/usr/local/cargo/env`. Next bounded work: schedule heavy qualification after
fast feedback to protect runner capacity, and supply reviewer formatting/lint
tools and a predictable shell environment. Neither follow-up changes engine
behavior, production architecture or the full qualification test inventory.
