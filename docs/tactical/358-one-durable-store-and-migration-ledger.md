# Tactical 358: One Durable Store And A Migration Ledger

Status: Complete, 2026-10-14. Maintainer-directed; implementation and
commits authorized.
Topics: `client-persistence`, `durable-data-migrations` (new),
`product-state-and-feedback`.

## Problem

Tactical [345](345-supported-catalog-migrations.md)'s audit found durable
desktop and extension state that resets itself:

- Desktop `desktop-shell.json` (run in background, notification and power
  switches, and `network_defaults_version`) is rewritten with defaults when
  it is unreadable, has another version or an unknown field. Its network
  marker guards a one-time change to the session catalog, so losing the file
  re-applies "incoming and port mapping off" to the user's saved settings.
- The extension's `productMetricsV1` is replaced on any shape difference,
  which turns statistics back on after an opt-out and issues a new
  installation ID.

There is also no record of which migration and compatibility code exists, so
nothing says when it can be removed.

## Decisions

Maintainer direction, 2026-10-14:

- Durable application state lives in SQLite with versioned, hand-written
  forward migrations and released fixtures. Platform preference stores
  (browser local storage, Android SharedPreferences, `chrome.storage`) hold
  only UI preferences that tolerate per-field defaults, and never overwrite
  or wipe themselves. Consent is not a UI preference.
- Every migration step, legacy reader and one-time import is listed in one
  ledger with a retirement condition, and is removed only through that
  ledger.

## Scope

1. **Session catalog schema 28.** `client_settings.network_defaults_version`
   records the quiet network defaults (Tactical 339/340). Applying the
   defaults and setting the marker happen in one transaction, and only while
   the marker is 0, so the change can never be applied twice. A desktop
   profile whose old shell file already recorded the marker sets it without
   changing settings. Restore defaults keeps the marker; Clear app data starts
   over as a fresh profile does.
2. **Product state schema 3.** The product database moves to the session
   catalog's pattern: frozen baseline (schema 2, every public release), an
   append-only step list tied to the version by a compile-time assertion,
   fresh = baseline plus steps, released fixture tests. Step 2 → 3 adds a
   `desktop_shell_settings` row for the desktop shell switches.
3. **Desktop.** The shell reads and writes its switches through the product
   database. On the first start of this version it imports
   `desktop-shell.json` once (version 3 or 4) into the product database and
   the network marker into the session catalog, then never reads the file
   again. It does not delete or rewrite the file. The product database opens
   before the tray is built.
4. **Extension.** Reading `productMetricsV1` keeps the stored opt-out and
   installation ID through any shape difference, takes known fields
   individually, and never writes defaults over stored consent.
5. **Ledger.** A new topic, `durable-data-migrations`, lists every durable
   format, its current version, its supported floor, and every migration step,
   legacy reader and one-time import with where it came from and when it may
   be removed, plus the retirement procedure. `AGENTS.md` points to it.

## Non-Goals

- Moving web, Android or extension UI preferences into SQLite.
- Removing any migration code now; the ledger only records candidates.
- Web table layout rewrites on version mismatch (cosmetic; recorded in the
  ledger as a follow-up).

## Invariants

- No upgrade path changes a user setting it was not written to change.
- A durable store that cannot be read fails closed and is left unchanged.
- The old shell file is never modified by this version.
- Statistics stay off after an opt-out across every extension upgrade.

## Validation

- Session: migration 27 → 28 against the released v26 fixture (two steps),
  marker gating, legacy marker, restore defaults keeps it.
- Product: released v2 fixture generated at `android-v1.0.31`, baseline frozen,
  2 → 3 step, shell settings round trip and Clear app data behavior.
- Desktop: import from v3 and v4 files, unreadable file leaves defaults
  without writing, no second network hold, tray built from the database.
- Extension: opt-out and identity survive unknown, missing and malformed
  fields.
- Workspace `fmt`/`clippy`/`test`, web, extension and Android checks.

## Stopping Condition

Complete when the shell switches and network marker live in SQLite with
fixtures and tests, the extension keeps consent, the ledger topic lists every
current migration and compatibility reader, and `AGENTS.md`,
`client-persistence` and the tactical record the result.

## Evidence

- All public releases ship product schema 2 and `desktop-shell.json` version
  3; version 4 (the network marker) never shipped, so released desktops apply
  the quiet network defaults once on upgrade, as Tacticals 339/340 intended.
- `cargo test -p rstorrent-session`: the released v26 catalog migrates through
  27 and 28 with every original value and marker 0; the marker gates the
  defaults to one application, survives user changes, Restore defaults and
  reopen; a legacy marker records without changing settings. The released
  product v2 fixture (generated at `android-v1.0.31`, SHA-256
  `27f0f591…7c96`) migrates to 3 keeping every value, including its
  statistics opt-out; the product baseline equals the released schema; shell
  switches round trip and survive product Clear app data (the desktop's own
  reset command restores them, as before).
- `cargo test -p rstorrent-desktop` on macOS (61 tests): fresh defaults
  without a file, a released v3 file imported once and never read again, a v4
  marker and tolerant fields, unreadable or unknown files left byte-for-byte
  unchanged with defaults in use, persistence and reset through the product
  database, the network hold once with explicit choices kept even after the
  file is corrupted, and a legacy marker that keeps chosen network settings.
- Extension `npm test`: a newer state stays read only and unchanged with
  writes refused; a damaged schema-1 state keeps the opt-out, disclosure and
  installation ID; unreadable consent counts as off.
- `cargo clippy --workspace --all-targets -- -D warnings`, `cargo fmt`.

