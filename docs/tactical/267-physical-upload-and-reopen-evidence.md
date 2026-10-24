# Tactical 267: Physical Upload And Reopen Evidence

Status: Active, 2026-10-08. Bounded finish-line driver follow-up to 259.

Topics: `client-surfaces`, `incoming-reachability-and-seeding`.

## Trigger, scope and stopping condition

Both current physical devices complete full 3,600-second detached transfers
and independently hash all 40 MiB, then their separate upload phase times out.
Only an added-torrent alert survives; actual peer/payload counters are missing.
The reused helper starts a tunnel after a fixed 200-ms delay and budgets 30
seconds for ordinary small fixtures. Current large SAF fixtures need measured
bounded evidence; neither a timeout nor an accepted SSH process proves transport
readiness. Same-route read-only SSH preflight succeeds on both targets.

Make the existing tunnel wait for its actual local listener with bounded
process/timeout diagnostics and joined failure cleanup. Keep ordinary upload
budget 30 seconds; expose an explicitly bounded optional budget for the physical
large-fixture caller and report actual peer/payload counters on progress/failure.
Do not infer upload from the controller's seed counters or enlarge budgets until
an opaque failure disappears. Independently hash every leeched file and retain
nonzero received payload as before. Preserve exact target/owned forwards and
finally cleanup; no engine, network, tracker, privacy or seeding policy changes.

Source audit also shows the reopen driver assumes Android's normal task always
opens the library. Compose retains its Settings route. Navigate only through
freshly observed Back controls on the two known settings pages, at most twice,
then require actual Live plus the owned row. Unknown/ambiguous/disabled/clipped
controls must not become a false pass. No injected app state or forced activity
reset stands in for normal navigation.

Stop after meaningful portable ownership/refusal/late-listener/navigation tests,
bounded physical upload/reopen trials on both targets, normal cleanup and local
commit with reconciled receipts/report. Keep original hour/upload receipts failed
as complete runs, even when their independent hour/hash component passed.
Only an entire corrected end-to-end hour run can become an end-to-end hour pass.

## Owners, budgets and reference scope

Existing SSH process/forward, libtorrent leecher and temporary directory owners
remain; every branch terminates/joins/removes its own resources. Listener wait is
15 seconds; explicit upload budget is validated within 1..300 seconds before
mutation. Physical caller uses 120 seconds with compact actual counters.
Reopen keeps its 120-second wait and allows two observed navigation steps.
This changes qualification infrastructure, not protocol/engine support. Existing
controlled libtorrent verification and the native settings/navigation source
are the oracle; no new protocol behavior or reference source is copied.

## Initial portable checkpoint

Twenty driver safety/navigation tests and five upload-transport tests pass.
A real delayed local TCP listener proves that fixed sleeps no longer establish
readiness; real failed/timeout child processes are joined, authentication failure
is not retried, invalid budgets refuse before forwarding, and tunnel failure
removes only the owned forward/directory while preserving an unrelated sentinel.
Progress is on stderr to preserve the existing JSON stdout contract. Initial
short physical trials are active; no upload pass is inferred from these tests.

The corrected end-to-end runner additionally opens the actual native Logs page
and switches Warning/Info to replace its diagnostic subscription after a large
verified transfer. It requires observed retained-history health and no new
snapshot-over-queue failure. This exercises Tactical 266's repaired budget through
normal UI; it does not inject service state, change filters permanently or alter
native retention. Current first short trials predate that new phase and retain
that limit. Full reruns use the new phase after portable checks.

A targeted upload option can omit already-qualified cold repetitions only for
explicit completed-upload observations of 1..600 seconds. Its receipt marks
cold repetitions unrun and it cannot be used for an hour. The ordinary hour path
still requires all three repetitions. This bounds further stage-diagnosis work
without relabeling a targeted result as complete endurance qualification.

### Short trial checkpoint

Source2ad cohortA passes all three cold repetitions and full short completion
hash, then measures zero peers/bytes for120 seconds with its SSH child still
running. CohortB times out on repetition3 after two passes. Both finally
cleanups succeed. These are retained failures, not inferred tunnel/engine
diagnoses. Add bounded connect/peer alerts (last100 retained; existing1000
alert queue) so future transport/refusal failures have concrete evidence.
Five transport ownership/refusal tests still pass. Targeted actual native
diagnostic/upload probes are active; no upload or joined-reopen pass yet.

### Diagnostic stage and transport refusal checkpoint

Source2ad cohortA and latest source0aa cohortB both pass actual native
Warning/Info replacements with retained history and no new snapshot queue
error; observed local-eviction counters are2602 and2601 respectively. Overall
upload trials still fail and owned cleanup succeeds. CohortB's first filter
trial captures a correct rendered Logs page after the control lookup failed.
Wait for fresh observed controls for at most30 seconds; ambiguous, disabled
or clipped controls refuse. Three meaningful late/absent/refusal tests bring
driver safety coverage to23 passing cases. Full latest-source Live recovery
and upload remain pending.

Actual libtorrent connect/peer alerts show TCP opening then EOF before peer
establishment. Preserve bounded SSH stderr after terminating/joining the
tunnel; local listener readiness never proved the remote endpoint. A
separate owned raw handshake on cohortB's detached current app receives zero
bytes with clean tunnel stderr; it is diagnostic evidence, not payload proof.
An earlier interactive probe answered but included an extra trailing byte
after its68-byte handshake, so it does not establish a clean comparative
foreground/background gate. No engine cause is inferred. Next native failure
capture filters the actual Logs page to peer events before clearing the owned
profile; exact observed listener port is also recorded before intake.

The diagnostic phase now explicitly requires the actual Live view and owned
row after Back before detaching. Existing finally cleanup remains; peer
diagnostics collected after an upload failure cannot relabel that run pass.
Five transport tests still pass, including captured stderr from a real
joined child. No engine, lifetime, encryption or incoming policy changes.

### Freshness and provenance guard

UIAutomator can fail without replacing a previous XML file. Remove only the
existing namespaced owned XML before every dump; a failed capture can no longer
reuse that old state. A refusal test brings the portable driver count to24.
Record the loaded driver's SHA256 at import, so edits during long trials do
not silently change receipt provenance. A corrected detached raw probe sends
exactly68 handshake bytes with a unique peer identity and receives zero bytes,
with clean joined tunnel stderr; no specific engine/lifetime cause is inferred.
Latest-source trial3 captures actual Live/owned-row after diagnostic filter
replacement on cohortB. Peer failure UI capture and cleanup are pending.

### Two-device small transport and asynchronous-filter checkpoint

Both source0aa physical small-fixture runs verify the installed APK hash and
independently receive/hash all524289 bytes in foreground, background and
reopened foreground. Both actual joined shutdown/Live-library return, retained
SAF registry, unchanged payload and owned cleanup pass. This two-positive-file
512-KiB component excludes the large fixture's120 empty files and cannot qualify
its metadata, seeding refusal or hour. The first small controller attempt used
an unconfigured helper folder selector and failed before transfer; its failed
receipt/cleanup remain. Corrected target-specific helper selectors pass.

Large trial3 on both devices restores retained history/actual Live library but
upload still receives zero peers/bytes. Actual peer view shows completed-file
registration accepted; EOF is not proof of missing registration. A newly selected
category can precede its backend snapshot. Wait for actual visible rows matching
selected severity/category, or its explicit empty state; a changed button alone
cannot pass. Two regressions bring portable driver coverage to26. Source-level
observer work proceeds under269 without changing engine/network policy.

A source0aa28-MiB fixture with two positive files and no empty files receives
one peer in all three15-second states and actual4,276,224/4,734,963/4,505,600
payload bytes. It remains incomplete; joined Live restart and cleanup pass.
This differs from the zero-peer120-empty-file fixture, but also omits its Logs
resubscription stage. Do not attribute the difference to empty files alone.
A measured120-second current-source retry and native rejection observer run
continue under269; no general background failure is inferred.
