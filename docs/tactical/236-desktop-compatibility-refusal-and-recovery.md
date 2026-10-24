# Tactical 236: Desktop Compatibility Refusal And Recovery

Status: **Bounded Linux beta checkpoint complete, 2026-09-29.** Campaign [231](231-jstorrent-migration-working-campaign.md).
Topics: `application-connection-architecture`, `application-view-api`,
`client-surfaces`, `web-ui-design`, `desktop-jstorrent-replacement`.

## Bounded Outcome

Make an incompatible desktop connection a clear, terminal, recoverable UI
state. Qualify the first beta old/new extension/runtime matrix and an
already-open page across package replacement in the claimed Linux guest.
This is a common desktop-extension connection change, not an installer or
protocol redesign. macOS/Windows retain their qualified bootstrap adapters;
their installed package-update matrices remain explicit follow-up evidence.
Stop after deterministic web/extension/native-host gates, packaged guest
refusal/recovery and selected old/new beta pairs pass, with exact hashes,
commands and cleanup. Do not call this complete Rehearsal C.

No legacy engine bridge, importer, personal migration, signed updater route,
production identity, extension store upload, auto-update/reload campaign,
protocol-version bump or stable third-party compatibility promise. Rehearsal C
still requires original legacy packages, intended signed update paths and
platform-specific cancellation/interruption/rollback evidence. An unpacked
extension reload is controlled browser evidence, not a store update.

## Source Review And Decisions

- Native bootstrap protocol 1 and exact extension Origin remain unchanged.
  `rstorrent-native-host::dispatch` rejects unsupported versions before launch.
  The worker checks response ID/version. Its error code must survive into the
  page's connection disposition instead of becoming a generic retryable error.
- Shared WebSocket decoding already rejects unsupported API ranges and invalid
  schemas through `clients/web/src/validation.ts`.
  Desktop currently treats ContractError as transient, which can repeatedly
  retry incompatible replies. Classify that failure terminally for this adapter.
- Matching per-runtime instance/profile identity and `desktop_control_v1`
  remain mandatory. Credentials stay memory-only and are fetched anew through
  attach on reconnect. Existing optional picker capabilities remain optional.
- Incompatible/authentication failures unmount the application and stop the
  retry timer. Offer **Retry connection**, which only attaches. Explain that
  incompatible versions require updating desktop/extension before retrying.
  A stopped runtime still offers explicit **Start**. Open desktop window remains
  an explicit native action. Never reset a library to recover compatibility.
- Do not compare product-version strings as a substitute for protocol and
  capability admission; independently built beta artifacts can share a version.

Official Chrome [native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging),
[worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
and [runtime](https://developer.chrome.com/docs/extensions/reference/api/runtime)
documentation were reviewed. One-shot native messages may create host processes;
worker wakes and extension update events confer no runtime launch intent.
Chrome documents unpacked reload as an onInstalled update event. Do not force
extension reload or keep a worker alive to own the torrent engine.

## Ownership, Bounds And Validation

The existing page connection task owns socket, mounted React application,
AbortController and single bounded-backoff timer. Error classification adds no
background owner, persistent credential, listener or queue. A retry joins prior
cleanup before mounting a replacement. Protocol records, Rust application
contracts, engine state and Android/Crostini routing do not change.

1. Freeze the existing beta extension ZIP and installed old/new Linux DEBs by
   hash; preserve one controlled root/library across selected package swaps.
2. Add deterministic bootstrap/version/identity/schema refusal and manual
   recovery cases, including a 90-second no-retry assertion and no start call.
3. Run complete web typecheck/tests and extension tests/package on the builder;
   native-host tests confirm existing pre-launch protocol refusal.
4. Use a separately identified Chrome for Testing inside the claimed guest.
   Exercise old extension/old runtime, new extension/old runtime, an already-open
   old page/new runtime, and new/new. Distinguish package replacement from
   signed automatic updating. Check fresh instance credentials and retained
   library identity; a joined rollback to the selected same-schema old beta
   preserves that controlled library too.
5. Inject only task-owned bootstrap/protocol fixtures for visible refusal and
   attach-only recovery, recording these separately from real installed pairs.
6. Close owned browser/runtime/helpers; restore all guest installation/profile,
   idle/lock and power state; release the exclusive claim. No host browser use.

Physical Android/Crostini distribution qualification remains required before
shipping a shared extension update. This slice changes only the desktop adapter
and packages nothing publicly. Common build/tests must preserve those paths;
no new Android engine or application boundary needs generation/parity work.

## Builder Evidence

```sh
source ~/.profile
npm run typecheck --prefix clients/web
npm run test --prefix clients/web
npm run check:localization --prefix clients/web
npm run test --prefix clients/extension
npm run package --prefix clients/extension
cargo test -p rstorrent-native-host
node --check scripts/verify-desktop-update-compatibility.mjs
```

User-visible terminal failures show localized guidance without internal error
code prefixes. The final wording build repeats typecheck, full web tests,
localization and packaging, plus installed new/old, refusal/recovery and new/new
checks on the same controlled library.

Final web suite: **428 passed, two opt-in tests skipped**; typecheck and all
localization catalogs/policy pass. Extension: **42 passed**, source/archive/CSP
validation pass. Native host: **17 unit and two integration tests passed**.
Focused desktop connection cohort: 30 passed. Tests cover bootstrap code
classification, schema refusal, required capability versus identity refusal,
cleanup, fresh bootstrap on replacement, terminal 90-second observation and
manual attach-only recovery. A compatible product version string is accepted
only alongside the existing contract/capability/identity checks.

The first localization check caught a dynamically selected message ID and an
unused old failure message. Use statically named message calls and remove the
orphan; regenerate and repeat full web/type/localization/package gates. No
Rust application DTO or generated application contract changes.

## Installed Beta Artifacts And Method

| Role | Artifact identity | SHA-256 |
| --- | --- | --- |
| Old extension | Tactical 234 beta 0.4.0 ZIP, source `662c55f1` | `3b05241b4a8d59abb3e62443137756672bf6d059e3da9d1464e74f8254d7a0be` |
| New extension | This tactical's final beta 0.4.0 ZIP | `a21fb6e52ee720a83987d0b5094a60e1a338014c024cdaa977cbcadd47538533` |
| Old runtime | Tactical 234 Linux DEB, source `bbe24600` | `88b72903d8c8cda83e88a073ff83c0b875787484dcf14f41837dcc8b9608af85` |
| New runtime | Tactical 235 Linux DEB, production source `26c50e2f` | `f797456de043dd7002f5f4bb3d0c537b18f04c7e55ed0efef83d99f3b6c5576c` |

Both beta packages retain their incubation versions/identities; hashes identify
these exact cohorts. These are local DEB replacements and unpacked extension
reloads, not signed updater or store deliveries. Chrome for Testing
151.0.7922.34 (Playwright build 1234), x86_64 ELF, has resolved guest libraries.
The guest is Ubuntu/glibc 2.39. Browser/profile and all native registrations
stay in the claimed guest. Its sandbox stays enabled through an exact,
task-only AppArmor userns profile. No primary/host browser is involved.

A fresh download root is selected through the existing native Settings picker.
The same private 4096-byte metainfo fixture used by the control harness is added,
then paused with zero verified pieces; DHT, PEX, listener and port mapping are
disabled first. Its v1 identity is
`b802168899aecc03c92baafb328d7dff1d529a72`. No peer or transfer is needed for this
compatibility test. Preserve the exact root ID, torrent ID, identity, paused
intent and piece counts across packages. A separate controlled 4480-byte
payload sentinel is created before rollback and independently hashed; it is
not presented as verified torrent content.

Use `verify-desktop-extension-checkpoint.mjs` for `open`, `prepare`, `add`,
`pause`, `remember`, `stopped`, `start`, `stale` and `native` phases.
`verify-desktop-update-compatibility.mjs record <owned-json>` retains sanitized
baseline fields without a credential; `assert-open-page` checks the same
in-memory document survived runtime replacement, `assert-same-runtime` checks
extension replacement kept the engine, and `assert` checks a new instance with
an unchanged library. Set `RSTORRENT_PLAYWRIGHT_MODULE` to the task's copied
Playwright module. All runs execute through Machine Control `testbed -- user-exec`;
package replacement uses `os -- dpkg -i <owned-deb>` only after joined tray Quit.

Chrome initially disabled the reloaded unpacked extension because its test
profile had Developer mode off (`unsupportedDeveloperExtension`). Enabling
Developer mode in that isolated browser restores the intended test precondition;
subsequent real `chrome.runtime.reload()` plus page reopening passes. This
browser-fixture issue is not counted as an installed compatibility success.

### Observed Results

All four selected beta combinations pass the same root/torrent/paused-state
comparison. The old page retains its document marker across old-to-new runtime
replacement; explicit Start attaches it to a new runtime identity. The old
credential is refused without exposing a library. Extension replacement and
reload retain the existing runtime identity. Joined new-to-old desktop rollback
preserves the library and independently refuses the new runtime's old token.
The same-schema beta rollback does not establish rollback for legacy migration.

Two task-native-host fixtures separately test unsupported protocol and a
mismatched response protocol. `desktop-bootstrap-refusal-fixture.py` logs only
operation names and cannot start a runtime. The packaged new extension shows
update guidance and Retry connection, hides the application, and makes exactly
one attach_control request over eight seconds. Manual Retry while still refused
adds exactly one attach_control request. Restoring the original manifest and
retrying restores the same library/runtime, without start_control or launch.
These are scripted native-bootstrap fixture results; real package-pair evidence
is recorded separately above. Unit tests supply the 90-second timer assertion.

Bounded repair: stop/join the runtime, remove only the task-owned content-versioned
host binary and its task-owned standard Chrome manifest, and launch desktop
normally. Both are recreated, the host hash matches the saved hash, and the
extension recovers the same library. The native window independently exposes
the same controlled torrent through AT-SPI. The custom Chrome for Testing
profile manifest points to that same repaired host; no personal registration
is touched.

The controlled payload sentinel remains SHA-256
`2c197ae45182ec61a16856925534ec3bdbf218ddc87c2c7b1b67d2decddfc2cb`
after rollback and the final roll-forward. The paused torrent itself had created no payload file before
Quit; no transfer or verified-byte claim is made by this tactical.

### Final Cleanup

The final packaged extension/runtime pair also passes the wrong-version fixture
and manual repair without a runtime restart. Real tray Quit is followed by two
page reloads, two worker stops and a 35-second stopped observation; the runtime
does not resurrect. The owned browser is then closed through CDP.

Cleanup removes the test DEB, task roots/profiles/native registrations, fixtures,
captures and the exact task-only AppArmor profile (unloaded before deletion).
Process and file checks confirm no owned runtime/browser/helper or installed
executable remains. Initial idle-delay (300 seconds), screen locking and powered-off
state are restored through Machine Control; the exclusive claim is released.
macOS and Windows guests were not used in this slice. Controller/builder scratch
artifacts are removed; build caches are retained. Machine Control is unchanged.

### Remaining Gates

- Installed macOS/Windows old/new package matrices and their installer-specific
  failure/repair/rollback paths; common desktop error handling is tested here,
  while platform installed control/lifetime evidence remains in 232/234.
- Actual signed updater delivery, interrupted/cancelled replacement, store update
  scheduling and a retained stable compatibility baseline.
- Legacy/successor combinations, an already-open legacy engine page and writer
  fencing; these require the separate migration design, not these beta pairs.
- Physical ChromeOS Android/Crostini qualification before any shared extension
  shipment, plus broader browser/OS suspension and endurance.

No importer, personal data migration, production identity/route change, push,
publication, tag or release has occurred. Rehearsal C remains partial.
