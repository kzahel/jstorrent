# 397 — Desktop maintenance release

Status: signed native builds and Mac runtime qualified; completing the
private 0.3.11 corresponding-source offer before Latest/Stable publication.
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

## Qualified native capsule and source-gate recovery

All five signed jobs and release source checks in run 43949305235 pass.
Independent Intel and Apple-silicon app checks pass original updater-key,
code-signature, Gatekeeper, staple, thin-architecture, identity and version
verification. Both packaged Info.plist files register only `magnet`.

The exact Apple-silicon package passes actual native cold launch, normal Quit
and reopen on an owned macOS 26.6.2 guest. The copied released catalog v29 and
product v4 fixtures retain seven torrent identities, product identity, schema
integrity and statistics opt-out. The reviewed native window shows six
unarchived and one archived item. All torrents are paused with DHT/PEX off;
no payload-download, DMG drag-and-drop or Windows/Linux installed-runtime
claim is made. Six inherited scopes restore and hash-verify; owned staging,
capture and keep-awake process are removed, the test app is unregistered,
the guest shuts down through its normal menu and its claim is released.

The original collector stops before publication at the corresponding-source
gate, first reporting GStreamer Base Plugins `1.24.2-1ubuntu0.7`. The full
85-pair x86_64 / 84-pair ARM64 comparison also identifies libsoup3
`3.4.4-5ubuntu0.11`, PCRE2 `10.42-4ubuntu2.2` and SQLite
`3.45.1-1ubuntu2.9`. Fourteen primary Ubuntu descriptor/referenced files
(20,522,446 bytes) verify by identity, size and SHA-256. Review reads the
original COPYING/LICENCE notices and Debian copyright/changelog, including
the PCRE2 format-1.0 Debian diff. All original component terms and patches
travel unchanged in the existing source/relink offer; no upstream code is
added to the application. The native source README records reuse terms.
Both complete source-pair comparisons now have no unreviewed identities.
Thirteen source-packager tests pass. The complete source carrier assembles
with 781 vendored Cargo packages and empty-Cargo-home offline metadata for
both Linux targets. Its index binds source `11e10680`, all 85 current native
source pairs and input-pin hash `b22a679c`. The 1,401,047,218-byte carrier
has SHA-256 `fe0e04b8b0b19fcf8d86f895e73e2cfac6c1a1b07620f19f4a787f94b2abdfbc`.

Private draft 447628662 contains the original fifteen core assets and initial
checksum inventory. All sixteen downloads match GitHub sizes/digests, and all
six native updater signatures verify against the retained root. Follow the
same-source completion procedure documented in Tactical 389: keep application
source `11e10680`, every native payload/signature and authenticated updater
facts unchanged; add the complete source carrier, update its checksum and
release notes, and repeat the maintained complete-draft gates. Record this
local recovery separately from the failed collector. A different application
source would require a new numeric version. Stable and website remain pending.

All five original CI leg records independently match run 43949305235,
attempt 1, version 0.3.11 and source `11e10680`; their asset sizes/digests
match every native item in the retained private draft. Retained-root signed
database facts and all eleven native selectors verify. Database facts match
the unchanged source registry and preserve forward compatibility from signed
Stable 0.3.10. Complete source upload, final private-draft verification and
public Latest/Stable/website delivery remain pending.

## Latest public

The complete seventeen-asset private draft passes the maintained final gate.
Latest 0.3.11 publishes at 2026-11-16T22:35:36Z from exact `11e10680`.
Every cached full asset matches the public immutable size/digest inventory;
all six retained-root updater signatures, signed database facts, eleven
selectors and unauthenticated first-1024-byte probes of all seventeen public
downloads pass. The qualified Mac archive hashes match the public capsule.
The delivery is registered with both host and client captures. Stable and
canonical website promotion remain pending.

The first dual-role desktop delivery exposed an omitted test-policy surface:
its exact captured decoder accepts all raw frames and unknown optional fields,
but the absent desktop `tolerantSince` entry defaulted it to strict. Record
0.3.11 as the first qualified tolerant desktop client capture. This changes
release-test classification only; no decoder, exposure, support window,
application source or signed package changes. The initial targeted run passed
58/59 checks and failed only the contradictory strict-rejection expectation.

With that qualified test-policy entry, all 92 targeted released-host/client,
window and contract checks and seven release-policy tests pass. The enforced
Stable companion guard passes. Web typecheck and the full web suite also run
for the policy-file update before the delivery commit and Stable dispatch.
