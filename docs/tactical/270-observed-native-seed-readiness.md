# Tactical 270: Observed Native Seed Readiness

Status: Complete locally, 2026-10-08. Qualification-only follow-up to259/267/269.

Topics: `client-surfaces`, `incoming-reachability-and-seeding`,
`application-view-api`.

## Scope, non-goals and stopping condition

Current native evidence independently hashes all28 MiB and renders Seeding,
but the first observer has zero registrations. After the failed120-second
leecher it has one registration and two UnknownTorrent rejections for exactly
the owned fixture. Actual retained logs place joined engine completion at
03:08:10 and accepted structural seed registration at03:08:45. Starting a
leecher before admission, then relying on its failure backoff, did not qualify
completed-file upload. Do not change engine, listener, privacy, selection,
admission, background policy or peer retry behavior to conceal this ordering.

Wait for actual bounded native seed readiness before starting the independent
leecher. Resolve exactly one owned torrent ID from package-UID logs and the
fixture hash, then sample the existing read-only debug observer with fresh
threadtime evidence. Only the isolated single-fixture profile is eligible;
require one actual registration and a valid current port. Retain bounded
samples and elapsed time; timeout, malformed/ambiguous/stale observations and
unexpected registration counts refuse. The upload still independently hashes
every file; readiness alone is never an upload pass.

Correct the diagnostic assertion to the established Normal-profile contract:
severity minimum applies, while Warning/Error from other categories remain
visible. Actual selected labels alone still cannot qualify settled rows.
The current native peer capture intentionally contains discovery warnings;
the overly strict assertion is a runner failure, not a native filter defect.

Retry only explicit fresh UIAutomator idle/capture failures within one bounded
capture operation. Delete only the owned XML before each attempt; never reuse
old XML or retry authentication/transport failures. Final missing/failed fresh
capture refuses and cannot establish navigation success.

Stop after meaningful stale/ownership/refusal/late-readiness/capture tests,
current-source targeted large-metadata full-hash/upload/joined-Live checks on
both devices, cleanup, reconciled report/checklist and local commit. Default
three-repetition/hour qualification follows under259; a short pass is not an
hour or managed Play/store update. iOS and publication are out of scope.

## Source, ownership and bounds

Reviewed `ApplicationService::reconcile_admission`, `reconcile_incoming_torrent`,
`record_seed_reconcile`, `TorrentRuntimeHandle::reconcile_seed` and its joined
active-content eligibility. The existing engine's registry snapshot and native
observer269 are authoritative; no protocol design or implementation changes.
Reviewed `diagnostics::diagnostic_matches` and
`profiles_and_prefixes_filter_without_message_parsing`, which deliberately
preserve Normal warnings across category prefixes. No native filtering change.

Existing Machine Control/RemoteAdb transport and debug service coroutine own
samples; no persistent process/queue is added. Bound readiness to180 seconds,
each sample to the remaining deadline, retained evidence to32 snapshots and
one exact40-hex fixture identity. Never clear device logs. UI capture uses at
most three fresh attempts within its existing overall30-second budget. Existing
seed/tunnel/temp/profile/folder finally owners remain. Keep all prior failed
receipts and their actual component passes.

## Portable execution checkpoint

All37 driver cases pass. Tests prove exact hash/identity refusal, fresh native
observations instead of old ready rows, delayed admission/current-port selection,
ambiguous registry refusal, timeout with retained unready evidence and a32-sample
first/latest bound. Normal cross-category warnings remain visible; informational
rows still require the selected category. Real command ownership tests preserve
the nested-shell hostile-URI boundary. Explicit exit-zero idle/missing-file
failures cannot reuse XML; three failed fresh captures refuse, while a second
fresh successful capture proceeds. Transport refusal is not retried.

Both current targeted native large-fixture reruns are next; no physical pass is
inferred from these portable tests. The original observer failure/UnknownTorrent
and three successful two-positive-file uploads with later failed restart capture
remain immutable failed overall receipts, with successful owned cleanup.

### Initial native-readiness retry and bounded unavailable samples

Both first ready-stage reruns independently hash the payload and recover the
actual Logs/Live view, then retain measured zero registrations before a sample
expires. CohortA samples remain zero through70.07 seconds; cohortB through
106.69 seconds. No leecher starts and both cleanups pass. A native observer's
10-second cancellation can leave no reply while structural admission owns the
service lock. Treat only this bounded sample expiry as unavailable, retain it
without inventing a zero/ready registry, and continue within the same180-second
readiness budget. Malformed replies and earlier transport timeouts still refuse.
Do not launch a transport operation with less than two seconds left in a sample.
Logs/diagnostic messages remain evidence and never substitute for the actual
registry snapshot. All40 driver cases pass, including these refusal/busy and
exhausted-deadline cases. A second current physical retry follows.

### Current physical readiness and fresh reopen observation

Both original large-metadata current-source fixtures now independently upload
and hash all29360128 bytes after actual native registration:107.99 seconds on
cohortA and163.46 on cohortB, including retained unavailable samples. CohortA
passes actual joined Live reopen and cleanup. CohortB's fresh UI capture fails
while the actual failure screenshot shows Checking download folders; its overall
receipt remains failed despite upload success and successful owned cleanup.

The existing restart wait is120 seconds, but a single bounded UI capture failure
currently aborts it early. Preserve a distinct error only for explicit idle/no-
fresh-XML capture failures. The restart observer may continue sampling inside
that same120-second deadline, with each transport bounded by remaining time.
Retain unavailable capture counts; never infer Live from a delivered launch,
payload hash, screenshot or missing XML. Authentication, ordinary transport,
malformed XML and invalid navigation still refuse. This changes qualification
observation only; no product startup, folder-check or engine policy changes.
Required cases: unavailable then actual owned Live, permanent unavailable
deadline, nonretryable transport/XML, no navigation beyond two steps and
remaining-time transport bounds. CohortA's full default run proceeds unchanged
while cohortB's bounded retry exercises the new observation.

### Fresh diagnostic-control observation follow-up

CohortB's third retry passes independent download/hash but fails earlier while
observing its diagnostic warning control: the actual capture shows the selected
Warning view, while UiAutomator provides no fresh root. No upload runs in this
receipt; cleanup succeeds. Apply the same typed unavailable-capture observation
to existing30-second control/filter waits, with each transport bounded by the
remaining wait. A selected label or old XML still cannot establish rows/control
bounds. Ordinary transport, malformed XML and ambiguous/disabled controls refuse
immediately. Preserve this separate failure rather than relabeling it as the
later joined-restart failure. Portable control/filter retry/refusal/deadline
cases and another bounded cohortB retry are required.

Portable control-observation validation passes48 cases. The added cases require
fresh enabled bounds and actual filtered rows after an unavailable capture;
permanent unavailability reaches the original stage deadline. Transport and
malformed XML refuse without replay. The shared deadline adapter bounds nested
transport and navigation while preserving all prior native ownership/refusal
cases. The current cohortB fourth bounded retry follows; cohortA's default
run passes all three cold/download/source-offline repetitions and now transfers
under the detached hour observation. Neither is adjudicated as a full hour yet.

## Bounded physical stopping condition

Both current application sourceaeaa original large fixtures pass the complete
targeted path: cohortA ready-attempt2 and cohortB ready-attempt4. Each verifies
all29360128 bytes/hash1b90d0a98b5c16a7ced9cb42c13f5c61757d6482, actual large
retained history and Warning/Info rows, return to the owned Live library, fresh
native registry/current port6881, independent upload of every file, joined
shutdown withcleanup_failed=false/service absent, unchanged SAF registry and
payload, actual reopened Live plus owned row and successful cleanup. Readiness
takes107.99/166.16 seconds respectively; unavailable native samples retain
their true status. No UnknownTorrent rejection occurs in these ready uploads.
The single HandshakeInvalid is the known controlled tunnel open/close probe.

CohortB's successful reopen observes two real Settings Back steps and zero
unavailable final captures; portable cases cover unavailable-to-fresh recovery.
All48 driver cases pass. Earlier registration, fresh-capture and filter-assertion
failures remain immutable separate receipts. This completes270's bounded
qualification-only stopping condition; full default three-repetition/hour
acceptance, managed Play and final signed delivery remain under259. Report
assets stay ignored and no engine or product policy changes are needed.
