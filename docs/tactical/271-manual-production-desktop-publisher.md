# Tactical 271: Manual Production Desktop Publisher

Status: Complete locally, 2026-10-08. Local finish-line follow-up to250/259/265.

Topics: `beta-release-readiness`, `product-surfaces-and-migration`.

## Scope, invariants and stopping condition

The production website requires the exact23-asset JSTorrent capsule, yet the
existing publisher rejects JSTorrent tag assembly, titles releases Preview and
removes ten detached signatures. Ordinary stable tag input still selects the
incubation lane even though the accepted destination is one JSTorrent shipping
lane. Signed candidate builds do not activate production publication.

Prepare an explicitly manual production publication mode on the existing
workflow and `desktop-v<version>` namespace. Require a manual dispatch against
that exact stable tag, an exact source SHA, no nightly/source/version overrides
and no simultaneous candidate mode. Preserve nonpublishing branch candidates.
Stable tag pushes select production packaging but never publish; ordinary
branch/scheduled preview behavior remains separately bounded. Only the explicit
manual publication mode can pass the existing production-tag assembler guard.
Validate all five same-source/run/attempt legs, actual digests, retained updater
root signatures, package identity and normal platform checks before draft/upload.
Use the selected product display name for the release title. Retain all ten
production signature sidecars and the23 core assets; the existing SHA256SUMS
is an additional support asset, not part of the website's curated23-core-asset
inventory. Verify the complete final private draft before publication.

Non-goals: no push, tag creation, workflow dispatch, signing-secret changes,
release/draft/upload, updater service/configuration activation, website deploy,
store changes, engine behavior or iOS. Code enabling a deliberately requested
mode is not authority to invoke it. Historical binary fixtures are not final
installed-artifact qualification. Ordinary published releases remain immutable;
missing/mixed/stale legs, wrong signatures and incomplete drafts fail closed.

Stop with positive and refusal tests, unchanged default publication guards,
local actual-capsule assembly/signature rehearsal, reviewed workflow checks,
updated topics/checklist/report and local commit. Final signed CI, installed
acceptance and explicitly approved publication remain259's external gates.

## Source and ownership review

Reviewed `resolveDesktopReleaseInput`, the workflow's input/build/collector/
draft/signature/upload/checksum/prune/finalization sequence, `laneFiles`,
`assembleDesktopRelease`, `verifyUploadedAssets`, desktop validators and original
root verifier. Reviewed sibling265's `production-release.ts` exact23 core names,
retained root415D3DF4B3D0CFB8 and immutable `desktop-v` URLs. The shared updater
service configuration remains product-owned and activation is a separate
operation. No new release namespace, dependency, daemon or runtime owner.

Existing CI job dependencies, serialized publisher concurrency, read-only
source/build permissions, private draft validation and cancellation owners
remain. Artifact/metadata budgets and exact-source provenance remain unchanged.
Use task-owned local output, preserve immutable inputs and remove rehearsal
copies after receipts; no public API call is needed for these checks.

## Completed local evidence

The56 affected release/configuration/signature cases pass, plus the real
workflow-shell refusal case. Its initially inherited BASH_ENV supplied a
personal gh wrapper: the positive shell test failed opening absent fixture
notes before draft creation. No write occurred. The corrected test uses only
an explicit minimal environment and fake commands, with no account tokens or
shell startup files; moved tags refuse before any write marker, while exact
source reaches the correct JSTorrent title. Actionlint passes. The final58-case release suite passes after the last source edit, including
the real shell guard and actual minisign wrong-root/altered-payload case.

The actual historical original-signed sourcea359/run37657795184/attempt2
capsule assembles all23 core assets and15 updater selections through the new
explicit production mode. All ten actual updater signatures independently
verify against415D3DF4B3D0CFB8. A clearly synthetic final private-draft metadata
fixture includes exactly those23 actual core digests plus the actual generated
SHA256SUMS file; both final draft and normal release validators pass. This
uses historical bytes and simulated remote metadata, not final CI/installed
or public availability proof. Owned rehearsal payload copies are removed;
immutable original capsules and ignored receipts remain.

The collector retains original production signature sidecars, rechecks the
actual fetched tag commit before draft creation and just before publication,
and checks all24 final draft assets before its final publishing step. Default
manual candidate, automatic stable tags and direct production assembly without
explicit mode remain nonpublishing/refused. No tag, push, dispatch, GitHub draft,
asset upload, public release, feed/service/site/store mutation occurs. Final
signed CI and installed/public delivery remain259's next external actions.
