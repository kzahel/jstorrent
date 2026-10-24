# Tactical 299: Production Website Consolidation

Status: Complete, 2026-10-11. Owners: product-surfaces-and-migration and
beta-release-readiness. A private cross-project plan owns hosting, DNS and
repository administration; this tactical owns portable source changes.

## Scope and stopping condition

Move the established JSTorrent marketing design, blog and compatibility URLs
into this repository's website without old engine/client workspace imports.
Retain production inventory, signing root, recipients and legacy magnet routes.
Retire `/app`, identified by the maintainer as a prototype, with clear guidance.
Automate website inventory updates after verified production release promotion.

Stop after a frozen standalone build, metadata/security/route checks, actual
phone/wide before/after captures and a verified deployed preview. Production
hosting and repository names have separate recorded acceptance.

## Invariants and non-goals

- Preserve the established visual design and MIT source/assets notices.
- Do not import `@jstorrent/engine`, `@jstorrent/client`, or `@jstorrent/ui`.
- Preserve guarded `/remote/` build, relay identity and route policy; changing
  remote origin, credentials or authentication is outside this tactical.
- Preserve Google Form and analytics recipients; never submit test responses.
  Render only bounded accepted query fields as text.
- Keep compatibility URLs and both Linux AppImage source links.
- No engine, application identity, signing key, store release or iOS changes.
- Never promote a preview or incomplete inventory as production downloads.

## Implementation and evidence

Read the old website README/legacy map, production selector, source license,
deployment workflow, public headers, assembly guards and remote-auth topic.
Port Astro marketing/blog and React Downloads with focused source guard tests.
Remove legacy discovery and app aliases. Render download links before hydration;
replace old workspace changelog reads with published product release data.

Generate scoped CSP hashes for trusted inline scripts after build; retain the
restrictive remote policy. Test recipients, canonical URLs, missing/bad release
metadata, query filtering and routes. Use owned bundled Chromium for platform
tabs, theme, direct fragments, image decoding, overflow and CSP/error capture.
Keep screenshots and operational receipts wholly outside tracked source.

## Execution checkpoint

The old `/app` imports the TypeScript client; targeted active-source search
finds no `jstorrent.com/app` links. Marketing changelog reads old workspace
files, while support/community URLs still select the TypeScript repo. Preserve
historical blog content and reconcile present product links separately.

The following execution record covers local qualification and deployed acceptance.

The standalone port passes Astro diagnostics (zero errors/warnings/hints),
40 inventory/context/CSP cases, nine remote assembly guards, and 32 actual
320/390/1200 light/dark/browser views. No-JavaScript Windows, both Mac and both
Linux links are present. Analytics are blocked and forms substituted during
capture. Per-route exact hashes permit existing marketing scripts without
broadening remote policy. The old waitlist prototypes redirect to Download;
prototype retirement is clearly styled. Initial local captures do not qualify
public deployment; release automation and deployed preview remain next.

Release automation verifies a new public capsule once and atomically persists
website inventory plus its announcement before explicitly dispatching Website.
It handles release events and publisher workflow completion (candidate-only
completion is excluded). Fifty-three metadata/context/security/promotion cases pass;
live 0.3.0 source/tag/public inventory comparison is an idempotent no-op. No
release, package or public website inventory is changed by that check.

The Git API transaction tests prove stale-inventory and concurrent-main
refusals prevent deployment dispatch. Inventory and announcements use one
atomic tree/commit, preserve intervening announcement content and never force
main. Existing qualified inventory is a no-op even if an output file remains.

The first hosted Website run stops before deployment because the new Git API
fixture reads paths relative to its invocation directory. Fix the fixture to
resolve repository paths from its module and explicitly set child cwd; the
actual package-level `npm test` command now covers the CI invocation. Public
hosting remains unchanged by the failed run. The actual retained 17-asset
0.3.0 capsule independently passes fresh public digests, six original-root
signatures and all updater URL/signature bindings through the promoter.

Website CI run 38130647899 passes after the invocation fix and deploys the
source artifact. Its remote manifest verifies all six expected files. The same
32 browser acceptance views pass against the deployed HTTPS origin, including
platform selection, theme, direct Download fragments, safe query rendering,
image decoding, overflow, branding and actual Cloudflare CSP. All five platform
downloads remain present without JavaScript. The capture runner accepts an
explicit `WEBSITE_CAPTURE_BASE` so hosted acceptance is repeatable. Screenshots
and operational receipts stay in the private ignored report directory.

The portable stopping condition is met. DNS delegation, canonical hostname
binding, domain redirects and repository administration continue under the
private consolidation checklist; deployed preview acceptance does not claim
that jstorrent.com has already switched hosting.

A hosting supplement keeps canonical website deployment in this repository
without moving registrar DNS or mail providers. GitHub Pages will deploy the
same standalone website after successful Website qualification, using the
existing repository token and Pages environment. Cloudflare continues to own
the remote origin. Add document CSP for static hosts that cannot apply custom
HTTP headers; keep the stronger Cloudflare ancestor policy and remote policy.
Qualify the hosted artifact before moving the existing custom-domain binding.
Do not rename repositories or change email recipients as part of this slice.

The static-host supplement passes 54 package tests, Astro diagnostics and a
fresh 32-view browser acceptance run. HTML CSP precedes scripts without copying
header-only directives, and the remote HTML/header bytes are untouched. Bounded
waitlist fallbacks cannot redirect to arbitrary external destinations. The new
Pages job records source SHA and desktop version for exact hosted acceptance;
it does not need a cross-repository token or build the old TypeScript workspace.

The first GitHub Pages preview publishes successfully. Hosted acceptance finds
that the official artifact action excludes dot-directories by default, removing
both Digital Asset Links and source provenance. Enable its documented hidden
file input on the already-built public directory; `.git` and `.github` stay
excluded. This finding reinforces checking actual deployed routes before
moving the production hostname. Preview certificate issuance subsequently passed.

Final GitHub Pages acceptance passes all 32 responsive/theme views and all five
no-JavaScript download links. Both hidden-file routes are present; the provenance
receipt identifies source ec3ae246 and desktop 0.3.0. Canonical HTTPS cutover to
this artifact completed at 10:51:21 UTC. Apex and www, blog/RSS, privacy, forms,
prototype retirement and legacy URLs respond from the qualified source. The
six-file remote artifact and relay health remain verified at the original origin.
Marketing-only redirects preserve queries and exclude installers, pairing and
remote routes. The previous TypeScript website workflow is now manual-only.

An additional 18 deployed captures record nine historical compatibility and
diagnostic pages at phone/wide widths. All respond with intact images and no
RSTorrent display text. The old magnet helper overflows on phones; the streaming
helper also overflows and expects the retired Chrome App API. Three unlinked
launch diagnostic pages use plain styling. These inherited limitations are
recorded as design follow-ups, not claimed as modern-client functionality or
full Chrome App interoperability. Preserve their existing handler contracts.

Final validation: frozen standalone build, zero Astro diagnostics, 54 package
tests, nine remote assembly guards, zero website dependency advisories, real
17-file digest/six-signature verification, hosted promotion no-op and canonical
browser acceptance. No engine or product-client code changed. Infrastructure
receipts and per-slice reports/screenshots remain private and ignored. Mail
delivery and repository renames are not claimed by this portable completion.
