# Tactical 283: Companion Update Recovery Guidance

Status: Complete locally, 2026-10-09. First source/render pass of the update scenario
checklist, beneath finish-line Tactical259.

Topics: product-surfaces-and-migration, web-ui-design, client-surfaces,
application-view-api and localization. Read their current contracts plus248.

## Scope and stopping condition

Make desktop version/unavailable recovery and Android extension-update recovery
actionable with named components, existing public product links and native-use
guidance. Capture the unchanged packaged screens first, then before/after
screens of the changed product. Fix proportional narrow-window presentation
issues observed in those captures. Stop after focused behavior/accessibility
and full web checks, production package/CSP validation, screenshots shown to
the maintainer and living-topic/checklist reconciliation.

Non-goals: new protocol/version negotiation, legacy engine compatibility,
new native launch/pairing authority, store submission/publication, updater
route activation, Linux build policy implementation or iOS. Public links
identify existing products; they do not prove a successor update is offered.

## Invariants and owners

Existing desktop/Android connection owners keep their attempt, abort, retry,
cleanup and pairing behavior. Version/authentication retry stays attach-only.
No extra transport probes, timers, remote scripts or dependencies are added.
Unknown transport failure cannot establish which component is outdated; a
general desktop mismatch names both checks without claiming a precise diagnosis.
Product copy lives in the English catalog. Native/extension/store identities
and existing credentials/storage remain unchanged.

## Evidence required

- Terminal mismatch does not launch the backend or fall back to legacy I/O.
- Recovery links are visible only in relevant failure states and have fixed
  existing-product HTTPS destinations, safe new-tab attributes and accessible
  labels. Android and desktop links do not leak into the other backend view.
- Narrow and ordinary viewport screenshots, no horizontal overflow, keyboard
  access and no serious/critical accessibility errors in changed states.
- Full web typecheck/tests, production companion build/CSP and archive validation.
- Real installed/store delivery remains unchecked under259. Label all injected
  transport/permission captures honestly and keep images in the ignored report.

## Implementation and evidence

Desktop mismatch now offers the desktop website and existing extension store
listing, explains native use while updates arrive, and preserves uncertainty
about which component is outdated. A known unavailable native registration
gets install/update/open-once guidance; an ordinary stopped runtime keeps
Start without install/update links. Authentication refusal retains attach-only
Retry without irrelevant download guidance. Retry hides stale recovery links
while the next outcome is unknown.

Android extension-update errors now show the existing Web Store link. Android
app-update errors keep their Play link. Permission and unreachable messages
name the user action instead of presenting diagnostic uncertainty as product
copy; optional support context retains unknown facts. Bundled help offers both
store links and waiting/native-use versus unsupported-OS guidance. Action-link
text contrast is corrected without changing the existing theme or navigation.

The package validator initially rejects the new navigation hosts. The original
failed package log remains in ignored evidence. Its reviewed-origin inventory
now includes those two product navigation hosts, with two added lookalike-host
refusals. Manifest origins, connect CSP, backend transport and permissions stay
unchanged; product navigation is not a new remote-code/network authority.

Validation: full web typecheck,481 unit cases (two existing skips),56 extension
cases/source validation, all localization catalogs, branding2040 display values/
40 original assets, production web/companion build and CSP checks pass. Seventeen
existing packaged onboarding/cache journeys pass. Nine packaged connection
states are captured before/after at390/1100px; all revised connection states
also have320px overflow, keyboard/link and serious/critical WCAG checks. No
page errors, broken images or horizontal overflow are observed. Bundled
no-update help adds one before/after review at both widths:40 screenshots total.
Their transport/permission states are injected; they do not prove OS/store
update delivery. Browser processes and temporary extractions/profiles are reaped.
No VM is started for this presentation pass.

Images, notes and receipt hashes are in the wholly ignored259 evidence folder,
with a standalone ten-case review gallery. Maintainer feedback can revise these
copy/design defaults. Native old-extension/new-backend, actual new/new migrated
library, physical folder and final Linux fallback captures remain under259;
no full installed/store scenario row is marked complete by this local slice.

The new production extension ZIP remains version1.1.2 because that candidate
has not been uploaded; it supersedes the previous unpublished source03e bytes.
Its exact SHA-256 is `e9e75609d537355d4bee4639b57f9369203cdcb74886537ae1d90ac65b006527`.
The previous frozen13dde desktop and source03e upload proposals cannot qualify
this changed product payload. Prepare a revised exact-source proposal after
remaining Linux packaging changes; no push/build dispatch/store upload or
publication occurs in this tactical.
