# Tactical 371: Statistics And Compatibility Reporting Rollout

Status: Steps 1–3 complete, 2026-10-15. Steps 4–8 remain unstarted by this
rollout; continue only on maintainer request. The update-server change is
deployed on the Pi; the maintainer's dotfiles contain the reporting change.
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

## Steps 1–3 Evidence, 2026-10-15

- **Server:** `kzahel/simple-app-update-server` commit
  `24f04c863d6caf9ea5dedb8827a703669e51841d` adds optional
  `statistics: on|off|unreviewed` to all three logged update-check routes.
  Absent, empty, uppercase, malformed, combined and oversized invalid
  values omit the field. No identifier is added. `npm run check` passed
  lint, typechecking and all 122 tests, including 27 new route/log cases;
  `npm run build` passed locally and on the Pi. The commit was pushed to
  `main`, fast-forwarded on the Pi, rebuilt and deployed by restarting the
  existing user unit. The local and Pi server checkouts match this commit;
  the Pi's untracked `products.d/` deployment configuration was preserved.
- **Production smoke:** both JSTorrent and 200 OK health endpoints returned
  `{"ok":true}`. A request to
  `/tauri/darwin/aarch64/0.3.1` with `X-Statistics: off` returned 204.
  The NDJSON entry at `2026-10-15T19:57:24.621Z` contains
  `statistics: "off"`, an empty `cfuId`, and
  `checkReason: "tactical-371-verification"`. This marked diagnostic entry
  remains in the source log; the updated stats parser excludes that marker
  from every view so it does not bias the estimate. Other log consumers
  must apply the same filter if they need to exclude it.
- **Reporting:** the dotfiles parser and analytics runbook now report each
  text window's on/off/unreviewed/missing checks, all unique nonempty
  `cfuId`s, the unique explicitly-on sample, and
  `unique_on_ids × (on + off) / on`. Daily output uses each day's own
  sample. The equal-check-frequency assumption is printed; older/missing
  and unreviewed checks are excluded from the estimate. No identified on
  sample produces unavailable/N/A. Six Python regression tests passed via
  `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s projects/jstorrent -p 'test_update_stats.py'`.
  Live JSTorrent summary and daily commands and the shared 200 OK recent
  command passed. Production has no unmarked header-reporting sample yet,
  so the live estimate correctly remains unavailable pending step 6.
- **Website:** the
  [Website run for `f940f487`](https://github.com/kzahel/jstorrent/actions/runs/38794521430)
  completed successfully, including deployment to Cloudflare Pages and its
  deployed-client check. A fresh `curl --location` request confirmed
  [privacy.html](https://jstorrent.com/privacy.html) redirects to `/privacy`
  and serves both "Updated October 15, 2026" and the "Remote access"
  heading. The live `.well-known/jstorrent-website.json` identifies
  `kzahel/jstorrent` at `f940f487509e2802808e964affa56e9b173cc664`.
- **Boundary:** no release-hold edit, companion-header change, application
  release, compatibility reporting or relay deployment was performed.

## Non-Goals

- An analytics service, dashboards beyond the stats script, or a new
  identifier.
- Android or extension reporting channels (Android has no update check).

## Stopping Condition

Opt-out counts and the population estimate appear in the stats output,
the privacy page is live, the hold is lifted and desktop and Android are
released, the companion header works, and steps 7–8 are either landed or
recorded as deferred in Tactical 370.
