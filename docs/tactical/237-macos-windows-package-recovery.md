# Tactical 237: macOS And Windows Package Recovery

Status: **Complete, 2026-09-29.** Campaign [231](231-jstorrent-migration-working-campaign.md).
Topics: `client-surfaces`, `application-connection-architecture`,
`desktop-jstorrent-replacement`, `beta-release-readiness`.

## Scope And Stopping Condition

Extend 236's selected beta matrix to installed macOS arm64 and Windows x86_64.
Preserve one fresh native-selected controlled library across old/new extension
and desktop pairs, an already-open page, joined rollback and registration repair.
Record exact artifacts, commands, source, architecture/runtime compatibility,
negative results and cleanup. Stop this slice after both platform matrices and
bounded repair pass or a concrete external blocker is recorded. Do not infer
signed automatic updating from local package replacement.

The authorized following slices are signed update-path qualification using
existing published artifacts, then bounded sleep/wake and browser-restart
recovery on macOS/Windows/Linux. Give each its own tactical before execution.
If current signed artifacts predate extension control, record that distinction;
no publication, push, tag, route/key/identity change or fabricated signed
candidate. Importer work and personal-data migration remain excluded.

## Invariants, Ownership And Bounds

One runtime/library; extension pages are detachable connections. Quit joins
owned work, passive reconnect never starts a runtime, explicit intent may.
Tray Open uses the native window. No browser-profile routing preference.
Only same-schema selected beta rollback is claimed. Preserve exact torrent/root
identity and intent; independently hash controlled bytes. Credentials stay in
page memory and must fail after runtime replacement. A missing registration
is repaired by normal desktop launch, never by weakening origin admission.

Reuse 236's bounded scripts and 232/234's platform-native UI/transfer harnesses.
Tests own their browser, fixture processes, scratch paths and exclusive claims.
Close/join before replacing executable files. Record inherited guest paths and
OS registrations before installation; restore them and initial power state.
No engine/protocol/Android contract change is planned. Any discovered runtime
fix needs a local owner/cancellation analysis and proportional builder tests
before installed reruns.

## Source Review And Ordered Evidence

Review 232/234/236, the desktop release runbook and 230, exact Tauri updater
and native-registration code, official [Tauri updater](https://v2.tauri.app/plugin/updater/)
and [Chrome native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
contracts. Updater signatures remain mandatory; custom test-browser manifests
are explicit fixture setup, distinct from installed standard registration.

1. Freeze old packages and current extension; rebuild candidates incrementally.
   Run builder tests before guest installation, verify architecture/deployment
   target and compare installed hashes.
2. Doctor, claim and supported readiness; inventory inherited state. Use only a
   separately identified Chrome for Testing inside the claimed guest.
3. Native-select a fresh root; add/pause a controlled fixture. Exercise old/old,
   old/new with its document still open, new/new and new/old rollback. Observe
   unchanged library and bytes, new runtime identity, refused stale authority.
4. Delete only owned native registration/host after joined Quit; ordinary launch
   repairs it. Test terminal incompatibility and attach-only recovery.
5. Quit, check passive no-resurrection, reap owned browser/helpers, restore
   inherited installation/registration/state, remove scratch, park and release.

## Starting Checkpoint

Clean source `cee8ff04` includes Linux repair `26c50e2f` and final extension
compatibility handling. Retained macOS old executable matches 234's SHA-256
`e3a3fc17ce2aed822f118ffca61f784d886def7816bfbc341b27c2007b33ff8e`.
Current extension matches 236's `a21fb6e52ee720a83987d0b5094a60e1a338014c024cdaa977cbcadd47538533`.
macOS doctor reports an available suspended guest and unlocked host resume
precondition; no guest mutation yet. Recheck Windows availability independently.

## Builder Finding: Singleton Source Gate

The installed-artifact preparation runs the release configuration tests too.
Their checked-source case fails because 235 moved singleton creation behind
`single_instance_plugin()`, while the guard still searches for an inline
Tauri call. Update the guard to the actual platform factory, retain the
singleton-before-deep-link requirement, and add removal/reordering regressions.
This is a release-validation repair, not a runtime or dependency change.

The next assertion also assumed 234's retired inline macOS file-URL filter.
Check the current application `RunEvent::Opened` forwarding call instead,
which delivers all URLs to the existing bounded classifier after plugin
delivery. Add a dropped-input negative fixture. Both corrections retain the
release safety invariants while matching the installed-qualified code shape.

After the fixes, `node --test scripts/validate-desktop-release.test.mjs
scripts/validate-desktop-package.test.mjs scripts/desktop-release-input.test.mjs`
passes all 21 tests. `node scripts/validate-desktop-release.mjs` and
`node scripts/validate-desktop-package.mjs --mac-app
target/debug/bundle/macos/RSTorrent.app` pass. macOS desktop library tests pass
53 cases and incremental unsigned app packaging succeeds. Runtime production
source remains `cee8ff04`; validation-only edits do not change that artifact.

## macOS Installed Matrix

Claimed macOS 26.6.2 arm64 guest, inherited suspended. Normal native launch and
Settings > Downloads > Add folder selected a fresh controlled root. The old
package desktop hash is recorded above; current debug desktop SHA-256 is
`dcc8899f38ea0abe94f8d64556e22782ef508746ca0cea2e71b622d74b7958e2`.
Both use the bundled native host SHA-256
`9737e093124c933864b25031ab1a27679e6e055c204fb29423cab3a292429000`.
Desktop minimum macOS 13.0, host minimum 11.0; arm64 and system dependency
inspection precede transfer. The guest satisfies both. Separately identified
Chrome for Testing 151.0.7922.34 is sandboxed with a task-owned profile.

Old extension rebuilt from `662c55f1` reproduces 234's exact archive SHA-256
`3b05241b4a8d59abb3e62443137756672bf6d059e3da9d1464e74f8254d7a0be`;
new extension is 236's frozen artifact above. The paused 4,096-byte no-peer
fixture retains its torrent/root identities and zero verified pieces in every
combination. An independent 37-byte root sentinel retains SHA-256
`850b2892d2dc35b290bde732f7465acc0e57f99de0869448f3b60e225cb9a1f0`.

Using `verify-desktop-update-compatibility.mjs record/assert-open-page/
assert-same-runtime/assert`, and checkpoint `remember/stale/start/stopped`:

- old extension/old desktop: native-created controlled library recorded;
- old extension/new desktop: joined Quit, local app replacement, explicit Start;
  the old page's document marker and library survive, runtime identity changes
  and retained old credentials fail without library disclosure;
- new extension/new desktop: real extension reload keeps the same runtime and
  library (developer mode enabled only in the owned test browser);
- new extension/old desktop: joined same-schema rollback changes runtime
  identity, preserves the library/sentinel and refuses stale authority;
- controlled unsupported-protocol native-host response: exactly one attach
  attempt across eight seconds, hidden application and actionable Retry;
  manual Retry adds exactly one attach, no start. Restoring the owned manifest
  and Retry attaches to the unchanged runtime/library;
- roll forward current desktop, remove only its owned versioned host and
  configured ChromeForTesting registration, then normal desktop launch: both
  are repaired with unchanged host hash; native UI independently shows the
  same paused fixture. Custom-profile manifest setup is separate fixture
  wiring, not evidence of standard-path discovery.

No signed update or legacy replacement is inferred. The fresh library is
reused by 239 before cleanup. Windows old installer SHA-256 is
`7a4d6d19ba858a5435efce23ae484e86e8d6ff4e52ab68be37be592e3dbe8fc9`;
its installed desktop matches 234's
`92eebfa23ded6c694a28f70838de8043dc09fc6c6db67c1e5c07767100ca8c9a`.
The cached Windows builder passes 50 desktop library tests. Packaging first
stops on missing cargo-about; restoring pinned 0.9.2 to a task-only PATH lets
incremental NSIS packaging pass. New installer SHA-256 is
`54dab7e62ba6b47a56550688fb506f86c407352f6ab72e68db92f5ace34affae`.
Inherited installation/profile/registry and source-overlay receipts remain
preserved until the Windows installed matrix and final restoration finish.

## Windows Installed Matrix

Windows 11 x86_64 build 26200 was inherited off. Exclusive claim and supported
readiness/login succeeded. Before installation, preserve five inherited paths,
319 inherited file hashes, eight registry keys (including manufacturer install
location), and 1,482 source-overlay receipts in task-only storage.

Old/new desktop and extension combinations pass using the same semantic
runners as macOS. Old extension/new desktop preserves its already-open page;
new extension/new desktop attaches to that same owner; joined rollback to old
desktop retains the paused torrent/root and refuses the former credential.
Explicit unsupported bootstrap protocol is refused without replacing the owner.
An unpacked extension reload initially becomes disabled because developer mode
is off; enabling it in the owned Chrome for Testing profile and restarting
that browser loads the new extension and attaches to the unchanged owner.
This is test-browser setup, not a product update failure.

Current installed desktop SHA-256:
`2f4d6399a50b67b7e99048996d096b743c9696c196a5532c5a296049ad97d8cf`.
After joined Quit and roll-forward, remove the owned registered host/manifest
and both HKCU Chrome/Chromium native-host keys. Normal native launch recreates
them and preserves the library. The versioned host matches the newly installed
bundle SHA-256
`b179d8910330fcc11f86fa527d3fe11f5ddbf04d3118d19ecde83e8c4b32fa3d`.
Do not compare this with the deleted old package's versioned host: repair
correctly selects the new bundled content. Controlled sentinel SHA-256 remains
`bda73628456f4dbce1281d1ec2efa6a5d91c6e15da70e6b3bd2d0d3f49cda256`.

Native tray Quit, 35-second stopped observation, real browser close/restart,
two passive page reloads/worker stops and another 35-second observation leave
no runtime. Explicit Start succeeds. The same owned library is used for 239's
verified transfer, then moved aside for 238's separate signed cohort. Original
inherited state is restored after the signed cohort: all 319 file hashes, eight
registry exports/absence states and 1,482 source-overlay paths verify. Owned
processes and the task directory are absent. Incremental build caches remain.

macOS final cleanup is complete after 238/239: no owned runtime/browser/helper
remains; owned bundles, manifests, profiles and payload are removed. Inherited
LaunchServices dictionary matches its backup. Guest is suspended and its claim
is released. Windows restoration passes the exact receipts above; the guest
is returned to its initial off state and its claim is released.
