# Tactical 269: Android Incoming Peer Diagnostic Evidence

Status: Complete locally, 2026-10-08. Bounded diagnostic follow-up to259/267.

Topics: `client-surfaces`, `application-view-api`, `incoming-reachability-and-seeding`.

## Scope, non-goals and stopping condition

The latest physical large-metadata fixture independently completes and its
native diagnostic reports completed-file seed registration, yet both targets'
leecher connections end before handshake. A separately owned two-positive-file
512-KiB fixture passes foreground/background/reopened upload and joined Live
restart on cohortB. Do not blame general background lifetime, infer missing
registration from EOF, or erase failed large-fixture receipts.

Expose a bounded read-only Android projection of the existing application's
incoming peer snapshot through the established generated resource-observer
boundary. The existing debug-only torrent-control ingress logs this projection;
there is no product UI, new protocol capability, engine mutation, privacy policy,
network/listener/seeding change, new dependency or shared web contract.
Observe current actual listener port, registrations, pending/established peers,
payload and rejection reasons/last hashes, without peer addresses or file paths.
Stop after meaningful closed/inactive and bounded projection tests, generated
normal dual-ABI Android build/JVM/lint/package checks, physical refusal diagnosis
and reconciled local commit/evidence. Any resulting engine fix needs its own
bounded source-first tactical; this diagnostic slice does not authorize it by
itself beyond the user's ongoing finish-line task.

## Ownership, cancellation and limits

The existing application service owns incoming state. A short accessor takes its
existing async service lock, copies its already-bounded snapshot and projects it.
No new persistent task or queue exists. Existing debug command coroutine and
10-second cancellation budget own a sample; generated UniFFI cancellation frees
its future. Retain at most32 rejection-count entries and four recent rejection
records; explicit truncation flags preserve truth. Each optional hash is exactly
40 lowercase hex characters. Do not include socket addresses, user paths,
peer IDs, arbitrary event messages or credential state in the projection.
The normal generated object closes exactly as before.

## Source oracle and required evidence

`ApplicationService::incoming_peer_snapshot`, `IncomingPeerServiceSnapshot`
and its exact registration/generation and rejection counters are authoritative.
This changes observability only, so no libtorrent protocol design is adopted.
Existing Android MSE/download resource observers establish the platform pattern.
Test absent and closed application access, exact counters/port, bounded recent
records and absence of remote addresses. Record actual native output on current
physical fixture and preserve complete old timeout/cleanup receipts.

## Portable observer checkpoint

All15 Android Rust cases and focused clippy pass. A real bounded loopback
application/listener rejects six unknown-hash handshakes; its projection preserves
actual port and six rejection counts while retaining exactly four latest hashes
with explicit truncation and no peer addresses. Offline returnsNone and closed
application access refuses. The first test assumed an initially enabled listener
and failed; it now explicitly enables only its owned loopback listener before
observation. No product default was changed. Normal generated dual-ABI release, original-upload signature, resolved labels,
API28/target36,16-KiB alignment/notices, lint and122 JVM cases pass at
sourceaeaa72f9. Both isolated physical installs pass; actual current-port and
rejection samples remain active. The one owned temporary directory from the
initial failed test was removed. No inherited fixture or profile was deleted.

## Physical diagnostic stopping condition

Both exact installed sourceaeaa APKs expose actual current port6881 and
registrations without addresses/paths. Original cohortA diagnosis records
zero registrations before its failed probe, one afterward and two actual
UnknownTorrent rejections for exactly the owned fixture hash. Subsequent
Tactical270 runs wait for actual registry admission:107.99 seconds on cohortA,
163.46 on cohortB. Both independently upload/hash all29360128 bytes; the native
observer records the same actual outgoing payload counter. The one
HandshakeInvalid count is the controlled tunnel readiness connection, which
opens and closes without a BitTorrent handshake, not an engine regression.

This resolves the bounded refusal diagnosis and completes269 locally without
changing network/admission/retry policy. CohortA's joined actual Live restart
and cleanup pass. CohortB subsequently refuses its fresh restart capture while
Checking download folders; its overall receipt remains failed with cleanup ok.
The qualification-only270 follow-up owns that observation and full259 hour
acceptance remains open. Normal original-signed release, isolated dual-ABI
build,122 JVM/lint/package checks and full workspace1575 tests/clippy/fmt pass.
Web typecheck/470 cases pass with2 existing skipped; workspace has18 existing
ignored cases. Managed Play and publication remain unperformed.
