# Stable Remove Dialog Controls

Status: First pass ready for product review (2026-09-27).

Topic: `web-ui-design`.

## Scope and stopping condition

Keep the Remove torrents dialog and its footer buttons in the same positions
when **Also delete downloaded data** is checked or unchecked. Reserve the
warning's layout space even while its text is hidden, and size the primary
button for its longest label. Preserve the default keep-data choice, the
conditional destructive warning and accessible alert, and all removal
command behavior.

This is a CSS/React presentation change. It adds no background owner,
contract, engine behavior, or persistent state. The first pass stops when
checkbox toggles cannot change dialog height or footer button width at a
fixed viewport and target set. The initial product-review pass deferred
screenshots and tests; subsequent pre-push validation is recorded below.

## Evidence

- The warning remains in layout when unchecked but is visually and
  accessibly hidden. Checking the box reveals that same-sized warning and
  gives it alert semantics.
- An invisible, accessibility-hidden copy of the longest confirmation label
  fixes the primary button width. A narrow-width grid keeps both footer
  positions fixed if that label wraps.
- Web typecheck and `git diff --check` pass. No screenshots or UI tests were
  run during this review pass.

## Pre-push validation (2026-09-28)

The full shared web unit suite passes (396 tests, two existing skips), along
with typecheck and localization checks. These cover removal behavior and
accessible confirmation controls; they are not a new dedicated measurement
of the dialog's fixed geometry. Product visual review remains separate.
