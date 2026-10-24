# Preserve Torrent List Scrolling Across Refreshes

Status: Complete locally; installed-package delivery remains separate.

Topic: `web-ui-design`

## Scope And Stopping Condition

Fix the reproduced shared React table regression that reveals the current row
again on ordinary one-second updates. Stop when a failing browser regression
passes, component cases preserve explicit selection/navigation and delayed row
arrival, the isolated real-gateway reproduction stays scrolled, standard web
checks pass, and owning documentation records evidence. Commit and push on the
current branch as explicitly requested by the maintainer.

## Non-Goals And Dependencies

No engine, application contract, native Compose/iOS presentation, packaging,
updater, or installed-profile changes. No new dependency. The current
`VirtualTable`, table-selection contracts in Tacticals 058/059, and table
scrolling ownership in Tactical 173 are the inspected implementation inputs.

## Invariants And Ownership

- `VirtualTable` remains the scrolling owner. A single nullable row-ID ref
  records the current selection already revealed; no timer or task is added.
- Normal row updates, callback identity changes, and reordering must not reveal
  the same selection again or steal a user's scroll position.
- A new selection is revealed once when its row is available. A selection
  arriving before its data must still be revealed after materialization.
- Clearing selection permits later reselection of the same row to reveal it.
- Home/End and arrow navigation retain their existing explicit scroll behavior,
  including navigation to the already-current row after manual scrolling.
- The shared component fix applies to torrent and Files tables without changing
  selection, virtualization, sorting, or transport contracts.

## Validation

1. Add component refresh/reorder, reselection, and delayed-materialization cases
   and a headless bundled-Chromium regression with trusted mouse-wheel input
   across running `large-swarm` clock updates. Run before the product fix.
2. Apply the bounded selection-reveal guard; run those cases and existing table
   interaction/virtualization browser cases, including Files.
3. Run web typecheck, full web unit tests, and a same-origin production build.
4. Recheck 120 independently generated paused torrents through a real
   loopback-only gateway with a fresh temporary profile and bundled headless
   Chromium. Confirm continued application view batches and no scroll reset;
   join and remove all owned processes, profile, payload, and temporary files.
5. Record exact results and review the diff before committing and pushing.

## Evidence

The initial investigation at `c9d335f0` is recorded in
[`web-ui-design`](../topics/web-ui-design.md#known-torrent-list-scroll-regression-2026-10-11).

`VirtualTable` now records a successfully revealed current ID. Ordinary
refreshes retain that record and do not write `scrollTop`; a changed or cleared
selection invalidates it. Missing selected rows remain pending until their
data arrives. Existing explicit keyboard scrolling is unchanged. The fix adds
one nullable ref and no runtime/platform/contract changes. Native Compose and
iOS do not use this React component, so their presentation is outside this
web-only correction.

Before the product change, the focused component command below failed both
new cases (12 existing cases passed), and the new browser regression failed
with expected 1800, observed zero. Afterward:

- `npm run typecheck --prefix clients/web`: passes, including the final tests.
- `npm run test --prefix clients/web`: 483 pass, two existing skips.
- `npm run test --prefix clients/web --
  src/inspection/components/VirtualTable.test.tsx`: final 14 pass, including
  refresh/reorder, cleared and unavailable intermediate selection, and delayed
  materialization/reselection cases.
- `npm run test:e2e --prefix clients/web -- inspection-demo.spec.ts`: all 31
  pass, including filtering, sorting, removal, accessibility, bounded
  2,000-torrent/10,000-peer DOM, and 4,095-file interactions across layouts.
- `npm run test:e2e --prefix clients/web -- inspection-demo.spec.ts --grep
  'torrent scrolling survives'`: the final regression passes, measuring every
  50 ms through at least three running demo-clock updates and checking End,
  Home, repeated same-row Home, and ArrowDown.
- `VITE_RSTORRENT_DEFAULT_LIVE=same-origin npm run build --prefix clients/web`:
  passes, including the 12-bundle CSP check.

The temporary `node /tmp/rstorrent-scroll-fixed.VKVEIY/verify.mjs` production
check used the existing source-built gateway, a fresh profile, 120 independently
encoded paused torrents, loopback-only networking, and bundled headless
Chromium. Each 65-sample window preserved its exact scroll position:

| Selection | Scroll position | Observed view batches | Programmatic writes |
| --- | ---: | ---: | ---: |
| First row | 1800 | 3 | 0 |
| Middle row | 3615 | 4 | 0 |
| Reselected first row | 1800 | 4 | 0 |

Explicit Home and same-row Home both returned to zero. An initial middle-row
harness assertion sampled the old position before the asynchronous wheel event
arrived; requiring the wheel delta before starting observation corrected the
harness, without another product change. Both gateway runs joined with exit
zero and closed their browser. Temporary profiles, payload, runner, logs and
Playwright output were removed. The installed profile and primary browser were
not used. No Rust checks were repeated for this frontend-only fix.
