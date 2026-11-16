# 396 — ChromeOS magnet Play release

Status: production rollout completed to 100% on explicit maintainer direction,
2026-11-16, after the initial 1% submission. Google review and first public
availability remain unconfirmed. Maintainer authorized commit, Play publication
and subsequent full rollout on 2026-11-16.

## Scope and invariants

Release the Chromebook browser magnet-intake fix through the existing
`com.jstorrent.app` signing and Play tracks. Base the delivery on upstream
main, carrying only the magnet fix from the working checkout; preserve its
unrelated unpushed remote-browser recovery work. Upstream includes the qualified
dependency maintenance in Tactical 395.

Keep all existing app data, signing identities and independently updated
companion support. No extension, website, desktop or remote-controller release,
new dependency exception, or authentication change is authorized here.

Use the normal tagged signed build, exact-source CI and compatibility capture.
Publish the verified bundle to internal, check its actual Play-installed
upgrade and browser handoff on the explicitly selected Chromebook Pixel, then
promote that same bundle to production under the standard seven-day plan,
starting at one percent. Existing authorization covers the production
environment approval; no protection rule is changed.

Subsequent explicit direction to make this release 100% supersedes the remaining
standard-plan steps for 1.0.40 only. Future releases retain the normal policy.

## Validation and stopping condition

The source fix's evidence is in
[Android replacement readiness](../topics/android-jstorrent-replacement.md#chromeos-browser-magnet-handoff-2026-11-16):
228 JVM tests, Android lint/build, four physical activity/resolution tests,
actual browser cold/warm/folder/duplicate adds, and an independently hashed
32 KiB controlled download. The development package and all owned artifacts
were removed; the Play-installed package and its data remain.

Run release-tool tests, web/contract tests and the enforced release and
compatibility-ledger guards. Require successful hosted signed construction and
full CI on the tag source or its compatibility-only capture descendant.
Verify receipt, AAB digest and version identity before Play authentication.
Exercise the internal Play upgrade before production promotion.

Stop when Play has accepted production submission and exact receipts and
deployment records are committed. Distinguish submission, Google review and
public availability. Record an external blocker precisely if a required
platform or store stage cannot complete.

## Evidence

- The fix is cherry-picked onto upstream main as `97d85584`. Android and Rust
  runtime inputs match the physically tested working source; the unrelated
  unpushed change affects only the web remote controller and its tests/docs.
- Production 1.0.39 was completed on November 10 (deployment 7675661134).
  The November 15 Play Advance read-back confirms code 39 is completed.
  The Pixel still had the older Play-installed 1.0.35 at reproduction time.
- [Signed build 43921414100](https://github.com/kzahel/jstorrent/actions/runs/43921414100)
  publishes the APK, AAB, R8 mapping and receipt for tagged source
  `23f39803644d35b2c48b41e3b64df97e2ad48bde`. Downloaded asset hashes and
  candidate provenance pass; APK certificate SHA-256 matches the established
  `ccb5af8e…0044915` upload certificate.
- Full [CI 43921854455](https://github.com/kzahel/jstorrent/actions/runs/43921854455)
  passes on compatibility-only descendant `b0137e78`. All non-iOS jobs pass
  first attempt. GitHub could not allocate the initial macOS 26 runner; the
  iOS-only second attempt passes simulator tests, storage probe and archive.
  Fast CI 43921854439, live compatibility 43921414158 and fresh dependency
  review 43921756320 also pass. No release gate or dependency exception changes.
- [Internal publication 43937828544](https://github.com/kzahel/jstorrent/actions/runs/43937828544)
  uploads code 40, AAB SHA-256
  `3fd4311ecb8b7de16d09da314c4c9442225498a89b0574bdbed681003b77d1bb`,
  replacing internal code 39; deployment 7833954584 records acceptance.
- On the Pixel, Play shows the new release notes and updates the existing
  1.0.35 installation to 1.0.40. Installer remains `com.android.vending`;
  UID and original installation timestamp are unchanged. With the extension
  disabled, an actual browser magnet click starts the previously stopped app
  and opens Add torrent with its original download folder. After cancellation,
  a second browser link opens the same confirmation in the same process.
  Both test intakes are cancelled. The original empty library remains empty;
  this is not a populated-library migration or a Play payload-download claim.
  All owned tabs, fixture files/server and UI XML are removed, the extension
  is restored to its original enabled state, and ADB is disconnected.
- [Production publication 43939120370](https://github.com/kzahel/jstorrent/actions/runs/43939120370)
  passes the protected environment approval under the maintainer's publishing
  authorization and promotes the same held bundle (`uploaded=false`), at
  1% on `standard-7d`, with previous production code 39. Deployment 7834147160
  records API acceptance at 19:27:35 UTC. Receipt status is `submitted`,
  release status `inProgress`; no Google review or public serving result is
  inferred. The Pixel's testing account has no developer Console access, so
  optional Console read-back stops without account creation or switching.
- The [publication receipt](evidence/396-android-play-receipt.json) binds
  source, build, CI, bundle digest, both track submissions and managed-device
  evidence. The original working checkout and its unpublished web recovery
  work are preserved; delivery uses an isolated upstream-based checkout.
- [Rollout completion 43941424635](https://github.com/kzahel/jstorrent/actions/runs/43941424635)
  follows the maintainer's explicit request for 100%. Play accepts the change
  from `inProgress` / 0.01 to `completed` / no staged fraction. Deployment
  7834404802 records it at 19:38:55 UTC. Source, version code, bundle and
  signing identity are unchanged; Google review/public availability are
  still not inferred from API acceptance.
