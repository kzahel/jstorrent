# RSTorrent for iOS

This directory owns the first-party SwiftUI client. The Rust application
service runs in-process; Swift owns Apple lifecycle, security-scoped folder
bookmarks, file coordination, and presentation.

Generate bindings and the Xcode project before building:

```bash
clients/ios/scripts/generate-project.sh
```

Run the CI unit and UI test suite with an absolute, unused result-bundle path:

```bash
clients/ios/scripts/test.sh /absolute/path/RSTorrent.xcresult
```

The runner waits for the selected iPhone simulator to finish booting before
starting Xcode's test and application-launch deadlines.

Product English copy lives in `App/Localization/Localizable.xcstrings` and
Info.plist presentation copy in `App/Localization/InfoPlist.xcstrings`.
English is the only packaged locale; Xcode's double-length and RTL launch
flags provide pseudo-localization evidence. Validate native XLIFF
export/import and the owned phone/tablet simulator matrix from the repository
root with:

```bash
clients/ios/scripts/check-localization-roundtrip.sh
clients/ios/scripts/run-localization-matrix.sh
```

The round-trip check rejects extraction-time source rewrites and imports into
an isolated copy. The matrix creates and removes its own iPhone and iPad
simulators.

The project deliberately contains no development team, provisioning profile,
device identifier, or Apple account. Pass signing settings to `xcodebuild` or
select a local team in Xcode. The development bundle identifier is
`org.rstorrent.ios.dev`, distinct from JSTorrent. The AppIcon and header use
original MIT-licensed JSTorrent blue-box artwork,
with provenance in `distribution/branding/jstorrent-assets.json`. System display
names use JSTorrent; public identity and store delivery remain release blockers in
[`../../docs/topics/beta-release-readiness.md`](../../docs/topics/beta-release-readiness.md).

Create a reproducible unsigned archive without local signing state:

```bash
clients/ios/scripts/archive.sh --unsigned /absolute/path/RSTorrent.xcarchive
```

For a locally signed development archive, supply the team only through the
process environment; never add it to the project:

```bash
RSTORRENT_IOS_DEVELOPMENT_TEAM=... \
  clients/ios/scripts/archive.sh --development \
  /absolute/path/RSTorrent-development.xcarchive
```

The app accepts both `magnet:` URLs and `.torrent` document handoffs. iOS owns
the finite background opportunity: active work may use a UIKit background
assertion and, on iOS 26 or newer, request continued processing. Expiration
stops the in-process service cleanly; durable state resumes on the next launch.
Completion notifications remain an explicit Settings opt-in. No path promises
indefinite background downloading or seeding.

Search, iCloud and identified File Provider roots, legacy JSTorrent migration,
TestFlight, and App Store publication are outside the current campaign.
