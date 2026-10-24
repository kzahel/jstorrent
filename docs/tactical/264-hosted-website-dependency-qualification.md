# Tactical 264: Hosted Website Dependency Qualification

Status: Complete locally, 2026-10-08. Bounded follow-up to Tactical 259/263.

Topics: `beta-release-readiness`, `product-surfaces-and-migration`.

## Scope, invariants and stopping condition

Qualify the sibling JSTorrent hosted website's dependency graph against current
advisories. Preserve all existing major-version ranges, public routes, form and
analytics recipients, disabled richer-context gates and replacement source's
separate engine architecture. Do not repair unrelated retired-engine workspace
advisories under this slice or publish the website. Keep unrelated untracked
files, existing installed dependency links and personal environment intact.

Stop with inspected targeted website lock/manifest changes, fresh graph/version-
scoped advisory evidence, an isolated corrected-source website build, hosted
query/privacy security tests, responsive captures and a local commit. Other
workspace findings remain explicit; name-only graph matching is insufficient
because a different installed version may be unaffected. Preserve the cache
source-behavior assessment from 263; zero registry entries is bounded evidence.

## Source checkpoint and validation plan

Initial full-workspace audit reports 69 dependency paths, which is not a count
of website vulnerabilities. Inspect the selected website dependency versions
and exact npm advisory paths. Website currently permits Astro ^7.1.3 and existing
React/Solid integrations; selected updates remain within these ranges.
The initial normal update refuses installed public-hoist configuration before
mutation. A targeted lockfile-only update succeeds, avoiding replacement of the
user's existing workspace modules. Validate the modified graph in a task-owned
archive checkout before adopting it; no branch/worktree or inherited state reset.


The existing installed modules do not match declared source: Astro is 5.17.3
although the manifest already permits ^7.1.3. Prior builds using those modules
are not current declared-dependency qualification. The corrected owned checkout
installs from the modified frozen lock; the first filtered build lacks the
engine's generated GeoIP stub. Normal frozen workspace installation runs its
existing postinstall; the second build passes six pages and the hosted security
suite passes eight tests. The inherited workspace modules and links are intact.

Version-scoped website audit reduces the initial installed graph's 40 advisory
entries to three: browserslist 4.28.1 and baseline-browser-mapping 2.9.19 remain
preferred by the resolver. Their callers permit ^4.24.0 and ^2.9.0; request
compatible patched ranges without adding direct dependencies or overrides,
then reinstall/validate only the owned checkout. Whole-workspace retired-engine
findings remain outside this slice and no whole-workspace clearance is claimed.

## Built-page compatibility and presentation repair

Before committing, the corrected Astro build exposes two concrete `/app`
presentation failures: the PNG import is image metadata rather than a URL
(`img.src` becomes `[object Object]`), and the desktop header overflows a
390-pixel viewport. Save actual before captures. Use Vite's explicit URL asset
imports in the two shared logo consumers and allow header/action rows to wrap;
preserve the original logo, controls, engine, routes and integration policy.
Validate the built hosted route at narrow/wide sizes and run shared-client
TypeScript/unit checks. This is a bounded compatibility/design repair within
website qualification, not replacement-engine or feature work.

The first targeted update changed non-website peer resolutions and retained
vulnerable preferred versions. An owned unfiltered audit-fix attempt also
changes other manifests and adds age exemptions; none is adopted. Resolve a
fresh normal lock in a second owned archive, transplant only its website
importer and generated dependency closure into the original lock, verify all
existing integrity values and other importers, then prune only unreachable
entries. Shared transitive consumers may receive the same compatible patch.
Frozen install, six-page build and eight hosted security cases pass. Version-
scoped website registry findings are zero across 440 package names; the whole
retired workspace still has separate findings and is not cleared.

## Final evidence and disposition

Sibling commit `56dc2299` contains only the selected website manifest/lock,
two logo consumers and their asset declaration, plus owning website/release
documentation. Other workspace importers are byte-equivalent as parsed; all
existing package integrity values are checked. Inherited modules, local links
and unrelated untracked material are preserved. No override, policy exclusion,
remote, push, tag or deployment is added.

Exact selected-graph frozen installation, six static pages, eight hosted
security cases, four migration-page cases, shared-client typecheck and 112
client cases pass. Fresh client tests need the normal dependency builds; the
earlier missing engine/SDK-export attempts remain failed setup receipts.
Eighteen real built-page captures at 390/1200 pixels pass display branding,
image decoding, no horizontal overflow and no page exceptions. Actual before
and after `/app` captures show the original logo restored and controls wrapping.
Focused formatting and tracked documentation checks pass; the inherited
checkout's unrelated untracked investigation links still fail its broad doc
check, and are not modified or hidden.

Fresh version-scoped website evidence has zero registry advisory entries over
440 package names. Entire retired-workspace findings remain separate. Inspected
Astro 7.3.6 remote-image consumers use only `storable()`/`timeToLive()` on this
static build; Tactical 263's residual cache behavior and future SSR/shared-cache
reassessment apply. The ignored finish-line report owns detailed receipts and
screenshots. Public deployment and delivery claims remain unqualified.
