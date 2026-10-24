# Two-Destination Torrent Navigation First Pass

Status: First pass ready for product review (2026-09-27).

Topics: `application-interface-direction`, `web-ui-design`.

## Scope and stopping condition

Present Library and Torrents as the two primary web/desktop destinations.
Use the existing detailed Workbench table for Torrents: activating a row
opens its detail at narrow widths, while its checkbox selects torrents for
actions without opening detail. Give the detail return control the same
prominence as the Library detail back button. Map browser-local preferences
that last opened Transfers to Torrents, retaining that filter.
For a torrent with no download percentage yet, show an em dash in Done
instead of repeating its Metadata status and drawing an empty progress bar.

This is a reviewable UI first pass. Keep the underlying Transfers components
and internal destination identifier temporarily, so the navigation decision
can be revised without a larger state migration. No engine, API, Android,
selection-policy, or command changes are in scope.

## Invariants and validation

The active torrent and checked batch remain distinct. A row tap continues
to open detail; the checkbox keeps interaction in the collection. A return
control is visible at every width where the collection is replaced by detail.
No additional background task or resource owner is introduced.

The initial review pass deferred screenshots and tests at the user's request.
The later explicit request to commit all pending work and push includes the
pre-push validation recorded below. The stopping condition for this first pass
is a locally inspectable two-destination UI with a working preference migration.

## First-pass evidence

- Primary navigation exposes Library and Torrents. Torrents reuses the
  existing virtualized torrent table, checkbox selection, action toolbar,
  and detail pane.
- Fresh navigation defaults to Torrents. A saved Transfers destination
  opens Torrents with its Transfers filter. The focused migration assertion
  passes in the pre-push unit suite.
- The detail return control now uses the same bordered button treatment as
  Library detail, across the matching 760 px detail breakpoint.
- English product copy and its compiled catalog now say Torrents in primary
  navigation, filters, table label, and Library handoff.
- Rows awaiting metadata keep Metadata in Status; Done presents an em dash
  without an empty progress bar. Checking-specific progress remains visible.
- Initial automated tests and screenshots were deferred. Pre-push validation
  found stale assertions for the former three-destination layout; tests now
  target Torrents, preserve selection through Library/filter changes, and scope
  the narrow detail return button separately from primary navigation.

## Pre-push validation (2026-09-28)

- Web typecheck, localization policy, production build/CSP and
  `git diff --check` pass.
- `npm run test --prefix clients/web` passes: 396 tests, two existing skips.
  Coverage includes saved Transfers preference migration, selected torrent
  state, table/Library/detail behavior, and view lease lifetime.
- All 45 active Playwright browser tests pass; 14 opt-in scenarios are skipped.
  The run uses bundled headless Chromium (`CI=1`) and an owned Vite process on
  loopback port 44178 with pseudo locales enabled. The existing 4177 service
  and primary browser remain untouched; the owned server/browser are reaped.
  Live-network and comparative-bandwidth scenarios remain opt-in; their
  navigation selectors were updated without claiming those scenarios ran.
