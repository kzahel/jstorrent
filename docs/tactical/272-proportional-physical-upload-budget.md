# Tactical 272: Proportional Physical Upload Budget

Status: Complete locally, 2026-10-08. Qualification-only follow-up to259/267/270.

Topics: `client-surfaces`, `incoming-reachability-and-seeding`.

## Scope, non-goals and stopping condition

Both current original28-MiB physical fixtures now independently upload/hash and
join/reopen Live. The leecher records one sample every five seconds; cohortB's
measured progression means a40-MiB hourly fixture can require more than the
fixed120-second short-fixture allowance at the same observed throughput. Use
the same allowance per byte for the larger, already-bounded hourly fixture,
without changing engine upload speed, network/retry or background policy.

Keep120 seconds for fixtures up to28 MiB. Above that, round up120 times the
payload-size ratio; reject invalid or greater-than40-MiB fixture sizes before
transport. The maximum is172 seconds at40 MiB, below the existing controlled
leecher's300-second safety bound. Native admission still has the same180-second
budget. A ready registry, moving counter or longer budget cannot pass upload:
the existing independent leecher must verify every file.

Record the computed inner leecher allowance and complete verification-call
elapsed time separately; the latter includes tunnel setup/native observations
and must not be labeled pure transfer duration. Failed calls retain their timing
and status. Preserve the cohortA hour already running with its loaded120-second
driver; exact loaded-source receipts distinguish it from subsequent runs.

Stop after boundary/refusal and forwarding tests, current full physical receipts
under259, cleanup and reconciled commit/report. No product, protocol, package,
store, publication, dependency or iOS work is added by this tactical.

## Ownership, source and evidence

Reviewed `run_bootstrap.verify_product_upload`: one current-source fixture,
one directly owned leecher/session, five-second bounded counter samples,
1..300-second input validation, independent hashes and joined forward/temp
cleanup. Existing qualification fixture generator caps hourly payload at40 MiB.
No engine implementation/design changes, so no new protocol oracle is adopted.
Use integer arithmetic and reject booleans/non-integers/zero/oversized payloads.
Required tests preserve the28-MiB baseline, exact40-MiB maximum and proportional
boundary; invalid sizes cannot begin a forward and the computed bound must
reach the actual existing helper. Full-hour/download/upload/joined-Live evidence
remains separate from these portable cases and targeted passes.

## Measured progression and portable checkpoint

Actual cohortA targeted upload emits13 five-second samples, spanning at least
60 seconds before final completion. CohortB's successful ready-attempt4 emits18,
spanning at least85 seconds with28704768 bytes at the last sample before full
29360128-byte verification. Scaling that measured baseline to40 MiB explains
why120 seconds can be insufficient without any stall/engine change.

All51 qualification cases and five upload transport cases pass. Boundary tests
cover1 byte, exact28 MiB, one byte above baseline and exact40-MiB/172-second
maximum; invalid types/sizes refuse before registry reads or forwarding. The
actual existing helper receives the computed budget/current port and independent
file hashes. The first integration fixture incorrectly placed registry.json
inside its payload root and properly found an extra payload file; the fixture
is corrected, with the failed log retained. Source upload logic did not change.
CohortB's default full run is now active with the new bound; cohortA's earlier
loaded120-second driver remains active and distinctly hashed. Full receipts
and cleanup remain pending.

Cohort A now passes its complete default run: all three cold repetitions,
3,600-second detached observation, full 40-MiB download/upload hashes, retained
filters, joined actual Live reopen, unchanged SAF registry and cleanup. Its
loaded driver digest matches Git source09342f73 and keeps the historical fixed
120-second upload allowance. Do not attribute newer proportional/control/reopen
changes or their timing fields to that real pass. Cohort B remains active with
the current proportional driver. Whole managed/reboot/provider acceptance stays
separate; the current-source seven-case recovery repeat has started on A.

## Final proportional upload evidence

Cohort B's full current-source run uses the exact proportional driver digest
fa30d41a71f4ca189aa2da67289933b45c5a0bb9ee1d7573489fe241fc305136.
Actual native registry readiness arrives at168.06 seconds inside180. All40 MiB
independently upload/hash within the172-second inner leecher allowance; the
complete verification call takes157.36 seconds including setup/observations.
The detached hour/download hash and actual retained filters also pass.

Whole B receipt remains failed: fresh reopened-library XML is unavailable
inside its original120-second budget. Initial normal joined shutdown passes,
but the reopened Android activity becomes stopped/sleeping/invisible. Cleanup
is ok. This is not a proportional-upload failure and no whole pass is inferred.
Tactical273 owns bounded native display wake and a fresh full repeat. Seven
current-APK storage recovery cases subsequently pass B with hashes and cleanup;
A's complete original120-second full pass and seven cases stay distinct.

Boundary/refusal/forwarding tests, both full receipts, owned cleanup and local
report reconciliation satisfy this tactical's bounded stopping condition.
Final managed/provider/reboot/network/sleep and whole B reopen remain under259.
