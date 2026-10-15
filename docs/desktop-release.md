# Desktop Release Runbook

## Release track status, 2026-10-13

JSTorrent is the sole active desktop release identity. Desktop 0.3.1 is public
with `com.jstorrent.desktop`, the existing JSTorrent updater signing key and
`updates.jstorrent.com`. Use
[JSTorrent candidate builds](../DEVELOPMENT.md#building-jstorrent-production-candidates)
and [explicit publication](../DEVELOPMENT.md#explicit-production-desktop-publication)
for new work, with the existing release qualification gates.

Tactical [326](tactical/326-full-product-release.md) records its exact signed
source, matching source archive, website and all 11 updater offers.

The RSTorrent track is frozen at its last recorded Stable 0.1.4 and Latest
0.2.801 offers. No new incubation releases or resumed nightly publication are
planned. Its descriptor, artifacts and updater route remain historical
compatibility; old installed apps use a different signing root and must not be
redirected to JSTorrent packages. See the
[owning release policy](topics/product-surfaces-and-migration.md#jstorrent-only-release-policy-2026-10-11)
and [updater configuration](../update-server/README.md).

The incubation commands and checkpoints below are historical. They do not
authorize publishing that flavor or enabling `INCUBATION_PUBLICATION_ENABLED`.

## Historical packaging and channel runbook

For the first JSTorrent production replacement, Linux support is best effort
and offers AppImages only. Both Linux lanes use Ubuntu 24.04 and refresh vendor
WebKit/OpenSSL packages; the reviewed WebKit build floor is 2.52.6. The production
collector requires 15 core assets, six signature sidecars and 11 updater keys;
`SHA256SUMS` is the additional 16th support asset. Production DEB/RPM assets and
selectors are refused. The frozen preview used a 23-asset/15-key matrix.
Tactical 285 records local validation. A new signed inventory, actual ABI/minimum
requirements and representative launch checks remain required before shipment.

RSTorrent desktop releases use the `desktop-v<version>` tag family and the
[`Desktop Release`](../.github/workflows/desktop-release.yml) workflow. The
workflow builds signed updater packages and ordinary installers for macOS
arm64/x86_64, Windows x86_64, and Linux x86_64/arm64.

## Stable and Latest channels

Stable keeps the deliberate `desktop-vX.Y.Z` tag and remains the default for
existing installations and requests without a channel. The
[`Nightly Desktop`](../.github/workflows/nightly-desktop.yml) workflow checks
for a successful `main` CI commit each night at 02:47 UTC. It skips unchanged
packaged source unless manually forced, then calls the same signed desktop
workflow to publish `desktop-latest-vX.Y.Z` as a Latest prerelease. The source
commit is checked out explicitly for every package leg. Both channels retain
the RSTorrent identifier, updater key, signature checks, complete five-target
draft validation, and explicit user-approved installation.

Latest uses a numeric package train above the current Stable minor version:
Stable `0.1.4` is followed by Latest `0.2.S`, where `S` is the nightly workflow
run number times 100 plus its attempt. A later Stable release must be greater
than every published Latest package, for example `0.3.0` after `0.2.S`.
Returning from Latest to Stable keeps the installed build until Stable catches
up; it never downgrades. The selector is offered for macOS app, Windows NSIS,
and Linux AppImage installations. MSI, DEB, and RPM continue through their
package managers. The update service must deploy the channel registry from
[`update-server/rstorrent.json`](../update-server/rstorrent.json) before Latest
checks can succeed. The desktop app discovers the registry and verifies the
selected channel in the response, while old apps continue to use Stable.
Remy's registry was deployed on 2026-09-27 and publicly advertises both
channels. The first signed Latest release was `desktop-latest-v0.2.301`.
The current qualified Latest is `desktop-latest-v0.2.801` at source `fc401ecf`;
the legacy preview Latest checks offered 0.2.801. Its
[public evidence](evidence/desktop-latest-v0.2.801.md)
and [installed checkpoint](tactical/240-signed-desktop-control-qualification.md)
cover outer-DMG notarization, bundled/registered helper trust and three-platform
native updating plus extension control. Frozen preview Stable remains 0.1.4.

The [first Latest release evidence](evidence/desktop-latest-v0.2.301.md)
records the signed hosted workflow and all five production routes. Installed
old-to-new acceptance now passes in 238/240 on macOS arm64 and Windows/Linux x64;
hosted checks alone do not establish installed package behavior. The
[parallel release evidence](evidence/desktop-parallel-release-2026-09-27.md)
records overlapping signed builds, collector validation, publication, and
production route checks.

## Rehearse Without Publishing

Run the protected workflow from `main`:

```bash
gh workflow run desktop-release.yml --ref main
gh run list --workflow desktop-release.yml --limit 1
gh run watch RUN_ID --exit-status
```

This uses the real updater, Developer ID/App Store Connect, and Azure signing
credentials. Five independent package jobs run in parallel and upload private
Actions artifacts retained for 14 days. One collect job assembles and checks
the same complete updater manifest used for publication, retaining private
manifest evidence. A rehearsal creates no tag or GitHub Release. Check the job
assertions for both macOS notarization/stapling and Windows Authenticode
validation before using a rehearsal package. The app and outer DMG each need
notarization and a stapled ticket. Tauri 2.11.4 notarizes the app but only signs
the DMG; our post-build gate submits the DMG, requires Accepted with no issues,
staples it, and runs `spctl --assess --type open --context
context:primary-signature` before staging final hashes. Notary submission/log
JSON is retained for 14 days. A valid app ticket alone does not qualify the
DMG download. Tactical 240 records the omission found in Latest 0.2.701 and
its forward correction.

The latest proven rehearsal is GitHub Actions run
[`36341433008`](https://github.com/kzahel/rstorrent/actions/runs/36341433008)
at commit `80b0446860909eb7a754c1319631fc288127560a`. Its source gate and all
five signed release legs passed on 2026-09-27. The five package jobs overlapped,
and the sole collector retained a private 23-asset inventory and 15-key updater
manifest. It created no tag or GitHub Release. The platform checks include
macOS app Developer ID, Gatekeeper and notarization/stapling (the outer DMG
was only signature-checked in that historical run), Windows installer
Authenticode, and Linux AppImage/DEB/RPM packages.

## Cut A Release

1. Update the same stable version in `clients/web/package.json`,
   `clients/desktop/src-tauri/Cargo.toml`, and
   `clients/desktop/src-tauri/tauri.conf.json`; refresh both lockfiles.
2. Replace the matching `CHANGELOG.md` `Unreleased` heading with the release
   date and include supported behavior, known limitations, persistence or
   migration changes, and security/privacy changes.
3. Validate the source and push the release commit:

   ```bash
   node scripts/validate-desktop-release.mjs --tag desktop-vX.Y.Z
   cargo fmt --all -- --check
   cargo clippy --workspace -- -D warnings
   cargo test --workspace
   npm run typecheck --prefix clients/web
   npm run test --prefix clients/web
   npm run build --prefix clients/web
   git push origin main
   ```

4. After ordinary CI passes, create and push the exact tag:

   ```bash
   git tag -a desktop-vX.Y.Z -m "RSTorrent desktop X.Y.Z"
   git push origin desktop-vX.Y.Z
   ```

The five signed package jobs run in parallel and never write to a GitHub
Release. Each retains an exact package/signature set with source, run, version,
and SHA-256 evidence. The sole finalizer checks all five sets, creates the
product-specific `latest.json` (11 production keys,15 preview keys), and
validates the complete manifest before creating a
private draft. It uploads those exact assets, checks their GitHub digests,
validates same-release URLs and signatures, adds `SHA256SUMS`, and only then
publishes. Failed builds create no release; a failure after draft creation
leaves it private. The Stable GitHub release is non-prerelease because the
Stable update rule excludes prerelease entries; the `0.x` version and release
notes carry the incubation-beta status.

The first published release is
[`desktop-v0.1.0`](https://github.com/kzahel/rstorrent/releases/tag/desktop-v0.1.0).
Tagged workflow
[`32656926123`](https://github.com/kzahel/rstorrent/actions/runs/32656926123)
passed every source/build/finalizer job. Its independent checksum, route, and
installed macOS smoke evidence is recorded in
[`desktop-v0.1.0`](evidence/desktop-v0.1.0.md).

The first updater-validation release is
[`desktop-v0.1.1`](https://github.com/kzahel/rstorrent/releases/tag/desktop-v0.1.1).
Tagged workflow
[`32661616090`](https://github.com/kzahel/rstorrent/actions/runs/32661616090)
passed its source gate, five signed target jobs, and finalizer. Independent
checksums, route probes, and the exact installed macOS arm64
`0.1.0`-to-`0.1.1` update are recorded in
[`desktop-v0.1.0-to-v0.1.1`](evidence/desktop-v0.1.0-to-v0.1.1.md).

The current repair-bearing release is
[`desktop-v0.1.2`](https://github.com/kzahel/rstorrent/releases/tag/desktop-v0.1.2).
Tagged workflow
[`32959820514`](https://github.com/kzahel/rstorrent/actions/runs/32959820514)
passed its source gate, five signed package jobs, and publication finalizer at
exact commit `788e953d1ed578c238beccbbc224907b0d9dc95c`. Its complete package
matrix and bounded exact-public-DMG macOS arm64 launch/native-host spot check
are recorded in [`desktop-v0.1.2`](evidence/desktop-v0.1.2.md). This release
record does not claim the still-open installed `0.1.1`-to-`0.1.2` update
campaign.

The current Stable release is
[`desktop-v0.1.4`](https://github.com/kzahel/rstorrent/releases/tag/desktop-v0.1.4).
Its [signed workflow](https://github.com/kzahel/rstorrent/actions/runs/36262994983)
passed the source gate, five package jobs, and finalizer. The
[release evidence](evidence/desktop-v0.1.4.md) records public checksums,
five-route updater responses, and a native Windows x86_64 fresh-default
`0.1.1`-to-`0.1.4` update with automatic reset and relaunch. This is still a
disposable incubation release; no supported persistence baseline is selected.

## Update Service

The application checks
`https://updates.graehlarts.com/rstorrent/tauri/<target>/<arch>/<version>`.
[`update-server/rstorrent.json`](../update-server/rstorrent.json) is the
product-owned configuration consumed by the shared update service. The
production `/rstorrent` route and product registration were deployed and the
service health check passed on 2026-08-23. Public `desktop-v0.1.1` now resolves:
a current `0.1.1` version returns HTTP 204 and installed `0.1.0` returns signed
Tauri metadata referencing that immutable GitHub Release. Both results passed
for all five default updater targets after publication. The installed macOS
arm64 app then completed the real replacement/relaunch and reported the
new exact version/build; the other four installed targets remain open.

## Windows First-Launch Consent

The first launch of an unsigned fresh-profile Windows package from `main`
displayed Windows Security Allow/Cancel consent for the incoming listener.
Choosing Cancel granted no broader firewall access and left the application
and native download-folder picker usable; it did not prove incoming
reachability.

For each signed Windows release candidate, record whether this prompt appears
on a clean profile and describe the supported private/public-network choice in
the release evidence and user-facing known limitations. Test automation must
not select Allow or create a firewall rule implicitly. Keep firewall consent
distinct from application startup, root-picker, and updater success.

After publishing, verify at least one exact current-version key and all five
older-version keys. Do not treat metadata checks as installed-update evidence:
the beta gate also requires an older installed signed build to download,
install, relaunch, and report the new version/build on each supported target.

## Native AppImage Notices

Package/release overlays enable Tauri's project-local tool cache and run
`prepare-appimage-notices.mjs` before bundling. On the native Ubuntu builders,
the hook installs an output-plugin wrapper in Cargo's `target/.tauri` and
verifies its delegated upstream plugin against reviewed SHA-256 pins. A moved
upstream asset or changed Tauri CLI requires source review and a pin update;
the build must not silently fall back to an unchecked plugin. Other desktop
platforms skip the Linux hook.

After linuxdeploy selects libraries, the wrapper copies original distro
copyright files and referenced common-license texts to
`usr/share/rstorrent/native-notices/` inside the AppImage. Its manifest maps
selected ELF files and copied xdg helpers to package/source versions, retained
GNU build IDs, original and bundled hashes. Final package inspection requires
that manifest and rejects changed, missing or unattributed native components.
Tauri creates updater signatures only after this packaging step completes.

This is attribution evidence, not blanket redistribution clearance. Launcher
and outer runtime provenance, per-package corresponding-source obligations,
and Android Maven/AAR attribution remain release review items in Tactical 214.
The source locators in the manifest are not a corresponding-source offer.
