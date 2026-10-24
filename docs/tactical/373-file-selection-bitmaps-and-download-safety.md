# Tactical 373: File Selection Bitmaps And Download Safety

Status: Implementation complete; Windows/Android native runtime qualification
remains open as recorded below. Plan and implementation authorized by the
maintainer on 2026-10-16. No push, publication, release, or production-data mutation is
authorized. Work stays on main.

## Outcome and stopping condition

Replace the 4,096 persisted file-selection/High-exception ceiling with bounded
packed bitmaps, and add host-owned optional download safety with presets,
custom extensions, explicit per-file overrides, truthful Files explanations,
and optional Windows/macOS internet-origin marking (default on). Complete the
shared Rust owner, generated web/Kotlin/Swift boundaries, React and applicable
Android presentation/build/runtime evidence, migration and version-pair tests,
controlled transfer/restart evidence, documentation, and required checks.
Record platform qualification limits precisely; do not claim unsupported OS
marking or a release. No new priority enum value is required: safety reason is
independent of selection/priority.

Non-goals: malware scanning, archive extraction/inspection, automatic opening,
retroactive payload removal or relabeling, public-swarm tests, physical-device
use, production installs, automatic updates, or changing BitTorrent protocols.
Linux/Android/iOS do not claim Windows/macOS origin-label support.

## Accepted product behavior

- A Downloads setting automatically skips potentially dangerous files. Presets
  are applications/installers/scripts (default), that preset plus archives,
  and Custom. A separate enable switch preserves the selected preset/custom
  list. Custom starts from the selected preset, accepts case-insensitive literal
  extensions, rejects malformed input, and is bounded. Generic ISO images and
  archives remain allowed by the recommended preset. No rule implies safe or
  verified content. Match final extension/explicit compound suffixes and .app
  directory components; filenames such as video.mkv.exe match .exe.
- A separate default-on setting marks newly downloaded files as internet-origin
  on supported Windows/macOS storage. Disabling it never strips existing labels.
  Explicit safety overrides do not bypass marking. Do not fabricate provenance
  URLs, log private paths, or mark pre-existing user files merely on upgrade.
- Capture resolved rules/version with each new torrent before metadata/content
  work. Existing torrents, including pre-metadata magnets, retain prior
  selections on migration. Later global settings/preset changes affect future
  adds only. Duplicate intake does not replace existing policy or paused intent.
- Download all means all ordinary files subject to captured safety rules.
  All/None changes ordinary intent and preserves deliberate safety overrides.
  Files shows the matching extension and preset/custom origin, permits Download
  anyway and undo, and distinguishes manual skip from safety exclusion.
  Overrides are per torrent/file, durable, and do not resume a paused torrent.
  All-excluded means no files selected, never a successful completed download.
- Magnets may acquire verified metadata before selection, but content admission
  uses policy and ordinary selection together. Restart/late metadata/disabled
  add dialog/explicit Download all cannot create an unfiltered content window.

## Storage and invariants

Append one forward session.db migration after schema 28 (recheck before editing);
product.db is unchanged. Frozen baseline and shipped steps remain untouched.
One per-torrent format-version-1 state stores packed **exception**, High,
safety-allow, and cached match masks, plus metadata count/fingerprint and cached
blocked count/bytes. Keeping the existing wanted/skipped default represents
all/none/pending intent compactly without materializing a complement. Byte i
contains indices 8i through 8i+7, least-significant bit first. Trailing zero
bytes are omitted, and the empty BLOB is the empty set. Maximum length is
46,875 bytes per mask at 374,998 files (187,500 bytes across four masks).
Codec reads reject noncanonical trailing zeros, unsupported versions, missing
state, high unused bits, and metadata count/fingerprint mismatch. Requests
validate padding and actual file indices before mutation. No compression
library or new runtime owner is needed.

Before metadata, retain bounded all/none/range intent. On metadata arrival,
expand directly to bounded masks in the same transaction as metadata acceptance.
Migration converts known catalogs without changing selection, verification,
priority, run intent or queues. Pending intent remains executable after restart.
Legacy selection tables/readers are migration inputs, not dual authorities;
record retirement in durable-data-migrations. Reject malformed bitmap state
without resetting data or guessing Download all. Bound incoming requests/ranges
independently from total representable selected files. Migration failure leaves
the original catalog unchanged under the existing backup/transaction runner.

The allowance mask represents explicit user consent. Match masks are derived
from immutable metadata and the resolved rule snapshot transactionally at
metadata/import/override boundaries, then fingerprint-bound for checkpoint reads. Effective wanted = ordinary wanted AND
(not matched OR allowed). High is orthogonal and never selects a skipped file.
Bound all masks and per-torrent rule snapshots under existing catalog limits;
record maximum encoded sizes and relevant transaction/runtime high-water marks.

## Contract and compatibility

Preserve released Normal/High/Skip values. New output fields are omittable with
serde defaults, and new settings/commands/command fields belong to append-only
host capabilities. New clients connected to old hosts hide unsupported behavior
and never imply active protection. Hosts enforce policy independently of the
client; legacy bulk selection cannot become an implicit safety override.
Use a capability-owned explicit override operation. Analyze legacy individual
selection and pending-add commands before choosing their exact behavior; refuse
unsafe ambiguous operations with an existing typed error rather than bypassing
policy. Record strict-client exposure and retain the existing release hold.
No shipping is needed here. Legacy command snapshots keep index arrays bounded by the metadata file-count
limit, within the existing 16-MiB gateway response ceiling; web command decoding
now accepts that same ceiling. Paged leased views remain the scalable UI
authority. Very many huge catalogs can exceed the legacy full-response limit;
this does not raise request target/range counts or silently truncate selections.

## Owners, tasks and dependencies

- Pure bitmap codec and safety matching own deterministic bounded values; no
  Tokio, database, filesystem or platform dependencies point inward into them.
- SessionStore owns migration, settings, policy snapshots, masks, command
  atomicity, revision/receipt replay and restart. Extract focused persistence
  helpers rather than adding unrelated responsibilities to store.rs.
- ApplicationService owns runtime reconciliation and observes effective
  selection before content admission. Reuse existing metadata/content owners,
  cancellation, joining and shutdown; no independent polling task.
- FileProgressModel/ViewHub own paged authoritative safety explanations and
  diffs. Clients own only drafts and presentation, not a second safety policy.
- Native path storage owns exact-file origin marking at an appropriate writable
  creation boundary, with observable failure and idempotent retry; Android SAF
  remains bulk-descriptor based. No payload crosses an extra process boundary.

## Source-first inspection

Pinned reference revisions are recorded in reference/pins.toml. Before code,
inspect libtorrent file priorities and resume implementation/tests, BEP 3/52/53,
qBittorrent exclusion and OS-marking behavior, and sibling JSTorrent selection
and storage behavior. Record exact paths/cases, adopted behavior, intentional
differences and shape-changing edge cases below. Read-only source study only;
no GPL source, fixtures or assets are copied.

Owning topics read for this slice: client-persistence, durable-data-migrations,
mixed-version-compatibility, application-control, application-view-api,
web-ui-design, client-surfaces, settings-mutation-and-draft-consistency,
direct-filesystem-storage, localization, capability-readiness, and
oracle-driven-engine-campaign. These retain their existing architecture and
release decisions. The conversation's HTML sketch is design input only.

## Execution order and evidence

1. Finish exact source/test inspection and capture restart/compatibility edges.
2. Implement bitmap codec and migration; prove released fixtures, maximum and
   fragmented selections, malformed input, rollback, replay and pending magnets.
3. Add durable rules/settings/overrides and effective-selection integration;
   prove metadata gates, source selection, duplicate adds, All/None, priority,
   pause/restart, all-excluded and cross-file piece integrity.
4. Expose capability-gated optional safety facts and settings; regenerate
   TypeScript/schema, Kotlin and Swift and run contract/version-pair checks.
5. Implement React and proportional Compose settings/Files/add-selection UX,
   localization and browser interaction/layout/override tests.
6. Add Windows/macOS origin labeling with default-on durable preference;
   validate native APIs and unsupported/filesystem failures without stripping
   labels or changing file bytes. Record cross-platform limits.
7. Run fmt, warning-denying workspace clippy/tests, web generation/typecheck/
   unit/browser checks, Android dual-ABI/JVM/lint/build and owned-emulator
   safety/selection/restart evidence, applicable Swift build, controlled
   independent-peer transfers and migration/resource measurements. Update owner
   topics/readiness/checkpoint, clean temporary artifacts, and commit with
   verified personal identity. Never push or publish.

## Source inspection and adopted edge cases

Pinned libtorrent `7d7fc38fac61177fa5e02148f791b2f65250b09d`:

- `src/torrent.cpp`, `prioritize_files`, `set_file_priority` (5680–5845), and
  `src/read_resume_data.cpp` (300–338): priorities before metadata, pad-file
  exclusion, asynchronous updates and resume restoration. We retain explicit
  bounded request validation, separate High intent, and store transactions.
- `test/test_priority.cpp`: `no_metadata_prioritize_files`,
  `no_metadata_file_prio`, `file_priority_multiple_calls`,
  `export_file_while_seed`, `test_piece_priority_after_resume`, and
  `file_priority_stress_test`. Crucial adopted case: selecting already verified
  part-file bytes still requires materialization, including after pause/restart.
- `test/test_resume.cpp`: default/deprecated, resume and params file-priority
  cases (623–660); `test/test_magnet.cpp` parse-magnet-select-only overlap,
  multiple, inverted and index-bound cases (600–654). Pending source ranges
  stay bounded and clamp to actual non-padding metadata on acceptance.

Pinned BEPs at `7b7b41f46d57ff1d1cb1e24ed6e9bacfbf958c06`:
`beps/bep_0003.rst` info/files/path and cross-file piece layout;
`beps/bep_0052.rst` file-tree/path, aligned nonempty files and hybrid padding;
`beps/bep_0053.rst` select-only ranges. Policy does not change wire geometry,
hashing or path validation, and never exposes unverified boundary bytes.

Pinned qBittorrent `a1e4649cb8ae581925acc161dbab5cbc6584c542`:
`src/base/bittorrent/sessionimpl.cpp` filename/regex filtering,
`src/gui/optionsdialog.ui` exclusion help, `src/base/utils/os.cpp` origin labels
(234–315), and torrent completion marking in `torrentimpl.cpp`. Intentional
differences: bounded literal presets/custom extensions, captured per-torrent
rules with explicit override state, and descriptor-owned writable-open marking
before exposing a completed application. The macOS bundle boundary is explicit.
Microsoft's Zone.Identifier FSCC specification and Apple's fsetxattr manual
were consulted for native label behavior; existing stronger labels/provenance
are preserved. No GPL source or fixture was imported.

Sibling `../jstorrent-typescript/packages/engine/src/core/torrent.ts`,
`setFilePriority` and its asynchronous boundary-part promotion (1270–1315),
reinforces that a verified piece bitmap alone is not proof a newly selected
file has been materialized. Tests here are independently authored byte fixtures;
`.exe` and `.zip` fixture names never contain or execute actual programs.

Shape-changing cases covered in this slice: old sparse selections and pending
magnets, metadata-less All, source ranges over 4,096 files, all-excluded idle,
priority retention, paused allowance/replay/restart, unsupported storage labels,
root/nested bundles, shared pieces, duplicate preservation, malformed masks,
missing rows, bounded custom rules, and legacy read-only recovery/import.

## Implementation and restart checkpoint

Common implementation and all three product presentations are present. Core
transfer and real Chromium safety flows pass, including the direct-magnet
metadata boundary and paused part-file promotion regressions found during the
controlled smoke. A subsequent pure-v2 regression requires retaining the direct
metadata peer: DownloadCheckpointSink.metadata_file_selection supplies the
transactionally resolved selection before storage admission. Platform storage
keeps its existing metadata/manifest split. The same-connection pure-v2 test
passes; no reconnect requirement is introduced. Android dual-ABI native generation, Kotlin/JVM/lint/instrumentation-APK checks,
and Swift simulator app/test-target compilation pass. The checks below are
recorded against the final implementation. No new background owner or dependency was added.

Platform qualification limits: the exclusively claimed Windows VM remained
stopped and its startup timed out. The claim was released; no guest mutation
ran, and private Machine Control friction/summary notes were recorded. The
portable stream test verifies the Windows writer's bounded/idempotent logic,
but does not qualify NTFS ADS. Machine Control exposes no Android emulator
profile in this session, so no alternate direct emulator route is used.
Android SAF runtime qualification of this new policy remains open; shared
platform-storage Rust coverage and dual-ABI/native build evidence are distinct
from device runtime evidence. iOS physical/runtime qualification is outside
this slice. These are release qualification gates, not claims of support from
code alone.

## Validation and resource evidence

All local gates below pass on 2026-10-16:

- `source scripts/dev-env.sh; cargo fmt --all -- --check`.
- `cargo clippy --workspace -- -D warnings`.
- `cargo test --workspace --quiet`: 1,719 passed, 20 ignored, 73 completed
  groups; no failures. The final session group is 475 passed / 2 ignored.
  This includes released-v26 row/schema preservation, semantic bitmap
  conversion, unchanged-source read-only recovery, malformed/missing/count/
  fingerprint bitmap rejection, 4,097-file select-only acceptance/reopen,
  10,000-file selection/High ranges, receipt replay/rollback, captured rules,
  legacy executable-file intent, native macOS quarantine/bundle tests, and the
  portable Windows stream writer test. The same-connection pure-v2 metadata
  regression also passes independently.
- `npm run generate --prefix clients/web`, `npm run typecheck --prefix
  clients/web`, and `npm run test --prefix clients/web`: 843 passed, 3 skipped
  (106 passed files). Released-contract compatibility and missing-capability
  behavior pass. The optional external interop suites remain opt-in.
- `uv run --project tests/interop --locked python
  tests/interop/file_safety_smoke.py --binary target/debug/rstorrent-gateway
  --web-url http://127.0.0.1:4317`: controlled libtorrent 2.0.13 transfer plus
  owned Vite/Chromium save/custom/override/undo, paused state, mobile reload,
  safety-aware all-excluded idle and native Mac origin-toggle checks pass.
  Desktop and 390-pixel phone captures were inspected. A bounded extra list-row
  height reserves the safety reason/actions without clipping the size line.
- `uv run --project tests/interop --locked python
  tests/interop/application_lifecycle_smoke.py --binary
  target/debug/rstorrent-gateway`: ordinary intake/restart, two seeded copies,
  integrity/repair and removal smoke passes against pinned libtorrent.
- `clients/android/build.sh`, then `clients/android/gradlew -p clients/android
  lintDebug assembleDebugAndroidTest`: x86_64/arm64 release libraries,
  generated Kotlin for both boundary crates, debug APK/notices, 207 JVM cases
  across 31 suites, lint and instrumentation APK pass. No Android policy runtime
  or physical-device claim follows from these build results.
- `clients/ios/scripts/generate-project.sh`; `xcodebuild -quiet -project
  clients/ios/RSTorrent.xcodeproj -scheme RSTorrent -sdk iphonesimulator
  -destination 'generic/platform=iOS Simulator' -derivedDataPath <owned-temp>
  CODE_SIGNING_ALLOWED=NO ARCHS=arm64 ONLY_ACTIVE_ARCH=YES build-for-testing`:
  Swift bindings, product and unit/UI-test targets compile. Existing native
  unused-code / Swift-6 NSLock and XCTest deployment warnings remain; no iOS
  runtime was launched. The initial generic test build required the explicit
  arm64 override to match the existing app/binding target architectures.
- `node scripts/check-localization.mjs`: web 1,624, Android 617, iOS 189 product
  / 6 Info.plist and desktop-native 20 English catalog entries validate.
  `git diff --check` passes. No new dependency was added.

The maximum-fragmentation codec round-trip represents 187,499 alternating file
indices in 46,875 bytes. Four maximum masks total 187,500 bytes per torrent;
empty/all-default masks use zero bytes. React and Compose drafts use at most
93,750 bytes for their two bitsets, independent of cached page rows. Incoming
explicit-index and normalized-range counts remain 4,096 per command. React
retains the old changed-file limit when an older host lacks the bitmap
capability. Legacy response arrays remain metadata-bounded; new web decoding
accepts 120,000 indices above the old 512-KiB response ceiling without raising
ordinary collection/request bounds. Many huge torrents can still exceed the
legacy full-response 16-MiB cap; use paged leased views for inspection.

The controlled safety transfer observed at most three owned storage handles
against the existing 40-handle budget. All four shutdown/restart checkpoints
join with zero retained handles/pending operations/connections, including the
all-excluded case. Cache matching occurs at transaction boundaries, not on each
piece checkpoint; no independent safety polling task was introduced.

Next executable action: qualify native Windows ADS on a healthy exclusively
claimed Windows target, and Android safety/selection/override/restart on an
explicit Machine Control emulator profile. These two runtime gates remain
open. Complete the existing tolerant-client rollout review before a host
release. No push, release, tag, production install or public swarm was performed.
