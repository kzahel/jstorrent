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

For the completed-file DataChannel save path, use the repeatable local release
benchmark (bundled Chromium and disposable verified storage):

```bash
cargo build --release -p rstorrent-direct-file --features experiment \
  --bin rstorrent-direct-file-experiment
node scripts/benchmark-direct-file.mjs --sizes 64,256 --repeats 3 \
  --output /tmp/direct-file-benchmark.json
```

`--sinks opfs,drain` compares the actual production consumer with a real
disk-backed writable and a bounded deterministic-byte checking drain.
`--sizes 8 --ack-delay-ms 20` isolates the cost of application write-credit
latency; it does not emulate a WAN. OPFS substitutes for the destination picker
only inside the harness, and saved SHA-256 is checked after timing. The local
experiment signaling adapter does not replace the authenticated product
verifier or qualify external save-picker behavior. Tactical
[307](../tactical/307-direct-file-save-throughput.md) owns results and limits.
`--window-kib 16`, `32` and `64` reproduce the stop-and-wait baseline and
bounded window alternatives; the default is 64. `--protocol-checks --sizes 8
--repeats 1` also exercises four concurrent ranges, invalid/flooded ACKs,
stalled credit and cancellation against the native endpoint.
Add `--inactivity-checks` to wait for the actual 60-second stalled-credit
deadline. `--consumer-ref <commit-sha>` uses that revision's production save
consumer against the current native endpoint for compatibility checks.

For transport-ceiling diagnosis, `--source generated` retains the production
consumer and range/ACK protocol but substitutes generated bytes for file reads.
`--source raw` sends generated 16-KiB messages through the same reliable RTC
driver without application framing, ACKs or a writer; `--raw-buffer-kib 64`,
`256` or `512` selects its outstanding-byte cap within the product ceiling.
`--source browser` adds a Chromium-to-Chromium raw control with a 512-KiB
`bufferedAmount` cap (unsent bytes, unlike the Rust outstanding/unacknowledged
counter). Raw/control consumers verify all bytes without retaining payload.
`--source raw --sizes 64 --cancel-after-mib 1 --repeats 1` verifies partial
transfer teardown. These diagnostic modes do not change production behavior
or claim a universal WebRTC maximum; Tactical
[309](../tactical/309-direct-file-transport-ceiling.md) owns interpretation.

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

The `Fast CI` workflow gives early PR feedback on the exact submitted head.
It lints changed portable Rust crates and their portable dependents, runs
formatting and the directly changed libraries' unit tests, and checks
generated-contract drift in parallel when the gateway is affected. Web type/unit/
build, companion packaging and website build checks run for their affected
surfaces. Workflow/reviewer safety checks always run. Unknown executable or
shared configuration changes select conservative checks; docs-only changes
skip product builds. The stable aggregate check is **Fast PR feedback**.

The warm-run target is 3--5 minutes, not a qualified duration or timeout.
Cold dependencies and broad changes may take longer. Fast checks retain the
ordinary optimized Rust profiles. They restore the ordinary CI dependency
and contract caches using the same shared keys, without saving; full CI remains
their owner.
Fast checks omit dependents' runtime tests, Rust integration and feature-variant
execution, browser E2E, native packaging and mobile builds.
The existing `CI` workflow remains independent full qualification, with its
original job names and coverage. Branch protection is unchanged.

Full qualification runs shared-web validation, companion-extension packaging,
and workflow/release-tool checks in independent jobs. A failed extension package
does not suppress web contract drift, type, unit, production-build, or browser
coverage. Native desktop, Android, and iOS jobs retain their separate gates.

The optional custom agent PR review lane follows
[agent-pr-review](../topics/agent-pr-review.md). It uses a
separate isolated checkout, restores trusted main build caches, and publishes
commit-bound findings after successful Fast CI PR checks. Failed/cancelled
fast runs cannot start automatic review; full qualification may still be
running. Explicit manual reviews remain available. Automatic review is enabled;
the topic records its qualification and limits.

Run the bounded build-profile comparison with four Cargo jobs:

```bash
source ~/.profile
node .github/scripts/benchmark-fast-ci.mjs artifacts/verification/fast-ci-benchmark.json
```

This compares the same protocol/engine library cohort using the ordinary and
temporary candidate profiles: empty build target, unchanged rerun, first-party
rebuild with dependencies retained, and test execution. Each profile owns a disposable
build tree. Cargo registry downloads may already be cached; a local result
does not qualify GitHub runner latency. Tactical
[304](../tactical/304-fast-pr-feedback-and-ci-benchmarks.md) owns the
comparison, rejected profile and hosted follow-up.
