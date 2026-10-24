# Android 1.0.24 Source-Format Cohort

These examples are independently authored from the public format at JSTorrent
tag `android-v1.0.24`, source `7b454be4410385f9c4f7f135cb6b16194a2b0409`.
They contain no personal data or imported third-party fixtures/source.
They are **not installed-app captures, grant evidence, or an upgrade pass**.

`generate.py` deterministically generates `cohort.json`. Each case has legacy
`kv` strings, the `roots.json` object, allowlisted Android preference examples,
format-audit expectations and a separately labeled future runtime scenario.
The runtime scenario does not establish a real grant or payload observation.
All metainfo is private; no public tracker/swarm is needed. The deterministic
payload recipe and corrupt variant are recorded for the later installed test.

The 13 cases cover intact stopped, corrupt active, revoked grant despite a
stored healthy hint, whitespace-encoded cached magnet info, stopped pending
magnet with explicit empty selection, awaiting selection, missing root,
nullable state, malformed binary, VPN/unmetered restrictions, ambiguous root,
empty session, and explicit app-private default storage. Foreign completion and
counters are present deliberately and never yield verified pieces in the audit.

Run from the repository root:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 tests/fixtures/legacy-android-v1.0.24/generate.py
PYTHONDONTWRITEBYTECODE=1 python3 tests/interop/legacy_android_inventory.py
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests/interop \
  -p test_legacy_android_inventory.py -v
```

The audit materializes the exact Android SQLite version-1 nullable KV schema,
backs up committed WAL through a read-only connection, verifies identical KV
values, and removes its temporary directory. It emits only ordinal outcomes
and counts. Format candidates still need the production Rust metainfo/intake
validator; this tool is not an importer or a personal-profile preview command.
Root access, payload corruption, process death and package/grant continuity
must be tested on Android separately.
