# Android Legacy Inventory And Import Contract

Status: Complete inventory checkpoint, 2026-09-30.

Follow-up: [246](246-android-legacy-import-and-installed-upgrade.md) owns actual
implementation and installed upgrade evidence. Subsequent explicit maintainer
direction retires the proposed VPN/battery review holds: drop unsupported
settings and record potential cutover investments instead.

## Authorized Slice And Stopping Condition

Start Android migration by inventorying a pinned released app's stored
torrents, settings and SAF roots, then scope the importer and upgrade test.
Stop with a reproducible generated source cohort, a read-only format audit,
exact source/artifact provenance, a field/authority mapping and an executable
next implementation boundary. This precedes an importer or production update.

Owners read: `android-jstorrent-replacement`, `android-saf-storage`,
`client-persistence`, `direct-filesystem-storage`, `download-roots`,
`client-surfaces`, `application-view-api`, `product-surfaces-and-migration`,
`capability-readiness`, `oracle-driven-engine-campaign`, and `references`.

## Invariants, Bounds And Non-Goals

- No personal data, Android device, signing key, package replacement, production
  identifier change, extension protocol change or Play operation.
- Source/artifact inspection is read-only; generated SQLite and preferences
  live only in task-owned temporary directories and are removed on exit.
- Fixtures are independently authored from pinned public format behavior;
  never represent them as captures from an installed released Android app.
- A stored tree URI is not evidence of a usable persisted read/write grant.
- Legacy bitfields/completion/counters never become verified Rust content.
- Audit output contains counts and closed outcomes, not URIs, paths, names,
  hashes, credentials or raw preference values.
- Fixture inputs and values are size bounded. No runtime owner/task is added.

## Source-First Record

Released JSTorrent `android-v1.0.24`, peeled source
`7b454be4410385f9c4f7f135cb6b16194a2b0409`, is the selected source baseline.
The sibling checkout remains untouched, including preexisting untracked files.
Inspect pinned files with `git show android-v1.0.24:<path>` rather than assuming
the sibling's current branch is the released source.

Exact files and extracted format/edge cases:

- `android/quickjs-engine/.../storage/SqliteKVStore.kt`: database
  `jstorrent_kv.db`, SQLite user version 1, nullable text KV values.
- `packages/engine/src/adapters/native/native-session-store.ts` and
  `test/adapters/native/native-session-store.test.ts`: `session:` prefix,
  JSON-string-wrapped base64, whitespace accepted by the released reader.
- `packages/engine/src/core/session-persistence.ts`, its core test, and
  `torrent-state.ts`: index version 2, file/magnet sources, cached info,
  active/stopped/queued/awaitingFileSelection, Normal/Skip and pending magnet
  selection. Missing state/storage binding and index/state disagreement matter.
- `android/app/.../storage/{RootStore,DownloadRoot}.kt` and
  `src/test/.../storage/RootStoreTest.kt`: `files/roots.json`, exact URI-derived
  16-hex root keys, no profiles, stale availability hints, corrupt-root fallback.
- `.../settings/SettingsStore.kt`, `.../auth/TokenStore.kt`,
  `.../network/NetworkRestrictionEnforcer.kt`, `JSTorrentApplication.kt`:
  engine config versus Android-only preferences; network restrictions apply
  before initialization; old companion credentials are a different authority.
- `android/app/{build.gradle.kts,src/main/AndroidManifest.xml}` and backup XML:
  package/version, components, authorities, grants and restore caveats.

Pinned libtorrent `7d7fc38fac61177fa5e02148f791b2f65250b09d`:
`src/torrent.cpp::on_resume_data_checked`, `src/read_resume_data.cpp`,
`test/test_read_resume.cpp::read_resume`, and
`test/test_checking.cpp::{incomplete,corrupt,force_recheck}`. Preserve input
intent and use ordinary verification; import no foreign resume authority.
No protocol, engine or checker implementation changes in this slice.

Normative platform sources: Android's
[SAF document guide](https://developer.android.com/training/data-storage/shared/documents-files)
and [Auto Backup guide](https://developer.android.com/identity/data/autobackup).
Stored locators can survive in restored private data without proving usable
document access; runtime grant/provider checks remain required.

## Deliverables And Validation

Delivered: `tests/fixtures/legacy-android-v1.0.24` has 13 independently authored
cases/12 index records; `tests/interop/legacy_android_inventory.py` reifies the
nullable Android schema, snapshots committed WAL read-only, checks unchanged
source database/nonempty WAL bytes and logical KV, and emits bounded private
ordinal/count reports. Seven records are format candidates (six metadata and
one pending magnet); none is claimed verified or ready for import by this tool.
Runtime payload/grant scenarios are labeled future expectations, not captures.

The [Android replacement topic](../topics/android-jstorrent-replacement.md)
owns artifact pins, exact source field/authority mapping, network/lifecycle
policy, the one-transaction catalog plus derived-registry ordering, and the
same-package/disposable-key upgrade matrix. Important extracted cases include
URL-safe/whitespace binary, nullable KV values, healthy-looking revoked roots,
explicit private default storage, original run/selection intent and unsupported
VPN/battery restrictions. The old APK permits API 26; current RSTorrent starts
at API 28. Play certificate continuity remains unverified.

Validation:

- Downloaded pinned APK hash/size match released GitHub asset metadata.
  `apkanalyzer manifest application-id`, `version-code`, `version-name` and
  `manifest print` confirm package/version/SDK/components/backup. SDK 35
  `apksigner verify --print-certs` passes; no private signing key is used.
- `PYTHONDONTWRITEBYTECODE=1 python3 tests/interop/legacy_android_inventory.py`:
  all 13 fixture cases pass; temporary SQLite files are removed on exit.
- `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests/interop
  -p test_legacy_android_inventory.py -v`: 10 passed, covering WAL/source
  preservation, reproducibility, bounds, nullable state, revoked-root hints,
  future index refusal, private root classification, cached-info mismatch,
  URL-safe/whitespace binary, policy review and output privacy.
- `git diff --check` and local Markdown-link validation pass.

Rust, generated contracts, Android Kotlin and React production code are
unchanged, so no Rust workspace, Android build/device or web suite ran here.
The temporary downloaded APK, decoded manifest, reports and Python caches are
removed after inspection. The sibling checkout remains unchanged.

Next executable action: a bounded Android importer tactical using this pinned
cohort and proposed boundary, then the task-owned same-package real-SAF upgrade
test. It must settle the visible VPN/battery review hold, exact source/destination
limits, private-download root, committed root-binding bootstrap API and startup
failure presentation before production code. Importer implementation, installed
upgrade and JAR-004/005/010 are not completed by this checkpoint.
