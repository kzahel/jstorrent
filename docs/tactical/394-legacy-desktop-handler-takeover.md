# 394 — Take over legacy desktop launch handlers

Status: source fixes published in desktop 0.3.12, 2026-11-17. Tactical
[398](398-desktop-handler-release.md) records Stable/Latest and canonical
website delivery plus the exact signed Windows VM's native launch,
registration, reinstall/uninstall, data/privacy and restoration evidence.
This qualifies the bounded synthetic legacy cohort, not every historical
installer in the matrix below. Rex's original selected-class repair retains
its rollback evidence; the original source audit follows as background.

## Rex diagnosis and local repair (2026-11-16)

Read-only evidence from both registry views and HKCU/HKLM, effective Windows
`AssocQueryStringW`, installer records, process image, native manifests and
browser profile handler lists establishes this chain:

1. Windows selects `JSTorrent.Torrent` for `.torrent` and `JSTorrent.Magnet`
   for `magnet:`. Both invoke the original `JSTorrent Link Handler.exe`, even
   though the raw `.torrent`/`magnet` registration advertises the current app.
   This is why reinstalling only the new class does not repair the selection.
   A stale Transmission `UserChoice` also exists; the effective API and newer
   selected-class record identify JSTorrent. No selection/hash was edited.
2. The installed helper log records the reported 2026-11-15 activation:
   no old host, launch `https://new.jstorrent.com/launch`, then host timeout.
   The input is private and is intentionally omitted from evidence here.
3. Inno Native Host 0.1.0 and NSIS JSTorrent 0.3.10 coexist in the per-user
   JSTorrent directory. The running image is the current `jstorrent-client`.
   `jstorrent:` still targets the absent TypeScript `jstorrent-desktop.exe`.
4. The new Chrome native host manifest targets its versioned current helper.
   The old Chrome/Edge host name targets the versioned refusal binary. That
   fence is intact and was not changed. No active old host/daemon was found.
5. The Chrome and Edge profiles inspected contain no saved magnet web
   handler. Browser loops remain a separate compatibility case, not rex's
   confirmed causal chain. Profile Preferences were read only.

`python scripts/diagnose-windows-handlers.py --repair-legacy RECEIPT`
changed only the two verified per-user legacy class commands and icons to
quoted `jstorrent-client.exe` targets. The same four values are visible in
both shared registry views (eight receipt entries). Effective `.torrent`
and `magnet:` resolution now returns the current executable, keeping the
same selected ProgIDs. The receipt is retained outside the checkout at
`%LOCALAPPDATA%/JSTorrent/handler-repair-20261116.json`; the tool's
`--restore RECEIPT` checks current values before rollback. No old uninstaller,
UserChoice change, profile rewrite, binary replacement or data cleanup ran.
The installed 0.3.10 SHA-256 remains
`765837937a5d85adbd8c5817e332645a2344dfe3bd757ca83de0f0a3abd8378e`.

## Implementation decisions

- Shipping configuration alone adds `jstorrent` alongside `magnet`; the
  preview identity retains its original scheme list. Cold startup, opened
  URLs and second-instance routing share the existing bounded intake owner.
  Bare `jstorrent://launch` opens the window without a pending torrent.
- The exact launch action accepts a single encoded `magnet` parameter.
  Strict UTF-8/percent decoding happens once; the existing protocol parser
  validates the inner magnet. Duplicate/unknown parameters, credentials,
  paths, fragments, invalid actions and oversize input are rejected. Tokens
  and `torrentPath` cannot read local files. Queue limits, per-event dedupe,
  foreground duplicate suppression and native Add confirmation are retained.
  The installed candidate exposed a second-instance batch loss: plugin 2.4.9
  forwards only one CLI URL, but the callback filtered every URL. It now
  bypasses only the single configured URL actually delivered by the plugin;
  multiple arguments reach the queue once.
- Shipping NSIS hooks adopt only allowlisted legacy classes whose command
  exactly matches the current install directory or the identified Inno
  location. Selected old ProgIDs remain aliases. A dedicated current magnet
  class and Default Apps capabilities are advertised; the verified old
  RegisteredApplications duplicate is retired only after both aliases work.
  PREINSTALL/POSTINSTALL also preserve another client's `.torrent` fallback
  class and generic magnet command/metadata around Tauri's generated writes;
  this covers defaults without protected UserChoice as well. Uninstall removes
  compatibility aliases only while their targets are ours.
  Inert Inno files, capabilities and uninstall metadata are deliberately
  retained: retiring them is a separate owned-file inventory exercise.
- Add/launch/setup/test destinations use one bundled adapter and the share
  parser. `.html` aliases preserve search and fragment together. Explicit
  desktop launch uses `jstorrent:` so retained web magnet handlers can escape.
  No extension status/launch-ping, hidden tests, automatic token dispatch or
  new browser-handler registration remains in these flows. Copy, file-picker,
  download and browser-settings recovery remain available. Exact same-origin
  unregister requests require an explicit click and make no receipt claim.
- `/share/` retains its ordinary torrent-app link and adds an explicit native
  desktop escape. Frozen remote assets and the extension API are unchanged.
  The migration ledger records the installer ownership reader/aliases.

## Validation and remaining qualification

Final local evidence, with native commands run after sourcing
`scripts/dev-env.sh` in Git Bash (every Git operation itself used WSL):

| Command | Result |
| --- | --- |
| `cargo fmt --all -- --check` | Pass |
| `cargo test -p rstorrent-desktop --lib external_intake` | Six tests pass |
| `cargo test -p rstorrent-desktop --lib` | Final 91 tests pass, including configured single-URL versus batch routing and the unchanged native-host refusal tests |
| `python scripts/test_windows_handler_hooks.py` | Pass; compiled shipping hook source executes in a disposable registry namespace, including simulated generated association writes, foreign fallback preservation, owned alias adoption, Unicode/spaces, idempotence, capabilities and conditional uninstall. Synthetic, not a released installer cohort |
| `node --test --test-skip-pattern='requires an executable native host' scripts/validate-jstorrent-candidate.test.mjs scripts/validate-desktop-release.test.mjs scripts/validate-desktop-package.test.mjs` | 37 pass; macOS POSIX executable-mode test excluded on Windows. The unfiltered run fails that pre-existing Windows-inapplicable mode assertion |
| `npm test --prefix website` | 98 pass, three existing promotion integration tests skipped |
| `npm run check --prefix website` | Zero errors/warnings/hints |
| `npm run build --prefix website` | Pass; assembled routes and 63 route/security policies generated; no publication |
| `node scripts/verify-legacy-launch-pages.mjs <Playwright Chromium 1243 executable>` | Nine historical routes plus query alias, three hostile inputs, exact cleanup and share native escape pass; zero page errors. Independent headless test browser is closed/reaped |
| `npm run build --prefix clients/web` | Pass after refreshing dependencies; CSP check passes |
| `npm run typecheck --prefix clients/web` | Pass |
| `npm test --prefix clients/web` | 967 pass, three skipped, one existing settings-dialog test fails (initial timeout; isolated rerun fails finding Settings). No shared web source changed |
| `npm test --prefix clients/web -- --run src/inspection/components/App.test.tsx -t 'validates and atomically saves connection and seeding settings'` | Same Settings dialog failure; left outside handler scope |
| `cargo clippy --workspace -- -D warnings` | Blocked by pre-existing Windows dead code in `rstorrent-platform` picker constants/parser |
| `cargo test --workspace` | Blocked compiling pre-existing Unix-only headless remote-admin and iOS code on Windows |

The command-driven native candidate uses this explicit build override (ordinary
source `cargo build -p rstorrent-desktop --bin jstorrent-client`, after sourcing
the environment script):

```json
{"identifier":"com.jstorrent.qualification.handlers","productName":"JSTorrent Handler Qualification","plugins":{"deep-link":{"desktop":{"schemes":["magnet","jstorrent"]}}}}
```

With that JSON in `TAURI_CONFIG`, `node scripts/verify-windows-launch-intake.mjs`
passes cold startup, warm single/batch delivery, duplicates, Unicode torrent
file activation, a background owner's bare launch followed by a magnet, one
window/pending Add, and local-path refusal. It observes the native IPC queue
and real Add dialog through the candidate's own WebView2 CDP port; it never
confirms Add. The isolated process tree is reaped and its temporary catalog,
config and redirected WebView profile are removed. Before/after installed
registration inventories match. The shipping process/PID and binary hash stay
unchanged. This is native activation delivery evidence, not a user-default
installer upgrade or an OS click against the installed 0.3.10 binary.

The first runner iteration used WebView2's default qualification cache path.
Automatic approval review blocked deleting that disposable
`%LOCALAPPDATA%/com.jstorrent.qualification.handlers/EBWebView` cache, without
a stated reason; it remains inert. Later runs explicitly redirect the WebView
profile into their disposable root. No test processes remain.

Additional source study: the pinned local `tauri-plugin-deep-link-2.4.9`
`src/lib.rs::handle_cli_arguments` and `tauri-plugin-single-instance-2.4.3`
`src/lib.rs::Builder::callback` establish the single-argument delivery rule.
[Tauri's macOS bundler](https://raw.githubusercontent.com/tauri-apps/tauri/tauri-v2.11.5/crates/tauri-bundler/src/bundle/macos/app.rs)
uses the first scheme for the URL type name while retaining the full scheme
array. Its [NSIS template](https://raw.githubusercontent.com/tauri-apps/tauri/tauri-v2.11.5/crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi)
writes generic defaults between the install hooks and removes protocol keys
only when their commands still match. No upstream source or fixtures copied.


See the evidence appended below for exact commands and outcomes. The installed
file/magnet repair is independently checked by Windows association resolution;
source tests or synthetic registry cohorts do not certify an installed release.

The installed 0.3.10 binary still lacks custom-protocol intake. Its broken
`jstorrent:` command is left unchanged until a fixed binary is installed;
retargeting it to a binary that ignores the input would claim a false repair.
No desktop/site release, push, old uninstaller or historical installer upgrade
experiment is performed on the user's installation. Real released Inno/last
TypeScript installer upgrade/uninstall, machine-wide scope, macOS/Linux
installed metadata, browser-owned registration removal and post-Quit OS
launch evidence remain release qualification gaps. `new.jstorrent.com`
ownership/deployment remains outside this checkout; core dispatch no longer
needs its obsolete fallback after the installed class repair.

## Problem and outcome

After upgrading from TypeScript JSTorrent, opening a torrent can still launch
a browser page or an obsolete helper, then report that the native client
cannot be found. Several independently retained handoffs explain this:
Windows associations, a browser's web protocol handlers, hosted compatibility
pages, and native messaging registrations have separate owners.

The successor should take over JSTorrent-owned entry points: `.torrent`,
`magnet:`, `jstorrent://launch`, and historical website links. Existing
JSTorrent selections should reach the current native window and its ordinary
Add flow. This does not mean selecting JSTorrent over another torrent client.

The precise chain on the user's machine remains unconfirmed. A working new
native messaging registration does not fix an old OS or browser handler.

## Audit evidence (before this change)

| Surface | Evidence and gap | Planned disposition |
| --- | --- | --- |
| Old System Bridge installer | Historical Inno installer registers `JSTorrent.Magnet` and `JSTorrent.Torrent`, both invoking `JSTorrent Link Handler.exe`; registers `Software\\JSTorrent\\Capabilities` and `RegisteredApplications` value `JSTorrent`. Different installer identity from Tauri. | Retarget verified JSTorrent-owned classes and capabilities to the successor; retire obsolete dispatch registrations only after their replacements exist. |
| Old standalone helper | Searches old RPC profiles and otherwise opens `https://new.jstorrent.com/launch`. | Stop OS dispatch to it; do not restore an IO daemon or browser-mediated engine startup. |
| Last TypeScript Tauri app | Same `com.jstorrent.desktop` application identity; declares both `magnet` and `jstorrent` schemes. Its native parser accepts `jstorrent://launch?magnet=...`. | Preserve this launch contract with safe parsing and current native intake. |
| Current desktop | `tauri.conf.json` declares only `magnet`; `lib.rs` filters opened URLs to magnets; `external_intake.rs` ignores `jstorrent:` URLs. NSIS hook repairs only the current `.torrent` class command. | Add the missing protocol through configuration, startup arguments, second-instance and opened-URL delivery. |
| Native messaging | `native_host_registration.rs` installs the new host and deliberately maps `com.jstorrent.native` to a refusal helper. | Keep this fence; repairing OS handlers must not reactivate the old host. |
| `/magnet/` | `index.js` registers the web handler `/add/#magnet_uri=%s`. | Stop creating new browser magnet registrations; replace with current setup/repair guidance. |
| `/magnet/setup` and `/magnet/test` | Their scripts register `/share/#magnet_uri=%s`, use hidden test magnets and `window.name` round trips. | Remove these probes and registration behavior; keep stable compatibility routes. |
| `/add/` | Sends `launch-ping` to the production extension, then probes legacy Chrome Apps; parses the old fragment itself. | Use a bounded compatibility adapter and explicit native launch, retaining the input on failure. |
| `/launch` | Sends `launch-ping`; supports old token/path inputs and a `jstorrent://launch?magnet=...` fallback. `desktop=true` automatically navigates. The desktop fallback omits a torrent-file input. | Keep valid launch/magnet links working; remove obsolete messaging and token-based automatic launch. Explain file-picker recovery for old local paths. |
| Current download island | `website/src/components/Downloads.tsx`, mounted by `index.astro`, still probes old `status` and describes responses as installed/native-host status. It also retains an unused `launch-ping` handler. | Remove unsupported detection and dead launch logic; absence of that response must not imply the desktop is missing. |
| Current extension | `externally_connectable` permits the exact Chrome-extension handoff pages and the local host origin; external handlers accept Android/Crostini handoffs, not website `launch-ping` or `status`. | Keep its narrow origin/message boundary. The proposed desktop fix needs no new extension API. |
| Loose historical assets | `/js/index.js` offers an HTTP `/add/` handler; `jstorrent.install.js` is an old Chrome App inline installer. No current page references to either were found. Old diagnostic HTML remains public. | Remove executable obsolete flows after checking their references; retain needed shared images/CSS and compatibility destinations. |

Read-only HTTP checks on 2026-11-15 confirmed production serves `/magnet/`,
its registration scripts, `/magnet/setup.html`, `/magnet/test.html`, `/add/`
and its old messaging script, `/launch` (also `/launch.html`),
`/launch-test.html` and `/testmagnet.html`. HTML-suffix routes may canonicalize
to extensionless paths. `https://new.jstorrent.com/launch` returned **404**.
No protocol registration was executed during this audit.

Historical source study used the sibling `jstorrent-typescript` checkout:

- Commit `70dec609a23e91f7c08e0b997b47115680f6d5ad`,
  `system-bridge/installers/windows/jstorrent.iss` and
  `system-bridge/link-handler/src/main.rs`. Inno AppId is
  `{A1B2C3D4-E5F6-7890-1234-567890ABCDEF}`, version 0.1.0,
  per-user install under LocalAppData/JSTorrent.
- Last TypeScript `desktop/tauri-app/src-tauri/tauri.conf.json`,
  `src/lib.rs`, and desktop README: the later Tauri product already absorbed
  the separate link handler. The old helper is a distinct upgrade cohort.

This is behavioral/source study; no old source, binary or user fixture is
imported. Adopt the existing public launch shape and replace its dispatch;
deliberately do not adopt browser-profile routing, the old daemon or tokens.

## Scope, invariants and limits

- Use the existing native activation owner, queue, deduplication and Add UI.
  OS input opens the native window, including when the host is backgrounded.
  No new companion, HTTP listener, unauthenticated remote API or extension
  command is introduced.
- Preserve catalog databases, downloaded files, legacy import sources,
  preferences, grants and consent. Do not delete shared installation folders
  or run an inherited uninstaller against a newly installed successor.
- Preserve Windows user choices. Repair JSTorrent-owned ProgID targets;
  never edit protected `UserChoice` data or overwrite another client's
  registration. Use Windows Default Apps UI when the user must choose.
- Browser protocol registrations belong to each browser profile, separately
  from Windows associations. Do not edit profile Preferences or reset them.
- Treat custom URLs and website inputs as hostile. Reuse the existing 64 KiB
  activation representation, 16 KiB magnet and eight-pending-item bounds.
  Decode each documented envelope once, reject ambiguous duplicate inputs,
  and reject malformed escapes, unknown actions and non-magnet payloads.
  Never recursively decode until a value looks valid.
- A custom URL must not turn `torrentPath`, `file:`, UNC paths, URLs or command
  arguments into arbitrary local reads or downloads. Native OS `.torrent`
  activation remains supported. Old website local-path handoffs use the
  native picker; opening the app alone is not a successful torrent import.
- Keep inputs out of logs/analytics, DOM HTML and diagnostic receipts. Legacy
  launch tokens grant no authority and are neither reused nor forwarded.
- Public links remain available. Preserve fragments and magnet encoding;
  do not replace `/add/` with a redirect that loses its input. Keep the
  frozen remote asset bridge, released installers and update trust paths
  outside this cleanup.

Windows requires system UI for default-app selection; registration repair
cannot silently choose a different app. See Microsoft's
[default-app platform](https://learn.microsoft.com/en-us/windows/apps/develop/windows-integration/default-apps-platform)
and [Default Apps settings launch](https://learn.microsoft.com/en-us/windows/apps/develop/launch/launch-default-apps-settings).
Edge also has documented Chromium/Chrome native-host registry fallbacks;
the absence of a dedicated Edge key alone is not evidence of a broken host:
[native messaging](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/native-messaging).
Web handlers require an exact template/origin and browser cooperation:
[HTML custom handlers](https://html.spec.whatwg.org/multipage/system-state.html#custom-handlers).

## Implementation sequence

### 1. Restore the native `jstorrent:` contract

Register the scheme alongside `magnet` in the shipping desktop identity.
Implement `jstorrent://launch` as explicit window-open intent and
`jstorrent://launch?magnet=<encoded magnet>` through the existing intake.
Handle cold launch, second instance and opened-URL events consistently,
without reentering plugin locks. Retain existing duplicate/acknowledgement
behavior and the normal user-confirmed Add flow. Add focused parser and
activation tests, including encoded tracker URLs, malformed/oversize inputs,
duplicate delivery and a background host.

Check packaging for Windows, macOS and Linux: a shared configuration change
must not accidentally register the shipping scheme to a preview identity.
No new Android capability is needed: this is desktop OS dispatch, with
existing mobile magnet/share behavior preserved.

### 2. Qualify and repair Windows handler ownership

First extend the controlled Windows diagnostic/rehearsal to capture both
registry views, effective `.torrent`/`magnet`/`jstorrent` associations, command
targets, capabilities, native-host manifests, and installer identities.
Inspect HKCU and HKLM without elevation for diagnosis; mutation follows the
actual installer scope. Include the Inno GUID and `JSTorrent.Magnet` class.
The existing `registry_windows.py` misses those scopes and
RegisteredApplications/Capabilities. `JSTorrent.Torrent` is already covered
by its case-insensitive `JSTorrent.torrent` entry. Observe protected user
choices read-only; restore owned VM snapshots rather than rewriting hashes.

Implement a small explicit allowlist of historical registrations and verify
their JSTorrent ownership from class, installer and command/path evidence.
Retarget existing legacy classes to the quoted current executable and `%1`;
repair icons and capabilities so Windows selections of those class names
continue to work. Do not blindly claim generic `torrent`/`torrentfile`
classes or another application's protocol command. Register the current
application as a supported choice for fresh installs.

Keep selected legacy ProgIDs as compatibility aliases instead of deleting
them. Unregister obsolete dispatch commands/capability duplicates only when
their replacement is established and the key is still ours. Installer and
uninstaller changes must be conditional on current ownership and idempotent.
Check both original Inno and subsequent Tauri/NSIS cohorts; do not assume
matching branding means they share an uninstall identity.

Do not invoke the old Inno uninstaller after installing new registrations:
its unconditional uninstall flags can remove adopted classes/native-host
keys. Retiring old uninstall metadata and binaries needs an exact owned-file
inventory first; inert file removal is secondary to stopping dispatch. Record
the safe ordering and test it before shipping any automatic removal. If a
registration/import reader is added, add its retention condition to the
durable-data migration ledger in that implementation commit.

### 3. Replace the website handoffs and stop new registrations

Use one small compatibility implementation for `/add/` and `/launch`, based
on the current share parser where its formats apply. Preserve known legacy
fragment formats, including `magnet_uri`, `magnet`, and hash-only share
links. Keep `/share/` and its current formats working.

On legacy desktop handoff pages, explicit Open in JSTorrent uses
`jstorrent://launch?magnet=...`, not another bare `magnet:` link: a saved
browser magnet handler may route the latter straight back to the same page.
Keep copy/input recovery and downloads available. An attempted navigation
does not prove installation or receipt; show success only from real product
state, not focus/timeout guesses. No hidden iframe tests, host probes,
automatic token forwarding, browser window closing or history-back timers.

Replace `/magnet/`, setup and test routes with useful setup/repair guidance.
Stop all `registerProtocolHandler` calls. Feature-detect and attempt removal
of the exact known same-origin HTTPS `/add/#magnet_uri=%s` and
`/share/#magnet_uri=%s` templates where supported. This cleanup must not
gate opening the app or claim to clean every profile. Give a browser-settings
fallback when unavailable/denied; do not rewrite profiles or unregister
unrelated handlers. Old HTTP/alternate-origin registrations require their
own origin or user settings and cannot be promised cleaned from HTTPS.

Remove unsupported download-island `status`/`launch-ping` behavior, old
inline-install code and obsolete diagnostic execution. Update
`website/public/LEGACY-URLS.md` with the route contract and retirement
conditions; preserve shared assets used by unrelated retained pages.
Investigate ownership of `new.jstorrent.com` before planning its deployment:
it is outside the current site's route table. A compatibility launch page
there is worthwhile if the domain is still controlled, but the core repair
must stop relying on it.

### 4. Installed qualification and rollout

Use an owned Windows Machine Control testbed/snapshot, not the user's live
installation. Extend the existing installed-upgrade runner, first through
deterministic registry/parser tests, then actual OS launch delivery.

| Cohort or condition | Required evidence |
| --- | --- |
| Original System Bridge, last TypeScript Tauri, current desktop repair, clean install | Before/after ownership inventory; repeat install is idempotent; current native-host works and old name still refuses. A synthetic registry seed is labeled as such until an actual released installer is verified. |
| User-selected old JSTorrent class, browser web handler, another torrent client | Old JSTorrent selections reach new app; browser handler can escape via `jstorrent:`; other client's selection/keys remain unchanged. |
| `.torrent` click, `magnet:`, `jstorrent://launch` with/without magnet, legacy add/share/launch URL | Cold and warm launch, background owner and post-Quit; one native window and one pending Add; no browser/helper relay or silent input loss. |
| Paths with spaces/Unicode; malformed/oversize/duplicate URLs; legacy local path/token | Correct quoting and bounds, no command interpretation or unexpected reads; retained recoverable input; no token authority. |
| Chrome and Edge; 32/64-bit registry views; per-user/machine install | Document actual precedence and permissions; supported UI when user choice is needed; no all-users change from an ordinary per-user launch. |
| Upgrade, repair, restart, current uninstall and safe legacy retirement | No registrations point to removed binaries; uninstallation removes only owned entries; source/payload/database hashes and unrelated registrations preserved. |

Run the proportional Rust baseline and targeted native intake tests;
website check/build/tests, compatibility-page browser tests and assembled
site route/security checks. Run web typecheck/tests if shared web code or
application contracts change. Use the owned test browser, and reap it.
Record exact commands and installed artifacts; do not claim all historical
cohorts from the existing v0.2.1 import evidence.

Land reviewable commits for native intake, Windows migration, and website
adapters. Qualify and release desktop support before public web pages depend
on the restored protocol. During the independent-update window, older or
missing desktop installs retain their input and clear manual recovery.
Preserve additive contracts for at least 30 days and retain historical URL
destinations beyond that while installed browser registrations can reference
them. Publication requires separate release authorization.

## Non-goals and stopping condition

No remote-session changes, new background host, new extension messaging
surface, broad legacy-data cleanup, other-client default takeover or release
publication belongs in this slice. Do not retire the frozen remote assets
just because their minimum retention date passes.

Release qualification is complete only when the installed Windows cohorts reach
the current native Add flow without the old helper/web API, browser loops
have an escape, inputs/state are preserved, and the evidence above is
recorded. A source-only registration change is not that finish line.
