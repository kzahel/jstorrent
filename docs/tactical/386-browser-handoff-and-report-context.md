# Browser handoff and report context

Status: website published; extension 1.1.7 submitted, pending Google review.
Topics: `client-surfaces`, `product-state-and-feedback`.

## Scope and stopping condition

Repair the deployed website/extension handoff, make legacy launch and add
pages preserve their input while explaining recovery, and include bounded
environment and connection context in extension feedback and uninstall
reports. Run a controlled, isolated ChromeOS download/interruption/restart/
removal regression. Update the private monitoring runbook with current Play
reporting and the evidence. Completion requires tests, platform evidence (or
an explicit unavailable prerequisite), cleanup, and reviewable commits.

## Invariants and limits

- Accept only exact first-party handoff URLs, top-level frames and the existing
  payload-free message. Keep both old `.html` and deployed extensionless
  spellings; do not broaden extension access to arbitrary websites.
- Legacy pages must not claim the extension is absent from a failed message,
  or report an unacknowledged torrent as added. Preserve magnet/file input for
  manual recovery. No new torrent intake API or native capability.
- Reports contain only allowlisted environment values, first-party entry
  locations and closed failure codes. No raw errors, arbitrary URLs, torrent
  identifiers, filenames, credentials or user agents. Honor statistics off;
  keep identifiers/counters behind their existing transmission gate.
- Do not change the strict durable metrics record. Browser-session diagnostic
  context is disposable and bounded; no database or preference migration.
- Physical tests own their package/profile, fixture bytes, seed and browser
  tabs. Never clear or modify the production library, change device networking,
  or use a public swarm. Bound attempts and remove owned artifacts.
- Product fixes stay here; private feedback and monitoring records stay in
  dotfiles. Publication is outside this slice.

## Existing evidence and references

Read `clients/extension/src/{service-worker,product-metrics}.js`,
`website/public/{chrome-extension.js,launch.html,add/index.js}`, the hosted
context parser and the TypeScript predecessor's metrics/reporting sources.
Reuse the existing companion failure taxonomy, preview and controlled
ChromeOS qualification machinery; this adds no new application policy.

On 2026-10-27 a physical ChromeOS/Chrome 150 test with installed production
extension 1.1.6 reproduced legacy launch offering installation. The current
handoff `.html` URL redirected to an extensionless path rejected by its own
exact-URL check and absent from the extension's external-message allowlist.
Six handoff unit tests passed despite the deployment failure.

## Validation

- Website and extension tests, including redirect normalization, old/new URL
  spellings, hostile senders, legacy recovery and opted-out report context.
- Web typecheck and tests; website check/build and extension packaging.
- Command-driven browser smoke using bundled Chromium and a local production
  redirect model; optional read-only live URL verification records final URLs.
- Machine Control doctor before physical work. Controlled isolated Android/
  extension download, source interruption, restart, byte verification, removal,
  restart and absence checks, with joined owners and verified cleanup.

## Execution

Implemented both exact handoff URL spellings through the page, manifest,
worker and validator. Legacy launch/add recovery retains the input, supports
the predecessor's `{ok: true}` and Chrome Apps' `{handled: true}` receipts,
and claims only acknowledged handoff. The predecessor paths consulted were
`extension/src/sw.ts` (launch-ping receipt) and `extension/src/lib/metrics.ts`
(uninstall registration). No predecessor source or fixture was copied.

Added one bounded disposable support observation, platform/UA-version lookup,
statistics-controlled feedback/uninstall context, popup review, companion
failure capture and live preference-change refresh. Host and extension
versions remain distinct. No durable schema or engine/application protocol
change; identifier/counter gates remain disabled. Public privacy copy and
hosted parser are updated with the new optional fields.

Evidence on 2026-10-27:

- 96 website tests/check/build; 70 extension tests/validation and packaging; web
  typecheck and 914 tests (three existing skips); localization check pass.
- Eight handoff tests cover the extensionless path, hostile authority and old
  acknowledgements. `verify-browser-report-handoff.mjs ... --live` verifies
  the live redirect destination and passes candidate real-redirect handoff,
  legacy recovery, actual worker report context and opt-out.
- Packaged ChromeOS onboarding runner passes six Android and ten Linux
  injected failure/recovery cases plus old HTML cache replacement.
- Android x86_64 Rust library rebuilt with cargo-ndk; fresh qualification APK
  assembled with JDK 17; 220 Android JVM tests pass. Existing unrelated
  platform dead-code warnings remain. No engine implementation changed.
- Physical ChromeOS/Chrome 150 passes source interruption/process restart
  with 180,224 seed bytes stable while paused, resumed 4 MiB completion and
  independent SHA-1 verification, normal remove/delete-data, absence after
  native restart, live beta-extension absence, and a second native restart
  plus reloaded extension worker/view. Pairing uses real Android approval; only the
  owned debug gateway preference is preconfigured. Installed production and
  inherited QA identities are preserved. Driver cleanup reports `ok`.
- Earlier attempts exposed stale `Download` versus `Download all` selection
  and an incorrect info-hash-as-catalog-ID assumption. The driver now accepts
  both labels and observes the durable torrent ID. Setup was also retried
  after first-use interaction failed; no such failure is counted as an engine
  regression. Existing 54 qualification and three recovery unit cases pass.

Private source details, source freshness, current Play report-count gating and
reproduction decisions are recorded in dotfiles' JSTorrent monitoring runbook.
At the implementation checkpoint no website deployment, extension release,
feedback reply or public issue was published. Subsequent authorized
publication is recorded below; a candidate smoke alone is not public evidence.

Portable validation commands run (physical selectors stay private):

```bash
source scripts/dev-env.sh
cargo fmt --all -- --check
npm run typecheck --prefix clients/web
npm test --prefix clients/web
npm test --prefix website
npm run check --prefix website
npm run build --prefix website
npm test --prefix clients/extension
npm run package --prefix clients/extension
node scripts/check-localization.mjs
node scripts/verify-browser-report-handoff.mjs target/extension/jstorrent-beta-0.4.0.zip --live
node scripts/verify-chromeos-onboarding.mjs target/extension/jstorrent-beta-0.4.0.zip
cargo ndk -t x86_64 -P 28 -o clients/android/app/build/generated/jniLibs build --locked --release -p rstorrent-android --lib
JAVA_HOME="$JDK17_HOME" clients/android/gradlew -p clients/android :app:assembleDebug -PchromeosQualificationTestPackage=org.jstorrent.feedback386
JAVA_HOME="$JDK17_HOME" clients/android/gradlew -p clients/android :app:testDebugUnitTest -PchromeosQualificationTestPackage=org.jstorrent.feedback386
uv run --project tests/interop --locked python -m unittest discover -s tests/interop -p test_chromeos_qualification.py
uv run --project tests/interop --locked python -m unittest discover -s tests/interop -p test_chromeos_android_recovery.py
```

The physical run used `chromeos_android_recovery.py --feedback-regression`
with Machine Control's common CLI after a passing doctor. Its minimized
[receipt](evidence/386-chromeos-feedback-regression.json) records case outcomes,
the tested artifact hashes and actual extension worker reload. It does not
retain private transport selectors or screenshots.

## Authorized publication, 2026-10-27

The maintainer requests publication of the qualified website and extension.
Release extension 1.1.7 through the existing tag-driven Web Store workflow;
its main push also deploys the website through the canonical Cloudflare lane.
Preserve the desktop download inventory and independent remote controller.
Record the exact tagged client capture and delivery, verify the hosted
compatibility/package/submission results, and independently verify deployed
website provenance and changed routes. Store submission with automatic
publication after Google review is distinct from public availability.

Extension 1.1.7 is tagged at
`0f1285502e9c4aba8a07e23e37278d82bc02c463`. The existing helper atomically
pushed main/tag and started
[extension release 40489172474](https://github.com/kzahel/jstorrent/actions/runs/40489172474).
Its exact-source package job passes. Independently downloaded CI ZIP and
build record match local clean-tag packaging, SHA-256
`beb4dc0ec3ca2e918239cba04f55d76d9d86b9777e1e85f8843bfaf897f372cc`.
The exact tagged client capture is retained. The local live matrix with the
current host and tagged client passes connection, folder selection, add,
download, independent payload verification, remove and data removal (53 s).

[Website run 40489172535](https://github.com/kzahel/jstorrent/actions/runs/40489172535)
publishes that same source. The public provenance receipt retains desktop
0.3.4 and confirms the new source SHA. All three changed public JavaScript
files match source bytes. The actual deployed-page smoke, using the exact
CI-built production-ID extension ZIP in disposable bundled Chromium, passes
redirected handoff, legacy input recovery, real-worker report context and
statistics opt-out. Third-party requests are blocked and no form is
submitted. The [public receipt](evidence/386-website-publication.json) retains
source/run/artifact identities. `--deployed` makes this verification reusable.

The complete extension workflow passes, including all 16 supported live
host/client pairs and the store submission. Google returns `submitted`,
`PENDING_REVIEW` for 1.1.7; both the independent authenticated store read and
public update check still identify 1.1.6 as published. Automatic publication
after review is enabled. The public
[GitHub release](https://github.com/kzahel/jstorrent/releases/tag/extension-v1.1.7)
retains the exact tested ZIP, checksum, build record and
[submission receipt](evidence/386-extension-submission.json).

The ledger appends 1.1.7 as submitted with no first-public date. Its captured
decoder accepts current frames with zero raw failures; existing delivery
records and the support window are unchanged. The first main CI source run
flags the tag's missing ledger entry before submission, as designed; the
following metadata commit records the now-acknowledged delivery and capture.
Its local validation passes web typecheck, 916 web tests (three existing
skips), the 17-delivery capture ledger and 15 handoff/ledger/window cases.
