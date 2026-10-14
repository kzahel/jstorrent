# Tactical 348: Torrent List Export And Import

Status: In progress, 2026-10-14. Maintainer-requested; implementation and
commits authorized.
Topics: `client-persistence`, `application-control`, `web-ui-design`,
`android-jstorrent-replacement`, `product-surfaces-and-migration`.

## Problem

A user cannot take their torrent list anywhere: there is no backup, no move to
another device, and no way to bring a list from another client except one
`.torrent` or magnet at a time. Tactical
[345](345-supported-catalog-migrations.md) also needs a schema-independent
safety net: if a catalog ever fails to migrate, the user should be able to get
their torrents out without the app opening normally. The engine retains each
torrent's original `.torrent` bytes (`torrent_source`) but no client can
retrieve them.

## Decision And Desired Outcome

- **Export torrent list** writes one portable bundle: a `.zip` holding one
  `.torrent` per torrent plus a versioned `manifest.json`. A torrent added as a
  magnet with metadata exports a `.torrent` built from its verified info
  dictionary; one without metadata exports its magnet in the manifest.
- **Import** accepts that bundle, several `.torrent` files at once, or a pasted
  list of magnets. One "Save to" root applies to everything; for a bundle,
  "Keep locations" uses a root with the same label when one exists. Existing
  torrents are skipped by info hash, data already on disk is checked rather
  than downloaded again, and the result reports added, already present and
  failed, with reasons.
- Rust owns the bundle format, export and bundle import, so every platform
  shares one implementation. Multiple `.torrent` files and magnet lists reuse
  the existing per-torrent add commands with a client-side summary.
- The exporter reads only baseline-26 tables through a plain connection, so a
  later recovery screen can run it on a catalog that failed to migrate.

## Building Blocks (surveyed 2026-10-14)

- Add paths: `AddTorrentBytesRequest` over gateway HTTP `POST
  /api/v1/torrents`, gateway WebSocket `begin_torrent_upload`, Tauri raw IPC
  `application_add_torrent_bytes` and UniFFI `addTorrentBytes`; 64 MiB source
  cap everywhere. Duplicates return `AlreadyPresent`. No batch API.
- `torrent_source` keeps verbatim metainfo for `.torrent` adds and the magnet
  for magnet adds; `torrents.raw_info` holds the verified info dictionary.
  `ExportMagnet` is the only export today.
- Data already at `root/<name>` is found by `inspect_discovered_payload` and
  rechecked (`application.rs::unowned_existing_direct_file_is_checked`);
  mismatching pieces re-download in place.
- A torrent's location is its storage root plus the content name; roots have a
  stable `root_id` and a user-visible label.
- Add-time selection: `.torrent` takes `FileSelectionIntent` ranges, magnets
  take `skip_files`; High priority is set afterwards with `SetFilePriority`.
- Legacy JSTorrent import (`store/legacy_desktop.rs`) is the closest pattern:
  one transaction, per-record outcomes, existing owner wins.
- No save-file flow exists on desktop or Android; the dialog plugin offers
  `save_file`, Android needs `ACTION_CREATE_DOCUMENT`. The browser has
  `showSaveFilePicker` with a Blob fallback.
- `zip` 4.6 is already locked (through the updater) and `flate2` is a workspace
  dependency.

## Bundle Format, Version 1

```text
jstorrent-torrents.zip
  manifest.json
  torrents/<torrent_id>.torrent
```

`manifest.json`:

```json
{
  "format": "jstorrent-torrent-list",
  "version": 1,
  "exported_at": "2026-10-14T12:00:00Z",
  "torrents": [{
    "info_hash_v1": "…", "info_hash_v2": "…", "name": "…",
    "source": {"type": "metainfo", "file": "torrents/t1-….torrent",
               "fidelity": "verbatim"}
           | {"type": "magnet", "magnet": "magnet:?…"},
    "storage_root_label": "Downloads",
    "running": true, "archived": false,
    "selection": {"default": "normal", "exceptions": [2]},
    "high_priority_files": [0],
    "transfer_limits": {…}, "seed_stop_limits": {…}
  }]
}
```

- Readers ignore unknown fields. A change an older reader cannot safely ignore
  increments `version`, and readers refuse versions newer than they know.
- Entries are written with the zip `Stored` method; `.torrent` piece hashes do
  not compress. Import also accepts `Deflated` entries.
- No absolute paths, profile identifiers, accounting or statistics leave the
  device. Root labels are user-chosen text and are included.

## Scope

### Rust (`rstorrent-session`)

- `torrent_export`: a pure bundle model, manifest (de)serialization with
  bounds, and zip writing and reading. Import bounds: at most 4,096 entries,
  64 MiB per `.torrent`, 512 MiB total uncompressed, manifest 16 MiB, entry
  names restricted to `manifest.json` and `torrents/<name>.torrent`, no
  directories, links or path traversal.
- `SessionStore` export reads `torrents`, `torrent_identities`,
  `torrent_source`, `file_selection`, `file_priorities` and `storage_roots`
  with plain queries over a `&Connection`.
- Application: `export_torrent_list() -> Vec<u8>` and
  `import_torrent_bundle(bytes, target: ImportTarget) -> ImportReport`, where
  `ImportTarget` is a root id plus `keep_matching_locations`. Import adds each
  torrent through the existing add path with its selection, then applies High
  priority, rate and stop limits, archive and running state; each torrent is
  independent and reports `added`, `already_present` or `failed{reason}`.
- Transports carry the bundle without new streaming machinery:
  - desktop: Tauri commands take a dialog-chosen path, and Rust reads or
    writes the file itself, so no bundle bytes cross IPC;
  - Android: UniFFI methods take and return bytes that Kotlin reads from or
    writes to a SAF document;
  - browser on the gateway: `GET /api/v1/torrent-list/export` and
    `POST /api/v1/torrent-list/import`, authenticated like other API calls.
  The Android companion, desktop companion and remote WebRTC clients do not
  offer bundle export or import in this slice; the section shows only where
  the client supports it. Multiple `.torrent` files and magnet lists work on
  every client because they use the existing add calls.

### Clients

- Web and desktop: Settings gains an **Export and import** section: Export
  torrent list, Import (bundle, `.torrent` files, magnet text) with the Save to
  root and Keep locations choices and a result summary. The torrent picker in
  the toolbar accepts several `.torrent` files at once. Desktop saves through
  the dialog plugin; the browser uses `showSaveFilePicker` or a download.
- Android: the same Settings entry using `ACTION_CREATE_DOCUMENT` and
  `ACTION_OPEN_DOCUMENT` (multiple), and the existing default-root rules.

## Non-Goals

- Reading qBittorrent, Transmission or other clients' resume data, labels or
  categories.
- Settings export, statistics, history, or restoring app state.
- Moving or copying payload data; import never touches existing files beyond
  the ordinary check.
- The failed-migration recovery screen (next tactical; it reuses this
  exporter).
- Encryption or signing of bundles.

## Invariants

- Export never changes the catalog. Import never removes or replaces an
  existing torrent and never trusts saved progress: content is verified.
- A malformed bundle fails before any add; a bad entry fails only itself.
- Imports are idempotent by info hash: importing the same bundle twice adds
  nothing the second time.
- Bundle parsing is bounded before allocation and treats every byte as
  hostile.

## Validation

- Unit tests: manifest round trip, unknown fields ignored, newer version
  refused, every bound and path rule, `Stored` and `Deflated` reading,
  synthesized `.torrent` identity matches the info hash.
- Store/application tests: export of every torrent shape in the v26 fixture,
  round trip export → import into a fresh profile reproducing identities,
  selection, priorities, limits, archive and running state; second import is
  all `already_present`; existing payload is checked and completes.
- Web and Android unit tests for the flows; web typecheck/tests, Android build
  and tests, workspace `fmt`/`clippy`/`test`.

## Stopping Condition

Complete when export and all three import forms work on web, desktop and
Android with the tests above, the format is documented here and in
`client-persistence`, and the owning topics record the result.
