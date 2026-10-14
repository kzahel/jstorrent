# JSTorrent support, privacy and recovery

The Rust implementation is being qualified as an in-place JSTorrent update.
Desktop candidate `0.3.0` retains `com.jstorrent.desktop`; Android candidate
`1.0.26` retains `com.jstorrent.app`. Final installed and store qualification is
tracked in the [finish-line checklist](tactical/259-jstorrent-finish-line-checks.md).
Candidate build success is not a production-release or support declaration.
Android 9/API 28 is the replacement minimum. Older Android devices retain the
old app and need a supported OS/device; an unavailable store update is not a
transfer failure to retry indefinitely. App and extension updates may arrive
separately, and companion pairing may need renewal. Android and the explicitly
selected Linux backend retain separate libraries.

Earlier `0.1.x` preview packages are unsupported incubation builds. Their
torrent catalog, settings and private application state may be reset by a
newer preview build. Downloaded files are separate from that private state.
These preview-reset instructions do not apply to production migration.

## Reporting a problem

Open **Settings → About** (named **About & updates** where the app updates
itself) and note the version, build and, when shown, target, package and
profile. Choose **Prepare diagnostics** and review the exact report. Copy it or
download `jstorrent-diagnostics.json`, then attach it to a [new
issue](https://github.com/kzahel/jstorrent/issues/new). Include what you did,
what you expected and what happened. Existing [open
issues](https://github.com/kzahel/jstorrent/issues) may already describe the
problem.

The report is limited to build/package facts, how the page is connected, the
app identifier and build type, the separately deployed page's build, the
update-check privacy model, and a closed update status or operation. It is less
than 2 KiB. It contains no logs, torrent names or hashes, paths, peers, URLs,
installation identifier or credentials. Preparing, copying and downloading it
sends no network request. The preview stays unchanged until you choose Refresh;
Copy and Download use those exact previewed bytes. If clipboard access is
denied, copy the selected text manually or download it.

GitHub issues and their attachments are public. Opening the report page does
not attach diagnostics or prefill private context. Review your description,
screenshots and attachments before submitting; avoid an entire private profile
or unreviewed logs. Native Android/iOS diagnostics-export presentation is not
part of this desktop/shared-browser feature.

## Privacy and data

Ordinary BitTorrent communication exposes network addresses and protocol
identifiers to participating peers and discovery services. Update checks
contact the update service with the running version and target; the service
can observe the request's network address. This differs from a local support
report, which is never automatically uploaded.

Older desktop incubation releases use a random, resettable update identifier.
In builds with **Usage statistics** controls, the disclosed preference governs
identifier use; disabling it makes those checks anonymous with respect to the
installation identifier. Local counters and their reset controls are separate
from torrent verification and downloaded data. New optional identifier/age/
counter context for hosted feedback and extension uninstall remains disabled
until the corresponding public pages and platform behavior are qualified.
No automatic crash-upload service is enabled by Support diagnostics.

## Updates and restarting

Use **Check for updates**, then **Install and restart** when offered. Supported
updater package forms are the self-contained macOS app, per-user Windows NSIS
installation and user-writable Linux AppImage. Package-manager installations
may require the manual [release downloads](https://github.com/kzahel/jstorrent/releases/latest)
path shown in About. An installation failure should leave the current package
available; do not infer success from a replacement file alone.

Closing a window may leave JSTorrent running in the background. Use **Quit
JSTorrent** from its tray/menu to finish shutdown before manually changing its
private files. Historical preview `0.1.3` has a Windows old-catalog reset failure:
an update can replace the executable and then fail before opening a usable
window. Its recovery below concerns only that incubation identity. Current
JSTorrent installed-update qualification has its own source/artifact evidence
in the finish-line checklist.

For that specific Windows `0.1.3` failure, after confirming the app is stopped,
moving `%APPDATA%\com.jstorrent.rstorrent\profile` aside preserves it for
inspection and allows a fresh private profile on the next launch. This loses
the old library/settings view; it does not move or delete the folder selected
for downloads. Keep the old profile until recovery is settled. Do not apply
this procedure to a download folder, or to unrelated startup failures without
first identifying their cause.

On Windows, **Cancel** on the firewall prompt is a valid choice. Outbound
connections remain usable, while unsolicited incoming peers may be blocked.
Allow this exact app on a trusted private network only if that is what you
intend; public incoming allowance is not required for the updater or picker.

On Linux GNOME, a usable tray affordance depends on the desktop's indicator
support. The qualified x86_64 appliance had an inactive indicator extension;
the native Quit action worked, but visible tray presentation was not proved.

## Catalog and payload recovery

An incubation catalog reset is bounded to application-owned catalog files.
It does not authorize removing a selected download root or unrelated files.
An older build may refuse a newer catalog; automatic downgrade and rollback
compatibility are not promised for `0.1.x`. Preserve a stopped private profile
before experimenting with an older build.

Existing downloaded content must be checked before it can be represented as
verified content. Use the normal existing-file/recheck flow after recreating a
library. Missing or corrupt pieces require repair; a catalog entry or filename
alone is not proof of completion. **Remove and keep downloaded files** retains
payloads. A separate delete-data action is intentional data removal.

The maintainer [supported-baseline proposal](release-baseline.md) lists the
evidence and decisions still needed before compatibility promises begin.
