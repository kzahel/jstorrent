# JSTorrent Extension

Tactical [249](../../docs/tactical/249-jstorrent-brand-and-extension-refresh.md)
restores JSTorrent branding and the original icons, with a compact light/dark
popup and app-oriented connection screens. Android is the primary Chromebook
choice; the separate Linux preview remains available in an expandable option.
First-use privacy disclosure remains visible; returning users can expand
Privacy & feedback. Metrics policy, permissions and connection ownership do
not change.

The base manifest retains the isolated beta identity for testing.
`manifest.jstorrent.json` supplies the existing production Web Store identity
and version for `npm run package:jstorrent`. Desktop control uses the bounded
`com.jstorrent.rstorrent.native` helper. Retained beta archives are test/legacy
compatibility, not a second publication lane.

This Manifest V3 extension retains the bounded desktop and Crostini bootstrap
surfaces from Tactical
[`166`](../../docs/tactical/166-desktop-native-bootstrap-and-extension-scaffold.md).
It checks for the distinct `com.jstorrent.rstorrent.native` host and can ask
the installed successor desktop app to open. Tactical
[`167`](../../docs/tactical/167-chromeos-crostini-bundled-web-launcher.md) also
lets the exact local `jstorrent.localhost:3030` handoff page wake the worker and
reuse its tab for the backend-served React UI.

Tactical [`194`](../../docs/tactical/194-chromeos-android-extension-control.md)
adds an explicit ChromeOS Android connection. The extension packages the
shared React product application, pairs with the successor Android foreground
service, and uses only the typed application WebSocket plus the authenticated
SAF folder-picker capability. The engine, profile, payload IO, hashing, and SAF
grants stay in Android. The extension packages its own UI and runs no remote
code. Production packages retain the existing JSTorrent store item.

The popup is platform-aware. Desktop Chrome opens the shared torrent library;
ChromeOS presents Android connection and the optional separate Linux preview.
Unknown platforms show both as a recovery fallback. The exact Google Play link
opens the existing JSTorrent listing; it does not establish Play availability or
prove that a production successor APK has shipped.

## Validate And Package

```bash
npm test --prefix clients/extension
npm run package --prefix clients/extension
npm run package:jstorrent --prefix clients/extension
```

The package command validates the reviewed file allowlist and writes
`target/extension/jstorrent-beta-<version>.zip`. The ZIP deliberately excludes
this README, store notes, scripts, dependencies, build output, and secrets.
The production command writes `target/extension/jstorrent-<version>.zip`.
Extract the selected ZIP to load it unpacked; loading the source directory
alone does not include the built companion UI or the production overlay.

## Local Desktop Production-ID Rehearsal

For ordinary macOS development, launch `./scripts/desktop-bundle` from the
repository root. Its debug `.app` can register with Chrome and serves the same
development library as `./scripts/desktop`. The raw launcher is outside a Mac
app bundle and cannot repair that registration. See the
[client guide](../../docs/development/clients.md#desktop) for build-only and
switching back to the installed desktop app.

Tactical [336](../../docs/tactical/336-production-desktop-extension-control.md)
repairs the native helper's beta-only desktop-control guard. Released desktop
0.3.0/0.3.1 need a corrected desktop build; an extension reload cannot fix that
installed helper.

`scripts/verify-production-desktop-extension.mjs` runs a headed Chrome for
Testing with the unpacked production ID. It verifies cold/warm attachment,
singleton launch, native window opening through Machine Control observation,
reload/detach and explicit restart after graceful native Quit. Prepare a fresh,
isolated macOS candidate with identifier `com.jstorrent.check` (use a JSON
`TAURI_CONFIG` override with `desktop-bundle`), its registered native helper,
and a claimed/approved Machine Control host session first. Keep
the bootstrap path short enough for macOS Unix sockets. Supply `--extension`,
`--profile`, `--mc`, `--registry`, `--claim` and `--output`; the runner owns its
test browser and terminates only that isolated candidate. Back up and restore
inherited native-host registrations outside the runner, including the Chrome
for Testing registration used by its separate browser. Never use a personal
torrent library or replace the signed installed app for this rehearsal.

## Chrome Web Store Identity

The draft store item is `gcgoepclopkgijmclmlheafaglmbjlcc`. Its public key is
pinned in the manifest so store and unpacked builds retain that identity. The
validator independently derives the extension ID from the public key and
rejects any mismatch.

Upload each generated ZIP to that same dashboard item rather than creating a
new one. Loading this directory unpacked must also display the pinned ID.
Publication is not required for the bootstrap checkpoint. Do not commit a
private `.pem` file or store credentials; the manifest contains only the
dashboard's public key.

This follows Chrome's official [manifest key procedure](https://developer.chrome.com/docs/extensions/reference/manifest/key).

## Automated Store Releases

Production releases go to the existing JSTorrent item
`dbokmlpefliilbjldladbimlcfgbolhk` through
[`extension-release.yml`](../../.github/workflows/extension-release.yml),
adapted from Yep Anywhere's publisher.

1. Add a `## [<version>]` section to [`CHANGELOG.md`](CHANGELOG.md) and commit.
2. From a clean, current `main`, run `scripts/release-extension.sh <version>`.
   It bumps `manifest.jstorrent.json` when the version is newer (or keeps an
   already-prepared untagged version), commits, and atomically pushes `main`
   and `extension-v<version>`.
3. CI runs the web typecheck and tests, the extension tests and packaging
   (refusing a dirty source), and the live compatibility matrix. Only then
   does it authenticate with Google and upload the exact ZIP.
   `scripts/publish-store.mjs` checks the source revision, checksum and pinned
   store identity (item ID and manifest key), cancels an older pending
   submission once if needed, uploads, and submits with review enabled.
   A GitHub release keeps the ZIP, checksum, `build.json` and store receipt.
4. Record the delivery in `compat/deliveries.json` and capture its client
   (`node scripts/compat-capture.mjs --commit <sha> --roles client`). The
   ledger check fails CI until this is done for a pushed `extension-v*` tag.

Google still reviews and publishes; a green workflow means submitted, not
delivered. Listing, privacy and permission justifications remain dashboard
forms.

### One-time setup

Done 2026-10-15; values and evidence are in
[Tactical 361](../../docs/tactical/361-extension-store-publishing-setup.md).
It mirrors Yep Anywhere's setup:

- A GitHub environment `chrome-web-store` limited to `main` and
  `extension-v*`, with variables `CWS_WIF_PROVIDER`, `CWS_SERVICE_ACCOUNT` and
  `CWS_PUBLISHER_ID`. No private key or refresh token is stored in GitHub.
- In Google project `yep-dev-3fd5a`: the Chrome Web Store API enabled, and
  provider `github-jstorrent` in pool `ya-chrome-store`, whose condition
  allows this repository's IDs, the `chrome-web-store` environment subject,
  this workflow's `workflow_ref` and `main` or `extension-v*`. This
  repository uses GitHub's immutable OIDC subject, so the subject is
  `repo:kzahel@158352/jstorrent@1317190900:environment:chrome-web-store`.
  Only that subject has `roles/iam.workloadIdentityUser` on the service
  account.
- The JSTorrent item belongs to the same publisher as Yep Anywhere, whose
  API access links the service account. Access is publisher-wide; the
  script pins this item.

Verify without changing the store:
`gh workflow run extension-release.yml --ref main -f mode=check`.

To see which version browsers are being served right now, with no
credentials: `node scripts/extension-store-version.mjs` (add
`--expect 1.1.5` to fail unless that version is live).

## Store Review Boundary

The extension detects and opens the locally installed RSTorrent desktop
application and performs the ChromeOS Linux tab handoff. Its regular
permissions are `nativeMessaging` and `storage`; the user may grant only the
optional `http://100.115.92.2/*` ARC host permission from the explicit Android
connect action, or `http://jstorrent.localhost/*` from the offline Linux
connection page's explicit Retry. Neither is granted automatically. It has no content scripts,
and does not fetch executable code from either backend. Its CSP admits only the
five fixed RSTorrent Android HTTP/WebSocket ports, reviewed legacy discovery
ports, desktop loopback control and exact Linux port 3030. The Linux page checks
bounded product/protocol health before opening the separate Linux library and
keeps offline troubleshooting available on failure. Ordinary explicit connection
fetches a fresh HTML document to avoid old cached package asset references;
warm handoff focuses an existing connected tab without reloading it. External messaging remains
manifest-limited to `http://jstorrent.localhost/*`, while the worker separately
requires the exact Crostini port, path, message keys, protocol version, and
sender tab.
