# Tactical 352: Render-First Web Startup

Status: Complete locally, 2026-10-14. Maintainer-directed web client slice.
No release is authorized by this tactical.
Topics: `web-ui-design`, `localization`.

## Problem

Maintainer feedback, 2026-10-14: while the web UI loads it shows an odd,
undersized card that looks nothing like the application, then replaces it
with the full layout at once. A skeleton of the real UI is preferred, and
startup should be restructured to load faster rather than imitated with a
static page that must be kept in sync with the responsive layout.

What happens today on the main entry (`index.html`, browser and Tauri):

- `index.html` shows `#rstorrent-boot-status`, styled by
  `src/jstorrent-shell.css` as a 480 px card 12vh from the top. The same box
  is the bootstrap failure card. Its colors follow `prefers-color-scheme`,
  not the stored theme, so an explicit Dark choice on a light OS flashes.
- React renders nothing until `LiveApplication.open()` resolves: `hello()`,
  `ViewController.open()` and the first view-set snapshot. Tauri also waits
  for the updater, notifications, power, remote access, privacy and external
  intake adapters. The browser path first awaits the web auth status.
- `public/rstorrent-boot.js` replaces the card with "could not start" after
  10 s even while the engine is still opening successfully.
- The store and live adapter already model a `connecting` connection and
  per-view `loading` materialization; nothing renders them at startup.

Baseline production build (`vite build`, before this slice):

| Chunk | Minified | Gzip | Largest parts |
| --- | --- | --- | --- |
| `bootstrap` | 1,952.58 kB | 336.16 kB | API validators 960 kB, react-dom 175 kB, react-aria 123 kB, `validation.ts` 58 kB, demo 63 kB, settings sections ~100 kB |
| `index` | 223.78 kB | 47.28 kB | localization runtime and messages 159 kB, formatjs |
| `bootstrap` CSS | 139.06 kB | 22.44 kB | |

The whole application, every transport, the demo and every settings section
download and parse before the first React render.

## Scope

1. **Startup timing.** One small module records `performance` marks for the
   startup phases: shell script, entry, shell rendered, client loaded,
   `hello`, view set open, first library view, and Tauri adapters ready.
   Support diagnostics (Tactical 347) include bounded millisecond offsets so
   a user report carries real startup timings. Marks are also visible in
   browser performance tooling.
2. **Render before connecting.** `LiveApplication.connect()` returns a live
   application immediately in `connecting` and attaches in the background:
   load the client, `hello`, open the view set. A failed attach retries with
   the existing backoff and reports `reconnecting`, so the existing overlay
   appears after its 3 s grace; authentication and contract failures stop
   with the existing reasons. `setViews` before attach only records the
   desired views. `dispatch` waits for the attach rather than failing.
   `close` cancels the attach. `LiveApplication.open()` keeps its awaited,
   throw-on-failure contract for existing callers and tests.
3. **Transport off the critical path.** The bootstrap passes a client
   factory, so the WebSocket/HTTP/Tauri client and the generated validators
   load in parallel with the first render instead of before it.
4. **Platform adapters after render.** Tauri renders the application first
   with no adapters, then once more when the adapters settle. Each adapter
   already tolerates absence. External intake stays pull-based, so an
   activation queued by the host before the adapter opens is not lost.
5. **Placeholders in the real components.** While the library view is
   `loading`, Torrents, Transfers and Library show placeholder rows (or list
   items, or cards) at the real row height instead of a "Loading…" line, and
   sidebar counts are hidden rather than showing 0. Once the first library
   view arrives the real rows or empty state replace them. Settings that
   depend on engine values are not editable until the first library view
   supplies them.
6. **Minimal pre-JavaScript page.** `index.html` shows only a page in the
   stored theme's background color: `rstorrent-boot.js` applies the stored
   theme before first paint. The branded card is kept only for failures.
   The failure timeout covers only the period before the shell renders;
   after that, connection problems belong to the in-app overlay.
7. **Code splitting.** Demo mode, the settings dialog and the session panels
   (Disk, DHT, Speed, Logs, Pieces) load on demand. Further splitting follows
   the step 1 measurements.

## Non-Goals

- Changing the web auth flow. The auth status check still precedes the
  first render because it decides between the sign-in gate and the
  application; its time is measured.
- The companion entry (`companion.html`) and its Android/desktop companion
  bootstraps. The remote entry gets the same render-first attach only if it
  is a direct substitution in `startRemoteInspection`.
- Shrinking the generated validators or relaxing response validation. Their
  size is recorded as a follow-up; validation semantics are unchanged.
- Android Compose, which does not use this bootstrap.
- Server-side rendering or a static skeleton in `index.html`.

## Invariants

- One layout source: placeholders render inside the real components, so
  breakpoints, interface sizes and themes cannot drift from the application.
- No command is sent before `hello` and the view set exist; commands issued
  earlier wait, and fail only when the application closes or stops.
- A placeholder is never presented as data: placeholder rows are not
  selectable, are hidden from assistive technology except for one busy
  status, and never appear once a library view has materialized. An empty
  library after the first view shows the real empty state.
- Engine-backed settings are never editable from default values.
- A permanent failure (signed out, contract or version mismatch) still stops
  and shows the existing overlay; it does not retry forever.
- Diagnostic timings are bounded integers with no URLs, identifiers or
  content, and the diagnostics report stays within its 2 KB bound.
- Reduced motion disables placeholder animation.

## Validation

- `npm run typecheck --prefix clients/web` and
  `npm run test --prefix clients/web`, with new cases for: the attach
  lifecycle (immediate subscribe in `connecting`, views recorded before
  attach, dispatch waiting for attach, retry and stop reasons, close during
  attach), placeholder rendering and its replacement by rows or the empty
  state, hidden sidebar counts, settings gating, startup timing bounds in
  diagnostics, and the boot shell's theme and failure behavior.
- `npm run check:localization` for new strings.
- Production `vite build` and `npm run check:csp`: record the chunk table
  above for the result.
- Playwright demo suite against a local Vite server, plus a manual live run
  with `./scripts/webui` recording the startup marks.

## Stopping Condition

The main entry renders the real application shell before the engine
connection completes in browser and Tauri hosts, shows placeholders until
the first library view, keeps the existing failure behavior, records startup
timings in diagnostics, and the before/after chunk sizes and timings are
recorded here.

## Result

Landed in four commits: the plan, render-first attach with timing and the
boot shell, placeholders, and on-demand loading.

- `LiveApplication.connect()` takes a client or a `DeferredApplicationClient`
  (`load` plus whether it supports torrent list bundles, which the UI needs
  before the client exists). Attach loads the client and the view controller
  together, then `hello`, then opens the view set with the latest desired
  views. Errors that stop retrying and `abortableDelay` moved to
  `view-connection.ts`; the error classes and the bundle bound moved to
  `api/errors.ts`, re-exported from their old modules.
- A `codeSplitting` group in `vite.config.ts` holds `validation.ts`,
  `api/schema.ts` and the generated validators. Without it the bundler put
  the small modules the shell shares with them into the validator chunk,
  which made the shell import it again.
- Phases: `boot`, `entry`, `app_loaded`, `auth_checked`, `shell_rendered`,
  `client_loaded`, `hello`, `view_set_open`, `first_library`,
  `adapters_ready`. `app_loaded` was added after the first measurements
  showed that loading the application bundle, not the engine, dominated.
- The credential-free notice now reads its dismissal per access mode, since
  the mode can arrive after the first render.
- An Add started before the first library view opens the Add dialog
  (folders are not known yet) and fills in when they arrive; the add itself
  waits for the attach. This was judged acceptable rather than disabling Add.

### Measurements

Production builds served by a local offline `rstorrent-gateway` (empty
profile), headless Chromium, medians. "Throttled" is 10 Mbit/s, 40 ms
latency and 4x CPU slowdown. Times are milliseconds from navigation.

| | Shell visible | Library data |
| --- | --- | --- |
| Before, unthrottled (7 runs) | 81 | 81 |
| After, unthrottled (7 runs) | 62 | 77 |
| Before, throttled (5 runs) | 2,381 | 2,381 |
| After, throttled (5 runs) | 1,176 | 2,091 |

Before, the shell and the data appeared together; the first paint was the
branded card at 12 ms (116 ms throttled).

| Chunk on the shell's path | Before | After |
| --- | --- | --- |
| `index` (entry, localization) | 223.79 kB | 225.11 kB |
| `bootstrap` and its static imports | 1,952.58 kB | ~650 kB |
| `bootstrap` CSS | 139.06 kB | 72.33 kB |

After the change, `validation` (1,043 kB minified, 88 kB gzip) loads with
the transport in parallel with the first render, and Settings (98 kB),
demo (64 kB) and the session panels (~60 kB) load on demand.

### Follow-ups

- The development and headless gateway serve static assets uncompressed
  (`transferSize` equals the body size). The validator chunk alone is
  1,043 kB on the wire instead of 88 kB gzip, now the long pole for data on
  slow LAN and tailnet links. Tactical
  [356](356-precompressed-hosted-web-assets.md) adds precompressed serving.
- The generated validators are 960 kB minified because the generator uses
  `allErrors` and per-entry inlining; shrinking them is a contract-validation
  decision outside this slice.
- An older running gateway refused a ninth concurrent connection with 503;
  the new shell showed the reconnect overlay and retried instead of the
  bootstrap error. Current gateways evict abandoned view sets (commit
  `753605c6`).

### Validation

- `npm run typecheck --prefix clients/web`.
- `npm run test --prefix clients/web`: 645 passed, 2 skipped. New cases:
  connect lifecycle (connecting snapshot, views chosen while connecting,
  held commands, retry and Retry now, signed-out stop, close while
  connecting, deferred client load and retry), startup timing bounds,
  diagnostics `startup_ms`, boot script theme application and hostile
  preferences, placeholder rows and their replacement, hidden counts,
  settings gating.
- `npm run check:localization`; `npm run build` and `npm run build:companion`
  with their CSP checks.
- Playwright against a local Vite server: `inspection-demo`,
  `overlay-primitives`, `localization` and `support-diagnostics` pass (64).
  Both `dht-observatory` cases fail at the same assertions on the
  unmodified base commit `3015b09d`, as Tactical 351 recorded.
- Screenshots of the connecting shell (held WebSocket) at 1280 and 400 px
  in light and dark, for Torrents and Library.

Not run: Tauri desktop startup, the live-engine Playwright specs, and the
remote entry. Tauri's adapter timings are recorded by `adapters_ready` but
were not measured here.
