# Tactical 331: Android Settings Plain Copy

Status: Complete locally, 2026-10-13. Android presentation only. No release
is authorized by this tactical.

Topics: `localization`, `android-jstorrent-replacement`

## Trigger

A side-by-side review of the JSTorrent TypeScript Android app
(`~/code/jstorrent-typescript/android`) and this Android client found that
Settings and the torrent Details/Status tabs read like engine diagnostics:

- every row printed `ClientSettingsRuntimeView` state into its subtitle
  (`Effective 200 · Applied`), the engine's English `Degraded.detail`, and
  raw `enum.name.lowercase()` values (`available`, `transferring_pieces`,
  `platform_limit`);
- copy written for maintainers: "genuinely finishes", "desired-running",
  "durable run intent", "inactive-exempt", "fresh-profile default",
  "download-folder registrations", "payload and part files",
  "Established peer traffic", "one-byte precision";
- three seeding-goal settings the old app never had, with units in titles;
- `Not available yet` rows for VPN-only, Proxy, Low-battery shutdown and
  Search plugins, which advertise a regression from the old app;
- no section headers; speed limits last on their own page.

The review report with old/new/proposed screens is
`mockups/android-settings-copy/report.md`.

## Decisions (maintainer, 2026-10-13)

- Remove the seeding-goal settings and per-torrent seeding goal rows from
  Android. Engine defaults and any already configured values still apply;
  nothing is reset. React/desktop keep their controls.
- Speed limits use presets (Unlimited, 100 KB/s, 500 KB/s, 1 MB/s, 5 MB/s,
  10 MB/s) plus Custom. KB/MB are 1024-based, as in the old app.
- The unmetered preference is labelled `Wi‑Fi only`. Its detail states it
  pauses on mobile data and metered Wi‑Fi; waiting states read
  `Waiting for Wi‑Fi`. The engine policy is unchanged (unmetered).
- English cleanup first. Translations are a later tactical.
- The same pattern in React inspection copy ("Effective DHT policy:") is a
  separate tactical.

## Scope

- Settings hub subtitles, section headers on every settings page.
- Storage: one row per folder with a menu (Set as default, Remove folder),
  an explanation and `Add download folder`.
- Speed & Limits: Speed limits, Queue, Connections sections; preset rate
  dialog; no subtitle when a value applied normally.
- Network & Privacy: plain listener/port-forwarding status, no lease or
  router address detail in rows, no VPN/Proxy rows.
- Notifications, Power Management, Advanced: plain copy, theme picker row,
  system colors row hidden below Android 12, no local usage summary row,
  no unavailable rows; short reset/clear dialogs and progress copy.
- Torrent Details tab: info hash, size, save location, downloaded,
  uploaded, share ratio, seeding time, then per-torrent speed limits.
  Status tab: localized state and activity, no raw enums, error only when
  set.
- Wi‑Fi wording in library/notification waiting states and a few
  maintainer-facing strings elsewhere (sort label, background-unavailable,
  remove detail, file-selection limit, channel descriptions).
- A catalog denylist check for maintainer vocabulary in Android strings.

## Non-goals

- Translations, locale policy or an in-app language picker.
- Engine, UniFFI contract, persistence or settings semantics changes.
- Old Details metadata (added date, comment, created by, private flag):
  `TorrentView` does not expose it; bringing it back needs a contract change.
- Trackers/Peers/Pieces diagnostic copy (`tracker.status.name.lowercase()`,
  swarm and storage pipeline summaries). They are diagnostics surfaces and
  stay for a later pass.
- Feedback preview and privacy disclosure wording, which earlier tacticals
  chose deliberately for recipient accuracy.
- React and iOS copy.

## Invariants

- Every control writes the same typed patch as before; only presentation
  changes. Removing a row never resets its value.
- A setting that failed to apply still says so, with a localized line; the
  engine detail remains available in Logs.
- No enum name or engine-authored English is shown in settings rows or the
  Details/Status tabs.
- Rate limits keep exact byte values; a non-preset value displays as its
  rounded KB/s or MB/s and opens as Custom.

## Validation

- `clients/android/build.sh`; `lintDebug`, `assembleDebugAndroidTest`,
  `testDebugUnitTest`.
- `node scripts/check-localization.mjs`, including the new denylist.
- Updated `ProductNavigationTest` cases for settings, rates, network status,
  data reset and details on an owned emulator.
- Before/after captures of each settings page and the Details/Status tabs.

## Stopping condition

All scoped screens use the new copy and structure, the denylist check passes,
the validation above passes, and this record lists the evidence.

## Execution record

- Android catalog: 540 to 492 resources. Removed the seeding-goal,
  "Effective"/"Applied", enum-detail, router-lease and "Not available yet"
  copy; added section headers, preset/unit, Wi-Fi and activity labels.
- `settingNote` replaces `settingsApplicationLabel`: nothing when applied,
  `Applying…` while pending, `Couldn’t apply this setting` when degraded.
  A value the engine clamps shows `Limited to N on this device` or
  `Using X`.
- Rate dialog: Unlimited, 100 KB/s, 500 KB/s, 1 MB/s, 5 MB/s, 10 MB/s or
  Custom KB/s (existing exact parsing). Values outside the presets open as
  Custom. `formatBytes` now labels KB/MB/GB (still 1024-based).
- Storage: star marks the default; Repair and a menu (Set as default,
  Remove folder) per folder; `Add download folder` row.
- Details tab: info hash, size, save location (root label), downloaded,
  uploaded, share ratio, seeding time, Speed limits. Status tab: State,
  Activity (only when it differs), Download, Peers, ETA, Error when set.
- Catalog loading labels are `Loading files…`/`trackers…`/`peers…` so they
  no longer duplicate tab names.
- `scripts/check-localization.mjs` rejects maintainer vocabulary in the
  Android catalog and `.name.lowercase()` in `ProductApp`,
  `ProductFormatting` and `ProductSettingsScreens` (Logs severity/profile
  names excepted).

## Evidence

- `clients/android/build.sh` (debug) native/bindings build; Gradle
  `assembleDebug testDebugUnitTest lintDebug assembleDebugAndroidTest` pass:
  153 JVM tests, lint with no errors and no new warnings in changed files.
- `node scripts/check-localization.mjs` passes with the new checks.
- `ProductNavigationTest` on owned AVDs created and deleted by
  `run-localization-matrix.py`: 38/38 on API 35 (twice, the second on final
  source) and 38/38 on API 28. Updated cases cover storage, rate presets,
  max active seeds without goals, PEX/DHT patches, plain network status
  without engine detail, notifications, power and data reset copy.
- Before/after captures of every settings page and the Details/Status tabs
  from a temporary Compose capture test on an owned API 35 Pixel 6 AVD; the
  before set ran from a detached HEAD worktree. Images are kept beside the
  uncommitted review report, not in the repository.

## Deferred

- Translations (Android locales seeded from the original app's catalog).
- React inspection copy with the same "Effective … policy" pattern.
- Trackers/Peers/Pieces diagnostic copy and enum names.
- Original Details metadata that `TorrentView` does not expose.
