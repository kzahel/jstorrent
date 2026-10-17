# Tactical 379: Release Security Dependency Repair

Status: Active, 2026-10-17. Dependency gate blocks public Latest in 378.

Topics: `beta-release-readiness`, `client-persistence`,
`product-surfaces-and-migration`.

## Scope and stopping condition

Latest publication run 39043432128 stops before native builds because fresh
RustSec revision cc76a4d599f5e87373a903873b2377219266b431 reports seven
vulnerabilities in two existing dependencies. Repair the dependency graph,
preserve release and user-data contracts, qualify it and resume authorized
Latest publication. Do not waive the zero-vulnerability gate.

Upgrade rustls 0.23.45 to patched 0.23.46, and the torrent-list ZIP reader/writer
from 4.6.1 to 9.0.4 with the same minimal compression features. Disable the
updater's optional ZIP feature while retaining exactly tauri-plugin-updater
2.10.1, its signing, installer/relaunch code and native TLS. Shipped Windows
updates are raw NSIS/MSI, Linux uses raw AppImages, and macOS tar.gz support
is unconditional. ZIP-wrapped Windows or gzipped Linux updates are not offered.

No new protocol, schema, bundle-format version, updater implementation or
dependency fork. Keep existing immutable store fingerprints and application
identity. Keep advisory and license gates. Any newly reported informational
warning needs an explicit source/feature review under the existing expiry.

## Source study

- RustSec RUSTSEC-2026-0346 through 0349 require rustls >=0.23.46:
  client-session Debug redaction, ECH rejection ordering, Brotli allocation
  bounds, and saving key-exchange hints only after authenticated handshake.
  Upstream fixes: rustls/rustls pull requests 3299, 3300, 3297 and 3355.
- ZIP RUSTSEC-2026-0367 through 0369 require zip >=9: privileged mode bits,
  symlink targets and permission changes through symlinks during extraction.
  The shared torrent-list importer never extracts: it reads bounded entries
  into memory and rejects symlinks, unknown paths and unsupported compression.
  Preserve that behavior and version-1 bundle compatibility.
- Exact registry source tauri-plugin-updater-2.10.1/src/updater.rs:
  `extract`/`extract_exe` preserve raw Windows handling; `extract_zip` is behind
  feature `zip`; `install_appimage` has only its gzip branch behind `zip`;
  the raw write/restore path is independent. macOS `install_inner` has no ZIP
  feature guard. Do not upgrade the already-qualified platform implementation.
- zip 9 registry metadata retains MIT, Rust 1.88 minimum and
  `deflate-flate2`. Inspect its reader/writer API against torrent_list.rs and
  retain existing malformed/duplicate/path/symlink/budget/round-trip tests.

These are existing third-party dependencies, not copied sources or a new
engine feature. Existing owners, task lifetimes, bounds and dependency
directions do not change. Cargo.lock and generated notices/source collection
own exact crate provenance for every shipping platform, including Android.

## Validation

Require zero fresh Cargo/web/website vulnerabilities under the unchanged review
policy. Check the resolved all-target graph contains no zip 4.6.1. Run bundle,
TLS and desktop regressions, formatting and workspace Clippy/tests, and full
cross-platform CI including Android/iOS. Retain released bundle compatibility
and store admission evidence. Require the normal signed five-target release
and public feed/asset verification before completing 378. No new installed
acceptance beyond 377 is inferred from a build; document the precise retained
raw-installer paths and any observed failures.

## Dependency and warning evidence

The resolved all-target graph contains only ZIP 9.0.4, owned by the session
bundle reader; the updater's ZIP 4 dependency is gone. ZIP 9 filename decoding
is fallible, so malformed names now map into the existing bounded ZIP error.
The immutable ZIP-4-produced version-1 fixture passes with ZIP 9; an independent
temporary producer also proves ZIP 4 reads ZIP 9 Stored output. Eight bundle,
released-catalog export and fresh-profile round-trip tests pass.

Fresh Cargo, web npm and website npm vulnerability counts are all zero. The
warning inventory gained fxhash maintenance status and conditional rand 0.7.3
logger reentrancy, plus the zbus 6 reorganization notices for zvariant,
zbus_names and zvariant_derive at advisory revision
e6e9dd63d3a520c35a3b4695f612018d78f61b72. Exact all-target reverse trees retain
Tauri's selectors/kuchikiki graph and the current zbus 5.19 desktop integrations.
No disclosed vulnerability is waived. Framework migration is a bounded
maintenance deferral; the existing November 12 expiry is unchanged.

The all-workspace-feature inventory proves rand 0.7.3 has no `log` feature.
The audit producer records that evidence and the reviewer rejects missing
proof or future logger activation. Thirty distribution-review tests include
that guard; existing new/removed-warning failures remain. Release CI now
retains a bounded dependency report on success or failure without raw reports.
Workspace Clippy passes; full workspace and native qualification continue.

The strict review now passes at the current advisory revision with zero
vulnerabilities in all three reports. Five warning additions have explicit
reasons and retain the original expiry. The package graph and bounded local
receipt are in [379 evidence](evidence/379-security-dependencies.json).
Workspace Clippy, eight bundle/export/import cases and thirty distribution
review tests pass before commit. Complete workspace tests continue locally;
full hosted native qualification and signed publication remain required.
