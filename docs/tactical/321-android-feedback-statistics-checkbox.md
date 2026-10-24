# Tactical 321: Android Feedback Statistics Checkbox

Status: Complete locally on 2026-10-12; committed source repair, not a release.

Topic: `product-state-and-feedback`

## Trigger and scope

The Android feedback preview shows a checkbox that cannot be checked. The
native `HOSTED_PRODUCT_CONTEXT_READY` constant still disables statistics even
after the corrected hosted pages have been deployed. Enable the Android gate
and give the whole checkbox row toggle semantics, with interaction disabled
while a replacement preview is loading.

Dependencies: Tactical 208 and
[`product-state-and-feedback`](../topics/product-state-and-feedback.md).
No engine, generated contract, desktop, extension, durable preference,
website deployment or release changes are in scope.

## Invariants and limits

- Statistics require the acknowledged durable preference and an explicit
  per-report choice. Unchecking affects only that report.
- The displayed fields and reviewed URL remain the native owner's exact
  bounded allowlist; confirmation continues to reject stale URLs.
- The existing application product-state owner and Compose coroutine scope
  remain responsible for state and preview cancellation. No new task owner,
  dependency or persisted state is introduced.
- Confirm and toggle actions cannot race a pending preview refresh.

## Hosted verification

Fresh HTTPS GETs with a browser User-Agent on 2026-10-12 return HTTP 200 for
`privacy.html`, `feedback.html`, `uninstall.html` and `product-context.js`.
Each response matches `website/public/` exactly after removing the hosting
layer's injected CSP meta tag. Privacy copy discloses pseudonymous correlation,
fields, recipient exposure before submission and disable/reset limits. Both
forms use the deployed closed, bounded parser and text rendering.

Response SHA-256:

- privacy: `33e9a128ffd54d1962cbb3882ee9a07c1f40044e7527568e3663357f62fdfae4`
- feedback: `d8b8e51b76d687bcd39129418c271fdb926e548f5c1f329ca7a5a343d1206438`
- uninstall: `3ef2dfa208b8ce007caa54c78556c6c793ede3715480483e276e6b47085fb234`
- parser: `8e444d037519bb8d5346a5c14500fe0be9b6ec2aa63d73aba049bd463c9f38aa`

## Validation and stopping condition

Completed checks:

- `cargo fmt --all -- --check`.
- `cargo clippy -p rstorrent-android --all-targets -- -D warnings`.
- `cargo test -p rstorrent-android --lib`: 15 pass, including disclosure,
  inclusion, per-report omission, stale URL rejection and durable opt-out.
- `cargo test -p rstorrent-session product_state::tests`: 13 pass.
- `./gradlew lintDebug testDebugUnitTest assembleDebugAndroidTest` in
  `clients/android`: lint clean, 152 JVM cases pass, instrumentation packages.
- `node scripts/check-localization.mjs`: all catalogs pass.
- `python3 clients/android/scripts/run-localization-matrix.py --api 35 --class
  org.rstorrent.bootstrap.ProductNavigationTest`: all 34 Compose navigation
  tests pass, including check/uncheck/recheck, field visibility and reviewed
  URL handoff. The owned headless AVD and temporary emulator log are removed.
- `cargo ndk -t x86_64 -t arm64-v8a -P 28 -o
  clients/android/app/build/generated/jniLibs build --locked --release
  -p rstorrent-android --lib`: both ABIs build. Existing Android-only unused
  picker warnings in `rstorrent-platform` remain.
- `./gradlew assembleDebug` after the native rebuild: updated dual-ABI debug
  APK packages successfully. Documentation links and `git diff --check` pass.

No public form is submitted. The Compose regression injects preview and open
callbacks; the real native rules are covered separately by the Rust regression.
Generated types are unchanged. Production APK delivery remains unperformed.

Stopping condition met: native consent/omission rules and actual Compose
interaction pass, with clean lint and JVM checks. No website or application
is published. Other platform gates remain a separately scoped follow-up.
