# ChromeOS Staggered Extension And Android Upgrade

Status: Complete bounded controlled checkpoint, 2026-09-30.

## Scope And Stopping Condition

Implement the accepted four-pair contract in product-surfaces-and-migration:
new extension/old Android requires an update; old extension/new Android loses
control while standalone Android works; new/new attaches after local import.
Prove normal legacy extension writers persist a library that survives an
installed Android replacement, and exercise bounded mixed-version behavior.
Commit documentation first, then implementation and recorded test evidence.

Read owners: product-surfaces-and-migration, android-jstorrent-replacement,
client-surfaces, web-ui-design, application-view-api, android-saf-storage,
client-persistence, download-roots, runtime-configurations-and-headless-deployment,
localization, plus tacticals 194, 245, 246 and 247.

Non-goals: production publication/signing/branding, Crostini migration, old
raw-I/O compatibility server, modifying the legacy engine, older browser-local
library conversion, automatic token reuse, public swarms or personal-data
replacement. A preparatory legacy-extension messaging release is optional.

## Invariants, Bounds And Owners

Android service initialization owns import before engine/companion admission.
Existing atomic import, retained sources, payload checking and SAF bindings
remain authoritative. Latest destination owners win and duplicates are safe.
The extension owns only its bounded connection/presentation and aborts work
when canceled; mismatches never open old pairing, KV, socket or file channels.
Fixed ARC host and exact approved origins remain; legacy discovery reads only
unauthenticated status on the five existing legacy discovery ports. Each probe
has a two-second deadline and 64-KiB response ceiling, with no redirects,
credentials, arbitrary endpoint override or LAN fallback in shipping code.

The rehearsal owns a fresh emulator, disposable same-package signing key,
separately identified Playwright Chromium/profile, unchanged pinned legacy
extension build, loopback seed/tracker and exact fixtures. Join browser,
emulator and server processes and remove owned temporary state. Never select
an attached personal device or overwrite the installed physical library.

## Source Audit And Required Evidence

JSTorrent source pin 7b454be4410385f9c4f7f135cb6b16194a2b0409:
extension/src/sw.ts::handleKVMessageViaWebSocket and KV routing,
extension/src/lib/chromeos-bootstrap.ts discovery/pairing,
android/app/.../CompanionServerDepsImpl.kt KV provider,
android/quickjs-engine/.../SqliteKVStore.kt database and schema,
android/companion-server/.../NettyHttpServer.kt status fingerprint.
Remote KV routing first appears at 1f523446 (2026-02-01); browser-local fallback
exists when no remote handler is selected. Qualification is the pinned
connected companion case, not every historical source.

Released extension 1.1.1 is pinned independently at source
8584dce61e63607f47877a71779c28686aeb411b and ZIP SHA-256
9366af2f2443d2e50b9ebf5c6b8f3097c8e96c51e386a2779e6896ee149812b6.
Its ordinary exported engine intake/settings/session APIs are exercised without
source KV insertion. Inspect its DaemonEngineManager, HostChannelSessionStore,
BtEngine.addTorrent storageKey option and Torrent.userStop as well as KV routing.
Released APK remains 245/247's hash-pinned 1.0.24. JSTorrent is MIT-licensed;
artifacts are used temporarily, with no reference source or fixture copied.

No engine/protocol/storage-format change lands. Reuse 246/247's libtorrent
source pin 7d7fc38fac61177fa5e02148f791b2f65250b09d and locked 2.0.13.0
runtime. Their inspected src/torrent.cpp::on_resume_data_checked,
src/read_resume_data.cpp, test/test_read_resume.cpp and test/test_checking.cpp
remain the integrity oracle: incomplete, corrupt, force-recheck and read-only
cases establish that foreign completion bits are untrusted. Independent
payload/metainfo/tracker fixtures and the ordinary checker verify final bytes.

Required evidence: strict legacy/current/incompatible/malformed discovery,
current-service preference, offline/cancellation and revoked-pairing handling;
real old extension settings/intake/session writer into old Android; retained
torrents, root/grants, pause/settings and independent hashes after installed
replacement; old endpoint retirement and new extension control/identity;
restart and cleanup. Record any unavailable physical/store gate accurately.

## Executed Evidence And Reproduction

Build generated native ABIs normally, then package the successor extension:

```bash
source ~/.profile
clients/android/build.sh
npm run package --prefix clients/extension
PYTHONDONTWRITEBYTECODE=1 uv run --project tests/interop --locked \
  python clients/android/scripts/run-legacy-upgrade.py --api 35 --source companion
PYTHONDONTWRITEBYTECODE=1 uv run --project tests/interop --locked \
  python clients/android/scripts/run-legacy-upgrade.py --api 28 --source companion
```

Both API 35 and API 28 ARM64 owned-emulator runs pass all three installed
assertions (upgrade, process restart, successor companion control):

- Real released picker grants two trees. The released extension discovers the
  old daemon and its actual Android pairing dialog is approved. No old token,
  SQLite row or preference is inserted by instrumentation.
- The ordinary extension config owner writes DHT/PEX off and disabled
  encryption. Explicit per-torrent storageKey intake downloads a 256-KiB file
  on root A, stops it, and partially downloads a 4-MiB file on root B. Its
  normal session writer persists both into Android. Browser-local
  `session:torrents` is absent. Old Android remains running at replacement.
- The successor packaged page against old Android shows the terminal update
  message and visible Google Play action. It never starts a legacy engine or
  pairs through legacy endpoints.
- Same-package, disposable-signature install replaces Android without clearing
  data. UID, two roots/grants, settings and stopped/running intent survive.
  Old extension disconnects. Import reports two imported/zero skipped, one
  paused, and the partial torrent completes with independent provider hashes
  and full verified-piece counts; restart repeats the same assertions.
- The new extension approves one fresh successor pairing, identifies the
  existing Android/default owner, renders both imported torrents and issues an
  ordinary Pause action. Android's catalog then contains two paused torrents.
  This is the same service/client, not a second engine or copied library.

The emulator has no ARC interface. Only its owned disposable kernel gets the
fixed address on loopback and a local DNAT rule for ADB forwarding. A bounded
test HTTP/WebSocket proxy preserves shipping ARC URLs, Host and extension
Origin, refuses other destinations, and maps only fixture daemon/control
ports. Only the extracted test successor manifest pre-grants the exact optional
ARC permission; shipping CSP and identity are unchanged. Test instrumentation
starts the existing service client's companion explicitly and approves its
pairing, leaving the ordinary phone-only product guard unchanged. This proves
controlled transport/migration, not physical ARC routing or approval UI.

Additional validation:

- `npm run typecheck --prefix clients/web`: passes.
- `npm run test --prefix clients/web`: 438 pass, 2 skipped, including strict
  fingerprints, current-service preference, incompatible successor protocol,
  no legacy authority, cancellation/malformed/offline and stream-byte bounds.
- `npm run test --prefix clients/extension`: 42 pass and source validation.
- `npm run package --prefix clients/extension`: passes packaged React/CSP and
  deterministic extension validation.
- `node scripts/check-localization.mjs`: all four platform catalogs pass.
- `clients/android/gradlew -p clients/android testDebugUnitTest`: 113 pass.
- `cargo test -p rstorrent-gateway chromeos_companion`: 5 pass, including
  nonce binding, cancellation and pairing revocation joining connections.
- New Python syntax, JavaScript syntax and `git diff --check`: pass.

Machine Control ChromeOS doctor passes all readiness checks. Its physical
legacy/debug installations are preserved. Owned browser/proxy, emulator/AVD,
seed/tracker, APKs/key, fixtures and logs are removed. Normal beta Android
build identity is restored. No Rust, ABI, generated DTO or storage schema
change lands; full Rust/web E2E baselines are not repeated for this slice.

## Restart Checkpoint And Remaining Gates

Contract committed as f37345ce. Compatibility presentation implemented:
parallel bounded current/legacy discovery, terminal Android/extension update
requirements, Google Play update link and Retry, and migrated-source ChromeOS
guidance in Compose. The new extension never issues legacy pairing or authority
commands. Fixed-host CSP permits only HTTP status discovery on legacy ports.
Compatibility implementation committed as 38f469f5. Installed controlled
extension-driven evidence passes on API 28/35 as above. Stop condition met.

Remaining: actual physical installed replacement in an isolated library,
production extension/app identity and launch/component routes, Play signing
continuity and actual store deliveries, historical browser-local fallback,
API 26/27 policy, broader old extension cohorts and user recovery summaries.
The test uses separate old/successor extension IDs and disposable APK signing;
it does not prove a Web Store identity-preserving extension update. Reboot
evidence remains 247's standalone cohort. A preparatory old-extension notice
release remains optional and has not been added to the sibling repository.
