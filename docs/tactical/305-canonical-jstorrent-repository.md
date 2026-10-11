# 305 — Canonical JSTorrent repository

Status: Complete, 2026-10-11. Windows hosted session-test limitation recorded below.

## Outcome and scope

Rename the previous TypeScript implementation to `kzahel/jstorrent-typescript`
and this Rust implementation to `kzahel/jstorrent`, preserving production
updates, qualified release inventory and bounded installed-client links. The
original `jstorrent-legacy-app` repository remains unchanged. Maintainer
authorizes the coordinated rename, implementation commits and deployment.

Private provider identities, host configuration, deployment and live receipts
remain in dotfiles. Reports and captures remain under its ignored `tmp/` path.

## Dependencies and references

Tacticals 299/303 own the production website and canonical remote origin; 302
owns native external links. Concurrent 304 CI/review changes remain separate.
The release metadata, original TypeScript installed-client search-plugin URL,
hosted AltStore feed and actual production updater configuration were audited
read-only before implementation. GitHub repository-rename documentation owns
redirect behavior: recycling a former slug removes that repository redirect.
GitHub OIDC and Tailscale workload-identity documentation own exact trust claims.

## Invariants and bounds

- TypeScript is renamed first; known clone origins are retargeted before its
  former name is reused. Leave `rstorrent` vacant for redirect continuity.
- Preserve repository IDs, published assets/digests/signatures/source commits,
  application IDs, updater public keys, route IDs and existing update endpoints.
- Only the exact old Rust slug and canonical slug are recognized as release
  aliases. A rename cannot excuse changed payloads or source/trust identity.
- Preserve version-1 signed headless/Crostini manifest repository identity;
  canonical transport URLs do not rewrite immutable signed metadata.
- Retain one bounded, self-contained MIT search-plugin compatibility file with
  attribution. Do not import the TypeScript engine or rebuild legacy apps.
- Review remains disabled until exact new provider claims are qualified; do
  not widen scope/tag/host restrictions or commit private provider values.
- Preserve unrelated working changes and commit only this tactical's changes.

## Non-goals

No historical issue migration, bulk release copying, store submissions, new
signed app version, DNS/mail cutover, local directory/crate/service renaming,
new iOS development or expanded Linux support. The obsolete root Linux
installer becomes explicit current-download guidance.

## Implementation and validation

Prepare alias-aware website promotion and tests, canonical product/support and
update-server links, scoped native URL permissions, legacy hosted asset links
and search plugin. Commit source fixes, rename in the prescribed order, update
known remotes, deploy updater/website and reconcile dashboard/private docs.

Run website inventory/security/transaction tests and builds, web typecheck/unit
tests/build, focused release/manifest and workflow checks, and current Rust
build checks proportionate to link-only changes. Verify exact live repo IDs,
retained settings, former-Rust redirects, old/current desktop updater responses,
legacy asset/plugin URLs, canonical website receipt and remote security. Record
actual checks and remaining limits below; do not imply application rebuilding
or installed platform tests occurred solely from HTTP verification.

## Stopping condition

Canonical names are live, source/remotes and update routes are reconciled,
qualified existing downloads and future promotion checks pass, compatibility
links work, and scoped automation either passes new-identity qualification or
is explicitly disabled with a documented next action. No owned VM/browser
process remains running.

## Evidence

Implementation and live cutover are complete. Hosted builds and tests qualify
the renamed source with the Windows session-test limitation recorded below;
this completion does not assert an entirely green hosted matrix.

- Rust commits d2caeb16, 726664e6 and c0bb7e3e are pushed to the canonical
  repository.
  Previous TypeScript README 211fd65b and original Chrome App README 27e353b
  are pushed. No legacy application rebuild or historical asset copy occurred.
- Repository IDs, asset IDs/names/sizes across all 16 Rust/81 TypeScript
  release records, settings counts, rulesets and Pages domains are retained.
- Local website 57 cases/check/build, web typecheck/492 cases/build/CSP,
  release/manifest/reviewer/assembly guards and workflow lint pass. Rust
  workspace check/fmt/clippy and gateway 49 library/3 CLI cases pass.
- Hosted Website 38142105006 passes at 726664e6. Exact canonical receipt,
  six-file remote/hash/header verification and 32 real browser views plus
  no-JavaScript downloads pass. The first source d2caeb16 hosted website run
  fails a missing TypeScript narrowing guard; 726664e6 repairs it.
- Hosted promotion 38142169149 is a successful idempotent 0.3.0 no-op.
  All five production updater platform signatures match immutable latest.json;
  their downloads and six primary/source website downloads return HTTP 200.
  Current desktop gets 204; preview still offers 0.1.4.
- Canonical and former Crostini manifest/signature bytes are identical;
  original Minisign data and comment verification pass. Headless/Crostini
  Linux x86_64 installer integrity fixtures pass with canonical transport and
  signed former identity. Initial ARM-host fixture run fails its existing x64
  bundle shape; no ARM installed-product qualification is inferred.
- Hosted OIDC/gateway-only canary 38142167021 passes with inference, containers
  and publication skipped. Existing PR review IDs are unchanged and its
  ephemeral peer is absent afterward. Automatic review remains false.
- Public AltStore asset, installed-client plugin and former Rust desktop asset
  URLs return 200. Production update endpoints, keys, DNS/mail and relay state
  remain unchanged. Control Room live canonical metadata is verified; its
  unrelated dirty checkout is preserved through a bounded config-only apply.
- Browser trust before/after and 32 website captures are retained only in the
  ignored private report directory. Owned browser tabs and capture processes
  are closed; no VM was started.
- Final Website 38142801280 deploys c0bb7e3e; exact source receipt and six-file
  remote verification pass. The existing Mac preview push hook builds,
  deploys and verifies that exact source in 296 seconds. No new application
  release or store submission is inferred from the preview deployment.
- CI 38142801602 at exact c0bb7e3e finishes its first attempt with nine
  successful jobs: Rust workspace/lifecycle/interop, web/E2E, extension,
  release tools, Android dual-ABI/lint/owned SAF runtime, macOS ARM64, both
  Linux architectures and the existing iOS job. The two dispatch-only jobs
  are skipped as expected.
- Windows compiles and passes desktop native tests, then fails four existing
  session networking cases (377 pass, two ignored). The log records socket
  permission-denied/address-in-use errors; these session paths are unchanged
  by the rename commits. A Windows-only fresh-runner retry passes desktop
  tests again but is canceled during session verification by a separate
  documentation-only main push. Neither that retry nor Windows packaging is
  claimed as qualified. CI 38147300793 owns the subsequent main result.
  Follow-up: investigate Windows test-port allocation/coordination if the
  fresh main run repeats this failure; retain the failed log as evidence.
- Separate main commits 49b3aea6, 7217d036 and 7e3df6ec update instructions,
  README and the JSTorrent-only release policy without changing product or
  workflow source. Completion bookkeeping changes only this tactical and
  deliberately does not start another identical platform matrix.
