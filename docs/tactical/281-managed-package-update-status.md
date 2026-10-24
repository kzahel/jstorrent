# Tactical 281: Managed Package Update Status

Status: Complete locally, 2026-10-08. Native finish-line MSI finding under259.

Topics: `web-ui-design`, `client-surfaces`, `beta-release-readiness`.

## Current signed native MSI qualification, 2026-10-09

Exact original-signed a7ee65ed MSI now passes quiet per-machine installation,
actual native About & updates checks and ordinary tray Quit/reopen. Both
initial and reopened screens show Windows MSI, Manual update required and Open
release downloads, without automatic-check status or check/install controls.
Three real captures are visually reviewed; build/package facts and JSTorrent
window/header/shortcut branding are consistent. Owned synthetic empty session
and version1/statistics-off fixtures do not change an inherited privacy choice.

Independent cabinet extraction matches both actually installed first-party
binary hashes and both notice hashes. NSIS/MSI main hashes correctly differ:
after excluding PE checksum/certificate fields, only the expected locked Tauri
bundle-type marker differs. No whole-binary equivalence is assumed. The initial
comparison harness incorrectly expected equality, then three changed bytes;
corrected evidence observes the two differing positions within NSS/MSI.

Independent restoration matches100 registry scopes/nine file scopes. Owned
MSI registration/staging/capture copies are removed; no unrelated firewall rule
is removed. Windows is off and the claim released. The first native attempt's
already-open-settings assumption and command-size cleanup failure stay failed;
separate exact-owned cleanup confirms restoration and staging removal before
the corrected repeat. This qualifies current native presentation/restart,
not installer wizard, legacy MSI migration, full associations or automatic
updater acceptance. Detailed receipts/screenshots remain ignored under259.

## Scope and stopping condition

The exact signed source8c MSI installs and launches natively. About & updates
correctly identifies Windows MSI but initially says automatic updates are
enabled. Manual Check changes the status to package-channel guidance while
still displaying automatic-check/privacy copy and the same check button.
Actual native before/after-click screenshots record this contradiction.

Existing accepted policy keeps MSI, DEB, RPM and unknown packages outside
in-app checking/replacement. The controller already refuses their backend
check. Initialize their status correctly, preserve it on dismiss, avoid
allocating automatic-check timers, and show only the appropriate manual
release path. Keep in-app package and headless checking/channel behavior.
No updater endpoints, artifacts, signatures, statistics preference, package
ownership, install/relaunch logic or engine/networking policy changes.

The updater controller owns its existing generation, pending candidate and
schedule cancellation. Packages with no check capability own no check timers.
Their close remains idempotent; dismissed or programmatic channel/check actions
must not create misleading idle/automatic state or contact the backend.

Stop after meaningful policy/timer/controller and rendered-controls regressions,
full web typecheck/test, local labeled capture evidence and owning-topic updates.
Fresh original-signed installed Windows UI/restart evidence remains under259;
local render fixtures must not stand in for that native updated-artifact gate.

## Required validation

- MSI/DEB/RPM/unknown start in package-channel guidance, own zero check timers,
  stay there after dismiss and reject channel/backend checking.
- Ordinary app/NSIS/AppImage and headless preserve checking/install policy and
  existing cancellation/generation behavior.
- Managed rendered UI shows manual release guidance without automatic status,
  check/install controls or automatic-check privacy copy, including after the
  existing manual-check action. Support diagnostics and package facts remain.
- Full web typecheck/test and proportional screenshot/render verification.
- New exact-source signed build and native MSI updated screen remain required.

## Implementation and evidence

The controller initializes and dismisses to the existing manual-install state
for packages whose policy disallows checks. It allocates no automatic schedule
for them and rejects programmatic channel selection. The rendered Updates
section uses the same policy to omit check/install and schedule/privacy controls;
manual release guidance and support diagnostics remain available.

All four managed package policies have real-controller initial-render cases
and fake-clock checks for dismiss, startup/manual/install/channel attempts,
one-day advancement, zero backend calls/timers and idempotent close. Existing
in-app and headless behavior remains covered by the full suite.

Full web typecheck, production build/CSP validation and478 unit tests pass,
with two existing skips. The first
unit attempt incorrectly queried support privacy text outside Updates; the
scoped assertion is corrected and its original failed log retained locally.
All20 focused bundled-Chromium browser cases pass: four existing diagnostic
copy/download cases plus16 managed package/theme/320px-and1440px combinations.
They check real initial controller state, release destination, absent automatic
controls/copy, exported package facts, no external requests/page errors, no
horizontal overflow and no serious/critical Axe violations. Sixteen labeled
managed-render captures and a contact sheet are visually inspected. The first
browser assertion incorrectly used bundleType instead of the existing exported
package field; only that assertion changed before the successful repeat.

Playwright now defaults to its separately identified bundled Chromium instead
of selecting the primary installed Chrome in local runs. Its managed Vite
server and browser are reaped when tests finish. DEVELOPMENT.md records this
choice and the proportional support fixture command. No VM was booted for
these renderer checks. Reports/captures/logs remain in the ignored259 folder.

This changes production web payload after the previous frozen932 proposal.
Fresh exact-source signed package and native updated MSI screen/restart
qualification remain open under259. The source8c native screenshots remain
before-fix evidence; controlled renderer images do not establish installed
Windows acceptance.

The full default bundled-Chromium suite subsequently passes62 cases, with14
existing opt-in live skips. Updated production extension packaging also passes
54 extension cases/19-entry archive validation/13 companion CSP bundles and17
explicitly injected Android/Linux/cache journeys. These checks use owned test
browsers and do not substitute for installed or store acceptance.
