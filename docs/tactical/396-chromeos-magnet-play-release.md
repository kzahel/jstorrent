# 396 — ChromeOS magnet Play release

Status: preparing Android 1.0.40/code 40. Maintainer authorized commit and Play
publication on 2026-11-16.

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
