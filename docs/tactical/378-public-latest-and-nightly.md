# Tactical 378: Public Latest and Nightly Publication

Status: Active, 2026-10-17.

Topics: `mixed-version-compatibility`, `product-surfaces-and-migration`,
`capability-readiness`, `beta-release-readiness`.

## Scope and authorization

The maintainer requests publication of Latest and a daily GitHub Actions job
when main has advanced. This follows disclosure that extension 1.1.4 and older
reject eight fields already on main. Latest may require tolerant extension
1.1.5 or newer for these exact reviewed fields. This is a Latest-only accepted
compatibility exception, not evidence of adoption or a Stable/Android waiver.

Publish the next ordinary public Latest version with production signing,
database metadata, corresponding sources and existing native validation.
Schedule the same publisher daily and retain manual dispatch. Select the exact
main head only after its full push CI succeeds; skip already-published source
and scheduled source not yet verified. Any commit counts, including docs.

## Invariants and non-goals

- Preserve the existing app identity, signing roots, user data and target
  automatic-install allowlist. No schema, engine, UI or server changes.
- Stable publication stays manual and separately authorized. Frozen RSTorrent
  incubation publication stays disabled.
- Latest's accepted break names exactly the current eight field paths and the
  tolerant extension version. New fields and unrequested new variants block.
  Stable promotion rechecks Stable policy and cannot inherit this exception.
- Use one numeric version train across public Stable and Latest. Ignore legacy
  releases with a different product asset set; never publish probe versions.
- Require exact successful main push CI, signed five-target packages, native
  signature validation, authenticated database facts and complete public
  sources. Keep drafts private until all collector checks pass.
- Existing workflow concurrency owns serialization/cancellation; no new
  persistent task. Selector API pagination is finite and bounded; source and
  ancestry checks fail closed. No credentials or private VM identities in docs.

## Validation and stopping condition

Test unchanged source, new source, pending/failed/wrong-source CI, legacy
identity filtering, divergent source and numeric allocation. Prove the Latest
exception does not cover Stable, Android, a new field or an unknown variant.
Lint workflows and run existing release/contract checks. Require green main
CI before dispatch; monitor signed publication to completion. Verify public
release assets/signatures/metadata and actual update service Latest discovery,
while all ordinary Stable responses stay unchanged. Record release, source,
workflow and checks. Stop after publication and scheduled workflow activation;
do not infer fresh installed acceptance beyond Tactical 377's recorded tests.

## Source validation

The selector uses the exact workflow main SHA and its newest matching full
push CI run, a bounded 10,000-release inventory, production-product asset
filtering, numeric shared allocation and previous-Latest ancestry. It skips
unchanged source without a force override. Schedule is 03:17 UTC daily;
GitHub may delay scheduled execution. Manual unverified source fails closed.

The existing publisher had labeled its compatibility check as Stable even for
Latest. Both compatibility and capture-ledger checks now receive the resolved
release tag. The new exception names only the eight current fields and exact
tolerant extension baseline; per-release exceptions remain available.
Release notes and updater notes disclose the extension requirement.

Local validation: 50 release/selector/compatibility/promotion/metadata tests
pass; workflow lint passes for Latest, publisher and full CI; database source
metadata and delivery-ledger checks pass; web typecheck passes and 863 web
tests pass with three pre-existing skips. No Rust runtime or schema changes.
Next: commit/push, wait for exact-source full CI, dispatch the Latest publisher
and verify public offers without changing Stable.
