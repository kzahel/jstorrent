# Tactical 391: PlaysVideo Download Manifests

Status: planned, 2026-11-08.

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
  commands use. PlaysVideo appends it to the magnet as `so=<index>`. BEP 47
  padding files are omitted from `files` and keep their place in the index
  sequence.
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
  one. It never carries the host's own address (`x.pe`), which is what the
  share link adds. For **private torrents** the sidecar carries `xt` and `dn`
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

## Evidence

Pending.
