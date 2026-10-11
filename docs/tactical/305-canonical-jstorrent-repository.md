# 305 — Canonical JSTorrent repository

Status: Active, 2026-10-11.

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

Implementation and live acceptance in progress.
