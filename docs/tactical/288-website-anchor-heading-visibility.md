# Tactical 288: Website Anchor Heading Visibility

Status: Complete locally, 2026-10-09, beneath finish-line259 and website287.

Owners: product-surfaces-and-migration here; website README and releases topic
in the existing JSTorrent repository. Its AGENTS.md and release contracts apply.

## Scope and stopping condition

Reproduce ordinary Download anchor navigation beneath the sticky website header
at phone and desktop widths. If the heading is obscured, add proportional scroll
spacing in the website stylesheet. The same320px capture also exposes header
controls overlapping the logo; place its controls on a second row at that width.
Direct fragment loading also misses Download before its client-only island mounts,
and initial FAQ scrolling is displaced by that later insertion. Reconcile the
current fragment after download hydration and font layout settle.
Contain the existing FAQ command in a horizontal scroller and wrap long release-
note tokens; preserve all text. Stop after actual before/after anchor captures,
focused fresh static builds, relevant formatting/documentation and local commits.

Non-goals: redesign, enabling production metadata, deploy/push, store edits,
changing desktop/Android/extension package inputs or public download availability.

## Invariants and validation

The real production descriptor remains disabled/null and byte-identical. Only
an owned temporary checkout may use synthetic candidate metadata; captures label
that scope. Exercise actual anchor links and observe heading/header geometry,
including direct fragment navigation at320/390/1200 widths. Check page errors,
image decoding and horizontal overflow. Reap the separately identified bundled
Chromium and local server, remove the temporary checkout, and keep report/media
ignored under259. No new mirrored unit test is needed for this bounded CSS change.

## Execution

Actual fragment captures reproduce initial Download navigation at scroll zero
and FAQ displacement after client-only insertion, beyond the sticky-header CSS
issue. The bounded mount effect realigns the unchanged current fragment after
fonts settle and cancels on unmount. All nine hero/direct Download/direct FAQ
views at320/390/1200px now have visible headings, decoded images, no page
errors or root overflow. Before/after screenshots are visually reviewed.

Fresh frozen synthetic-enabled before/after and final disabled six-page builds
pass. All24 production inventory guards, focused Prettier and tracked-archive
35-file documentation checks pass. Temporary checkouts/browser/server are
removed; the actual disabled/null descriptor is byte-identical. Owning website
commit is `4266be04331f8971eb7e3a078f9291af67e102b0`. No desktop package input, public download or deployment
changes. Separate ignored slice014 contains screenshots and scalar receipts.
