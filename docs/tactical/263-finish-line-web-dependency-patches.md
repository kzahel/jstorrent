# Tactical 263: Finish-Line Web Dependency Patches

Status: Complete locally, 2026-10-08. Bounded follow-up to Tactical 259.

Topics: `beta-release-readiness`, `web-ui-design`.

## Scope, invariants and stopping condition

Fresh release audit finds four newly listed npm advisories. Update only affected
transitive packages within accepted dependency ranges; retain application APIs,
engine owners, platform identities, signing roots and the current seven-warning
Cargo policy. No new dependency, major upgrade, suppression or publication.
Stop after zero-vulnerability fresh web/website reports, strict release review,
web type/unit/build/CSP and affected extension/website packaging, artifact hash
reconciliation and notice validation. Run representative browser evidence after
bundling. Preserve exact historical candidate hashes; changed bytes supersede
prior store upload requests and must receive a concrete reviewed delivery decision.

## Primary source review

- fast-uri GHSA-hrr3-gc8f-f4qj: percent-encoded host case normalization;
  compatible fix 3.1.8, replacing 3.1.7.
- source-map-js GHSA-68fv-2mgg-jv7q: indexed source-map offsets can block the
  event loop; compatible fix 1.2.2, replacing 1.2.1.
- http-cache-semantics GHSA-ch52-4w7c-c8xp: max-stale handling can disclose
  cross-user cached responses; registry resolution moves 4.2.0 to 4.3.0.
  See the explicit residual source-behavior assessment below.
- sharp GHSA-wq5f-xc86-pv6w: librsvg dependency; compatible fix 0.35.5,
  replacing 0.35.4 under Astro's existing ^0.35.4 range.

Official registry audit reports and GitHub maintainer advisories own exact
versions and changes. Cargo audit reports zero vulnerabilities against RustSec
b8a1a33e246a0a9a3b5f377248c41a503defec74 (2026-10-07), retaining independent
GLib backport provenance and the existing reviewed warning inventory.

## Validation checkpoint

Before changes: web has two vulnerabilities (one moderate, one high); website
has three high vulnerabilities. Strict review refuses publication readiness.
Affected dependency graph and semver ranges are inspected before resolution.


## Completed local qualification

Web updates only fast-uri 3.1.8 and source-map-js 1.2.2. Website updates sharp
0.35.5 and matching platform/libvips packages, source-map-js 1.2.2 and
http-cache-semantics 4.3.0 within existing ranges. No manifests, direct product
versions, engines or Cargo lock change. Fresh web and website audit reports
contain zero vulnerability entries; strict review passes with the unchanged
seven Cargo warnings, exact GLib backport provenance and no policy suppression.

Web typecheck, 470 unit cases (two skipped), production build/CSP and complete
configured E2E pass (46 cases; 14 existing fixture/live-service skips). Extension
54 tests, both package lanes and 13-bundle CSP pass. Production ZIP remains
byte-identical at 979a0f136ce0a219bca8428b1b5afef2c11a1b98ac1a9fc75e5b61abc67cc4aa;
beta remains e045c560614115e3d4674774b9c8abbe4a3b0d30d814f996574d6a86603eaa29.
Their 19-entry inventory differs only in manifest. Existing installed migration
receipts therefore still bind the exact current companion payload. Website
check and three-page static build pass. Fresh desktop notice generation passes
459 Rust / 28 npm packages, including patched fast-uri attribution. Final
signed desktop resources must be rebuilt; no publication performed.

## Residual cache-source behavior: do not call audit zero a universal fix

[GHSA-ch52-4w7c-c8xp](https://github.com/advisories/GHSA-ch52-4w7c-c8xp)
lists no patched release, while the npm registry treats versions above 4.2.0
as unaffected. A bounded local probe of actual 4.3.0 still reproduces reuse of
zero-lifetime Set-Cookie and proxy-revalidate policies when the caller supplies
max-stale. Version-range audit success is not proof that behavior is repaired.

Inspecting Astro 7.3.5's exact `dist/assets/build/remote.js` shows the only cache
consumer constructs trusted remote-image requests and uses storable/timeToLive;
it calls neither evaluateRequest nor satisfiesWithoutRevalidation and forwards
no viewer max-stale directive. The project emits static HTML/assets with no
server adapter/shared request cache. Thus this reproducer does not establish an
exploitable project route. Preserve the upstream defect and this bounded
call-path assessment in the report; do not generalize it to future SSR, adapters,
shared caches or other dependencies. No dependency fork or warning suppression
is adopted. Other upstream primary references:

- [fast-uri advisory](https://github.com/fastify/fast-uri/security/advisories/GHSA-hrr3-gc8f-f4qj)
- [source-map-js 1.2.2](https://github.com/7rulnik/source-map-js/releases/tag/v1.2.2)
- [sharp advisory](https://github.com/lovell/sharp/security/advisories/GHSA-wq5f-xc86-pv6w)
