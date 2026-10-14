# Tactical 346: Action Feedback Toasts

Status: Complete, 2026-10-14. Maintainer-directed web presentation slice.
Topics: `web-ui-design`, `localization`.

## Problem

Almost every web action writes a sentence into an inline `<output>` placed
next to whatever triggered it. The Files tab grows a full-height bordered row
saying "Selected files set to normal" and pushes the table down. Download
settings append "Add options will be shown" under a checkbox the user just
ticked. The torrent toolbar wraps its status onto its own row at narrow
widths. Most of these sentences repeat a change already visible on screen,
appear somewhere unrelated to the change, and move content. Much of the copy
is assembled English that bypasses the message catalog, including the
command-result chain in `LiveApplication.dispatch`.

## Maintainer Decisions, 2026-10-14

- A result the user can already see on screen shows nothing.
- A result that is off screen, or that otherwise goes unconfirmed (copy, a
  revoke, a removal), uses a short auto-dismissing toast.
- Errors stay visible until dismissed or replaced; validation stays beside
  its field.
- Easy-to-reverse actions offer Undo when the client can reverse them with
  existing commands. Irreversible ones (removing data) do not.
- Follow the Android product's patterns; placement is delegated.
- Extract the touched copy into the React catalog.

## Android Reference

`ProductApp.kt` hosts one Material `SnackbarHost`, bottom-centre. A new
snackbar dismisses the current one rather than queueing behind it. Archive
offers Undo, which restores and resumes the torrents that were running
(`runningBeforeArchive`: queued, starting, downloading or seeding). Restore
offers Undo, which archives again. Already-present adds and command failures
use long snackbars, and failures carry a dismiss action. The web host adopts
the same single-slot, replace-not-queue model.

## Design

`components/Toast.tsx` owns one `ToastProvider` mounted in `App` and a
`useToast()` hook returning `show` and `dismiss`. A toast has a message, a
tone (`info` or `error`), an optional action (label and callback), optional
progress, and an optional key so a running operation updates in place.

- One slot. `show` replaces the current toast.
- Info toasts close after 4 s, or 10 s with an action (Android short and
  long). Error toasts and toasts with progress stay until replaced or
  dismissed. Hovering or focusing the toast pauses its timer. Every toast has
  a dismiss button, and Escape inside it dismisses.
- Bottom-centre, fixed, above the settings sheet (z-index 160) and below the
  privacy and connection overlays. On narrow viewports it spans the width less
  the standard margin. Entry animation is disabled under reduced motion.
- An always-mounted polite live region announces info toasts; error toasts
  render with `role="alert"`.

Command results stop carrying success prose. `CommandResult` becomes a union:
a rejection carries `message`, and an acceptance carries only typed facts
(`torrentId`, `addDisposition`, `storageRoot`, `magnetExport`). Each call site
chooses localized copy from those facts. Demo scenario commands keep their
optional message for the developer scenario bar.

## Disposition Of Each Site

| Site | Success | Failure |
| --- | --- | --- |
| Torrent start, pause, recheck, queue moves | nothing | error toast |
| Archive / restore | toast with Undo | error toast |
| Copy magnet links | toast (plus omitted-tracker count) | error toast |
| Remove | toast | stays in the removal dialog, as now |
| Add (new torrent) | nothing; the torrent is revealed | error toast |
| Add (already present / selection expanded) | toast | — |
| Add-input validation, oversized `.torrent` | — | error toast |
| External-intake rejection notice | toast | — |
| Sample-torrent batch | progress toast, then summary | in summary |
| File priority, skip, download now | nothing | error toast |
| Open file / media playback | nothing | error toast |
| Remote direct save | progress toast with Cancel, then "saved" | error toast |
| Download settings: folders, default, checkboxes | nothing | inline error under the section |
| Notifications, power checkboxes | nothing | inline error, as now |
| Restore preferences / clear app data | toast | inline error, as now |
| Web access, remote access actions | toast | inline error, as now |
| Copy update command, copy support diagnostics | toast | error toast; diagnostics keeps its inline manual-copy hint |
| Connection/seeding form, torrent settings dialog | unchanged: "Saving…" and failures beside Save | unchanged |
| Ongoing state (Wi-Fi wait, update available, buffering, metadata wait) | unchanged; these are status, not results | — |

Undo for archive restores every archived target, then resumes those that were
running before the archive. Undo for restore archives the targets again.
Both reuse `archive`, `unarchive` and `resume`; no engine or contract change.

## Non-Goals

- Engine, application-contract or Android changes.
- Undo for pause/resume, priorities or settings: the change is visible and
  reversible by the same control.
- Undo for removal.
- A notification history or multi-toast stack.
- Localizing strings outside the feedback paths this slice touches (for
  example, action disabled reasons assembled in `torrent-actions.ts`,
  `window.confirm` prompts in remote access settings, and demo-scenario
  messages shown only in the developer scenario bar).

## Validation

- Toast component tests: replacement, auto-dismiss timing, pause on hover and
  focus, persistent errors, action and dismiss, live-region semantics.
- App tests updated for toasts: removal, copy magnet, archive with Undo
  (restores and resumes only previously running torrents), partial failures,
  no inline row in the Files tab after a priority change.
- `LiveApplication` tests updated for message-free acceptances.
- Web typecheck, localization check, unit suite; affected Playwright specs.
- Demo-mode screenshot of a toast.

## Stopping Condition

Every site in the table behaves as listed, the inline success rows are gone,
the touched copy is in the catalog, and the validation above passes.

## Evidence

- `Toast.test.tsx` (10 cases): live region mounted before the first toast;
  short and long durations; Undo runs once and closes; errors persist with
  `role="alert"` until dismissed; replacement instead of queueing; hover and
  focus pause; Escape; keyed progress updates in place and stays open;
  keyed dismissal.
- `App.test.tsx`: archive offers Undo, which restores both torrents and
  resumes only the one that was downloading, with no second Undo; partial
  archive failure gives one error toast without Undo; adding an archived
  duplicate offers Restore, which dispatches `unarchive`; file priority
  changes leave no toast or inline row; remote direct-save progress, the 200
  ms update throttle, completion and cancellation run in the toast, outside
  the file grid; removal, magnet copy, sample batch, external intake,
  Library playback and plain adds assert their new feedback.
- `LiveApplication.test.ts` expects message-free acceptances; settings
  section tests assert success adds no text and failures stay inline.
- `npm run typecheck`, `npm run test` (80 files, 568 passed, 2 skipped) and
  `node scripts/check-localization.mjs` (1,373 React messages) pass.
- Playwright `inspection-demo.spec.ts` and `support-diagnostics.spec.ts`:
  53 passed against a private dev server. The live specs
  (`inspection-live.spec.ts`) were updated but not run; they need the live
  engine harness.
- Demo-mode screenshots at 1280 px light and dark and at 390 px show the
  archive toast with Undo, bottom-centre over the detail pane; at phone
  width the message wraps to two lines without clipping.
