# Settings Category Selection Style

Status: First pass ready for product review (2026-09-27).

Topic: `web-ui-design`.

## Scope and stopping condition

Replace the Settings category rail's selected left inset bar and its phone
bottom inset bar with a simple full-item tinted background. Remove the
selected border accent so focus shows one clear outer outline. Preserve
the existing category navigation, focus visibility, contrast tokens, and
mobile layout. No engine, API, state, or background work is involved.

The first pass stops when the active category has no edge bar at desktop
or phone widths. The initial product-review pass used source/diff inspection;
subsequent pre-push regression checks are recorded below.

## Evidence

- The selected category now has only the shared selection tint and text
  color. The desktop left inset shadow, phone bottom inset shadow, and
  selected border accent were removed.
- The global `:focus-visible` outline remains for keyboard navigation.
- `git diff --check` passed. No screenshots or UI tests were run.

## Pre-push validation (2026-09-28)

The full shared web unit suite passes (396 tests, two existing skips), along
with typecheck and localization checks. This is regression evidence; the
category tint remains a product-review first pass.
