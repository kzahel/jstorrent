# Released Session Catalog Fixtures

Each `v<N>.sqlite` is a populated session catalog written by the code of a
public release that ships schema `N`. Tests in `src/store_migration.rs` open
every fixture with current code and require every row to survive and the
result to match a fresh catalog exactly. Never edit or regenerate a fixture
for an already-released schema.

When a release ships a new schema version, add its fixture before the next
schema change: check out the release tag in a worktree, copy
`tests/catalog_fixture_generator.rs` into it unchanged if the tag lacks it,
and run

```bash
RSTORRENT_CATALOG_FIXTURE_OUT=/tmp/v<N>.sqlite \
    cargo test -p rstorrent-session --test catalog_fixture_generator -- --ignored
```

Copy the output here, add it to `RELEASED_CATALOGS`, and record it below.

| Fixture | Release tag | Commit | SHA-256 |
| --- | --- | --- | --- |
| `v26.sqlite` | `android-v1.0.31` (schema 26, as every public release since `android-v0.1.0` and `desktop-v0.1.4`) | `70150ec99ff5613bb468fd816fed46c687ff7557` | `499e32a3ba498ee3d0743e8b13d6f9c09a08f497572303dedfbe262c8c008bfa` |

The fixture holds seven torrents covering running, paused, archived, removing
(keep data), pending file selection, multi-file with High and Skip priorities,
and a magnet without metadata, plus storage roots, client and torrent
settings, verified pieces, receipts, milestones, trackers, a peer hint, DHT
state and nonzero lifetime counters. Its only paths are generator temporary
directories. The torrents and trackers are synthetic.
