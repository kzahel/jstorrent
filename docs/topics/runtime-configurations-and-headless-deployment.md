# Runtime Configurations And Headless Deployment

Tactical [340](../tactical/340-windows-quiet-network-startup.md) extends desktop
outbound-only fresh defaults and the first-upgrade network hold to Windows.
Its defaults marker records migration, not firewall permission. Later explicit
choices survive restart; Cancel-created OS block rules also persist, independently
of settings and listener binding. Controlled native Windows TCP/uTP downloads
work while incoming is Off and denied. Windows DHT demand, Linux/headless,
Android and iOS defaults and all desktop lifetime rules remain unchanged.

Tactical [339](../tactical/339-macos-quiet-network-startup.md) gives Mac desktop fresh profiles and the first
upgrade outbound-only listener/UPnP defaults. Wanted torrents still resume;
paused intent and unrelated shell settings survive. Empty/paused Mac libraries
defer DHT. Explicit launch, background preference, window closure and Quit keep
their existing owners. Ordinary loopback extension control remains available.
Mac route selection uses a documentation-unicast UDP connect without sending,
removing incidental SSDP access. Explicit forwarding and intentionally supplied
LAN peers/trackers may request access. Windows defaults follow 340; Linux
defaults remain unchanged.

Linux first-release scope is narrowed by maintainer direction on 2026-10-09:
best-effort AppImage desktop support, maintained bundled libraries, no older-
distro WebKit backport campaign, and CLI/headless fallback. Tactical285 locally
applies production AppImage-only packaging on Ubuntu24.04 with a reviewed
WebKit build floor. Fresh signed/runtime/source and native evidence remain
required. Broader
Linux historical rows are scoped by this decision, not marked passed; final
candidate security, source obligations and representative installed checks
remain open. See the [accepted scope](product-direction.md#linux-release-scope-accepted-2026-10-09).

Topic: `runtime-configurations-and-headless-deployment`

Tactical [239](../tactical/239-desktop-suspension-browser-recovery.md) qualifies
macOS/Windows/Linux browser closure/restart during controlled transfer,
same-owner reattachment, independently verified completion and Quit without
passive resurrection. macOS VM pause/resume passes separately. Native OS
sleep remains unqualified: macOS/Windows guests lack usable sleep, and the
recreated Linux guest failed to return from its RTC-scheduled suspend-to-idle
attempt. Supported forced-stop/readiness recovery succeeds; this is not a
passing sleep or crash-recovery test. Owned state and claims are cleaned up.
These are bounded installed checks, not endurance or physical qualification.

Tactical [`235`](../tactical/235-linux-quit-launch-handoff.md) repairs the Linux
Quit/launch overlap. A stopping owner returns Retry; the explicit launch process
retains its arguments and waits within a bounded deadline before claiming the
vacated singleton name. Passive activity never creates that launcher. Installed
tray-Quit, native/background launch, actual magnet/file associations and a
12-launch race pass. macOS/Windows retain their existing plugin; old Linux
binaries retain the old race. Update compatibility remains a separate gate.

Tactical [`234`](../tactical/234-desktop-user-intent-and-background-lifecycle.md)
owns the accepted desktop lifetime follow-up: retain the tray/status-bar icon
while the runtime runs, including idle/paused states; browser closure only
detaches. Fresh toolbar, Start, or OS torrent-input intent may relaunch after
Quit; page restoration, worker wake and retries only attach. Tray Open and
OS magnet/file delivery always use the native window. No preferred surface,
browser-profile routing, icon-hiding or automatic completion shutdown is added.
Installed macOS/Windows/Linux debug builds pass the bounded lifecycle
checkpoint: browser closure during a verified transfer, 64 reload/worker-stop
cycles, actual tab discard, explicit relaunch and passive no-resurrection.
Desktop disconnect retires only that client's abandoned view sets before
admitting a replacement; native views and other transports retain their owners.
Broader endurance and installer/update compatibility remain open.

Tactical [`232`](../tactical/232-desktop-extension-control.md) adds an explicit
`--extension-background` intent to the ordinary singleton desktop executable.
It retains the desktop application service, default library and close/Quit
policy while deferring webview creation until a native-window action. It is
not a configured headless-service mode. The native host owns bootstrap only;
closing an extension client does not transfer runtime ownership. macOS native
bootstrap serializes explicit starts with a private OS-released file lock,
rechecks readiness and sends only one LaunchServices background open. The
application menu and tray Quit use the same joined shutdown owner. Installed
macOS, Windows and Linux checkpoints pass; this is not browser endurance or
update-compatibility qualification.

Status: Configured Linux headless-service Tactical
[`170`](../tactical/170-configured-linux-headless-service.md) and signed
headless release/trusted-LAN Tactical
[`171`](../tactical/171-signed-headless-release-and-lan-service.md) completed
on 2026-08-26. Exact tailnet-access Tactical
[`174`](../tactical/174-exact-tailnet-headless-access.md) completed on
2026-08-27. The ordinary-user package, strict versioned configuration,
systemd user unit, signed source release/update machinery, exact
credential-free RFC 1918 and Tailscale Serve modes, and real x86_64
lifecycle/transfer/current-host campaigns pass. The native ARM64 release job
exists without a native ARM64 systemd claim. Public owner-remote deployment,
promoted signed public headless artifacts and system-wide service ownership do
not exist yet. Completed Tactical
[`190`](../tactical/190-opaque-wasm-relay-foundation.md) proves only a local,
ephemeral OPAQUE native/Wasm dumb-relay composition. It does not broaden these
deployment claims. Completed Tactical
[`192`](../tactical/192-production-owner-relay-access.md) adds the
desktop/configured-headless host lifecycle, durable authority, authorized-
browser resume and operator security-audit boundary only in a production-shaped
loopback validation composition. Deployment remains later work. Independently,
completed Tactical
[`193`](../tactical/193-stateless-foreground-downloader.md) supplies one finite
`rstorrent-download` native command over an ephemeral in-process application
owner. It exits after verified selected completion without seeding, creates no
profile or resume database, and remains distinct from a headless service,
daemon, remote-control endpoint, or durable runtime configuration.
Completed Tactical
[`209`](../tactical/209-asynchronous-local-headless-deploy.md) independently
makes the current-host source-push repair asynchronous: the accepted commit is
built from a temporary non-worktree snapshot after the Git push returns.

Tactical `192` now attaches its local-only validation owner beneath the actual
desktop and configured-headless application lifecycles. Headless configuration
version 3 carries an explicit loopback relay/certificate block while retaining
the independently selected version-1 hosted access policy; prior versions
cannot start this owner. A protected same-UID Unix socket and
`rstorrent-headless remote ...` commands provide local inspection and
administration without adding those operations to a hosted HTTP listener. This
is production-shaped local evidence, not a deployed owner-remote mode or a
supported public listener.

## Purpose And Scope

RSTorrent should support several useful runtime compositions without turning
them into different torrent engines or allowing a presentation to own durable
download state accidentally. This topic owns the continuing product direction
for:

- visible, hidden, and eventually absent desktop webview operation;
- a first-class headless Linux service with no desktop or browser process
  requirement;
- backend lifetime while zero, one, or several presentations are attached;
- explicit listener, public-origin, authentication, and TLS-termination
  deployment choices;
- the distinction among process availability, UI lifetime, service startup,
  torrent seeding intent, and remote access;
- the relationship between local extension control and a later configured
  remote-host target; and
- packaging and evidence expected before calling a headless configuration a
  supported product surface.

[`product-surfaces-and-migration.md`](product-surfaces-and-migration.md) owns
the broader backend/presentation model and later JSTorrent graduation.
[`application-connection-architecture.md`](application-connection-architecture.md)
owns the typed application protocol and its HTTP, WebSocket, Tauri, and future
relay delivery adapters.
[`remote-access-authentication.md`](remote-access-authentication.md) owns
future owner passphrase login, host and device identity, remembered access,
end-to-end record protection, and relay threat models.
[`download-root-acquisition.md`](download-root-acquisition.md) owns the exact
native-picker matrix and accepted validated absolute server-path entry for the
Linux headless presentation.
[`incoming-reachability-and-seeding.md`](incoming-reachability-and-seeding.md)
owns peer-listener and upload behavior. Decision-complete Tactical
[`201`](../tactical/201-durable-seeding-goals-and-seed-admission.md) now owns
the separate durable ratio/time priority and seed-admission policy.

This topic does not select a password protocol, authorize a public relay,
define a stable third-party daemon API, or make a maintainer-configured Basic
deployment equivalent to the future owner-remote product.

## Product Outcome

One native backend owns one application-service instance, profile database,
torrent engine, network owners, storage roots, and background lifecycle. A
presentation attaches to that backend through the shared semantic application
API and may detach without stopping it.

```text
desktop installation                 headless Linux installation
  Tauri shell + tray                    service manager
            \                           /
             application-service owner
               +-- one profile database
               +-- one torrent engine
               +-- peer and discovery networking
               +-- storage roots and payload IO
                          |
          +---------------+----------------+
          |               |                |
     Tauri webview   browser/extension   remote client
```

The two installation columns are separate backend instances with separate
profiles. The diagram shows shared architecture, not a shared database across
machines. Multiple presentations may attach to one backend only through its
bounded application connection. They never share peer sockets, filesystem
handles, piece payloads, or SQLite pages.

Headless Linux is a first-party product host, not a compatibility IO daemon.
It runs the same Rust application service and engine used by the desktop
product, serves or accepts the same mature React presentation, and keeps peer
and file hot paths in-process. It does not require Tauri, a display server, an
open browser, or an extension.

## Intended Runtime Configurations

| Configuration | Backend owner | Presentation | Lifecycle authority |
| --- | --- | --- | --- |
| Desktop, visible | Tauri process | Embedded React webview | Desktop shell and explicit Quit |
| Desktop, background | Same Tauri process | Hidden or detached webview, tray, and later extension | Persisted **Run in Background** policy and tray Quit |
| Desktop, windowless | Same single desktop backend | Extension or remote client; webview created only on demand | Future desktop/extension tactical |
| Linux, headless | Native service process | Backend-served browser UI or remote first-party client | Explicit service-manager configuration |
| ChromeOS Linux | Crostini user service | Backend-served React UI launched through the extension | Implemented on-demand Crostini service policy |
| Remote controller | The selected desktop or headless backend | Browser, installed client, or later extension | Authenticated connection and backend service policy |

Desktop and mobile clients remain in-process by default. Accepting headless
Linux does not require desktop to become a client of a separate daemon, and it
does not move Android or iOS networking and storage out of their first-party
processes.

## Independent Policies

Several choices that are easy to describe as “run in the background” are
independent and must remain separately configurable.

### Backend availability

The backend may remain available even when no presentation is connected and
no torrent is actively downloading. This is useful for remote intake,
inspection, seeding, scheduled discovery, and accepting a later browser or
extension connection. An idle backend does not need to manufacture UI leases
or keep an invisible high-frequency observer active.

### Desktop close behavior

The existing desktop **Run in Background** preference defaults on. Closing the
window hides it while retaining the same process, application service, profile,
engine, webview, subscriptions, and tray. Turning the preference off makes the
next close perform joined shutdown.

Tactical 232 implements extension-first startup without a native webview and
creates/restores the native presentation on demand on the same service.
Tactical 234 qualifies the persistent tray and explicit-intent rules across
browser departure, restoration and deliberate relaunch after Quit.

### Service startup and restart

A headless installation separately chooses whether the service starts:

- manually for one foreground or supervised run;
- when the selected user logs in;
- at boot under an explicitly selected service account; or
- under another operator-owned supervisor.

RSTorrent must not silently enable boot startup, user lingering, or crash
restart as a side effect of installing a binary. The installer or deployment
command reports the selected policy, and the service manager owns automatic
restart. RSTorrent still owns graceful signal handling, cancellation, joined
engine shutdown, and durable reopen.

### Seeding intent

Process lifetime is not torrent policy. A backend may stay reachable while all
torrents are paused, and a completed torrent may remain eligible to seed while
no UI exists. Eventually each torrent or the profile may express such goals as
indefinite seeding, a share ratio, elapsed seeding time, or explicit stop.

RSTorrent supports durable completed-torrent seeding, manual pause/removal,
and completed Tactical `201`'s global ratio/time priority goals. The same
in-process application owner and generated settings used by desktop and mobile
apply in headless configurations: meeting any one goal lowers automatic seed
priority but does not stop a torrent or create a process-exit rule.

### Remote exposure

Listening, transport protection, application authentication, and relay
routing are distinct. Binding a private address does not authenticate a
caller. TLS termination does not decide application authority. A password
challenge does not provide relay-blind end-to-end protection. Product UI and
diagnostics must describe the effective combination rather than compress it
into one “remote enabled” boolean.

## Headless Linux Product Direction

The leading concrete use case is an operator installing RSTorrent on a Linux
media server, choosing its durable profile and download roots, running it
without a graphical session, and opening the complete React UI from another
machine to paste a magnet and manage torrents.

The first supported Linux headless package should provide:

- one versioned native executable plus the exactly matching production React
  assets;
- explicit durable profile and payload-root configuration outside the release
  directory;
- no dependency on Tauri, X11, Wayland, `xdg-open`, or a browser when launched
  with no-open service behavior;
- one documented, inspectable service-manager installation mode with clear
  enable, disable, start, stop, restart, update, uninstall, and data-preserving
  behavior;
- graceful `SIGINT` and `SIGTERM` handling with joined application shutdown;
- bounded logs and useful health/version facts without logging credentials,
  magnets, torrent names, paths, or arbitrary remote input;
- a safe upgrade path that preserves the profile and refuses incompatible
  configuration rather than silently starting a fresh authority; and
- real validation on a representative headless Linux machine, including
  restart, UI detachment, active transfer, completed seeding, and exact
  cleanup evidence.

A system-wide service may run as a dedicated least-privilege account. A
per-user service may use that user’s roots and permissions. The first tactical
must choose and document its supported ownership mode rather than installing
both implicitly. Service-account identity, filesystem permissions, removable
storage, mounts, and boot ordering are deployment correctness, not incidental
systemd details.

## Listener And Origin Contract

Every network listener is an authority boundary and must be explicit. The
initial headless product should preserve these rules:

- default to one IPv4 loopback address and a documented port;
- accept an exact configured IP address and port for a non-loopback listener;
- do not select a LAN, VPN, container, or public interface heuristically;
- treat IPv4 and IPv6 wildcard addresses as broad exposure requiring a
  distinct explicit opt-in and an authentication mode that permits them, if a
  future tactical supports that combination;
- report the actual bound address and effective public origin after startup;
- fail when the requested address cannot bind rather than falling back to a
  broader or different interface;
- keep the browser’s exact public origin separate from the backend bind
  address so a reverse proxy can terminate HTTPS; and
- reject Host or Origin values outside the selected deployment contract.

An interface-name selector is useful only if it resolves deterministically,
reports every admitted address, and fails closed when the interface changes.
The existing exact socket-address configuration is sufficient for the first
headless slice; automatic multi-interface policy and BEP 45 peer-listener
selection remain separate network work.

## Deployment Security Modes

The product should expose a small validated matrix rather than arbitrary flag
combinations that look secure but are not.

| Mode | Intended exposure | Application authentication | Transport posture | Current status |
| --- | --- | --- | --- | --- |
| Local browser | Exact loopback origin | Local-open or remembered browser sessions | Plain loopback HTTP/WS | Implemented |
| Private reverse-proxy host | One explicit unicast backend address | Bounded Basic credential, with password from a secret file | Public HTTPS/WSS terminated by an operator-owned proxy | Implemented maintainer preview |
| Trusted private LAN | One exact non-loopback RFC 1918 IPv4 authority | None; every reachable client has full owner control | Plain HTTP/WS with exact Host and Origin, no confidentiality | Implemented operator mode |
| Trusted Tailscale overlay | Exact loopback backend plus one exact HTTPS `*.ts.net` authority | None; every identity admitted by tailnet policy has full owner control | Tailscale transport and Serve HTTPS/WSS | Implemented operator mode |
| Owner remote access | Direct or relay-mediated host | Passphrase bootstrap plus bounded named-browser authorization, automatic resume and exact revocation | Authenticated end-to-end records; relay remains opaque | Public website/relay active as an unadvertised canary; source-built production-origin browser evidence passes, while signed-package/external-path, rollback, renewal, soak and support evidence remain pending |
| Development-none | Ephemeral loopback only | None | Local test traffic only | Implemented development mode |

The immediate operator deployment may place RSTorrent behind Caddy, nginx, or
another HTTPS terminator and retain application-level Basic authentication.
The expected shape is:

```text
browser -- HTTPS/WSS --> reverse proxy -- private HTTP/WS --> RSTorrent
                              |                                |
                         TLS policy                 exact Origin + Basic
```

The RSTorrent listener should normally bind loopback when the proxy runs on
the same machine. If the proxy is separate, the backend binds one explicit
private address and the operator firewall limits that hop. The configured
external `https://` origin remains the browser authority; it is not inferred
from untrusted forwarding headers.

Basic authentication is a full-owner credential and is acceptable only as an
explicit operator-managed private deployment mode. The password stays in a
bounded secret file, not a command argument, URL, generated asset, log, or
application frame. Reverse-proxy authentication may add defense in depth, but
TLS termination or an upstream login does not automatically authorize a
request to RSTorrent unless a later tactical defines an authenticated proxy
identity contract.

Tactical `171` deliberately adds one narrower convenience mode for a trusted
home LAN. `lan-none` requires an exact non-loopback RFC 1918 IPv4 listener and
the exactly matching plain HTTP origin; wildcard, loopback, public, multicast,
IPv6, proxy-origin, and credential-bearing combinations fail configuration.
Exact Host and HTTP/WebSocket Origin checks remain enforced, but they are
request-routing defenses, not caller authentication. Every process and device
that can reach the address has complete owner authority, traffic is readable
on the LAN, and a malicious page may still attempt requests that the Origin
gate must reject. Health, status, startup logs, and the persistent React
status identify this posture. React also explains the full-owner consequence
in a one-time per-origin notice; dismissing it retains the compact `No auth`
status. It is suitable only when the operator accepts the whole selected LAN
as trusted; it must never be port-forwarded or treated as Internet,
guest-Wi-Fi, or untrusted-overlay security.

Tactical `174` adds a parallel, deliberately Tailscale-specific operator
mode. RSTorrent does not bind its `100.64.0.0/10` address and does not bind a
wildcard. It binds an exact loopback backend while Tailscale Serve owns one
exact tailnet-only HTTPS/WSS authority, certificate, overlay transport, and
tailnet admission. The RSTorrent gateway still enforces that external Host
and Origin directly and never trusts forwarding headers. This mode has no
RSTorrent credential or per-tailnet-identity role: every identity that the
tailnet policy permits to reach the Serve route receives complete owner
authority. That is an accepted trusted-network deployment, not the owner E2E
remote protocol.

RSTorrent does not currently terminate TLS itself. In-process TLS may be added
later if it materially simplifies supported deployments, but it is not
required for the first headless package because explicit bind/origin
separation already supports a small local TLS terminator. Any direct public
listener still requires the future owner-remote threat model; “it uses HTTPS”
is not by itself a production remote-control claim.

## Configuration Contract

The durable configuration surface should make these facts independently
inspectable, whether the first implementation uses a file, environment, CLI,
or a deliberately narrow combination:

- profile root and named storage roots;
- service/runtime mode and whether browser launch is disabled;
- exact listen address and port;
- exact external browser origin;
- authentication mode and secret-file references;
- production web-asset root and build identity;
- network egress policy and existing engine settings; and
- logging destination and bounded verbosity.

Secrets do not belong in process arguments, unit files, checked-in examples,
or generated frontend configuration. Startup validates the complete effective
configuration before opening application or peer listeners, prints a redacted
summary, and fails closed on incompatible bind, origin, authentication, asset,
profile, or storage-root combinations. A service restart must consume the
same durable configuration; an interactive shell environment must not be a
hidden requirement.

Exact option names and precedence belong to the implementing tactical. Avoid
growing parallel CLI, environment, and file vocabularies whose conflict rules
cannot be explained. The current gateway CLI/environment behavior is
substrate, not automatically the final stable operator contract.

Tacticals `170` and `171` implement the first contract as one strict
version-1 TOML file. It requires an explicit profile, one through 32 named
path roots, exact IP address and nonzero port, exact public origin, and
local-browser, Basic, or the exact `lan-none` matrix above. Tactical `174`
keeps that grammar compatible and adds version 2 with one through four
explicit endpoints for `trusted-network-none`: exact RFC 1918
`direct-lan` and exact loopback/HTTPS-`*.ts.net` `tailscale-serve` endpoints.
Every endpoint must bind before the profile/application opens. Basic secrets
remain read from a protected owner-only regular file; both no-auth modes
reject every secret field. Unknown or duplicate keys, sockets, or origins;
unsafe ownership or modes; overlapping protected paths; symlink roots;
invalid listener/origin combinations; and incomplete package identity fail
closed. A missing configured payload mount remains absent and is reported
unavailable rather than being recreated. Non-browser profile roots are
created owner-only after successful listener admission, so bind failure does
not manufacture a new profile authority.

## Presentation And Extension Routing

The simplest remote presentation remains a browser tab opened at the selected
headless host and authenticated there. It provides the complete React control
surface without making extension installation a prerequisite for a server.

The desktop extension path initially attaches to the local installed backend
through native bootstrap plus a future persistent local application channel.
A later extension may retain named remote-host configurations and route a
captured magnet to one user-selected default host. That convenience must reuse
the same authenticated application operation as the web UI and preserve these
rules:

- local native messaging cannot silently become remote authority;
- each remote host has its own endpoint or routing identity, authentication,
  compatibility, and revocation state;
- choosing a default host does not merge profiles or torrent identity across
  machines;
- a failed or ambiguous target is shown before submitting the magnet to a
  different backend; and
- magnets, credentials, and resume secrets are not placed in query strings,
  extension logs, or relay-readable routing metadata.

Multiple-host extension UX, host switching, context menus, and magnet-handler
policy remain future product work. They should follow a proven browser remote
connection rather than define its security model.

## Current Substrate And Gaps

The repository now proves these parts of this direction:

- Tactical [`209`](../tactical/209-asynchronous-local-headless-deploy.md)
  supplies an optional checkout-local asynchronous deploy path for the
  maintainer's ordinary-user Linux service. Its tracked `pre-push` hook only
  records a `main` commit and wakes a finite detached worker. The worker waits
  until the exact commit is the remote branch head, coalesces quick follow-up
  pushes, exports the accepted commit into a temporary non-worktree snapshot,
  builds and validates the ordinary package, and delegates replacement,
  restart, health, and rollback to the existing installer. Git-local status,
  completion, failure, bounded logs, one-worker locking, process-group stop,
  and temporary cleanup keep that local automation observable. It changes no
  release, service-enable, configuration, firewall, or public deployment
  contract.

- `rstorrent-gateway serve` runs the application service and production React
  UI without Tauri, accepts an exact socket address and browser origin, and can
  suppress browser opening;
- its current authentication choices include loopback browser sessions,
  bounded Basic, bearer automation, and loopback-only development-none;
- credentials can come from bounded secret files, and hosted Basic mode
  requires one exact unicast bind plus an exact HTTPS browser origin;
- the maintainer-operated private host passes authenticated public
  HTTPS/WebSocket, supervised restart, rollback, and durable profile/root
  evidence;
- ChromeOS Linux packages the same gateway and React assets behind an
  on-demand static systemd user service; and
- desktop already defaults to one retained background process behind the tray
  when its visible window closes.
- Tactical `170` packages `rstorrent-headless`, `rstorrent-gateway`, and the
  exact production React assets for one ordinary user. Installation remains
  disabled, never changes lingering, and exposes explicit enable/start/status/
  restart/uninstall commands. Same-version repair preserves running/enabled
  intent and rolls back on a failed mode-appropriate health check; uninstall
  preserves configuration, secrets, profile, and every payload root.
- One x86_64 Ubuntu systemd-user campaign proves exact bind failure, local
  pairing persistence, private HTTPS/WSS proxy control, an 8-MiB 128-piece
  transfer with all views detached, completed re-seeding to pinned
  libtorrent, idle reachability, missing-root reachability across restart,
  joined restart, repair, preservation-safe uninstall, and exact target
  cleanup. x86_64 and ARM64 archives construct twice byte-identically; ARM64
  binaries report their identities under QEMU, without a native ARM64 service-
  lifecycle claim.
- Tactical `171` adds strict bounded signed headless manifests, native x86_64
  and ARM64 draft jobs, a pinned-key website bootstrap, and the installed
  command's explicit `update --check` and `update --apply`. The shared React UI
  uses the same backend verifier for quiet startup/daily or visible manual
  checks and can only show the copyable shell apply command; it cannot replace
  or restart the service.
- The exact final x86_64 package is enabled and healthy on the current machine
  at `http://192.168.1.129:3030/`. It binds only that selected Ethernet
  address, serves HTTP and the application WebSocket with no credentials,
  rejects wrong Host/Origin, survives joined restart and same-version repair,
  and keeps configuration/profile/payload modes at `0600`/`0700`/`0700`.
  Router, TLS, DNS, unrelated user units, and existing lingering policy were
  untouched.
- A 2026-08-27 phone pending-load report was definitively traced to the host's
  active default-drop UFW policy: kernel logs recorded the phone's exact LAN
  SYN packets being dropped before RSTorrent. Follow-up operator direction
  adds one persistent IPv4 TCP rule from `192.168.1.0/24` to exact destination
  `192.168.1.129:3030`; no IPv6, public, wildcard, router, or package-managed
  firewall policy is added. A post-rule Android phone retry renders the
  application at the exact 456-by-1024 viewport.
- The same investigation independently found that hosted `index.html` had no
  explicit cache contract across same-version repair. The mutable shell and
  classic boot guard now use `no-store`, content-hashed assets are immutable,
  and a visible loading/no-JavaScript/delayed-failure shell replaces silent
  white startup. Exact phone-sized desktop Chrome and repaired-package service
  evidence pass.
- The `lan-none` explanation is a one-time per-browser-origin notice persisted
  under a versioned local-storage key. Dismissal and reload retain a compact
  `No auth` header status; unavailable storage fails open by showing the notice.
  Focused storage/React tests and a phone-sized installed-service browser smoke
  pass.
- Tactical `174` upgrades the installed package to `0.1.1` and adds one exact
  loopback gateway behind a dedicated Tailscale Serve HTTPS authority while
  preserving the exact LAN listener. One process/application/media owner
  serves both routes. Endpoint-local Host/Origin rejection, real WebSocket
  media calls with endpoint-correct capability origins, both configured
  health probes during same-version repair, and a phone-sized tailnet HTTPS/
  WSS browser smoke pass. Existing Serve routes, Funnel, ACLs, UFW, and router
  policy remain unchanged. The version-1 config is retained as a protected
  recovery copy.

The important remaining gaps are:

- promoted signed public headless artifacts/stable manifest and native ARM64
  service-lifecycle/update evidence;
- representative removable/media-server mount, reboot, suspend, and long-run
  unattended evidence;
- true desktop startup with no created webview and later on-demand recreation;
- persistent extension application control rather than one-shot launch;
- generic private-overlay behavior and per-identity product authorization
  beyond the implemented Tailscale trusted-network operator mode;
- owner remote authentication, host identity, authorized-browser resume,
  complete authorization/circuit audit, and direct versus relay delivery;
- release, update, compatibility, and recovery evidence for an unattended
  headless installation.

## Recommended Next Work

Completed Tacticals
[`170`](../tactical/170-configured-linux-headless-service.md) and
[`171`](../tactical/171-signed-headless-release-and-lan-service.md), plus
Tactical [`174`](../tactical/174-exact-tailnet-headless-access.md), supply the
first bounded Linux headless deployment, signed source update lane, and exact
LAN/tailnet presentation paths.
The next headless release operation may publish/promote an exact reviewed
`headless-v*` candidate; the next platform campaign should install it on a
native Raspberry Pi or other ARM64 host and prove service, reboot/mount,
update, storage, transfer, and cleanup. A separately authorized tactical may
instead add a system-wide dedicated-service-account mode. Every later slice
must retain strict configuration, bind-before-application, one-process
ownership, data-preserving removal, and explicit startup policy.

The desktop windowless/extension-attachment tactical can proceed independently
because it uses the same application-service and presentation-lifecycle
invariants but a different OS shell and local authentication boundary.
Completed Tactical `190` remains the ephemeral foundation. Completed Tactical
`192` integrates a durable remote owner into the desktop and configured
headless lifecycles, including persistent resume authorization,
revocation-driven live closure and the bounded operator security ledger. Its
real-browser/package evidence remains the local baseline. The fixed WebPKI
product profile, explicit headless opt-in and private deploy/operations
machinery are now implemented, but no retained public service has been
activated and external-path/support evidence remains open.

## Non-Goals

- A multi-user torrent service, roles, tenant isolation, or arbitrary
  third-party daemon API.
- Sharing one live SQLite profile or storage capability across machines.
- Moving peer networking, hashing, scheduling, or payload IO into the browser,
  extension, reverse proxy, or relay.
- Automatically exposing every interface or treating a random port as
  authentication.
- Treating Basic authentication as relay-blind owner authentication.
- Bundling Caddy, nginx, Tailscale, DNS, certificates, or a hosted relay into
  the first Linux package.
- Solving multi-host extension UX, friend sharing, remote media streaming,
  public accounts, wake-up delivery, or NAT traversal in the headless baseline.
- Coupling backend availability to an open view, active download, or one
  particular seeding-goal policy.
