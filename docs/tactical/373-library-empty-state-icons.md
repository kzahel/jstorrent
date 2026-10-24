# Library empty-state icons

Status: complete. Topic: `web-ui-design`.

## Scope and stopping condition

Replace the oversized diamond text glyph in Library empty and status messages
with the existing Library navigation icon at a restrained size. Apply the same
treatment to the media Library, the older torrent-card Library and Library
detail. Stop after web type checking, unit tests and a headless browser visual
check pass.

## Constraints and non-goals

Reuse the shared `Icon` component and muted theme color. Keep the icon
decorative, the existing message text and status semantics, and the current
layout. No new assets, dependencies, application contract or Android changes.

## Validation

- `npm run typecheck --prefix clients/web` passes.
- `npm run test --prefix clients/web`: 832 passed, 3 skipped.
- A one-off headless Playwright check against Vite with the `empty-library`
  demo verifies the media and older torrent-card Library icons are 32 by 32 px
  and decorative (`aria-hidden`). Desktop light (1100 by 740) and phone dark
  (390 by 844) captures were visually reviewed; the phone navigation was
  closed for the captures. The browser and development server were stopped
  and temporary captures removed.
- `git diff --check` passes.
