# Durable Data Migrations

Topic: `durable-data-migrations`

Status: Active ledger, started 2026-10-14 by Tactical
[358](../tactical/358-one-durable-store-and-migration-ledger.md). Every
migration step, legacy reader and one-time import that exists to carry user
data across versions is listed here, with where it came from and when it may
be removed. Nothing below is removed except through this ledger.

## Rules

- Shipped user data is never wiped, reset or replaced on upgrade; only an
  explicit user action such as Clear app data discards it.
- Durable application state lives in SQLite with versioned, hand-written,
  append-only forward migration steps, a frozen baseline and fixtures written
  by released code (see [`client-persistence`](client-persistence.md)).
- Platform preference stores (browser local storage, Android
  SharedPreferences, `chrome.storage`) hold only UI preferences that tolerate
  per-field defaults, and never overwrite or wipe themselves. Consent is not a
  UI preference.
- A store or file a version cannot read fails closed and is left unchanged.
- Adding a step, reader or import adds its row here in the same commit.

## Retiring Compatibility Code

Each format has a **supported floor**: the oldest version a supported install
can still hold. Raise a floor only when all of these hold, and record the
decision here:

1. Every app version still allowed to run (the minimum version the updaters
   and Play enforce; see Tactical
   [355](../tactical/355-automatic-updates.md)) writes the new floor or later.
2. At least 12 months have passed since the first public release that wrote
   the new floor.
3. A user holding an older store still has a way out: the store is refused
   unchanged, the app shows the recovery screen, and the torrent list can be
   exported from it (Tacticals
   [348](../tactical/348-torrent-list-export-import.md) and
   [369](../tactical/369-catalog-recovery-screen.md)).

Then, in one commit: make the floor version's fresh schema the new frozen
baseline, delete the steps and fixtures below it, keep the floor's fixture,
classify older versions as retired (refused, unchanged), and move the rows
below to **Retired** with the commit.

## Formats

| Format | Owner | Current | Floor | Notes |
| --- | --- | --- | --- | --- |
| Session catalog `session.db` | `crates/rstorrent-session/src/store*.rs` | 29 | 26 | Baseline 26 covers releases through desktop 0.3.1; Latest 0.3.2 ships 29; fixtures `tests/fixtures/catalog/v26.sqlite` and `v29.sqlite` |
| Product state `product.db` | `crates/rstorrent-session/src/product_state.rs` | 4 | 2 | Baseline 2 covers releases through desktop 0.3.1; Latest 0.3.2 ships 4; fixtures `tests/fixtures/product/v2.sqlite` and `v4.sqlite` |
| Speed history `metrics.db` | `crates/rstorrent-session/src/speed.rs` | 1 | 1 | No migrations; an unknown version runs without saved history and is not deleted |
| Desktop shell `desktop-shell.json` | `clients/desktop/src-tauri/src/desktop_lifecycle.rs` | retired format | — | Imported once into `product.db`; never written since Tactical 358 |
| Torrent list bundle | `crates/rstorrent-session/src/torrent_list.rs` | 1 | 1 | Export format; readers ignore unknown fields and refuse newer versions |
| Extension `productMetricsV1` | `clients/extension/src/product-metrics.js` | 1 | 1 | Newer states are read only; damaged states keep valid fields |
| Web table layouts `rstorrent.table.<id>` | `clients/web/src/inspection/components/VirtualTable.tsx` | 1 | 1 | Any version is read field by field; written only after a user change, keeping unknown columns, fields and a newer version number |

## Active Compatibility Code

| Item | Format | Added | Kind | Retire when |
| --- | --- | --- | --- | --- |
| Step 26 → 27: seeding stop limits | `session.db` | Tactical 344 (`1c4391e7`) | migration step | Floor reaches 27 |
| Step 27 → 28: network defaults marker | `session.db` | Tactical 358 | migration step | Floor reaches 28 |
| Step 28 → 29: file-selection bitmaps and download safety | `session.db` | Tactical 373 | migration step | Floor reaches 29 |
| Sparse file-selection/High tables retained inert after bitmap conversion; schema <29 read-only recovery reader | `session.db` | Tactical 373 | legacy reader / retained migration inputs | Floor reaches 29; remove reader and old tables only through the floor-raise process |
| Private 377 probe 29 → 30 (owned CI/VM fixtures only; never shipped) | `scripts/prepare-private-update-qualification.mjs` | Tactical 377 | synthetic forward-migration/crash test; populated fixtures write a bounded 8 MiB probe before a ten-second uncommitted pause | Retire or update before the next real schema bump; discard every private probe profile at task cleanup (all 377 execution profiles discarded on 2026-10-17) |
| Pre-baseline refusal (schemas 1–25) | `session.db` | Tactical 345 (`75e95083`) | classification | Keep; it is the fail-closed answer for old incubation catalogs |
| Reset report reading (`profile_reset_report`, startup announcement) | `session.db` | Tactical 179, reset removed by 345 | legacy reader | No new reports since 345; remove the reader (and later drop the table by a step) at the next floor raise |
| Step 3 → 4: desktop update preference, attempt and handoff intake | `product.db` | Tactical 355 | migration step | Floor reaches 4 |
| Step 2 → 3: desktop shell switches | `product.db` | Tactical 358 | migration step | Floor reaches 3 |
| Schema 1 → 2 reader (`migrate_schema_1`) | `product.db` | Tactical 208 | migration step | **Ready now**: schema 1 never shipped in a public release |
| `desktop-shell.json` one-time import (versions 3 and 4) | desktop | Tactical 358 | one-time import | Floor rule for desktop: every allowed desktop version includes Tactical 358; then also delete the leftover file in that commit |
| Legacy `network_defaults_version` from `desktop-shell.json` | desktop → `session.db` | Tactical 358 | one-time import | With the shell import above (version 4 never shipped publicly) |
| Legacy updater `cfu-id` adoption | desktop → `product.db` | Tactical 208 | one-time import | When the JSTorrent desktop succession window closes (`product-surfaces-and-migration`) |
| JSTorrent desktop import (`store/legacy_desktop.rs`, `legacy_migration.rs`) | legacy JSTorrent → `session.db` | Tacticals 233, 241 | one-time import | When the JSTorrent desktop succession window closes |
| JSTorrent Android import (`store/legacy_desktop/android.rs`, `ProductLegacyAndroidMigration.kt`) | legacy JSTorrent Android → `session.db` / prefs | Tactical 245 | one-time import | When the Play succession window closes |
| Android SAF `tree-uri` key → `root-registry-v1` | Android prefs | `ProductSafRootRegistry.kt` | one-time import | When every allowed Android version wrote the registry |
| Extension `productMetricsV1` recovery | extension | Tactical 358 | tolerant reader | Keep; it protects consent |

## Open Follow-Ups


## Retired

None yet.

## Release admission metadata (377)

`distribution/desktop-compatibility.json` records supported floors, written
versions and cumulative migration-prefix fingerprints for session/product/
metrics databases. `scripts/desktop-compatibility.mjs` derives and checks it
from frozen baseline fixtures and migration source; a schema bump must extend
the registry. Desktop builds refuse stale generated facts. Release collection
signs the exact facts and updater URL/signature pairs with the retained updater
key. New builds audit every previously published metadata prefix; source
changes cannot silently rewrite a released migration. Native read-only
inspection uses the existing `user_version` markers and metrics' existing
`metrics_meta` row, including committed WAL state. It never creates a store.
The store-open migration/refusal paths remain authoritative, including when an
older binary is installed outside the updater. No schema step is added by 377.


Tactical [377](../tactical/377-compatible-touchless-release-channels.md) found
that the desktop and Android legacy-import preflight required the destination's
schema to equal current, preventing ordinary upgrades from the released schema
26 fixture. Both now share the canonical pure catalog-version classifier.
Inspection leaves supported older catalogs unchanged; ordinary store open owns
the forward migration, pre-migration copy and transaction. Retired, newer and
unversioned nonempty catalogs remain refused without reset. Released-fixture
startup regressions cover both adapters and source validation before mutation.
