# Tactical 352: Render-First Web Startup

Status: Active, 2026-10-14. Maintainer-directed web client slice. No release
is authorized by this tactical.
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
