# 397 — Desktop maintenance release

Status: preparing the next signed Desktop Latest and Stable release.
Maintainer authorized desktop publication on 2026-11-16.

## Scope and source

Release the landed storage recovery and dependency/compatibility maintenance
since desktop 0.3.10. The source is upstream main at
`11e106804316fc48618ec650ac71f088b4fbb945`; preserve the original checkout's
unpublished remote-browser work. The verified public and draft inventory
allocates 0.3.11 next; the official selector remains authoritative.

Tactical 394 is a proposed plan only. This release does not implement or
claim native `jstorrent://` support, legacy Windows association takeover, or
website handler cleanup. The ChromeOS magnet fix is Android-specific.

## Invariants and validation

Preserve the JSTorrent identity, signing/updater roots, databases, downloads,
preferences and consent. Do not release to the frozen RSTorrent track. No
schema or protocol change is introduced by this publication.

Require exact-main full push CI and the existing five-target signed release
pipeline, including fresh strict dependency review, notices, corresponding
source and compatibility gates. Verify published asset hashes, updater
signatures and source identity. Capture the exact desktop host and client
roles and register the delivery. Use owned Machine Control testbeds for
proportional installed launch/reopen evidence, preserving their prior state.

Promote the same qualified Latest native bytes to Stable without rebuilding,
verify the public updater and promote canonical website downloads. Record
exact run IDs and evidence, then remove owned temporary assets and release
claims. Stop only when Stable and website delivery verify, or report a
specific failed gate without bypassing it.

## Preparation evidence

- Verified the complete exact public/draft inventory with write-capability
  discovery; interrupted 0.3.9 stays reserved and 0.3.11 is next.
- Thirty release-input, version-train, selector, promotion and ledger tests
  pass. Database compatibility, enforced Stable companion compatibility and
  the existing delivery ledger pass.
- Captured host and client roles from exact source `11e10680` using its own
  generated schema, runtime defaults and bundled client decoder. Delivery
  entries remain pending actual publication.
- Exact-main [CI 43941905640](https://github.com/kzahel/jstorrent/actions/runs/43941905640)
  passes every required job. Preparation was held off main until the selector
  pinned that exact source, avoiding cancellation of the full run.

The 0.3.10 ledger still said submitted despite its completed Stable promotion.
Reconciled its published/first-public fields against the exact public release
(17 assets, published 2026-11-08T15:55:44Z), tag source `1a49f4ab`, successful
promotion 42497004134 and Tactical 392's original delivery evidence. No package
or historical capture is changed.

## Signed release in progress

[Latest run 43949305235](https://github.com/kzahel/jstorrent/actions/runs/43949305235)
selects `desktop-latest-v0.3.11` from exact `11e10680`. Its selector refreshes
and accepts CI 43941905640, all published desktop inventories and reserved
drafts, and records the exact source/version/tag. Signed source checks and
original-root identity qualification are running; no publication is claimed.
The [release receipt](evidence/397-desktop-release-receipt.json) tracks this
source through later package verification and promotion.
