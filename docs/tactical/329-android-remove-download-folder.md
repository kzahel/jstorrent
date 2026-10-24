# Tactical 329: Android Remove Download Folder

Status: Complete locally, 2026-10-13. Engine tests, Rust and Android checks
and Pixel 9 evidence pass. No release is authorized by this tactical.

Topics: `android-saf-storage`, `android-jstorrent-replacement`

## Trigger

Android Storage settings offers `Forget <folder>` only for a folder that is
not current and that no torrent uses. Most users have one folder, which is
current, so there is no way to remove it. The engine refuses the other cases:
`remove_storage_root` (`crates/rstorrent-session/src/store.rs`) rejects the
default root and any root referenced by a retained torrent.

## Decision

Every folder row offers Remove. Removing a folder stops JSTorrent using it and
releases Android's access to it. By default no file is deleted.

- A folder no torrent uses is removed from the catalog and the registry.
- A folder torrents still use is detached. Its catalog row and torrent
  bindings stay. Those torrents enter the existing awaiting-storage state
  (`Folder unavailable`) and the folder row offers Repair. Choosing the same
  folder again, by Repair or by selecting it as the download folder, resumes
  them from their verified progress.
- If the removed folder was current, the first other available folder
  becomes current, and the confirmation names it. With no other usable
  folder there is no current folder, and the next add asks for one
  (Tactical `328`).
- The confirmation states how many torrents use the folder, including
  archived ones, and that files are not deleted. An unchecked option, `Also
  remove these torrents and delete their downloaded files`, removes those
  torrents with the existing Delete data path first, then removes the
  now-unused folder. It deletes only files the engine registered for those
  torrents, never the folder itself or unrelated content.

## Detach ordering

A naive grant release is not a stop. Rust duplicates provider descriptors and
pools them, and revoking a URI permission does not close an open descriptor.
Writes would continue on already-open files and fail only on the next open.
The detach therefore runs in the engine before Android releases access:

1. Under the service lock, mark the root unhealthy and reload available roots
   so admission cannot restart its torrents.
2. For each torrent bound to the root: unregister incoming seeding, join its
   active content (`cancel_when_safe`, then await the task), invalidate its
   storage pool entries and record the awaiting-storage detail. Revoke media
   capabilities. Verified state is unchanged; unwritten piece data is
   dropped and fetched again after repair.
3. In one store transaction, replace or clear the default root and delete the
   catalog row when no torrent references it.
4. Reconcile admission, incoming and discovery catalogs, refresh views.
5. Android then completes its registry operation and releases the persisted
   grant: always for a removed root, and explicitly for a retained root,
   whose registry entry stays for repair.

Detach is refused while a torrent bound to the root has a pending removal
job, because platform deletion needs the grant. The Delete data option waits
for its removals to finish and stops with an error, keeping the folder,
if any removal fails.

### Restart consistency

At launch Android passes its registry roots to the engine, and
`register_storage_roots` makes the first configured root the default when
none is set. After a detach that would silently re-select a removed or
unavailable folder. Android therefore passes only roots that still hold a
persisted grant. Catalog rows persist independently of that list, and a
current folder is replaced at detach time rather than left for the restart
rule to pick.

## Owner, task and cancellation map

- `ApplicationService::detach_platform_storage_root` owns steps 1–4 under
  the existing service lock. It awaits torrent tasks through the existing
  `join_active_content`; it spawns nothing.
- `SessionStore::detach_storage_root` owns the default and catalog change.
- `AndroidApplicationClient::detach_saf_storage_root` exposes it to Kotlin.
- `ProductEngineService.removeSafRoot` owns the Android sequence under
  `safRootMutation`, with a persisted `DETACH` registry operation so a
  process death between engine detach and grant release is completed by
  `reconcileSafRootRegistry` on the next start. The optional data removal
  runs before that lock and is bounded by a wait on torrent removal outcomes.
- The ChromeOS companion `RemoveStorageRoot` path and the shared command are
  unchanged.

## Reference oracle

Pinned libtorrent `7d7fc38fac61177fa5e02148f791b2f65250b09d`:

- `src/torrent.cpp` `torrent::handle_disk_error`: a write permission failure
  switches to upload mode, other storage errors call `set_error` and pause.
  Storage loss is an error state, never data invalidation.
- `torrent::clear_error` restarts checking when needed. Our repair keeps the
  same shape: structural fast-resume admission or a recheck, not a trusted
  claim.
- `src/mmap_disk_io.cpp` `async_release_files` and `test/test_storage.cpp`
  (release between two hash jobs): releasing files is ordered after in-flight
  jobs and does not cancel them. Our detach likewise joins active work before
  invalidating pooled descriptors.
- libtorrent has no operation that drops a save path while keeping the
  torrent; the closest product behavior is `remove_torrent` with
  `delete_files` as an explicit option, default keep. The detach operation is
  an intentional product-level addition.

## Non-goals

- Moving torrents to another folder.
- Changing the shared `RemoveStorageRoot` command, web, desktop, the ChromeOS
  companion presentation or iOS.
- A device run of removing the only folder. The engine test covers the empty
  default; the Pixel 9 carried a maintainer library that was not removed.
- A progress view for the Delete data option beyond the existing per-torrent
  removal state.

## Presentation finding

Android's library row labelled a storage-blocked torrent from its operational
state alone, so a detached or revoked folder showed `Queued · Queue 1`. The
row now shows `Folder unavailable` when progress waits for storage and drops
the queue suffix, matching React's `Storage unavailable` rule from Tactical
`244`.

## Validation

- `detaching_platform_root_keeps_bound_torrents_and_replaces_default`: a
  referenced current root keeps its row, becomes unavailable, its torrent
  keeps its binding with no active task, and the other root becomes current;
  detaching that unused root deletes it and leaves no default.
- `detaching_platform_root_waits_for_pending_platform_removal`: a pending
  Delete data removal on the root refuses the detach with `Busy`.
- `cargo fmt --check`, `cargo clippy --workspace -D warnings`,
  `cargo test --workspace`; Android `lintDebug testDebugUnitTest
  assembleDebugAndroidTest`; `node scripts/check-localization.mjs`.
- Pixel 9 (`org.rstorrent.bootstrap`, maintainer library in `Jstorrent`):
  - A new `Download/jst-remove-test` folder became current; the Debian
    13.7.0 netinst `.torrent` was added through Browse and downloaded.
  - Remove (keep files) during the download: the dialog stated one torrent
    and `New downloads will go to Jstorrent.` Allocated file size stopped at
    551,508 KiB on the first sample after Remove and stayed there; the log
    recorded `saf_root_operation kind=detach result=complete`. The folder row
    showed Repair, `Jstorrent` became current, and the torrent showed
    `Folder unavailable` at 70%.
  - After reinstalling (process restart) `Jstorrent` stayed current and the
    detached folder stayed unavailable.
  - Repair with the same folder resumed the torrent from 70% to complete.
  - Remove with the Delete data option: `saf_removal_confirmed`, then
    detach; the ISO was deleted, the empty directory kept, and the folder
    left the list. The five maintainer torrents were unchanged.
  - The dialog for `Jstorrent` (cancelled) showed `5 torrents use this
    folder.` and `You will choose a download folder before your next
    download.`, and switched its scope text when the option was checked.
  - The pushed `.torrent` and the test directory were removed afterwards.

## Stopping condition

Stop when every folder can be removed with the behavior above and the
validation passes.
