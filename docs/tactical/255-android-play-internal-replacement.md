# Tactical 255: Android Play Internal Replacement

Status: **Complete — internal Play release published, 2026-10-04.**

Topics: `android-jstorrent-replacement`, `product-surfaces-and-migration`,
`beta-release-readiness`.

## Scope And Stopping Condition

The maintainer authorizes fixing the missing RSTorrent replacement on the
existing JSTorrent Play internal track and supplies its original upload key.
Verify that key against the authenticated Play upload certificate, restore the
existing Android signing inputs, build and validate the current production
candidate, then upload and release it to the configured internal testers.
Stop after Play reports the replacement available to internal testers and the
exact source, artifact and signing evidence is recorded.

Production rollout, new signing keys, store/app identity changes, desktop or
extension publication, and personal-device installation are outside scope.
Internal availability does not close the full installed migration checklist.

## Invariants And Validation

- Retain `com.jstorrent.app`, existing launcher alias and Google-managed app
  signing. Version 1.0.25/code 25 exceeds Play's observed maximum code 23.
- Keep all private key/password material outside Git and tool output. Use the
  existing Android CI secret names and retained public upload certificate.
- Verify APK/AAB signatures, release metadata, both ABIs, 16 KiB alignment,
  packaged notices, release JVM tests and lint through the existing scripts.
- The existing shared internal tester list is the only intended audience.
  Production remains 1.0.23; no production promotion is authorized.

## Signing Baseline

Authenticated Play Console inspection on 2026-10-04 confirms the upload
certificate SHA-256 is
`ccb5af8e44d626e9aefb1f0fbd8496dbf23ad27da9347248e71fb3ce70044915`,
matching the retained public certificate and the supplied keystore's `upload`
alias. Google-managed app signing uses the separate SHA-256 certificate
`b2b421781fc40c632656d17c72c012a40f623d358e29837adad41cd5d835acd5`.
The previous internal release is 1.0.14/code 14. Latest uploaded/production
bundle is 1.0.23/code 23; no replacement was uploaded before this task.

## Execution

The supplied private key signs and verifies an owned temporary JAR. Its store
and key passwords match. A private backup is retained outside Git with owner-only
permissions; the existing four `ANDROID_UPLOAD_*` repository secrets are updated.
Their update timestamps are verified. No new hosted signing run is claimed.

Built locally from product source
`42a1181767438b8c792d7ae1a04a44e0e78e7257`, including the current Android retained
folder and pairing recovery fixes. The source checkout had three existing local
commits beyond origin; this task does not push them or create a release tag.
Only documentation changes were present during the build.

Validation passed:

- 23 Python Android release-tool tests and release source/changelog check.
- `clients/android/build.sh release`: both ABIs, release APK/AAB, 116 JVM tests
  with zero failures/errors/skips, release lint and packaged notices.
- `validate-android-release.py` with checksum-pinned bundletool 1.18.3: original
  upload signatures, package/launcher, API 28/36 metadata, 16 KiB ELF/ZIP
  alignment, matching APK/AAB native libraries and exact notice checks.

The exact artifact hashes are retained in
[`android-play-internal-255.json`](../evidence/android-play-internal-255.json).
Google Play accepted version code 25 under the existing app and upload key.
The internal release **1.0.25 - Rust engine internal test** was published at
06:43 UTC and verified **Active / Available to internal testers**. The existing
shared internal audience remains the sole selected list. Production remains
1.0.23/code 23.

Play required acknowledgment that 5,706 previously supported devices are outside
this candidate's API/ABI coverage; the API 28 minimum and arm64-v8a/x86_64 lane
are retained. Other warnings concern the larger download and absent deobfuscation
file; minification is disabled. No signing, artifact-integrity or metadata
validation was bypassed.

Next: opt in and install the Play-delivered replacement on selected old-app
cohorts, verifying retained data/SAF access and staggered extension behavior.
Internal distribution alone does not close those cutover checklist rows.
