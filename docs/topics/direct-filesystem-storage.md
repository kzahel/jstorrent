# Direct Filesystem Storage

Topic: `direct-filesystem-storage`

Tactical 253 bounds completed-seed structural observations to four
caller-owned futures. Files remain ordered, exact kind/length and verified
piece authority are unchanged, and no descriptors are opened by these checks.
Missing/failed/skipped/padding cases and cancellation pass deterministic tests;
Android SAF physical startup evidence and limits belong to 253.

Completed local Tactical [241](../tactical/241-atomic-legacy-desktop-import.md)
uses this existing model for desktop legacy state conversion. It never copies
or deletes payload, imports no foreign have evidence, and commits authenticated
metadata with a pending ordinary full-check generation before an engine exists.
Good/corrupt source-offline fixtures exercise the common checker and preserve
paused intent and bytes. No path, Android SAF, or iOS adapter semantics change.

Status: **Implemented on 2026-08-29 by Tactical
[`191`](../tactical/191-direct-filesystem-storage.md).** Path, Android SAF,
and qualified iOS storage now write wanted bytes directly at final safe
metainfo paths. Schema 22 and every generated first-party boundary remove the
former publication lifecycle and managed-deletion policy. Tactical
[`193`](../tactical/193-stateless-foreground-downloader.md) completed a finite
path-only composition over this model on the same date; ordinary product
storage remains unchanged.

## Decision

RSTorrent will use a libtorrent-shaped direct filesystem model for ordinary
downloads. Payload bytes are written at their final metainfo-derived paths
under the selected download root. Existing bytes at those paths are candidates
for the normal piece checker, not destination collisions. Verified wanted
files are usable as soon as their own bytes are complete; they do not wait for
another selected file or for the whole torrent to finish.

The former managed-publication model is removed rather than retained as an
option or renamed:

- no hidden per-torrent staging file or staging tree;
- no prepared, publishing, published, or awaiting-publication payload state;
- no completion-time rename from a hidden namespace;
- no storage-policy switch preserving the old mode;
- no generic publication abstraction in the engine or platform adapters; and
- no `managed publication`, `published storage`, or `managed data` terminology
  in first-party product commands, facts, or presentation.

This is a product and architecture correction, not merely a UI wording change.
The former design added state, crash transitions, and delayed file visibility
without a demonstrated product need, and it diverged from the reference model
we otherwise use for checking and selective storage.

## Scope And Ownership

This topic owns the durable behavior of torrent payload files beneath a
selected root, including:

- direct path layout and file materialization;
- existing-data discovery, checking, repair, and ordinary restart;
- selective-file storage and the narrowly scoped part file;
- the distinction between selected completion and whole-torrent seeding;
- exact payload deletion;
- path, Android SAF, and qualified iOS root semantics; and
- application/UI facts that describe payload availability.

[`download-roots.md`](download-roots.md) continues to own root selection,
identity, defaults, validation, repair, and picker/path-entry UX.
[`storage-throughput-architecture.md`](storage-throughput-architecture.md)
continues to own bounded I/O execution, positional plans, durability, handle
pools, and throughput. [`client-persistence.md`](client-persistence.md)
continues to own durable verification evidence and profile state. This topic
settles which namespace those owners operate on.

## Reference Baseline

The decision was checked against pinned Rasterbar libtorrent `2.0.13` at
commit `7d7fc38fac61177fa5e02148f791b2f65250b09d`.

Libtorrent's `add_torrent_params::save_path` is the base path where torrent
content is stored. Both ordinary storage modes place each logical file at its
final `file_storage::file_path` beneath that base:

- `storage_mode_sparse`, the default and recommended mode, creates sparse
  files and writes pieces at final offsets; and
- `storage_mode_allocate` allocates storage up front but uses the same final
  paths.

The modes change allocation policy, not whether content is staged and later
published. `src/mmap_storage.cpp` and `src/posix_storage.cpp` open those final
paths directly. `src/mmap_disk_io.cpp::do_check_fastresume`,
`src/posix_disk_io.cpp::async_check_files`, and
`src/storage_utils.cpp::{has_any_file,initialize_storage}` send existing data
without trusted resume evidence through full checking by default. Matching
pieces survive; missing, short, or corrupt bytes remain download work.

Libtorrent's `.parts` storage has a narrower job: retaining the portions of a
piece that fall in priority-zero files while a wanted span of that same piece
is downloaded. `mmap_storage::need_partfile`,
`mmap_storage::set_file_priority`, and the corresponding POSIX implementation
do not make it a second full-payload namespace.

Relevant tests include:

- `test/test_checking.cpp::{test_checking,checking,incomplete,corrupt,extended,
  force_recheck,discrete_checking,preserve_file_priorities}` and their
  v2/single-file variants;
- `test/test_storage.cpp::{test_check_files,check_files_sparse_mmap,
  check_files_oversized_mmap,check_files_allocate_mmap}` plus the POSIX and
  priority-zero variants;
- `test/test_part_file.cpp::{part_file,posix_part_file}`;
- `test/test_priority.cpp::{export_file_while_seed,file_priority_stress_test}`;
  and
- `test/test_file_storage.cpp` path, root-name, and rename cases.

No source, fixture, resume encoding, or test vector is copied. Libtorrent is a
behavioral and edge-case oracle, not the implementation architecture.

The local JSTorrent sibling was also checked at
`0cad4dacf540f5be42ee53c4f1e1da27aa1b3685`. Its resume verification and piece
checking likewise treat discovered final-path bytes as unverified candidates.
RSTorrent retains its first-party Rust engine, stricter path safety, explicit
durability ordering, shared resource bounds, and platform-capability seam.

## Direct Content Layout

For a safe verified metainfo name and selected root:

- a BEP 3 single-file torrent uses `<root>/<name>`; and
- a multi-file torrent uses `<root>/<name>/<metainfo relative path>...`.

The BEP 52/hybrid safe logical layout follows the same rule, including
internal padding semantics already owned by the v2 tacticals. Protocol path
components remain hostile input: absolute paths, traversal, invalid
components, symlinks, and special objects at expected content paths fail
closed.

Wanted files are created lazily at their final paths. On path filesystems,
the ordinary default is sparse positional storage where supported. The first
writable open may set the file's expected logical length while physical block
allocation grows with received data. A user therefore must not be promised
that the directory listing's logical byte length is a download-progress
meter; product progress remains the verified-piece authority. Zero-length
wanted files are still materialized at their final paths.

There is no torrent-wide atomic reveal. A multi-file download can expose the
first episode while later episodes remain incomplete. Reads, media handoff,
upload, HTTP serving, and inspection all reason about verified logical ranges
in these final files; none depends on a published namespace.

## Existing Data, Recheck, And Restart

Final-path existence is ordinary and expected:

1. With no trustworthy durable have evidence, inspect only metainfo-declared
   paths and run the common full piece checker.
2. Hash-matching pieces become verified have evidence.
3. Missing, short, unreadable, or corrupt spans remain absent and are
   downloaded normally when wanted.
4. Names, kinds, lengths, timestamps, provider identity, and prior
   RSTorrent-looking names never establish verified bytes.

Tactical `188` already implemented the essential no-state discovery and
checker behavior. Tactical `191` reuses that checker against the one direct
namespace and removes the step that converts recovered bytes back into
staging/publication ownership.

Ordinary restart may retain Tactical `120`'s structural fast-resume contract:
only synchronized, committed have evidence whose expected direct files still
match the accepted structure can skip payload hashing. Force recheck and any
structural disagreement use the common checker. A pre-sync crash may cause a
false negative and re-download/recheck; it must not cause a false positive.

Existing files are not blindly truncated during discovery or checking.
Torrent-declared prefixes participate in hashing and an oversized suffix is
preserved, matching the accepted Tactical `188` behavior. Unrelated siblings
are ignored. Expected-path type conflicts, unsafe links, concurrent active
writers for the same content paths, and incompatible root capabilities fail
with an actionable storage error rather than silent replacement or suffixing.

## Selective Files And Part Storage

File priority remains the policy boundary:

- wanted files write directly to final paths;
- skipped files are not materialized merely because they appear in metainfo;
- a piece spanning wanted and skipped files is still downloaded and verified
  as one protocol piece; and
- only the bytes that belong to skipped files may be retained in the bounded
  hash-owned part file when needed to verify or seed that boundary piece.

The part file remains lazy and auxiliary. It is not a staging namespace, is
never presented as user content, and does not hold bytes that belong in wanted
final files. Promoting a skipped file exports its verified boundary bytes from
part storage and writes future bytes to the final file. Lowering a file's
priority does not silently delete already materialized user-visible content.

Selected completion and whole-torrent seeding are different facts. The
product may call a torrent **Complete** when every wanted, non-padding byte is
verified and readable. It is **Seeding** only when the engine can serve all
protocol content required by that state. Neither transition includes a
publication phase.

## Deletion

The user-facing choices become **Keep downloaded files** and **Delete
downloaded files** (or equally plain platform-appropriate wording). Deletion
is an explicit destructive command, not proof that RSTorrent has exclusive
ownership of a directory.

Delete-data behavior:

- unlinks only exact metainfo-listed payload files and the exact validated
  hash-owned part artifact;
- prunes only expected directories that are empty after exact file removal;
- preserves oversized suffix policy only while content is kept; when the user
  explicitly deletes that metainfo file, the whole exact file is removed;
- never recursively removes a content root containing unrelated descendants;
  and
- never follows links or broadens deletion from a name prefix.

This retains Tactical `188`'s cleanup safety while removing the misleading
claim that payload is safe to delete because it is `managed`.

## Platform Contract

Path-backed storage opens and creates final files directly beneath the
validated absolute root.

Android SAF and qualified iOS roots preserve the same logical behavior even
though their locators and handles remain platform-owned capabilities. The
provider adapter must find-or-create each final document and expected parent
idempotently, avoid duplicate-directory races, perform positional
read/write/resize through the shared bounded handle pool, and report typed
root/path observations. It must not create a parallel staging document and
rename it when a selection finishes.

Provider rename is no longer a correctness boundary. Grant/bookmark loss,
provider replacement, exact-path ambiguity, and unsupported random-access or
durability semantics still fail closed and enter the existing repair flow.
Android remains a non-deferrable engine parity gate, and the maintained iOS
app must remove its publication-specific coordination and presentation in
the implementing tactical.

## Application And Presentation Contract

The application boundary should expose semantic facts that survive every
backend:

- whether a root is usable;
- whether expected files are missing, incomplete, checking, verified, or need
  repair;
- verified bytes/ranges and wanted completion;
- full seeding eligibility; and
- whether exact data deletion is supported for that root.

Tactical `191` removes storage-lifecycle values whose only purpose is the old
namespace transition, including `AwaitingPublication`, staging/prepared/
published storage states, publication progress/reasons, `NotPublished` media
availability, and `DeleteManaged`. Replacement types must describe the
remaining fact, not carry compatibility aliases or publication-era enum
variants.

First-party UI must not tell users that content is `published`, `not
published`, waiting for publication, or RSTorrent-managed. A file unavailable
because it is incomplete, unchecked, missing, or its root is unavailable
should say exactly that.

## Incubation State Transition

This accepted replacement intentionally uses the disposable `0.1.x`
application-state policy. Tactical `191` advances to a fresh schema epoch and
resets recognized schema-21 private catalog state rather than migrating
publication-era rows or preserving compatibility-only readers.

The bounded reset may remove only the fixed application database and its
sidecars. It must not delete, rename, import, or claim any external content:

- final-path files remain in place and are naturally recovered by re-adding
  the torrent and running the normal checker;
- legacy hidden staging and part artifacts remain untouched and untrusted;
  they are not silently promoted, deleted, or adopted by the new runtime; and
- any later cleanup/import tool for legacy hidden artifacts requires a
  separate explicit design because their ownership and user intent cannot be
  inferred after the catalog reset.

The fresh schema retains verified metainfo, selected root, selection,
verification generations, and synchronized have evidence in their direct-
storage forms. It does not retain a publication name, payload-publication
state, namespace action, or managed-deletion policy. Breaking generated
application-contract changes are accepted during incubation and land across
all first-party clients in the same tactical.

## Invariants

- Verified torrent bytes have one ordinary user-visible namespace beneath the
  selected root.
- Payload writes never depend on a torrent-wide completion rename.
- Existing bytes gain authority only through trusted synchronized resume
  evidence or piece hashing.
- A completed wanted file is usable independently of other selected files.
- Skipped-file boundary storage is lazy, bounded, hash-identified, and never a
  second content namespace.
- Direct storage preserves the existing positional I/O, durability ordering,
  cancellation/join, session fairness, and descriptor/request limits.
- Path and platform-capability adapters implement the same logical paths and
  verification decisions without serializing native capabilities.
- No automatic reset or ordinary cleanup deletes external payload or unknown
  legacy artifacts.
- No first-party user contract leaks the removed publication implementation.

## Non-Goals And Future Options

This decision does not add:

- a packed single-blob torrent backend for seed/archive use;
- a browser-style per-file temporary suffix such as `.part` or
  `.crdownload`;
- move-on-completion, category relocation, or cross-volume copy;
- preallocation as the default in place of sparse direct files;
- simultaneous-process writes to the same target.

Those can be considered later only as concrete independent capabilities. They
must not preserve a speculative generic publication layer now. In particular,
a future single-blob backend would be a distinct storage representation, and
a future per-file temporary suffix would need explicit partial-selection,
external-reader, collision, crash, and rename semantics.

Tactical [`193`](../tactical/193-stateless-foreground-downloader.md) implements
the stateless CLI without reopening publication. It
keeps wanted bytes on these direct paths, reuses the common checker, and adds a
narrow CLI-only auxiliary location for v1/hybrid skipped boundary bytes so a
fresh opaque owner cannot strand random part artifacts beside user payload.
Ordinary path storage retains adjacent owned parts; SAF and iOS are unchanged.
The same-user CLI lock is an operational exclusion fence, not a claim that the
storage model supports simultaneous writers.

Its controlled v1, pure-v2, and hybrid matrix verified complete, partial,
same-length corrupt, selective boundary, graceful interruption, and forced-
death recovery cases. The largest transient part artifact was 33,792 bytes;
joined and next-run cleanup left no CLI workspace or profile artifact.

## Landed Evidence And Next Work

Tactical `191` records the exact deterministic, crash, pinned-libtorrent,
production-browser, Android API 34, iOS simulator/archive, and physical-iPhone
evidence. The controlled browser and physical iOS cases both opened a verified
direct file while the rest of the selected torrent was incomplete, then
removed only exact torrent paths while preserving or independently observing
the surrounding root.

Future packed storage, temporary suffixes, relocation, and legacy-artifact
cleanup remain separate capabilities. No follow-up storage representation is
implied by completion of this direct model.
