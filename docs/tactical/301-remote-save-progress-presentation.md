# Stable Remote File Save Progress

Status: Complete locally; deployment remains separate.

Topic: `web-ui-design`

## Scope And Stopping Condition

Correct the reported rapidly changing remote-save percentage and shifting Files
toolbar. Stop when progress occupies a separate stable row, updates at most
five times per second during transfer, terminal outcomes appear immediately,
and web checks plus browser layout evidence pass.

## Non-Goals And Dependencies

No remote Open/Play implementation, protocol, engine, generated contract,
deployment, release, or installed-profile changes. No new dependency. Read
`web-ui-design`, `direct-remote-file-streaming`, and `localization` for shared
presentation, existing Save transport, and product copy ownership. Native
Android/iOS presentation does not use this React Files component.

## Invariants And Ownership

- FileTable owns save presentation; byte delivery and write-before-ack remain
  unchanged. Display throttling must never delay writes or acknowledgements.
- Keep changing progress out of the file-count/storage/actions toolbar. Use a
  bounded progress bar, fixed-width tabular percentage, and accessible label.
- The transfer callback gates intermediate display updates with a monotonic
  clock. It adds no timer or background task. Completion and errors bypass it.
- Preserve Cancel save, file selection, verified-file eligibility, and all
  existing direct-transfer availability gates.
- Status announcements describe phases rather than announcing every chunk.

## Validation

Extend the existing remote Save component case with controlled progress bursts
and immediate terminal outcome checks. Use bundled headless Chromium and the
real FileTable with an injected save transport to verify stable toolbar,
percentage, cancellation and table bounds at desktop and phone widths. Run
web typecheck, full web tests, and localization validation. Record exact
evidence and remove temporary browser/server/capture artifacts.

## Evidence

FileTable now puts command feedback beneath the count/storage/actions toolbar.
Remote saves render a native progress bar and localized, fixed-width tabular
percentage, rounded to one decimal place. Narrow layouts give the phase label
its own line. A monotonic callback gate permits one intermediate render per
200 ms; completion and errors bypass it. No timer, protocol change, dependency,
or delay to file writes/acks is introduced.

- `npm run typecheck --prefix clients/web`: passes, including final code.
- `npm run test --prefix clients/web`: 486 pass, two existing skips. The remote
  Save case covers 689 callbacks at one clock instant, the 200-ms next update,
  immediate completion inside that interval, and cancellation cleanup.
- `npm run check:localization --prefix clients/web`: all four platform catalogs
  and policy pass; web contains 1,335 English messages.
- Temporary bundled headless Chromium runner against the actual FileTable,
  catalog fixture and injected save callback: 1,100/390/320-pixel widths all
  preserve exact toolbar, grid, percentage and cancellation bounds through
  9.9/10/73.2/99.9-percent samples with 300 callbacks per sample. No document
  overflow, page errors or cancellation regression. Desktop and phone
  screenshots were inspected; the initial phone label clipping was corrected
  before final captures.

The first focused component run failed only because the cancellation assertion
also matched the unrelated torrent-download progress bar; targeting the Save
label fixed that assertion. The initial browser harness exposed intrinsic grid
overflow on phones; the Files panel now uses a zero-minimum grid column. A
later harness run was interrupted by generated-file hot reloads, so the final
isolated server disabled HMR/source watches. No transport or live network was
tested by this presentation harness. Temporary fixture, captures, server and
browser were removed; the primary browser and installed profile were unused.

No Rust checks were run for this React/CSS-only correction. Unrelated tracker
contract and website work was already present and remains outside this slice.
Remote Open/Play and transport qualification remain with Tactical 196 and the
owning topic; this change is not deployed or published.
