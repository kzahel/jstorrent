# Tactical 391: PlaysVideo Download Manifests

Status: implemented, 2026-11-08. Slices 1–3 landed in one commit with
deterministic Rust, web and localization evidence. Open: the Android build and
API 35 SAF instrumentation run (blocked locally by an upstream Gradle
distribution outage), and slice 4's physical cross-product check.

Topics: `android-jstorrent-replacement`, `direct-filesystem-storage`,
`android-saf-storage`, `download-roots`, `durable-data-migrations`.

## Trigger, scope and stopping condition

PlaysVideo (`~/code/playsvideo`) is a local video player that syncs watch
progress across a user's devices. When it scans a folder it reads the
`.<infohash>.jstorrent.json` sidecar that legacy JSTorrent
(`../jstorrent-typescript`) wrote beside each download. That is the only way
it learns a file's magnet, info hash and file index. With them, a video
started on one device offers "Download required" plus the magnet (with
`so=<index>`) on another device, and resumes once the download lands.

The current JSTorrent never writes the sidecar.
[`android-jstorrent-replacement`](../topics/android-jstorrent-replacement.md)
records it as a parity gap (Download manifest integration; Advanced settings
"Download manifest"; queue item 6) pending "a supported consumer". On
2026-11-08 the maintainer watched a JSTorrent Android download in PlaysVideo
on a phone, then could not resume it on desktop. The synced record carried
only a `file:<name>|<size>` identity and no magnet. PlaysVideo is the
supported consumer, and the maintainer asked to restore the sidecar.

Scope:

- Write the legacy-compatible sidecar for every torrent whose storage is
  prepared, on path roots (desktop, headless, CLI) and Android SAF roots.
- Keep it current as file completion changes, recheck, selection changes, and
  across restarts. Startup reconciliation writes sidecars for torrents
  downloaded before this feature.
- Delete it exactly under **Delete data**; leave it under **Keep data**.
- Add a global engine setting, **on by default**, with web and Android
  toggles.

Stopping condition: a torrent downloaded by JSTorrent Android and played in
PlaysVideo on that phone appears in PlaysVideo on desktop with its magnet,
info hash and file index, and opening the magnet in desktop JSTorrent and
then scanning the folder resumes at the synced position. The same check
passes for a desktop download. Topics and the migration ledger are updated.

## Non-goals

- No change to PlaysVideo. The file contract is the one it already parses.
- No sidecar for pure BitTorrent v2 torrents in this slice (see Contract).
- No new remote or application API surface. No change to how the media
  Library is derived; it comes from metainfo and never reads the sidecar.
- No cleanup of stale or legacy sidecars when the setting is off, when a
  torrent is removed with Keep data, or for torrents the host does not know.
  This matches the no-automatic-cleanup rule in
  [`direct-filesystem-storage`](../topics/direct-filesystem-storage.md).
- No import of the legacy `downloadManifest` preference (see Settings).
- No relocate handling, because relocation is not implemented. When it is,
  it must move the sidecar with the payload.

## File contract (frozen by the existing consumer)

The legacy writer in
`../jstorrent-typescript/packages/engine/src/core/manifest-writer.ts` and the
reader in `~/code/playsvideo/app/src/folder-provider.ts` (`MANIFEST_PATTERN`,
`readManifest`) and `app/src/scanning/catalog-reconciliation.ts`
(`buildScannedCatalogRecords`) define it:

- **Filename:** `.<v1 infohash, 40 lowercase hex>.jstorrent.json`. PlaysVideo
  matches `^\.[0-9a-f]{40}\.jstorrent\.json$` (case-insensitive).
- **Location:**
  - Single-file torrent (`File` shape): the download root, beside the
    payload.
  - Multi-file torrent (`Tree` shape): inside the content directory
    `<root>/<name>/`.
- **Body:** UTF-8 JSON
  `{ "infohash": string, "magnet": string, "files": { "<relpath>": { "index": number, "complete": boolean } } }`.
  - `relpath` is relative to the sidecar's directory, joined with `/`: the
    payload name for single-file torrents, and the components below the
    content directory for multi-file ones.
  - PlaysVideo discards the file if the JSON does not parse or lacks
    `infohash` or `files`. It treats a missing payload with a sidecar entry as
    a download-required virtual record, and reads `complete` as "fully
    downloaded".
- **`index`** is the metainfo file index, the same number the engine's BEP 53
  `so=` parser (`rstorrent-protocol/src/magnet.rs`) and file-priority
  commands use. PlaysVideo appends it to the magnet as `so=<index>`. For v1
  torrents, BEP 47 padding files are omitted from `files` and keep their
  place in the index sequence. Hybrid torrents use the engine's v2 file-tree
  index space, which has no padding entries; it is the same space the
  engine's `so=` and share exports use.
- **`complete`** is true only for a wanted, non-padding file whose every
  piece is verified and durable, with no verification pending and the
  torrent not Checking, NeedsRepair or Error. This is the
  `platform_file_plan` predicate in `rstorrent-session/src/application.rs`
  plus `FileSelection::is_wanted`. Skipped files are false even when their
  pieces verify, because their boundary bytes live in the part file.
  Zero-length wanted files are true. Never present unverified data as
  complete.
- **`magnet`:** the base export from `SessionStore::export_base_magnet`. It
  is the verified retained source magnet, or a synthesized `xt`/`dn`/`tr`
  one. Every `x.pe`, `so` and `xl` parameter is stripped, as the share path
  does, so no peer address (including another host's, from a share link the
  user opened) reaches PlaysVideo's cloud sync. For **private torrents** the sidecar carries `xt` and `dn`
  only. Tracker URLs there often embed passkeys, and PlaysVideo syncs this
  field to a cloud account. This differs deliberately from legacy, which
  always included announce URLs.
- **Info hash versions:**
  - v1 and hybrid torrents use the v1 hex for the filename and `infohash`.
    The magnet keeps both `xt` identities.
  - Pure v2 torrents have no 40-hex identity that PlaysVideo accepts, so they
    get no sidecar. Supporting them later needs a coordinated PlaysVideo
    pattern change (64-hex `btmh`).

## Design

### Owner, task and cancellation map

Add a `DownloadManifestWriter` owned by `ApplicationService`, modeled on
`ProductMilestoneDrain` (`application.rs`): an `Arc<Notify>` wake, a
`CancellationToken`, one `JoinHandle`, and all I/O on `spawn_blocking`.

- **State:** a dirty set of `TorrentId`s, plus a per-torrent fingerprint of
  the last written body (the magnet plus the set of complete file indices).
  It holds no other state; everything else is read from the store when a
  write happens.
- **Wakes (mark dirty):**
  - `storage_prepared` and `storage_discovered`. This is the first write. It
    is never written at metadata-verified time, because a metadata-only or
    pending-selection add must not create artifacts (`download-roots`).
  - `pieces_durable`, only when the batch completes a file or the torrent.
  - `have_rechecked`, `pieces_invalidated`, file priority or selection
    changes, and `mark_complete`.
  - The setting turning on.
  - Startup reconciliation: one pass over torrents with prepared storage
    after the store opens.
- **Work:** for each dirty torrent:
  1. Load the resume record and layout.
  2. Build the body, compare its fingerprint, and write only if it changed.
  3. Enforce a per-torrent minimum interval of 2 s between writes.
  4. Process one torrent at a time, so at most one sidecar write is in
     flight.
- **Cancellation:** a removal clears the torrent's dirty entry before
  `drive_removal` deletes artifacts, and the writer re-checks that the
  torrent still exists before it writes. Shutdown drains pending writes
  under a 2 s budget before `storage_file_pool.shutdown()` in
  `shutdown_with`, then abandons the rest. Startup reconciliation recreates
  anything missed. `Drop` aborts the task.

### Writing

- **Path roots:**
  - Write `.<hash>.jstorrent.json.tmp` in the target directory, fsync it, and
    rename it over the sidecar.
  - Do not mark the sidecar as internet-origin; it is generated locally.
  - Path resolution reuses `torrent_storage_paths` and validates every
    component like payload paths. Traversal, symlinked parents and special
    objects fail closed (`direct-filesystem-storage`).
  - A leftover `.tmp` from a crash is overwritten by the next write.
- **SAF:**
  - SAF has no rename, and `createDocument` silently renames on collision. So
    the sidecar is find-or-create, then truncate and rewrite in place, with
    the document opened in `"rwt"` mode plus an explicit `set_len` (some
    providers ignore `t`). A concurrent reader can see a torn file;
    PlaysVideo discards it and picks the sidecar up on its next scan.
  - Add `StorageFileRole::DownloadManifest` and the matching
    `SafDynamicFileRole` in `rstorrent-android` (and the iOS mapping) for
    this purpose.
  - `ProductSafDocuments.openDynamic` and `deleteDynamic` accept the new
    role. Payload roles keep non-truncating `"rw"`.
- **Collisions:**
  - If any payload's path relative to the sidecar directory equals the
    sidecar or temp name, skip that torrent's sidecar and record a
    diagnostic. A torrent is never rejected over this.
  - An existing file at the exact sidecar name for the torrent's own info
    hash is a legacy or earlier sidecar for the same torrent, and it is
    replaced.
- **Failures:** sidecar writing is best effort. Missing or unwritable roots,
  provider errors and permission loss record a bounded diagnostic and never
  change torrent state, error a download, or block removal or shutdown.

### Removal

- **Delete data:**
  - Path roots: `direct_payload_manifest` and `delete_path_artifacts` delete
    the exact sidecar and `.tmp` names before `remove_empty_payload_directory`
    runs. Otherwise a multi-file content directory would be left behind.
  - SAF: `PlatformRemovalPlan`, `platform_removal_plan` and Kotlin
    `deleteDataArtifacts` (which hard-codes the part name today) gain the same
    exact names.
  - A missing sidecar is success.
- **Keep data:** sidecar untouched, matching the rule that Keep does not
  alter artifacts. Its last state stays accurate for the kept files. This
  differs deliberately from legacy, which deleted on every removal. A kept
  download should keep its magnet visible to PlaysVideo.
- **CancelPendingAdd:** nothing was written, so nothing is deleted.

### Settings

- Add `ClientSettings.write_download_manifests: bool`, default `true`, with a
  serde default and a `ClientSettingsPatch` field.
- Persistence: append a `session.db` migration step that adds the column with
  default 1 to existing rows. Add a released-store fixture test, a ledger row
  in [`durable-data-migrations`](../topics/durable-data-migrations.md), and
  the schema bump in `distribution/desktop-compatibility.json`.
- Gate the patch key behind a new host capability in
  `rstorrent-session/src/host_capabilities.rs`. Regenerate the web contract.
  Clients hide the toggle for hosts without the capability.
- Web: one toggle in the storage or file settings section.
  - Label: "Write PlaysVideo manifest files".
  - Help: "Saves a small hidden .jstorrent.json file beside each download so
    PlaysVideo can resume it on your other devices."
  - Android gets the same toggle in Advanced (strings localized through the
    existing catalog workflow).
- Off stops all writes and leaves existing sidecars. On marks every torrent
  with prepared storage dirty.
- Legacy `config:downloadManifest` (old Android `jstorrent_kv.db`, old
  desktop config) is **not imported**. Legacy defaulted it off, and a stored
  value mostly means "never revisited", so importing it would disable the
  feature for exactly the users PlaysVideo integration served. Record this in
  [`docs/migration/README.md`](../migration/README.md).

## Resource limits

- Bodies with more than 10,000 non-padding files are not written; a
  diagnostic is recorded instead. 10,000 entries are well under 2 MiB of
  JSON.
- Writes per torrent are change-driven: only when a file's completion flips
  or the magnet changes. They are also rate-limited to one per 2 s, so a
  torrent writes at most once per completed file plus once per recheck.
- One write in flight host-wide. The dirty set is bounded by the torrent
  count.
- No extra reads of payload data. Completion comes from the stored `have`
  bitfield and layout.

## Reference study

No BitTorrent reference client writes a per-download metadata sidecar for
other apps. The nearest analogue is qBittorrent's "Copy .torrent files for
finished downloads to", an opt-in export to a separate folder; it informs
nothing beyond confirming that this is application policy, not protocol.
The behavioral reference is legacy JSTorrent:

- `manifest-writer.ts`, plus its tests `test/core/manifest-writer.test.ts`
  and `recheck-manifest.test.ts`.
- `bt-engine.ts`: write at metadata-ready and completion, debounced 1 s on
  piece completion, flush at shutdown, delete on removal.
- `config-schema.ts`: `downloadManifest`, default false.

Adopted: filename, location, body, write points and atomic replacement.
Changed, each recorded above:

- default on;
- Keep data preserves the sidecar;
- private torrents omit trackers;
- the first write waits for storage preparation;
- writes are change-driven instead of every second;
- pure v2 torrents are excluded;
- the file count is capped.

## Edge cases

- Magnet adds: no sidecar until metadata, selection and storage preparation.
  After that the magnet is the retained source magnet.
- Selective download: skipped files are listed with `complete: false`. A file
  newly selected later turns complete in a later write.
- Recheck that loses pieces: `complete` flips back to false.
- Payload deleted outside JSTorrent: the engine's state drives the body. The
  next recheck corrects it, and PlaysVideo's own "no local file" logic
  handles the gap.
- Root unavailable, SAF permission revoked, or a removable volume gone: skip
  with a diagnostic, and retry at the next wake or startup.
- Torrent name or path components with hostile names: the existing
  validation rejects the torrent before storage. The sidecar adds no new
  component except its own fixed-form name.
- Two torrents sharing a root: distinct info hashes give distinct sidecar
  names. Two torrents sharing a content directory (same name) each write
  their own sidecar there.
- Same info hash in legacy JSTorrent and the current app (migrated
  downloads): the current app overwrites the legacy sidecar with an
  equivalent body.

## Slices

1. **Core and path roots.**
   - A pure body builder: layout + `have` + selection + state + magnet + info
     hashes → body or skip reason. Unit tests cover single-file, multi-file,
     padding, skipped, zero-length, hybrid, pure v2, private, collision and
     the cap.
   - The writer task, path-root atomic write, and Delete data handling.
   - Application tests: headless download of a local fixture, the sidecar
     appearing and flipping `complete`, recheck, Keep vs Delete with folder
     pruning, restart reconciliation, and shutdown drain.
   - Ships behind the setting's default; the setting lands in slice 3 before
     any release.
2. **Android SAF.**
   - The new storage role through the Rust and Kotlin boundary, `"rwt"`
     rewrite with a shorter body, and SAF Delete data.
   - Extend the API 35 SAF lifecycle instrumentation test.
   - iOS: the role mapping compiles and maps to the same semantics; behavior
     evidence is deferred with iOS storage.
3. **Setting.** Contract, migration and fixture, capability, generated
   contract, web and Android toggles, localization, and contract-compatibility
   tests.
4. **Cross-product evidence and docs.**
   - Desktop: download a small public-domain video torrent, scan the folder
     in PlaysVideo, and see the magnet in its catalog.
   - Physical Android (the trigger scenario): JSTorrent Android download →
     PlaysVideo on the phone → PlaysVideo on desktop shows the magnet → open
     it in desktop JSTorrent → resume at the synced position.
   - Update `android-jstorrent-replacement` (rows at the parity gap, the
     Advanced settings table and queue item 6), `direct-filesystem-storage`
     and `download-roots` (new engine-owned artifact, delete and keep
     semantics), `android-saf-storage` (in-place truncate role), and the
     migration docs.

## Validation

- `cargo fmt --all -- --check`, `cargo clippy --workspace -- -D warnings`,
  `cargo test --workspace`.
- `npm run generate`, `npm run typecheck` and `npm run test` with
  `--prefix clients/web` (slice 3).
- Android build, JVM tests and the API 35 SAF lifecycle instrumentation test
  (slices 2–3).
- Released-store fixture for the new migration step. Web
  contract-compatibility and released-host tests for the capability-gated
  patch key.
- Slice 4 manual cross-product runs, recorded under Evidence.

## Implementation notes

What landed, and where it differs from the plan above:

- **Owner.** `crates/rstorrent-session/src/download_manifest.rs` holds the
  pure `build_manifest`, the path and platform writers, and
  `DownloadManifestWriter`. A `DownloadManifestQueue` handle is shared with
  each `StoreCheckpointSink`. `ApplicationService` publishes every storage-root
  change to the writer; a root that becomes available (Android registers SAF
  roots after open) re-runs reconciliation.
- **Change detection.** Every `pieces_durable` batch marks the torrent dirty
  instead of only batches that complete a file. Writes stay change-driven
  because the per-torrent 2 s interval coalesces marks and the body
  fingerprint suppresses identical writes. The cost is at most one plan per
  torrent per 2 s while it downloads. A plan loads the resume record under
  the session-store lock (the checkpoint sink already does this per batch)
  and parses metainfo after releasing it. `storage_discovered` marks only
  after the recheck generation is durable.
- **No-op writes.** Before writing, both writers compare against the existing
  sidecar and skip identical bytes. Startup reconciliation therefore does not
  touch unchanged files or bump their mtime.
- **Sticky rejections.** Pure v2, over-cap, reserved-name and unparsable
  layouts are remembered per torrent, so their metainfo is not parsed again
  until a removal forgets the torrent.
- **Eligibility.** A torrent is written once storage was prepared in this
  process, or once it holds any verified piece (startup reconciliation).
  Torrents with a removal record or an unavailable root are skipped.
- **Content path (review P1).** The sidecar waits until the payload path
  exists: the single file, or `<root>/<name>/` for a tree. Payload storage is
  lazy. Creating the content directory early would turn fresh storage into
  existing storage and force a recheck on every restart until the first piece
  landed, and a Keep data removal would leave a folder holding only the
  sidecar. A missing payload path is a silent deferral with no bookkeeping.
  The first durable piece follows the engine's first payload write and marks
  the torrent again. SAF observes the content path before opening the sidecar
  with create. A symlinked or wrong-kind content path is an error.
- **SAF open mode.** The role opens `"rw"`, like payload. The Rust writer
  truncates (`set_len`) immediately before writing, so a lost open response
  or an aborted shutdown drain cannot leave an empty sidecar. This replaces
  the plan's `"rwt"`.
- **Retry.** A failed write is retried once after 30 s, then at the next mark.
  A seeding torrent produces no marks and would otherwise stay stale until
  restart. A storage root that appears, or whose location changes, clears all
  fingerprints before reconciling.
- **Removal robustness.** Only a regular file at a sidecar name is deleted.
  A link or directory there is left alone and never fails Delete data, on
  path, SAF and iOS alike.
- **Cross-torrent names.** The collision check covers the torrent's own
  payload only. A different, crafted torrent in the same root or content
  directory whose payload is named `.<this hash>.jstorrent.json` would be
  overwritten by this torrent's sidecar, and deleted by its Delete data. This
  is a known limitation: it needs a deliberately crafted torrent, and it
  damages only that torrent's data.
- **Root health.** The storage file pool does not record
  `DownloadManifest`-role failures as root failures, so a sidecar error can
  never move torrents to awaiting storage.
- **Removal fence.** `drive_removal` calls `quiesce` after pausing: it forgets
  the torrent and waits for any in-flight write before deletion. A per-forget
  epoch stops an overlapping write from restoring bookkeeping.
  `PlatformRemovalPlan.download_manifests` (Android `SafRemovalPlan`, iOS
  `IosRemovalPlan`) carries both the sidecar and `.tmp` names.
- **iOS.** The role maps to `IosDynamicFileRole.DownloadManifest`. The Rust
  writer truncates explicitly, so the Swift bridge's non-truncating open is
  correct. `PlatformStorageBridge.removeData` deletes the sidecars before
  pruning. Behavior evidence stays deferred with iOS storage.
- **Mixed versions.** Capability `download_manifests` (ID 7) owns the
  `write_download_manifests` patch key. Released strict clients (extension
  1.1.4 and older) reject unknown `ClientSettings` fields, so the field is a
  reviewed client exposure in `clients/web/src/api/release-compatibility.json`.
  **The next host release needs an accepted break that names it.**
- **Schema.** Step 29 → 30 adds the column with default 1, so upgraded
  profiles are on. The private Tactical 377 qualification probe moved from
  29 → 30 to 30 → 31.
- **Copy.** Web shows a PlaysVideo section in Settings → Downloads; Android
  shows a PlaysVideo section in Advanced. All 18 shipping non-English locales
  for both platforms were translated through `scripts/localization.py` and
  independently agent-reviewed. The review corrected help text that read as
  resuming the *download* rather than playback.

## Evidence

2026-11-08, macOS arm64:

- `cargo test --workspace` passes (1783 tests in 73 binaries before the
  review corrections). `cargo test -p rstorrent-session` passes after them.
  It includes 12 builder, writer, queue and fake-broker tests in
  `download_manifest::tests`, and 7 application tests in
  `application::tests::download_manifests`:
  - a real loopback peer download creates no sidecar while storage is
    prepared but empty, then writes `complete: true` with `x.pe` and `so`
    stripped from the magnet;
  - a prepared multi-file torrent with no payload creates no content
    directory and restarts without a recheck;
  - startup reconciliation writes a pre-existing complete torrent; a forced
    recheck after corruption flips it to `false`; a deleted sidecar is
    recreated by a restart that is shut down immediately (drain);
  - Delete data removes a multi-file sidecar and prunes the content
    directory; Keep data leaves the sidecar; Delete data waits while a write
    holds the gate;
  - the setting off writes nothing; turning it on reconciles; turning it off
    again leaves the file;
  - private torrents export `xt` and `dn` only.
- The SAF writer test runs against a fake platform broker. It covers
  deferral without creating anything, the identical-bytes skip, truncating
  to a shorter body, released pool handles, and a denied open that leaves
  root health untouched.
- Released-catalog fixtures v26 and v29 migrate to schema 30 with
  `write_download_manifests` on. `node scripts/desktop-compatibility.mjs` and
  the private-probe test pass.
- `cargo clippy --workspace --all-targets -- -D warnings` and
  `cargo fmt --all -- --check` are clean.
- `npm run generate`, `npm run typecheck` and `npm run test` in `clients/web`
  pass (986 tests, 3 skipped). These include released-host, old-client and
  capability-gating tests and the new settings section tests.
- `node scripts/check-localization.mjs` passes for every platform.
- An independent review session (YA, Opus 5.5 high) returned REVISE with one
  P1, two P2s and seven P3 findings. Each is corrected above, or recorded as
  a limitation (cross-torrent names) or as documentation (hybrid index space).
- Not run:
  - The Android build, JVM tests and API 35 SAF lifecycle run.
    `services.gradle.org` and GitHub release downloads returned 504 for the
    Gradle 8.11.1 wrapper, and this machine has no Gradle cache. The Kotlin
    changes and the new JVM tests still need that run.
  - iOS. No simulator runtime or iOS platform is installed in Xcode, so the
    Swift removal change is uncompiled.
- Slice 4 physical cross-product evidence (desktop and Android → PlaysVideo
  → other device) is pending.
