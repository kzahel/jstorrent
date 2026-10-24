# Migration regression testing

These checks exercise retained legacy formats and upgrade paths. They are
useful for import, updater or mixed-version changes, not a prerequisite for
ordinary engine development. [Current validation map](../development/testing.md).

## Android legacy-state import

The [upgrade runner](../../clients/android/scripts/run-legacy-upgrade.py) owns
fresh API 28/35 emulators, downloaded pinned legacy APKs, temporary successor
APKs and disposable certificates. It never uses production signing keys or an
attached physical device. Run serially from the repository root after building
both native ABIs and generated bindings:

```bash
source ~/.profile
clients/android/build.sh
PYTHONDONTWRITEBYTECODE=1 python3 clients/android/scripts/run-legacy-upgrade.py --help
PYTHONDONTWRITEBYTECODE=1 python3 clients/android/scripts/run-legacy-upgrade.py --api 28
PYTHONDONTWRITEBYTECODE=1 python3 clients/android/scripts/run-legacy-upgrade.py --api 35
```

The default seeded mode checks UID/data/grant retention, settings and file
selection mapping, intact/corrupt/private content, restart, grant repair and
no resurrection after clearing private state. The
[legacy fixture record](../../tests/fixtures/legacy-android-v1.0.24/README.md)
owns the pinned source APK and attribution.

To exercise the old app's ordinary Compose settings/intake writers, two SAF
roots and loopback downloads instead of directly seeding source-format state:

```bash
PYTHONDONTWRITEBYTECODE=1 uv run --project tests/interop --locked \
  python clients/android/scripts/run-legacy-upgrade.py --api 35 --source ordinary
```

The source-only `legacy-upgrade-fixture` module supplies dependencies missing
from the minified legacy APK; successor assertions use ordinary instrumentation.
`--evidence-dir` must be a new task-owned directory and retains before/after/
failure captures and bounded logs. Remove captures after review; emulator, AVD,
temporary APKs and certificates are cleaned by the runner, and ordinary debug
build identity is restored.

## Old/new extension and companion pairs

Build the successor extension before using companion mode:

```bash
npm run package --prefix clients/extension
PYTHONDONTWRITEBYTECODE=1 uv run --project tests/interop --locked \
  python clients/android/scripts/run-legacy-upgrade.py --api 35 --source companion
```

Repeat on API 28 for the lower-API cohort. The harness drives pinned released
extension writers in owned Playwright Chromium, old Android pairing, two SAF
roots and old/new version combinations before fresh successor control. Its
fixed ARC-address emulation and optional-permission grants affect only the
owned emulator/browser; they do not change shipping manifests or phone policy.

These are controlled source-format/import checks. They do not establish Play
signing, store-installed delivery, all historical profiles or physical ARC
replacement. [Android replacement](../topics/android-jstorrent-replacement.md)
owns those separate contracts and gates.

## Desktop import and installed updates

The [desktop replacement topic](../topics/desktop-jstorrent-replacement.md)
maps atomic import, released source formats, host fencing and installed
update rehearsals. [Pinned desktop fixtures](../../tests/fixtures/legacy-desktop-v0.2.1/README.md)
own their provenance. Use explicit owned Machine Control guests for tests
that replace a production installation, invoke OS handlers or alter associations;
restore the inherited profile, payloads and OS state afterward.

Package/native-host validators are indexed in the
[client guide](../development/clients.md#platform-validation). The
[cutover checklist](../jstorrent-cutover-checklist.md) and
[finish-line tactical](../tactical/259-jstorrent-finish-line-checks.md) retain
exact signed-artifact and installed-update evidence. Do not infer installed
update continuity from a source renderer or locally rebuilt legacy fixture.
