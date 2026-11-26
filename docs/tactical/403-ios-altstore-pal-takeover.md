# 403 — iOS AltStore PAL release takeover

Status: In progress, 2026-11-26.

## Scope

Move the `com.jstorrent.ios` release to the Rust repository while retaining the
JSTorrent App Store Connect record (Apple ID `6760584856`), signing team and
`https://jstorrent.com/altstore-source.json`. Keep the existing development
identity for simulator and local testing. The first Rust candidate is 1.0.8,
following the notarized TypeScript 1.0.7 build 9. App Store review, TestFlight,
new signing identities and discovery service registration are outside scope.

## References and invariants

- The previous repository's `ios-ci.yml`, `ios-finalize-release.yml` and
  `ios/scripts/fetch-adp.py` prove the Apple build upload, `NOTARIZATION` and
  version-level package lookup. Preserve the app identity and exact build
  selection. Do not carry over automatic cancellation, unrelated version
  renaming, the legacy review endpoint or the tarball in the PAL source.
- Apple's [notarization flow](https://developer.apple.com/help/app-store-connect/managing-alternative-distribution/submit-for-notarization)
  and AltStore's [publisher guide](https://faq.altstore.io/developers/distribute-with-altstore-pal)
  distinguish review, marketplace processing and public feed promotion.
  CI verifies the review type and attached build before submission. It must
  never submit App Store review or force-release an Apple version.
- Publish only the manifest, signature and unmodified assets described by
  [AltStore's source format](https://faq.altstore.io/developers/make-a-source).
  Keep signed package data and secrets out of Git. Validate the exact tagged
  source and staged public files before advancing the feed. Retain prior feed
  entries when they have a qualified installation route.
- Scope repeatable operations to the selected release and build. Missing
  credentials, review conflicts, failed processing or concurrent website
  changes stop the relevant operation with enough detail to resume safely.
  Bound network waits, downloads and archive extraction.
- An in-place update retains the app container. Prove the Rust build neither
  removes nor overwrites legacy downloaded data. A public update requires
  physical install and upgrade evidence and an explicit disposition for the
  legacy library and preferences under the durable-data policy.

## Validation and stopping condition

Exercise exact build/review selection, retry handling, archive and feed checks
with focused tests. Verify the original signing material, versioned device
archive, workflow syntax, hosted upload/review/package receipts, and the live
staged source on a physical iPhone. Promote only after the required upgrade
and package evidence. Confirm the canonical site's source advertises the
tested build and serves immutable package bytes after deployment.

## Evidence

- App Store Connect reports TypeScript 1.0.7 build 9 as
  `READY_FOR_DISTRIBUTION` with `NOTARIZATION`. The AltStore API successfully
  processed its package. A local download produced the original manifest and
  signature plus twelve variants. The new packaging tool validated the app
  identity and collected all fourteen assets intact.
- The original Apple Distribution certificate is valid through March 14,
  2027. The local key matches the certificate and the app-specific profile
  embeds that certificate. A new protected PKCS#12 wrapping the same key
  signed and exported local Rust 1.0.8 build 10. CI signing credentials are
  configured in the canonical repository's Actions settings.
- The public feed currently links to a legacy tarball and its artwork URLs
  return 404. [Hosted staging run 45870236469](https://github.com/kzahel/jstorrent/actions/runs/45870236469)
  published the [1.0.7 test source](https://github.com/kzahel/jstorrent/releases/download/ios-pal-baseline-v1.0.7/altstore-source.json)
  and verified the public package files byte for byte. A device install is
  still needed.
- The eight focused release-tool tests, workflow and signing-script lint,
  and the iPhone 17 simulator's 30 unit and five UI tests pass. Signing
  uses the tagged source `ade54cb7` for `ios-v1.0.8`.
- The [first hosted upload attempt](https://github.com/kzahel/jstorrent/actions/runs/45870240430)
  imported the signing identity and stopped before upload because the runner
  lacked `rg`. Use system `grep` and let `upload` on `main` run the signing
  script against the unchanged release tag.
