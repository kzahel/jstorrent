# Tactical 324: Release Queued Adds On Skip File Selection

Status: Complete locally, 2026-10-13. Release delivery remains separate.

Topics: `application-control`

## Scope and stopping condition

Adding several torrents with file selection on queues one pending dialog per
torrent. Two defects made `Don’t show file selection again` unusable with a
queue on desktop:

- The web dialog was reused for the next queued torrent, so its `Saving…`
  state, draft choices, checkbox and cached pages carried over. Every control
  stayed disabled and the queue could not advance without a restart.
- The preference only affected future adds. Torrents already queued still
  required one dialog each, contrary to the choice just made.

Key the web draft by torrent, and make the same transaction that turns the
preference off release every other queued add. Stop after the durable
transition, runtime reconciliation, web regression and focused evidence are
recorded.

Dependencies: Tactical 323's shared `disable_future` helper for
`ConfirmPendingFileSelection` and `DownloadAllPendingAdd`.
Non-goals: applying the confirmed torrent's file choices to other torrents,
changing Cancel, add-time `Add torrent` confirmation, release delivery.

## Contract, ownership and bounds

When `disable_future` is true, the profile transaction that admits the
presented torrent also clears `awaiting_file_selection` for every other
queued add, sets running intent and clears its error, and appends it to the
download queue in add order. Each released torrent keeps the selection it
already holds (`selection_default`, exceptions and magnet `so=` ranges),
exactly as if it had been added with the dialog off; the confirmed torrent's
All/None/overrides apply only to itself. Torrents with a removal job or a
storage quarantine stay queued so their own dialog can explain or cancel
them. A failed write rolls the whole command back, including the releases.

`ApplicationService` records the queued set before the command when
`disable_future` is true, then for each torrent that actually left the queue
records `pending_file_selection_released` and reconciles incoming seeding.
The existing `start_if_possible` admission pass already covers every
torrent, including unavailable storage roots. No command, generated type,
task or resource bound is added; the release is linear in the bounded
pending set.

The web `PendingFileSelectionDialog` wraps its draft in a component keyed by
torrent ID, so the dialog owns the reset rather than relying on each caller.
Android already keys its dialog draft by torrent (Tactical 323) and receives
the engine release unchanged.

Not an engine or protocol feature: it governs a client preference and the
add queue, so no libtorrent or BEP source study applies.

## Validation

- Store: `disabling_file_selection_releases_queued_adds_with_their_selection`
  queues a torrent, a select-only magnet and a cancelled add, confirms the
  first with None and `disable_future`, then after reopen proves the others
  run with their own selection and ranges in add order and the cancelled add
  is not revived.
- Application: `disabling_file_selection_releases_the_queued_adds` proves a
  dispatched confirmation leaves no torrent awaiting selection.
- Web: `starts a fresh draft for the next queued torrent after confirming`
  fails without the key and passes with it.
- Run fmt, clippy, workspace tests, web typecheck/tests.

## Evidence

Passing local gates on 2026-10-13 (shell profile sourced):

- `cargo fmt --all -- --check` and `cargo clippy --workspace -- -D warnings`.
- `cargo test --workspace`: 1,595 passed, 18 ignored, none failed,
  including the store and application cases above and the existing
  Tactical 308/323 pending-selection cases.
- `npm run typecheck --prefix clients/web` and `npm run test --prefix
  clients/web` pass (532 passed, two existing skips); the web regression
  was confirmed to fail with the key removed.

No generated boundary changes, so the TypeScript contract is not
regenerated. The Android build and device runs are not repeated: no Kotlin
or binding change, and Android consumes the same store transition. No
device install, release or live swarm.
