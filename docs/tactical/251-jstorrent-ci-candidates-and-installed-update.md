# Tactical 251: JSTorrent CI Candidates And Installed Update

Status: **Bounded CI attempt complete, 2026-10-01; production delivery blocked.**

Follow-up: **Original desktop key and eight Windows/Linux payload signatures
pass; macOS notarization and complete same-attempt candidate collection
pass. Authenticated installed updating remains open.**
The maintainer supplies the original encoded key files and authorizes using them
for the existing CI lane. Keep the existing password secret unchanged and verify
it by signing an owned nonce; never expose or commit private signing material.

Topics: `product-surfaces-and-migration`, `desktop-jstorrent-replacement`,
`android-jstorrent-replacement`, `beta-release-readiness`, `client-surfaces`.

## Scope And Stopping Condition

Run signed production-identity release candidates in CI using the existing
RSTorrent signing inputs first. Verify artifacts against the retained original
JSTorrent public roots rather than assuming secret equality from their names.
Preserve exact source/run/hash identity and retain bounded failed-build artifacts
for diagnosis. Manual candidates cannot create tags/releases or enter a feed.
Use the existing desktop workflow; this is one-product succession, not a second
shipping product. Pause automatic incubation publication during qualification.

Confirm Android upload/app-signing gates in the checklist and attempt its signed
candidate with existing inputs, without Play upload or secret transfer. Prepare
the successor product-owned update-server descriptor. Inspect private operational
routing through dotfiles; do not copy private inventory into this repository.

If original-key signed desktop artifacts are available, install an exact old
JSTorrent release in a claimed, owned guest, generate controlled old state, check
for the successor update through an isolated candidate feed, install/relaunch
and inspect retained library/source/payload. Test-feed routing must be confined
to the guest; production users must not be offered the candidate. Do not weaken
TLS, updater authentication, signing validation or host fencing to obtain a pass.

While updater authentication is blocked, the existing controlled manual-handoff
driver may independently exercise a CI Developer-ID-signed production bundle
with checksum-pinned old writers. Label this installed migration evidence, never
authenticated updater delivery. Preserve inherited guest state and existing
fencing/source/payload oracles; no personal profile or public swarm is involved.

Stop with the CI attempts, available installed evidence, exact blockers and a
restart checkpoint. Missing original signing material is a delivery blocker;
continue independent source/package/server work and record the actual result.

The user requests CI release builds and an installed update attempt. Commit and
push the required candidate source after verifying maintainer git identity, then
dispatch manual non-publishing builds. No public feed promotion, store rollout,
private-key printing, unrelated installed apps or personal profiles are included.

## Survey, Invariants And Ownership

Read Tactical 250/checklist, existing desktop/Android release workflows and exact
artifact/activation validators before edits. Original JSTorrent updater root:
`415D3DF4B3D0CFB8`; published RSTorrent Latest signatures declare
`788A785131367096`. Re-test the current secret via an actual CI signature.
Android's original GitHub APK certificate is separately pinned; Play upload and
app-signing certificates still need console qualification. Minimum API 28 is
accepted; no API/platform lowering is part of this slice.

The existing workflow owns jobs/temporary credentials and joined cleanup; its
collector owns exact artifact identity and signatures. Package validators select
only explicit known production/incubation identities. Application updater and
engine owners are unchanged; no DTO or runtime task is added. Android desktop-
specific origin behavior was already classified in 250. This release work does
not change peer/protocol/hot-path semantics.

The generic update service currently consumes JSTorrent's old-repo descriptor.
Prepare the successor descriptor locally and exercise product selection with
owned data. Live service routing/promotion remains a final reviewable operation
rather than a prerequisite for testing an isolated feed.

## Validation

- Negative source/input/profile and artifact-mixing cases; production manual
  builds always have publication false. Invalid signatures fail qualification.
- Retained-platform activation, package/notices/OS-signing checks, workflow lint,
  web/extension tests and proportional native checks.
- Current CI signing proof and release attempt; record exact source/run/hash,
  expected/actual signer and incomplete platform lanes honestly.
- Available installed old-to-new updater evidence, or the exact prerequisite
  failure. Restore owned app/profile/feed/guest/claim state after testing.

## Evidence And Restart Checkpoint

Candidate mechanics committed at `3b589dfda62daf4998d5ea516ff8c63cff97719b`.
Production feed and existing secrets remain unchanged. Manual desktop run
[36822295713](https://github.com/kzahel/rstorrent/actions/runs/36822295713) and
Android run
[36822298091](https://github.com/kzahel/rstorrent/actions/runs/36822298091)
use that exact source. Both initial attempts failed; retries below record the
repaired source and remaining signing blockers.

The fresh CI nonce declares signing key `788A785131367096`. Independent minisign
verification succeeds against the incubation root and fails against the retained
JSTorrent root `415D3DF4B3D0CFB8`. Existing secret names do **not** establish key
equality. The original signing inputs must replace them before an old JSTorrent
installation can authenticate the successor. No private material was reported.
The diagnostic probe now fails visibly on a wrong root; package jobs do not
depend on that probe and still produce best-effort diagnostic evidence.

The real generic update server, using the successor descriptor, passed 33 HTTP
checks against owned GitHub metadata fixtures: five platform mappings, exact
signature/URL passthrough, default Stable/explicit Latest, equal/newer installed
versions (204), draft exclusion, unknown host/platform and invalid channel.
This proves routing and version selection, not artifact authentication or TLS.
No server code or live descriptor/symlink was changed.

In a claimed macOS arm64 guest (macOS 26.6.2), the exact released JSTorrent
0.2.1 app checked its unmodified production endpoint via `--check-update`,
returned exit 0 and `{ "available": false }`, with unchanged executable bytes.
Archive SHA-256:
`4bc5e979635fe9283d9ba60e43f86bfadcf619adf546cdbe4b68b27d424343f1`;
old executable SHA-256:
`f008e2d00e7e414e16096d1ea319d870807ddeddb25d459740b01a0727b019e7`.
An initial task path under macOS's `/tmp` symlink was correctly refused by the
released updater's starting-binary check; the canonical path passed. The test
restored inherited app data, removed owned files, returned the guest to its
prior suspended state and released its claim. This is baseline updater reachability;
no successor download/install/relaunch has been qualified.

### Linux Packaging Repair

Ordinary CI run `36822289035` failed its ARM64 unsigned bundle because the
upstream continuous AppImage output-plugin assets were replaced by a monthly
rebuild at 04:30 UTC on 2026-10-01. The SHA-256 gate refused the moved asset;
it was not bypassed. Review of the pinned source (`src/main.cpp`,
`.github/workflows/main.yml`) and upstream
[build 36815339264](https://github.com/linuxdeploy/linuxdeploy-plugin-appimage/actions/runs/36815339264)
confirms unchanged plugin revision `536b068787179ea901964bd7dabc7bf61e4941c3`,
plugin API 0 and AppDir/output forwarding. Compared with September build
`33467741325`, linuxdeploy remains revision `07333c6` and embedded appimagetool
remains `8c8c91f` / build 295. Both newly downloaded assets match the GitHub
release API digests. Update the two reviewed byte pins; maintain download/hash
bounds, pre-signing attribution and final packaged-notice gates. The native
hosted retry is recorded below; this is not source-offer/license graduation.
Local validation passes: 18 distribution-review tests, both real asset hashes,
and a wrong-byte download refusal that preserves the prior cache and cleans
temporary download state. No Rust/application source changes in this repair.
Before retry, correct the missing build-job `PACKAGE_PRODUCT` environment value
so package activation/staging checks receive the selected identity consistently.
The original manual release's source checks have passed on all native/web/tool
checks in that job; current signing inputs still block authenticated delivery.

The repaired desktop retry
[36824455228](https://github.com/kzahel/rstorrent/actions/runs/36824455228)
uses `fc95b0ead6745213f84adc21fa45b753f1bd10d3`. Both Linux release lanes
pass AppImage/DEB/RPM construction, product activation, native notices,
distribution inventories and exact-source receipt staging. Independently
downloaded arm64 receipts match all six payload/signature hashes; the three
payloads verify with incubation key `788A785131367096` and fail against the
retained original root. Arm64 AppImage SHA-256:
`d99023047992751baed34b8621e71b96673e2c4862e45193b8ce4516a0563721`;
DEB `dbdd66bd7db675a4492885b14454e21ba682fa53a279411df98b03694e4706c5`;
RPM `100c9e0baf8f9e48b6b03625bf7f8b55b5265dc86bcd09dd93a27170fe9c9ad3`.

Ordinary CI
[36824924012](https://github.com/kzahel/rstorrent/actions/runs/36824924012)
at `19eb3a88703088a2dfebb803342394938d305cb8` passes every executed job:
Rust formatting/workspace clippy/tests, deterministic libtorrent transfer and
application lifecycle/corruption repair; five desktop native/package lanes;
web type/unit/build/E2E; extension/companion; workflow/release tools; Android
dual ABI/JVM/lint/owned runtime; iOS simulator/unsigned archive. This is source
regression evidence, not production signature or installed-update qualification.

Both retry macOS architectures reach original-team code signing, then Apple
rejects notarization twice with HTTP 403: a required agreement is missing or
expired. The first run's accepted/stapled app remains independently verified;
it does not make the retry qualified. The account holder must review the current
team agreement before rerunning notarization. Do not disable this gate or accept
legal agreements through automation.

The same retry's Windows lane passes NSIS/MSI builds, expected-publisher
Authenticode checks, silent NSIS installation, installed executable/helper
signatures, production activation registry and packaged notices/inventory.
The collector correctly refuses incomplete release legs because macOS failed;
all-ten production updater authentication cannot run for this incomplete matrix.
The workflow finishes failed with diagnostic artifacts only. No GitHub release,
tag, public feed change, Play upload or Web Store update is performed.
The [retained diagnostic receipts](../evidence/jstorrent-ci-candidate-251.json)
record exact source/run/attempt and all available Windows/Linux hashes. Downloads
match all 16 payload/signature receipt hashes. Independent minisign verification
of all eight available payload signatures succeeds against the incubation root
and fails against the original root; the two macOS lanes are absent. This does
not qualify a complete original-key release.

The bounded attempt's stopping condition is met: available package/source/server
and installed-baseline evidence is recorded, with original signing inputs,
Apple account agreement and resumed guest desktop access as concrete remaining
prerequisites. The full in-place production upgrade remains unqualified.

### Android First Attempt

Run `36822298091` built both signed APK/AAB outputs, then failed release lint:
the launcher-removal activity overlay must explicitly declare `android:exported`
even though the merged main activity already inherits `true`. Repeat that
existing value in the overlay; the merged release behavior is unchanged.
Retained outputs remain unqualified. The current-input public certificate
SHA-256 is
`4420779ef395a490176986a058f72ba5b4a163f6eb9156e92a6e99896ef36849`,
different from the original GitHub APK root
`ccb5af8e44d626e9aefb1f0fbd8496dbf23ad27da9347248e71fb3ce70044915`.
Original Android signing inputs are also required; no certificate gate is relaxed.

The final one-product workflow reuses `ANDROID_UPLOAD_*` secret names and removes
the temporary rehearsal selector; replace their contents rather than maintaining
a second production signing tuple. No remote secret was changed. Local release
lint and merged-manifest generation pass with an owned temporary signing fixture
that is deleted afterward; no signed production qualification is inferred.

Independent checks of the retained CI outputs pass their actual signatures,
production package/version/launcher, identical Rust libraries in both ABIs,
native notices, bundletool validation and 16 KiB ELF/APK/AAB alignment. Their
signer remains the wrong canary root. APK SHA-256:
`7b5a4782ceef138c2442fb122210b27158e4eac69bd8efc330435d120c310fa8`;
AAB SHA-256:
`40ae747e3b75ecf9635ba284b29f36e2a81b6fa5e8f1d8548f48d3b3ffb08bc2`.

### Pre-Dispatch Checkpoint

Manual desktop production selection now merges 250's overlay, validates exact
production activation metadata and records product identity in all five artifact
receipts. Mixing products or adding publication inputs is rejected. The final
collector must verify all ten updater payload signatures against the retained
production public root. A separate CI nonce proof diagnoses the existing secret
without exposing private material; a failed proof cannot qualify delivery.

The Android manual candidate uses the existing secret names, but
its original-certificate APK/AAB validator remains mandatory. A public certificate
fingerprint is emitted before building; unqualified outputs are diagnostic only.
Automatic incubation publication now needs an explicit opt-in variable, which
is absent. No production tag/publisher promotion is enabled by this slice.

Local validation: 47 release/input/signature/package tests pass, including real
minisign wrong-root and altered-byte refusal, product mixing/publication negatives
and production activation selection. Changed workflows pass actionlint. Android
Python release tools pass (23). The actual generic update server accepts the
new product-owned descriptor with the original hostname/root and successor repo.
The live symlink/feed is not changed. Runtime Rust/DTO/engine code is unchanged;
250's native baseline remains applicable and CI repeats desktop native checks.

### Android Retry

After the overlay lint repair and one-product secret simplification, run
[36824981268](https://github.com/kzahel/rstorrent/actions/runs/36824981268)
at `19eb3a88703088a2dfebb803342394938d305cb8` passes the signed release build,
JVM tests and release lint. Final staging refuses `Unexpected APK signer`;
publication is skipped. The actual APK v2 signature verifies with the same
incubation certificate above. Independent APK/AAB manifest checks pass production
package, 1.0.25/code 25, API 28/36 and the retained launcher alias; the AAB's
signature verifies. Retry APK SHA-256:
`a183d336cf7e9845a9784e46302677593561895f2e7f1f1baf41c443bf56607b`.
The AAB bytes match the first attempt's SHA-256. These are diagnostic outputs,
not a production certificate or installed Play upgrade qualification.

### Independent CI Bundle Handoff Attempt

The first desktop run builds the macOS arm64 production bundle and Apple
accepts notarization. Independent `codesign --verify --deep --strict`, stapler
validation and Gatekeeper assessment pass under original team `VD7BYQ6ABM`.
The app archive SHA-256 is
`3562e99c6657b5efb89d9d74ba4f5c2a1b5134713837652094d161a53dc3dbe1`;
its updater signature still verifies only against incubation key
`788A785131367096`, not JSTorrent's retained root. The original job then fails
because package validation did not receive `PACKAGE_PRODUCT`; the retry fixes
that workflow environment without weakening package checks.

Two controlled manual-handoff attempts in the macOS arm64 guest use that exact
CI archive and released old writers. Old UI Quit succeeds; successor startup
shows the expected live-old-host refusal and creates no catalog. Both drivers
time out before import because the controller initially looks for the alert
under JSTorrent. Native capture and rfd 0.16's macOS `message_dialog.rs` /
`utils/user_alert.rs` show the parentless `CFUserNotification` is owned by
`UserNotificationCenter`. This is an incomplete harness attempt, not an imported
library pass or a demonstrated product deadlock. The driver guidance now records
the alert owner and requires inspection of the specific title/message.

Machine Control subsequently reports that its desktop grant was stopped at the
target and refuses further observation. No alternate UI transport is used.
Both drivers finish their restoration paths, join children and restore inherited
app/profile/browser registrations. Owned guest files/capture and the download
server are removed; the guest returns to its prior suspended state and its
exclusive claim is released. An outstanding task-created native alert may remain
because its dismissal cannot be verified after grant revocation; do not dismiss unrelated
permission alerts. No authenticated successor update or completed CI-bundle
import is qualified by these attempts.

### Next Executable Checkpoint

1. The original desktop key is now provisioned and the unchanged password passes
   CI signing. Eight available Windows/Linux payload signatures now pass; require
   complete platform/package and installed evidence before shipment.
   Provision original Android keystore/password/alias inputs under existing
   `ANDROID_UPLOAD_*` names and qualify Play upload/app-signing independently.
2. Complete desktop candidate run 36845370571 now passes all five lanes and
   all ten original-root payload signatures on the recorded source SHA. Use
   its pinned artifacts for Tactical 252; do not publish diagnostic output.
   Android retains its independent original-signer gate.
3. Reacquire an owned guest claim and explicit desktop grant for the installed
   rehearsal. Use the exact checksum-pinned old release and fresh authenticated
   candidate. Confine candidate feed/TLS routing to the guest; exercise the old
   released updater's normal endpoint, download/install/relaunch, ordinary writers,
   fencing and migrated library/recheck/source/payload oracles. No TLS/signature
   relaxation or personal-profile import is allowed.
4. Review the product descriptor and rollback/stop route before any separately
   authorized production feed switch. Play/store versions, physical ARC/SAF and
   same-ID extension/store cohorts remain independent open checklist gates.

### Maintainer-Supplied Desktop Key Follow-Up

The supplied Tauri-encoded public file's cryptographic packet exactly matches
the retained root `415D3DF4B3D0CFB8`; packet SHA-256:
`a9e0989f0cbd52e9673a9083767674f46d21649c15e7ccce8afe4da0d8845de3`.
The supplied private file is uploaded unchanged through stdin to the existing
`TAURI_SIGNING_PRIVATE_KEY` repository secret. No private contents, attachment
paths or credentials enter this repository or tool output. The password secret
is untouched; its metadata timestamp remains unchanged.

Fresh manual production candidate
[36831643488](https://github.com/kzahel/rstorrent/actions/runs/36831643488)
uses `19eb3a88703088a2dfebb803342394938d305cb8`, without publication. Its
owned-nonce CI proof passes: signer `415D3DF4B3D0CFB8`, JSTorrent verification
true, incubation verification false. This proves the uploaded private key matches
the retained trust root and the existing password unlocks it. It supersedes the
earlier current-input mismatch as a desktop signing-input blocker, not the
historical failed package evidence. The run now finishes: Windows and both Linux
package lanes pass; both macOS architectures fail notarization with the same
missing/expired Apple agreement HTTP 403. The collector refuses incomplete legs.

Independent verification of downloaded package bytes matches all 16 receipt
hashes, and all eight available Windows/Linux payload signatures pass the
original root and fail the incubation root. Preserve their exact identity in
[original-key package receipts](../evidence/jstorrent-ci-candidate-251-original-key.json).
These packages unlock an owned Windows/Linux installed updater trial; this is
partial package authentication, not an installed-upgrade or complete-matrix pass.
At attempt 1, Apple agreement resolution, Android signing and guest desktop
access remained independent prerequisites; the Apple recheck below supersedes
that account blocker.

Accepted [252](252-jstorrent-opt-in-upgrade-rehearsal.md) records the next bounded
dry run: the exact old release already sends `X-CFU-Id`, allowing explicit test
cohort selection on the ordinary HTTPS endpoint. The server currently uses that
header only for analytics; local implementation/tests and a reviewable private
deployment precede any externally authorized change. Ordinary users retain the
old feed. Start a Linux AppImage trial, then Windows and notarized macOS, with
ordinary writer fixtures, actual updater installation/relaunch and migration
oracles. No live cohort/feed/server change is made in this survey.

### Apple Agreement Recheck, 2026-10-01

The maintainer reports accepting the agreement. Failed-only attempt 2 of run
36831643488 freshly submits both architecture apps and outer DMGs using the
existing CI credentials. Apple accepts the Intel app at 09:47:29 UTC and arm64
app at 09:47:31 UTC. Both DMG reports are Accepted with no issues. Original-team
code-signature, stapling and Gatekeeper checks pass for apps and DMGs; both macOS
jobs conclude successfully. The agreement error is no longer a current blocker.
This verifies service access, not the private account portal acceptance record.

[Recheck evidence](../evidence/jstorrent-ci-candidate-251-apple-recheck.json)
preserves source/run/attempt, job/submission identity and notarization report
hashes. The submitted DMG hash precedes stapling and is not its final delivery
hash. The collector correctly refuses this two-leg retry because Windows/Linux
artifacts belong to attempt 1; do not combine attempts to graduate that gate.

Fresh complete non-publishing run [36845370571](https://github.com/kzahel/rstorrent/actions/runs/36845370571)
uses the same `19eb3a88703088a2dfebb803342394938d305cb8` source and completes
successfully. All five package lanes and nonce identity proof pass. Collector job
110322129210 assembles 23 assets and 15 updater target aliases, validates the
complete release and verifies all ten JSTorrent payload signatures against the
retained public key at 10:14:33 UTC. Publication steps are skipped. This closes
complete same-attempt CI candidate collection, not installed update/migration.
Tactical 252 is accepted/Ready; routing is not implemented or deployed.
