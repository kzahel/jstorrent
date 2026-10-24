# Tactical 292: Preserve Paused Intent Through Android Folder Repair

Status: Complete locally, 2026-10-10; new signed/managed delivery open.
Beneath finish-line259. Managed27 slice056
reproduces a paused complete torrent becoming Seeding after normal Repair.

## Scope and stopping condition

Remove Android presentation-driven Resume dispatches after SAF root probes.
The application service already reconciles admission from durable run intent;
an asynchronously delivered AwaitingStorage view cannot authorize Resume.
Keep the explicit restart IDs returned for runtimes stopped by replacement.
Stop after the regression fails on unchanged Android and passes on the bounded
fix, Android JVM/build checks, cleanup and updated candidate status. Actual
managed-store qualification of a newly signed version remains separate.

Non-goals: Rust engine/protocol changes, root-ID/schema changes, new grants,
automatic folder discovery, migration changes, iOS, Linux, store publication,
desktop feed activation or changing the native service's replacement lifecycle.

## Invariants, owners and reference review

ProductEngineService owns the coroutine, SAF mutation mutex and joined client
lifetime. Kotlin owns provider selection/grants; Rust owns durable run intent
and admission. Probe completion may precede a Compose view update. Never infer
the user's desired run state from a stale AwaitingStorage presentation. Preserve
paused, running, held-selection, archived and unrelated-root semantics; no new
tasks, timers, queues or resource limits are introduced.

Inspected application.rs probe_platform_storage_roots/reconcile_admission and
start_if_possible_with_mode: health probing reconciles existing desired_running,
while Pause remains authoritative. prepare_platform_storage_replacement returns
only affected active runtime IDs. Kotlin setSafTree and repair rollback instead
walk the asynchronously updated ProductState and dispatch Resume to every
AwaitingStorage row, which can include a paused row after the service has already
restored its root. This crosses the ownership boundary.

Pinned libtorrent7d7fc38 torrent.cpp files_checked, checking pause guards and
test_storage.cpp move_storage reset/self cases, test_resume.cpp paused and
override_resume_data_deprecated were inspected: storage/checking
does not grant fresh user Resume intent. No BitTorrent wire change is involved;
SAF repair is a platform capability, without a normative BEP equivalent. The
JSTorrent reference's native RPC Resume is an explicit control operation; its
legacy grant/history does not override the new durable application authority.

## Evidence and restart checkpoint

Managed27 actual screenshots show Paused before outage and Seeding after normal
picker repair, with the same independently hashed1MiB bytes and original source
closed. Cancel retains the original exact grant. Portrait picker clipping is
recovered through normal Landscape; the original setting must be restored.
The original failing assertion remains failed. Restore the owned original path
through normal Repair, remove only its row/file/marker, Shutdown and close every
tab/window before starting an isolated regression. Reports/images remain ignored.

Managed fixture cleanup passes separately: original URI/modes, unchanged other
grants/package/denied notification, empty library/folder, released alias grant,
Portrait restored, stopped service and zero tabs/windows. Normal original-grant
retake advances its creation time.

The unchanged debug APK reproduces the same failure in a fresh owned API35 AVD
(attempt4): before Paused, after Repair Seeding; bytes independently identical
and original source closed. The bounded fix removes both stale-view Resume
loops. A second fresh AVD verifies Paused through Repair/cold reopen, then
explicit Resume and Seeding through another Repair/cold reopen. All four normal
Shutdowns join. Both owned emulators and temporary AVDs are reaped/removed.
Early first-use/control/menu assumptions fail before Repair and remain recorded.

Validation: Gradle assembleDebug/testDebugUnitTest/lintDebug,122 JVM cases,
zero lint errors (99 warnings),24 Android packaging-script cases and debug
notice integrity (83 Maven/205 Rust/six native libraries) pass. Rust, generated
JNI/API, schema, permissions and dependencies are unchanged. Slice058 contains
exact before/after APK hashes and screenshots; reports/images stay ignored.
No full engine/workspace test or new signed/store qualification is claimed.

Next: prepare a production code above27 containing this fix, qualify its exact
signed artifacts and re-run managed repair after authorized delivery. Existing
managed27/source68e and desktop2b83 receipts retain their original scope.

Slice059 prepares1.0.28/code28 without tagging/pushing. Its exact debug APK
repeats paused/running repair and cold reopen with identical bytes/source closed.
Gradle/JVM/lint/script/release-source/notice checks and owned AVD cleanup pass.
The harness now deletes stale XML before reads and uses its own JSTorrent tree.
Non-publishing hosted original-key build is the next dependency; remote main
is2b83ed91 and no local signing environment is configured.
