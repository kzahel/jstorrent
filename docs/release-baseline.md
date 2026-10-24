# First supported release baseline proposal

Status: **Session catalog baseline declared (2026-10-14).** Tactical
[345](tactical/345-supported-catalog-migrations.md) declares session catalog
schema 26, shipped by every public release since `android-v0.1.0` and
`desktop-v0.1.4`, the supported baseline. Shipped state is migrated forward and
never reset automatically; downgrade is not supported. The remaining rows
below are still a proposal.

## Decision record required before the declaration

Record the exact future version, commit, signed package hashes, supported
platform/package lanes, and support policy in the release tactical. A version
bump or successful build does not itself declare support. `0.2.0` is merely a
possible label; no command in this campaign sets it.

The desktop incubation identity stays `com.jstorrent.rstorrent`, with its own
update route and trust root. JSTorrent graduation, legacy migration, Android
production identity/store handoff and iOS distribution remain independent
decisions. Do not copy private machine inventory or signing credentials into
the baseline record.

## Candidate contract inventory

Freeze the candidate's actual fresh formats, not today's values by assumption.
The session catalog baseline is schema 26; later versions migrate forward
from it under Tactical 345.

| Authority | What the candidate record must pin | Required evidence |
| --- | --- | --- |
| Profile catalog and reset journal | Fresh schema, recognized reset range, fixed owned files, marker/report format and transaction order | Fresh/reopen, each recognized old format, interrupted reset, malformed/busy/unsafe/future rejection |
| Verified content and retained roots | Metadata identity, have/checkpoint rules, path or platform locator semantics, selected-file intent | Missing/corrupt/oversized payload, restart/recheck, revoked or missing root, independent seeding, keep-data removal |
| Product state | `product.db` format, identity ownership, counters/outbox bounds, disclosure and disable/reset rules | First open/reopen, corruption bounds, profile replacement, disabled/anonymous behavior and exact preview |
| Desktop shell | `desktop-shell.json` accepted version and fallback, background/notification/power policy | Joined Quit/restart, missing/corrupt settings, update and clean uninstall |
| Native platform root authority | SAF grants, Apple bookmarks/security scopes and platform file identity | Permission loss, repair, restart and payload preservation on each claimed platform |
| Remote authority, if supported | Authorized-client state, credential/enrollment formats, revocation semantics | Restart, revoke, malformed/future state, process ownership and confidentiality evidence |
| Application/client boundary | Generated contract/version and permitted client/server combinations | Generated-code drift checks and semantic command/view compatibility |

Remote previews are not automatically supported by a desktop release. Platform
capability locators are not portable backup paths. Record either tested support
or an explicit non-supported scope for every row that reaches the candidate.

## Compatibility and recovery matrix

| Transition or failure | Required outcome |
| --- | --- |
| Clean candidate install → reopen | Fresh state opens, root selection persists, one runtime owner, joined shutdown |
| Pre-baseline incubation catalog (schema 19 or 22) | Fail closed, byte-for-byte unchanged; only the user's Clear app data replaces it |
| Supported baseline → later supported version | Preserve declared durable intent through a reviewed forward migration and crash-recovery boundary |
| Newer unsupported/future catalog → older binary | Fail closed with a recoverable explanation; no automatic downgrade or deletion |
| Invalid, ambiguous, unsafe or busy private catalog | Refuse destructive guessing and preserve evidence/payloads |
| Process exit at every reset/migration checkpoint | Reopen to an unambiguous old/new state or finish the bounded journal; never widen ownership |
| Missing, changed or corrupt payload | Recheck/repair before verified status or upload; do not trust saved have bits alone |
| Root permission/availability loss | Retain intent, stop affected work truthfully, repair the same root authority when possible |
| Installed update/relaunch failure | Diagnose package replacement separately from runtime success; preserve payload and declared baseline state |
| User removal/uninstall | Distinguish keep-data, deliberate delete-data and private-state retention; preserve unrelated sentinels |

The conservative proposed rollback policy is **no automatic downgrade**.
Supporting binary rollback would require a separate tested state-compatibility
or backup/restore contract. Explicitly accept or replace that policy in the
first-supported declaration. Windows process-interruption evidence does not
prove arbitrary power-loss directory durability; Unix directory barriers do
not justify claims beyond the filesystem and test evidence either.

## Evidence needed to close the release

1. Run presubmit at the exact committed candidate, including native Windows
   session recovery, generated contracts, web type/unit/build/accessibility,
   both Android ABIs and the owned runtime cohort. September 12 hosted
   qualification now supplies Tactical 212/213 lifecycle/recovery and owned
   Android runtime evidence, plus the corrected Tactical 211 Windows native
   session gate. Preserve the exact source distinction in the
   [CI record](evidence/release-readiness-ci-2026-09-12.md); qualify again when
   the future candidate changes. Weekly performance run `34099890487` already
   satisfies CI-007.
2. Run the complete application lifecycle and scheduled topology/checkpoint
   cohorts with independent content hashes, seeding verification, corruption
   repair and zero-residue resource reports. Retain bounded, sanitized evidence.
3. Qualify the exact signed repaired Windows older-to-newer reset/relaunch
   and pre-update payload sentinel. Existing `0.1.1` → `0.1.3` replacement
   fails runtime startup. Linux x86_64 public update/picker/relaunch/removal
   passes, with visible GNOME tray presentation still evidence-limited.
4. Resolve the GLib GTK3 source-maintenance decision, validate the chosen
   repair in the full Linux product and remove its release blocker only on
   exact source evidence. Close native AppImage/platform and Android Maven
   notice coverage for every lane being declared; Rust/npm notices alone do
   not provide that clearance.
5. Package the local support export and truthful privacy/recovery guidance.
   Tactical 208 hosted feedback/privacy/uninstall deployment and remaining
   physical platform evidence are prerequisites for enabling its new context
   fields; leave them off until those prerequisites pass.
6. Record publisher identity, package/notarization/updater trust, content
   inventory, install/update/uninstall outcomes and supported-state matrix
   together. Obtain explicit publication/support-version direction only
   after the candidate and remaining decisions are concrete and reviewable.

No new migration reader, schema freeze, production route change or public
release was performed by preparing this record.
