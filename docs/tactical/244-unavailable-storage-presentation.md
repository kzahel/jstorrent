# Unavailable Storage Presentation

Status: Complete, 2026-09-30.

## Scope And Stopping Condition

Correct the shared React presentation exposed by Tactical 243: a retained
paused torrent with an unavailable root reports `awaiting_storage`, but the
adapter labels it Downloading and counts it Active. Stop when blocked storage
rows show Storage unavailable, appear in Needs attention, and leave Active
and Downloading, with deterministic adapter/component and migration evidence.

Read owners: `application-view-api`, `web-ui-design`, `client-surfaces`,
`download-roots`, `direct-filesystem-storage`, `client-persistence`,
`desktop-jstorrent-replacement`, and `product-surfaces-and-migration`.

## Invariants, Bounds And Non-Goals

- Application storage availability and typed progress remain authoritative.
- Paused/running intent, verification evidence and root bindings stay intact.
- Active storage preparation must not be classified as blocked storage.
- No filesystem creation, repair command, runtime task, schema, DTO, engine,
  checker or migration change; no package, hardware or production rollout.
- Mapping is constant work per existing row with no new retained state.

## Ownership And Reference Record

The application owns root health and reports AwaitingStorage/Unavailable;
`views/model.rs::assess_progress` distinguishes blocked WaitingForStorage from
active PreparingStorage. `LiveApplication` owns React row adaptation;
`TorrentStatus` owns the shared table label; existing filters own category
membership. Dependency direction remains React -> generated application DTO.
There are no new task/cancellation owners.

243's installed Windows evidence is the reproducer; 241's generated legacy
fixture is the deterministic backend oracle. This slice does not change any
engine/storage behavior, so no new protocol or libtorrent behavior is adopted.
Android Compose already uses operational state (Paused here), not the faulty
React state mapping; its semantics and generated boundary are unchanged.
React clients, including Android companion presentation, share the correction.

## Required Validation

- Adapter cases for blocked storage with paused and running intent, and active
  storage preparation; assert category membership and unchanged operational
  state.
- React component evidence for the row label and Needs attention filter.
- Existing missing-root migration test strengthened to assert application
  storage state, paused intent and zero verification without recreating roots.
- Focused migration suite, Rust formatting, web typecheck/test/localization.

## Evidence

The original adapter regression failed for paused and running-intent blocked
rows (`downloading` instead of `error`). The corrected mapping uses the existing
typed progress disposition only for AwaitingStorage. The shared status renderer
shows localized Storage unavailable for WaitingForStorage, including when a
Transfer table supplies an operational label. Existing error details remain
clickable; absent error text does not invent a backend failure message.

Validation on the macOS development host:

- `cargo test -p rstorrent-session store::legacy_desktop::tests --lib`:
  18 passed, including unchanged paused intent, zero verified pieces,
  AwaitingStorage/Unavailable/WaitingForStorage and absent-root preservation.
- `cargo fmt --all -- --check`: passed. Production Rust is unchanged; the
  focused migration suite is the proportional Rust check for test assertions.
- `npm run typecheck --prefix clients/web`: passed.
- `npm run test --prefix clients/web`: 432 passed, 2 skipped; includes the
  three new adapter cases and rendered row/filter regression.
- `node scripts/check-localization.mjs`: passed across maintained catalogs.
- `CI=1 RSTORRENT_PLAYWRIGHT_BASE_URL=http://127.0.0.1:4188 npm run test:e2e
  --prefix clients/web -- tests/localization.spec.ts`: 2 passed, covering
  long-LTR and RTL responsive/accessibility checks in bundled headless Chromium.
  A task-owned Vite server used pseudo locales on 4188 because the default
  4177 already had a listener. The existing listener was left untouched.

No generated application contract changes or Android rebuild are required.
No corrected installed Windows/Linux/macOS rerun is claimed. Test server and
temporary logs/results are removed after validation.
