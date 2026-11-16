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
