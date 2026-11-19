# 401 — Android stability release

Play accepted Android 1.0.41/code 41 for a 100% production release on
November 19, 2026, as authorized by the maintainer. Play Console shows the
release in review with automatic publication enabled.

## Scope and release checks

Ship the startup, quota shutdown, locale resource and predictive Back fixes
from Tactical 399 and Tactical 400. Keep the existing package, original
upload certificate, Play signing identity, data, contract and tester
audience. The 100% decision applies to this version. Desktop, extension,
website and remote controller publication are outside scope.

Require exact tagged signed construction, the compatibility capture, main
CI, fresh dependency review and internal Play delivery. Confirm the upgrade
on a managed physical device with the existing install, then promote the
same AAB to production with `completed` status. Record signed artifact
hashes and deployment receipts. Check Google review and public serving
separately from acceptance of the production edit.

The November 19 advisory workflow reports that the warning inventory
changed. Review the newly reported `chrono` maintenance advisory against the
locked dependency graph before tagging. Retain the existing warning expiry,
vulnerability exception and release guards.

[RustSec RUSTSEC-2026-0543](https://rustsec.org/advisories/RUSTSEC-2026-0543.html)
reports that `chrono` is unmaintained and discloses no vulnerability.
`Cargo.lock` retains it through optional `serde_with` 3.21.0 integration.
The locked `cargo tree --workspace --all-features --target all -i chrono`
has no reverse edges, and the Android aarch64 `rstorrent-android` tree
does not resolve it. The exact warning is reviewed under the existing
February 14, 2027 deadline. Dependency resolution and the vulnerability
exception stay unchanged.

## Release evidence

- [Signed Android build](https://github.com/kzahel/jstorrent/actions/runs/44615634237)
  validates release lint, both ABIs, 16 KiB alignment, the original upload
  certificate and package identity at source `f51154fb`. Downloaded APK, AAB,
  R8 mapping and build receipt match the published checksums.
- [Full main CI](https://github.com/kzahel/jstorrent/actions/runs/44615855018)
  passes at compatibility-only descendant `535cf67d`, including the API 35
  storage lifecycle run. The
  [live compatibility matrix](https://github.com/kzahel/jstorrent/actions/runs/44615634189)
  and [fresh strict audit](https://github.com/kzahel/jstorrent/actions/runs/44615919241)
  pass. The audit has zero unexcepted Cargo, web or website vulnerabilities.
- The [internal upload](https://github.com/kzahel/jstorrent/actions/runs/44627408603)
  replaces code 40 with code 41, deployment 7927407062. Play installs the
  update on a physical Chromebook Pixel and preserves package UID and first
  installation time. The Play signing certificate matches. The installed
  launcher reaches ready, and two Android VIEW magnet confirmations show
  configured storage. Both fixtures are cancelled. This confirms an in-place
  upgrade over the existing install and the configured folder UI. The API 35
  instrumentation in Tacticals 399 and 400 exercises the crash paths.
- The [production publish](https://github.com/kzahel/jstorrent/actions/runs/44627928607)
  promotes the identical internally tested AAB with `completed` status for
  100% of eligible users. Play accepts the edit at 22:23:07 UTC, recorded in
  deployment 7927469122. The
  [publication receipt](evidence/401-android-play-receipt.json) records the
  exact digest and both track submissions.
