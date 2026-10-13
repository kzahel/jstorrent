# Tactical 334: Web Water and Clay Visual System

Status: Complete locally, 2026-10-13. Shared React presentation only. No release
is authorized by this tactical.

Topics: `web-ui-design`

## Trigger

Maintainer feedback, 2026-10-13: the web UI feels messy and incoherent
next to the plain Material Android UI. Settings in particular feel heavy,
colors are odd, and decorative gradients appear in several places. The
direction is a large rework that is cleaner and more minimal but still
distinctive, inspired by the JSTorrent icon, with light and dark modes.

A measured audit of `clients/web/src` before this tactical:

- 228 raw color literals in component CSS (56 distinct), outside the
  global tokens;
- more than 15 corner radii (0.38rem to 12px) and 15 font weights
  (450 to 820), with most text at 700 or 750;
- three unrelated palettes: blue product chrome, mint/purple Speed and
  DHT panels with radial washes, and purple/navy gradient Library tiles
  with initials; a navy header that ignores the light theme;
- uppercase colored eyebrow labels above most headings;
- Settings options drawn as bordered cards that fill with blue when
  selected, under three gray header bands;
- `src/styles.css`, a dark green stylesheet from the retired proof that
  nothing imports.

## Direction: water and clay

The icon is a box of strata: sky `#80c7ff`, water `#48acfb`, deep water
`#1f8eee` over clay `#ad8d70`. The visual system takes exactly that:

- Neutrals are slightly warm (paper by day, dark earth at night) so the
  clay belongs and the blue reads as water rather than generic SaaS blue.
- Blue is the one accent. It marks the primary action, selection, focus,
  current navigation and anything being filled: progress, verified
  pieces, download rate. Android already colors verified pieces with its
  primary color.
- Clay is the second brand color, used sparingly for upload and seeding,
  verified-on-disk speed, the demo bar and Library tile bodies.
- Library tiles become flat boxes that fill with water to their download
  progress, the icon as a progress meter. No initials, no gradients.
- Chrome is light in light mode: header and sidebar share one warm
  secondary surface around the white content pane.
- One heading per section; no uppercase eyebrow labels.
- Settings become grouped rows: label and help on the left, control on
  the right, hairline dividers in a rounded group. Appearance choices are
  segmented controls built on native radios.

## Scope

- `global.css`: replace the palette in light and dark, add brand, fill,
  data-visualization, radius, weight, shadow and scrim tokens.
- Every `*.module.css` under `src/inspection` and `src/remote`, plus the
  boot and companion shells: tokens only, the radius and weight scale,
  no decorative gradients, overlay shadows from tokens.
- Canvas panels (Speed, DHT, Pieces, metadata progress) take colors from
  tokens rather than TypeScript literals.
- Markup changes limited to Appearance segmented controls, removing
  decorative eyebrow labels and the Library tile art.
- A Vitest style guard that rejects raw colors, off-scale radii and
  weights, and decorative gradients in component CSS.
- Delete the unused `src/styles.css`.

## Non-goals

- Copy, localization catalog meaning, layout breakpoints, navigation
  model, information hierarchy and table behavior.
- Android, iOS, website, desktop installer artwork and the icon itself.
- New dependencies, a component library or a theme switcher beyond the
  existing Auto/Light/Dark preference.
- Interface-size scale values, which already work.

## Invariants

- Text meets WCAG AA (4.5:1, or 3:1 for large text and UI marks) in both
  themes; the existing serious/critical Axe checks keep passing.
- Color never carries state alone; existing labels and icons stay.
- Every interactive role, accessible name pattern and keyboard path used
  by the tests is preserved, including native radios in Settings.
- Auto keeps following live `prefers-color-scheme`; explicit Light/Dark
  keep winning.
- Hatch patterns that encode state (unknown, stalled, partial) remain;
  only decorative gradients go.

## Validation

- `npm run typecheck --prefix clients/web`
- `npm run test --prefix clients/web`, including the new style guard.
- Playwright Chromium `tests/inspection-demo.spec.ts`,
  `tests/localization.spec.ts`, `tests/dht-observatory.spec.ts` and
  `tests/overlay-primitives.spec.ts`.
- Before/after captures of 36 demo states (wide and phone, light and
  dark) in the ignored `mockups/water-clay/`.

## Stopping condition

All component CSS passes the style guard, both themes pass the browser
suites above, the captures have been reviewed, and this record lists the
evidence.

## Execution record

- `global.css` defines the palette twice (light paper, dark earth) with
  brand constants (`--brand-*`), text-safe `--accent*` separate from fill
  `--water*` (the icon's deep water is 3.4:1 on white, so it never carries
  text), `--clay*`, `--on-accent`, semantic `-soft` fills, `--viz-*`,
  `--media-stage`, scrim and two shadows, `--radius-sm|md|lg|full` and
  `--weight-regular|medium|strong`. Headings, `strong` and `th` default to
  600. Dark-mode primary buttons are sky blue with dark text.
- `src/style-guard.test.ts` rejects raw colors, off-scale radii, weights
  and font sizes, radial gradients, literal shadows and uppercase in every
  component stylesheet. Before: 425 violations in 33 files. After: none.
  Component CSS now has no color literals and three weights (83 medium,
  25 strong, 7 regular, plus global defaults).
- Chrome: header and sidebar share `--surface-secondary` around the white
  content pane; current navigation is a selection pill; download rate is
  water, upload clay; the connection dot is a flat dot.
- Settings: one warm sheet; each category title is the legend; groups are
  white rounded `.rows` with hairlines, label left and control right.
  `SettingGroup`, Downloads, Notifications, Power and Data & reset wrap
  their rows; checkboxes in rows are drawn as switches; Appearance uses
  segmented controls over native radios and shows the chosen option's
  description; Save/Cancel stick to the bottom. `RateLimitPicker` lays out
  as a row in both Settings and the Torrent settings dialog.
- Library: tiles and the detail summary are the icon's box. Clay is empty
  space and water rises to the verified progress with a 2px waterline; a
  full box drops the line. The monogram is a small corner label. The thin
  progress bar stays for assistive technology only. Per-hash tone
  gradients and `toneFor` are gone.
- Speed: series colors are `--speed-<metric>` tokens read by the canvas
  and the legend swatches. Received is water, staged writes are light
  water (dashed), verified is clay. Pieces: verified is water, matching
  Android's primary-colored verified pieces; stored uses `--viz-metadata`
  so it stays distinct from received in dark mode. DHT live nodes are
  water.
- Completed torrents use clay for their status dot and text. Log severity
  is no longer uppercased.
- Removed eyebrows: Settings "Application", Library "Library" and
  "Content details" (5 orphaned messages removed; catalog 1,336 to 1,331).
  Remaining scope eyebrows (Speed, DHT, Disk) are muted, normal case.
- Fixed: Library detail rows referenced the nonexistent
  `--border-subtle`. Deleted the unused `src/styles.css`.
- Test updates for intended visual changes: the dark background value in
  the color-theme test; the overlay test now compares the portal with the
  resolved `--surface-raised` rather than the page background. The peer
  flag legend keeps its 11 px density (`caption - 1px`) and regular weight.

### Form controls follow-up, 2026-10-13

Maintainer feedback on the desktop build: the native checkbox in the
first-use statistics dialog was tiny and unreadable, and native dropdowns
did not match the switches and segmented controls. The UI has 17
checkboxes in 10 components, 6 radios and 8 dropdowns.

- `global.css` styles every field, dropdown, checkbox and radio at zero
  specificity (`:where`), so component CSS keeps layout and widths. Fields
  and dropdowns share the button height, border and radius; dropdowns
  draw a themed chevron (`--control-chevron`). The opened option list
  stays the platform menu, which Playwright `selectOption` (10 uses)
  depends on.
- Checkboxes are the icon's box: 18 px at standard size (16 compact, 20
  spacious, 22 on coarse pointers via `--ui-check-size`), a 1.5 px
  `--control-border` outline (4:1 or better on light surfaces, against
  1.5:1 for `--border-strong`), filling with water from the bottom when
  checked, then a check mark; indeterminate shows a dash. Radios are a
  matching ring and dot. Settings switches grow to 40 × 23 px.
- Per-component duplicates of the field look (Log filters, Speed range,
  scenario bar, rate picker, Settings fields, remote-access forms and
  sign-in inputs) and the 1 rem checkbox sizes are removed.

## Evidence

- `npm run typecheck --prefix clients/web`: pass.
- `npm run test --prefix clients/web`: 78 files, 534 passed, 2 skipped,
  including the style guard.
- `node scripts/check-localization.mjs`: web 1,331, valid.
  `node scripts/check-branding.mjs`: valid.
- Playwright Chromium (`VITE_RSTORRENT_ENABLE_PSEUDO_LOCALES=1`):
  `inspection-demo`, `localization`, `dht-observatory`,
  `overlay-primitives`, `support-diagnostics`, `tracker-countdown` and
  `bandwidth-baseline`: 65 passed, 2 skipped, including the serious and
  critical Axe checks.
- Not run: `inspection-live` and `web-auth-live`, which need a live
  gateway; Tauri WebViews on macOS, Windows and Linux.
- 36 before and after captures (wide and 390 px phone, light and dark:
  every detail tab, Library and its detail, each Settings category) in the
  ignored `mockups/water-clay/`, with the capture script.

## Deferred

- Android's fallback color scheme is still teal (`0xFF006A6A`); moving it
  to the icon blue and clay would align the platforms when dynamic color
  is off.
- Canvas axis label fonts in the DHT and Speed panels are literal pixel
  strings in TypeScript.
- Some session panels (Speed, DHT) still use literal pixel spacing.
