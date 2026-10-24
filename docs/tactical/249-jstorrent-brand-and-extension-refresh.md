# Tactical 249: JSTorrent Brand And Extension Refresh

Status: **Complete bounded branding slice, 2026-09-30.**

Topics: [product-surfaces-and-migration](../topics/product-surfaces-and-migration.md),
[web-ui-design](../topics/web-ui-design.md),
[client-surfaces](../topics/client-surfaces.md),
[localization](../topics/localization.md),
[desktop-jstorrent-replacement](../topics/desktop-jstorrent-replacement.md),
[android-jstorrent-replacement](../topics/android-jstorrent-replacement.md).

## Accepted Direction

The next production generation replaces JSTorrent in place through its existing
update channels. Desktop retains its application identity and Tauri updater
trust root; Android updates the existing Play app with package/signing continuity;
the extension updates the existing production Web Store item using this repo's
implementation. Store updates may arrive independently under Tactical 248.
Rebrand the successor as JSTorrent before that cutover, retaining its established
icons and familiar torrent-list, detail, folder and native-app workflows.

This supersedes the earlier foreseeable independent RSTorrent product direction.
The repository, Rust crates and internal protocol names may remain RSTorrent.
Separate incubation/test package identities and update routes remain during
qualification. No publication, credential transfer or production release is
part of this slice.

## Scope And Stopping Condition

Restore original JSTorrent desktop, Android and extension icon assets with exact
source/license provenance. Use JSTorrent in desktop/shared React and Android
presentation copy and titles. Refresh the extension popup with familiar blue
accents, light/dark support, concise app-oriented connection guidance, and
accessible focus/status behavior. Style the packaged connection screen with the
same original icon and concise product identity. First-use privacy disclosure
stays visible; returning users may expand their existing settings. Keep the shared application's established
information architecture and user preferences.

Stop after source/catalog checks, web typecheck/unit coverage, packaged extension
validation, Android resource/build validation, and isolated browser visual and
accessibility checks of popup variants and the shared library. Record evidence
and remaining production gates before committing.

## Non-goals And Invariants

No engine, application DTO, catalog schema, importer, pairing, grant, transport,
permission, telemetry or lifecycle changes. No broad crate/path/key replacement.
No iOS or website rename in this desktop/Android/extension slice. No store upload,
release tag, signing-secret use or update-route switch. Desktop incubation bundle
names and the extension's test Web Store ID remain explicitly separate from the
production replacement until a qualified production packaging slice.

Existing controller/service owners and cancellation paths remain unchanged.
Assets are static local resources; CSP gains no remote sources or executable
content. Import only the precise icon family needed for existing first-party
branding, under the sibling JSTorrent MIT license. Carry its copyright/permission
text into packaged notices as well as source attribution.

## Follow-up Gates

- Production desktop package name/identifier, public updater key and route,
  native-host/browser origin registration, signed installed upgrade and OS
  launch/file/magnet continuity.
- Existing Android Play package, signing continuity and increasing versionCode;
  API 26/27 disposition and physical ChromeOS installed upgrade/grant retention.
- Existing production extension ID/public key, backend origin admission,
  identity-preserving extension update and existing launch links.
- Focused shared library/detail/settings design review against JSTorrent, plus
  migration outcomes and recovery feedback; preserve density and familiar actions.

## Evidence

- Original icon/license files match sibling source revision
  `25e4b701433fd815398ba89526546f5e4f072e3f` byte-for-byte. All 30 imported
  assets/texts have path/checksum provenance in
  `distribution/branding/jstorrent-assets.json`. Desktop and Android notice
  generators include the original copyright/permission text; the extension
  packages that text. The obsolete provisional icon/lettermarks are removed.
- `npm run typecheck --prefix clients/web`: pass.
- `npm run test --prefix clients/web`: 438 pass, two intentionally skipped.
  Ordinary and companion production builds/CSP checks pass; boot-failure and
  updater title checks also pass after final display-copy changes.
- `npm test --prefix clients/extension`: 42 pass and manifest validator pass.
- `npm run package --prefix clients/extension`: pass, including the strict
  packaged file allowlist, local PNG and CSP-safe companion build. The icon is
  emitted as a local resource; existing image CSP is unchanged.
- `clients/android/gradlew --project-dir clients/android :app:assembleDebug
  :app:testDebugUnitTest`: pass, 113 JVM tests, zero failures. APK notices and
  source display-name/icon resources checked; no emulator or physical install
  was performed for this presentation-only slice.
- `python3 scripts/inspect-android-notices.py --archive
  clients/android/app/build/outputs/apk/debug/app-debug.apk --variant debug`:
  pass; original JSTorrent license is present in the final APK and extension ZIP.
- `cargo fmt --all -- --check` and `cargo check -p rstorrent-desktop`: pass.
  Only the native notification application display name changes in Rust; no
  engine, ABI or generated application contract changes. Full workspace
  clippy/tests and interoperability were not rerun for this branding slice.
- `node --test scripts/validate-desktop-release.test.mjs
  scripts/validate-desktop-package.test.mjs`: 19 pass.
- `python3 -m unittest discover -s scripts -p 'test_android_notices.py'`:
  ten pass; `node scripts/check-localization.mjs` and `git diff --check`: pass.
- Existing Playwright tests selected with `--grep 'primary destinations|wide
  inspection surface|phone destinations|color themes'`: four pass in isolated
  bundled Chromium (`CI=1`) against an owned Vite server on port 4189. The
  default port was already occupied and its inherited process was untouched.
- Isolated bundled Chromium renders desktop, ChromeOS and fallback popup
  variants in light/dark with first-use/returning privacy state: 12 cases, no
  page errors, horizontal overflow or serious/critical Axe findings. First-use
  disclosure stays open and returning settings remain accessible. Original icons
  load in wide/phone shared views and the narrow connection error screen.
  Popup Chrome APIs are mocked for presentation; existing extension transport
  tests supply protocol evidence. Captures visually inspected and removed.

## Restart Checkpoint

Brand preparation is complete. The next executable delivery slice selects
explicit production candidate configuration and verifies existing package,
updater trust, extension ID/origin and OS launch continuity before an installed
signed upgrade rehearsal. The broader shared UI design pass can proceed
independently; preserve familiar density, actions and user appearance settings.
No production signing secret, user profile, installed app or release changed.

## Native Catalog Follow-up, 2026-10-01

Tactical 252 observes that the signed Windows successor still has RSTorrent tray
copy. The original slice changed shared React and Android catalogs but omitted
the separate Tauri native catalog. Its 17-key catalog now uses JSTorrent for
tray actions/tooltips, notifications, power text and error dialogs; identifiers
and placeholder semantics are unchanged. The focused Rust catalog test, all
four platform localization checks and Rust formatting pass. The existing
36845370571 candidate predates this source-only correction.
