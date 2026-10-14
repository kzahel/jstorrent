# Tactical 339: Quiet Mac Network Startup And Explicit Incoming Settings

Status: Complete locally; implementation and bounded Mac qualification, 2026-10-14.
Topics: `client-surfaces`, `web-ui-design`, `application-view-api`,
`application-control`, `incoming-reachability-and-seeding`,
`utp-transport-campaign`, `dht-discovery`,
`runtime-configurations-and-headless-deployment`, `capability-readiness`.

## Scope And Stopping Condition

Implement the maintainer-approved two controls: **Accept incoming connections**
(TCP and uTP) and **Automatic port forwarding** (UPnP). Keep copy short. Fresh
Mac desktop profiles use outbound-only settings; the first upgrade also holds
unconfirmed legacy listener/forwarding defaults until explicit settings intent.
Resume wanted torrents and preserve paused intent, data, ports and all unrelated
settings. Retain loopback control, tray and existing explicit-launch/Quit rules.

Remove the Mac multicast route-selection side effect, repair the controlled-uTP
helper's BEP 6 initial availability, enforce incoming Off while preserving
outgoing sockets/replies, and keep idle Mac DHT dormant until torrent work
needs discovery. Explain forwarding before enabling it. Stop after deterministic,
shared-client, Android boundary and isolated native Mac evidence passes and the
work is committed/pushed. Windows product verification follows in another
session; do not claim signed shipping or Windows acceptance here.

Non-goals: local peer discovery (BEP 14 is absent), a speculative discovery
switch, OS firewall rule installation/removal, automatic permission approval,
login startup, background-lifetime redesign, remote direct-file policy changes,
public swarm tests, release publication, or a general new LAN endpoint policy.
Ordinary intentionally supplied LAN trackers/peers retain their existing policy
and may require OS access; this slice qualifies empty/public-network startup,
not every possible restored local endpoint. Future LAN feature explanations
must be scoped to the feature rather than an invented OS grant toggle.

## Accepted Invariants And Bounds

- Off rejects unsolicited TCP/uTP intake, retires pending/established inbound
  peers, and removes inbound advertisement/mappings. Outgoing peers/replies,
  shared UDP and loopback control remain usable. An Off-only change must not
  replace the UDP socket and accidentally kill outgoing transfers.
- UPnP requires enabled ordinary incoming listening. Turning incoming Off also
  disables forwarding in the UI's atomic patch. Saved preference, socket bind,
  mapping result and OS grant remain distinct; do not infer reachability.
- First-use/upgrade starts without a network permission dialog. Explicit
  forwarding intent is explained before any discovery operation; cancel/Not
  now leaves it off. Previously explicit choices persist on subsequent launches.
- Mac uses an OS-selected documentation-unicast UDP route probe without sending
  packets, rather than SSDP multicast. No network dependency is introduced.
  Offline/address-selection failure must degrade listening without preventing
  the application from opening, including IPv4-only operation.
- Reuse existing queue/connection/handshake/lease bounds. No additional
  unbounded owner or per-torrent listener. Cancellation generations fence old
  incoming streams across rapid Off/On changes. Shutdown joins owned work.
- The first-upgrade marker is desktop-owned, bounded and atomically persisted;
  it is a defaults-migration version, never an OS permission assertion. Apply
  catalog changes before networking, persist the marker before exposing control,
  and preserve other shell settings on migration. Do not reset user data.
- Common incoming semantics apply to Android too; its fresh defaults and
  presentation remain unchanged. No generated semantic contract type change
  is expected; regenerate if implementation proves otherwise.

## Source Dossier And Edge Checklist

Required oracle: libtorrent `7d7fc38fac61177fa5e02148f791b2f65250b09d`.
Read `src/session_impl.cpp::incoming_connection` incoming TCP/uTP checks,
`include/libtorrent/settings_pack.hpp::{enable_incoming_tcp,enable_incoming_utp}`,
`test/test_utp.cpp::test_transfer`, `src/bt_peer_connection.cpp` initial
availability and `test/test_fast_extension.cpp::{multiple_have_all,
incoming_have_all,outgoing_have_all}`. BEP 3 peer handshake/framing, BEP 6
exactly-one initial availability, BEP 5 node/bootstrap semantics, and BEP 29 SYN/STATE/connection-ID rules are
read at BEP pin `7b7b41f46d57ff1d1cb1e24ed6e9bacfbf958c06`.

Adopt independent incoming/outgoing authority, preserve useful outbound UDP,
and send HaveNone only when Fast Extension is negotiated. Intentionally expose
one product incoming setting across both transports and reject unsolicited
uTP SYNs before allocation rather than only after transport acknowledgement.
Do not copy oracle source. Also inspect `src/kademlia/dht_tracker.cpp::{start,stop}`
and `simulation/test_dht.cpp::{bootstrap_session,dht_bootstrap}` for bounded
bootstrap/stop ownership. Mac idle demand reuses the existing DHT enable/disable
owner and its registered-discovery wakeup (Tactical 205), not a new actor. Tactical 338 supplies current JSTorrent history:
Mac multicast connect prompts without packets; TCP Off still admits uTP;
Windows Cancel persists block rules while outbound verified transfers work;
the original diagnostic omitted Fast availability. BEP 14 remains absent.

Front-load: malformed/stale/replayed SYN, known outgoing routes while Off,
half-open/queued streams and rapid toggles, established inbound cancellation,
private torrents, fixed-port failure, mapping disable/lease cleanup,
IPv4-only/no route/VPN source selection, first upgrade versus later relaunch,
read-only/failed marker persistence, Reset, UI draft conflicts/cancel and
atomic listener/forwarding changes. Retain current socket replacement semantics
for explicit port/family changes; document that separate boundary.

## Ownership And Dependency Map

Protocol values remain runtime-independent. Engine uTP owns one shared incoming
policy generation and all transport workers; Off cancels only incoming workers.
The peer-budget owner cancels incoming permits, which existing handshake/upload
loops observe. The session-network reconciler owns listener/forwarding changes,
advertisement, and effective state. The application owns saved torrent intent
and discovery demand. Desktop owns Mac defaults and its one-time migration
marker. Shared React settings owns draft/disclosure presentation and sends one
ordinary typed settings patch. No browser becomes the engine lifetime owner.

## Validation Plan

1. Regression before/after: diagnostic verified transfer; raw SYN silence and
   no incoming allocation with Off; On admission; outgoing transfer while Off;
   Off cancels inbound but preserves outgoing and UDP generation; rapid toggles.
2. Application/store/default and shell-marker tests; idle/resume/pause discovery
   demand and truthful status; Mac offline/IPv4-only source selection.
3. Web controls, hidden ports while Off, disabled forwarding, disclosure
   Not now/Enable, save patch and external revision conflicts. Typecheck,
   full web suite/localization and actual renderer review.
4. Rust fmt/clippy/workspace tests and proportional Android Rust/boundary/build
   evidence for common incoming policy.
5. Claimed Machine Control Mac VM: fresh GUI launch, native extension control,
   incoming enable without local-network prompt, explicit forwarding disclosure
   before the OS request, decline/restart, independently hashed outbound
   TCP/uTP and incoming controls, joined shutdown. Preserve inherited apps,
   registrations and grants; remove owned artifacts and park/release testbed.

## Implementation And Validation

The common uTP runtime receives its incoming policy before spawning. Off drops
unsolicited SYNs before allocation/STATE and cancels only the current incoming
generation. Known outgoing routes/replies survive. TCP admission shares the
same authority; the session reconciler cancels pending/established inbound
peers, joins acceptors, clears advertisement and forwarding, and waits up to
five seconds for incoming retirement. Off-only edits retain UDP generation;
explicit port/family changes retain the existing socket replacement contract.
An unrelated settings edit while already Off must not cancel peer permits again:
the first workspace run exposed that regression in the live peer-limit test;
the transition-only repair passes the targeted and full rerun.

Mac startup selects listener/UPnP Off, holds old settings before networking,
and persists a version-4 shell/defaults marker before exposing control. Legacy
version-3 background/notification/power choices survive; Reset retains the
marker. Failed marker persistence joins the application before setup returns.
Fixed ports become retained preferences; torrent state/data remain untouched.
The Mac source selector uses a documentation-unicast connect with no packet.
Listener startup failure falls back to Disabled intake/usable UDP rather than
preventing the application from opening. The VM's IPv6-unavailable case also
exposed misleading incoming-row copy; that row now uses actual listener status,
while the IPv6 warning stays at IPv6.

Mac empty/paused libraries drive effective DHT off through the existing owner;
wanted catalog intent wakes it without changing the configured preference.
Shared settings hide ports while Off, atomically disable mapping with intake,
and clear latent forwarding intent when enabling from authoritative Off.
Forwarding first presents **Enable automatic forwarding?**, a two-sentence
explanation and **Not now / Enable**; the existing Save settings commits it.
Discovery failure says **Router discovery failed**, without guessing OS denial.
Canonical shipping/development plist purpose text describes routers/local peers.
No permission-state API, OS grant marker, new dependency or contract DTO was added.

Commands actually run:

- `cargo fmt --all -- --check` and
  `cargo clippy --workspace -- -D warnings`: pass. The final research example
  also passes strict focused Clippy/build after its prepare-fixture correction.
- `cargo test --workspace`: 1,610 pass, 18 ignored across 70 result groups.
  New uTP tests record zero Off connections/half-open high-water, fresh re-enable
  generations, outgoing duplex preservation and zero terminal owners. Session
  tests preserve UDP generation through Off, join inbound retirement, retain
  upgrade state and exercise demand/pause without rewriting DHT preference.
- `npm run typecheck --prefix clients/web`,
  `npm run test --prefix clients/web`: pass; 538 tests, two existing skips.
  The 71-case App suite covers disclosure cancel/enable, atomic Off/UPnP patch
  and IPv6 status independence. `npm run check:localization --prefix clients/web`
  passes all 1,336 owned messages. Actual native renderer reviewed after the
  final neutral confirmation CSS; final typecheck passes after formatting.
- `clients/android/build.sh`: both release Rust ABIs, host bindgen, generated
  Kotlin and debug APK pass. Existing cross-build dead-code warnings remain.
  `clients/android/gradlew -p clients/android testDebugUnitTest`: pass;
  153 JVM cases, zero failures (up-to-date). All 15 Android host Rust cases pass
  in the workspace; the listener observer test now asserts TCP refusal and raw
  SYN silence after Off. No Android default/presentation/semantic DTO change.
- Isolated `scripts/desktop-bundle --build-only` builds and strict guest
  codesign verification pass. Final normal Preview build-only also passes;
  host primary browser/app were not launched. Plist lint and build-script
  syntax/CSP checks pass. No public swarm, updater or release was exercised.

## Native Mac Evidence

Claimed Machine Control macOS 26.6.2 VM, inherited firewall Off, separate ad-hoc
app/profile. No new OS access grant or TCC manipulation. A private tracker-free
131,803-byte/three-piece fixture has independent SHA-256
`8279ab7386010af63a680dcff51eb38294755a74e0abc5395901b2717ceeab63`.

- Fresh empty native launch uses Off/UPnP Off, with only ordinary loopback control
  TCP listeners and shared outbound UDP. A fresh raw SYN (64264 ← 53727,
  CID 2148, sequence 24005) receives no response. The production extension
  origin attaches through the packaged native helper/authenticated control.
- Incoming On saves an actual port 6881, with forwarding still Off. Neither
  enabling it nor relaunching with that saved choice shows a local-network
  alert. The inspected UI's unrelated IPv6 warning remains truthful.
- Clicking forwarding shows the product explanation while persisted forwarding
  remains Off. **Not now** leaves it Off and produces no OS request. **Enable**
  then **Save settings** produces the OS request. **Don't Allow** declines it;
  the app retains configured intent and reports discovery failure.
- This ad-hoc build's request says `jstorrent-client`, and relaunch with UPnP
  still On repeats the request after denial. Declined again; turning incoming
  and forwarding Off restores quiet restart. This does **not** qualify signed
  branding or denial persistence. No guessed grant/denial is persisted to
  conceal the limitation, and no automatic Allow is performed.
- Real desktop restores and completes the fixture while Off against a uTP seed
  (one started uTP connection, 71 classified datagrams), then independently
  against a TCP-only seed (no uTP owner, two attempted SYN datagrams). Both
  exact output hashes match and snapshots remain Off/UPnP Off. Seed shutdown
  reports no UDP/uTP owners. First harness attempt transferred nothing because
  duplicate intake intentionally retains its original source and had discarded
  the peer hint; prepare-client now adds the peer magnet before verified metadata.
- A stopped native profile is prepared with old fixed port 45432/UPnP On and
  version-3 shell choices. Normal launch holds both network features Off,
  retains preferred port 45432, running completed torrent and exact payload,
  migrates shell to version 4/marker 1 and preserves background/notification/
  power choices. No OS alert. Subsequent cold production-origin native start
  also remains Off/UPnP Off, attaches and shows no local-network request.
- Fresh-process/port `off / on / tcp / off` matrix has server ports
  61323 / 49264 / 58804 / 53023 and raw source ports
  51628 / 58655 / 58862 / 61482, distinct randomized CIDs/sequences and
  empty initial counts. Off cases refuse TCP and start zero uTP connections;
  On validates source/header and serves the corrected controlled diagnostic
  from source 54607 with all three pieces/exact SHA-256. TCP-only accepts TCP
  and is silent for uTP. Every successful case joins to zero owners. The first
  coordinator attempt used a nonexistent JSON field after a silent Off probe
  (54404 ← 58721); its finally block joined the seed, and the corrected repeat
  used distinct ports. No router/NAT or leftover connection explains these
  loopback results.

All owners, profiles, fixture/log/capture artifacts and test bundle are removed;
inherited native-host manifests are restored exactly. The VM returns to its
original powered-off state and its owned claim is released. Native AX inspection
needed a full projection and Show JSTorrent after rebuild; the workaround is
recorded in Machine Control's private usage journal, without public inventory.

## Limits And Windows Handoff

This closes implementation and bounded local Mac evidence, not every row in
338's broader shipping matrix. Developer ID branding/denial persistence,
System Settings regrant/revocation, firewall On, real router mapping/WAN, offline/
VPN/adapter changes and deliberately restored LAN endpoints remain separate
qualification. Off does not prohibit outgoing connections to user-supplied LAN
peers/trackers. Direct-file transport is unchanged; BEP 14 remains absent.

Windows fresh defaults/migration deliberately remain unchanged in this Mac
slice; common TCP/uTP Off and the shared controls already apply. Next Windows
session should build the current isolated candidate, verify the new UI before
any OS request, test atomic Off and native outbound hashes, and compare explicit
incoming enable/Cancel/retry/restart with 338's persistent firewall rules.
Decide Windows fresh/upgrade defaults there; preserve inherited rules and do
not auto-approve access. Signed Mac qualification remains its own follow-up.

Restart checkpoint: no implementation work remains in 339. Proceed with the
explicitly requested commit/push after final cleanup and checks; Windows product
qualification is the next maintainer discussion, with no release authorization.
