# Android Ordinary Writer Upgrade

Status: Complete controlled ordinary-writer checkpoint, 2026-09-30.

## Scope And Stopping Condition

Confirm the private registry's ChromeOS control route and Android package
inventory through Machine Control. Preserve existing physical installations.
Extend the owned-emulator upgrade runner to exercise the released JSTorrent
1.0.24 application's ordinary settings, torrent intake and session writers,
rather than inserting legacy KV/settings fixtures. Prove controlled payload
transfer, two real SAF roots, replacement with the old app running, retained
settings/torrents/grants, successor checking/resume and restart/reboot.
Stop when the repeatable controlled case passes and evidence/gaps are recorded.

Read owners: android-jstorrent-replacement, android-saf-storage,
client-persistence, download-roots, client-surfaces, application-view-api,
web-ui-design, product-surfaces-and-migration, capability-readiness and
oracle-driven-engine-campaign; predecessor 245/246 define source and importer.

## Constraints And Non-Goals

Use the exact released APK/source pin from 245/246, independently authored
payload/metainfo and the existing controlled libtorrent oracle. Do not write
legacy torrent/settings storage in this mode. OS intents and accessible UI
invoke old product writers; test instrumentation may only prepare input files
or inspect state. No production key, Play update, branding, extension migration,
public swarm, API 26/27 policy, historical-wide claim or physical replacement.
No new engine behavior or public contract is implied by the test slice.

One runner owns temporary source APKs/test certificate, owned AVD, controlled
loopback seed/tracker, fixture paths and logs. Every thread/process has bounded
startup/observation and joined cleanup. Refuse an existing AVD; select only its
serial. Preserve attached personal devices and physical testbed app data.
Use Machine Control's common doctor and platform ADB/administration interfaces;
no private endpoints or target values enter this repository's new artifacts.
Keep old source logical state and payload available for comparison; a running
old SQLite writer may checkpoint bytes during replacement, so logical state is
the authority for that case. Foreign bitfields remain untrusted.

## Source And Oracle Inspection

JSTorrent pin 7b454be4410385f9c4f7f135cb6b16194a2b0409:
NativeStandaloneActivity.handleIncomingIntent/handleTorrentFile,
TorrentListViewModel.addTorrent/confirmFileSelection, NetworkSettingsScreen,
SettingsViewModel, RootStore and existing 245 session/native persistence paths.
Use ordinary content/torrent intake and native Compose setting/control actions.

Libtorrent pin 7d7fc38fac61177fa5e02148f791b2f65250b09d:
src/torrent.cpp::on_resume_data_checked and test/test_checking.cpp::test_checking
(incomplete, corrupt, force_recheck and read-only checking) reaffirm independent
byte verification and no foreign resume trust. Reuse the repository's loopback
libtorrent test session; no source or fixtures copied from references.

## Evidence And Restart Checkpoint

Machine Control registry lists a controller-supported ChromeOS target. Common
doctor passes SSH, unlocked profile, accessibility, input and current-boot
readiness. Platform ADB authorization succeeds. Read-only package inventory
finds legacy 1.0.23 and the RSTorrent debug package on Android API 33. No app was
installed, cleared, launched or replaced on the physical device. ChromeOS does
not expose target-use claims; its declared unsupported claim policy is honored.

`run-legacy-upgrade.py --source ordinary` now drives the unmodified released
APK's native Compose settings, content-URI torrent intake, file/root selection
and Pause All action. No old instrumentation, KV or SharedPreferences insertion
is used. Host fixtures supply only independent metainfo; old engine/provider
writes all downloaded payload and persisted session state.

Executed evidence:

- `PYTHONDONTWRITEBYTECODE=1 uv run --project tests/interop --locked python
  clients/android/scripts/run-legacy-upgrade.py --api 35 --source ordinary`:
  three installed assertions pass (upgrade, process restart, device reboot).
- The same command with `--api 28`: the same three assertions pass.
- Released UI writes explicit Wi-Fi/unmetered, DHT/PEX off and disabled
  encryption. Source KV/preferences are read back and successor mapped Wi-Fi,
  DHT/PEX/encryption are asserted. Existing show-selection defaults are used.
- A 256 KiB torrent downloads and hashes exactly on root A, then Pause All
  persists stopped intent. A separate 4 MiB torrent on root B transfers at least
  one piece and remains incomplete/running at replacement. Both source KV's
  downloaded counter and host seed progress enforce the partial precondition.
- Replacement uses the existing disposable-signature/same-package/version-25
  test lane without force-stopping the old app. Its process is gone after
  replacement; UID, two source root bindings and real read/write grants survive.
  The importer reports two imported/zero skipped. Stopped intent remains stopped;
  the incomplete torrent finishes under the successor. Independent whole-file
  SHA-256 and full verified-piece counts pass on both roots after each phase.
- The runtime peer oracle is the existing locked libtorrent 2.0.13.0 package,
  on loopback only via scoped ADB reverse; no public swarm or LAN listener.
- Gradle debug APK/test APK assembly and `./gradlew testDebugUnitTest` succeed
  (113 unchanged unit checks reused). New assertions are opt-in and
  skipped by ordinary instrumentation runs. Product/runtime/Rust/ABI/application
  DTO code is unchanged; no Rust or web baseline repetition is needed for this
  test-only slice. `git diff --check` and local documentation links pass.

The released picker starts in its own Download/JSTorrent directory, so owned
root A/B are distinct child trees there. Dropdown names include free-space
suffixes. Use observed accessibility labels/bounds for selection. The seed uses
tracker-free metadata of the same identity: otherwise the controlled tracker
advertises it to itself and libtorrent bans the shared loopback address.
`ignore_limits_on_local_network=false` is required for the partial-transfer
rate limit; merely setting a global rate can leave the source already complete.

Each run removes its owned AVD/emulator, fixture files, APKs, disposable key,
tracker/thread/seed and logs, and rebuilds the ordinary incubation identity.
Attached personal devices and physical Chromebook app data are untouched.

Restart checkpoint: the ordinary standalone writer/active replacement/two-root/
resume/reboot case is complete on API 28/35. Next qualification remains broader
historical captures (including the installed 1.0.23 cohort), removable/provider
failure, imported-private-root UI/delete workflows and production signing/intake
continuity. Browser-owned Chromebook sessions still need their own migration
strategy. This does not claim a physical installed upgrade or Play delivery.
