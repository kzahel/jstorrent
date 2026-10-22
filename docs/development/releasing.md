# Building and shipping updates

JSTorrent is the sole active product release identity. Preserve its established
app IDs, updater endpoint and signing trust. RSTorrent incubation publication
is frozen; isolated debug identities and internal `rstorrent-*` names remain
useful for testing. The accepted
[release policy](../topics/product-surfaces-and-migration.md#jstorrent-only-release-policy-2026-10-11)
owns this distinction.

Current packaging and future updates belong here. Legacy import rehearsals,
cutover qualification and old release receipts belong in the
[migration stream](../migration/README.md). Commands below run from the
repository root and do not themselves authorize publication.

## Local production candidates

```bash
source ~/.profile
node scripts/validate-jstorrent-candidate.mjs
npm run package:jstorrent --prefix clients/extension
node scripts/build-jstorrent-desktop.mjs --unsigned --debug --bundles app
```

The desktop builder merges the package/release overlay and
`tauri.jstorrent.conf.json`. A signed build needs the existing
`TAURI_SIGNING_PRIVATE_KEY` and password; do not rotate or reprovision them as
part of packaging cleanup. Production app launches can import legacy state:
use owned guests for installed tests rather than the maintainer's live profile.

For a hosted nonpublishing candidate, use the explicit workflow mode:

```bash
gh workflow run desktop-release.yml --repo kzahel/jstorrent --ref main \
  -f production_candidate=true
```

[`desktop-release.yml`](../../.github/workflows/desktop-release.yml) owns the
platform matrix, asset set and candidate validation. Failed diagnostic artifacts
are not qualified delivery. Android signing/build/upload commands are in the
[Android release guide](../android-release.md); production extension packaging
and permissions are in its [client README](../../clients/extension/README.md).

## Explicit desktop publication

After the selected candidate is qualified and publication is explicitly
authorized, dispatch against its exact existing release tag:

```bash
gh workflow run desktop-release.yml --repo kzahel/jstorrent \
  --ref desktop-vX.Y.Z \
  -f production_candidate=false -f production_publication=true
```

Tag creation/push is a separate action. The collector verifies the tag/source,
same-run assets, updater signatures and draft before publishing. Current
workflow checks own the exact asset inventory; do not copy an old preview
matrix into a new release plan. Installed updater, migration and store evidence
establish different properties from build success.

## Notices, provenance and dependency review

Packaging requires pinned `cargo-about` and exact-target notices:

```bash
cargo install cargo-about --locked --version 0.9.2 --features cli
python3 scripts/prepare-release-notices.py --target aarch64-apple-darwin
python3 -m unittest discover -s scripts -p test_distribution_review.py
python3 -m unittest discover -s scripts -p test_linux_native.py
```

Use the actual package target. The [license records](../../distribution/licenses/README.md)
and [Linux native-build guide](../../distribution/linux-native/README.md) own
native provenance and AppImage replacement inputs. The
[patch record](../../distribution/patches/README.md) owns the reviewed GLib
backport; Linux packaging also requires its optimized regression:
`cargo test --locked --release -p rstorrent-desktop --test glib_backport`.
Inspect new Linux candidates with both `--require-native-notices` and
`--require-mit-native`; historical package review does not qualify new packages.
The [Android guide](../android-release.md#dependency-attribution) owns its
variant-specific Maven/AAR and Rust attribution.

[`inspect-distribution.py`](../../scripts/inspect-distribution.py),
[`inspect-android-notices.py`](../../scripts/inspect-android-notices.py),
[`audit-cargo-dependencies.py`](../../scripts/audit-cargo-dependencies.py) and
[`review-dependency-audit.py`](../../scripts/review-dependency-audit.py)
provide `--help` for report inputs and options. The
[daily dependency workflow](../../.github/workflows/dependency-review.yml)
owns audit tool versions and report collection; tagged publication requires
`--require-release-ready`, including fresh advisory/review evidence.

## Website and remote controller

[`deploy-production-website.yml`](../../.github/workflows/deploy-production-website.yml)
owns building React/Wasm, Astro and the combined Pages artifact. The
[assembler](../../scripts/assemble-pages-site.mjs) and
[deployment verifier](../../scripts/verify-remote-deployment.mjs) enforce build
identity, digests, content types and cache/security policy. Local builds can
exercise those checks without publishing or enabling remote access.

Retained [desktop preview](../desktop-release.md) and
[Crostini](../crostini-release.md) runbooks contain historical channel evidence.
They do not authorize re-enabling a frozen release lane.

## Stable and Latest with database admission

Tactical [377](../tactical/377-compatible-touchless-release-channels.md)
owns initial installed acceptance. `JSTorrent Latest Desktop` runs daily at
03:17 UTC and supports manual dispatch for signed prereleases from the exact
main head after successful full push CI. It refreshes exact release records
for known desktop tags before allocating a version; incomplete inventories
stop selection. It refreshes the matching main-push CI run directly and checks
its workflow, source and result. It skips source already published to Latest;
scheduled runs also skip a main head whose CI is not yet green. Any
new commit qualifies, including documentation-only changes. It allocates the
next numeric version across both JSTorrent channels
and invokes the existing five-target signing/collection pipeline. The old
incubation nightly remains disabled. Both channels use the original app ID,
updater key and installers. New metadata-required releases carry authenticated
database ranges and migration prefixes, bound to the exact payload signatures.

Run `node scripts/desktop-compatibility.mjs` before a package build. On a real
schema change, extend that script's source registry, regenerate with `--write`,
and review its prefix against published releases; never rewrite a released
prefix to make a check pass. `node --test scripts/desktop-release-train.test.mjs`
checks common version ordering and preservation of released migrations.
A later Stable promotion must retain the tested version and package bytes;
newer Latest users wait, and equal-version users need no reinstall. Stable
publication remains explicit and separate from qualification.

Dispatch the same public Latest publisher manually with:

```bash
gh workflow run latest-desktop.yml --repo kzahel/jstorrent --ref main
```

Tactical [378](../tactical/378-public-latest-and-nightly.md) authorizes Latest
to require extension 1.1.5 or newer for the eight specifically accepted field
exposures in `acceptedLatestDesktopFields`. New incompatibilities still block;
Stable and Android do not inherit the exception. Release notes disclose the
companion requirement. The nightly does not publish Stable or move its offer.

`Promote JSTorrent Latest to Stable` defaults to preparing a private, reviewable
promotion artifact. It downloads and verifies a public Latest release, copies
all native packages/signatures and source materials unchanged, preserves the
candidate's database facts, and re-signs only the URL-bound updater metadata
for Stable. It never rebuilds a native package. An explicit `publish=true`
dispatch is required to publish; it also enforces the candidate source's own
companion-compatibility guard. Tactical [380](../tactical/380-product-release.md) records explicit
Stable 0.3.4 authorization with extension 1.1.5+ required. That exact release
exception does not authorize other Stable versions.
