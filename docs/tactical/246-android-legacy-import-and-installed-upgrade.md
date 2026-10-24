# Android Legacy Import And Installed Upgrade

Status: Complete controlled importer/installed-upgrade checkpoint, 2026-09-30.

## Scope And Stopping Condition

Implement best-effort Android migration and prove an installed same-package
upgrade on a task-owned emulator: supported settings, validated torrents,
private download storage and real persisted SAF grants survive the replacement.
The user explicitly supersedes tactical 245's proposed VPN/battery review hold:
unsupported settings are dropped and recorded as potential cutover investments.
No per-record progress ledger: catalog, root bindings and completion commit in
one SQLite transaction. Existing latest-format destination owners win.

Read owners: Android replacement, SAF storage, client persistence, download
roots, direct filesystem storage, client surfaces, application view API,
product surfaces and migration, capability readiness and engine campaign.

## Invariants, Limits And Ownership

Source inspection and backup are read-only, include committed WAL, and precede
opening destination state. Unknown destination/source versions fail closed.
Malformed records/settings are isolated; foreign resume bits and counters never
prove verified content. Normal checking owns payload integrity. Source files
and grants remain untouched. Missing/revoked SAF trees stay repairable.

Reuse the desktop conversion and transaction owner; Android source discovery
and platform binding belong in a focused source adapter. Session storage has no
Android runtime dependency. The native bridge is coarse and private; Kotlin
owns SharedPreferences and real URI authority. ProductEngineService's existing
initialization job owns migration before engine open and applies supported
preferences before network admission. No new background task or protocol.

Use existing importer limits: 32 MiB database, 64 MiB auxiliary/prepared input,
4096 records, 20000 bounded KV rows, 8 MiB metainfo, 32 roots, 1 MiB manifests
and report. Closed preference inputs are bounded separately. New SAF bindings
are limited by the actual remaining 256 KiB encoded adapter registry capacity,
including modified UTF-8 expansion and pending operations. Catalog bindings
are committed with the completion marker; adapter preferences/registry are
idempotently bootstrapped before opening the engine. Existing values and repairs
win, and removed catalog roots cannot be resurrected by bootstrap.

No production identifier, branding, signing trust, Play or extension changes.
Only debug test builds may override package/version for disposable-signature
upgrade tests. Never target attached personal hardware. Public released APK
provenance and test seeding must be distinguished from normal writer evidence.

## Source And Evidence Contract

Use tactical 245's exact android-v1.0.24 source/artifact pin and inspected writer
paths/tests. Inspect libtorrent pin 7d7fc38fac61177fa5e02148f791b2f65250b09d:
src/torrent.cpp::on_resume_data_checked, src/read_resume_data.cpp,
test/test_read_resume.cpp::read_resume and test/test_checking.cpp's incomplete,
corrupt and force_recheck. Adopt normal byte checking; no foreign resume trust.
Android SAF persisted permission and actual provider access are runtime facts.

Required evidence: deterministic import/rollback/repeat/duplicate/settings and
source-preservation cases, native generated boundary and both Android ABIs,
Kotlin checks, actual old APK to new APK package replacement with retained app
UID/data and real SAF permission, restart idempotence, revoked grant repairable
state and intact/corrupt payload checking. Record exactly what was executed and
any material remaining cutover gaps. Remove task-owned emulator and artifacts.

## Implemented Result And Evidence

The shared legacy commit/conversion owner now has a focused Android adapter:
version-1 nullable SQLite KV, version-2 index, exact URI-keyed roots, explicit
private fallback, common validated file/cached-info/magnet intake and selection.
It isolates malformed records and individual settings; current latest-format
identity/settings/default-root owners win. Foreign have and transfer counters
are discarded. Root bindings and report commit with all imported catalog rows.

`ProductEngineService` runs the private UniFFI bootstrap before engine open,
loads carried network/lifecycle preferences before admission, and joins
initialization before resource closure. Roots/preferences also carry when the
old app never created its native torrent database. Source-free successor installs
retire migration without creating a legacy marker. A single installation bootstrap flag
prevents re-reading retained legacy data after explicit private-profile clearing;
it survives normal product preference/reset paths. It is not a per-record ledger.
Current registry entries/repairs and preference keys win during a partial retry.
Incubation app IDs are unchanged. The explicit debug-only package override sets
`com.jstorrent.app`/version 25 and is forbidden on release builds.

The released old APK is re-signed with a disposable certificate (code unchanged).
Its actual `AddRootActivity` writes RootStore and a real persisted tree grant.
A platform-only Java instrumentation APK seeds independently authored settings,
four metadata torrents and a stopped skip-all pending magnet under the old UID.
The successor and its assertions are signed with that same test certificate.
No production signing key, attached physical device or personal source is used.

Executed evidence:

- `cargo fmt --all -- --check` and `cargo clippy --workspace -- -D warnings` pass.
- `cargo test --workspace`: 1570 passed, 18 opt-in/previously ignored tests.
- `cargo test -p rstorrent-session legacy_desktop --lib`: 29 passed (18 desktop,
  eleven Android tests), including the 13-case cohort, source/WAL byte preservation,
  malformed/nullable/binary input and invalid root labels, supported settings
  with malformed neighbors, roots-only/fresh discovery and registry capacity,
  current duplicates/removal, unknown versions, destination rollback and actual
  process exit immediately before/after the common atomic commit.
- `clients/android/build.sh`: both ARM64/x86_64 native libraries, regenerated
  Kotlin boundaries, debug APK, Kotlin unit checks and packaged notice integrity
  pass. Final `testDebugUnitTest` has 113 passed. Shared application/web DTOs
  did not change, so no TypeScript regeneration or web suite is needed.
- `run-legacy-upgrade.py --api 28` and `--api 35`: all eight phases pass on fresh
  ARM64 Google APIs Pixel 6/API 28 and tablet/API 35 emulators. Same package,
  greater version, retained UID, byte-identical source DB/roots, carried DHT/PEX,
  peer/encryption/rates/active limits and Android preferences, stopped/held intent,
  no stopped-magnet admission rank, normal verification, restart, revocation,
  same-ID regrant, explicit clear without reimport, roots-only legacy state and
  source-free first start are asserted. Checker
  generations finish; intact SAF/private pieces verify, corrupt data stays
  unverified, and independent provider/private payload hashes remain unchanged.
- Existing owned `run-localization-matrix.py --api 35 --class` with
  `ProductNetworkPolicyTest,ProductBackgroundLifecycleTest,
  ProductDataResetInstrumentationTest`: all five instrumentation tests pass.
- Ten Python inventory tests, `git diff --check` and local doc link checks pass.

Android 9 exposed that Rust's default temporary directory resolves to inaccessible
`/data/local/tmp`; snapshots now use an explicit platform-provided private cache
path. The old minified APK cannot supply the current instrumentation runner's
Kotlin classes, hence the platform-only source-seed module. Picker confirmation
precedes activity persistence; the runner fences the released root write and
successor selection completion before starting instrumentation or stopping the
app. Canonical root health, rather than a paused/pending torrent's storage field,
is the authority in the revoked-grant assertion.

Each runner deletes its owned emulator/AVD, temporary downloaded/re-signed APKs
and disposable key, then rebuilds ordinary incubation identity. Temporary logs
and investigation artifacts are removed. The attached phone is untouched.

This proves the bounded installed upgrade for the pinned APK/source-format
fixture cohort. It does not qualify all normal old UI writers, historical
profiles, active old engine replacement, multiple/removable roots, reboot,
complete imported-private-root UI/delete journeys or signed Play delivery.
Supported mappings and dropped/unmapped settings plus potential pre-cutover
investments are recorded in the Android replacement topic. Production branding,
component/intake compatibility, API 26/27 disposition, signing/update continuity
and extension guidance remain separate graduation work; JAR-004/005/010 stay open.
