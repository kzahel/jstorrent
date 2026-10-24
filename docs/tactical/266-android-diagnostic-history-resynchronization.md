# Tactical 266: Android Diagnostic History Resynchronization

Status: Complete locally, 2026-10-08. Bounded finish-line follow-up to 259.

Topics: `client-surfaces`, `application-view-api`,
`android-jstorrent-replacement`.

## Trigger, scope and stopping condition

The final-source physical background hour independently verifies its entire
40-MiB payload, then scoped logs show diagnostic resynchronization failing:
the 581,079-byte retained snapshot exceeds Android's 256-KiB diagnostic queue.
The source already bounds diagnostic retention to 2,048 records / 2 MiB, with
4-KiB records and bounded fields. The existing subscription contract supports
4-MiB queues, and its diagnostic retention test already uses that budget.

Request the existing 4-MiB bound only for Android's single owned diagnostic
subscription. Keep summary/detail queues, profiles, filtering, retention,
protocol, ABI, owner/task/cancellation and background/engine policy unchanged.
Strengthen the real retained-history contract test to prove that the old queue
refuses the bounded snapshot and that the supported budget delivers/resyncs it.
No new tasks, dependency, runtime architecture, public feed or store change.

This is a client policy repair, not an engine/protocol capability change.
The exact application retention/subscription implementation and tests are its
oracle; no libtorrent protocol behavior is adopted or altered. Read the owning
client/view/Android topics and existing presentation subscription/reducer.

Stop after focused retained-history regression, normal dual-ABI generated
Android build/JVM/lint/package checks, current physical diagnostic resync and
actual Live-library recovery, reconciled topics/checklist/report and a local
commit. Longer observation/upload qualification remains separately recorded;
failed receipts stay failed. Original-signature final candidate must be rebuilt
and its concrete internal review superseded before any separately approved upload.

## Owners, resource limits and evidence

`AndroidPresentationRepository` retains sole ownership of its diagnostic
subscription and one existing collection job. Closure/cancellation remains
unchanged. Maximum queued serialized diagnostic bytes are 4 MiB; Rust retention
remains 2 MiB plus bounded array/envelope overhead, and Kotlin reduction retains
its existing bounded history. No library/network payload enters this queue.
Record actual snapshot length/high-water evidence; do not imply an arbitrary
unbounded history now fits. The separate upload failure has no proven causal
connection and remains open under 259.

## Local build checkpoint

Source `2adf2eb1` passes the actual 473,255-byte retained-history regression,
including old-budget refusal and unchanged supported-budget resync. Session
clippy and all 387 passing session cases (two existing ignores) pass. Normal
original-signed release and generated dual-ABI isolated debug builds pass;
121 release JVM cases/lint and independent signing, labels, launcher, API,
ABI/alignment and notice validation pass. The APK/AAB are retained by exact
source/hash; code26 is not uploaded. Current physical stage trials remain active.

## Actual physical retained-history checkpoint

Source2ad cohortA passes native Warning/Info filter replacements with
local evicted2602 and no new snapshot queue failure. Latest-source0aa cohortB
also passes with local evicted2601. Both actual native Logs captures are
retained under the ignored259 evidence path. A previous cohortB control
lookup failure is retained, and the driver now waits for fresh controls.
Normal original-key release at0aa passes122 JVM cases,lint and independent
packaging checks. Actual Live-library return is now explicitly required by
the next bounded trial; completed-file upload and joined reopen remain
separate pending gates. The diagnostic queue fix is not asserted as their
cause or remedy.

## Bounded physical completion checkpoint

Both source0aa physical trial3 receipts complete actual retained Logs controls,
restored large history without a new snapshot queue error, and actual Live/owned
library return. Local-eviction counters are2602 and2603; native PNGs are retained
in ignored259 evidence. Both finally cleanups pass. Later independent upload
fails, so the whole receipts remain failed. Control labels alone do not verify
all asynchronous filter results;267 now separately waits for visible rows to
match selected severity/category. Queue/resync and Live recovery are complete
locally, not a whole hour/upload/store qualification.
