# Tactical 265: Production Website Release Handoff

Status: Complete locally, 2026-10-08. Finish-line follow-up to 259/264.

Topics: `beta-release-readiness`, `product-surfaces-and-migration`.

## Trigger, scope and stopping condition

The existing production website discovers only sibling `tauri-app-v*` releases,
constructs optional package URLs and offers the legacy Linux installer. The
replacement capsule has different source/tag layout and macOS DMGs rather than
PKGs. Its publisher intentionally rejects JSTorrent-tag publication; do not
mistake a nonpublishing signed candidate for an activated official release.

Prepare a disabled, curated website descriptor tied to the independently
qualified immutable release inventory. At build time validate exact production
product/platform names, source/tag/version, original public-root ID and bounded
hash/size inventory. Only explicitly enabled qualified metadata selects the
replacement; discovery cannot overwrite it. Preserve existing published delivery
while disabled, recipients, account IDs, iOS exclusion and independent rollout.
Use actual DMGs and direct Linux packages when enabled, without invented PKGs or
legacy installer commands. Remove obsolete QuickJS and absolute build-provenance
copy that would become false during replacement; retain truthful general product
copy and the original design/assets.

Non-goals: no publisher activation, tag, push, website deployment, store upload,
feed change, new package dependency, signing material, app/library migration,
iOS work or production-publication guard removal. Static metadata validation is
not signature/file verification or evidence of public artifact availability.
The final descriptor stays disabled/unpopulated until the approved real capsule
is verified and published. Current candidate-build approval remains separate.

Stop with source/negative guard tests, both disabled and controlled-fixture
responsive views, frozen website build/docs/format checks, local sibling commit
and reconciled report/checklist. Fixture links are never downloaded, published,
or used as store artwork. Retain exact source/proof limitations and cleanup.

## Source checkpoint and required evidence

Reviewed the existing Downloads hook, home frontmatter, deployment workflow,
release topic/README, original signed candidate inventory, desktop input and
assembler guards. Official candidates still cannot publish; ordinary legacy
tag inputs select the incubation lane, so final activation requires a separately
qualified production publication slice. No alternate release namespace or
automatic preview adoption is accepted by this website preparation.

Use normal owned frozen checkout. Test malformed/missing/duplicate/wrong-product
assets, source/tag/root mismatches, invalid hashes/sizes, disabled descriptors
and late legacy discovery. Inspect phone/wide home and every desktop platform
choice under explicitly labeled synthetic metadata, alongside the actual
unchanged disabled route. Update owning topics before committing.

## Completed local evidence

Sibling commit `0e935e75` implements the disabled curated handoff. Twenty-two
positive/negative guards, focused TypeScript/ESLint, six-page Astro 7.3.6 static build,
35 tracked docs and supported file-format checks pass in the owned frozen
checkout. Astro files have no configured Prettier parser; their source diff and
actual build/views are reviewed instead of claiming that unsupported check.

All 18 actual disabled route captures at 390/1200 pixels pass display branding,
image decode, horizontal overflow and page-exception checks. Six controlled
synthetic Windows/Mac/Linux views pass at both widths, including both Linux
architectures, actual DMG URLs, retained support recipients, replacement source
links and no legacy API fetch. The test endpoint is prepared with a newer legacy
release response; enabled views never request it. The hook also returns curated
props ahead of any retained legacy state. No fixture link is downloaded.
Full-page and focused download captures explicitly label synthetic metadata.
The real descriptor is restored to disabled/null, rebuilt and checked again.

The metadata guard also accepts all 23 retained historical capsule names after
independently rechecking actual sizes/hashes. This compatibility probe does not
qualify its installed cohorts or promote it to final release status. Fixture and
historical receipts, screenshot assets and report remain ignored.

Source/CI pointers follow the selected implementation; support/community
recipients and account IDs remain fixed. General product and signing copy no
longer claims one JavaScript engine everywhere, every build being CI-produced,
or guaranteed first-launch acceptance. Original branding/design assets remain.

The final publisher guard remains intact. No push, tag, release, feed/store
change or public website deployment occurs. Final signed qualification,
production publisher activation and public delivery are still acceptance gates
owned by 259 and the cutover checklist.

Both task-created archive validation checkouts are removed after final checks.
Inherited modules, global package cache, user untracked files and release/report
assets remain preserved. All owned browser/listener processes are reaped.
