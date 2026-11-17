# 398 — Desktop handler release

Status: preparing, 2026-11-17. Maintainer authorizes Windows VM verification
followed by desktop publication including Tactical 394's handler fixes.

## Scope and invariants

Qualify current main `747153335a1a0c5c7020793f14b9886c2029bcf6` in an owned
Machine Control Windows VM before public release. Exercise native
`jstorrent://launch` and magnet intake, cold and warm delivery, bare launch,
duplicate/batched input, invalid/local-path refusal and the shipped installer
registration boundary. Preserve the original app identity, signing roots,
catalogs, payloads, preferences, consent and other torrent clients' defaults.
Do not use the maintainer's Windows desktop as a disposable test environment.

Use a nonpublishing signed production-identity candidate first. A private
candidate version is qualification-only, never a public channel version.
Capture inherited VM power and scoped installation/registry state; restore
it and remove owned staging/processes before releasing the claim. Bounded
synthetic legacy classes can establish ownership behavior; they do not claim
every historical installed cohort. No download/public-swarm test is required.

## Release and validation

After Windows acceptance, use the official Latest selector with green exact
main push CI to allocate the next numeric version. Require all five signed
builds, source/notices, dependency review and compatibility gates. Bind exact
host/client captures and delivery entries to the released source. Carry
forward the established extension 1.1.5+ requirement and existing eight-field
acceptance; introduce no new mixed-version exception or schema migration.

Verify public asset digests, retained-root signatures, signed database facts,
source identity and live updater offers. Qualify the exact public Windows
artifact before Stable promotion, retaining the same native bytes. Promote
Stable and canonical website downloads, verify actual delivery, then commit
the evidence and clean temporary staging. A new remote-controller release is
outside this desktop publication, even though its bundled client recovery
source is included. RSTorrent publication remains frozen.

Stop when Windows verification, public Stable/Latest and canonical website
delivery are recorded, or identify a concrete failed gate without bypassing
it. Do not describe source tests as installed-artifact qualification.

## Preparation

Local main is clean and matches upstream `74715333`. The handler commit was
rebased with only documentation reconciliation; its product changes match the
original rex commit. All 46 packaging/handoff and 101 website tests pass.
The preceding web integration passed typecheck and 995 tests (three skipped).
Fresh full push CI and signed candidate qualification remain in progress.

Nonpublishing candidate [44038393213](https://github.com/kzahel/jstorrent/actions/runs/44038393213)
pins exact `74715333` and private version 0.3.60012. Its release-input and
original updater-root checks pass; source checks and native builds remain.
Exact push CI is [44037905694](https://github.com/kzahel/jstorrent/actions/runs/44037905694).
The owned Windows guest was initially off; its claim is held through startup,
qualification and cleanup. Administration is not yet ready, so no installed
acceptance is claimed.

Local `cargo fmt --all -- --check` and all 95 desktop library tests pass.
Thirty release selector/input/promotion/ledger tests and 70 released-host and
contract compatibility tests pass. Exact `74715333` host/client capture is
generated. Database compatibility and the enforced prospective Stable guard
pass; the current policy has already retired unsupported strict clients, so
this release needs no new acceptance entry.

The website builds with Node 24.22.1 and passes its security policy. Separate
headless Chrome for Testing verifies nine historical routes, query aliases,
three malformed/local-path cases, manual native escape and explicit
same-origin handler cleanup, with zero page errors and process cleanup.
The first local attempt used Node 22.23.3, below Astro's minimum 22.23.4;
that build stopped and the following route check saw stale output. Both
checks pass after rebuilding with the supported Node 24 runtime.

Full exact-source push CI 44037905694 is green. The private candidate's full
release source checks and retained updater-root proof pass; four signed
native lanes complete while Windows packaging remains in progress.

The Windows appliance required controller transport and credential repair.
The host routed its private VM subnet over the LAN despite an active VM
bridge. Interface-bound TCP/SSH succeeds without changing that route; the
task uses temporary interface-bound SSH and readiness-probe wrappers through
Machine Control's existing transport overrides. The native startup-repair
report confirms service/policy repairs but its original-route readiness wait
cannot complete; that stale wait is stopped after independently reading its
nonce-bound report, and its exact staging files are removed. No reboot,
outer UI or force-stop occurs.

The original stored appliance password fails independent Windows validation.
Machine Control rotates it, verifies it and atomically stores its replacement
in the existing private credential location. One submission of the verified
replacement completes native login. All required common-doctor checks then
pass. These appliance repairs are not JSTorrent acceptance evidence.

Qualification staging preserves 56 registry scopes, both registration
advertisements and four application/profile/shortcut file scopes. The owned
profile contains the seven-record schema-29 catalog fixture and schema-4
product fixture, all paused with discovery disabled and statistics opted out.
Synthetic legacy classes are confined to the preserved test-appliance scope;
no protected UserChoice value is edited.

## Windows diagnostic capsule and capture correction

Candidate 44038393213 builds and signs all five platforms, but its Windows
lane fails at `Verify installed Windows activation registry`. Tactical 394
extended the package validator to require `jstorrentUrlProtocol` and
`jstorrentCommand`; the workflow's real registry capture still supplies only
the older torrent/magnet fields. The collector correctly refuses incomplete
legs and nothing is published. This is not a successful release candidate.

The retained diagnostic NSIS/MSI both independently verify against the
original JSTorrent updater root. The NSIS and installed executable have valid
Kyle Graehl Authenticode signatures. Installing that exact NSIS into an owned
Unicode/space-containing directory in the claimed VM proves the current
scheme, quoted commands, both owned legacy aliases, new capabilities and
retirement of the obsolete advertisement are actually present.

The narrow workflow correction captures the two required fields for the
production product. Replaying its exact updated capture block against that
VM installation passes the unchanged package validator. Other product
branches remain unchanged; no protocol or application source changes.
The final release source will include this correction and must pass new
exact-main full CI and all signed release gates.

The diagnostic installed app passes its native WebView/IPC assertions: cold
and warm launch, ordinary OS `jstorrent:` dispatch after Quit, bare launch,
explicit old file/magnet class dispatch, distinct two-URL batching, duplicate
suppression, Unicode torrent path delivery, background-owner activation and
local-path refusal. All pending items are cancelled without Add confirmation.
Four ordinary application-shutdown cycles terminate their owned processes.
This prepublication product evidence does not qualify the failed pipeline;
the final public Windows bytes require their own installed checkpoint before
Stable promotion. Real historical Inno installer cohorts remain separate.
