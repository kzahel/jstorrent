# Tactical 241: Atomic Legacy Desktop Import

Status: **Complete local implementation and validation, 2026-09-30.**
Installed legacy replacement and production graduation remain open.

Owners: `desktop-jstorrent-replacement`, `client-persistence`, `download-roots`,
`direct-filesystem-storage`, `capability-readiness` and campaign 231.

## Outcome And Boundary

Implement the selected one-shot import of the released desktop v0.2.1 native
KV/session format into a fresh or current-schema destination. Import roots,
validated sources/cached metadata, Normal/Skip selection and run intent in one
SQLite transaction with one completion marker. Existing destination torrents,
settings and default root win. Record skipped source records without aborting
valid records; a destination failure rolls back all imported state.

Dependencies: 233 supplies independently authored released-writer fixtures;
191 supplies direct-path adoption and verification; 232 supplies desktop owner
and startup. No source schema, source database or payload is rewritten.

Non-goals: older RSTorrent schema conversion, browser-only legacy stores,
Android state import, a conflict UI, historical counters, arbitrary legacy
settings parity, production identities/signing/publication, extension rollout,
or a fully qualified installed JSTorrent replacement. Importer startup is gated
to the future `com.jstorrent.desktop` identity; incubation builds never discover
personal legacy state. No personal migration runs during implementation.

## Contract And Resource Bounds

- Source discovery uses the legacy OS config directory and `rpc-info.json`;
  profile IDs and every source path are validated before traversal.
- Source SQLite backups include WAL and are retained privately. Discovery is
  retained only as profile/root metadata, excluding tokens and endpoints.
- Source limits: 1 MiB discovery, 16 profiles, 4,096 torrent records total,
  32 MiB per logical source SQLite database, 8 MiB decoded metainfo and 64 MiB
  total prepared source bytes. KV reads check encoded length before allocation.
  Destination roots retain the ordinary 32-root cap; bounded per-record
  outcomes are saved with the one completion marker.
- Validate exact info hashes and metadata. Never copy bitfields, completion,
  peer/DHT caches, process authority or historical counters into engine state.
- Existing destination identity means skip unchanged, even at another path.
  Conflicting legacy-only copies are skipped with a visible reason. Matching
  copies coalesce deterministically. No payload is copied or deleted.
- Source validation finishes before a single immediate destination transaction.
  A fresh schema, settings, roots, torrents, pending verification and the marker
  commit together. Schema-zero files with no tables are safe pre-commit retry
  residue; populated schema-zero and older/future catalogs are refused. Failure
  before commit is retryable from unchanged source. Completion is checked before
  discovery on later starts, including after user removal of imported records.
- Imported metadata starts with empty have evidence and a pending ordinary
  full-check generation. Active/queued intent becomes ordinary running intent;
  stopped remains paused; awaiting selection remains held. No engine exists
  during catalog conversion. The normal checker owns subsequent progress.
- A current destination is opened strictly without the incubation old-schema
  reset. The marker is an optional migration-owned singleton table in schema
  26, created inside the import transaction; core catalog shape is unchanged.

## Owners And Dependencies

The desktop startup adapter owns source location, legacy-process refusal and
invocation before application startup. The session store owns source decoding
and the sole destination transaction. A focused nested store module reuses
existing private metainfo/intake/identity helpers without exporting SQL details
or adding protocol-to-platform dependencies. Snapshot database handles are scoped and closed before commit; temporary
source directories are owned by the plan and removed after the operation; no detached task is added.
Source-read/snapshot operations have bounded size and busy deadlines. Installed
handoff must fence legacy relaunches before production qualification; liveness
refusal in this slice does not prove that future production fence.

Android import is inapplicable: this reads desktop paths and the released
desktop host's KV schema, not Android private files or SAF grants. Shared
engine/checker behavior and generated application contracts are unchanged.

## Source-First Record

Normative input: SQLite [backup](https://sqlite.org/backup.html) and
[transaction](https://sqlite.org/lang_transaction.html) documentation; locally
pinned BEP 3 exact-info hashing and BEP 9 cached-info authentication.

Pinned libtorrent `7d7fc38fac61177fa5e02148f791b2f65250b09d`:
`src/torrent.cpp::on_resume_data_checked`, `src/read_resume_data.cpp`,
`test/test_read_resume.cpp::read_resume`, and
`test/test_checking.cpp::{incomplete,corrupt,force_recheck}`. Adopt normal
checking of existing bytes without trusted resume; preserve paused intent and
file selection. Deliberately do not import foreign bitfields/counters or flags
that bypass verification. Libtorrent does not define JSTorrent KV conversion.

Released JSTorrent `73427b7d3aef2eaf1c4ac1409922fbb52dff751d`, as pinned by 233:
`desktop/common/src/lib.rs::{RpcInfo,ProfileEntry,DownloadRoot,get_config_dir}`,
`desktop/host/src/kv_store.rs::KvStore::open`,
`desktop/host/src/rpc.rs::{check_profile_liveness,write_rpc_info}`,
`packages/client/src/host/host-channel-session-store.ts`,
`packages/engine/src/core/{session-persistence,torrent-state}.ts`,
`packages/engine/src/config/config-schema.ts`,
`packages/engine/test/core/session-persistence.test.ts`, and
`desktop/host/tests/profile_scenarios.rs`. Extract version-2 JSON index,
JSON-string-wrapped base64 binary values, source-qualified root keys, cached
info bytes, selection-before-metadata and active/stopped/queued/awaiting intent.
Native WAL must be backed up through SQLite, not copied as a lone file.
No reference source is copied; existing 233 fixture provenance remains intact.

## Validation And Stopping Condition

Required: Linux/Windows export cohort converted through real isolated SQLite;
cached metadata/magnet selection; existing destination duplicates at different
paths; settings/default preservation; malformed/oversized/missing inputs;
WAL-only source changes; unavailable roots; rollback after a partial mutation
and process exit at pre/post-commit boundaries; repeat after imported removal;
ordinary source-offline checking and deliberate corrupt content rejection.
Desktop startup identity/liveness gating is tested without personal discovery.
Run Rust fmt, workspace clippy/tests, and desktop compilation/tests proportionate
to the touched adapter. Reconcile topics and record exact commands/results.

Stop with the importer, protected startup hook and proportional local evidence
committed. Installed cross-platform legacy replacement, production host fencing,
support presentation and release/store operations remain campaign follow-ups.

## Execution And Evidence

- `crates/rstorrent-session/src/store/legacy_desktop.rs` owns the bounded
  decoder, WAL-aware source backup and atomic destination transaction. Schema
  creation reuses the existing store SQL through one transaction-taking helper.
  No core schema epoch or generated application type changes.
- Imports use the ordinary private metainfo/magnet intake and identity helpers.
  Cached magnet info retains the original magnet/trackers. Existing full-hash
  aliases win unchanged. Legacy-only copies at differing paths or run/selection
  intent are skipped; equivalent copies coalesce by stable profile/record order.
- Settings mapping is limited to DHT/PEX, peer and slot limits, encryption and
  transfer-rate policy. Unrepresentable/conflicting mapped values hold fresh
  imports, including pending metadata admission. Existing settings win. Other
  preferences, added time, history and runtime authority are omitted; broader
  privacy/background/notification parity remains a production gate.
- Stop/queued/awaiting-selection intent and Normal/Skip selection survive.
  Stopped pending magnets have no metadata admission rank until explicit Resume.
  Available metadata carries empty have and pending full-check generations.
  Missing roots retain repair bindings; startup uses `PreserveUnavailable`.
- The future production-only desktop hook runs before application startup,
  refuses reachable legacy hosts, and displays bounded skipped/attention counts
  or a source-preservation error. Incubation does not discover personal sources.
  The relaunch fence required by the importer remains an installed production
  handoff gate; a localhost liveness probe alone does not establish exclusivity.

Final macOS local commands (after `source ~/.profile`):

- `cargo fmt --all -- --check`: pass.
- `cargo clippy --workspace -- -D warnings`: pass.
- `cargo test --workspace`: pass; final `cargo test --workspace --quiet` also
  passes after the last contract tests. Session library: 368 passed, two existing
  ignored; desktop library: 57 passed, including three startup-gate tests.
- `cargo test -p rstorrent-session legacy_desktop -- --nocapture`: 15 passed
  before the final two contract cases; all 17 importer cases pass in the final
  workspace run, including the subprocess-only helper.
- `cargo check -p rstorrent-desktop`: pass.
- `git diff --check`: pass.

The Linux/Windows released-export cohorts each account for seven profiles and
all eight records: three imports and five conflicting shared copies skipped,
with no trusted have. Additional isolated cases cover cached metadata, current
owners at different paths, an unset existing default, unchanged settings,
malformed/oversized/hash-mismatched records, WAL-only settings, missing roots,
live hosts, invalid profile IDs and old/future destination refusal. Triggered
partial destination failure rolls back roots/torrents/marker. Process exits
immediately before/after commit prove all-or-none schema/settings/library state
and stable retry of a legacy rate limit. Removal followed by repeat import does
not resurrect records. Reversing source order yields identical coalescing reports.
An ordinary loopback-only application checker reuses independently authored good
bytes, rejects a deliberate same-length corruption and preserves paused intent
and exact payload bytes. Fixture prepared sources stay below 1 KiB; the importer
adds no engine hot-path state or long-lived task.

No personal migration, visible product launch, external swarm, publication,
Android adapter change or generated-contract/web change ran. Owned temporary
crash snapshots were removed; subprocess temporary paths now stay within their
fixture owner. Installed Windows/Linux/macOS migration, broader source releases,
legacy relaunch fencing and support/privacy qualification remain unclaimed.

Restart checkpoint: this bounded slice is done. Campaign 231 next qualifies
installed legacy handoff and the support/privacy/release boundaries, then
rehearses production replacement under its separate authority.
