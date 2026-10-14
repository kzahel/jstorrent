# Tactical 340: Quiet Windows Network Startup And Firewall Qualification

Status: Complete implementation and bounded unsigned Windows qualification,
2026-10-14. VM clean power-off remains an operational cleanup gap. Maintainer
authorizes host development/checks, VM-first qualification, commit and push.
Topics: `client-surfaces`, `application-control`, `web-ui-design`,
`runtime-configurations-and-headless-deployment`,
`incoming-reachability-and-seeding`, `application-view-api`,
`oracle-driven-engine-campaign`, `capability-readiness`.

## Scope And Stopping Condition

Extend Tactical 339's desktop-owned quiet defaults and one-time upgrade hold
to Windows: incoming TCP/uTP Off and UPnP Off before ordinary networking.
Retain wanted torrents, paused intent, verified data, preferred ports and
unrelated shell preferences. Later explicit choices persist. Verify shared
incoming/forwarding controls and explain firewall recovery without inventing
permission state. Qualify an isolated native Windows candidate in the sibling
Machine Control development VM, with host builds and deterministic checks.
Stop after proportional Rust/web checks, native VM evidence, owned cleanup,
documentation reconciliation, commit and push. Signed shipping acceptance,
external unsolicited WAN reachability and release publication are not claimed.

Non-goals: adding/removing product firewall rules, automatic Allow, changing
Linux/Android/iOS defaults or Windows DHT demand, socket/route-selector redesign,
engine policy changes, OS permission APIs, signing, public swarms or release.
Only exact test-executable OS-created rules may be cleaned up after recording
denial/retry evidence. Preserve inherited VM/host rules and registrations.

## Invariants, Ownership And Bounds

- Desktop owns the existing bounded version-4 shell marker. Apply the existing
  transactional catalog hold before networking; persist marker 1 before control
  is exposed. Failed persistence joins the application and fails startup.
- The application/store own torrent intent, content authority and settings.
  The existing session reconciler/uTP generation owns incoming retirement;
  outgoing UDP/replies and loopback control remain usable while Off.
- Reset retains the marker. A fixed port becomes a retained preference. Shell
  background/notification/power choices survive v3-to-v4 migration.
- Protocol/domain dependencies still point inward. Add no runtime owner,
  transport, dependency, DTO or queue; reuse 339's cancellation/lease limits.
- Configured incoming, listener binding, firewall permission, mapping success
  and observed reachability remain separate. Cancel/retry must not rewrite OS
  rules or imply that a successful save/bind grants access.
- Fixtures use private tracker-free payloads, fresh paths/processes/ports,
  independent SHA-256, finite deadlines and joined shutdown. VM control uses
  exact-target claims and native guest operations; provider recovery is explicit.

## Source Dossier And Edge Checklist

Re-read exact upstream libtorrent `7d7fc38fac61177fa5e02148f791b2f65250b09d`
because the local checkout is absent: `src/session_impl.cpp::incoming_connection`
(TCP/uTP rejection and abort/paused guards),
`include/libtorrent/settings_pack.hpp::{enable_incoming_tcp,enable_incoming_utp}`
(independent incoming/outgoing settings), `test/test_utp.cpp::test_transfer`
(discovery/mapping disabled, small pieces, finished assertions, parallel abort),
and `test/test_session.cpp::reopen_network_sockets` (loopback mapping exclusion,
disable/reopen behavior). Adopt that separation and joined shutdown; retain
339's stricter pre-allocation SYN rejection and one product incoming control.
No upstream source/fixture is imported; no protocol behavior changes here.

Microsoft's [firewall rules](https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/rules)
document Cancel-created TCP/UDP block rules, block precedence and exact-path
identity. Retry cannot promise a new prompt. Tactical 338 supplies measured
Windows Cancel/relaunch/outgoing evidence; its pre-339 admission results are
historical. Tactical 160 owns the unchanged Windows route-probe fallback.
Inspect the legacy sibling's `desktop/io-daemon/src/http.rs::network_interfaces`
and `packages/engine/src/port-mapping/port-mapping-manager.ts::findLocalAddress`:
mapping needs concrete interface facts; do not substitute consent for selection.

Front-load: fresh versus v3/v4-unmarked upgrade; retained fixed ports, running/
paused intent and shell choices; later explicit enable/restart and Reset;
failed marker persistence; Off admission/cancellation/outgoing preservation;
forwarding Not now/Enable/save and atomic Off; persistent firewall denial;
truthful binding/reachability and recovery copy; bounded shutdown/cleanup.
Android is inapplicable to the new desktop defaults/marker/presentation slice;
339 already qualifies the unchanged common incoming boundary/build.

## Validation And Restart Checkpoint

Run native Windows desktop migration/config tests, common incoming/runtime
tests, fmt/clippy/workspace tests, web type/unit/localization/build checks.
Update `tests/windows-network-consent/Run-matrix.ps1` to assert current Off
silence/TCP refusal, On transfer and repaired diagnostic completion.
Exercise native candidate fresh/upgrade/relaunch, actual renderer/disclosure,
prompt Cancel/retry/restart, loopback control and independently hashed outgoing
TCP/uTP with intake Off, including denial. Distinguish loopback engine evidence
from cross-machine firewall outcomes and unsigned from signed identity.

Initial Machine Control doctor found the exact development VM running but
guest administration/resident unavailable. It subsequently reached Off without
an agent shutdown; an exclusive disruptive claim then started it. Recovery
capture showed Windows servicing at 100%. It finished normally; stored-credential
native login restored the guest route without force-stop or base modification.

## Implementation And Validation

Windows and Mac desktop now share `open_desktop_application`: hold unconfirmed
network settings before sockets, atomically persist marker 1 before exposing
control, and join shutdown if persistence fails. Ordinary launches do not rewrite
an already confirmed marker. Fresh Windows uses disabled intake/UPnP; Windows
idle DHT and all Linux/mobile defaults are unchanged. No engine policy, new
runtime owner, generated contract, dependency or OS permission field is added.
The helper extraction gives the actual GUI startup transaction a deterministic
test boundary. Shared forwarding copy is platform-neutral and Network details
offers conditional firewall recovery. Neither save nor bind asserts OS access.

The Windows runner now requires Off SYN silence/TCP refusal/zero uTP allocation
and repaired diagnostic completion against On. It checks client/server joins
and retains loader failure as a readiness error instead of masking it with a
terminal-owner assertion. The research example adds bounded stopped-profile
inspection and an optional explicitly owned private peer for native cross-VM
restore. The store migration test now independently asserts running and paused
intent. Native validation exposed five test-only SQLite cleanup failures: two
339 session cases and three Android cases removed their fixtures while clients
still held database handles. Drop the already-shut-down owners before removal;
no Android runtime/default/build/DTO change follows. The web style guard's URL
pathname produced `C:\\C:\\...` on Windows; `fileURLToPath` repairs its harness.

Commands actually run (native Windows Rust 1.97, repository environment sourced):

- `cargo fmt --all -- --check`: pass after final changes.
- `cargo test --locked -p rstorrent-desktop --lib`: 61 pass, including actual
  startup hold/relaunch and failed marker/join/retry. Portable shell tests cover
  v3 choices, atomic marker and Reset retention.
- `cargo test --locked -p rstorrent-session --lib`: 397 pass, two ignored after
  handle-release fixes. Strengthened
  `network_opt_in_upgrade_preserves_running_intent_data_and_port_preference`
  then passes focused with both running and paused torrents; an initial repeat
  exposed its old single-torrent index assumption, corrected to assert both
  preserved records and exact before/after equality.
- Combined native desktop/engine/session/Android run: Android 14 pass and
  desktop 61 pass; engine 593 pass, 12 fail, ten ignored, so Cargo stops before
  session. Android's Unix-only case is inapplicable on this host. The repaired
  Android teardown cases pass in that repeat. No APK/JVM gate was rerun for this
  desktop-only/runtime-unchanged slice.
- `cargo test --locked -p rstorrent-engine utp_runtime::tests`: 23 pass, one
  ignored. This includes incoming policy generations, outgoing preservation,
  zero Off allocation and joined owners.
- `cargo build --locked -p rstorrent-session --example incoming-off-research`
  and isolated `TAURI_CONFIG` native desktop/helper builds: pass.
  Final normal Preview build also passes and restores the host build identity;
  no host product GUI is launched.
- `cargo clippy --workspace -- -D warnings`: **fails**, first at three existing
  Windows `rstorrent-platform` dead-code diagnostics. Native scoped desktop
  `--all-targets` Clippy passes with command-only allowances for existing
  `dead-code`, `unused-variables`, `unused-imports`, `clippy::needless-return`.
  The research example passes with the same relevant allowances. No repository
  lint suppression is introduced; neither is a strict workspace pass.
- `cargo test --locked --workspace`: **cannot build** the existing Unix-only
  `rstorrent-headless::remote_admin` on Windows (nine compile errors).
  WSL strict workspace Clippy also cannot build: OpenSSL development metadata
  is absent. Attempted package installation refuses because dpkg was already
  interrupted; no package-manager repair or unrelated host package change is
  performed. WSL workspace tests do not run. These gaps are not green gates.
- `npm ci --prefix clients/web --no-audit --no-fund`, final web typecheck, full
  unit suite and production build: pass, 538 tests/two existing skips and CSP
  verification. Localization passes 1,337 shared web messages plus native
  catalogs. PowerShell runner parses without errors. No contract regeneration
  is needed because no boundary type changes.

The 12 unchanged native engine failures cover metadata discovery timing/counts,
TLS category matching, incoming acceptor replacement, MSE/fallback timing,
Windows UDP `10054` shutdown and oversize datagram sentinel behavior. Exact
failing cases are `driver::tests::discovery_metadata::{magnet_registry_fails_over_and_hands_same_peer_to_content_download,
metadata_default_cohort_is_paced_to_thirty_and_cancels_exactly,
tracker_only_magnet_discovers_registry_peers_and_downloads,
trackerless_dht_peer_completes_metadata_and_content_path}`,
`http_tracker::tests::runtime_system_trust_rejects_certificate_and_name_matrix_before_http`,
`incoming::tests::stable_runtime_survives_acceptor_and_slot_replacement`,
`peer_socket::tests::{prefer_does_not_downgrade_after_a_complete_invalid_dh_key,
shutdown_before_utp_result_retains_no_capability_outcome,
utp_connect_timeout_falls_back_to_tcp_in_same_attempt,
utp_fallback_and_silent_tcp_handshake_share_one_attempt_deadline}` and
`session_udp::tests::{oversize_input_is_bounded_to_the_dht_malformed_sentinel,
oversize_utp_input_is_bounded_to_the_utp_malformed_sentinel}`. Engine runtime
source is unchanged in this slice. These remain a separate native engine
qualification gap, not evidence against the narrower verified defaults/Off
and controlled transfer outcomes.

## Native Windows Evidence

Claimed Machine Control VirtualBox development guest, Windows x64 build
`26300.9457`, active Public network, all firewall profiles/notifications enabled.
Protected base untouched. Unsigned isolated executable/product identity and
profile; no installed product, primary browser or host desktop launch. The
runtime-only guest needs verified Microsoft-signed MSVC DLLs adjacent to the
owned app, research binary and versioned native helper. Initial missing-DLL
loader exit `-1073741515` is not counted as a networking result.

- Fresh native GUI uses marker 1, incoming/UPnP Off, three ordinary loopback TCP
  control/media listeners and wildcard outbound UDP. No firewall prompt occurs
  before explicit incoming enable. Windows DHT preference/demand is unchanged.
- Actual settings expose the two controls, hide ports while Off, show forwarding
  disclosure before intent/save, and keep **Not now** off. The final renderer
  includes the neutral OS explanation. Existing unit tests cover draft conflicts,
  disclosure cancel/enable, and the atomic Off/forwarding patch.
- Explicit incoming Save produces native Windows Security for **JSTorrent
  Network Test** (publisher text `jstorrent` in this unsigned fixture). **Cancel**
  creates two Public inbound block rules for the exact test executable. Incoming
  stays configured On and bound to 6881. Explicit forwarding/save reports router
  discovery failure. Restart retains On/UPnP and does not repeat the prompt.
  No Allow or product rule installation/deletion is performed.
- Turning incoming Off from On/forwarding On saves both disabled. TCP intake
  disappears; the same UDP port 6881 remains. Fresh raw SYN from 60849,
  CID 3749/sequence 46600, receives no packet. Independent stopped-profile
  inspection confirms both settings Off. Existing denial rules remain.
- Fresh-process `off / on / tcp / off` matrix uses server ports
  52823/52827/52837/52842, fresh raw source ports and randomized IDs/sequences,
  with prior failed-probe ports excluded. Off refuses TCP, sends no STATE and
  starts zero uTP connections. On validates all raw header/source checks,
  completes BitTorrent handshake and both independent-wire/repaired-diagnostic
  transfers. TCP-only is silent for uTP and completes TCP. Four payloads match
  independent SHA-256; every client/server ends with zero owned transports/tasks.
- Private tracker-free 131,803-byte/three-piece fixture has SHA-256
  `8279ab7386010af63a680dcff51eb38294755a74e0abc5395901b2717ceeab63`.
  Real desktop restores wanted intent while Off and denied, downloads across the
  VM's NAT host-alias boundary from host loopback seed 65436 using one uTP
  connection/138 datagrams, then independently from TCP-only seed 52957 using
  TCP fallback (no seed uTP owner, three classified attempt datagrams). Both
  file hashes match; stopped profiles remain Off/UPnP Off, wanted Complete,
  three verified pieces. Both host seeds join to absent UDP/uTP owners.
- Production extension origin attaches through the registered versioned native
  helper; bounded framed response is Ready and the helper joins. This is native
  bootstrap/control evidence, not a primary-browser integration run.
- Old fixed port 45432/UPnP On and an owned v3 shell record are prepared while
  stopped. Ordinary upgrade opens with only loopback TCP control, retains the
  exact completed/wanted torrent and payload, writes shell v4/marker 1, and
  preserves background False, notification False/True/False and power False.
  Data/intent/port/Off persistence are independently read back after shutdown.

## Limits And Cleanup Checkpoint

This completes the bounded Windows implementation and unsigned VM observations,
not strict workspace/native-engine or signed shipping acceptance. No firewall
Allow/regrant, unsolicited external inbound/WAN, real router mapping, enterprise
policy or complete adapter/VPN/offline matrix is claimed. NAT-crossing outbound
payloads do not establish WAN intake. Mac Developer ID behavior remains separate.

Cleanup verifies zero owned processes, restores both native-host registrations,
removes only two exact-path OS-created test block rules, and independently
preserves all 483 inherited firewall rules. Owned guest app profiles, WebView
cache, bundles, fixtures, runtime copies and eight captures are removed. Host
investigation artifacts and failed-test fixtures are removed. The protected
base and operator grants are untouched. Normal Preview build identity is restored.

The provider's initial clean shutdown, including its bounded scheduling assist
after the shutdown request, fails to confirm power-off within fifteen minutes.
With maintainer direction to pause/resume before shutdown and permission to
force-stop if needed, a new disruptive claim verifies Running, Paused, then
Running using the existing provider's exact-identity checks and operation lock.
The public ACPI shutdown command then succeeds: independent claimed status
confirms Off. No saved state or hard stop is used. The private Machine Control
journal records the recovery, and the cleanup claim is released.

Restart: implementation, bounded Windows evidence, app/rule/artifact cleanup
and VM power-off are complete. Implementation commit `a8f96458` is pushed to
`main`. The broader native engine/workspace failures above and signed shipping
qualification remain explicit follow-up work. No release is authorized.
