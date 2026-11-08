# 392 — PlaysVideo product release

Status: **Desktop and extension delivered; Android production awaiting maintainer environment approval (November 8, 2026).** The maintainer asked to "release
everything" with the Tactical 391 PlaysVideo download manifests.

## Scope and stopping condition

Publish, through the existing lanes and runbooks
([releasing](../development/releasing.md),
[Android](../android-release.md),
[mixed-version runbook](../topics/mixed-version-compatibility.md#release-runbook)):

- desktop 0.3.10 through the signed Latest pipeline, then an unchanged-byte
  Stable promotion and the canonical website promotion;
- Android 1.0.37/code 37 through tag construction, internal Play, then a
  staged production rollout with the standard plan;
- extension 1.1.10 to the existing Chrome Web Store item (native-host setup
  diagnostics from `d967b299`).

The remote controller is not released: since `remote-v0.3.5` its served web
sources are unchanged (only the Android companion entry point and release
metadata moved). The website already deployed the matching hosted-form parser
on November 3.

Stopping condition: Latest and Stable desktop 0.3.10 public with verified
assets, updater offers and website downloads; Android 1.0.37 accepted on
internal and submitted to production as a staged rollout; extension 1.1.10
submitted with automatic publication after review. Store review and staged
availability are recorded separately from full public delivery.

## Decisions

- **No new companion exposure.** Tactical 391's setting was removed before
  release, so the host contract is unchanged from desktop 0.3.6/Android
  1.0.35. `desktop-v0.3.10` and `android-v1.0.37` carry forward the existing
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
- Full CI at `98f12748` passed after re-running failed jobs. The first
  attempt hit Gradle and AppImage-notice download timeouts and the
  timing-sensitive engine test
  `storage_pressure_cannot_starve_dht_intake_or_dial_refill` (2 s wait for
  backpressure; it also failed once in Fast CI and passes 10/10 locally).
  The sidecar's engine changes do not touch that path. Hardening the test
  is a follow-up.
- Android 1.0.37 tag build 42476812128 passes; Play internal publication
  42483458332 accepts code 37, bundle SHA-256
  `9574d39e8acd782d13ef1e713dbfc7708796d07eb0bc9fcba99678743b22f148`.
- **Desktop 0.3.9 stopped at the corresponding-source gate.** Latest run
  42483460355 signed all five targets into private draft 438280357, then the
  collector reported unreviewed Ubuntu `libsoup3 3.4.4-5ubuntu0.10`. Comparing
  the native notice manifests of both 0.3.9 and public 0.3.8 AppImages shows
  that it is the only new pair (replacing `0.9`) on both architectures. The
  reviewed pin is added; the 0.3.9 draft stays private and reserved, and the
  rebuilt source publishes as 0.3.10.
- Full CI 42487644642 passes at `1a49f4ab`. Latest workflow 42492203367
  publishes desktop Latest 0.3.10 at 15:50:58 UTC from that exact source
  with 17 assets, including the completed AppImage source carrier. The
  public checksum inventory, updater manifest (all eleven platform keys at
  0.3.10) and an uncredentialed macOS arm64 DMG download verify.
- Stable promotion 42497004134 publishes `desktop-v0.3.10` at 15:55:44 UTC.
  Its checksum inventory matches Latest for every native and source asset;
  only the URL-bound updater manifest differs, serving 0.3.10.
- Website promotion 42497307551 and deployment 42497403399 serve the 0.3.10
  downloads on jstorrent.com. The generated placeholder release note is
  replaced with the changelog text.
- Android production staged rollout (1%, `standard-7d`) is dispatched as
  42491366778 at the maintainer's request without the optional physical
  internal-track check; it waits on the `android-play-production`
  environment approval.

