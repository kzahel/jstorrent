# Download Correctness

Topic: `download-correctness`

Tactical `212` now also resolves completed-seed repeated checking for verified
oversized files. A one-shot, nonpersistent exact-extent handoff follows joined
successful content work into seed registration; ordinary startup validation
remains strict and peer reads remain bounded by metainfo. Native and Android
provider negative cases pass, as do the complete topology/checkpoint matrix
and four-case application restart/seeding/repair cohort. The ordinary
presubmit and extended/recovery workflows now pass on hosted Linux; see
[the exact record](../evidence/release-readiness-ci-2026-09-12.md).

Completed Tactical
[`212`](../tactical/212-application-lifecycle-verification-gate.md) adds the
presubmit application lifecycle cohort and repairs missing queue admission
when Resume follows a paused seed's corrupt-data recheck. Single-file and
cross-file cases prove exact piece invalidation before restoring the source,
one-piece repair, independent complete seeding before and after repair, and
joined cleanup. The previously repeated Checking transition for oversized
files is repaired by the one-shot verified-extent handoff above; both hosted
extended runs now converge and seed the exact logical content.

Status: Direct-storage replacement accepted on 2026-08-29. Tactical
[`191`](../tactical/191-direct-filesystem-storage.md) preserves verification,
request ownership, synchronized have evidence, selective boundary handling,
restart, and repair while replacing publication with direct final-path
readability. The implemented behavior remains publication-based until that
tactical lands.

Controlled v1 downloads now verify, persist, resume, and publish through a
bounded multi-peer request owner across ordinary single-file and selective
multi-file profiles. Completed Tactical
[`143`](../tactical/143-dual-identity-and-persistence-foundation.md) binds
durable have and part state to opaque owner plus raw-info fingerprint and
re-proves crash-conservative restart, topology repair, publication, checking,
streaming, transfer, and exact v1 hashes. Completed Tactical
[`151`](../tactical/151-complete-source-pure-v2-runtime-vertical.md) adds the
strict complete-source pure-v2 vertical with aligned file-local storage,
streamed SHA-256 Merkle verification, conservative restart/recheck,
publication, verified reads, and active/completed upload. Completed Tactical
[`155`](../tactical/155-v2-magnet-authenticated-hash-exchange.md) extends that
authority to pure-v2 magnets: payload waits for proved piece roots, candidate
bytes remain unverified across missing-hash restart, complete files may
reconstruct their tree locally, and authenticated leaf proofs retain good
blocks while repairing exact corrupt blocks. Hybrid dual verification was
absent at the Tactical `155` checkpoint. Completed Tactical
[`156`](../tactical/156-hybrid-dual-swarm-runtime-closure.md) now requires both
the exact v1 SHA-1 result and the v2 Merkle result before hybrid have,
readability, publication, or upload. One-scheme success is a typed terminal
inconsistency; ordinary corruption remains retryable, internal padding is
synthetic, and restart/recheck restores only dual-verified state.
Tactical `017` closes the recorded one-peer liveness
mechanisms with request expiry, failover, late discovery, and replacement.
Tactical `020` adds useful-payload request windows and sampled connection
inactivity. Tactical `021` installed tracker fan-out and a bounded 30-peer
admission set, and Tactical `022` removed the resulting duplex channel
deadlock with 3/3 owner-only and paired 50% evidence. Tactical `023` completed
strict endgame duplicates, core cancellation, and public publication.
Tactical `024` completed whole-piece v1 hash recovery, exact-generation
contributor evidence, and bounded peer integrity reputation. Tactical `025`
completed one bounded asynchronous storage owner with exact write/hash,
resume, payload, cancellation, and join ownership. Tactical `026` completed
the paired live peer-utility timeline and selected the continuously occupied
eight-attempt half-open cohort. Tactical `027` expanded that cohort to 30
under the existing live-peer and payload bounds. Its public timeline exposed
discovery events queued behind continuously ready storage; Tactical `028` now
completed fair supervisor intake. Tactical `029` removed redundant selective
hash seeks with exact integrity, but controlled timing stayed neutral and live
storage occupancy remained saturated. Tactical `030` moved the complete
all-wanted piece hash behind one bounded blocking job with exact shared-engine
and Android-target evidence, but performance remained neutral. Tactical `031`
now measures queue wait and per-kind storage service. Three public screens
attribute 93--94% of wall time to serialized storage service, dominated by
16 KiB writes at about 88%; the next slice owns write execution rather than
selection or request policy. Tactical `039` corrects a separate product-profile
defect: outstanding requests, received payload, and active-piece selection now
have distinct byte budgets instead of sharing the former 32 KiB desktop
allowance.
Tactical `052` separates hash success from bounded batched durability and
proves conservative pre-sync, post-sync/pre-commit and post-commit crash
outcomes. Tactical `053` moves single-file, wanted-file and part-file writes
plus mixed hashes onto retained generation-checked positional plans; stale
routes fail before payload mutation, skipped/padding integrity and
materialization remain exact. Tactical `054` adds that piece-generation join
and independently bounded writes and hashes. Exact selective, mixed-peer,
controlled publication, partial-epoch restart and all three crash-boundary
gates pass after the concurrency change.
Tactical `046` closes a cancellation ownership race in public and
session-facing wrappers: terminal metadata/content results now follow the
supervisors' joined cleanup and final empty peer observation.
Tactical `063` adds live binary file selection while retaining full boundary
piece verification, conservative recheck, explicit generation joins, and exact
part-to-file materialization.
Completed Tactical
[`176`](../tactical/176-durable-high-file-priority.md) adds durable ordinary
High scheduling without changing those storage or integrity rules. A piece
inherits the maximum priority of its overlapping wanted non-padding files;
the rarest-first picker ranks `availability * (8 - priority) * 3` with Normal
4 and High 6, so rarity and priority compose rather than forming an absolute
global tier. Live High/Normal changes rebuild bounded inactive rank and v2
hash-need order without cancelling accepted work or replacing the generation.
Completed Tactical
[`177`](../tactical/177-bounded-dry-swarm-recovery.md) closes a distinct
connection-liveness trap without changing request or integrity authority. The
ordinary three-failure ceiling remains; tracker refresh may rehabilitate one
failure, and an otherwise dry content swarm may admit one expired transient-
failure probe under a capped torrent-wide cadence. The successful scripted
probe enters the ordinary request, storage, verification, publication, and
joined cleanup path.
Tactical `073` removes the remaining single-file storage fork. BEP 3
`length`, one-entry `files`, and ordinary multi-file torrents now share one
positional storage, checkpoint, full-recheck, repair, and publication
pipeline. Its original restart and force-recheck path hashed every physically
readable wanted piece, including persisted false bits, before current have
state became authoritative.
Completed Tactical
[`108`](../tactical/108-serialized-torrent-control-and-observable-checking.md)
changes the full-check inventory from wanted pieces to every physically
readable logical piece, leaving selection to request/completion policy. It
also separates verified, absent, mismatched, unreadable, and peer-transfer
hash-failure meanings and replaces selection-triggered full-generation
rechecks with a bounded storage-route fence plus affected-piece validation
when provenance is uncertain. Selection changes now preserve healthy peers,
the active checker generation, and independent have evidence; unavailable
promoted spans clear only their boundary pieces and enter ordinary repair
without a transfer hash-failure event.
Tactical `081` adopts libtorrent's 2,097,152-piece and 536,854,528-byte
piece-length limits. Peer availability remains a compact 262,144-byte bitfield,
and content planning retains bounded active byte/piece windows rather than an
eager whole-torrent block plan. One maximum piece may enter a window alone but
cannot admit the following piece over budget. Payload writes remain bounded to
ordinary blocks and storage hashing is incremental rather than retaining a
piece-sized payload.
Completed Tactical
[`104`](../tactical/104-selection-aware-torrent-eta.md) adds an
application-view estimate without changing these integrity rules. Its
required network work includes every real byte requested for a wanted piece,
including skipped-file boundary bytes, but excludes BEP 47 padding synthesized
locally. Current-generation accepted blocks reduce the estimate before
verification; an exact hash-failure event restores them, while only verified
pieces remain durable across generation replacement.
Completed Tactical
[`114`](../tactical/114-session-wide-concurrent-torrent-admission.md) retains
all per-torrent request, verification, publication, and recovery semantics
while moving their aggregate request, resident-payload, active-piece, write,
and hash ceilings to one session authority. A controlled small-plus-large
four-torrent fixture proves simultaneous progress, exact publication,
completion-driven promotion, and terminal zero accounting. Queue order and
active-count policy do not become integrity evidence or weaken conservative
restart/checking behavior.
Completed Tactical
[`120`](../tactical/120-per-torrent-trusting-fast-resume.md) now owns the
accepted change to that ordinary restart policy. It trusts only durably
committed per-torrent bits after bounded managed-artifact validation, with no
global crash invalidation or clean-shutdown prerequisite. The current code
uses zero payload reads and hashes on an accepted resume; explicit or pending
Force verification remains full, and structural disagreement falls back only
the affected torrent.
Completed Tactical
[`124`](../tactical/124-duplex-verified-piece-upload.md) now publishes a
piece to the upload path only from the same verified/write-complete and
currently readable route epoch used by active storage. Outgoing and accepted
loopback peers have each exchanged complementary pieces in both directions
before completion; request admission and read serialization revalidate the
availability epoch, and incoming contributors share the existing integrity
reputation. A current-epoch upload observation/read failure now clears the
advertised epoch before stopping the generation, while pause, force recheck,
archive, removal, and publication prove joined route replacement. Controlled
ordinary/Fast/MSE interoperability independently verifies cross-file and
part-backed final hashes. The API 34 SAF gate persists an exact two-piece
partial state, fails closed on grant loss, repairs it, and completes a
bidirectional complementary exchange under the shared resource owners. An
accepted fast resume also reconciles pending file promotions before new
writes, and contributor evidence survives disconnect until delayed hashing
finishes.
Completed Tactical
[`139`](../tactical/139-incomplete-file-streaming-demand.md) gives an active
reader access only after every piece intersecting its next 64-KiB logical
chunk passes that same complete hash and current-route publication boundary.
Current stream demand schedules before ahead and ordinary work without
changing durable selection or retaining a High override; bounded untouched
ordinary attempts may be
preempted, and one slow current block may gain at most one different-peer
attempt whose first accepted response cancels the loser. Corrupt, stale,
replaced, skipped, paused, or unavailable generations cannot wake or feed a
body. Controlled concurrent ranges and a full body crossing exact publication
return the fixture hashes without treating sparse bytes as verified content.

## Scope

This topic owns the continuing definition and evidence for download integrity,
request liveness, piece completion, failure recovery, durable verification,
and publication. It is organized by invariants and adversarial scenarios
rather than by modules or BEPs.

It does not own discovery wire protocols, peer-record retention, application
commands, or platform UI composition. Those topics provide mechanisms and
presentation, while this topic asks whether wanted bytes can safely and
eventually become verified content.

[`capability-readiness.md`](capability-readiness.md) owns the prioritized
cross-product queue. [`peer-lifecycle.md`](peer-lifecycle.md) owns peer records
and connections. [`client-persistence.md`](client-persistence.md) owns durable
have state and storage-root identity.

## Correctness Vocabulary

- A **wanted byte** contributes to at least one selected non-padding file.
- A **wanted piece** contains wanted bytes and therefore must be hash-verified,
  including any skipped-file or padding bytes needed to verify its full hash.
- A **block** is a bounded request range within one piece.
- A **request attempt** is one block assignment to one peer connection
  generation with an issuance time and terminal disposition.
- **Available** means a specific live peer has advertised a piece. It does not
  mean that the peer will serve it correctly or promptly.
- **Verified** means the complete logical piece matched its trusted metainfo
  hash after storage writes completed.
- **Durable** means verified storage was synchronized as required before the
  corresponding have checkpoint could commit.
- **Complete** means every wanted piece is verified and the selected storage
  publication contract has completed. Displayed byte percentage alone never
  establishes completion.
- **Liveness** means that while some automatic action can plausibly advance a
  valid torrent, an owner eventually performs or schedules such an action.

## Required Invariants

### Integrity

- Peer payload is untrusted until the complete piece hash verifies.
- No unverified piece may become authoritative have state or published
  selected content.
- A hash mismatch invalidates the attempted piece, not the metainfo hash or
  unrelated verified pieces.
- Storage failure cannot leave a block counted as received when its bytes were
  not accepted by the storage owner.
- Restart currently treats persisted have state only as input evidence. The
  implemented conservative policy hashes every readable logical piece in
  managed staging or publication, recovers valid false bits, and clears
  invalid true bits before atomically replacing current have state. Planned
  Tactical `120` changes ordinary eligible admission to bounded structural
  validation plus trust of committed true bits; explicit/pending Force recheck
  retains this complete hash-and-replace behavior.
- Completion and seeding eligibility must derive from verified wanted pieces
  and completed publication, never a rounded percentage.

### Request Ownership

- Every outstanding request has exactly one torrent-level owner, one peer
  connection generation, and one bounded request reservation. That reservation
  is scheduling work, not an eagerly allocated payload buffer.
- Choke, disconnect, request expiry, connection replacement, pause, and
  shutdown terminate or transfer ownership explicitly.
- A stale socket callback cannot complete or release a newer request attempt.
- Ordinary scheduling assigns a block to at most one peer. Endgame may create
  bounded duplicates only under explicit policy and accounting.
- The first valid endgame response wins; losing requests are cancelled where
  supported, and late valid duplicates are harmless rather than torrent-fatal.

### Availability And Selection

- Availability is connection-scoped and changes only from validated peer
  messages or connection termination.
- A block is assigned only to a live eligible peer known to have its piece,
  except where an explicit protocol extension supplies equivalent evidence.
- No wanted piece becomes permanently unschedulable merely because an earlier
  peer lacked it, choked, disconnected, or timed out.
- Piece selection may optimize rarity, locality, streaming, or fairness only
  after preserving the ability to schedule every wanted piece.
- Durable High/Normal ordinary ranking never outranks an active bounded
  current/ahead streaming lease; removing the lease restores the same ordinary
  weighted order.
- A torrent awaiting add-time file selection may acquire verified metadata but
  cannot request, accept, write, verify, or report content. Its Normal/Skip
  intent becomes runnable only after one durable catalog-fenced confirmation.
- Expanding selection on a completed torrent returns it to download ownership
  until newly wanted pieces are fetched or already verified boundary bytes are
  promoted from the part store. Stale seed admission cannot make that work
  appear complete.

### Progress Assessment

- Failure of one tracker, peer, request, or piece attempt is not automatically
  torrent failure.
- A torrent is waiting, not blocked, while a retained tracker retry, eligible
  peer dial, dry-swarm probe deadline, request expiry, recheck, publication
  action, or other installed automatic mechanism can still act.
- A torrent is blocked only when the next prerequisite requires external
  action and no installed or scheduled automatic mechanism can supply it.
- Progress assessment is a projection from authoritative owners. Diagnostic
  text is explanatory evidence and is never parsed back into state.
- There must not be an unbounded state in which wanted work remains, no request
  can advance it, and no future automatic action is represented.

The earlier idea of `can_torrent_progress()` should therefore not become a
single optimistic boolean. Extend the existing active, waiting, blocked,
inactive, and complete projection with scheduler facts and the next automatic
action. Unknown future peers are not proof of impossibility; exhaustion is
asserted only over installed mechanisms and retained schedules.

## Current Architecture And Known Stall Mechanisms

One torrent supervisor owns a bounded set of live connection generations,
piece/block state, request attempts and deadlines, request reservations,
storage acceptance, verification, and child-task joins. It schedules across
up to 30 established peers while tracker and DHT discovery remain live. A
byte-oriented active-piece working set bounds selection breadth. Each
connection has a bounded useful-payload-driven request window; a distinct
torrent request allowance bounds aggregate promises, while the storage owner
independently bounds received resident payload. Useful response samples derive
a two-to-sixty-second connection inactivity deadline; a stall releases that
generation's window and leaves one probe request. Choke, disconnect, expiry,
and replacement release only the affected generation's requests; valid late
payload cannot release newer ownership.

A failed v1 piece generation now resets as a whole after hashing, preserves
unrelated verified pieces, and retains bounded exact-generation contributors.
A sole source is known bad and banned; ambiguous contributors accumulate
bounded suspicion without false immediate bans. Strict endgame duplicates and
core losing-request cancellation are installed and publicly exercised. The
remaining measured gap is completion performance rather than a known fatal
ordinary transition.

These are structural facts, not a diagnosis of any particular public run.

## Observed Incidents

### OBS-2026-07-31-001: Desktop Torrent Near 99.9%

- **Environment:** Tauri desktop application on macOS with online network
  policy.
- **Observation:** a real torrent reached approximately 99.9% and did not make
  further visible progress.
- **Captured evidence:** user observation only; no authoritative remaining-
  block, availability, peer, or request snapshot was retained.
- **Current classification:** open completion-liveness observation, not a
  confirmed tracker error and not proof of corrupt state.
- **Closed sufficient mechanisms:** controlled tests now pass when the final
  piece exists only on a second peer, a requested block is withheld while
  keepalives continue, a useful peer arrives later, or the first peer closes.
- **Remaining plausible mechanisms:** absent endgame duplicates or terminal
  hash-failure behavior. The observation remains open because its original
  cause was not captured.

## Scenario Ledger

States in this ledger describe the full required result, not merely whether a
related unit test exists.

| ID | Scenario | Required result | Current state and evidence |
| --- | --- | --- | --- |
| DL-C01 | One peer supplies a complete healthy torrent | Every wanted piece verifies and selected storage publishes. | Passing: controlled runtime and libtorrent interop across small, large-piece, selective, magnet, and tracker fixtures. |
| DL-C02 | Peer A lacks the final wanted piece; peer B has it | Scheduler keeps or opens B, assigns the piece, and completes. | Passing deterministic and two-peer split-availability runtime evidence. |
| DL-C03 | Active content peer disconnects with requests outstanding | Its generation releases requests and another eligible peer may receive them. | Passing deterministic and scripted disconnect/reassignment evidence. |
| DL-C04 | Peer chokes with requests outstanding | Requests cease belonging to that peer and remain schedulable without budget leakage. | Passing deterministic and alternate-peer choke/reassignment evidence. |
| DL-C05 | Peer remains responsive but withholds one requested block | Per-request expiry releases the block and another peer can serve it. | Passing explicit-clock and loopback keepalive/late-response evidence. |
| DL-C06 | Tracker discovers a useful peer after content begins | Observation joins the registry and may become a live content source while work remains. | Passing independent delayed tracker and DHT runtime evidence through the same intake boundary. |
| DL-C07 | Final blocks are slow across several peers | Endgame issues bounded duplicates without violating payload or request budgets. | Passing pure, scripted, and four exact public complete runs with 12--88 bounded assignments and zero active request attempts at termination. |
| DL-C08 | One endgame copy arrives after another completed | First valid block wins, losers are cancelled, and late duplicates are harmless. | Passing pure, scripted exact core-cancel-before-storage, and public complete evidence with 0--432 KiB bounded redundancy. |
| DL-C09 | A received piece fails its SHA-1 hash | No have bit is set; the whole piece becomes schedulable again; contributor evidence is bounded. | Passing pure and scripted evidence: sole corrupt and ambiguous multi-source generations reset, preserve unrelated state, apply exact-generation reputation, and complete from a clean generation. |
| DL-C10 | Storage write fails after a block arrives | The block is not considered received and no false verified state is committed. | Passing deterministic state evidence; broader filesystem recovery policy remains incomplete. |
| DL-C11 | Restart claims all but one piece | All wanted pieces are rechecked, the missing piece downloads, and publication occurs once. | Passing controlled process-death evidence for `length`, one-entry `files`, and cross-file profiles. |
| DL-C12 | A claimed piece changed on disk before restart | Recheck clears only the bad claim and never publishes it as verified. | Passing deterministic and controlled corruption, truncation, missing-file, and exact-piece repair evidence. |
| DL-C13 | Final wanted piece crosses selected and skipped files | Full logical piece is reconstructed, hash-verified, and bytes land in their correct storage classes. | Passing deterministic and controlled libtorrent selective-file evidence. |
| DL-C14 | Wanted piece contains BEP 47 padding bytes | Synthetic zeros participate in verification without writing a padding file. | Passing deterministic and controlled selective-storage evidence. |
| DL-C15 | Pause or shutdown occurs during active work | No new work starts, owners cancel and join, durable state stays conservative, and sockets close. | Passing runtime, web, AVD, selected physical, saturated-queue, multi-peer exact-join, metadata-worker cancellation, and session content-pause evidence. Tactical `046` specifically proves the pause receipt follows socket close, zero pending owners, and the final empty peer observation. |
| DL-C16 | All current trackers fail but retain retries | Torrent reports waiting with the next automatic discovery action, not blocked. | Passing deterministic, runtime, web, and AVD evidence. |
| DL-C17 | Network policy is offline | No DNS or socket work occurs and UI requests network enablement without rewriting torrent intent. | Passing deterministic, runtime, web, and AVD evidence. |
| DL-C18 | Torrent reaches displayed 100% before publication finishes | State remains incomplete until verified content completes the publication contract. | Passing path and Android SAF publication-state evidence for controlled fixtures. |
| DL-C19 | Multi-piece single-file torrent | The ordinary product path downloads, verifies, resumes, and publishes all pieces. | Passing deterministic, controlled libtorrent, three checkpoint-death, three publication-death, and exact cleanup evidence through the unified storage owner. |
| DL-C20 | Every established slot is occupied by peers that never unchoke | A useful eligible candidate eventually replaces an unproductive peer after bounded grace and can receive work. | Passing deterministic and full eight-slot loopback replacement evidence. |
| DL-C21 | Every established peer lacks the remaining wanted piece | A peer advertising that piece is retained or opened, while irrelevant peers cannot monopolize every slot. | Passing availability-aware retention/replacement and split-final-piece evidence. |
| DL-C22 | Pending dial slots connect but never finish handshake | Per-operation deadlines release dial capacity and another candidate can be tried without exceeding socket/task bounds. | Passing bounded three-dial runtime evidence with two silent handshakes and one useful peer. |
| DL-C23 | An expired request is reassigned and the old generation sends its block late | Current ownership and payload accounting remain correct; valid late data is harmless and cannot release another attempt. | Passing deterministic ownership/accounting and loopback late-payload evidence. |
| DL-C24 | All current peers are unproductive and no replacement is eligible | The torrent retains discovery/retry deadlines and avoids destructive reconnect churn; it reports waiting rather than blocked. | Passing deterministic deadline and loopback no-churn evidence. |
| DL-C25 | Hostile peer churn and observations fill every configured bound | Registry, connection, dial, request, payload, event, task, history, and diagnostic limits hold while uniquely useful or active state is protected. | Passing bounded deterministic state plus queue-saturation, cancellation, churn, and exact-join runtime evidence for the installed owner. |
| DL-C26 | A multi-file torrent changes between Skip and Normal before and after content starts | Metadata-only intake creates no payload artifact; Skip changes wanted-piece planning only after the old generation joins; Normal rechecks current sources, materializes verified skipped spans, and removes an empty part file without false have state. | Passing selective-storage, store, two-generation loopback, and bearer-authenticated controlled browser/libtorrent evidence from Tactical `063`. |
| DL-C27 | Valid managed bytes exist while durable have says absent | Full recheck discovers, synchronizes when needed, and atomically restores those bits without peer payload. | Passing empty/stale bitmap, pre-sync, post-sync/pre-commit, and seed-unavailable restart evidence; the retained campaign recovered all 256 physically valid pieces with zero restart upload. |
| DL-C28 | Process death crosses path or provider publication | Durable ownership identifies the one valid artifact side, fresh handles are fully rechecked, and only then may completion commit. | Passing path intent/rename/namespace gates with the seed unavailable, plus API 34 provider-rename death and fresh published-piece recheck. |
| DL-C29 | Simultaneous incoming and outgoing sockets complete with the same remote peer ID | Both peers retain the same one usable connection; the loser releases every request, upload, descriptor, registry-generation, and task charge exactly once without merging endpoint reputation. | Passing pure, saturated scripted-runtime, generated-contract, and both controlled pinned-libtorrent peer-ID orderings from Tactical [`090`](../tactical/090-peer-id-duplicate-connection-resolution.md). Opposite admission orders evict one active uploader and one outgoing generation with a decoded content request; connection high-water is two and terminal pending, established, and torrent-generation counts are zero. |
| DL-C30 | Eligible inactive pieces have deliberately skewed live availability, including a maximum-geometry hostile case | Existing requestable partial work finishes first within explicit byte/count/partial-pressure limits, then the picker activates availability-one and lower-availability pieces before common pieces with bounded seeded rotations; optimized and naive choices agree, active block assignment performs no inactive scan, rank rebuild, sort, or candidate allocation, and a full peer request window stops before inactive activation. | Passing deterministic, maximum-geometry, release CPU/memory, controlled throughput, and controlled libtorrent `2.0.13.0` evidence from Tactical [`091`](../tactical/091-availability-ranked-piece-activation.md). The hostile active trace performs 204.8 million visits with zero rarity work, 100,000 full-window attempts visit zero inactive pieces, and the skewed eight-piece swarm verifies its sole availability-one piece first. |
| DL-C31 | A negotiated Fast peer chokes and explicitly rejects outstanding requests | Each request receives exactly one piece/reject outcome; exact rejection immediately releases and reassigns the block without waiting for timeout, while ordinary non-Fast choke behavior remains compatible. | Passing deterministic ownership/race tests and controlled Tactical [`093`](../tactical/093-bep6-fast-request-lifecycle.md) evidence. A scripted Choke then exact Reject Request retries the rejected block once in under one millisecond, transfers exactly 40,000 payload bytes, and verifies the expected SHA-1; both pinned-libtorrent directions negotiate Fast and verify the same content. |
| DL-C32 | A public torrent learns its only useful second-hop peer through a hostile-capable PEX source | Bounded PEX admits the eligible endpoint through the ordinary registry and completes, while rate/source/address limits hold and privacy-unknown or private torrents admit no PEX peer. | Passing deterministic source/quota/privacy cases and controlled pinned-libtorrent `2.0.13.0` complementary two-hop evidence from Tactical [`094`](../tactical/094-bounded-bep11-peer-exchange.md). The oracle run captures one compact addition, observes one RSTorrent drop, and hash-verifies 16,777,216 bytes in 164.083 seconds. |
| DL-C33 | A wanted file shares pieces with skipped files and padding while accepted work later fails verification | ETA work includes every real byte in each required piece, excludes synthetic padding, subtracts unique current-generation accepted blocks once, restores exact failed payload, and reconstructs from verified have state after generation or selection replacement. | Passing exhaustive fixed geometry, 96 generated differential layouts, maximum-limit release calibration, pure-clock lifecycle, stale-generation, real application completion, and pinned-libtorrent `2.0.13.0` selective-file evidence from Tactical [`104`](../tactical/104-selection-aware-torrent-eta.md). |
| DL-C34 | Published content is rechecked, newly required pieces become durable, and the process restarts; a separate catalog row is malformed. | Piece checkpoints cannot relabel payload ownership, incomplete verification remains a restartable fact, the published torrent resumes from exact rechecked evidence, and the malformed torrent is quarantined without preventing profile open. | Passing schema-14 reducer/store/runtime/containment evidence plus an isolated migration and headless launch of the exact schema-13 incident shape. Final-owned content remains final-owned across checkpoints, verification completions are generation-fenced, and a malformed neighboring row enters repair without aborting startup. Tactical [`105`](../tactical/105-fact-based-persistence-and-recheck-containment.md) records the evidence. |
| DL-C35 | Stable complete torrent A restarts beside torrent B killed before sync, after sync before commit, or after commit. | A performs zero payload reads and hash jobs and remains seed-ready. B trusts only synchronized committed bits; physically present false-bit bytes may be downloaded again, and no crash invalidates another torrent. | Passing Tactical [`120`](../tactical/120-per-torrent-trusting-fast-resume.md) crash/count evidence. Pre-sync and post-sync/pre-commit retain zero bits and redownload exactly 67,108,864 bytes despite 256 physically valid false negatives; post-commit retains all 256 and downloads zero. The completed neighbor stays at generation zero. |
| DL-C36 | A partial managed resume has coherent committed bits, then separately has missing, short, oversized, or truncated-slot evidence. | Matching structure accepts with zero payload reads/hashes. Checker-readable disagreement starts one full generation for that torrent only; malformed ownership or wrong-kind artifacts enter repair without mutation. | Passing pure policy, path/platform structural observation, common-checker fallback, cancellation, controlled restart, and pinned-libtorrent oracle evidence from Tactical `120`. |
| DL-C37 | An external actor changes committed payload bytes without changing required structural observations. | Ordinary fast resume may accept the historical bitmap and is not described as freshly checked; explicit Force recheck hashes all readable pieces and clears the mismatch. | Passing Tactical `120` trust-risk evidence: ordinary resume deliberately accepts the same-length mutation, then Force hashes and clears the affected 262,144-byte piece in verification generation one. |
| DL-C38 | A strict complete-source pure-v2 torrent contains aligned empty, sub-block, exact-block, exact-piece, multi-piece, selected, and skipped files, then encounters restart, corruption, incomplete storage, publication interruption, or concurrent upload. | Only file-local payload ranges are requested or written; alignment gaps and skipped pieces create no payload or part artifact. A piece becomes have, streamable, publishable, or uploadable only after the correct SHA-256 Merkle result and durability transition. Restart/recheck conservatively invalidates missing, short, structurally incompatible, stale, or corrupt evidence while retaining exact verified content. | Passing Tactical [`151`](../tactical/151-complete-source-pure-v2-runtime-vertical.md) deterministic, runtime, two-role pinned-libtorrent, browser, path/platform, Android SAF/AVD, and resource evidence. The selective oracle fixture verifies four of five pieces and omits exactly 137 skipped bytes; the active uploader serves one exact verified 16-KiB block before final completion. |
| DL-C39 | A pure-v2 magnet has authenticated info and selected candidate bytes but lacks durable piece or leaf hashes, then encounters corruption, selection change, or restart. | New payload waits for a piece root proved to the authenticated file root. Candidate bytes remain unavailable until refetch and verification; a complete file may reconstruct locally. A valid leaf proof retains good blocks and resets only exact corrupt blocks, while reject/stall falls back to whole-piece recovery. | Passing Tactical [`155`](../tactical/155-v2-magnet-authenticated-hash-exchange.md) deterministic hostile-state, scripted restart/fallback, two-role pinned-libtorrent wire, same-session promotion, production browser, Android incomplete-candidate, and bounded-resource evidence. The AVD interrupts after wire pieces 0 and 1 of nine selected pieces and observes hash requests increase from one to two after restart. |
| DL-C40 | A strict hybrid piece arrives through either swarm lane, crosses real files and BEP 47 padding, restarts, rechecks, uploads, or yields disagreeing v1/v2 results. | One storage read feeds both integrity schemes; only validated synthetic padding feeds legacy SHA-1. Both schemes must pass before have or service. One-scheme success fails typed and closed, ordinary corruption retries without retaining authority, incomplete restart refetches sparse hashes, and complete reconstruction still revalidates the exact file root. | Passing Tactical [`156`](../tactical/156-hybrid-dual-swarm-runtime-closure.md) deterministic disagreement/padding/restart tests, both-role and both-entry-lane pinned-libtorrent transfer, selection promotion, browser restart/seeding, Android API 34 SAF recheck/upload, resource, and cleanup evidence. |
| DL-C41 | Every retained content endpoint reaches the ordinary connection-failure ceiling while discovery remains active and no normal connection action can advance wanted work. | Trusted tracker refresh may grant one ordinary retry without erasing history. Otherwise one expired transient-failure endpoint is probed at a globally paced 5-to-60-minute cadence; normal candidates/backoff always precede it, definite failures remain excluded, and success reuses ordinary verified-content and exact cleanup ownership. | Passing Tactical [`177`](../tactical/177-bounded-dry-swarm-recovery.md) source-specific deterministic transitions, exclusion/rank/cadence bounds, and scripted four-attempt completion. Three ordinary handshake failures precede exactly one probe; the verified payload publishes and terminal dialing, connected, failure-limited, request, and payload ownership is zero. |

## Required Scheduler Observability

The multi-peer owner should expose bounded typed facts sufficient to explain a
stall without dumping payload or scraping log text:

- wanted, verified, active, and missing piece counts;
- missing, requested, writing, and duplicate block counts;
- connected, eligible, dialing, backed-off, and banned peer counts;
- for the active or next pieces, how many live peers advertise availability;
- oldest request age and the next request-expiry deadline;
- the next eligible peer-dial or discovery deadline;
- endgame state and duplicate-request count when installed; and
- the derived reason no request can be issued now.

These facts belong to snapshots or typed scheduler diagnostics according to
their stability. Raw peer addresses, magnets, paths, and payload remain
bounded or redacted.

## Validation Model

Correctness work should normally use all applicable layers:

1. pure state tests for request ownership, stale generations, transitions,
   accounting, and selection;
2. scripted loopback peers for disconnect, choke, silence, corruption,
   duplication, and split availability;
3. controlled libtorrent exchange for independent wire and content evidence;
4. the authenticated loopback gateway with headless Chrome for shared web UI;
5. an explicitly owned no-window AVD for Compose parity; and
6. opt-in live or physical-device runs as additional evidence, never the sole
   correctness oracle.

Routine evidence must not launch, focus, or automate the visible Tauri desktop
application. Harnesses use temporary profiles and storage and must remove
downloads, captures, browser state, AVD state, and subprocesses they own.

## Next Stopping Condition

Tactical `024` completed DL-C09: whole-piece v1 reset, bounded contributor
attribution, known-bad exclusion, and clean retry. Tactical `025` proved that
slow writes and hashes no longer stop peer-event progress while preserving
request/payload accounting, hash recovery, resume ordering, exact publication,
and controlled interoperability. Its corrected localhost result disproved
storage as the retained speed owner.

Tactical `027` now proves exact 30/31 pending-dial ownership, prompt completion
from a useful peer in position 30 behind 29 silent handshakes, and exact
cancellation of 30 silent attempts. Its complete public screen found DHT peer
batches reported at content seconds 30 and 120 but not reflected in the
content registry until termination while storage stayed saturated.

Tactical `028` now proves prompt DHT intake and dial refill while all 66 storage
jobs are occupied. Live DHT reports and registry growth occur in the same
sample, closing the intake defect. Tactical `029` then reduced a common 256 KiB
selective hash from 16 seeks to one while preserving 16 fixed-buffer reads.
Its 32 MiB controlled median moved from 1.101 to 1.121 seconds, so it makes no
speed claim; public screens continued to hit the 66-job storage high-water
mark. Exact full publication completed at 180.64 seconds.

Tactical `030` now executes the common all-wanted piece hash behind one
blocking positional-I/O boundary with fixed-buffer, cross-file, padding,
truncation, task-failure, mixed-source, and Android-target evidence. Its 32 MiB
controlled median remained neutral at 1.139 seconds versus 1.121 immediately
before. Two public 50% samples took 79.47 and 223.85 seconds, one timed out at
359 pieces, and a complete screen timed out at 375 pieces. Every terminal
snapshot still held 66 storage jobs with zero hash failures.

Tactical `031` now proves exact bounded timing lifecycle through controlled
write/hash delays, queued cancellation, active-operation snapshots, and
saturation. One public screen reached 50% in 82.48 seconds and two timed out at
425 and 458 pieces. Serialized write service consumed 87.7--88.2% of wall
time, hash service consumed 5.5--5.7%, all runs retained exact integrity and
cleanup, and no operation remained active at termination.

Tactical `032` now drains only already-admitted writes into bounded
16-block/256 KiB batches and coalesces exact adjacent same-piece ranges while
retaining per-block completion, payload, cancellation, selective-file, and
verification ownership. Its controlled profile reduced 2,048 logical blocks
to 144--154 physical writes, but the 1.143-second median was neutral against
1.196 seconds before. Three public 50% screens timed out at 345--351 pieces;
roughly 5,700 logical blocks became about 500 writes, yet combined serialized
write/hash service still consumed 93.0--94.2% of wall time. Zero hash failures
and successful cleanup held.

Tactical `052` is complete. It decouples hash
verification from bounded batched durability while retaining the one-sided
crash invariant, conservative restart recheck, exact cancellation and joined
publication. Its exact pre-change session profile advances 514 SQLite
revisions for a 512-piece completion; the joined checkpoint owner reduces that
to exactly 18 revisions in the final retained cohort and a 46.380-second median
from 50.085 seconds. A
forced-death run persisted 112 of 128 pieces, detected one deliberately
corrupted claimed piece on restart, retained the other 111 and downloaded
exactly the corrupt plus missing payload before exact completion.
The exact checkpoint crash matrix additionally kills the diagnostic child
before sync, after sync but before SQLite, and immediately after SQLite. The
first two cases retain zero have bits and redownload all 64 MiB; the third
retains five rechecked pieces and downloads exactly the remaining 251. Every
restart matches the external payload hash and cleans all owned artifacts.

Tacticals `053` and `054` subsequently installed immutable positional spans,
piece generations and bounded independent write/hash execution. The retained
forced-restart smoke now crosses the 64 MiB epoch bound with 80 MiB/320 pieces
and a deterministic test-only commit hold. Three runs retained exactly 256
pieces, cleared the one deliberately corrupted claim, redownloaded exactly the
remaining 65 pieces and published exact content. Fresh crash runs retained
zero pieces before sync and after sync/before commit, then safely retained all
256 after the observed post-commit boundary. Selective part-file,
mixed-source, paired publication and cleanup evidence remain exact. Peer
selection and request policy are unchanged.

Tactical `073` completed the joined resume/publication contract. Its final
structured campaign used independently encoded deterministic `length`,
one-entry `files`, and cross-file torrents against pinned libtorrent 2.0.13.
Corrupting one 32 KiB piece repaired exactly 32 KiB for each one-file shape;
removing the middle cross-file source repaired exactly the two affected
pieces, 64 KiB. Pre-sync and post-sync/pre-commit deaths retained zero durable
bits but recovered all 256 valid pieces with the seed unavailable; post-commit
retained all 256. Death after durable publication intent, rename, and
namespace sync reopened the recorded staging/final side, rechecked all three
pieces without a seed, published exact SHA-1 content, and cleaned every owned
artifact. No singular `.rstorrent-part` artifact was created.

Tactical `120` now removes the unconditional ordinary resume check behind one
typed per-torrent policy. Exact managed-artifact structure admits only the
synchronized committed bitmap with zero payload reads or hashes; readable
disagreement enters the unchanged full checker, while unavailable or malformed
ownership stays in its established recovery state. Its 500-seed test keeps all
verification generations at zero beside three active downloads, and its
three-boundary crash matrix proves safe false negatives without invalidating a
stable neighbor. Force remains selection-independent and full, including
after interruption, and is the explicit integrity path for same-length
external mutation.

Routine engine validation remains headless; no additional product UI is
required by that slice.

Completed Tacticals `090`, `093`, and `094` own DL-C29, DL-C31, and DL-C32.
These records do not reopen the completed liveness cases or authorize new
implementation. Full snub
semantics and parole piece isolation remain unplanned until a stable
adversarial case shows that the current one-probe stalled policy or corruption
retry cannot complete within existing bounds.
