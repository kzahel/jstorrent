# Tactical 278: Android Shutdown Window Lifecycle

Status: Complete locally, 2026-10-08. Managed delivery remains separate.

Topics: `android-jstorrent-replacement`, `client-surfaces`, `web-ui-design`.

## Scope and stopping condition

The real code26 managed Play app joins its engine after the normal Shutdown
menu action with cleanup_failed=false, but its visible activity stays bound to
the stopped service and continues to show Live and actionable torrent rows.
Close the foreground task when its explicit Shutdown action requests the
existing stop path. Reopening through the normal launcher must create a fresh
service and retain owned library records, payload bytes and SAF access.

No engine, background policy, network, persistence, privacy settings, generated
contract or dependency changes. Preserve the service's joined shutdown and
error-containment behavior from260. Bump the next Android candidate to27;
code26 is already available internally and cannot be replaced with new bytes.
Stop after build/JVM/lint evidence and an isolated actual normal-menu shutdown,
absent owned activity/service and fresh Live-library reopen with unchanged
bytes. Managed code26 remains unchanged; a new internal delivery needs its own
reviewed instruction. No production promotion is authorized.

## Ownership and validation

MainActivity owns its Android task/window and binds/unbinds the product service
in onStart/onStop. ProductEngineService remains sole owner of the native client,
SAF tasks, lifecycle and cancellation. Explicit Shutdown requests the existing
terminal stop, then finishes/removes the activity task so onStop releases the
binding. Service onDestroy joins its existing shutdownComplete barrier before
canceling its scope. No new task, queue, retry or timeout is introduced.

Read ProductApp's existing Shutdown route, MainActivity's binding lifecycle,
ProductEngineService requestStop/shutdown/onDestroy and260's shutdown contract.
Use the isolated qualification identity for the actual menu check; never
sideload over the managed Play installation or clear inherited production data.
Capture the real code26 stale Live failure and the corrected task/reopen states.

## Source checkpoint

The activity-owned Shutdown callback requests the existing service stop and
finishes/removes its task. ProductApp forwards the callback through its existing
navigation host; preview callers retain their service callback default. The first
debug compile misses that navigation forwarding and is retained as a failed
attempt; after correction, all122 JVM cases and debug lint pass. Candidate27
is frozen at application source `68e247ad` with normal original-key APK/AAB.
All122 release JVM cases, lint and independent signature/package/label/API/ABI,
16-KiB alignment and notices checks pass. APK SHA256 is
`7215a127f472ab21230d812482e6221f170bb570a0dbc90eedd67ce234e4ebd2`;
AAB SHA256 is
`383379eeb05363e6a361e02a9a1250fb6e72c8dc595b6267bb897b17f34156d8`.

Actual physical ChromeOS normal file-picker intake retains an independently
hashed private64-KiB complete fixture. The normal Shutdown menu removes the
owned task/activity and service; the native log records explicit-stop joined
completion with cleanup_failed=false. Normal activity launch creates a fresh
service and actual Live/100.0% owned row. Payload SHA256 and SAF registry remain
identical. Cleanup removes exactly the newly owned folder/files and isolated
profile; managed code26 installation metadata remains unchanged. Receipts and
before/after screenshots stay in the ignored finish-line evidence directory.
A harness initially expected100% instead of the actual100.0%, and an unfiltered
activity dump initially included other applications; these assertions are
corrected to the observed display and exact owned identity. Neither failure
changes product behavior.

The repaired source additionally passes workspace formatting, clippy and1,575
Rust cases with18 existing ignores. This is local evidence; source8c's original
hosted listener-test failure remains until revised-source CI is instructed.
On2026-10-09 the exact reviewed code27 AAB is published only to the existing
internal testers. Play reports Available to internal testers; production23 and
tester/device settings remain unchanged. Independent Play-generated managed
certificate/package/API/ABI/alignment checks pass. Actual managed27 Shutdown/
reopen acceptance remains separate under259.

Managed27 task closure now passes on a retained physical Play installation under
259: after the authorized real statistics opt-out, normal Shutdown removes the
exact app task/service and normal launch returns Live without the disclosure.
UID/first-install/installer and exact grants remain unchanged. The library is
empty after earlier owned-fixture cleanup, so this closes only managed task/
service/reopen behavior. Actual captures and per-slice report stay ignored.
All observed browser tabs and application windows close afterward.
