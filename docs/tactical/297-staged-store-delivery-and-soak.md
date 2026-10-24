# Tactical 297: Staged Store Delivery And Soak

Status: Active, 2026-10-11. Owners: beta-release-readiness and
product-surfaces-and-migration. Continues the bounded shipment 295 checkpoint.

Current rollout: Android 1.0.28/code 28 is fully available at 100% following
explicit maintainer direction on October 11 at 19:52 UTC. The full-rollout
checkpoint below supersedes the earlier 5% hold; validation gaps remain open.

## Scope and stopping condition

Desktop 0.3.0, source downloads, website and production feed are public and
verified. On October 10 the maintainer renews Web Store authentication; the
existing item then shows Pending review. The October 11 publication and
installed-store checkpoint below supersedes that deferred state.
Play approves all 92 changes, including exact Android 28 and its 5% rollout.
Publication is confirmed at 16:51 UTC; production shows release 28 available to
5% of users, and release 23 remains available. Managed publishing stays on.
Separate ignored report 088 retains approval, confirmation and actual rollout
screenshots. The actual public Play listing shows the new three-image gallery,
copy, October 10 update date and data-safety disclosure. This does not prove
production-channel installation. Fresh cleanup passes on both Chromebooks;
no VM was booted. Console crash/ANR metrics are unavailable, not a zero-failure pass.
The 24-hour observation cannot finish before October 11 at 16:51 UTC; elapsed
time alone does not qualify expansion.

Google approvals are external dependencies, not missing authorization.
Preserve exact ff632 package bindings,
existing app/store identities, original signing roots and disabled hosted
identifier/counter gates. Do not rebuild or relabel these packages.
Store updates may publish independently; one approval does not require waiting
for the other store when the documented mixed-version recovery story applies.

Next executable steps:

1. Record actual approvals or address specific rejection findings. Reconcile
   dependency-review expiry/current advisories before later publication.
2. Verify an existing-profile extension update when a cohort with the earlier
   store extension is available. Publication and a fresh installed-store canary
   now pass; neither proves an existing-extension update. Preserve the
   documented mixed-version recovery story.
3. Monitor Android 28 at 100%; verify an actual production-channel installed canary's
   signer, retained library/grants/paused intent and native/extension reconnect.
   Existing internal-track 28 installations do not prove production delivery.
   Read-only report088 confirms cohort B remains on the earlier internal 28;
   cohort A has no connected ADB device and its proxy is not listening.
4. Record the actual rollout start; observe 24 hours before expansion. Stop on
   confirmed payload loss, competing writers or systematic startup failure,
   following the existing operational recovery plan. Do not invent a soak pass.

Unrun second-device, physical Intel, reboot, sleep, grant-loss and background
upload cases remain explicit in 259. Current VM-off and Chromebook cleanup
receipts do not qualify those routes. Linux remains best effort; iOS remains
out of scope. Translation detail and small Files/Storage spacing notes are
presentation follow-ups, not evidence of package changes.

Play's release dashboard reports DEX obfuscation at 0%, due February 2027,
and an edge-to-edge recommendation. Record both for the next Android slice;
neither prevented approval or the staged release. Do not rebuild the frozen
candidate during this rollout. Dependency review remains valid through
October 12, with the previously recorded GLib remediation and rustls 0.23.45.

Stop when actual public store delivery, canaries and staged observation are
recorded, or when a concrete external review/device dependency prevents the
next check. Reports/images stay ignored and machines are cleared between use.

## Extension publication and physical canary, 2026-10-11

The maintainer explicitly requests publication and Chromebook verification.
The existing production item `dbokmlpefliilbjldladbimlcfgbolhk` shows approved
1.1.3 ready to publish. Its normal Publish confirmation is submitted; the
physical Chromebook's live public listing subsequently shows 1.1.3 and an
October 11 update date. The reviewed package is not rebuilt or relabeled;
the recorded dependency-review window remains valid through October 12.

Separate ignored receipt 089 records a fresh official Web Store installation,
enabled 1.1.3, and the extension manager's Chrome Web Store source. The
available Chromebook has no prior JSTorrent extension, so this is fresh-install
evidence, not an existing-extension update. The other Chromebook is unreachable.
The available device has a pending OS update and degraded boot-persistence
evidence; live SSH, unlocked desktop, capture and semantic input work. No reboot
or machine repair is performed.

The actual popup and optional ARC host permission reach the packaged Android
controller. The OS chooser contains two identically named apps; it is canceled
and the known Play-installed `com.jstorrent.app` is launched explicitly.
Android 1.0.28/code 28 approves the production extension's pairing. The browser
shows connected and the same empty native library. Reload retains pairing;
normal Android Shutdown removes its service and shows disconnected recovery
guidance. Normal app relaunch and Retry reconnect without a second approval.
Package identity/update times, persisted SAF grants and denied notification
permission remain unchanged. Final normal Shutdown, owned XML removal and
individual tab/window cleanup restore the idle workspace; installed 1.1.3 and
its pairing remain for later canaries.

This Android installation predates production publication and remains internal
track evidence. Empty-library reconnect does not qualify retained paused rows,
payload integrity, Android production delivery or the 24-hour soak. Android's
5% rollout is unchanged; those checks and an existing-extension update remain
the next work.

## Android adoption check, 2026-10-11

At 14:42 UTC, the live production Releases page still shows 1.0.28/code 28
available to 5%, released October 10 at 18:51 in the console's local display.
The release dashboard reports unavailable installation and stability metrics,
but its detailed Statistics link shows eight version 28 device-update events
after rollout start: one at October 10 19:00 and seven across October 11
01:00, 02:00, 06:00, 08:00 and 10:00. These are events, not unique users;
the report is version-filtered without a production-track filter, so it does
not independently establish production-channel canary delivery. Acquisition
counts remain unavailable. The vitals App version selector only offers 23;
there is no usable 28 crash/ANR denominator or zero-failure claim.

Control Room's feedback collector succeeds at 14:28 UTC. All 513 ingested
responses contain no version 1.0.28-tagged feedback; the latest Android-tagged
response is August 2 for 1.0.23. There is no automatic Android check-in feed.
The 5% rollout and production-installed canary/soak requirements are unchanged.

At 19:41 UTC, a fresh read-only check still shows the production rollout at 5%.
The version 28 Statistics table now contains at least ten device-update events
since rollout start, including two newly reported events at October 11 12:00
in the console display. The latest populated hourly row is 12:00; this is
delayed event reporting, not live check-ins or a unique-user count. Paging to
older rows times out before dispatch, so ten is recorded as a lower bound.
The release dashboard still has unavailable crash/ANR rates and no version 28
reviews. The feedback collector succeeds at 19:28 UTC; the same 513 responses
still contain no version 1.0.28 tag. More than 24 hours have elapsed, but the
production-installed canary and usable stability evidence remain outstanding;
elapsed time does not qualify rollout expansion.

## Maintainer-directed full Android rollout, 2026-10-11

The maintainer explicitly requests immediate expansion to 100%. The new
extension requires the successor Android companion; holding Android at 5%
can leave ChromeOS users with an update-required screen and no eligible Play
update. This direction supersedes the earlier 5% hold without asserting that
the pending production-installed migration canary or stability gates passed.

At 19:52 UTC, the normal Play Console Update staged rollout dialog for exact
release 28 (1.0.28) is set from 5.0 to 100 and submitted. Play confirms
"Staged rollout updated"; the production release becomes "Available on Google
Play" without a percentage restriction, and the earlier release 23 card is
removed from the active releases list. Separate ignored report090 retains
the visible release state and screenshot. The approved bundle, app identity,
signing roots, countries and supported-device requirements are unchanged.

Continue production-installed migration/reconnect verification and monitoring
of version 28 update events, feedback and delayed crash/ANR reports. Ten update
events and unavailable rates remain the latest pre-expansion observations;
full availability is not a zero-failure or completed-soak claim.
