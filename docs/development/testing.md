# Choosing validation

Tests answer different questions. Start at the layer changed, add the scenario
that exercises its integration, and use platform evidence when OS semantics
matter. This guide maps those layers; script help and CI own detailed options.
Commands run from the repository root.

| Layer | What a pass establishes | Where to start |
| --- | --- | --- |
| Deterministic tests | Parsers, state transitions and resource accounting obey their invariants | Rust and web unit tests below |
| Controlled runtime | Real sockets, storage, restart and failure recovery produce correct bytes and terminate | [Interoperability scenario map](../../tests/interop/README.md) |
| Presentation | The interface renders and handles input, accessibility and view recovery | Playwright below |
| Native platform | Packaging, permissions, storage providers and lifecycle work on that platform | [Client guide](clients.md) and platform READMEs |
| Shipping | The selected packages have valid provenance, notices and signatures | [Release guide](releasing.md) |

A browser renderer pass is not installed updater evidence. A controlled
transfer is not a public-swarm reliability or throughput claim. Legacy import
and old/new version-pair checks have their own
[migration test guide](../migration/testing.md).

## Common checks

Load configured local toolchains first:

```bash
source ~/.profile
cargo fmt --all -- --check
cargo clippy --workspace -- -D warnings
cargo test --workspace
```

For shared web changes or generated application-contract changes:

```bash
npm ci --prefix clients/web
npm run typecheck --prefix clients/web
npm run test --prefix clients/web
```

When Rust types crossing the application boundary change, regenerate before
checking drift:

```bash
npm run generate --prefix clients/web
```

For documentation-only changes, check links and run `git diff --check`.
Choose additional checks in proportion to the change; do not rerun unrelated
physical or public-network campaigns as routine validation.

## A complete controlled application check

Use the lifecycle smoke for changes to intake, persistence, completion,
seeding, recheck, repair or keep-data removal. It uses independent fixtures and
the ordinary application service, checks bytes, and joins its temporary owners.

```bash
cargo build --locked -p rstorrent-gateway
uv run --project tests/interop --locked \
  python tests/interop/application_lifecycle_smoke.py \
  --binary target/debug/rstorrent-gateway
```

`--extended` includes oversized single-file and one-entry-folder cases.
[The weekly verification workflow](../../.github/workflows/verification-matrix.yml)
also runs `unified_resume_recheck.py --phase all` for exact checkpoint crash
boundaries. See the scenario map for targeted discovery, transport, storage,
selection, concurrency and streaming checks.

## Browser interaction and layout

```bash
cd clients/web
npx playwright install chromium
npm run test:e2e
```

Playwright owns its Vite server and bundled Chromium. Use that separate test
browser, not the primary installed browser with a temporary profile. The suite
covers responsive layout, keyboard input, accessibility, virtualization and
pseudo-localization; a focused spec can be selected through Playwright's CLI.
[Demo mode](clients.md#web-demo) provides deterministic manual inspection.

## Copy, branding and localization

```bash
node scripts/check-localization.mjs
node scripts/check-branding.mjs
npm run generate:localization --prefix clients/web
```

These check catalog/branding consistency and regenerate the shared React
catalog. Use browser tests for changed layout and the platform localization
matrices when native resources or lifecycle change. The
[localization topic](../topics/localization.md) owns catalog policy; Android
and iOS READMEs own their native commands.

## Remote control and platform checks

[`scripts/verify-remote-product.mjs`](../../scripts/verify-remote-product.mjs)
drives local HTTPS/WSS login, resume, revocation, relay restart and host-change
refusal using release React/Wasm and real host binaries. It needs OpenSSL,
curl, `wasm32-unknown-unknown`, matching `wasm-bindgen-cli` and Playwright
Chromium. It cleans up its fixtures and does not publish or prove signed
cross-version compatibility.

[`scripts/android-runtime-smoke.py`](../../scripts/android-runtime-smoke.py)
owns a fresh API 35 AVD for the product SAF selection/restart/recheck/removal
cohort. Build the debug APK first; install the host-native API 35 Google APIs
system image and configure `ANDROID_HOME` or `ANDROID_SDK_ROOT`. Linux needs
KVM. The [client guide](clients.md#platform-validation) routes additional
Android, iOS, desktop and ChromeOS checks.

## CI as the executable inventory

[`ci.yml`](../../.github/workflows/ci.yml) owns presubmit commands and platform
jobs; [`verification-matrix.yml`](../../.github/workflows/verification-matrix.yml)
owns broader storage and recovery checks. Read the relevant job rather than
maintaining another complete CI command list here. Record actual checks and
limitations in the owning tactical, not in this guide.
