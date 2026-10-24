# Released desktop writer fixtures

These nonpersonal JSON exports come from seven generated profiles per platform
using desktop v0.2.1's released native host and the pinned engine/client session
writers. The source/artifact pins, bounds, union proposal and exact evidence
are in [Tactical 233](../../../docs/tactical/233-legacy-desktop-fixture-cohort.md).
No reference implementation source, personal payload, discovery credentials or
browser profile is included. Payload/metainfo was independently authored for
this test. JSON files map actual SQLite KV keys to their original serialized
values; malformed variants are explicitly labeled synthetic mutations.

Each platform's manifest retains original closed SQLite hashes, source record
provenance and proposed outcomes. Random generated source profile/root IDs and
legacy timestamps explain why fresh generation is logically reproducible rather
than byte-identical. Source completion is input evidence, never successor
verification authority. No importer or migration result is represented here.

Prepare an isolated archive using `git archive` at the exact desktop commit for
`packages/engine` and `packages/client`. Copy the engine's
`src/geo/ipv4-country-data.stub.ts` to `ipv4-country-data.ts`, following its
pinned generation fallback. In the archive root, install `tsx@4.20.6` and
`bn.js@5.2.2`. Extract the pinned native host and adjacent IO daemon from the
released deb/NSIS, without installing production identities. The generator
checks both binary hashes and the prepared source-tree hash before starting.

Inside a claimed guest, run:

```sh
python legacy_desktop_fixture_cohort.py --root NEW_ABSOLUTE_FIXTURE_ROOT \
  --host RELEASED_NATIVE_HOST --source PREPARED_SOURCE_ROOT \
  --writer generate-legacy-desktop-records.mts \
  --tsx PREPARED_SOURCE_ROOT/node_modules/tsx/dist/cli.mjs --node NODE
```

The driver closes and joins every host/reader, then uses SQLite backup and
explicitly closes every SQLite connection before hashing. Preserve only
`manifest.json`, `snapshots/`, and `payload/` as the closed cohort; exclude live
config, discovery, logs, specs and runtime authority. Export each closed KV
table to JSON with its manifest. Keep SQLite/payload archives outside Git.

On the builder with the existing libtorrent 2.0.11 test environment:

```sh
python tests/interop/verify_legacy_desktop_fixtures.py
python tests/interop/verify_legacy_desktop_fixtures.py --closed-root CLOSED_COHORTS
```

The first command checks the committed exports and metainfo. The second also
requires `linux/` and `windows/` closed cohorts, independently checks immutable
SQLite snapshots and hashes the actual pieces, including partial/omitted files.
