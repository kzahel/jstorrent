# Tactical 338: macOS Network Consent Research And Plan

Status: Research complete locally; tighter uTP follow-up recorded, 2026-10-14.
Maintainer requests experiments and a written plan, not product implementation
in this slice. Windows remains a separate later session.
Topics: `client-surfaces`, `application-connection-architecture`,
`capability-readiness`.

Follow-up on 2026-10-14: maintainer authorizes one tighter Mac uTP experiment
round, then a check-in before UI design or Windows work. Use fresh processes
and explicitly exclude previous server/client ports, random connection IDs and
source/header validation, an unused-port negative control and TCP-only control,
plus a known valid BitTorrent fixture and independently hashed payload transfer.
Exercise the same native application service headlessly; no product policy
change or new permission grant. Research fixtures own bounded sockets, a finite
runtime deadline and joined shutdown. Retain all stopping conditions above.

## Scope And Stopping Condition

Determine which macOS operations trigger local-network privacy dialogs and
whether an outbound-only desktop can start without one until an explicit
feature action. Use isolated local probes and an isolated development app;
record launch attribution, no-incoming behavior, denial/restart and remaining
gaps. Stop with an evidence-backed implementation plan and cleaned experiment
processes/artifacts. Windows is a separate later session.

Non-goals: changing production defaults or engine behavior, implementing the
permission UI, publishing/committing, public-swarm tests, accepting grants for
the installed product, resetting the user's privacy databases or modifying
the primary browser. Local socket probes may trigger only clearly named owned
test-app dialogs; decline them or make an explicitly explained experiment
choice. Preserve inherited native-host registrations and operator grants.

## Hypotheses And Evidence Plan

1. A no-op GUI launch and public-address route selection do not need local
   network access; multicast UDP connect can trigger it without sending data.
2. Ordinary terminal children have different privacy attribution from a
   LaunchServices-launched app; terminal success is insufficient OS evidence.
3. Disabling incoming TCP and UPnP avoids the current multicast selection and
   SSDP paths, while outbound sockets remain usable. DHT and local destinations
   require separate policy; an empty library alone is not a network gate.
4. OS denial must not prevent app startup or misidentify permission as an
   absent router. Existing IPv4-only fallback handling needs scrutiny.

Validate with bounded Cocoa/socket fixtures and Machine Control observation,
then exercise the existing debug desktop with only test-profile settings.
No internet swarm traffic is required. Capture operation results, OS/build
identity, effective socket inventory and exact conditions. Fresh identities
must use distinguishable executable UUIDs; record limits of ad-hoc signing
and no-prompt observations rather than claiming universal permission proof.

## Source Review And Implementation Boundary

Apple TN3179 owns local-network operation and responsible-code semantics.
Review current listener/interface probe, coordinated socket startup, UPnP,
online endpoint policy, direct-file mDNS, desktop startup and shipping plist
metadata; Android Tactical 310 supplies the explicit feature-action pattern.
Inspect pinned libtorrent listening/mapping settings and tests before proposing
engine policy changes. The eventual platform consent belongs to the desktop
adapter; deterministic network policy and task cancellation stay engine/session
owned. Android defaults and Windows consent are not silently changed.

## Research Inputs

- [Apple TN3179](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy):
  local addresses are destinations directly reachable on broadcast-capable
  interfaces, not simply RFC1918 ranges. Multicast is local; UDP connect can
  trigger a dialog without packets. Incoming TCP alone does not require this
  privilege. Terminal children are exempt. No general permission-state or
  explicit request API exists; `NWConnection` can expose `localNetworkDenied`
  for a relevant connection. Stable responsible-code/signature identity matters.
- [Apple firewall guidance](https://support.apple.com/en-euro/guide/mac-help/mh34041/mac):
  incoming firewall approval is a separate boundary. The research VM's firewall
  was disabled, so this slice does not qualify firewall prompt behavior.
- Pinned libtorrent `7d7fc38fac61177fa5e02148f791b2f65250b09d`:
  `src/session_impl.cpp::reopen_listen_sockets`, `update_upnp`, `update_lsd`;
  `src/enum_net.cpp::enum_net_interfaces` (`getifaddrs` branch);
  `include/libtorrent/settings_pack.hpp::listen_interfaces`;
  `test/test_session.cpp` loopback mapping enable/disable/reopen case;
  `test/test_enum_net.cpp::{match_addr_mask,is_local,build_netmask_v4}`.
  Adopt separate listening/mapping policy, interface/mask/scope awareness and
  explicit task stop. Do not copy source or adopt empty `listen_interfaces`
  wholesale: libtorrent documents that this also disables DHT/outgoing UDP,
  while our desired mode preserves outbound transfers and their responses.
- Pinned BEP source `reference/bittorrent.org/beps/bep_0029.rst`, header layout
  and `ST_SYN`/`ST_STATE` sequence rules, defines the independently authored
  diagnostic's 20-byte SYN and matching STATE acknowledgement. BEP 3
  (`reference/bittorrent.org/beps/bep_0003.rst`) owns the 68-byte peer handshake.
  Pinned libtorrent `test/test_utp.cpp` disables TCP, UPnP/NAT-PMP, DHT
  and LSD while testing successful uTP; TCP enablement and uTP admission
  are separate policies there too.
- Current product: `incoming.rs::select_local_network_ipv4` connects to SSDP
  multicast as a route probe; `session_socket.rs::bind_ipv4` does this for a
  local listener regardless of UPnP. Fresh desktop settings start networking
  before the web UI. `session_utp.rs::run_session_utp` admits incoming streams
  independently of the TCP listener flag; `IncomingPeerHandle::admit_utp`
  has no disabled-listener check. `NetworkPolicy::Online` permits local peer,
  tracker and DHT destinations. Direct-file endpoints create mDNS/ICE sockets.
  React Connection settings offer automatic/fixed incoming ports but no Off
  choice. UPnP discovery failures display an absent-router message, and local
  address selection errors become `AddressUnavailable`. IPv4-only construction
  can propagate an error before the dual-family fallback. No production code
  changed during the research.
- Product history: Tactical 310 distinguishes explicit Android background
  enable intent from notification permission. Tactical 160 owns the Windows
  route-probe fallback; preserve it until the separate Windows session.
  Installed macOS 0.3.0 lacks `NSLocalNetworkUsageDescription`; Tactical 337's
  debug bundle includes it. Shipping metadata needs a separate correction.

## Experiment Results

Source revision: `c93357df`, with Tactical 337 development tooling in the work
tree. Machine Control's claimed macOS ARM64 VM reports macOS `26.6.2`, build
`25G83`, ordinary console UID 501, firewall disabled. The host was exclusively
claimed by another session; no host desktop operation was performed. Guest
execution/AX routes reported `hostInterference: none`.

The independently authored [fixtures](../../tests/macos-network-consent/README.md)
use distinct, independently linked Mach-O UUIDs and ad-hoc signatures. Native
AX action receipts and separately read JSON results establish probe effects.
All GUI cohorts use LaunchServices `open -n`; the Terminal cohort opens a
caller-owned `.command` file in Terminal. No public swarm or torrent payload
traffic is involved. The desktop profile was initialized by an offline gateway,
then edited only while its isolated app was stopped.

| Cohort | Operation/condition | Observation |
| --- | --- | --- |
| P1 | Fresh GUI app, no operation for at least 60 seconds | No local-network alert |
| P2 | Wildcard UDP bind and incoming TCP listen | Both succeed; no local-network alert |
| P3 | UDP connect to documentation/public address, no send | Returns 0; no local-network alert |
| P4 | Explicit button connects UDP to SSDP multicast, no send | Local-network alert appears; connect returns 0 |
| P5 | Decline and retry the ad-hoc multicast action | Another alert observed; connect still returns 0. This does not establish reliable persisted denial semantics |
| P6 | Fresh automatic multicast GUI cohort | Alert appears at startup |
| P7 | Automatic multicast executable as Terminal child | JSON confirms operation; no new local-network alert, including a clean relaunch after other probe alerts were declined |
| P8 | Fresh GUI `getifaddrs` enumeration | Returns interface records; no local-network alert |
| D1 | Actual debug desktop: TCP listener off, UPnP off, DHT off, IPv6 on | Native attach ready, library UI visually renders, no local-network alert. Only loopback TCP control/media listeners plus ephemeral session UDP |
| D2 | Same desktop: automatic incoming TCP on, UPnP off, DHT off | Local-network alert appears at startup. Delaying UPnP alone is insufficient |
| D3 | Restart with TCP/UPnP/DHT off and IPv6 off | Native attach ready; no local-network alert |
| D4 | One loopback uTP SYN to D3's session UDP port | Receives 20-byte STATE, type 2, acknowledging sequence 7. TCP Off still responds to an unsolicited uTP SYN; completed transport/BitTorrent handshake and payload admission were not tested |

The ad-hoc GUI alerts in this VM used executable labels (`probe` and a
truncated desktop executable name) and generic purpose text despite bundle
metadata. The host's earlier Tactical 337 alert used the correct app name and
purpose. Treat this difference and the repeated ad-hoc alert as identity/
attribution qualification gaps, not evidence of shipping permission behavior.
Do not infer consent from BSD `connect()` success, absent UI, or a plist alone.
No local-access Allow button was pressed in this session.

Passing deterministic checks, after sourcing `scripts/dev-env.sh`:

- `cargo test -p rstorrent-engine --lib session_socket::tests`: 15 passed.
- `cargo test -p rstorrent-session --lib
  application_incoming_bootstrap_is_disabled_or_exactly_fixed`: one passed.
- Cocoa/C fixture compilation, fixture syntax checks and `git diff --check`.
- Fixture invalid/zero port inputs exit 2 without opening a socket. The normal
  preview was rebuilt with `./scripts/desktop-bundle --build-only` after the
  isolated compile; web/CSP, Cargo build and strict bundle signature pass.

The existing disabled-listener test checks absence of a TCP observation; D4
shows why the implementation slice needs a real negative uTP admission case.
The D4 destination was `127.0.0.1` inside the guest, so no router, NAT mapping
or router hole-punch state participated. The app had restarted and disabled
TCP mode created a fresh UDP socket with an OS-assigned port; the experiment
did not assert that the numeric port differed from every earlier socket. The
minimal probe checked packet type/ack but did not validate the response source
or connection ID. A stronger regression must reserve distinct fresh server and
client ports, randomize and check connection IDs, validate the source endpoint,
and separately test completed BitTorrent admission with a controlled fixture.
An outbound-only payload transfer and settled OS-denied traffic/regrant are
still required; these startup/probe results do not prove them.

All owned GUI processes were gracefully quit, only the owned Terminal command
windows were closed, and inherited guest native-host registrations were
restored byte-for-byte. Test profiles, bundles, captures and temporary files
were removed on guest and host. The VM returned to its original powered-off
state through normal native shutdown, and the owned claim was released.
Inherited operator grants and the host desktop/browser were preserved. The
ordinary host preview bundle/compile identity was restored. Privacy history for
discarded ad-hoc identities may remain in the testbed; no privacy database was
reset or edited.

## Tighter uTP Follow-up, 2026-10-14

The same claimed Mac VM and firewall-Off environment was used, with the native
`ApplicationService` headless rather than a GUI client. This round tests engine
admission, not permission attribution. All sockets and destinations were IPv4
`127.0.0.1` inside the guest. UPnP, DHT/bootstrap, PEX, IPv6, trackers and public
swarm traffic were absent. Each cohort used a new process, case/profile and UDP
server port; uTP connection count was zero before probes. Earlier server/raw/
handshake ports were held by guard sockets. Failed download source ports were
also audited afterward: all 17 actual final-round server/client/control ports
were distinct from one another and from the excluded pilot ports. Failed
client attempts should be added to the exclusion ledger before invocation in a
future automated coordinator, rather than only after success.

A private single-file v1 fixture contains 131,803 independently generated bytes
and three SHA-1 pieces. The server verifies those hashes before intake, uses the
ordinary maintenance owner, and waits for seed admission Active/InactiveExempt.
The five-second handshake probe independently encodes the 68-byte request and
checks response protocol, exact fixture info hash and distinct server peer ID.
It uses a different peer ID from the payload diagnostic. Neither server nor
client initiates a connection before the probe.

| Cohort | PID / server port | Raw source ports | uTP reply | Handshake source / result | Payload source / result |
| --- | --- | --- | --- | --- | --- |
| TCP Off A | 9083 / 60319 | 58505, 57181 | Both valid STATE | 49959 / validated | 58977 / message timeout |
| TCP On | 9321 / 52990 | 53848 | Valid STATE | 53470 / validated | 53736 / message timeout |
| TCP-only | 9509 / 56709 | 62095 | No reply in two seconds; datagram received, uTP owner absent | Not attempted | Not attempted |
| TCP Off B | 9582 / 50884 | 50782 | Valid STATE | 60619 / validated | 51850 / message timeout |

Every positive raw reply matched source address/server port, uTP version 1,
STATE type, randomized connection ID and randomized SYN acknowledgement. The
four `(connection ID, SYN sequence)` pairs were `(11282, 53764)`,
`(53079, 52947)`, `(1317, 18067)` and `(41617, 44675)`; all IDs differ. Each
probe then sent RESET for its research connection. A verified unused UDP port
60828, probed from fresh source 55474, remained silent for two seconds. The
TCP-only server received/classified its one datagram but sent no reply.

**The original finding survives the tighter controls and is now stronger:
TCP Off completes unsolicited incoming uTP BitTorrent handshakes.** Router
mapping/hole-punch state, numeric port reuse and an unrelated sender cannot
explain these controlled responses. This does not establish unsolicited WAN
reachability, payload access or complete outbound-only semantics.

Payload evidence remains unresolved: the existing controlled-uTP downloader
completed handshakes but timed out waiting for a peer message after 20 seconds
in both Off cohorts and the On positive control. No independently hashed
payload was returned. The expected SHA-256 for the fixture is
`8279ab7386010af63a680dcff51eb38294755a74e0abc5395901b2717ceeab63`.
This shared stall is a separate diagnostic/runtime question; it is not evidence
that disabling TCP blocks payload, and this research does not repair it.

Pilot harness limits were corrected before the final matrix: the first
handshake probe included FIN-drain shutdown inside its evidence deadline,
misreporting a completed exchange as a timeout; the handshake evidence ends
before separately joined service shutdown now. Reusing one peer ID for the
handshake and download also introduced duplicate-peer rejection, so the roles
now have distinct IDs. Snapshot Complete alone was too weak a seeding readiness
condition; the final run starts the ordinary maintenance owner and waits for
actual seed admission. Payload stalls persist with those corrections.

Validation: `cargo build -p rstorrent-session --example incoming-off-research`,
`cargo clippy -p rstorrent-session --example incoming-off-research -- -D warnings`,
`cargo fmt --all -- --check`, strict C syntax/compile checks and
`git diff --check` pass. Real VM evidence comprises four fresh cohorts, four
validated STATE responses, three independently validated BitTorrent exchanges,
one unused-port and one TCP-only negative, plus three bounded failed payload
attempts. Every handshake client reports zero terminal connections/UDP tasks;
every server reports no uTP/UDP owner after joined shutdown. This adds research
fixtures only; production runtime, defaults, UI and Android semantics are
unchanged. No new OS grant or native-host registration was needed. Windows
was not run. All owned research processes were confirmed absent, guest and
host temporary fixtures/logs/coordinators were removed, and normal native
shutdown returned the VM to its original powered-off state. The owned claim
was released; inherited operator grants and registrations were untouched.

## Proposed Product Contract

The maintainer accepts outbound-only operation as a legitimate mode. For fresh
macOS profiles, propose incoming peer connections Off, automatic port forwarding
Off, and no local-network operation until a same-device feature action explains
its purpose. Normal internet transfers and loopback browser control remain
available. Do not equate receiving response packets with accepting unsolicited
peer connections, or equate incoming firewall access with local-network privacy.

Settings > Connection is the permanent home:

- **Accept incoming peer connections**: Off/On, covering TCP and uTP. Automatic
  and fixed port choices appear when On. This setting does not silently enable
  router discovery or claim OS firewall approval.
- **Automatic router port forwarding**: Off by default, requires incoming
  peers. Explain the benefit and macOS request before Enable; Not now keeps it
  off. Turning on incoming peers alone should not need local-network permission
  after incidental interface probing is removed.
- **Local-network access**: explain router discovery/local peers and trackers
  when the user chooses the relevant feature. Show feature intent separately
  from unknown, denied, available or failed runtime evidence. Settings recovery
  is available after denial; never present generic network failure as proven
  permission denial or repeatedly ask during startup/retry.

A dismissible offer after a useful torrent action may follow later; it is not
needed for the initial settings-only slice. A remote controller must not cause
a first-use dialog on an unattended Mac. Direct-file mDNS/ICE requires its own
local feature explanation/enable path; relay control alone does not justify it.

Existing profiles need deliberate reconciliation: preserve torrent intent and
data; do not reinterpret a legacy default-on UPnP value as informed OS consent.
Hold unacknowledged local-network work while internet restoration continues.
Preserve an already explicit accepted feature preference and OS decision across
relaunch; do not rewrite all existing listeners merely to change fresh defaults.
Finalize this migration contract in the implementation tactical.

## Implementation Sequence And Owners

1. **Remove incidental startup requests.** Replace the macOS multicast
   interface-selection probe with bounded OS interface/route observation.
   `getifaddrs` is a verified non-prompting ingredient, not a complete selection
   algorithm; test multi-interface ranking, VPN, no route, address changes and
   IPv4/IPv6 fallback. Preserve Windows selection until its own qualification.
   Ensure address observation failure degrades incoming reachability rather
   than preventing the app from opening, including IPv4-only profiles.
2. **Make incoming Off complete.** Keep outbound TCP/uTP and their reply paths,
   but reject unsolicited uTP SYN/admission while Off; stop TCP acceptors and
   pending new admissions. Define transitions separately from existing
   established peer ownership. Do not suppress DHT or loopback control by
   using the global all-network prerequisite as an incoming switch. Keep
   new-peer advertisement/mapping consistent with the effective policy.
3. **Gate actual local-network operations.** The macOS adapter owns disclosure
   and same-device enable intent; the session/engine owns effective policy,
   route classification and bounded task cancellation. Classify resolved
   endpoints against current interface/route information, not private IP
   ranges alone. Apply it to TCP/uTP peers, trackers/literal hosts/redirects,
   saved DHT nodes and responses, UPnP and direct-file mDNS/ICE. Queued or
   deferred local work needs observable reasons and bounded retention; it must
   not fall back to an unguarded route. Inactive empty/paused libraries should
   not initiate speculative discovery merely because a runtime exists.
4. **Add settings and truthful recovery.** Reuse ordinary settings commands and
   the Android explicit-action pattern. Store preference/disclosure intent in
   the product owner; never persist a guessed OS grant. The first relevant
   action may invoke a bounded platform operation to prompt. Investigate
   `NWConnection` evidence for denied local access without replacing peer hot
   paths with a separate networking service. Shipping purpose text must name
   the actual feature; route OS settings recovery only on an explicit action.
5. **Qualify before default changes ship.** Signed responsible-code identity,
   actual denied/regrant/revocation behavior and controlled outbound transfer
   are required. Separate macOS firewall testing from local-network privacy.
   Windows's prompt, profiles/admin policy and persistent Cancel rules remain
   for the explicitly later session.

No new helper/daemon, transport dependency or engine delegation is proposed.
Platform facts depend inward into pure policy values; engine/session tasks keep
identified owners, cancellation and joined termination. A network change bumps
the policy generation so stale local attempts cannot resume after revocation.
Keep interface snapshots and queued local work bounded; prefer skipping
unconsented auto-discovery with an observable reason over retaining arbitrary
peer input. The implementation tactical must set exact bounds and task maps
before adding runtime work. Common incoming-off semantics require proportional
Android engine/boundary evidence in that same slice; no Android default change
is implied and no Windows hardware session is part of Mac qualification.

## Required Acceptance Matrix And Restart Checkpoint

The next implementation tactical should prove:

- Fresh empty native launch and extension background launch remain free of
  local-network dialogs for a defined observation window; disabled/inactive
  tasks have zero local operations, not merely an absent alert on a previously
  granted identity.
- First explicit feature action explains access then produces the correctly
  branded signed OS request. Not now, denial, restart, retry and return from
  System Settings retain feature intent without repeated unsolicited prompts.
- Incoming Off accepts neither TCP nor unsolicited uTP peers; controlled
  outgoing TCP and uTP downloads complete with independent payload hashes.
  DHT/reply traffic, existing established connections and loopback extension
  control obey the documented distinction.
- UPnP disabled, unavailable router, explicit mapping enable/disable, local
  peer/tracker endpoints, DHT warm state and remote direct-file attempts do not
  bypass consent. Denial/revocation cancels affected work while internet paths
  continue; no pending owners/queues survive joined Quit.
- IPv4-only, dual-stack, offline/no route, Wi-Fi/Ethernet, VPN and adapter change
  produce bounded truthful behavior. macOS firewall On/Off is a separate row.
- New profiles, restored/migrated settings and Reset defaults preserve the
  selected contract. Shared React/extension controls and generated boundaries
  agree with native effective state; common policy is qualified on Android.

## Windows Session Handoff

Read this tactical and Tactical 160's Windows route-probe contract, then the
Machine Control Windows guide and `platforms/windows/skills/drive-winvm/SKILL.md`
in the sibling controller checkout. Select the available Windows target and
start with the common read-only doctor; use Git through WSL on Windows.

Use an isolated candidate/profile and record OS build, app identity, firewall
state and active network profile. Compare fresh startup with TCP/uTP incoming
and UPnP disabled against explicit listener/router enable actions. Observe the
actual native firewall dialog, Cancel/deny, restart and explicit retry without
automatically granting access or changing inherited firewall rules. Test
loopback browser control separately from unsolicited peer admission.

Repeat the fresh-process/port and TCP-only negative controls, then controlled
outgoing TCP/uTP payload checks with independent hashes. The Rust example and
fixture recipe are reusable research tooling; `utp-syn.c` has macOS-specific
socket fields and needs a Windows probe equivalent. Resolve the shared Mac
payload stall before interpreting a similar Windows failure as firewall policy.
Record evidence and remaining gaps, preserve inherited apps/registrations,
and check in before product defaults or UI implementation.

Restart checkpoint: tighter Mac evidence is recorded; check in with the
maintainer before UI design or Windows qualification. Resolve the controlled
payload stall before claiming transfer qualification. The proposed next
implementation action, if selected, is a bounded tactical starting with incidental macOS route
selection and complete incoming-off semantics, then explicit local-network
feature gating. Product defaults, consent UI and shipping signing remain
unimplemented. Do not reopen a public swarm or start Windows qualification as
part of this checkpoint.
