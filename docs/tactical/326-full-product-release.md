# Tactical 326: Full Product Release

Status: Complete delivery, 2026-10-13. Desktop 0.3.1 published; Android
1.0.30 published at 100%; extension 1.1.4 pending review with automatic
publication after approval.

Topics: `beta-release-readiness`, `product-surfaces-and-migration`,
`android-jstorrent-replacement`.

## Scope and stopping condition

The maintainer requests a new Android production release at 100%, superseding
the pending Play release if necessary, plus new desktop and extension releases.
Prepare Android 1.0.30/code 30, desktop 0.3.1 and production extension 1.1.4.
Preserve the existing app/store identities, signing roots and updater endpoint.
Use browser control for Play and the existing extension dashboard.

Prepare signed candidates and exact-source checks before publication. Interpret
the requested approval as store review with automatic publication, consistent
with the existing Android procedure; desktop publication follows successful
release qualification. An optional clarification is unanswered. Stop
after the authorized publication/submission state and actual public desktop
assets, source offer, website and updater routes are verified; store approval
and installed acceptance remain separate evidence.

Non-goals: no new product feature, iOS or incubation release, signer rotation,
listing/privacy/permission changes, physical-device mutation or library reset.
Exclude unfinished duplicate-add changes in Tactical 318. Include the completed
Tactical 325 harness repair needed to qualify the current source, preserving
unrelated working-tree edits.

## Invariants, ownership and evidence

Bind all candidates to the committed source and immutable version tags. Verify
Git identity before pushes. Existing Actions owns signing and temporary secrets;
local packaging owns the reviewed production extension archive. Google owns
asynchronous store review. Inspect pending Play changes and maximum version code
before replacing 29; never submit unrelated changes. Maintain full rollout and
automatic publication only as authorized.

Run fresh dependency audits and renew the expiring warning review from actual
evidence. The initial audit finds five quinn-proto 0.11.16 advisories; update
only that locked optional dependency to patched 0.11.18, preserving the selected
engine architecture and current reqwest features. No QUIC feature is added.
Existing seven warnings, including the source-verified GLib backport, remain
subject to exact inventory/source validation. Read the upstream security fixes
at quinn-rs/quinn PRs 2790 and 2868; no source or fixtures are copied.

Validate Rust/web, Android JVM/lint and original-key APK/AAB packaging, all five
signed desktop legs and signatures/trust/notices, production extension identity,
and exact release inventory. Deliver sources for the actual Linux packages;
prior packages and source inventories cannot qualify new binaries. Release
construction, store submission, public availability and installed stability
must be reported separately. No background monitoring task is created.

The retained source-carrier tool hardcodes 0.3.0. Generalize only its versioned
archive root and AppImage names, deriving the version from candidate metadata
and verifying it against the exact committed Tauri source. Preserve all existing
digest, dependency-lock, runtime, source-package and closed-membership gates.
Regression coverage rejects wrong source/version and unsafe version paths.

## Initial checkpoint

Play shows production 28 at 100%, pending production 29 Start full rollout in
review, and managed publishing off. The extension dashboard shows production
1.1.3 published. GitHub desktop Latest remains 0.3.0. Local main has 13 committed
changes beyond origin/main plus unrelated working-tree changes. Fresh web and
website npm audits contain zero vulnerabilities. Dependency warning review
expired 2026-10-12; fresh Cargo advisory database is dated 2026-10-12.

## Committed source and construction checkpoint

Release source is `5fa018ff589f8058f6ed3910f5cea5fcd06410ab`, following the
completed harness commit `026c59c0`. Both annotated tags pin that exact source:
`android-v1.0.30` and `desktop-v0.3.1`. Maintainer Git identity is verified before
both pushes. Tactical 318's uncommitted changes remain excluded and intact.

Passing preparation checks: 27 Android Python cases, five source-carrier cases,
58 release/configuration cases, 60 extension cases, locked Cargo metadata,
desktop/production candidate validators and the Android tag/version check.
Cargo and both npm audits have zero vulnerabilities; all seven reviewed warnings
and the exact GLib backport verify. The optional QUIC lock update introduces no
new dependency or selected runtime feature.

Source CI [38316599207](https://github.com/kzahel/jstorrent/actions/runs/38316599207)
and signed desktop candidate
[38316618217](https://github.com/kzahel/jstorrent/actions/runs/38316618217) are
running. Original updater key proof passes. Android branch candidate
[38316615201](https://github.com/kzahel/jstorrent/actions/runs/38316615201) runs
before the normal tagged
[38317114000](https://github.com/kzahel/jstorrent/actions/runs/38317114000), which
owns downloadable Android publication. The duplicate nonpublishing desktop tag
build 38317114147 is cancelled; the source-identical manual candidate continues.
Promote that candidate's exact verified bytes with the matching source carrier,
using the existing source-bearing final-draft guard from Tactical 295 rather
than rebuilding different bytes during publication.

Production extension 1.1.4 packages successfully with source/render/CSP guards;
ZIP SHA-256 is `b058bcba72eceabeaf6e89e30fdc743faa89ed1f77c4fb67a2e78f5e8ef008a2`.
The dashboard upload reaches Google passkey verification; accepted upload,
draft version and review submission are not yet confirmed. The native Touch ID
prompt needs the maintainer. Listing/privacy/permissions are untouched.

A fresh Play release view establishes that 29 is already available on Google
Play, superseding the initially stale in-review page. Draft 30 is prepared
without changing the live release; independently verified tagged AAB upload,
preview, full rollout and review submission remain next. No cancellation of 29
is needed. Private account identifiers/screenshots stay in ignored evidence.

Fresh Cargo vendor construction contains 737 locked registry inputs. A reviewed
dependency-source carrier verifies every member and combines those inputs with
unchanged previously supplied web sources and six newly added web dependencies,
including exact upstream preferred sources. Native package versions and outer
runtime bindings still require reconciliation with the actual new AppImages.

## Android tagged artifacts and production submission

Tagged Android run 38317114000 completes signed construction and downloadable
prerelease publication. Its APK and AAB independently match public asset size/
digest metadata and SHA256SUMS. The ordinary validator is run against a task-owned
validation root with exact tagged Gradle/certificate inputs; existing local
Android build outputs and unrelated working-tree changes are preserved.

- AAB: 61,701,743 bytes,
  `6e5c51cdb2825b4b9c6ba2ffcf85513347dcf72a7e72bafab1785816ca818be0`.
- APK: 105,366,155 bytes,
  `07cb37974616acdfb755e465cfe22681367c6894f52fa9c5df4f2eeadcea6562`.

Signature/original upload certificate, package/version, launcher, API 28/36,
branding, both ABIs, native equality, notices and 16-KiB ELF/ZIP alignment pass.
Source CI's Android dual-ABI/JVM/lint and owned API 35 SAF lifecycle job also
passes at 5fa018ff, closing Tactical 325's hosted-source follow-up. The manual
Android candidate passes but is not the source of the Play upload.

The browser file-upload bridge requires unavailable file-URL access; use the
native chooser without widening extension permissions. Play processes the exact
verified tagged AAB as 30 (1.0.30), with both ABIs and native debug symbols. Preview
shows zero device losses in every form factor, 100.0% and all targeted countries.
The sole warning is absent deobfuscation mapping; release R8/minify is disabled.

Save and final Send changes for review are confirmed. Console shows only
**Production 30 (1.0.30), Start full rollout** under **Changes in review**, with
**Managed publishing off**. Quick checks are running; their completion, actual
review/approval and public availability are not inferred. Publication is
configured automatically after approval, with no later operator action required.
No unrelated draft/listing changes are submitted and no rollback/cancellation
of the already available 29 is necessary. Private preview/submission receipts
stay ignored. Installed delivery and production stability remain separate.

## Desktop intermediate qualification

All four signed Mac/Linux legs pass; Windows and final collection are pending.
Both downloaded Mac app/DMG pairs independently pass strict/deep signatures,
retained Developer ID/team, Gatekeeper, app/DMG staples and notarization ticket
CDHash binding for the app, executable, native host and DMG. No installation or
physical Intel execution is claimed.

The two exact downloaded Linux legs verify source/run/attempt/version and all
payload hashes. Both outer runtimes match the reviewed 8f39b89 source binding,
excluding only the named 16-byte payload digest. Their actual native manifests
and every original notice hash verify. All 85 selected native source/version
pairs reconcile with exact descriptor-bound source archives. Fresh source-carrier
construction, five-package inspection and complete final-draft verification
remain pending; no desktop release or updater offer is activated yet.

Google's extension passkey request times out without owner verification. The
normal saved sign-in option does not fill the secure field; no password is read
or submitted. The passkey page remains ready for owner verification. Accepted
extension upload/draft version and submission remain unconfirmed.

A later fresh Console observation confirms quick checks have completed and
explicitly states **Your changes are now in review**. The sole production 30
full-rollout change and managed publishing off remain visible. Approval and
publication remain pending.

## Desktop publication, website and updater terminal checkpoint

Full source CI 38316599207 passes all ten applicable jobs at exact 5fa018ff;
optional dependency/verification dispatches are intentionally skipped. Signed
desktop run 38316618217 passes all five platform legs, original updater-key
proof, source checks and collection. Independent five-package extraction and
Rust/npm notices pass; both AppImages also pass native/MIT/custom-source gates.
Windows hosted checks validate both installer signatures and the normal signed
NSIS package identity. Mac independent trust checks are recorded above.

The versioned source carrier independently verifies all **38,955** member hashes,
portable headers, both exact AppImage bindings and offline Cargo metadata for
both Linux targets from an empty Cargo home. Its source snapshot/locks match
5fa018ff. Original notices, preferred sources, patches and rebuild/relink inputs
are delivered without claiming binary reproducibility or blanket license/security
clearance. All owned extractions are removed.

- Source archive: 925,938,523 bytes,
  `3c24ec87f3bb5532b425467c06a849610bef2eff9f34161a08db3dfd2a3953cb`.
- Final private draft: 15 core assets, matching source archive and SHA256SUMS,
  **17 assets total**, with every remote digest/size and checksum entry verified.
- The first staging attempt creates an empty draft, then stops when the REST
  by-tag endpoint does not return drafts. The corrected normal `gh release view`
  lookup resumes that exact draft; no unqualified bytes are published.

The source tag is rechecked before final publication. The verified
[JSTorrent desktop 0.3.1 release](https://github.com/kzahel/jstorrent/releases/tag/desktop-v0.3.1)
is published as the normal latest desktop release. Android remains a prerelease
and does not take over the desktop latest pointer. Anonymous public metadata
confirms all 17 exact assets and the real publication timestamp.

Automatic website promotion
[38322687081](https://github.com/kzahel/jstorrent/actions/runs/38322687081) downloads
and independently verifies all public bytes and original-root signatures, then
commits inventory ea0bcef2 and dispatches normal Website deployment
[38322750077](https://github.com/kzahel/jstorrent/actions/runs/38322750077).
Both succeed. The live canonical website exposes all five platform downloads
and the matching Linux source link for 0.3.1. Local main fast-forwards over only
the two generated website data files; unrelated Android edits remain intact.

All 11 production updater selectors anonymously offer 0.3.1 from current 0.3.0
with exact payload URLs/signatures and Stable channel. Current 0.3.1 and future
9.0.0 receive 204; production Latest remains empty. Frozen incubation Stable
0.1.4 and Latest 0.2.801 remain unchanged. No updater-server deployment or signing
root change is needed. Public and private receipts remain separate.

Source validation includes `cargo fmt --all -- --check`, `cargo clippy
--workspace -- -D warnings`, locked workspace compilation/tests (1,607 passed, 18 ignored), feature-on/off
checks, controlled libtorrent transfer and application corruption/recovery;
web generation, typecheck, 532 unit cases with two existing skips, production
build/CSP and all 65 deterministic browser cases; Android dual-ABI/JVM/lint,
instrumentation compilation, notice checks and owned API 35 SAF lifecycle.
Platform native packaging checks pass on Windows, Mac and both Linux lanes.
The CI-only iOS simulator job also passes; no iOS release is made.

## Android publication confirmation

At 23:57 UTC on October 12 (October 13 local date), the fresh production release
details show **30 (1.0.30), Available on Google Play**, released October 13 at
01:24 local time, **Rollout percentage 100%**, and availability in **178 of 178
countries / regions** on 12,164 supported devices. Version 29 is deactivated;
no bundles are retained. Publishing overview has no unpublished changes.
The saved private screenshot records the published full-rollout state. Actual
installed acceptance and production stability remain separate evidence.

## Extension review submission confirmation

The maintainer completes Google verification and requests continuation. At
05:16 UTC on October 13, the native Chrome dashboard confirms the existing
production item has draft 1.1.4 and published 1.1.3. The originally uploaded
archive was accepted after verification, so no duplicate upload is necessary.
The retained ZIP still matches the recorded SHA-256. Draft and published
permissions both show nativeMessaging, storage and host permission. The existing
listing is preserved; Distribution remains Free of charge, Public and All regions.

Submit for review presents **Publish JSTorrent automatically after it has passed
review** checked. Submit For Review succeeds with **Your extension was submitted
for review**. A fresh reload confirms **Pending review** and **This draft is pending
review**; Package binds submitted revision 00016 to 1.1.4, while published remains
1.1.3. Private status and package screenshots record the accepted submission.
Actual approval/public availability and installed extension acceptance are not
inferred. No further operator publication step is required after approval.

## Completion and cleanup

Desktop publication, Android publication at 100%, and extension review submission
with automatic publication meet this tactical's stopping condition. Extension
approval/public availability and installed delivery/stability remain asynchronous
or separate evidence. There is no remaining owner-verification blocker.

No new monitor, device session, product-profile mutation, key rotation or
incubation publication is created. Temporary logs, staging/extractions and
redundant downloads are removed after receipt collection; ignored release
receipts and the extension delivery archive are retained. Tactical 318's
unfinished source/documentation remains uncommitted and excluded. Tactical 327's
concurrent engine/removal investigation is also preserved and excluded.
