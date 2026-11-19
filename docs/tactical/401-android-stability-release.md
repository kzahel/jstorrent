# 401 — Android stability release

Status: preparing Android 1.0.41/code 41. The maintainer authorized a 100%
production release on November 19, 2026.

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
