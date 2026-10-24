# Tactical 252: Opt-In JSTorrent Installed Upgrade Rehearsal

Status: **Bounded three-platform HTTPS updater checkpoint complete, 2026-10-01.
Linux ordinary GUI, broader cohorts and extension cutover gates remain open.**

Owners: `desktop-jstorrent-replacement`, `product-surfaces-and-migration`,
`beta-release-readiness`. Generic routing belongs to `simple-app-update-server`;
private deployment configuration belongs to dotfiles.

## Scope And Stopping Condition

Plan one bounded end-to-end desktop checkpoint: an exact released JSTorrent
0.2.1 installation receives a pinned, original-key-signed CI successor through
its ordinary HTTPS updater, installs/relaunches and migrates generated legacy
state. Start with Linux x64 AppImage, then independently qualify Windows NSIS
and macOS after Apple notarization is available. One passing platform does not
close the complete cutover checklist.

Implement and locally test an opt-in server cohort before reviewing its live
deployment. The existing release already sends `X-CFU-Id`; explicitly registered
test installation IDs can select a pinned candidate response on the existing
URL. Ordinary/missing/unknown IDs keep the existing production release selection.
There is no required old-client rebuild, intermediate old-app update or new
client-visible channel. The maintainer accepts this validation plan; a concrete
external deployment still follows implementation, testing and review.

Stop the first implementation slice with local cohort-routing negative tests,
reviewable pinned artifacts/deployment/disable configuration, and the Linux
installed happy path plus wrong-signature and interrupted-download/retry evidence,
or exact prerequisites recorded. Complete work needed for review before seeking
authority for an external deployment. Public default-feed promotion is separate.

Non-goals: shipping two products, automatic rollback/downgrade, personal profiles,
production extension/store updates, Android migration, public swarms, every old
release, or selecting candidates automatically from mutable GitHub Latest.

## Source Survey And Dependencies

- JSTorrent `tauri-app-v0.2.1`, commit
  `73427b7d3aef2eaf1c4ac1409922fbb52dff751d`: desktop
  `tauri-app/src-tauri/tauri.conf.json` retains the ordinary production endpoint
  and root; `src/lib.rs` sets `X-CFU-Id` for GUI checks and exposes
  `--check-update` / `--auto-update`; `src/headless_updater.rs` sets the same
  header and invokes actual download/install/restart; `desktop/common/src/lib.rs`
  persists the generated ID in `jstorrent-native/cfu-id`.
- `simple-app-update-server/src/{server,channels,github}.ts`: current channel
  selection uses query parameters, the installation ID is currently analytics
  input only, Tauri responses use `no-store`, and release selection comes from
  per-product/channel caches. The opt-in route is now implemented and locally tested in server commit
  `f45885c`; deployment/installed evidence remain separate below.
- Successor `clients/desktop/src-tauri/src/{updater,update_channels}.rs`: legacy
  ID adoption is bounded, header emission follows metrics preference, and update
  responses must confirm a discovered client channel. An internal cohort must
  preserve Stable/Latest semantics rather than invent a Beta channel. Disabling
  statistics must not break normal updating; do not force identifier emission.
- Tactical 251 supplies exact original-key Windows/Linux artifacts from CI
  run 36831643488. All eight available payload signatures and 16 receipt hashes
  independently pass. A failed-only retry now passes both macOS app/DMG
  notarization checks. Fresh complete run 36845370571 passes all five lanes,
  exact release collection and all ten original-root updater payload signatures
  on source `19eb3a88703088a2dfebb803342394938d305cb8`. Use this complete
  same-attempt candidate for the trial; installed migration remains unqualified.
- Reuse 242/243's independently checked released writers, multi-profile fixture
  generation, closed catalog inspection, fencing and source/payload oracles.

## Ownership, Bounds And Invariants

The generic service owns a pure, explicit cohort selector and validated static
candidate input, using existing request/server shutdown ownership. No new engine
task, DTO, client beta toggle or dynamic release-publishing system is needed.
Read the server's own repository instructions before implementation there.

Keep test IDs in private deployment configuration and use generated guest IDs.
The existing analytics ID is a cohort selector, not authentication or a secret.
Bound the first cohort to 32 canonical UUIDs, five supported updater targets and
a 64-KiB candidate manifest. Pin candidate source SHA, version, payload URLs,
sizes/hashes and original-key signatures. Candidate assets need ordinary HTTPS
URLs usable by the old updater; GitHub Actions downloads alone are not that
delivery surface. A public GitHub release is not required for owned test assets.

Validate exact-match selection, no ID/malformed/unknown ID, unsupported target,
equal/newer installed version, unavailable candidate, failed configuration and
cross-cohort requests at the same URL. Candidate requests must not populate
ordinary caches. Keep responses uncached at the proxy too. Trial configuration
defaults disabled; disabling it restores ordinary selection without downgrades.

Use Machine Control's exact claimed guest and explicit desktop grant, with
restoration of inherited state and joined cleanup. Back up/snapshot both product
state and generated payload; an OS snapshot does not cover external folders.
Do not weaken TLS/signature/OS-signing checks. Read-only checks are followed by a
real install inside the guest; do not call a version-response check migration.

## Installed Validation Sequence

1. Install checksum-pinned old release, generate paused legacy records through
   its ordinary writers across two profiles, and record settings/root bindings,
   catalog/source and independent payload hashes. Start with 242/243's valid,
   corrupt, pending-magnet and missing-root cohort; no public network activity.
2. Opt in that guest ID. Run old `--check-update`, then actual `--auto-update`.
   Verify offered version, signature refusal negatives, installed executable
   bytes/OS identity, relaunch and exactly one successor owner. Repeat using the
   old UI's ordinary Check for Updates / Install & Restart interaction.
3. Inspect imported/already-present/skipped outcomes, supported settings, union
   and simple duplicates, paused intent, ordinary full checking, actionable
   unavailable storage, preserved source and unrelated payload. Restart and prove
   one import marker and stable identities. Repair corruption only through normal
   controlled transfer/recheck behavior with expected resulting hashes.
4. Interrupt download, retry and reject a corrupted/wrongly signed payload
   without replacing the old app or damaging state. Exercise running old hosts,
   denied registration and restart around migration's existing transaction
   checkpoints. Keep a recovery baseline with all torrent writers stopped.
5. Add legacy/successor extension pairs and file/magnet/toolbar/tray journeys.
   Qualify Windows and macOS independently; then address production Android/Play
   signing, emulator/physical SAF and staggered ChromeOS stores separately.

## Shipment Boundary

This rehearsal increases confidence in actual delivered behavior; it does not
authorize a rollout. The full checklist retains platform coverage, historical
cohort dispositions, physical/store tests, interrupted installation and recovery,
and final stop/rollback responsibilities. Restore normal test routing and remove
owned guest files/services/claims when each run ends.

## Execution Checkpoint

The maintainer directs end-to-end execution and commits as each slice lands.
Implement and test the server route first, retain exact complete CI candidate
identity, then perform owned installed Linux/Windows/macOS and extension trials.
Any test deployment keeps ordinary user selection and store/default-feed
promotion outside scope. Target identity and consent remain explicit gates.

### Server And Authenticated Candidate Preparation

`simple-app-update-server` commit `f45885c` adds one private 64-KiB trial
manifest with at most 32 canonical installation IDs and five pinned platform
payloads. Exact product/channel/ID selection precedes ordinary cache lookup;
missing/malformed/unknown IDs preserve ordinary selection, selected equal/newer
versions and unsupported targets return 204. Invalid trial configuration leaves
ordinary startup available. Discovery, downloads and other products are unchanged.

Optional local assets use exact configured HTTPS hostname/path pairs, startup
size/hash validation, 64-KiB streaming buffers and disconnect cancellation. There
is no directory listing or upload route. Each asset is bounded to 512 MiB; the
existing five-target limit bounds the total startup scan. Files remain immutable
while enabled. Disabling the manifest and restarting removes selection/delivery.
The installation ID is a selector, not an authentication credential.

Validation: `npm run check` passes lint, TypeScript and all 86 tests, including
ordinary-cache isolation, channel/product/discovery/installer continuity, malformed
IDs/configuration, equal/newer versions, unsupported targets, exact delivery and
HEAD, wrong-host/query/traversal refusal, changed/missing/symlinked assets.
`npm run build` and `git diff --check` pass. No dependency is added.

Complete run 36845370571's downloaded 23 asset receipts and all ten updater
signatures independently pass. `scripts/prepare-jstorrent-upgrade-trial.mjs`
checks the complete receipts again, verifies the five actual delivery payloads
against the original root, and emits a private manifest plus
[candidate receipts](../evidence/jstorrent-upgrade-trial-252-candidate.json).
The generated test IDs stay outside the repository. URLs are prepared for owned
HTTPS delivery; no trial is enabled on the live server at this checkpoint.

Linux and Windows exact x64 test appliances are available through their Linux
controller; the local macOS test appliance is separately claimed. Claim identity,
credentials and concrete machine selectors remain private. Restore initially
powered-off guests to off, and initially suspended macOS to suspended.

### Signed Manual Replacement Checkpoint

Before live deployment, the exact signed 0.3.0 CI packages pass the extended
242/243 installed rehearsal on Linux x64 AppImage, Windows x64 NSIS and macOS
arm64. This uses manual package replacement, not the old updater. The sanitized
[three-platform evidence](../evidence/jstorrent-upgrade-trial-252-manual-migration.json)
records old/new package hashes, candidate source/run and each finished outcome.

Ordinary released writers create four stopped records across two profiles.
Closed imported catalogs, before and after native Quit/restart, preserve DHT/PEX
false, peer limit 73, upload slots 5 and download limit 65,536 bytes/s. Four records
import with zero skipped/already-present; intent remains paused. Intact content
rechecks successfully, corrupt/missing content has zero verified pieces, and the
pending magnet trusts no metadata. Missing roots stay absent. One completion
marker and stable IDs survive restart. Source discovery/KV/main/nonempty WAL and
independent payload hashes remain unchanged. This does not prove repair transfer.

A pre-handshake old host and denied helper registration each stop startup before
catalog creation. Retry after repairing registration succeeds. Eight Windows,
six Linux and nine macOS executable registration routes return the exact legacy
extension refusal. These probes do not qualify real mixed-version extension UI.
The Windows view shows four rows, no Active rows, three Paused and one Needs
attention, with the unavailable root showing Storage unavailable. Native tray
text still says RSTorrent in this candidate: the separate Tauri catalog correction
is committed in `34889e3e`, after the candidate's pinned source. Its focused Rust
test, all four localization checks and formatting pass; a fresh signed candidate
must qualify that correction. The reused Windows guest shortcut shows an old
incubation icon. Independent 7z extraction of the pinned NSIS executable and
Windows `ExtractAssociatedIcon` proves its embedded icon is the JSTorrent blue
box; fresh-install shell-cache behavior remains a presentation qualification.

Initial operator-timeout attempts restore their owned files rather than claiming
success. The final three manual runs pass. Mac phase control uses the common
resident AX route with freshly discovered product Quit/OK controls; Linux Quit
uses the freshly introspected exported status-notifier menu, and Windows uses
fresh tray/UIA discovery. No outer VM input, privacy acknowledgement, network
allowance or public swarm is used. Windows Cancel creates four task-specific
firewall Block rules across the runs; exact-program/baseline-guarded cleanup
removes those four and the original rule-name set matches. File/registry scopes
restore, macOS inherited backup directories are empty and product owners join.

### Prepared Real-Updater Driver And Remaining Gate

The installed drivers accept `--trial-installation-id PATH`, optional
`--trial-gui`, and `--trial-negative wrong-signature|interrupted`. Stage the shared
`legacy_desktop_signed_update.py` with the three existing fixture/rehearsal
helpers. Trial mode performs the startup fences, restores the exact old package,
and parks at `ready-for-signed-update` for the controller's owned `allow-update`
file. It writes the generated guest ID to the isolated old configuration, removes
stale check output and invokes the unchanged released `--check-update` followed
by `--auto-update`, or the ordinary old GUI. Real installation requires the
pinned AppImage/desktop executable bytes, joined updater-spawned owners, the same
catalog/settings/source/payload assertions and native restart. Negative mode
parks at `negative-complete` until owned `allow-retry` after valid routing returns.
At this earlier checkpoint the real-updater branches were unexecuted; the
subsequent execution sections record their actual installed evidence.

Linux keeps AppImage's supported extract-and-run environment across Tauri restart;
FUSE launch remains a separate lane. Windows preserves both expected per-user
install locations, its production torrent class and both registry views. Cleanup
joins exact installation-owned processes, including updater-spawned children,
before restoring files. A real macOS process smoke proves exact ownership stops
the task child while an adjacent application remains running. Python compilation,
`--help`, malformed-ID/tampered-receipt refusal before manifest output and
`git diff --check` pass. No Rust DTO/schema/engine behavior changes in this slice.

At this earlier checkpoint live deployment was disabled pending explicit
push/test-deployment authorization under the repository's no-push rule. Server commit
`f45885c` and the private three-ID manifest are reviewable; existing ordinary
product/channel configuration is retained. Deploy only that tested server commit,
build before restart, configure immutable authenticated assets plus the private
manifest, and verify ordinary/malformed/unknown-ID responses before opening any
`allow-update` gate. After test completion, remove the trial environment/config,
restart and verify ordinary selection. Do not publish a GitHub release, promote
the default feed or modify a store item.

At this earlier checkpoint, HTTPS old-client installation, GUI restart,
signature/interruption negatives, controlled repair and real extension/file/
magnet/toolbar journeys remained open. These depend on the trial and further owned validation; the
three-platform manual result does not close P-01 or full cutover acceptance.

### Clean Stop And Resume Input

Final guest cleanup independently verifies finished phases, empty inherited
backup directories, no product owners, restored file/registry scopes and the
original Windows firewall baseline before removing each exact owned fixture and
staging directory. Linux/Windows return to their initially off state; macOS
returns to its initially suspended state. Claims are released after lifecycle
confirmation. Owned staging servers, temporary downloads, IDs/configuration,
logs and captures are removed. Source and sanitized evidence remain committed;
no test route is enabled.

After push/test-deployment authorization, resolve fresh testbed availability
through Machine Control and recreate generated guest IDs/fixtures. Download
complete artifact `desktop-release-rehearsal-manifest-36845370571-1` from run
36845370571 in `kzahel/rstorrent`, then rerun the checked-in preparer against
its recorded source and receipts. CI retains this artifact for fourteen days;
if unavailable, require a fresh complete signed candidate and new receipts,
not a mutable Latest substitute. Deploy/restart the tested server route with
ordinary selection intact, verify cohort isolation over HTTPS, and run the
prepared actual-updater branches before advancing the remaining acceptance rows.

### Authorized Live Trial, 2026-10-01

After reviewing exact installation-ID isolation, the maintainer explicitly
authorizes pushing and deploying the test-only trial. Server commit `f45885c`
is pushed, built and restarted with the existing product descriptor retained.
The complete CI artifact is downloaded again; all 23 receipts and five delivery
signatures pass before enabling the private three-ID manifest and immutable
assets. Six no-ID baseline responses, across three targets and two installed
versions, remain byte-identical after the server deployment. With the trial
enabled, 27 HTTPS checks prove missing/malformed/unknown IDs retain those exact
responses and each owned ID receives the pinned candidate. Windows is currently
claimed by unrelated acceptance work and is left untouched; Linux and macOS
are freshly claimed for actual installed updating. No default-feed promotion,
public release, tag, or store change occurs.

### Actual HTTPS Installation And GUI Source Oracle

The unchanged released headless updater passes check/download/authentication/
install/relaunch on Linux x64 and macOS arm64. The normal macOS application-menu
Check for Updates and accessible Install & Restart button also deliver the exact
candidate executable and pass the four-record, settings, checking, missing-root,
registered-refusal, stable-ID/single-marker and payload/restart assertions.
Linux rejects a valid-envelope signature for the wrong payload, preserving the
old installation, then installs after valid routing returns. Interruption after
real download progress also preserves the exact old AppImage hash; retry passes
the same migration/restart assertions. The shared driver now checks the legacy
primary executable hash itself for future negative attempts.

The first macOS GUI attempt reaches the exact installed successor but fails the
frozen-source oracle: reopening the old GUI changes rpc-info and writes its
active SQLite database, despite identical key/value contents. The inactive
profile remains byte-identical. The corrected GUI oracle requires all legacy
values and inactive-profile bytes to match, freezes the source after the old
writer joins and the successor quits, then requires every source byte unchanged
across successor restart. Frozen headless/manual paths still require the entire
original source byte-for-byte. The corrected macOS GUI run passes. Direct
source-guard probes reject changed logical values or inactive-profile bytes.
Python compilation and `git diff --check` pass.

The initial Linux GUI attempt renders an empty legacy WebKit window in the VM
and exposes no Install control. Its owned cancellation restores all file scopes;
it does not qualify the UI path. A separate rerun uses the repository's existing
WebKit DMA-BUF renderer test setting without changing either signed app. Windows
remains held by another active exclusive claim and is not operated. These gates,
real extension journeys, repair transfers and broader cutover qualification are
still explicit remaining work.

### Final Trial Disposition And Restart Checkpoint

[Installed evidence](../evidence/jstorrent-upgrade-trial-252-installed.json)
records six successful runs: Linux headless automatic upgrading, wrong-signature
refusal/retry and interrupted-download/retry; macOS headless upgrading, ordinary
GUI upgrading and wrong-signature refusal/retry. The macOS negative checks the
exact old executable hash. All passing runs reuse the four-record, two-profile,
settings, checking, missing-root, registration, stable-identity/marker and payload
oracles. The corrected macOS GUI additionally proves every source byte unchanged
across successor restart. The interrupted Linux AppImage independently matches
the pinned old package hash before and after interruption.

Linux's old GUI remains blank under default Wayland, disabled DMA-BUF and
software-compositing/X11 configurations. Native captures and empty accessibility
results confirm this rendering gate; the updater's GUI Install action was not
executed. Three bounded cancellations restore files. The unsuccessful first
macOS GUI source-oracle attempt also restores before its corrected passing rerun.
These are recorded unqualified attempts, not extra migration passes. Windows
still has another session's exclusive claim; no guest operation or claim takeover
is performed. Existing manual Windows evidence is not substituted for updating.

The server code remains deployed, but the private trial drop-in/manifest and all
owned candidate files are removed. A restart restores ordinary selection for all
three formerly opted-in IDs: 24 HTTPS response comparisons match the original
six baselines, and all five candidate asset GET paths return 404. HEAD on an
unknown path returns the existing normal handler's 405; delivery-disabled checks
use GET rather than treating that method refusal as an asset-serving failure.
No product descriptor, release, default feed, store or client signing input is
promoted or changed by the trial. The ordinary service remains active.

Resume Windows only after fresh claim availability. Qualify the old Linux GUI
on a representative supported rendering/package environment before claiming its
ordinary UI update; do not patch/rebuild the old app to manufacture that proof.
Use newly generated IDs and the authenticated complete candidate receipts for
any future isolated trial. Production rollout, extension journeys, controlled
repair and the complete cutover matrix remain open.

Cleanup verifies all six Linux and four macOS attempts finish restoration with
empty inherited backups and no owned product processes. Exact fixture/staging
roots and the three task captures are removed. Linux returns to its initially
off state; macOS returns to suspended; both claims are released. Windows remains
untouched. The staging HTTP server is stopped, controller-only candidate/legacy
downloads and generated IDs/configuration are removed, and only sanitized
checked-in evidence remains. Repository work is committed locally; only the
explicitly approved update-server commit was pushed.

### Authorized Windows Follow-Up

The maintainer directs the Windows updater rehearsal once its exclusive claim
becomes available. Reuse the complete authenticated CI candidate, generate a new
private installation ID, preserve the ordinary feed, and exercise the released
automatic and ordinary GUI paths plus wrong-signature and interrupted-download
retry. Require exact installed bytes, the existing migration/source/payload
oracles, joined ownership and file/registry/firewall restoration. Return the
appliance to its initial powered-off state, remove the isolated trial and commit
sanitized evidence. Production feed promotion and extension journeys stay outside
this bounded follow-up.

Windows automatic updating now passes: the unchanged released HTTPS updater
downloads, authenticates and installs the exact NSIS candidate in the original
installation directory, removes the old desktop executable and relaunches the
successor. All four two-profile imports, supported settings, content checking,
eight registered refusal routes, stable restart identities/single marker and
source/payload preservation pass. Joined cleanup restores files and both HKCU
registry views; the four test-generated firewall block rules are removed by exact
application scope and the original rule-name set matches. The fresh one-ID trial
passes eight HTTPS isolation comparisons. Ordinary GUI and negative retries are
the next executable steps before trial disable and appliance power restoration.

The first Windows ordinary GUI attempt installs/relaunches the exact candidate
and passes the closed migration catalog and registry route checks, then fails
the inactive-source byte guard. Windows snapshot keys used backslashes, so the
portable `profiles/<active-id>/` filter mistakenly included the active writer.
Normalize recorded relative paths with `as_posix()` and retain a handoff snapshot
before assertions for diagnosis. This changes only the harness; require a fresh
full GUI run, including successor restart and cleanup, before qualification.
The failed attempt restores files/registry and its four firewall block rules.

The corrected full Windows ordinary GUI run now passes. Fresh native tray
Check for Updates and accessible Install & Restart controls invoke the unchanged
released updater. The installed executable has a valid expected-publisher
Authenticode signature, exact hash
`3e5be638289da30904d5ead80f69b75aedca33b7f647999e6623f01b8f53907d`,
product version 0.3.0, and JSTorrent uninstaller version 0.3.0 at the original
path. All migration oracles, inactive-source bytes and full source bytes across
successor restart pass. File/registry/firewall cleanup matches the inherited
baseline. Python compilation and `git diff --check` pass.

The first Windows interrupted-download attempt loses the cancellation race:
the small NSIS payload completes before an external `taskkill` process executes,
which reports that its old updater PID has exited. The attempt does not qualify
interruption and restores files/registry. Tighten only the test observer to a
bounded 10-ms progress poll and cancel the owned Windows process handle directly,
before expensive installed-byte hashing or shell startup. Refuse a log that has
already reached installation, then independently verify the exact old executable
and joined owners after cancellation. Repeat from a fresh restored fixture; the
signed released apps and delivery bytes stay unchanged.

### Windows Follow-Up Disposition And Restart Checkpoint

Four Windows x64 NSIS paths now pass from the unchanged released 0.2.1 app:
automatic HTTPS updating; native tray Check for Updates / Install & Restart;
wrong-signature refusal and valid retry; interrupted download and normal retry.
The two negatives retain exact legacy executable hash
`c4aeec22ae763d4402d54b38a142e78f5d2f13383813fbeba28d31cb35abf355`.
Interruption observes real progress before installation and joins the owned
process. Every successful path passes four imports across two source profiles,
supported settings, paused intent, valid/corrupt checking, missing-root handling,
eight registered protocol refusals, stable identities/single marker and preserved
source/payload through successor restart. GUI additionally preserves inactive
source bytes and every source byte after handoff. This is generated-fixture
qualification of this exact candidate, not complete migration or rollout proof.

All six Windows attempts, including the two unsuccessful harness attempts, pass
file/registry/firewall restoration and leave empty inherited backups. Remove
only test-generated firewall block rules; all 507 original rule names match.
No product or owned installer process remains. Six fixture roots, guest and
controller staging, six exact-hash updater downloads and twelve owned captures
are removed. The VM returns to its initial powered-off state and its claim is
released. Local controller candidates, IDs/configuration and logs are removed
before completion; unrelated worktree changes are retained.

The fresh private one-ID trial is disabled and its drop-in/manifest/assets are
removed. Eight final HTTPS response comparisons include the former test ID and
match the ordinary baseline; all five asset GET URLs return 404. The original
product descriptor remains selected and the service is active. Two comparisons
issued immediately after restarts fail before readiness, then pass unchanged;
startup validates all local asset hashes before opening the listener. Wait for
HTTPS readiness, rather than treating systemd's active state as readiness, before
future feed assertions. No default feed, release, signing input or store changes.

Python compilation and diff checks pass; actual Windows execution validates the
portable source guard and direct-process interruption fixes. Resume with the
Linux old-release GUI rendering gate, real extension/store pairs, controlled
repair, historical/other-architecture lanes and a fresh signed candidate carrying
the later native branding correction. The full cutover checklist stays open.
