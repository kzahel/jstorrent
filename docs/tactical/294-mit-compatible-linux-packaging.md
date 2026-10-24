# Tactical 294: MIT-compatible Linux packaging

Status: Complete (bounded native packaging slice), 2026-10-10. User-directed beneath finish-line259/293.
Owners: product-direction, beta-release-readiness and desktop-jstorrent-replacement.

Subsequent259 qualification: authorized source `ff632f45`/run38050770001 passes
all signed lanes and collector. Independent exact ARM/x64 AppImages pass the
embedded custom-source/notice and reviewed GPL-chain gates with171/172 selected
components. Separate067 owns signatures/package receipts. Source delivery and
installed/runtime acceptance remain separate from this completed native slice.

## Scope and stopping condition

Retain MIT and remove the GPL-only runtime library dependencies confirmed in
both frozen AppImages. Prefer a small native build change that preserves the
existing Linux tray and WebKit application. Prepare and verify local inputs
before requiring a new signed Linux candidate. Existing2b83 receipts remain
exact-byte historical evidence.

Stop the implementation slice at verified native source builds, accurate custom
source/patch provenance, package guards and a focused Linux runtime check.
Original-signed packages, source delivery and publication remain under259/293.
If preserving the tray needs a new backend, substantial fork or new dependency,
present that tradeoff before expanding best-effort Linux scope.

Non-goals: engine/JNI/API changes, WebKit replacement, older-distro backports,
DEB/RPM delivery, iOS, changing MIT to GPL, signatures or publication.

## Sources and bounded implementation

Separate062 verifies174 x64/173 ARM component hashes and173/172 ELF dependency
sets. The TIFF loader requires TIFF, which requires GPL-2+ JBIG. The tray's
frozen libappindicator-sys0.9.0 loader selects Ayatana appindicator, which requires
GPL-3 indicator. These are library dependencies rather than GPL source tools.

Exact descriptor-bound libayatana-appindicator0.5.93 source is inspected:
`CMakeLists.txt` declares the indicator dependency; `src/app-indicator.c` includes
`indicator-desktop-shortcuts.h` and calls its desktop-shortcut API. That file
declares LGPL2.1/LGPL3 alternatives. Investigate disabling the unused desktop-file
shortcut path while preserving ABI, tray status/icon/menu and normal controls.
The current CMake has no such build option; no existing flag is claimed.

Rebuild exact selected TIFF with optional JBIG disabled. Inspect original Debian
changes and compiler/configuration paths before choosing flags. GPL build tools
are acceptable; do not confuse them with GPL-only linked runtime code.

Use original archives and independently authored bounded patches. Record source
and patch hashes, flags and outputs; preserve original copyrights and LGPL
source/patch obligations. Attribution must identify custom builds rather than
falsely identifying unchanged distro binaries. Never remove notices to hide a
dependency or delete a required library without rebuilding its consumer.

## Validation, ownership and next action

Prepare source/patch/compiler checks before booting a testbed. Machine Control
owns transport, claim, power and lifecycle; this repo owns build recipes, ELF/ABI
checks, packaging and assertions. Bound and observably terminate the runner,
clean only owned roots/mounts, power off and release on every exit. Headless
builds use no product profiles; the later tray smoke owns its product scope.

Verify changed libraries' provenance, required exported ABI, DT_NEEDED without
targeted GPL libraries and native closure. Check ordinary TIFF formats and tray
menus/events. Add meaningful packaging refusals so the dependencies cannot
silently return. Do not reject GPL text from unrelated tools/tests in a notice.

Separate063 now passes two bounded native x64 source builds. The final recipe
retains all sixteen Debian TIFF patches, disables JBIG and the unused Ayatana
desktop-shortcut path, and records original archives, copyrights, compiler,
configuration and output hashes. All41 tray/199 TIFF exports and versions are
retained, relocations resolve,130 TIFF tests and the owned offscreen GTK menu
probe pass. Original GdkPixbuf TIFF loading and ordinary codecs pass.

A copied frozen AppDir rejects before replacement and passes afterward with172
selected components. Custom-source attribution, source/patch materials and the
extracted MIT gate pass. The output hook replaces before attribution/signing;
both Linux workflow lanes build exact sources and repeat the extracted gate.
Historical signed packages remain untouched. Four new refusal/parser checks,
26 distribution checks and existing release-tool checks run locally. Owned
units/roots/mounts are removed, the VM is off and claims are released.

Separate064 now passes actual x64 before/after native window, background lifetime,
Show and normal Quit with owned empty/offline/statistics-off profiles. The product
process maps the rebuilt appindicator and no identified GPL library. Native
window/tray pixels preserve JSTorrent branding and presentation. The initial
harness incorrectly disabled background mode; its expected normal-exit failure
and cleanup are retained. Existing empty-detail copy and right-edge table clipping
remain design notes, not new packaging regressions.

Separate065 passes the same final recipe on native Ubuntu ARM64:130 TIFF tests,
41/199 original exports and versions, relocations, codecs, original loader,
offscreen GTK and source/notice/package gates. Its copied AppDir has171 selected
components and539 inspected entries; original bytes are refused. Five additional
real-output provenance/architecture/source/recipe mutations refuse locally. All
seven pinned files freshly download over HTTPS and verify against reviewed
sizes/hashes; owned download and mutable local staging roots are removed.

All owned units/processes/roots/mounts/captures are removed after export. Both VMs
are off and claims released. The bounded implementation stopping condition is met.
Next under259/293: obtain fresh original-signed Linux/Android candidates after
explicit push authorization, rebind source delivery to those packages and repeat
proportional installed qualification. ARM product UI and outer-runtime ARM relink
remain separate; native ARM build evidence does not clear them. The MIT decision resolves the
license-choice question; it does not authorize push or publication.
