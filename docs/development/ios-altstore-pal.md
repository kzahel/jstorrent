# JSTorrent iOS on AltStore PAL

JSTorrent's existing App Store Connect record is `com.jstorrent.ios`, Apple ID
`6760584856`. Apple notarizes the app. AltStore processes the notarized
Alternative Distribution Package (ADP). The website's source JSON tells
AltStore which package to install. The [`iOS AltStore PAL release`
workflow](../../.github/workflows/ios-pal-release.yml) handles those operations.
Keep the review type **Notarization** in App Store Connect.

## CI credentials

Use the Apple Distribution identity for JSTorrent's original team and an
unexpired App Store Connect provisioning profile specifically for
`com.jstorrent.ios`. The workflow verifies the profile, signing identity,
exported IPA, build number and app ID. `app-store-connect` is Xcode's export
format for uploading a binary for either review path.

| GitHub Actions secret | Value |
| --- | --- |
| `IOS_CERTIFICATE_P12_BASE64` | Base64 of the password-protected Apple Distribution `.p12`, including its private key |
| `IOS_CERTIFICATE_PASSWORD` | The `.p12` export password |
| `IOS_PROVISIONING_PROFILE_BASE64` | Base64 of the JSTorrent App Store Connect `.mobileprovision` |
| `ASC_API_KEY_P8_BASE64` | Base64 of the App Store Connect team API `.p8` |
| `ASC_API_KEY_ID` | ID of the team API key with access to the JSTorrent app and review submission |
| `ASC_API_ISSUER_ID` | Issuer ID of the App Store Connect team |

Use `gh secret set NAME --repo kzahel/jstorrent` with the value on stdin to
provision or rotate a secret. In App Store Connect, **Users and Access →
Integrations → Marketplace** shows the existing AltStore link and whether
JSTorrent is selected. AltStore's registration token is needed only to create
or restore that connection. [Apple's marketplace setup](https://developer.apple.com/help/app-store-connect/managing-alternative-distribution/manage-distribution-on-an-alternative-app-marketplace)

## Upload, review and stage

Create and push `ios-vX.Y.Z` at the reviewed main commit. Dispatch `upload` on
`main` with the version and exact build number. It checks out the tagged app
source and uses the current signing script so CI repairs need no tag changes.
The first Rust candidate follows TypeScript 1.0.7 build 9. Use `status` on main
for a read-only lookup before uploading.

```bash
gh workflow run ios-pal-release.yml --repo kzahel/jstorrent --ref main \
  -f operation=upload -f version=1.0.9 -f build=11
```

1. Run `upload`. It exports and sends the signed IPA to App Store Connect.
2. Run `status` until the exact build is `VALID`. If Apple asks for export
   compliance details or other account information, resolve that in App Store
   Connect before going on.
3. Run `notarize` from the release tag with the same version and build. CI
   checks the attached build and review type immediately before submitting.
   It stops on an incompatible existing version or another active submission.
4. Run `stage` from the release tag after notarization. It fetches the original
   package from AltStore, preserves the signed manifest and assets, and
   publishes them with an install-test source on a GitHub prerelease. The
   workflow verifies the public bytes against their release receipt. A repeat
   staging run can resume the same draft or verify the identical published
   assets. If Apple review or AltStore processing is still pending, retry
   `stage` later.

The one-time upgrade baseline is the old 1.0.7 build 9, notarized in the
TypeScript campaign. `stage` with `version=1.0.7` and `build=9` on `main`
processes the existing Apple package without uploading or reviewing it again.
Retry an existing baseline against `ios-pal-baseline-v1.0.7`.

## iPhone verification and promotion

Install [AltStore PAL](https://altstore.io/download) on the eligible device and
add the staged source URL from the workflow summary using **Sources → +**.
Test installation, launch and a controlled download. Rehearse replacing the
old TypeScript version with the Rust candidate on the same device. Verify
legacy downloaded files, library state and preferences against the durable-data
policy. The Rust client currently opens its own database and does not import
the TypeScript library. Record the result in [Tactical 403](../tactical/403-ios-altstore-pal-takeover.md)
before making an existing install eligible for the update.

After device and upgrade qualification, run `promote` on `main` with the exact
tested version and build and `device_verified=true`. CI verifies the staged
package, commits the new public source, and dispatches the normal website
deployment. Confirm the deployment succeeded and check the
[canonical source](https://jstorrent.com/altstore-source.json) from AltStore
PAL. Re-running promotion after a deploy failure dispatches another deployment
of a matching source.
