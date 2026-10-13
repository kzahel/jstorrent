# Android Release Runbook

Android release targets the existing JSTorrent `com.jstorrent.app` app,
with `android-vX.Y.Z` tags. Tactical
[330](tactical/330-android-1-0-31-production-release.md) records the October 13
1.0.31/code 31 production review submission at 100%, with automatic publication
after approval. Quick checks are running; public availability remains pending.
Tactical [326](tactical/326-full-product-release.md) records the October 13 local-date
1.0.30/code 30 production submission and confirmed publication at 100% in all
178 targeted countries. Play shows Available on Google Play, released October
13 at 01:24 local time, with 29 deactivated and no retained bundles. Tactical [315](tactical/315-android-1-0-29-production-release.md)
retains the preceding 29 source/signing and submission evidence.
Earlier candidate/track checkpoints below remain historical.
Debug builds retain `org.rstorrent.bootstrap`; Kotlin/JNI namespace stays
unchanged. A release-only alias preserves the legacy launcher component.
The Android Release workflow builds both arm64-v8a and x86_64, runs release
JVM tests and lint, and verifies signed APK/AAB artifacts before publication.
Google Play upload and rollout remain manual.

Tactical [250](tactical/250-jstorrent-production-identity-candidates.md) prepared
this lane. Tactical [255](tactical/255-android-play-internal-replacement.md) now
records the completed original-key internal Play release. On 2026-10-04 the
supplied key passes a private-key signing proof and matches the authenticated
Play upload certificate; existing CI secrets are updated. Play accepted and published
1.0.25/code 25 to internal testers; production remains 1.0.23/code 23. The [full cutover checklist](jstorrent-cutover-checklist.md) still owns
broader production and installed-upgrade qualification. Minimum API 28
(Android 9) is selected on 2026-10-01.
API 26/27 are outside the replacement cohort; those devices keep the old app
until an OS update permits replacement. Validate unsupported-device guidance.

Tactical [257](tactical/257-play-upgrade-and-fresh-signed-candidates.md) qualifies
a bounded physical Play 1.0.23-to-1.0.25 standalone library upgrade. It also
corrects the overlooked Canary release-resource label and prepares code 26;
the final APK and every resolved AAB app-name value must be JSTorrent.
Internal Play code 25 is immutable and retains that branding defect. Code 26
is currently a non-publishing candidate; uploading it is a separate action.

The former independent canary's first verified release is
[Android 0.1.0](https://github.com/kzahel/rstorrent/releases/tag/android-v0.1.0)
(versionCode 1). Its
[tagged workflow](https://github.com/kzahel/rstorrent/actions/runs/34039237324)
passed build, signature/packaging validation, and prerelease publication.

## Release A Version

Only after explicit release authorization, add a nonempty `## [1.0.32]`
section to `clients/android/CHANGELOG.md` and commit it first. From a clean `main` checkout:

```sh
scripts/release-android.sh 1.0.32 --dry-run
scripts/release-android.sh 1.0.32
```

The helper validates the version and changelog, increments Gradle's integer
`versionCode`, sets `versionName`, commits the version change, creates an
annotated tag, and atomically pushes main and the tag. Each release version
must increase; the version code is never derived from CI run numbers. If a
push fails, the local commit/tag remain available for inspection and retry;
do not run the bump helper again blindly.

The next local 1.0.27/code 27 candidate uses the manual build route below.
Code26 is available on the existing internal Play track; production remains23.
The bump helper requires a strictly newer version; it cannot tag that same
prepared version. Publishing the exact candidate would require separate explicit
tag/publication direction rather than another accidental bump.

The tag workflow checks that the tag matches the checked-in version, builds
signed artifacts, then creates a GitHub **prerelease** with:

- `jstorrent-android-X.Y.Z.aab` for Play Console;
- `jstorrent-android-X.Y.Z.apk` for direct installation; and
- `SHA256SUMS` for exact artifact hashes.

Android releases do not take over the repository's desktop latest release.
Publication refuses to overwrite an existing release. Failed builds never
reach the publication job. Minification remains disabled for these candidates;
no mapping file is implied or fabricated.

## Build Without A Tag

Use Actions → Android Release → Run workflow, or:

```sh
gh workflow run android-release.yml --ref main
```

The same signed checks run, but results are retained as an Actions artifact
for 14 days and no GitHub release is created. Download the ZIP from the
completed workflow run's Artifacts section. It contains the AAB and APK.
Artifacts in a public repository are not private; signing keys are never
included in them.

Manual builds use the same signing inputs and original-certificate gate as
tagged builds. A mismatch is a failure; retained diagnostic APK/AAB outputs
are explicitly unqualified and cannot establish installed or Play continuity.
No Play upload is automatic.

## Signing And Backup

For the full one-product cutover, keep the existing CI secret names and replace
their contents with the original JSTorrent signing inputs:

- `ANDROID_UPLOAD_KEYSTORE_BASE64`
- `ANDROID_UPLOAD_KEYSTORE_PASSWORD`
- `ANDROID_UPLOAD_KEY_ALIAS`
- `ANDROID_UPLOAD_KEY_PASSWORD`

Tactical 251's historical CI attempt identified the former canary signer.
On 2026-10-04 Tactical 255 replaces those existing secrets with the verified
original JSTorrent upload inputs. A local private-key signing proof passes;
a fresh hosted CI signing run remains separate evidence. CI decodes the key
into its temporary directory and removes it on normal exit/failure. Local builds
consume `UPLOAD_KEYSTORE_PATH`, `UPLOAD_KEYSTORE_PASSWORD`, `UPLOAD_KEY_ALIAS`
and `UPLOAD_KEY_PASSWORD`. Keep keystore/password backups outside Git, with
restricted permissions; never print their values in diagnostics.

`clients/android/upload-certificate.pem` is public and now pins the verified
GitHub-released JSTorrent 1.0.24 APK signer:
`ccb5af8e44d626e9aefb1f0fbd8496dbf23ad27da9347248e71fb3ce70044915`.
The provenance/hash is in `distribution/jstorrent-production.json`.
`incubation-upload-certificate.pem` retains the former independent canary root.
Final APK/AAB validation refuses that old key and debug keys.

Authenticated Play Console inspection on 2026-10-04 confirms this exact upload
certificate is registered. Google's separate **app-signing certificate** has
SHA-256 `b2b421781fc40c632656d17c72c012a40f623d358e29837adad41cd5d835acd5`.
A locally/GitHub-signed APK does not prove it can replace an installed Play APK.
Do not create a new Play app or enroll new app signing as part of replacement.
An intentional upload-key rotation needs a separate enrollment/backup/secrets
and expected-certificate change.

For a local signed build, load the backup's `signing.env`, then:

```sh
source ~/.profile
source /path/to/android-signing/signing.env
clients/android/build.sh release
```

Missing signing variables fail before building. There is no debug-key
fallback. Google Play App Signing manages the distribution signing key;
the upload key authenticates uploaded bundles. A directly installed APK may
therefore have a different signing identity from the Play-installed app.

## Upload To Play

For the authorized 1.0.31 release, use the existing production track at 100% and
turn managed publishing off so approval publishes automatically. Inspect
pending changes first; this authorizes the 31 release, not unrelated drafts.
Earlier internal-first qualification below describes the initial replacement,
not a mandatory track sequence for this approved hotfix.

Select the **existing JSTorrent (`com.jstorrent.app`)** app. After signing,
version and cutover gates pass and upload is explicitly authorized, upload the
AAB to an appropriate internal/testing track. Install Play-generated artifacts
over selected existing Play builds without uninstall/data clear. Check migrated
torrents/settings, real SAF access, background behavior and staggered extension
updates before promotion. Store form completion or a disposable-signature
emulator rehearsal cannot satisfy signed installed delivery qualification.

## Toolchain And Verification

Java 17, Gradle 8.11.1, AGP 8.10.1, SDK 36, build-tools 35.0.0,
NDK 28.2.13676358, Rust 1.97.0, and cargo-ndk 4.1.2 are pinned.
AGP 8.10 supports API 36 with this existing Gradle version:
https://developer.android.com/build/releases/agp-8-10-0-release-notes

The workflow checksum-pins bundletool 1.18.3. Validation checks the package,
versions, SDK, retained single legacy launcher alias, non-debuggable manifest,
absence of diagnostic receivers,
upload certificate and signatures, matching native libraries in both
artifacts, both supported ABIs, ELF segment alignment, APK ZIP alignment,
and AAB 16 KiB alignment configuration. These are packaging checks, not a
claim of runtime qualification on a 16 KiB device.

```sh
python3 -m unittest discover -s scripts -p 'test_*android*.py'
scripts/release-android.sh --check --tag android-v1.0.25
python3 scripts/validate-android-release.py --bundletool /path/to/bundletool.jar
```

Update the example tag to the current version. Google documents native
alignment requirements at https://developer.android.com/guide/practices/page-sizes.


## Dependency Attribution

Install `cargo install cargo-about --locked --version 0.9.2 --features cli` alongside the
existing Android toolchain. Gradle generates variant-specific notice assets
before packaging. Release construction includes its 79 resolved Maven
artifacts and the union of both Android Rust targets; debug includes four
additional tooling artifacts. These counts are evidence for the current
graph, not hard-coded limits. The manifest records original artifact/POM
hashes and source locators, inherited grants, original embedded notices and
reviewed JNA/graphics native supplements. New native AARs or changed reviewed
archives fail generation.

`inspect-android-notices.py` checks a debug APK without signing credentials.
The signed release validator requires notice integrity and the expected
native-library attribution inventory in both APK and AAB outputs. A changed
or missing notice, wrong variant or extra native library fails the gate.
Do not treat the presence of this bundle as blanket legal clearance or a
corresponding-source offer.
