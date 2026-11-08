# 392 — PlaysVideo product release

Status: **In progress (November 8, 2026).** The maintainer asked to "release
everything" with the Tactical 391 PlaysVideo download manifests.

## Scope and stopping condition

Publish, through the existing lanes and runbooks
([releasing](../development/releasing.md),
[Android](../android-release.md),
[mixed-version runbook](../topics/mixed-version-compatibility.md#release-runbook)):

- desktop 0.3.9 through the signed Latest pipeline, then an unchanged-byte
  Stable promotion and the canonical website promotion;
- Android 1.0.37/code 37 through tag construction, internal Play, then a
  staged production rollout with the standard plan;
- extension 1.1.10 to the existing Chrome Web Store item (native-host setup
  diagnostics from `d967b299`).

The remote controller is not released: since `remote-v0.3.5` its served web
sources are unchanged (only the Android companion entry point and release
metadata moved). The website already deployed the matching hosted-form parser
on November 3.

Stopping condition: Latest and Stable desktop 0.3.9 public with verified
assets, updater offers and website downloads; Android 1.0.37 accepted on
internal and submitted to production as a staged rollout; extension 1.1.10
submitted with automatic publication after review. Store review and staged
availability are recorded separately from full public delivery.

## Decisions

- **No new companion exposure.** Tactical 391's setting was removed before
  release, so the host contract is unchanged from desktop 0.3.6/Android
  1.0.35. `desktop-v0.3.9` and `android-v1.0.37` carry forward the existing
  acceptance for the same eight reviewed fields; browser control still
  requires extension 1.1.5 or newer.
- **No schema change.** `session.db` stays at 29.
- Preserve signing roots, app IDs, user data, store countries, permissions
  and rollout plans. Required environment approvals remain explicit gates.

## Known gaps carried into the release

- Tactical 391's API 35 SAF instrumentation and physical cross-device
  PlaysVideo checks have not run. The internal Play device check covers the
  Android update path before production.
- The crypto-bigint advisory exception expires November 12; publication runs
  before then.

## Evidence

- Extension 1.1.10 tagged at `69c70860`; Android 1.0.36 tagged at
  `623ae711` immediately after.
- **Android 1.0.36 withdrawn before signing.** Its tag build (Actions
  42473509464) stopped at the delivery-ledger gate: the tag source did not
  yet record the just-pushed `extension-v1.1.10`. The gate behaved as
  designed; the tags were pushed before the extension's ledger entry. Per
  the Tactical 389 precedent the tag is retained, not moved, and recorded
  as withdrawn. Android 1.0.37/code 37 ships the same app source after the
  ledger commit. Lesson: capture and record one production tag before
  pushing the next.
- Extension 1.1.10: tagged workflow 42473497821 passes package checks and
  the live compatibility matrix and submits ZIP SHA-256
  `15050d78e6e4e706ad0d120e5ddd88692865700448f805199bfd1c0d1cd67193`;
  Chrome reports PENDING_REVIEW with 1.1.9 published. Exact client capture
  and the withdrawn 1.0.36 host capture are recorded in the ledger.
- Main CI at `623ae711` also hit two download flakes (Gradle wrapper
  timeout, Windows bundler HTTP 504) besides the expected ledger failure.
