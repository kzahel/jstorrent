# JSTorrent Cutover Operations

Owner: Kyle Graehl. Current execution: [delivery297](tactical/297-staged-store-delivery-and-soak.md).
Detailed acceptance: [cutover checklist](jstorrent-cutover-checklist.md).

## Release bindings

- Desktop0.3.0: signed sourceff632f45, artifact run38050770001,
  tagdesktop-v0.3.0. Retain the qualified binaries and original updater root.
  The final release contains15 core assets, SHA256SUMS and the separately
  verified AppImage corresponding-source archive. Source download is adjacent
  to both Linux buttons; first-party source stays MIT.
- Android1.0.28/code28: signed sourceff632f45, run38050769738;
  existingcom.jstorrent.app and managed Play signer. ARM64/x86_64, API28+.
  Older device compatibility is a separately recorded production choice.
- Extension1.1.3: existing production item, deferred Web Store review.
  Publish after the replacement hosts are obtainable; arrivals may differ.
- Website: curated exact public-release inventory, never unqualified Latest.
  Public privacy already matches the prepared implementation disclosures.

## Order and observation

Current checkpoint: desktop 0.3.0 downloads and updater are live. Play approves
and publishes Android 28 at 5% on October 10 at 16:51 UTC; managed publishing
remains on. Web Store sign-in is restored, but extension 1.1.3 is still Pending
review. Do not expand Android before the actual 24-hour observation and canary
checks complete; the earliest time is October 11 at 16:51 UTC.

1. Verify immutable tag, exact private draft, sources and signatures; finish
   applicable installed checks and hosted CI. Keep unrun rows explicit.
2. Publish desktop download assets; independently hash actual public downloads.
   Enable the website only against that verified inventory.
3. Activate production updating separately. Require production package markers;
   preserve preview selectors and signing roots. Check all platform routes,
   current-version no-update responses and original-root signatures.
4. Submit Android with managed publishing on; start at5% after approval and
   applicable checks. Leave the existing production release while review runs.
5. Publish the approved extension after host availability. Verify an actual
   existing-profile store update, retained pairing and mixed-version recovery.
6. Observe the initial24 hours before expanding Android. Record startup,
   import/repair, retained payload and shutdown outcomes. Store approval, elapsed
   observation and physical-device recovery must not be invented as passes.

## Stop and recovery

One confirmed payload loss, competing engine writer or systematic ordinary
startup failure stops offers/rollout immediately. Halt Android rollout and hold
extension publication. Restore the exact saved production feed descriptor,
rebuild/restart its service if code changed, and verify the old public offer;
website activation can be reverted independently. Preserve failed receipts.

Halting offers does not downgrade installed apps. Stop all engine writers
before any manual rollback, retain original payload and library backups, and
use the [preview-build recovery](#preview-build-recovery) notes below. Never
clear the library as an update workaround. Reports and screenshots stay under
the ignored evidence directory. User-facing help lives in
[user support](user-support.md) and the website support page.

### Preview-build recovery

Earlier `0.1.x` preview packages are unsupported incubation builds. A newer
preview may reset their torrent catalog, settings and private state; downloaded
files are separate. These resets do not apply to production migration. An older
build may refuse a newer catalog, and downgrade compatibility is not promised
for `0.1.x`; preserve a stopped private profile before trying an older build.
A catalog reset is bounded to application-owned catalog files and never
authorizes removing a download root or unrelated files.

Preview `0.1.3` has a Windows old-catalog reset failure: an update can replace
the executable and then fail before opening a usable window. After confirming
the app is stopped, moving `%APPDATA%\com.jstorrent.rstorrent\profile` aside
preserves it for inspection and allows a fresh private profile on next launch.
This loses the old library/settings view but not the download folder. Keep the
old profile until recovery is settled, and do not apply this to a download
folder or to unrelated startup failures without identifying their cause.

On Linux GNOME, a usable tray affordance depends on indicator support. The
qualified x86_64 appliance had an inactive indicator extension; native Quit
worked, but visible tray presentation was not proved.
