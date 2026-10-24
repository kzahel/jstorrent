# Tactical 256: Swarm Touch CI Stabilization

Status: **Complete, 2026-10-05.**

Topic: `web-ui-design`. Release owner: `beta-release-readiness`.

## Objective And Scope

The maintainer requests fixing current CI before Play-delivered upgrade
qualification and fresh signed candidates. Repair the failing swarm layout
journey without weakening its touch-input, overflow, column visibility or
accessibility assertions. Stop after local validation and exact-source hosted
CI pass. Commit and push this bounded fix for that qualification.
An additional source-test race exposed by the fresh release workflow belongs
to this CI owner; retain its external-intake success and queue assertions.

Engine, table behavior, release publication, production feeds and stores are
outside this repair. The subsequent installed and signed-candidate campaign
has its own tactical.

## Diagnosis And Ownership

CI run 37185108049 fails only the swarm layout E2E: after a 390-pixel touch
swipe and transition to 456 pixels, the left overflow remains true after an
explicit reset. All nine other executed jobs and Website pass. Five ordinary
local repeats pass. Eightfold CPU throttling reproduces the exact assertion
failure in one of three repeats; scroll instrumentation records a five-pixel
offset after the reset. The CI trace transitions to the second viewport about
60 ms after releasing the touch. The manually injected fast gesture can leave
compositor scrolling in flight across subsequent position changes.

Hosted runs 37227315607 and 37230272258 reject the experimental synthesized
route because Linux produces no scrolling, even with explicit touch capability.
A claimed Ubuntu 24.04 ARM64 testbed reproduces it. An isolated native-overflow
probe records trusted touch-start/end but no touch-move in both default and
has-touch contexts. The original native event train does scroll on Linux.

Retain that native train, with explicit [CDP event timestamps](https://chromedevtools.github.io/devtools-protocol/tot/Input/#method-dispatchTouchEvent)
modeling a 300-ms drag followed by a stationary hold. End at current time with
zero release velocity, then observe the table's native `scrollend` before the
next position/viewport change. The completion observer accepts only a released,
actually scrolled gesture. Its listener and remote handle, plus the CDP session,
have nested finally cleanup. Every original signed-distance, geometry, real
scrolling and UI-effect assertion remains. No product behavior, application
boundary, generated code or Android semantics change.

## Ordered Work And Validation

1. Retain the failed trace privately and reproduce with bounded CPU pressure.
2. Make the touch helper finish its gesture before end-position and resize
   checks; preserve all existing assertions and session cleanup.
3. Repeat the pressured regression, then run web typecheck, unit/build gates
   and the complete deterministic browser suite with bundled Chromium.
4. Commit with verified maintainer identity, push, and inspect exact-source CI.
   Repair only new failures needed to close this bounded gate.

## Evidence And Result

The final native-event repair passes three ordinary Linux repetitions, three
twofold-CPU Linux repetitions, six eightfold-CPU macOS repetitions, web typecheck
and the full deterministic browser suite: 46 passed, 14 opt-in live cases
skipped. Final nested cleanup also passes a further Linux repetition. Unchanged
web product gates pass 470 unit tests (two skipped) and production build/CSP.
See the [input receipt](../evidence/swarm-ci-input-256.json). Exact-source
46c19b3a hosted browser job 111523937134 now passes in
[CI run 37232124959](https://github.com/kzahel/rstorrent/actions/runs/37232124959).
All ten executed source jobs and exact-source Website pass; the two manual-only
CI jobs are skipped on this ordinary push. See the
[source CI receipt](../evidence/release-source-ci-257.json).

The Linux VM is used under a common read-only doctor and exclusive ordinary
claim, with portable tooling and bundled headless Chromium in one owned scratch
directory. No installed primary browser or outer UI is used. Owned fixtures/tooling and browser processes are removed; its original powered-off
state is restored by orderly shutdown and the exclusive claim is released.
The independent signed-candidate campaign waits for the complete source gate.

## Fresh Release Source-Test Race

Desktop run 37235683007 passes updater identity, Rust checks and tests, then
fails the unit external-intake FIFO success assertion. The recording application
pushes the second command before its async result, queue synchronization and
status update finish. Waiting for two command submissions does not prove their
completion; the test reads the preceding terminal-error message. Await the
existing no-dialog, successful status and empty-queue observations together
before finishing. Preserve the exact command/order/default-root assertions.
No runtime behavior changes. Revalidate the unit suite and hosted source gate
before qualifying fresh signed desktop packages.
The affected 68-test file, full 470-test unit suite (two skipped) and typecheck
pass locally. Final source f5860c99bbaf6b40c0ba40735071aff6a0b5527d passes
all ten executed CI jobs and Website in runs 37236977716/37236977340.
The source receipt binds that correction and preserves the prior green source.
