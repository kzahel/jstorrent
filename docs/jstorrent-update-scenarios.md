# JSTorrent Update Scenarios

First-release checklist, agreed 2026-10-09. Make a good-faith effort to give
users an understandable next step when updates arrive separately. This is a
small rollout and recovery checklist, not a promise of legacy feature parity.

## Per-scenario review

For each scenario, show the maintainer representative screenshots in the
conversation with a short account of the behavior, chosen copy/design and any
accepted limitation. Show before/after when changing the screen; otherwise
show the current result. Label renderer fixtures, injected states and real
installed/store captures accurately. If a scenario cannot be exercised, say
so rather than presenting a substitute as its screenshot evidence.

Choose a sensible default and continue independent work without requiring
approval for every reversible copy/design change. Leave room for feedback
before finalizing the scenario, and incorporate incoming feedback into the
active work. Scenario acceptance, screenshot review and store publication
authority remain distinct. Keep images and detailed notes in the ignored
finish-line report; use absolute Markdown image links in conversation.

## Release order

- [ ] Freeze and test the exact desktop, Android and extension candidates.
- [ ] Submit store candidates with Chrome Web Store deferred publishing and
  Play managed publishing; verify those controls before submission.
- [ ] Wait for approvals, then make desktop and Android updates available.
- [ ] Verify both host updates are obtainable, then publish the extension.
- [ ] Check actual existing-install updates and the mixed pairs below. Users
  can remain on different versions after publication; no simultaneous arrival
  is assumed.
- [ ] Name a rollout owner and recovery action. Pause further rollout on data
  loss, competing writers or broken ordinary native startup. An update halt
  does not undo updates already installed.

[Chrome deferred publishing](https://developer.chrome.com/docs/webstore/publish/)
allows up to 30 days after approval. [Play managed publishing](https://support.google.com/googleplay/android-developer/answer/9859654)
holds most approved production changes until manual publication. Internal test
delivery and exceptions must be checked separately. Nothing here authorizes
submission or publication by itself.

## User scenarios

Check a row after a representative run demonstrates its message and recovery.
Source inspection or an injected test alone does not check a store-update row.
Record the tested versions and link a screenshot or receipt in the ignored
finish-line report; avoid adding private device details to this document.

| Check | Scenario | User's recovery story | Current evidence or remaining gap |
| --- | --- | --- | --- |
| [ ] | Old extension + old desktop/Android | Existing behavior continues until either component updates. | Retain one real baseline; no changes to the old release are required. |
| [ ] | New extension + old desktop | Name **JSTorrent Desktop** as needing an update; offer the desktop download/update path, then Retry. Native use remains available meanwhile. | Local source/render pass now offers desktop and extension update links plus native-use guidance. Protocol uncertainty remains explicit; real mixed-install check is pending. |
| [ ] | New extension + old Android | Say **Update the JSTorrent Android app in Google Play**; link its listing, then Retry. Android can be used directly meanwhile. | Specific classification, Play link and bounded no-legacy-pairing tests exist; real store-update check remains. |
| [ ] | Old extension + new desktop/Android | Open the native app directly. Update the **JSTorrent extension**, then reconnect and approve fresh pairing if requested. | Actual official1.1.1 + managed27 shows generic Offline and a launch fallback into Play Store; native shelf return remains usable. This non-migrated profile has no migration card. Imported-cohort guidance and the complete row remain open; old extension errors cannot be rewritten. No intermediate legacy release is required. |
| [ ] | New extension + new host | Open/connect to the same migrated library; approve pairing when requested. | Controlled evidence exists; verify exact released identities and an existing browser profile. |
| [ ] | Required update is not offered | Explain that delivery may still be rolling out. Use the installed native app and retry later. If the OS is unsupported, explain the requirement and alternatives. | Local bundled help now links each store and explains waiting, native use and unsupported OS alternatives. Actual store availability remains unchecked. Never promise an update that the store is not offering. |
| [ ] | App absent, stopped, or service unreachable | Offer the appropriate install link or Open app action. Check browser control and permission; then Retry. | Do not infer “outdated” or “not installed” from a timeout. Local source/render pass distinguishes missing native registration from stopped desktop startup, and names Android permission/setup actions. Real installed recovery remains pending. |
| [ ] | Pairing denied, expired, or changed after update | Open the same app, approve the named request and Retry. Keep the library; do not recommend clearing data or reinstalling as the normal fix. | Existing Android pairing and desktop identity-change paths; final installed check remains. |
| [ ] | Download folder unavailable after update | Select/repair the original folder in native storage settings and approve access. Retain torrents and existing files. | Actual managed27 Library/Storage show retained-library/Repair for an owned missing folder; original-path restoration recovers the verified file with its grant retained. Completed Repair picking, grant-loss and reboot/provider checks remain. |
| [ ] | Linux desktop incompatible, or user switches Android/Linux | Linux is best effort: explain minimum requirements and CLI/headless alternatives. Android and Linux have separate libraries; switching does not migrate torrents automatically. | Final AppImage requirements and usable headless download/instructions still need verification. DEB/RPM are outside this release. |

## Source/render checkpoint, 2026-10-09

Tactical285 makes production Linux AppImage-only on Ubuntu24.04; Tactical287
reconciles the disabled website handoff with15 assets and both architecture
downloads. Its controlled before/after views pass narrow/wide checks and link
to headless setup explicitly from source. New signed/runtime requirements and
obtainable downloads remain to qualify; these fixtures do not close release rows.

Tactical284 also passes a current-source owned API35 installed upgrade using
the released1.0.24 Android app/1.1.1 extension and current beta package. Actual
old/old, both mixed pairs and new/new captures plus native before/after are in
the ignored report. Root/payload/import/restart/control assertions pass.
Disposable signing, emulated ARC and pre-granted beta permission do not close
store or physical rows. Visual review finds the connected390px layout clips;
Tactical286 qualifies the settled layout and filter-drawer interaction: the
first capture caught responsive motion and no product CSS change is needed.
The already-shipped old extension's
generic Offline message remains; native/help guidance is the recovery story.

The first pass covers nine injected packaged connection states and bundled
no-update help, with before/after screenshots. New links, plain recovery copy
and button contrast are locally qualified. No full installed/store scenario
row above is closed by this pass. Remaining captures include old/old, actual
old-extension/new-host native guidance, new/new migrated library, physical
folder recovery and the final Linux fallback package. Public desktop download
availability still depends on the website cutover.

See [Tactical283](tactical/283-companion-update-recovery-guidance.md) for
validation and the ignored finish-line report for screenshots.

## Message and link checks

- [ ] Each actionable message names **Desktop app**, **Android app** or
  **Chrome extension** when known, and includes a relevant link or help action.
  If diagnosis is uncertain, say what to check rather than guessing.
- [ ] Links open the right existing product, and their destination actually
  offers the required release. Opening a listing is not proof of an update.
- [ ] Explain what the user can use meanwhile, and provide manual Retry after
  the requested action. Check one narrow-window screenshot and keyboard access.
- [ ] Unsupported Android versions, managed devices and older Linux systems
  receive a usable explanation without repeated installation loops.
- [ ] Update/recovery instructions preserve existing data and keep one host
  owner. Stop failed migration visibly; no old-protocol writer fallback.

Known destinations:

- [Android app in Google Play](https://play.google.com/store/apps/details?id=com.jstorrent.app)
- [JSTorrent extension in Chrome Web Store](https://chromewebstore.google.com/detail/dbokmlpefliilbjldladbimlcfgbolhk)
- [JSTorrent website](https://jstorrent.com/) — verify its final desktop download
  destination before wiring new recovery links; the website cutover is pending.
- Bundled Chromebook help: `clients/extension/crostini/setup.html`.

Source review: Android companion client/main and `companion.html`; desktop
companion client/main; English localization catalog; extension popup and
Chromebook setup; Android's `legacy_chromeos_migration_guidance` string.
On 2026-10-09, all 71 existing cases in the eight Android/desktop companion
client, upgrade, recovery, platform, handshake and main suites pass. These
prove bounded connection behavior, not real store delivery or final pixels.
See [full release checklist](jstorrent-cutover-checklist.md) for installed,
store, retained-data and publication gates. iOS and a webview-free tray build
are outside this release.
