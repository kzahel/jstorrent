# Tactical 320: Android-Owned ChromeOS Extension Setup

Status: **Active, 2026-10-12.** Maintainer authorizes the plan, end-to-end
implementation, incremental local commits, and verification on both physical
Chromebooks. Public website/store publication and Git pushes are separate.

## Outcome And Stopping Condition

Make cancellation recoverable from the same setup screen. The extension opens
the production Android app through a directly clicked, package-targeted
JSTorrent link; Android owns companion enablement and can return to the Chrome
library through a narrowly admitted `https://jstorrent.com/chrome-extension.html`
handoff. A manually opened Android app has the same setup action. Saved pairing
reconnects without launching Android. Retain the old RSTorrent scheme only as
incoming compatibility.

Stop after reviewed source, deterministic failure/security tests, packaged
extension and Android build checks, two-device physical candidate evidence,
updated owning topics, and local commits. Candidate website interception may
qualify the exact HTTPS handoff without publishing it; record that distinction
and any installed-package signing constraint rather than claim live deployment.

## Scope And Non-Goals

- Replace worker-driven Android launch/tab switching with a direct production
  link and explicit attach-only connection controls.
- Add Android-owned setup, ChromeOS-only manual entry, and a static website
  return page with bounded extension messaging and honest missing/offline help.
- Preserve the one Android engine/profile, ARC listener, Android approval,
  optional browser permission, bearer transport, and backend identity checks.
- No engine/protocol/storage semantics, application DTOs, alternate transport,
  library migration, dependency, remote control, public analytics, credential
  URL, OS update/reboot, app-data clear, signing-root change, or release.

## Dependencies And Sources Read

Owning topics: product-surfaces-and-migration, client-surfaces, web-ui-design,
application-view-api, application-connection-architecture, localization,
client-persistence, and capability-readiness. Retain 194's local security and
lifecycle contract and 253's bounded recovery/physical qualification rules.
299 and website-security.mjs own website packaging/security. Machine Control's
ChromeOS skill and common doctor own generic device operation.

Chrome documentation inspected before design:

- [Intent URLs](https://developer.chrome.com/docs/android/intents): explicit
  package, browsable activity, user activation and fallback. ChromeOS behavior
  is independently qualified on hardware rather than inferred from Android.
- [External messaging](https://developer.chrome.com/docs/extensions/reference/manifest/externally-connectable):
  website allowlist plus independent exact sender validation.
- [Permissions](https://developer.chrome.com/docs/extensions/reference/api/permissions#method-request):
  optional access is requested only from an explicit extension user action.
- [Tabs](https://developer.chrome.com/docs/extensions/reference/api/tabs):
  owned-tab enumeration/focus without broad browsing permissions.

No reference source or fixtures are imported. No engine capability changes;
the engine-feature libtorrent audit is inapplicable to this presentation slice.

## Observed Failure And Baseline

On physical cohort A, Chrome 150.0.7871.256, extension 1.1.3 and production
Android 1.0.29: ARC host permission existed, saved pairing did not, all five
companion ports were unreachable, and the running Android app had no listener.
Three installed packages claimed the old custom scheme. Popup Connect returned
Launch requested but did not show a chooser. Retry was deliberately attach-only.
A directly clicked package-targeted old-scheme link reopened the chooser with
only production JSTorrent, enabled port 3030, and approval/reload then succeeded.
The exact ChromeOS suppression mechanism remains unproven; eliminate the
observed tab-switching sequence instead of claiming a permanent denied state.

Cohort B is reachable/unlocked on its current boot but has a pending OS update
and degraded SSH boot evidence. No OS repair/reboot is part of this work.
Inherited Android duplicate-add edits overlap some files and must remain outside
this tactical's commits. Other concurrent committed work is not reverted.

## Owners, Cancellation, And Dependency Direction

- Popup: permission and owned extension-page handoff only; no Android launch.
- Packaged connection page: direct user-click launch link, one bounded attach
  attempt, manual cancel/retry/permission action, one mounted view, and joined
  cleanup. Repeated handoffs focus/retry the same owned page, never duplicate a
  live connection or resurrect the Android service.
- Android Activity/Compose: local setup presentation and explicit ChromeOS
  opt-in. Service owns existing listener/pairing jobs and their shutdown.
  Browser navigation follows listener readiness; failure leaves manual retry.
- Static website page: one bounded message attempt plus explicit retry/store
  and manual-return help; departure releases timers. No network API access or
  authority is accepted from website content.
- Worker: admits only exact HTTPS origin/path, top-level sender tab, closed
  message keys/version, and focus/open intent; serializes concurrent handoffs.

Platform presentation depends on existing service operations. No domain or
protocol component depends on the website, browser, or Compose.

## Invariants And Bounds

- Production launch targets `com.jstorrent.app`; debug apps cannot compete.
- New outward links use `jstorrent`; legacy `rstorrent` remains accepted input.
- Cancel does not persist success, disable launch, or remove recovery controls.
- The URL/message contains no token, nonce, profile, path, torrent, endpoint or
  credential. Website messaging only opens/attaches UI; Android still approves.
- Sender validation rejects wrong host/path/scheme/port, credentials, extra
  query/fragment, subframes, missing tab, wrong message version and extra keys.
- Native pairing keeps its existing bounded approval/resource rules. Page
  discovery remains 20 seconds and whole attempt 150 seconds; website messaging
  has a five-second deadline and no automatic retry loop.
- Existing paired connections are focused without reload or duplicate pairing.
- Website handoff failure/offline keeps Android usable and manual extension
  return documented. No public availability inferred from candidate tests.

## Commit And Validation Sequence

1. Commit this bounded plan.
2. Implement direct production launch, recoverable permission/attach controls,
   JSTorrent scheme compatibility and Android setup; run focused web/extension
   and Android checks and commit the source slice.
3. Implement exact website handoff/security tests and package validation; run
   full web typecheck/tests, localization, extension tests/package and website
   tests/build; commit the integrated flow.
4. Build installable candidates, verify installed signatures before replacement,
   and execute on both explicitly selected Machine Control targets. Preserve
   inherited packages, roots and library. Qualify chooser cancellation/retry,
   debug coexistence, manually opened Android setup, permission denial/retry,
   rejection/expired approval recovery, saved reconnect and app restart, exact
   HTTPS candidate return, singleton behavior and offline/manual return. Record
   actual passes/failures and injection/signing limits; remove owned artifacts.
5. Reconcile owning topics/readiness and commit evidence. Report exact commits,
   checks, two-device results, and any remaining publication qualification.

## Execution Checkpoint

Direct production launch and Android-owned setup are implemented. The worker
only focuses/opens an attach page; a targeted runtime notification can retry an
idle page without duplicating a live owner. The connection page retains its
launch anchor after cancel/failure and offers explicit permission recovery.
Android accepts the new scheme and old compatibility input, exposes ChromeOS
setup in Settings, and waits for listener readiness before browser navigation.

Validation so far: web typecheck; 24 focused connection/recovery tests; 57
extension tests and source validation; localization; Android compileDebugKotlin
and testDebugUnitTest. Existing Android deprecation warnings remain. Full
packaged, website and physical evidence follows in the next slices.

Next executable action: implement and validate the exact static HTTPS return
page and external sender contract, then build installable candidates.


### Integrated Source Checkpoint

The static exact HTTPS handoff and worker admission are implemented. The page
sends only the production extension ID plus closed UI-open intent, has a
five-second deadline, fences late callbacks across retry, and restores cached
pages without replay. Exact top-frame sender validation excludes every broader
URL authority. Its document/header CSP has no analytics or network authority.

Checks pass: web typecheck and full 531 cases (two existing skips), 59 extension
cases/source validation, production extension package and CSP check, 64 website
cases plus Astro build, and the packaged controlled onboarding/recovery runner.
Signed Android assembleRelease/testReleaseUnitTest/lintRelease and debug Android
instrumentation assembly pass. Existing generated dual-ABI Rust/Kotlin artifacts
are reused; no Rust or generated application boundary changes occur.

Cohort B's installed Android has Play split APKs. The local candidate uses the
upload signer; verify the exact installed certificate before replacement. Add
one bounded `org.jstorrent.setup320` qualification identity to the existing
explicit debug-package allowlist so physical testing can preserve Play data.
Candidate fixtures will document package/extension-ID substitutions if required.
The website source is built locally; no public deployment is authorized.


### Physical Findings And Repair

Both candidates are installed alongside untouched Play apps. Cohort B's exact
installed certificate is the Play app-signing root, distinct from the upload
root used by the signed local APK. The physical candidate therefore uses the
explicit isolated Android identity and existing allowed beta extension identity.
The HTTPS fixture substitutes only that extension ID; the launch test substitutes
only the isolated package. Cohort A's production listener remains running, so
its test page filters discovery to the separately observed candidate port 3031;
cohort B uses the candidate's actual port 3030. No production pairing is altered.

Actual cancellation/reopen leaves the direct launch link usable and its chooser
contains one candidate even with other apps installed. Cohort B's browser denial
is recoverable and its normal Android launch reaches Settings setup. Both exact
HTTPS candidate pages open/focus one extension UI. An unanswered retry notification
initially held the website receipt on A; the worker now treats it as best effort
and returns the already-observed UI-open receipt. Both physical receipts pass.

Fresh API-33 cohort A then exposes notification ineligibility: leaving Android
stops the owner before pairing can settle. Setup now requires existing permission,
app-notification and ongoing-channel eligibility before browser return, exposes
Allow notifications/notification settings, and does not enable background-download
or seeding preferences. The existing lifetime policy is unchanged. A service-side
eligibility recheck fences permission/channel races before navigation. Add JVM and
Compose regressions for denied permission and blocked-channel recovery.

The interception fixture uses explicit target discovery for ARC-opened tabs and
never pauses targets or workers. Initial failed candidate-navigation/receipt
observations remain failures; a candidate reload is distinct from native URL
navigation and does not qualify public hosting.


### Explicit Bootstrap Grace

Both devices run Android API 33 (the second device's initially inferred older
Android version was incorrect). Both now expose the notification gate. Actual
permission denial/retry/grant on A leaves Chrome unavailable until eligible;
permission grant alone does not create background-download/seeding preferences.
The two Compose denial/channel regressions pass on both physical devices.

Source review finds a separate slow-setup boundary: `companionStarted` deliberately
does not renew an existing reconnect deadline, so an Android setup screen left
open longer than that deadline can hand off with no remaining grace. Only the
explicit Android preparation action now renews the existing fixed grace when no
connection is active. Passive discovery, website messages and ordinary startup
cannot renew it. Existing notification and terminal-stop precedence remain.
A fake-clock regression covers expired grace, fresh retention and terminal Stop.

The HTTPS fixture now replaces response bytes to catch an ARC-opened first
navigation without pausing browser targets/workers. It still makes no public
hosting claim. Final pairing expiry, approval, reconnect and cleanup remain in
progress on both cohorts.
