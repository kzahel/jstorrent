# Tactical 239: Desktop Suspension And Browser Recovery

Status: **Complete bounded available-platform matrix, 2026-09-29.** Campaign 231; follows 234/237.
Topics: `client-surfaces`, `runtime-configurations-and-headless-deployment`,
`application-connection-architecture`, `desktop-jstorrent-replacement`.

## Scope And Stopping Condition

Use the final installed beta packages and fresh controlled roots on claimed
macOS/Windows/Linux guests. Close/restart the separate test browser during a
private bounded transfer, reopen its existing extension page attach-only and
prove the same runtime/library, tray and converged state. Verify complete
payload with an independent SHA-256 and authoritative piece counts.

Query real guest sleep/wake capabilities first. Exercise supported target
suspension/resume and actual guest sleep/wake only with a supported recovery
path. VM snapshot/pause, native OS sleep, browser closure and discarded-page
freezing are distinct evidence classes; never relabel one as another. No
controller sleep, outer input, unsupported hypervisor mutation or policy bypass.

Stop after the bounded available-platform recovery matrix, explicit Quit plus
browser restart without resurrection, fresh user-intent relaunch, resource
samples and cleanup. Native OS sleep unavailable in virtual hardware remains
a physical-platform qualification gap. No broader endurance or release claim.

## Contracts And Ordered Work

Keep 234's one runtime, persistent tray, attach-only passive reconnect and
native tray Open rules. Reuse its 32-MiB independently generated fixture and
bounded libtorrent seed; no public swarm, personal content or importer.
One task owns the seed, server, browser and any exact guest-access firewall
rule; close/join, delete owned artifacts and release claims at completion.
No engine/protocol algorithm or Android behavior change is planned.

Review 165's power policy, current connection/page cleanup, pinned keepawake
platform adapters and official Apple/Windows/Linux power documentation before
power experiments. Preserve settings and distinguish a user-forced suspension
from idle-sleep inhibition. Run scripts and affected builder tests before
installed experiments. A discovered engine fix requires the engine campaign
source/test oracle and Android parity analysis before implementation.

For efficiency, a platform's 239 cases may reuse 237's still-owned controlled
installation before cleanup; evidence remains under this separate tactical.

## Initial Platform Evidence

Reviewed pinned keepawake 0.6.1 `src/sys/{macos,windows}.rs`, Apple's installed
`pmset(1)` scheduling/sleep contract and IOKit `IOReturn.h`, official Windows
[SetThreadExecutionState](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-setthreadexecutionstate)
and Chrome [worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle).
Active downloading holds an idle-system-sleep assertion, not a system-sleep
or display assertion. No worker keepalive is introduced.

Windows 11 build 26200 virtual firmware reports every sleep/hibernate state
unavailable (`powercfg /a`); Machine Control also does not advertise provider
suspension there. macOS 26.6.2 advertises sleep, but root `pmset sleepnow`
returns `0xe00002e2` (`kIOReturnNotPermitted`). The exact task-owned scheduled
wake is cancelled afterward; no inherited wake event existed or was removed.
These are testbed limitations, not passing native sleep tests. Supported Tart
suspend/resume is exercised separately without claiming native OS wake events.

The new opt-in `verify-desktop-suspension-recovery.mjs` uses attach-only
bootstrap, bounded six-second replies and 180-second progress observations.
It records sanitized root/torrent identities, verifies the same runtime and
non-regressing piece counts after recovery, and independently hashes the
32-MiB controlled payload at completion. Its WebSocket-open promise has no harness deadline; the fresh Linux keyring
dialog exposed that diagnostic limitation. Reply and progress bounds below
remain enforced after connection. It accepts the existing paused
compatibility fixture beside the active transfer. Its first live record
found ambiguous text `connected` (connection health plus a live peer); scope
the wait to the connection div, leaving authenticated identity checks intact.

## macOS Transfer Recovery

The first VM pause run is **invalid as transfer-recovery evidence**: the
fixture bound libtorrent to port zero and captured that port once in its
tracker response. Host interface refresh reopened its listener on a new port,
while the tracker kept advertising the closed old port. The UI truthfully
showed the sole peer failure-limited after three failures; 119/512 pieces
remained verified. Reachable HTTP tracker and live runtime were insufficient
to establish a healthy seed. No engine change was made.

The fixture now selects one ephemeral port before session creation, uses that
fixed port with `listen_system_port_fallback=false` and
`max_retry_port_bind=0`, and checks the live listener on every tracker reply.
A missing listener returns HTTP 503 rather than a stale compact peer. Its
receipt includes listener/tracker ports. Reviewed pinned libtorrent
`7d7fc38f` `include/libtorrent/settings_pack.hpp` listen-interface and fallback
contracts and `src/session_impl.cpp` listener reopening. This changes only
independently authored test infrastructure, not product networking or Android.

Repeated with a new owned transfer in the same native-selected root. The
runner recorded 2/512 verified pieces, then common `target suspend` and
`target ensure-ready` preserved runtime identity and reached 41 pieces.
`verify-desktop-intent-lifecycle.mjs browser-close`, a real test-browser restart
with `--restore-last-session`, and attach-only recovery reached 69 pieces
with unchanged runtime/root/torrent identity and intent. Removing the temporary
64-KiB/s client limit completed all 512 pieces within the 180-second deadline.
Independent file read verified 33,554,432 bytes and SHA-256
`99080b09c925782f67975d36476f171ee4e8b367e2a893d07a88bd70028b3fe8`.
The seed retained its fixed listening port and an established guest connection
after resume. Native tray Show also opened the same library while the browser
was closed in the first run. One sample was 142,256 KiB RSS; this is a sample,
not an endurance bound. Joined Quit/browser restore and final cleanup pass
as recorded below. Windows and recreated-Linux evidence follow below.

## Windows Browser Recovery

The fixed-listener private seed uses libtorrent 2.0.13.0. Record 3/512 verified
pieces, close the actual test browser and native window, then reopen the test
browser with session restoration. Attach-only recovery observes the same
runtime/root/torrent and 104 pieces. Remove the temporary 64-KiB/s limit;
completion reaches 512/512 and independent SHA-256 verifies the exact 32-MiB
payload above. A detached sample is 54,579,200 bytes working set / 486 handles.
Joined tray Quit, browser restart, two passive reload/worker-stop cycles and
35 seconds do not resurrect; explicit Start succeeds. No Windows native sleep
or provider pause is claimed. Inherited-state restoration passes all 319 file
hashes, eight registry states and 1,482 source-overlay paths; guest is off and
claim released. macOS cleanup restores its inherited suspended state and
releases its claim; no owned browser/runtime/helper remains.

macOS also passes joined Quit plus browser restart, two reload/worker-stop
cycles and 35 seconds without resurrection, followed by explicit Start.

Linux initial readiness passed, but GNOME Shell segfaulted in
`libgobject-2.0.so.0.8000.0` at 16:22:22 UTC during initial native UI setup.
Wayland disconnected and the product exited with broken-display-pipe errors.
Doctor then reports missing desktop/resident, with guest administration intact;
`ensure-ready` directs a read-only maintenance audit. Recovery follows below.
This is neither passing suspension evidence nor a diagnosed product regression.

Linux read-only maintenance audit finds a healthy package/guest-agent baseline
but unavailable resident after the compositor failure. Common `target reboot`
and `target ensure-ready` restore an unlocked, fully ready desktop. Native UI
setup now succeeds. No guest policy, package upgrade or Machine Control source
change was needed; keep the earlier compositor crash in the evidence.


## Earlier Linux Blocker And Restart

Historical attempt, superseded by the recreated guest below. The manual-unlock
guidance was subsequently corrected: always discover the stored credential
through Machine Control private inventory first. A missing secret-safe Linux
UI delivery route is a provider gap, not a prohibition on stored passwords.

The recovered session reaches its inherited five-minute lock before native-root
selection completes. Doctor explicitly reports `desktop=locked`; inherited
`lock-enabled=true` and `idle-delay=300` remain unchanged. Stop interactive
work and request direct user unlock. No password, lock bypass or reboot to
avoid authentication is used. A later doctor still reports locked. No Linux
239 transfer/browser/sleep result or 238 signed updater result is claimed.
The native app had started and displayed its folder dialog; no root/torrent was
added and no test browser was launched. `/sys/power/state` offers `freeze mem`,
with `[s2idle]`; no native sleep or RTC wake event was attempted.

The installed debug DEB is 235's qualified x86_64 artifact, SHA-256
`f797456de043dd7002f5f4bb3d0c537b18f04c7e55ed0efef83d99f3b6c5576c`.
Before installation, ELF architecture and all `ldd` dependencies are checked
against Ubuntu 24.04.4 x86_64 / glibc 2.39 / WebKitGTK 2.52.6. For the planned
AppImage lane, apt simulation and installation add only `libfuse2t64`
2.9.9-8.1build1, following the official AppImage Ubuntu guidance; this is test
preparation, not installed signed-update evidence.

With no unlocked session available, cleanup stops the exact owned systemd user
unit through guest administration. This is cleanup termination, not native
Quit evidence. Remove only the newly installed `rs-torrent` and `libfuse2t64`
packages, fresh product profile, task directory and owned screenshot; no
`autoremove`, policy change or inherited data deletion. Verify owned executable,
process and artifact absence, return the guest to its inherited off state and
release the claim. Remove owned controller seed/server and exact temporary
firewall rules. Incremental builder caches remain.

## Recreated Linux Guest: Browser And Transfer Evidence

Explicitly authorized disposable-VM recreation follows Machine Control Tactical
048, with official-image checksum, exact-identity claims, development bootstrap,
portable checks, native smoke and a verified registry-located password file.
Ubuntu 24.04.5 x86_64, glibc 2.39, GNOME 46 and WebKitGTK 2.52.6 satisfy the
qualified DEB's architecture and `ldd` checks. Reuse the DEB hash above and
236's beta ZIP SHA-256
`a21fb6e52ee720a83987d0b5094a60e1a338014c024cdaa977cbcadd47538533`.
Chrome for Testing 151.0.7922.34 (Playwright revision 1234) is a separately
identified guest browser, with its supplied root-owned mode-4755 sandbox helper;
no `--no-sandbox` or browser security exemption is used. The first-run GNOME
keyring creation dialog blocks Chrome networking while native bootstrap already
works. Cancelling that dialog restores authenticated WebSocket attachment.
No additional password is created. Reapply cancellation after browser restart.

Create the final fresh library/root using native privacy and folder-selection
UI, with usage reporting opted out. The root is outside the boot-cleared `/tmp`
tree. Configure private-only fixture settings with
`verify-desktop-extension-checkpoint.mjs prepare`, then the suspension runner's `limit`, add the torrent,
and `record`. Record **2/512** verified pieces. Close the native window through
its real Close action and close the actual browser with the lifecycle runner's
`browser-close`. RSTorrent's registered tray remains present; a detached sample
is **240,392 KiB RSS / 38 threads**, not an endurance/high-water bound.

Restart the same test browser with `--restore-last-session`; attach-only
`recover` proves unchanged runtime, root, torrent identity and running intent,
with **31/512** verified pieces. `unlimit` and `complete` finish all **512/512**
within the 180-second runner deadline. Independent file reading verifies
33,554,432 bytes and SHA-256
`99080b09c925782f67975d36476f171ee4e8b367e2a893d07a88bd70028b3fe8`.
The fixed-port seed uses libtorrent 2.0.13.0. No public swarm or personal data.

Invalid authentication returns `authentication_failed` without a library;
12 repeated clicks retain one focused extension page, and 12 concurrent start
requests report one runtime identity. Invoke the registered native tray's
`Quit RSTorrent` through its discovered D-Bus menu, close/restart the browser,
then run `passive-stopped`: two page/popup reloads, two worker stops and a
35-second observation refuse attach and leave the runtime stopped. Explicit
`Start` then succeeds with a new instance and the same root/torrent and all
512 verified pieces. These are fresh installed checks, distinct from builder
source tests and the older 234/235 matrices.

## Linux Sleep Attempt: Not Qualified

Review [kernel sleep-state documentation](https://docs.kernel.org/admin-guide/pm/sleep-states.html),
[`rtcwake(8)`](https://man7.org/linux/man-pages/man8/rtcwake.8.html), Tactical 165
and the GNOME suspend-inhibitor adapter. The guest advertises `freeze mem`,
`mem_sleep=[s2idle]`, RTC wake enabled and no pre-existing wake alarm.
`rtcwake -m on -s 2 -u` completes its alarm precheck. A forced
`rtcwake -m mem -s 20 -u` then loses the guest-agent transport and does not
restore SSH or resident readiness. The provider reports running; no successful
kernel suspend-exit receipt is available. Stop owned pending diagnostics before
using supported exact-target `testbed -- force-stop`, then `target ensure-ready`.
Readiness returns in 14.235 seconds, with a new resident generation, and the
canonical stored login password still verifies. No firmware/power policy is
changed to manufacture a pass. This is a **failed guest sleep/wake qualification**,
not passing suspend-to-RAM, VM pause, or a diagnosed RSTorrent regression.

The first browser run had already advanced 3 to 68 pieces with the same owner,
but reboot cleared its `/tmp` payload and browser fixtures. Restaging the path
did not provide a valid continuation receipt: the old snapshot reported awaiting
storage and an attempted native Repair was refused as an available-root
reselection. Discard that run as complete-transfer evidence; the final fresh
profile and persistent-across-boot fixture directory above repeat the browser
matrix independently. No crash/power-loss recovery claim follows from the
forced-stop cleanup. Native physical sleep/wake and broader endurance remain
open; do not repeat this VM sleep route without a qualified recovery path.

Explicit Start exposes no native window in the AT-SPI snapshot; native tray
Show then opens it. Final joined Quit, process/artifact absence, ready doctor,
clean shutdown and released claim pass; see 238 for exact cleanup and the
separate signed AppImage evidence. No importer starts.

## Reproducible Runner Sequence

Run the fixture on the builder with `uv run --project tests/interop --locked
python tests/interop/desktop_extension_seed.py --root "$FIXTURE_ROOT"
--bind "$GUEST_REACHABLE_ADDRESS" --seconds 1800`. Copy only its generated
metainfo and the runner into the claimed guest. Use the native-selected root
and guest-owned Chrome for Testing CDP endpoint; preserve credentials in memory.

```sh
node scripts/verify-desktop-suspension-recovery.mjs limit
node scripts/verify-desktop-suspension-recovery.mjs record "$BASELINE"
# Supported VM suspend/resume, or real browser close and session restoration.
node scripts/verify-desktop-suspension-recovery.mjs recover "$BASELINE"
node scripts/verify-desktop-suspension-recovery.mjs unlimit
node scripts/verify-desktop-suspension-recovery.mjs complete "$BASELINE" "$PAYLOAD"
```

Set `RSTORRENT_PLAYWRIGHT_MODULE` to the guest's installed Playwright module;
use the runner's CDP override when its default differs. Final source validation:
21 release/package/input Node tests pass, macOS desktop library 53 tests and
Windows desktop library 50 tests pass, Node syntax and Python compile checks
pass. Runtime production code is unchanged in this slice; these are not full
workspace Clippy/test claims. Installed observations above are separate from
scripted assertions and single resource samples are not high-water bounds.
