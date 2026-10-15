# Tactical 371: Statistics And Compatibility Reporting Rollout

Status: Ready, 2026-10-15. Handoff plan for a machine with access to the
update server (the Pi, SSH host `pi`) and the maintainer's dotfiles. The
repository side of each step is already on `main` unless the step says
otherwise.
Topics: `product-state-and-feedback`, `mixed-version-compatibility`.

## Context

- Maintainer policy (2026-10-15, `product-state-and-feedback`): usage
  statistics are on unless the user opts out with the first-run choice;
  opting out leaves only what an update check needs. Remote access is a
  hosted service and may record operational version data. The privacy
  policy (`website/public/privacy.html`) says so and deploys with the
  website on push to `main`.
- Desktop update checks (`clients/desktop/src-tauri/src/update_channels.rs`)
  send `X-Check-Reason`, `X-Statistics: on|off|unreviewed` (no identifier),
  and `X-CFU-Id` only when statistics are on (commit `0d4c6ade`). Unique
  `X-CFU-Id` values are the opted-in sample; the on/off ratio among checks
  scales it to an estimated population.
- Tactical 370 landed client identity in `connect`, host per-identity
  counts in connection metrics, and in-memory client mismatch
  observations. Its slice 4 (sending reports) is below.
- Extension 1.1.5 (tolerant client) went live 2026-10-15. Check with
  `node scripts/extension-store-version.mjs`.
- Facts about the update server, read from GitHub on 2026-10-15
  (`kzahel/simple-app-update-server`; verify against the Pi checkout
  `~/code/simple-app-update-server`, which listens on 127.0.0.1:3101):
  `src/analytics.ts` writes NDJSON to `logs/<product>/<date>.ndjson` with a
  fixed field list (`ts`, `product`, `channel`, `ip`, `target`, `arch`,
  `currentVersion`, `latestVersion`, `updateAvailable`, `userAgent`,
  `cfuId`, `checkReason`); other headers are dropped; non-GET/HEAD gets
  405 (`src/server.ts`). The dotfiles read it with
  `projects/jstorrent/update-stats.sh` → `update-stats.py`, which counts
  unique clients by `cfuId`, falling back to `ip`.

## Steps

1. **Update server logs the statistics choice.** In
   `simple-app-update-server`, add `statistics` to the logged fields from
   `X-Statistics`, accepting only `on`, `off`, `unreviewed` (anything else
   or absent: omit the field; older desktop versions send none). Add a
   test if the repo has them. Deploy on the Pi with the repo's own
   procedure and confirm a new log line with
   `curl -H 'X-Statistics: off' https://updates.jstorrent.com/tauri/<target>/<arch>/<version>`
   (then remove or mark that test line if the stats should stay clean).
2. **Stats script reports opt-outs and an estimate.** In the dotfiles'
   `projects/jstorrent/update-stats.py`: per window, count checks by
   `statistics` (`on`, `off`, `unreviewed`, missing = older version),
   unique `cfuId`s, and an estimated installation count
   `unique_cfuIds × (on + off) / on` over checks from versions that send the
   header. State the assumption (opted-out installs check as often as
   opted-in ones) in the output. Update
   `runbooks/update-server-analytics.md`.
3. **Confirm the website deployed** after the push of `main`: the
   `Deploy website` workflow passed and https://jstorrent.com/privacy.html
   shows "Updated October 15, 2026" and a "Remote access" section.
4. **Lift the release hold on adoption.** Watch the Web Store dashboard's
   users by version. When most users are on 1.1.5, set
   `strictClients.supported` to `false` in
   `clients/web/src/api/release-compatibility.json`, run
   `npm run test --prefix clients/web`, commit. CI forces this on
   2026-11-14 when 1.1.4 leaves the support window
   (`clients/web/src/compat/window.test.ts`).
5. **Fix the Android companion installation header** (any machine). The
   extension sends `X-JSTorrent-Installation`
   (`clients/web/src/android-companion-client.ts:284`, `:382`) but the host
   reads and allows only `x-rstorrent-installation`
   (`crates/rstorrent-gateway/src/chromeos_companion.rs:1186`, `:1274`,
   `:1330`); renamed in `a35934d2` (2026-10-07), so released extensions
   1.1.3–1.1.5 send the new name. Make the host read and allow both, with
   a test for each, and verify pairing and Choose folder on ChromeOS
   (Machine Control) before the Android release.
6. **Release desktop and Android** after step 4 (and 5 for Android),
   following `docs/topics/mixed-version-compatibility.md`'s release
   runbook: add each delivery to `compat/deliveries.json` and run
   `scripts/compat-capture.mjs` for its commit. The desktop release is what
   starts sending `X-Statistics`.
7. **Compatibility reports, desktop** (Tactical 370 slice 4). With
   statistics on, the update check adds one bounded header (for example
   `X-Compat`) summarizing client `kind version` connections and
   unsupported-call refusals since the previous check, from the gateway's
   `ApplicationConnectionMetrics.clients`, plus the bundled UI's
   observations. Add the matching field in step 1's server change (or a
   follow-up), and to the stats script.
8. **Compatibility reports, relay** (Tactical 370 slice 4). The browser
   client and remote host send product and version in the relay's
   plaintext handshake frames (bounded, optional, ignored by older
   relays); the relay counts circuits by version pair in
   `/operator/v1/status`. Deploy the relay. This is the usage signal for
   `/remote` that `mixed-version-compatibility` lists as missing.

Steps 1–3 need the Pi or the dotfiles; 4–8 can run anywhere, with 6 and 8
needing release or deployment authority.

## Non-Goals

- An analytics service, dashboards beyond the stats script, or a new
  identifier.
- Android or extension reporting channels (Android has no update check).

## Stopping Condition

Opt-out counts and the population estimate appear in the stats output,
the privacy page is live, the hold is lifted and desktop and Android are
released, the companion header works, and steps 7–8 are either landed or
recorded as deferred in Tactical 370.
