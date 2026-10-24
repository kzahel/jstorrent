# Legacy Desktop Fixture Cohort

Status: **Complete: bounded Linux/Windows fixture preparation, 2026-09-29.**

Owners: [desktop replacement](../topics/desktop-jstorrent-replacement.md),
[campaign 231](231-jstorrent-migration-working-campaign.md),
[client persistence](../topics/client-persistence.md), and
[direct storage](../topics/direct-filesystem-storage.md).

## Outcome And Boundary

Prepare reproducible, nonpersonal source libraries for M-02 through pinned
legacy writers. Document a deterministic proposed union/conflict contract.
Stop when the chosen released cohort has independently checked snapshots,
payload hashes, provenance and per-record expected outcomes. Importer code,
production identities/routes, live-user migration, activation, rollback and
macOS execution are not part of this preparation slice.

Dependencies: Tactical 232 owns successor control and Rehearsal A; this work
may prepare legacy input independently but cannot claim Rehearsal B without an
importer and its held-state, interruption, verification and rollback gates.

## Pinned Sources And Artifacts

Initial baseline is one released cohort, not a claim about all installed users:

- Desktop tag `tauri-app-v0.2.1`, commit
  `73427b7d3aef2eaf1c4ac1409922fbb52dff751d`, published 2026-03-14.
- Extension tag `extension-v1.1.1`, commit
  `8584dce61e63607f47877a71779c28686aeb411b`.
- GitHub release metadata advertises Linux `JSTorrent_0.2.1_amd64.deb`,
  17,676,044 bytes, SHA-256
  `439248081a4fc3f2fc0fc380e3913421be3a7c3b16576e5cf54938c3aa87b22b`;
  Windows `JSTorrent_0.2.1_x64-setup.exe`, 10,662,592 bytes, SHA-256
  `55ce6c119e3ada6b66da3f706e4659aa50f0550fea84d56757ba7180f51047c3`.
  All downloaded lengths and SHA-256 values match on the Linux builder.
- Released `jstorrent-extension.zip`: 4,187,576 bytes, SHA-256
  `9366af2f2443d2e50b9ebf5c6b8f3097c8e96c51e386a2779e6896ee149812b6`;
  downloaded bytes verified against release metadata.

Source review at the desktop tag: `desktop/host/src/kv_store.rs` opens SQLite
with WAL and a five-second busy timeout; native host and Tauri sidecar can
share writers. `desktop/host/src/rpc.rs` preserves roots when startup supplies
None and qualifies profile ownership by profile ID. Its discovery file also
contains runtime authority and must not be copied into public fixtures.
`desktop/host/tests/profile_scenarios.rs` exercises real host/IO processes;
`packages/engine/test/core/session-persistence.test.ts` covers the actual
version-2 session writer, stopped/active intent and JSON encoding. This is
source review, not execution evidence. Reference code remains in its own
checkout; independently authored fixture drivers invoke it rather than copy it.

## Fixture And Resource Contract

Use only generated metainfo/payload in a task-owned guest directory. Maximum
16 profiles, 64 records, 64 MiB total payload, 16 MiB per source database and
8 MiB per decoded metainfo; reject oversize before decoding or allocation.
Never discover or read a personal library. Keep profile IDs and root keys
source-qualified in the expected manifest. Exercise disjoint records,
identical duplicates, different-location duplicates, conflicting stopped/run
intent and selection, colliding root keys, Unicode names, unavailable roots,
complete/partial bytes and pending magnets. Malformed variants derive from a
retained valid writer-produced snapshot and are labeled synthetic mutations.

Quiesce and join every owned old engine/host before snapshot. Use SQLite's
backup API, run integrity_check on the backup, and enumerate expected keys;
never copy a live database while omitting WAL. Retain the original snapshot
unchanged, record source artifact and snapshot SHA-256, and independently hash
payload. Redact authority and runtime discovery into a closed, non-authorizing
manifest; never commit native tokens, paths tied to a real deployment, browser
profiles or generated binaries. Disposable source processes and controls have
bounded deadlines and explicit teardown, restoring inherited guest state.

## Proposed Union Rules For The Importer Design Checkpoint

These refine the accepted one-library direction; they are not importer behavior:

- Validate identity from metainfo/magnet, then group matching validated torrent
  identities. Never group by display name or trust a source completion bit.
- Resolve each root through its source profile before mapping locations.
  Identical root keys across profiles do not establish equal locations.
- Same identity and unambiguous same payload location may coalesce. Distinct
  locations preserve every payload and hold a visible location conflict.
  Do not copy, delete, choose by modification time or activate either copy.
- Preserve per-source run intent and selection in provenance. Conflicting
  intent/selection remains held for repair; no arbitrary source precedence or
  union of selected files that silently broadens download activity.
- One resulting settings set uses only an explicit equivalent-field mapping.
  Conflicts retain a visible disposition and conservative inactive defaults;
  privacy/transmission permissions cannot be widened by another profile.
- Historical counters are not summed across duplicates and never enter newly
  measured engine totals or seed-goal admission. Preserve only explicitly
  supported history with provenance; otherwise report it as unsupported.
- Retry identity includes all contributing source snapshot/record identities.
  Enumeration order must not change the union, outcomes or destination IDs.
  Every source is accounted for as unique, coalesced, conflicting or skipped.

Final queue normalization, field mappings, conflict-repair UX and activation
policy belong to the bounded importer tactical before implementation.

## Execution And Evidence

The Linux deb and Windows NSIS were extracted in controlled layouts; production
JSTorrent was never installed or registered. Released native host/IO binaries
ran only inside the claimed guests with an explicit isolated config directory.
`--launcher tauri` avoids the Chrome launcher update behavior. The independently
authored TypeScript driver invokes actual BtEngine intake/recheck,
SessionPersistence and HostChannelSessionStore from the pinned source. A
recording channel carries those values to the real native-host KV operations;
every KV write is read back. This exercises actual persistence writers, not a
legacy GUI or packaged-extension end-to-end qualification.

[`generate-legacy-desktop-records.mts`](../../scripts/generate-legacy-desktop-records.mts)
and [`legacy_desktop_fixture_cohort.py`](../../tests/interop/legacy_desktop_fixture_cohort.py)
produce the cohort. The latter refuses any native binary or prepared source
tree hash outside the pinned contract. Prepared tree SHA-256:
`4e7b3aaeee42e454f82c89dd1e4ee500d7ee649e74d1df33230c85e8cb4cc2a9`.
The archive uses the pinned geo-data stub fallback, tsx 4.20.6 and bn.js 5.2.2.
No reference implementation source was copied into this repository.

| Profile | Writer-produced records and retained bytes | Proposed interpretation |
| --- | --- | --- |
| empty | Empty version-2 torrent list | No destination records |
| alpha | Stopped complete two-piece shared torrent | Same-location subgroup with same |
| same | Same identity and physical location as alpha | Coalesce provenance, not historical counters |
| conflict | Same identity, another location, active intent, one of two pieces | Hold location/intent conflict |
| disjoint | Complete Unicode single file and stopped pending magnet | Unique inactive/reverify and held metadata |
| unavailable | Complete shared torrent, then controlled root renamed offline | Preserve source; hold missing location |
| multifile | Shared torrent at a distinct location plus Unicode selected file and skipped missing file | Hold duplicate location; preserve selective intent for unique torrent |

Each platform has seven profiles, eight records and four validated identities.
The retained payload occupies 163,840 bytes; nine SQLite snapshots occupy
110,592 bytes. Two extra snapshots are explicitly synthetic: a root-key
collision derived from conflict and invalid state JSON derived from alpha.
Their original hashes and proposed visible dispositions remain in the manifest.
No valid snapshot is modified to create these variants.

Checked-in [JSON exports and manifests](../../tests/fixtures/legacy-desktop-v0.2.1/README.md)
contain only session KV values and generated provenance. Per-platform manifests
record every original closed SQLite SHA-256 and source-to-union expectation.
Closed SQLite/payload cohorts are retained in the local handoff store outside
Git; live discovery/config/authority and logs were removed with guest cleanup.
Random legacy IDs and timestamps make fresh generation logically reproducible,
not byte-identical.

Validation on both guests: old host EOF exit and reader join, SQLite backup,
explicit connection close, integrity_check, exact key/value readback and payload
SHA-256. A Windows Unicode validation failure exposed implicit Python text
encoding; all fixture JSON reads now specify UTF-8. Independent export validation
also caught hashing before SQLite connection closure (the Python connection
context only commits). Explicit closing now precedes every snapshot digest;
both cohorts were regenerated and checked as immutable standalone databases,
without relying on WAL companions.

The builder's independent
[`verify_legacy_desktop_fixtures.py`](../../tests/interop/verify_legacy_desktop_fixtures.py)
passes on committed exports and with both retained closed cohorts. Libtorrent
2.0.11 independently decodes metainfo identities and hashes each available piece;
source bitfields exactly match complete, partial and selective bytes. Missing
root, pending magnet, root collision and malformed JSON expectations also pass.
Python compilation and git diff --check pass. No importer is invoked by these
checks and no imported content is claimed verified.

## Remaining Gates And Next Action

This is one released desktop writer cohort. The separately pinned extension
release is downloaded/provenance-checked but its browser storage/profile writer
has not been executed. Roots are retained in the closed portable manifest; raw
runtime discovery (including authority) is deliberately absent. A future
importer discovery/parser fixture must preserve that separate schema with
explicit authority redaction before claiming discovery-file compatibility. Additional installed versions, browser persistence
variants, unsupported settings/history mappings, old packaged GUI journeys and
macOS need their own evidence before claiming supported migration coverage.

Use these fixtures to finalize the bounded importer preview, source-qualified
root union, visible conflict/unsupported dispositions, interruption/retry,
held activation and rollback contract before implementation. Rehearsals B/C,
production delivery and personal migration remain unstarted.

