# Tactical 282: AppRun License Attribution

Status: Complete locally, 2026-10-08. Signed rebuilding remains under259.

Topics: `beta-release-readiness`, `capability-readiness`.

## Scope, invariants and stopping condition

The exact signed source8c x64 native notice manifest exempts AppRun.wrapped by
known binary hash and mirror origin but has no AppRun copyright notice. Its
main Rust/npm notices also omit AppRun and both named source copyright holders.
The independently downloaded x64/ARM mirror binaries exactly match upstream
AppImageKit continuous assets. That upstream release points to5735cc5; its
src/AppRun.c carries MIT terms and Simon Peter/RazZziel copyright notices.

Package that original complete source-header notice for either allowlisted
launcher. Bind architecture, upstream-declared source revision, notice hash
and origin in the manifest; refuse missing/tampered attribution during both
collection and independent package inspection. Preserve current launcher
bytes, runtime, engine, identity, updater and Linux compatibility policy.

The existing collector owns bounded copied notices and manifest verification.
No new runtime task, subprocess, dependency or network access is introduced
into collection/verification. Preserve existing16-MiB per-file/64-MiB total
notice bounds and safe destination handling. Import only the MIT notice into
Git with exact provenance; source archives/binaries remain ignored inspection
material and no implementation source is copied into the product.

Stop after both architectures' notice round trips, omitted/mutated/source-drift/
incorrect architecture/provenance refusal tests, proportional complete
distribution tests and actual retained-artifact/source-material checks. New
signed candidate qualification remains259. This corrects attribution only;
upstream marks the legacy release obsolete, archived build metadata is404,
and no reproducible-build, complete corresponding-source/relink or all-package
redistribution/security clearance is inferred.

## Primary sources

- [Tauri mirror](https://github.com/tauri-apps/binary-releases/releases/tag/apprun-old).
- [Upstream release](https://github.com/AppImage/AppImageKit/releases/tag/continuous).
- [Declared source](https://github.com/AppImage/AppImageKit/blob/5735cc5bed206497cddfbd2a75e1982c2606c35d/src/AppRun.c).
- [Build target](https://github.com/AppImage/AppImageKit/blob/5735cc5bed206497cddfbd2a75e1982c2606c35d/src/CMakeLists.txt).

## Required evidence

Exact x64/ARM official mirror/upstream bytes remain31552/35360 bytes with
SHA-256f30140.../072f17... respectively. Source archive65ce930... is88978 bytes,
with checked archive paths and inspected MIT header/build target. Preserve
original failed archive-path inspection and unavailable build metadata rather
than rewriting them as passes. New packaging inputs supersede the pending03e
signed-build proposal; never silently substitute a later commit for it.

## Implementation and local evidence

Both reviewed launcher architectures now receive the exact1271-byte initial
MIT header, SHA-2568140ac4c..., in the native notice tree. The manifest records
its destination, MIT selection, upstream-declared revision/source locator and
mirror origin. Collection checks the original notice hash; package verification
requires the approved notice hash plus matching architecture/provenance fields,
even when an attacker alters the notice and its manifest hash together.

All26 distribution cases pass, including both architectures, absent/forged
notice attribution, changed source text and wrong architecture/origin/revision.
Independent archive reads prove the tracked notice equals the exact initial
upstream source comment and bind the source/archive hashes. Both actual official
31552/35360-byte launcher files pass collection/inspection in controlled native
fixtures with unchanged original MIT bytes. These are local packaging fixtures,
not newly signed packages or reproduced upstream builds. The exact signed8c
x64 manifest/main notice files retain their hashes and before-fix finding.

The first read-only SquashFS attempt used the wrong main-notices directory;
archive listing identified usr/lib/JSTorrent/notices and the corrected bounded
read passes. Temporary SquashFS staging is reaped in both attempts. Upstream
build4369243945 API404 remains unavailable. Source material stays ignored;
no product implementation code or source offer is imported/published.

Fresh signed inputs differ from03e. Prepare a new exact-source nonpublishing
build review after committing; do not execute a superseded approval against
later bytes. Linux maintained-runtime/accepted ABI disposition and complete
native corresponding-source/relink/redistribution acceptance remain open.
