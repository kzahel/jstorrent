# Tactical 333: Web Settings Plain Copy

Status: Complete locally, 2026-10-13. Shared React presentation only. No
release is authorized by this tactical.

Topics: `localization`, `web-ui-design`

## Trigger

Tactical [331](331-android-settings-plain-copy.md) deferred the same pattern
in the shared React UI (`clients/web`). Settings and torrent inspection copy
print engine runtime state and maintainer vocabulary:

- Connection & seeding ends in a "Current runtime" block of about 60 lines:
  ten `Effective … policy:` lines, UPnP mappings with addresses and lease
  seconds, IPv6 pinhole states, session UDP binding, `inactive-exempt`
  counts and engine-authored `detail` strings;
- about 40 of its catalog messages are sentence fragments (`The`, `for`,
  `to`, `: degraded (`) concatenated in JSX, so they cannot be translated;
- row copy written for maintainers: "Payload upload slots", "established
  peer traffic", "IGD v2 mappings", "MSE/PE", "admitted at once", "download
  folder registrations", "engine part files", "edge-triggered";
- seeding goals with units in titles (`Share-ratio priority goal (%)`);
- the General tab prints `active, inactive-exempt seed · goal met`, including
  a raw enum value;
- rate limits are entered and shown in KiB/s; several descriptions,
  validation errors and aria-labels are hardcoded English outside the
  catalog.

## Decisions (maintainer, 2026-10-13)

Match Tactical 331 unless the web has a real reason to differ:

- Show nothing when a setting applied, `Applying…` while pending, and one
  short localized line when it failed or was capped (`Limited to N on this
  device`). No engine-authored detail or enum names in product copy.
- Seeding goals stay in React/desktop as an expert control, with plain
  titles; units sit beside the input, not in the title.
- Speed limits use presets (Unlimited, 100 KB/s, 500 KB/s, 1 MB/s, 5 MB/s,
  10 MB/s) plus Custom, in 1024-based KB/s.
- Data units differ from Android because the web already has a preference:
  keep it, relabel Binary as `KB, MB, GB` (1024-based) and make it the
  default; Decimal (`kB`, 1000-based) stays as an opt-in. A stored choice is
  not changed.
- The runtime detail moves into a collapsed **Network details** panel at the
  bottom of Connection & seeding, rewritten as whole localized sentences.
  Engine `detail` strings are not shown; they remain in Logs.
- The unmetered waiting state reads `Waiting for Wi-Fi.`
- English only; translations are a later tactical.

## Scope

- Connection & seeding: regroup into Speed limits, Queue, Seeding goals,
  Connections and Network; per-row notes and listener/UPnP status lines;
  the Network details panel; save/conflict status copy.
- A shared rate picker for the settings form and the torrent settings
  dialog.
- Torrent settings dialog copy.
- Torrent detail General tab: plain seeding state and goal labels,
  Downloaded/Uploaded labels, plain unconnected-tab empty state.
- Downloads, Notifications, Power, Data & reset and Appearance copy; the
  unmetered waiting message.
- A scoped web catalog vocabulary denylist in
  `scripts/check-localization.mjs`.

## Non-goals

- Diagnostics tabs (Peers, Swarm, Disk, DHT, Speed, Pieces, Logs) and the
  demo catalog, which legitimately use protocol terms such as payload and
  KiB. A later tactical decides their copy.
- Remote access and Web access settings, whose security and audit
  vocabulary needs its own review.
- About & updates copy.
- Feedback preview and privacy disclosure wording.
- The `.torrent file selection is not available yet` add-torrent message,
  which explains a failed action rather than advertising a dead row.
- Translations, locale policy, Android or iOS copy.
- Engine, generated application contract, persistence or settings semantics.

## Invariants

- Every control writes the same typed patch as before
  (`ClientSettingsPatch`, `TorrentSettingsPatch`); the draft, conflict and
  Save model is unchanged. Only presentation changes.
- Rate limits keep exact byte values. A preset writes `N × 1024` bytes per
  second; a value that is not a preset displays rounded in KB/s or MB/s and
  opens as Custom. Custom entry keeps its existing exact parsing.
- Seeding goals keep their integer percent and seconds values.
- A setting that failed to apply still says so on its row.
- No enum name, sentence fragment or engine-authored English is shown in
  the scoped surfaces.
- A stored data-units preference is honored; only the default changes.

## Copy specification

Approved before/after table (abridged; unchanged rows omitted).

### Connection & seeding

| Before | After |
|---|---|
| Section intro (IPv4/IPv6, automatic port recommended) | *(removed)* |
| Connection and seeding settings are managed by the live application. | These settings can't be changed here. |
| All torrents peer transfer limits · Caps established BitTorrent peer traffic … | Speed limits · Applies to all torrents. |
| All torrents upload/download limit · KiB/s of established peer traffic. | Upload / Download · preset picker, Custom… in KB/s |
| Enter a positive rate in KiB/s. / … 4,294,967,295 bytes/s. | Enter a speed from 1 to 4,194,303 KB/s. |
| Simultaneous downloads · Incomplete torrents admitted at once … | Max active downloads · More torrents wait in the queue and start automatically. |
| Unlimited active seeds · Remove the seed-only limit … | No limit on active seeds |
| Active seeds · Completed torrents counted in the active seed queue … | Max active seeds |
| Automatic seeding priority · Goals rank completed torrents … | Seeding goals · When more torrents are finished than can seed at once, torrents that haven't reached a goal seed first. Reaching a goal doesn't stop seeding. |
| Share-ratio priority goal (%) · Uploaded payload as a percentage … | Share ratio · [ ] % · Uploaded compared with the torrent's size |
| Finished/download time priority goal (%) | Seeding time vs. download time · [ ] % |
| Finished-time priority goal (seconds) | Seeding time · [ ] seconds (1 day) |
| Peer connection limit · Ordinary outgoing, established … | Max peer connections |
| Payload upload slots · Peers allowed to receive piece payload … | Upload slots · Peers you upload to at the same time |
| Incoming TCP listener · Choose automatic or fixed port selection. | Incoming connections |
| Automatic port / Fixed port / Fixed listener port | Automatic port (recommended) / Fixed port / Port |
| Map incoming TCP and uTP with UPnP · Request independent temporary … IGD v2 … | UPnP port forwarding · Open the incoming port on your router automatically |
| Enable IPv6 · Use IPv6 for DHT, trackers … | IPv6 · Use IPv6 when this device has an IPv6 address |
| Enable DHT · Find peers through the distributed hash table … | DHT · Find peers without trackers |
| Enable peer exchange · Exchange peer addresses … | Peer exchange (PEX) · Share peer lists with other clients |
| Protocol obfuscation (MSE/PE) · … not privacy or security. | Protocol encryption · Helps with some networks and peers. It doesn't make your activity private. |
| Disabled/Allow/Prefer/Required with MSE/PE descriptions | Never encrypt / Accept encrypted connections / Try encryption first / Only use encrypted connections |

### Row notes and status

| Before | After |
|---|---|
| `Effective … policy: enabled.` | *(nothing)* |
| `Label: applying…` | Applying… |
| `Label: degraded (detail). Save settings to retry.` | Couldn't apply this setting. Save to try again. |
| The configured N-peer setting is safely limited to M by available file descriptors. | Limited to M on this device |
| The configured N-download setting is limited to M on this platform. | Limited to M on this device |
| Listener sentences / Listener could not start (reason): detail | Port 6881 · Port already in use · Not allowed on this device · Network address unavailable · Couldn't accept incoming connections |
| UPnP mapping sentences | Forwarding port 6881 · Looking for router… · Opening router port… · No router found · Port forwarding failed · Closing router port… |
| Saving settings… / Settings accepted; waiting for the live view… | Saving… |
| Settings accepted and applying. | Saved |
| One or more settings changed elsewhere. Your draft is preserved for review. | Settings were changed somewhere else. Your edits are still here. |

Application states map to rows: transport to Incoming connections and IPv6,
port mapping to UPnP, peer connections, upload slots, bandwidth to Speed
limits, encryption, DHT and peer exchange to their rows.

### Network details panel

Whole sentences, durations instead of seconds, no `Effective` lines (the
form shows those values), no engine `detail`. Examples: `UDP: port 6881`;
`IPv4: TCP … · UDP … · Shared with peers as …`; `Router forwarding (TCP):
port 6881 → 192.168.1.20:6881, renews every 1 h`; `The router may keep port
6881 open for up to 15 min.`; `Port forwarding failed while finding the
router's public address.`; `IPv6 firewall opened for port 6881 (renews every
1 h).`; `The router doesn't offer IPv6 firewall control.`; `Peers are told to
use port 6881. No incoming peer has connected yet.`; `Outgoing connections
only. Peers aren't given a port.`; `Active downloads: 2 of 3 (1 checking)`;
`Active seeds: 4 of 5 (2 idle, not counted)`; `Development build: accepting
connections from this computer only, on port 6881.`

### Torrent settings dialog

| Before | After |
|---|---|
| These caps combine with the All torrents limits. Trackers, DHT … | Limits for this torrent. Limits for all torrents still apply. |
| Peer transfer limits | Speed limits |
| Torrent upload/download limit · Unlimited · KiB/s | Upload / Download · preset picker |
| Save torrent limits / Saving torrent limits… / Saved; waiting for the live view… | Save / Saving… / Saving… |
| Torrent peer transfer limits saved. | Saved |
| These limits changed elsewhere. Your draft is preserved for review. | These limits were changed somewhere else. Your edits are still here. |

### General tab

| Before | After |
|---|---|
| Lifetime downloaded / Lifetime uploaded | Downloaded / Uploaded |
| Seeding priority: `active, inactive-exempt seed · goal met` | Seeding: Seeding (idle) · Goal reached |
| active seed / queued seed / active, inactive-exempt seed / not eligible to seed | Seeding / Queued / Seeding (idle) / Not seeding |
| Seeding goals affect automatic priority … Met thresholds: … | Goals reached: share ratio, seeding time. / No goals reached yet. |
| `<Tab> view scaffold` · This named projection is not connected yet … | Nothing to show yet. |

Active time and Finished time stay because the seeding goals use them.

### Other sections

| Before | After |
|---|---|
| Download folders are managed by the live application. | Download folders can't be changed here. |
| The default/current folder applies to future torrents only … | New downloads go here. Existing torrents stay where they are. |
| Options are always shown when no usable default exists. | Always shown when there's no default folder. |
| Checked means Normal; unchecked means Skip. | Choose which files to download before starting. |
| Native desktop notifications are edge-triggered … | *(removed)* |
| Notify when a torrent finishes downloading. | When a download finishes |
| Notify when a torrent enters a fatal or repair-required state. | When a torrent or folder needs action |
| Keep showing notifications while the main window is the active window. | Also notify while you're using JSTorrent. |
| JSTorrent can prevent automatic system sleep … | Keeps your computer awake while downloading or checking files. The display can still turn off. |
| Prevent sleep during active downloads and checks · Releases automatically … | Prevent sleep while downloading |
| Remove all torrents and download folder registrations, then restore preferences … | Removes all torrents and download folders and restores default settings. Downloaded files are kept unless you choose to delete them. |
| All torrents and download folder registrations will be removed. This cannot be undone. | All torrents and download folders will be removed. This can't be undone. |
| Also delete downloaded files registered to these torrents | Also delete downloaded files |
| Only exact registered files and engine part files are eligible … | Only files downloaded by your torrents are deleted. Other files in your folders are never touched. |
| Reset appearance, download prompts, connection and seeding settings … | Settings return to their defaults. Your torrents, folders, files, access, and privacy choices are kept. |
| Data units · Binary (KiB …) · Decimal (kB …, default) | Size units · KB, MB, GB: 1 KB = 1,024 bytes (default) · Decimal kB, MB, GB: 1 kB = 1,000 bytes |
| Waiting for an unmetered network. | Waiting for Wi-Fi. |

## Validation

- `npm run generate:localization --prefix clients/web`
- `npm run typecheck --prefix clients/web`
- `npm run test --prefix clients/web`
- `node scripts/check-localization.mjs`, including the new web denylist.
- Before/after Playwright Chromium captures of each changed settings
  section, the torrent settings dialog and the General tab from the demo
  application; the before set runs from a detached HEAD worktree. Images
  stay in the ignored `mockups/web-settings-copy/`.

## Stopping condition

All scoped surfaces use the approved copy and structure, the denylist check
passes, the validation above passes, and this record lists the evidence.

## Execution record

- Web catalog: 1,357 to 1,336 messages (184 removed, 163 added, five Data &
  reset messages rewritten in place). All JSX-concatenated fragments in
  Connection & seeding are gone; hardcoded descriptions, validation errors
  and aria-labels in the touched components moved into the catalog.
- `RateLimitPicker` (Unlimited, five presets, Custom KB/s) serves the
  global and per-torrent limits. Its draft stays `{ unlimited, valueKiB }`,
  so `validateRateLimit` and both patches are unchanged; a stored non-preset
  value opens as Custom.
- Row notes come from the existing `*_application` states, with
  `ipv6_application` on the IPv6 row. On Incoming connections and UPnP a
  specific status failure (for example `Port already in use`) takes
  precedence over the generic `Couldn't apply this setting`.
- The General tab's Status row printed `operationalState` with underscores
  replaced, and the seeding row printed the goal enum. Both now use
  localized labels. The metric `text-transform: capitalize`, which only
  served raw enums, is removed because it turned `kB/s` into `KB/S`.
- Port validation ranges are shown without digit grouping; other ranges use
  locale number formatting.
- `scripts/check-localization.mjs` rejects maintainer vocabulary and
  leading-punctuation fragments in the scoped message prefixes, and
  `replaceAll("_", " ")` in Connection & seeding, DetailPane and the Torrent
  settings dialog. Against the HEAD catalog the rules report 53 vocabulary
  hits and 13 fragments; the new catalog reports none.
- Unit, component and Playwright specs updated to the new copy. Data-unit
  tests swap decimal and binary where the default changed; the reformat
  spec now also requires a rendered size to change between unit systems.
- `tests/inspection-live.spec.ts` reads the listener port from the
  Incoming connections row (`Port N`) for
  `tests/interop/client_settings_restart.py`.

## Evidence

- `npm run generate:localization --prefix clients/web`
- `npm run typecheck --prefix clients/web`: pass.
- `npm run test --prefix clients/web`: 77 files, 532 passed, 2 skipped.
- `node scripts/check-localization.mjs`: web 1,336, desktop 17, Android
  492, iOS 172 + 6, policy valid.
- Playwright Chromium (`VITE_RSTORRENT_ENABLE_PSEUDO_LOCALES=1`):
  `tests/inspection-demo.spec.ts` and `tests/localization.spec.ts`, 33
  passed, including the serious/critical Axe checks on Settings and the
  Torrent settings dialog at wide and phone widths.
- Not run: `tests/inspection-live.spec.ts` and the client-settings interop
  scenario, which need a live gateway; their updated assertions are
  unverified.
- Before/after captures of each demo settings section (with Network
  details expanded), the Torrent settings dialog and the General tab for
  three torrents, from Playwright Chromium against the demo application.
  The before set ran from a detached HEAD worktree. Images and the review
  report are kept in the ignored `mockups/web-settings-copy/`. The demo
  route has no Notifications or Power category; those sections are covered
  by component tests only.

## Deferred

- Diagnostics tab copy, Remote access and Web access copy, About & updates.
- The Torrents table Status column title-cases `operationalState` without
  localization (`TransferTable.statusLabel`).
- Translations.
