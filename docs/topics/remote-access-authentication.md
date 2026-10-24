# Owner Remote Access Authentication

Topic: `remote-access-authentication`

Tactical [381](../tactical/381-dependency-cleanup-and-security.md) upgrades the
native/Wasm P-256 dependency from 0.13.2 to 0.14.0. Public keys retain the
65-byte uncompressed SEC1 encoding, signatures retain the 64-byte `r || s`
encoding, and private scalars, OPAQUE records, host pins and resume transcripts
keep their existing formats. The RNG trait bridge delegates to the existing
entropy sources without changing their byte stream. A pre-upgrade P-256
key/signature fixture checks persisted identity and signature compatibility.
Old/new core tests pass both directions for persisted OPAQUE credentials,
mutual P-256 resume and encrypted application records. The source of the
older core is byte-identical to Stable 0.3.4's core; this is a core protocol
check, not a new installed-platform qualification.

The original 0.13 choice below reused OPAQUE's elliptic-curve dependency to
avoid a parallel generation; the October 24 security findings motivate
revisiting that deduplication choice. OPAQUE 4.0.1 and VOPRF 0.5.0 remain
unchanged and still retain the older bigint dependency; their published
prereleases and current upstream manifests do not remove it. The strict
dependency review remains blocked pending resolution of that separate graph.

The [bounded reachability investigation](../tactical/evidence/381-opaque-bigint-reachability.md)
finds no source call path from the selected Ristretto password/TripleDh flow
to the old bigint's affected arithmetic: Dalek owns those operations, while
the borrowed elliptic-curve helper only expands bytes with SHA-512. Native,
Wasm and workspace feature graphs agree. This exact-source conclusion is not
a compiled-code constant-time proof; the package advisory and strict gate
remain in force, with no exception added.

After that investigation, the maintainer authorized a temporary exception
for the exact old bigint finding through November 12. The audit retains the
finding and records its exception; the gate independently checks the reviewed
source bytes and binds the resolved graph/features to the investigation.
Changed inputs or expiry invalidate it. This supersedes the preceding
no-exception checkpoint and does not change credentials or cryptography.

Tactical [360](../tactical/360-remote-controller-subdomain.md) publishes the
independently tagged controller at `https://remote.jstorrent.com/` on
2026-10-16. Marketing and controller artifacts/deployments are separate.
Production temporarily admits both exact new and previous controller origins;
frozen old assets and admission remain through the compatibility window, with
reviewed retirement no earlier than 2026-11-16. New-origin password sign-in,
browser approval, resume and revocation pass a disposable public canary with
signed cleanup. Host/relay authority and the existing unadvertised support
scope remain unchanged. Browser credentials and pins are not copied.

Historical predecessor Tactical [303](../tactical/303-canonical-remote-origin.md) deploys the accepted
canonical controller at jstorrent.com/remote/. At that cutover relay admission selected
only the exact jstorrent.com origin; the relay hostname, host authority and
cryptographic protocol are retained. Former and foreign origins are rejected.
Cloudflare hosting retains strict remote HTTP protections; browser authorization
requires fresh sign-in at the new origin. Relay tests/clippy, website assembly
guards, deployed six-file/header verification and live hostile-origin rejection
pass. A disposable exact-source headless canary proves login, reload/restart
resume, revocation, shared-session behavior and signed cleanup. Former remote
document entrypoints redirect with query/fragment continuity. DNS/mail operation
and ignored screenshots are recorded in the private infrastructure checklist.

Tactical [276](../tactical/276-preview-host-verification.md) corrects the
private preview verifier after the approved source8c deployment encounters
HTTP403 before activation. Direct private hops must name the configured public
Host. Actual approved-source gateway checks preserve wrong-Host403 and missing-
credential401 while static/health/WebSocket verification passes. The gateway
security policy is unchanged; preview activation and exact-source private-listener/HTTPS verification pass.

Tactical [258](../tactical/258-cross-surface-branding-and-design-audit.md)
changes only remote presentation: the sign-in gate follows shared JSTorrent
appearance/palette, applies existing saved preferences before connection, and
scrolls within a phone viewport. Local light/dark and scroll-to-sign-in renders,
full web tests and the packaged remote CSP check pass. Startup failure receives
the independent branded alert style. Authentication, credentials, trust,
transport authority and deployment status are unchanged. See the
[audit execution record](../tactical/258-cross-surface-branding-and-design-audit.md).

Tactical [254](../tactical/254-ci-candidate-and-pages-validation.md) restores
Pages assembly of the remote client's hashed JSTorrent PNG. Hashed images/fonts
are accepted alongside code/Wasm; unhashed assets and service workers remain
rejected. CLI regressions and an actual remote/website build with independent
manifest digest checks pass locally. No remote authentication/runtime behavior
or deployed artifact changes; hosted/deployed evidence remains separate.

Status: Direction and investigation background accepted from maintainer
discussion on 2026-08-04. Controlled foundation Tactical
[`190`](../tactical/190-opaque-wasm-relay-foundation.md) and local
production-shaped Tactical
[`192`](../tactical/192-production-owner-relay-access.md) completed on
2026-08-29. Tactical `192` implements the deliberately local boundary: durable
OPAQUE host authority, challenge-bound named-browser resume, complete bounded
security audit, exact revocation, a separately supervised opaque TLS relay and
a release-built remote React client. The production owner profile, platform
WebPKI trust, Windows protected authority store, trusted-proxy relay boundary,
operator admission/aggregate surface and atomic `/remote/` Pages artifact are
also implemented as of 2026-08-29. The public website and relay were
technically activated on 2026-08-30 as an unadvertised, unsupported canary.
External signed-package/browser-path evidence, rollback and renewal drills,
soak and support remain gated in a separately retained deployment tactical.
Completed Tactical `174` separately permits one
trusted Tailscale operator deployment; tailnet admission is not the owner
authentication designed here.

The native/Wasm cryptographic core, upstream RFC vectors, persistence crash
matrix and exact registry ceilings pass. Desktop and headless both own the same
remote runtime beneath their incumbent application owner. Local desktop Tauri
commands and the protected same-UID headless administration socket expose full
inspection, enable, passphrase replacement, revocation, disable and recovery.
The authenticated remote circuit exposes the audit and revocation subset but
derives **This browser** and sign-out from verified transport context; local
provisioning/recovery operations are not remotely callable.

The remote browser keeps host trust separate from one revocable authorization,
stores a non-extractable P-256 continuity key in dedicated IndexedDB and tries
resume before showing a password. It automatically reconnects across ordinary
transport loss and bounded route handoff, while shared mode retains no durable
authorization and a changed host remains blocking. The isolated product runner
uses the actual headless and TLS-relay binaries plus the release bundle on
distinct HTTPS/WSS loopback origins. Real Chrome passes private login, reload,
browser restart, phone viewport, shared non-persistence, relay restart, local
layout rollback, full audit, exact revocation and changed-host recovery, then
removes every temporary process and authority root.

This does not yet change the supported product claim. The production website,
WebPKI relay and source-built headless canaries pass private/shared login,
rendered audit, reload/browser/phone resume and exact revocation through
Chromium plus Playwright Firefox and WebKit. Signed product packages,
independent ISP/cellular and physical mobile paths, Internet abuse ceilings,
rollback and certificate-renewal drills, soak, stable wire promises and remote
media/file paths remain absent. Technical activation is not authorization to
advertise the service.

## Purpose And Scope

This topic owns the security background and decision boundary for authenticating
an owner to one RSTorrent host through a direct or relay-mediated application
connection. It records:

- the password-authenticated login semantics desired by the product;
- the relationship among password, host, device, relay and connection
  identities;
- the SRP and OPAQUE distinction and why OPAQUE is selected for the first
  controlled proof;
- profile theft, verifier theft, host cloning, active proxy, downgrade,
  resumption and live-process attack scenarios;
- hardware-backed, operating-system-protected and portable host-key tiers;
- the evidence required before choosing libraries or implementing a protocol;
  and
- the known boundary between cryptographic transport privacy and trust in the
  browser application that receives the password and plaintext.

[`application-connection-architecture.md`](application-connection-architecture.md)
owns the typed inner application frames, multiplexing, view attachment,
fairness, bounds and opaque relay layering. This topic owns how a remote
principal and encrypted record channel may eventually be established around
those frames. [`application-control.md`](application-control.md) continues to
own command meaning and the rule that authorization is verified transport
context rather than a caller-provided field.
[`runtime-configurations-and-headless-deployment.md`](runtime-configurations-and-headless-deployment.md)
owns which desktop or headless process hosts the application service, how a
Linux service starts, and how explicit bind addresses, public origins, Basic
private-host mode, and TLS termination are configured. Those deployment tools
do not substitute for the owner authentication defined here.

Tactical
[`076-authenticated-private-web-host.md`](../tactical/076-authenticated-private-web-host.md)
is a separate maintainer-operated preview protected by HTTPS deployment and
HTTP Basic authentication. Its credential is intentionally not owner E2E
remote authentication, device identity, relay authentication or evidence that
this topic has been implemented.

Completed Tactical
[`170-configured-linux-headless-service.md`](../tactical/170-configured-linux-headless-service.md)
packages that explicit private-host posture for one ordinary Linux user. Its
protected Basic secret file, exact HTTPS origin/Host checks, operator-owned TLS
proxy, repair, and uninstall behavior pass isolated and real-Linux gates. This
is still a full-owner Basic credential on an operator-secured private hop; it
does not implement the passphrase, host/device identity, end-to-end records,
relay blindness, or recovery model owned by this topic.

Completed Tactical
[`171-signed-headless-release-and-lan-service.md`](../tactical/171-signed-headless-release-and-lan-service.md)
adds a deliberately non-authenticated operator mode, not progress toward the
owner-remote protocol. `lan-none` admits only one exact RFC 1918 IPv4 listener
and matching HTTP origin, retains exact Host/Origin rejection, and shows a
one-time per-origin full-owner notice plus a persistent compact `No auth`
status. It has no confidentiality, caller identity, revocation, or defense
against a compromised trusted-LAN device. The mode must not be forwarded or
re-described as remote, overlay, guest-network, or Internet authentication.

Completed Tactical
[`174-exact-tailnet-headless-access.md`](../tactical/174-exact-tailnet-headless-access.md)
adds a separate Tailscale-specific trusted-network posture, not progress
toward the owner-remote protocol. RSTorrent binds an exact loopback backend;
Tailscale Serve owns the exact tailnet-only HTTPS authority and tailnet access
policy. RSTorrent still enforces exact Host/Origin and shows a one-time
full-owner network notice, but it consumes no Tailscale identity and assigns
no per-device role. Every identity that tailnet policy admits has full owner
control. Revocation and segmentation therefore occur at the tailnet policy
boundary, not in RSTorrent, and there is no passphrase, remembered-device,
relay-blind E2E, or product host-identity claim.

Tactical
[`101-first-run-web-authentication.md`](../tactical/101-first-run-web-authentication.md)
is the separate ordinary loopback product boundary. Its HttpOnly browser
sessions, four-digit approval ticket, and explicit restart recovery make a
headless local UI understandable and revocable; they are intentionally too
weak and too host-local to become a password, remembered remote device, relay
credential, or E2E authentication claim.

Tactical
[`109-stable-same-origin-web-launch.md`](../tactical/109-stable-same-origin-web-launch.md)
removes caller-selected browser gateway destinations and makes hosted browser
authority the exact page origin. That reduces local bootstrap ambiguity but
does not supply host identity for remote access, owner authentication, a
relay, or E2E encryption.

[`http-file-serving-and-streaming.md`](http-file-serving-and-streaming.md)
owns local verified-file capability URLs and future incomplete-file streaming.
Its capability alone is not sufficient for nonlocal access. Tactical `174`
allows the exact capability route through its accepted Tailscale HTTPS
authority under the same all-admitted-callers-are-owners operator posture.
Any general product remote-media route still requires the principal,
authenticated encryption, host identity, and authorization selected here.
[`direct-remote-file-streaming.md`](direct-remote-file-streaming.md) owns the
separate proposal for optional lazy direct browser-to-host file bytes, WebRTC
signaling over this encrypted circuit, browser consumption, path privacy, and
direct-transfer audit. It does not change the authority model defined here.

## Product Outcome

The desired ordinary owner experience is:

1. On the host, choose a remote routing name and strong passphrase.
2. From any new browser or first-party client, enter that name and passphrase.
3. Authenticate directly with the host through an untrusted relay without
   transmitting the passphrase to the relay or making the relay the identity
   authority.
4. Establish an authenticated end-to-end encrypted application connection.
5. On a private browser, authorize that installation once and resume ordinary
   socket loss, reload, browser restart and route reattachment without entering
   the passphrase again; a shared-browser choice retains no durable authority.
6. Inspect every authorized browser, resume deadline and live circuit on the
   host; rename or revoke one, revoke every other browser, require passwords
   everywhere, and review a bounded security-event history.
7. Retain passphrase login as the universal path when a remembered credential
   is absent, expired, revoked or cleared.

Mandatory QR pairing is not the root of owner access. A QR code may later
carry a URL, routing name or one-time device-enrollment capability, but losing
all paired devices must not prevent an owner who still knows the passphrase
from reaching an online uncompromised host.

The host remains the owner credential authority. A relay may own routing-name
registration, abuse limits and connection rendezvous, but remote access does
not require an RSTorrent cloud account, recovery email or another paired
device's approval.

## Terms

| Term | Meaning here |
| --- | --- |
| **E2E** | End-to-end protection in which the controller and RSTorrent host, but not the relay, can read or modify authenticated application content. |
| **PAKE** | Password-Authenticated Key Exchange, the protocol family that proves password knowledge and derives a shared key without sending the password. |
| **aPAKE** | Augmented or asymmetric PAKE, where the server stores a password-derived credential record rather than the password. |
| **SRP** | Secure Remote Password, a specific aPAKE and the protocol family already used by YepAnywhere. |
| **SRP-6a** | The improved SRP variant normally intended by a current SRP design. Exact parameters and library behavior still require review. |
| **OPAQUE** | A specific newer aPAKE standardized by RFC 9807. Its name is less important than its credential-envelope and authenticated-key-exchange properties. |
| **AKE** | Authenticated Key Exchange, a protocol that derives a key while authenticating the parties. |
| **AEAD** | Authenticated Encryption with Associated Data, which hides record content and rejects modification. |
| **KDF** | Key Derivation Function, used to derive separately scoped keys from an authenticated shared secret. |
| **OPRF** | Oblivious Pseudorandom Function, the password-processing primitive used by OPAQUE. |
| **HSM** | Hardware Security Module, a service or device that can use a private key without exporting it. |
| **TPM** | Trusted Platform Module, security hardware available on many PCs. |
| **TEE** | Trusted Execution Environment, isolated execution used by some platform keystores. |
| **TOFU** | Trust On First Use, where a client remembers the first host key it observes and rejects later changes. |

SRP is already a PAKE; `PAKE` is not an alternative user experience. SRP and
OPAQUE both support username/passphrase login and produce a shared secret.
The protocol name must not leak into product copy unless it helps diagnostics
or an advanced security explanation.

## Identity And Authority Model

Remote authentication must not collapse several distinct identities into one
token:

```text
owner principal
  +-- password credential
  |     +-- PAKE bootstrap and universal new-device login
  +-- remembered device A
  |     +-- independently revocable device public key
  +-- remembered device B
        +-- independently revocable device public key

RSTorrent host
  +-- host identity public/private key
  +-- password credential record
  +-- device registry
  +-- bounded resume records

relay
  +-- opaque host routing identity
  +-- independently rotatable host-to-relay registration credential
  +-- no application principal or decryption authority
```

The password credential authenticates owner knowledge. It does not identify a
particular browser, phone or installation because every new device uses the
same passphrase. A remembered device therefore generates or obtains a separate
key and proves possession of it on later connections.

The host identity key answers which RSTorrent installation accepted the
connection. A device key answers which remembered controller initiated it.
The relay registration credential answers which host may claim a routing
slot. A connection traffic key protects one connection generation. None is a
substitute for the others.

An eventual authenticated connection context should be able to distinguish at
least:

- the application principal and attached authorization capabilities;
- password versus remembered-device versus resume authentication;
- a stable device identity when one has been enrolled;
- the verified host identity and its protection tier;
- the connection generation and negotiated protocol version; and
- the request, replay and rate-limit context.

Application frames must never accept `is_admin`, `read_only`, `device_id` or
similar assertions from untrusted client payloads as their authority.

## Current Direction And Selected First Slice

The accepted requirement is a password-authenticated E2E key exchange through
an untrusted relay. SRP-6a remains useful product history because the
maintainer has shipped and extended that model in YepAnywhere. Tactical `190`
selects OPAQUE for the first controlled feasibility and application-composition
proof. The selected libraries are now bounded workspace dependencies for that
controlled proof only; they are not a production listener, durable wire
contract or support claim.

One runtime-independent Rust core owns OPAQUE, transcript binding and encrypted
record state natively on the host and through Wasm in the browser. WebCrypto
supplies the browser CSPRNG plus a non-extractable P-256 continuity key whose
handle remains in IndexedDB; it is not a second password or record protocol.
The product presents a username/passphrase model while keeping its relay-scoped
routing name, random host ID, OPAQUE host setup and relay registration
credential distinct.

The completed proof uses a portable-profile host-key tier and requires a
complete password login after every disconnect. Tactical `192` deliberately
supersedes that proof limitation for the production-shaped local slice: it
requires one bounded registry of named browser authorizations, challenge-bound
automatic resume, exact expiry/revocation and an owner-visible security ledger.
Account delegation, Google/OIDC login, cloud sync, account-wide device identity,
passkeys and hardware-backed host keys remain separate later decisions.
Tactical `190` has closed the source-first dependency
gate and fixed RFC 9807 Ristretto255/SHA-512/3DH, Argon2id 64 MiB/three
passes/parallelism one, HKDF-SHA-512 and directional ChaCha20-Poly1305 records.
Its real Chrome matrix keeps that KSF point within the controlled proof bounds.
Public-relay, representative low-end-device, durable-authority, resume and
authorization-audit evidence remain explicitly outside that proof. Tactical
`192` owns durable authority, resume and audit in a production-shaped local
composition. The follow-on production profile and deployment machinery are
implemented, while public operation and external evidence remain gated.

## SRP And OPAQUE Background

### Shared properties

Both are augmented password-authenticated key exchanges intended to provide:

- username/passphrase semantics;
- no password transmission;
- mutual password-based authentication;
- a shared secret suitable for deriving connection keys; and
- no dependency on a conventional public certificate hierarchy for the
  password exchange itself.

Neither protocol by itself identifies individual devices, defines application
authorization, supplies a relay, implements record framing, solves browser-code
integrity or makes a compromised live host process safe.

### SRP baseline

An SRP server stores a salt and password verifier. A successful ephemeral
exchange proves compatible password knowledge and derives a shared secret.
YepAnywhere derives a record-encryption key from that result and encrypts its
inner application protocol separately.

SRP's published security considerations state that an attacker who obtains the
verifier can masquerade as the server to that user and can attempt a dictionary
attack. Verifier possession alone does not prove the password to the original
server as a client. A transparent attacker that terminates both sides therefore
needs an additional client credential, resume secret, recovered password or
compromise of the original host.

### OPAQUE selected proof target

OPAQUE combines an OPRF-backed password credential envelope with an
authenticated key exchange. The standardized construction includes an
independent server AKE private key, client credential records, an OPRF seed and
ephemeral key exchange.

This separation can matter when the server AKE private key is protected more
strongly than the profile credential database. RFC 9807 specifically notes
that the AKE key may be held by an HSM so compromise of the OPRF seed and client
envelopes alone does not enable server spoofing. OPAQUE also specifies
precomputation resistance and forward-secrecy properties for a full login.

OPAQUE does not protect a perfect clone that possesses every long-term server
secret. A corrupted single server can still perform an exhaustive offline
dictionary attack, and a resumption design that persists or reuses the wrong
key can discard forward-secrecy advantages. Its newer standard and more
complex state require the library and operational evaluation specified by
Tactical `190`; selection for that proof is not a shortcut around those gates.

### First-use distinction

A separate pinned host signing key can strongly augment SRP for clients that
already know that public key. It does not automatically protect a completely
new client that knows only the routing name and passphrase: an attacker holding
the SRP verifier may conduct the client-facing SRP exchange and offer its own
host key.

OPAQUE can bind the password credential to the server AKE identity. When that
identity private key is non-exportable and only profile credential records are
stolen, this may protect even a new password-only client. Achieving an
equivalent property around SRP requires a separately reviewed trusted binding;
an ad hoc signed extension is not acceptable merely because its individual
primitives are sound.

This is the material protocol-selection question:

> When stronger platform key protection is available, must a completely new
> password-only client reject a clone made from only the portable RSTorrent
> profile and relay credential?

If the answer is yes, OPAQUE or an equivalently reviewed password-to-host-key
binding has a concrete advantage. If the accepted threat model protects only
previously pinned clients from such a clone, SRP plus a separate host identity
may be sufficient.

## Attack Scenarios

The table assumes correct protocol validation, a strong passphrase, bounded
online attempts and an authenticated record layer after login. Missing those
conditions can dominate every distinction below.

| Scenario | Expected analysis and behavior |
| --- | --- |
| Passive network or relay observation | PAKE messages and encrypted records must not reveal the password, application frames or traffic keys. Routing identity, endpoints, timing and ciphertext sizes remain observable. |
| Blind active relay | Forwarding an honest handshake unchanged may connect the real endpoints but must not reveal their key. Modifying the transcript or records must be rejected. |
| SRP verifier theft | The thief may impersonate the SRP server to a client and attempt offline password guesses. The verifier alone does not authenticate the thief as a client to the original host. |
| Credential-record theft with protected OPAQUE server key | The stolen record and OPRF material must not substitute for the non-exportable server AKE private key. Exact guarantees depend on the selected construction and key separation. |
| Portable profile clone | If every password, host, relay, device and resume secret is exportable in the profile, the clone may be cryptographically indistinguishable from the original. No protocol name repairs identical long-term secrets. |
| Existing client meets profile-only clone | A client with a pinned host public key must reject a clone that lacks the corresponding private key. Password success must not override the mismatch. |
| New client meets profile-only clone | Pure SRP plus an unpinned host signature may accept the clone. A password-bound protected host identity may reject it; this is a required protocol-feasibility test. |
| Stolen client resume credential | A bearer-like resume secret may allow direct impersonation and can enable a terminating proxy when paired with server impersonation. Resume must be device-bound, replay-resistant, independently revocable and no more authoritative than its parent device. |
| Active terminating proxy | If the attacker can authenticate independently to both sides, UI and commands may appear normal while content is observed or changed. Host identity, transcript binding, device proof and record authentication must prevent undetected termination. |
| Host key removed or protection tier lowered | A previously verified client must stop with an identity-change failure. It must not silently accept SRP-only, a new software key or an unverified fallback. |
| Live RSTorrent process compromise | A process attacker may read plaintext, issue commands and use an OS or hardware key as a signing oracle while control persists. Non-exportability may prevent taking the private key away but does not make the active process trustworthy. |
| Host OS or privileged compromise | Platform key isolation may still impede extraction, but the attacker may invoke the key, replace application code, alter UI or control routing. Claims require platform-specific evidence and must not treat hardware as absolute. |
| Hosted-client compromise | JavaScript that receives the password and plaintext can exfiltrate both before E2E protection applies. Relay blindness does not protect against malicious client code delivered by the hosting origin. |
| Password guessing | Relay and host both require bounded per-route, per-source and aggregate attempt controls without turning different errors or timing into a reliable username/password oracle. |
| Protocol downgrade or rollback | Version, algorithms, host identity, capabilities and key-protection expectations must be transcript-bound and pinned where appropriate. A successful older handshake must not silently erase a previously established higher floor. |

## Host-Key Protection Tiers

Platforms expose materially different facilities under names such as keychain,
keystore, credential vault, Secure Enclave and TPM.

| Tier | Private-key behavior | Protection and limitation |
| --- | --- | --- |
| Hardware-backed non-exportable | RSTorrent holds a handle and requests signing or key-agreement operations; private bytes do not enter its process. | Strongest defense against offline profile copying and key extraction. A live process attacker may still use the key as an oracle. Availability, algorithms and background-use policy vary. |
| OS-protected exportable | The OS encrypts the key at rest but returns plaintext key material to an authorized process. | Separates the key from the RSTorrent profile and may require OS credentials, but a compromised process can normally request or read it. |
| Portable profile key | RSTorrent stores an encrypted or plaintext software key with portable profile state according to the eventual storage design. | Broadest compatibility and easiest migration, but a sufficiently complete profile copy can clone host authority. |

Graceful degradation applies at initial provisioning on a platform that lacks a
stronger capability. It does not mean runtime silent downgrade. The chosen tier
and public identity become part of the client's trust record. If a
hardware-bound key becomes unavailable, recovery creates an explicit host
identity transition rather than falling through to a software key under the
old identity.

The platform adapter should expose cryptographic capability and key handles;
protocol/domain code must not depend on Keychain, Secure Enclave, Android
Keystore, TPM, Windows CNG or Linux secret-service types. The feasibility
campaign must determine which common algorithm, if any, can be implemented
without moving long-term private bytes through Rust, Kotlin or JavaScript.

## Device Identity And Resumption

PAKE authenticates password knowledge, not a physical device. Tactical `192`
requires a declared private-browser profile to become a named authorized client
after a successful password login:

1. Generate a device key using the best available local platform facility.
2. Prove possession of the device private key inside the authenticated E2E
   connection.
3. Ask the host to create a bounded device record with a stable random ID,
   public key, user-visible label, creation time, last-use state and revocation
   state.
4. Authenticate later connections with that client proof through a reviewed
   challenge-bound exchange that mutually proves the host and client before
   the application connection becomes ready.

A displayed device fingerprint is a human representation of the public key,
not the authority itself. Browser or hardware characteristics, user-agent
strings and probabilistic fingerprinting are not cryptographic device
identity.

Session resumption is a connection optimization beneath the same authorized
client principal. It must not persist the root PAKE traffic key as a
transferable full-owner bearer credential. Resume proof must be fresh,
challenge-bound, replay-resistant, expiry-bounded, independently revocable and
cryptographically bound to the host identity, client identity, relay
deployment and username, protocol floor, authorization generation and parent
authorization. A declared private-browser profile attempts it automatically
before showing the password form; a shared-browser login may keep only
page-lifetime resume state.

Tactical `192` bounds the initial host registry at 32 current authorized
clients and 128 non-authorizing expired/revoked tombstones retained for 180
days. Each record exposes owner-safe label, creation, last-full-login,
last-resume, last-seen, expiry, client build, route, active-circuit and
revocation facts. A separate bounded security ledger retains authenticated
authorization and circuit transitions while failed attempts use aggregate
buckets so hostile traffic cannot evict owner actions. Public keys or verifiers
establish proof; user agent, browser description, label and a client-asserted ID
do not.

Changing the passphrase, revoking one device, signing out everywhere and
replacing the host are distinct operations. Their invalidation matrix must be
chosen deliberately rather than falling out of which files happen to contain
which keys.

## Backup, Migration And Recovery

The eventual product must state whether a profile backup is intended to carry
remote-access authority.

- A portable complete authority backup makes recovery simple but also enables
  an offline thief to clone the host.
- A non-exportable host identity prevents silent cloning but cannot migrate by
  ordinary profile copy.
- A restored profile without its protected key must create a new host identity
  and require an explicit replacement flow.
- Existing clients must present an identity-change interruption, not a normal
  password retry or automatic repin.
- A completely new client has no prior pin; its protection depends on the
  selected password-to-host-identity binding.

Potential recovery authorities include local host access, an already trusted
device, a deliberately exported recovery secret or a central account. None is
free. The current direction guarantees new-device login while the original
host and password credential remain intact; it does not yet promise remote
recovery after loss of the host identity key or forgotten passphrase.

## Hosted Browser Integrity

E2E encryption begins only after trusted client code has processed the
passphrase and handshake. A malicious or compromised hosted login application
can send the passphrase, device key or decrypted content to its origin.

Future work must distinguish at least:

- an honest relay operator that can inspect routing metadata but not encrypted
  application records;
- a compromised relay transport that cannot forge transcript-bound endpoint
  authentication;
- a compromised static-client hosting origin that can replace JavaScript; and
- an installed, signed or otherwise independently anchored first-party client.

Strict content policy, no third-party scripts, minimal dependencies,
immutable/versioned assets and reproducible builds reduce risk but do not make
a web origin cryptographically unable to replace its own application. Security
claims must name which operator and code-delivery assumptions they cover.

## Reference Dossier

### Standards

- [RFC 2945](https://www.rfc-editor.org/rfc/rfc2945.html) specifies the original
  SRP authentication and key-exchange system.
- [RFC 5054](https://www.rfc-editor.org/rfc/rfc5054.html) specifies TLS-SRP,
  verifier construction, input validation, group concerns, username exposure,
  verifier-theft server impersonation and rate-limit requirements. Its older
  TLS cipher suites are not an RSTorrent transport recommendation.
- [RFC 9807](https://www.rfc-editor.org/rfc/rfc9807.html) specifies OPAQUE,
  including registration, online AKE, password stretching hooks,
  precomputation resistance, forward secrecy, server-key separation and the
  remaining offline-dictionary boundary after single-server compromise.
- [RFC 9497](https://www.rfc-editor.org/rfc/rfc9497.html) specifies the VOPRF
  construction used by the selected OPAQUE configuration.
- [RFC 9106](https://www.rfc-editor.org/rfc/rfc9106.html) specifies Argon2id
  and the memory/time tradeoffs that the browser proof must measure.
- [RFC 9180](https://www.rfc-editor.org/rfc/rfc9180.html) specifies HPKE and is
  relevant background for high-entropy PSK/public-key constructions. HPKE is
  not a password protocol and must not receive a human passphrase as a PSK.

Implementation must re-read the exact current documents, errata, library
documentation and test vectors rather than treat this summary as normative
protocol guidance.

### OPAQUE Rust/Wasm candidate

The initial exact candidate for Tactical `190` is
[`opaque-ke` `4.0.1`](https://crates.io/crates/opaque-ke/4.0.1), tag `v4.0.1`
commit `75fe4cdddb7946440054da0c8e7cdd73828af3f9`, crates.io SHA-256
`ded22991b43cd15561b62b2e1cf9ace1344a8534eebec96202d5c96a77a6616a`,
licensed `MIT OR Apache-2.0` with Rust 1.85 minimum. The surveyed implementation
and test paths, audit limitation and final dependency gate are recorded in the
tactical and the central reference ledger. No dependency, source or fixture is
accepted merely by this design selection.

[`@serenity-kit/opaque` `1.1.0`](https://www.npmjs.com/package/@serenity-kit/opaque)
is a browser/Wasm feasibility and performance reference, not an accepted
dependency or an independent implementation. Its published browser Argon2
measurements justify measuring RSTorrent's complete native/Wasm construction
before selecting parameters.

### YepAnywhere

The local `~/code/yepanywhere` sibling was inspected during the 2026-08-04
discussion at commit `cc4732bf8d4ca9d0b4cce1c8eaf13de1ea4f11be`, its
relay-relevant paths were refreshed for Tactical `190` at commit
`dcf0449d5336c866d37c50cb1f2e1df66ed50663`, and its clean resume/mobile audit
direction was refreshed for Tactical `192` at commit
`506ce0528ffe3ef44c5e4ee90780b44eb80d4a15`. It is a product, architecture and
failure reference, not an RSTorrent dependency or wire contract. Relevant
paths include:

- `packages/server/src/crypto/srp-server.ts`: `tssrp6a`, a 2048-bit group and
  SHA-512 produce the stored salt/verifier and server SRP session;
- `packages/client/src/lib/connection/srp-client.ts`: the browser performs the
  corresponding SRP steps and verifies the server proof;
- `packages/client/src/lib/connection/SecureConnection.ts`: SRP/resume output
  is composed beneath the shared inner protocol and above encrypted records;
- `packages/server/src/routes/ws-srp-handlers.ts`: full login, challenge-bound
  resume, transport-key derivation, authentication state and session creation;
- `packages/server/src/remote-access/RemoteSessionService.ts`: retained resume
  session ownership and expiry;
- `packages/shared/src/crypto/srp-types.ts`: handshake and resume messages;
- `docs/project/ws-auth-state-model.md`: trusted-local and SRP-established
  authentication remain distinct;
- `topics/mobile-server-pairing.md`: Android keeps one logical paired-server
  profile across direct and relay routes, stores expiring resume material under
  Android Keystore and requires fresh server proof before attaching a route;
- `topics/security-client-audit.md`: a bounded server registry distinguishes
  client identity, authentication observations, resume credentials, active
  transport and revocation while Android proves a per-server continuity key;
- `docs/project/mobile-companion-app.md` and
  `topics/trusted-client-packaging.md`: packaged Android assets, private
  credential ownership, challenge-bound mutual resume and hosted-client
  compromise remain distinct trust boundaries;
- `topics/client-source-runtime-topology.md`: one future logical server identity
  may survive direct/relay route changes while the current route-scoped key is
  explicitly not server identity; and
- `topics/relay-origin-and-share-gating.md`: owner Remote Access is E2E while
  the current public-share exception is relay-readable;
- `docs/project/relay-design.md`, `topics/relay-client-mux.md`,
  `docs/project/relay-head-of-line-blocking.md`,
  `packages/shared/src/relay.ts`, and `packages/relay/src/mux-handler.ts`:
  username routing, opaque forwarding, fairness, fencing and joined cleanup.

Lessons adopted as investigation inputs:

- username/passphrase login from an unpaired new browser is convenient and
  avoids central-account recovery dependence;
- password authentication, device identity and resume state are different
  concerns even when one implementation initially combines them;
- a logical server/client relationship should survive an authenticated route
  change without treating a relay route as server identity;
- an operator needs durable client, authentication, resume, circuit and
  revocation facts rather than one opaque "logged in" flag;
- encrypted transport must wrap the same inner semantic application protocol
  used by direct connections;
- challenge-bound resume and protocol-floor pinning are security behavior, not
  socket convenience;
- relay routing, authentication, record encryption and application authority
  require separate state owners; and
- persisted symmetric resume material can enlarge profile-clone and client
  impersonation consequences; a client continuity key identifies the client to
  the server but is not itself a server public-key identity.

RSTorrent does not adopt YepAnywhere's SRP library, NaCl construction,
session-file shape, field names, protocol versions, limits or public-share
exception without separate evidence and an explicit decision.

## Feasibility And Library Research Gates

Tactical `190` owns the first bounded protocol and composition proof. It must
record and satisfy the applicable gates below before adding its candidate
dependency or proof protocol code; later device, recovery and platform-key
tacticals own the gates that its non-goals explicitly defer.

### Protocol and library matrix

- Close the exact `opaque-ke` native/Wasm dependency and standards dossier;
  retain SRP-6a as comparison history rather than implementing both protocols.
- Record exact versions, licenses, maintainers, recent activity, audits,
  published security review, standards conformance, errata handling and test
  vector coverage.
- Confirm fixed approved parameters, hostile input validation, constant-time
  behavior, zeroization posture, randomness sources, password byte/string
  normalization and error behavior.
- Prove native/Wasm vector and serialized-message equivalence, browser CSPRNG
  failure behavior and consuming state-handle semantics.
- Measure browser bundle cost, handshake CPU/memory and denial-of-service cost
  before authentication succeeds. Low-end physical-device evidence remains a
  production gate outside the controlled proof.
- Reject a design that requires independently reimplementing protocol
  arithmetic or translating key material through an unreviewed custom bridge.

### Platform key matrix

This matrix remains required before a production protection-tier claim, but is
not a stopping condition for Tactical `190`'s explicit portable-profile tier.

- Determine non-exportable signing or key-agreement support and exact
  algorithms on macOS, Windows, Android and the supported Linux posture.
- Distinguish ordinary secret vaults that return private bytes from services
  that retain the private key and return only an operation result.
- Record background-use, user-presence, application-identity, backup,
  migration, deletion, attestation and failure behavior.
- Prove the platform adapter can expose a narrow handle/capability without
  leaking platform types into the protocol core.
- Define the initial-provisioning fallback and the fail-closed response to
  later capability loss or identity mismatch.

### Adversarial protocol evidence

- Passive relay capture cannot recover passwords, traffic keys or application
  frames.
- Modified, replayed, reordered, truncated, reflected and cross-route
  handshake messages fail without partially authenticated state.
- A blind active relay may forward an honest handshake but cannot terminate it
  invisibly.
- Stolen-verifier, stolen-credential-record, stolen-relay-credential,
  profile-only-clone and full-secret-clone fixtures produce the documented
  distinct outcomes.
- Existing pinned and completely new password-only clients are tested
  separately against a profile clone.
- Host-key removal, tier downgrade, algorithm downgrade and protocol rollback
  fail closed under an established trust record.
- Stolen, expired, replayed, revoked and cross-device resume material cannot
  silently gain owner authority.
- Concurrent original and clone registration/routing behavior is bounded and
  observable rather than last-writer-wins by accident.
- A slow handshake, invalid proof flood or offline host cannot consume
  unbounded relay or host state.
- Direct and relayed connections deliver the same authenticated inner
  application trace after establishment.

### Product and recovery evidence

New-device login, blocking host-identity change, secret handling and honest
user-facing claims apply proportionately to Tactical `190`. Authorized-client,
resume, audit and complete invalidation-matrix behavior now belongs to
production-shaped local Tactical `192` rather than being implied by the proof.

- New-device passphrase login works without a central account or an existing
  paired device when the original host is healthy.
- Remembering a device creates an independently named and revocable identity.
- Ordinary private-browser reconnect, reload, restart and route reattachment
  resume without password entry while shared-browser state does not persist.
- Password change, single-device revocation, sign-out-everywhere, host reset,
  profile restore and host replacement have an explicit invalidation matrix.
- The host lists every authority-bearing client and live circuit, preserves a
  bounded non-authorizing security history and prevents failed-attempt floods
  from displacing authenticated owner actions.
- Existing clients present a blocking host-identity change rather than
  repinning or falling back silently.
- Logs, diagnostics, crashes and support exports contain no password,
  verifier, private key, traffic key, resume secret or unbounded
  attacker-controlled identity text.
- User-facing claims distinguish relay blindness, hosted-client trust,
  hardware protection and portable fallback honestly.

## Recommended Next Work

Do not add a production remote listener from this topic alone. Completed
Tactical
[`190`](../tactical/190-opaque-wasm-relay-foundation.md) owns the controlled
host/browser-Wasm construction and evidence record; its retired proof
binary was never a product mode.

Completed Tactical
[`192`](../tactical/192-production-owner-relay-access.md) owns the durable
application-private authority, local enable/disable/change/recovery UX,
desktop and configured-headless lifecycle, independently built remote browser,
separate loopback TLS relay and complete local package/browser evidence. The
active deployment/finalization work now owns public relay/client activation,
DNS/TLS, external paths, operations, rollback, soak and support claims. Its
portable product and atomic Pages portions are committed, and its retained
website/relay canary is active but unadvertised and unsupported. External
signed-package and browser paths, rollback, certificate renewal and soak remain
open. Passkeys, account-wide identity, delegation and multi-user roles remain
separate decisions and are not implied by this implementation.

Friend sharing, fragment-held capability links, offline encrypted snapshots,
UPnP/NAT traversal, wake-up delivery, public accounts and multi-user
authorization remain separate future topics or tacticals. Local media
byte-range serving and its separate future remote boundary now live in
[`http-file-serving-and-streaming.md`](http-file-serving-and-streaming.md).
Owner authentication should establish the reusable principal and encrypted
connection foundation without pre-solving those products.
