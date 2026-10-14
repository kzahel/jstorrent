# Windows Firewall Research Fixtures

These independently authored fixtures support the authorized Windows round of
[Tactical 338](../../docs/tactical/338-macos-network-consent-research.md) and
[Tactical 340](../../docs/tactical/340-windows-quiet-network-startup.md).
They do not change product policy or add firewall exceptions.

Use the sibling Machine Control common CLI, read its Windows platform/provider
guide, run the read-only doctor, and claim the exact development guest. Preserve
inherited rules, applications, native-host registrations and grants. Use fresh
executable paths beneath an owned guest directory without spaces. Launch GUI
probes through `desktop application launch`, not session-zero SSH. Never select
Allow automatically. Capture the native dialog before choosing Cancel; confirm
its disappearance and independently inspect the exact executable's rules.

Compile `Probe.cs` with the Windows .NET Framework C# compiler, referencing
`System.Windows.Forms.dll` and `System.Drawing.dll`, as a `winexe`. Its buttons
isolate loopback TCP/HTTP, outbound UDP route selection without payload, wildcard
TCP, UDP bind, UDP receive, and one TTL-one SSDP discovery datagram. `mode.txt`
beside the executable optionally selects comma-separated startup actions.
Results are written beside it to `results.tsv`. Twelve actions and a four-minute
process deadline bound sockets/work; Quit or deadline closes every socket.
Use distinct executable paths for independent automatic cohorts. Identical
binary bytes at different paths test Windows application-rule identity; this
does not qualify signed shipping identity or managed firewall policy.

Compile `utp-syn.cs` as a console executable. It independently encodes one
BEP 29 SYN to an owned IPv4 loopback server port, from an explicit distinct
client port, with cryptographic random connection ID and sequence. It waits
at most two seconds and validates source, version, type, connection and ACK.
Positive observations send RESET. `reply_received` distinguishes silence from
a mismatched packet; exit zero alone is not a successful handshake assertion.
Malformed/distinct-port bounds fail with exit 2 before allocating a socket.

Build the application-service example after sourcing `scripts/dev-env.sh`:

```bash
cargo build --locked -p rstorrent-session --example incoming-off-research
```

Use the private, tracker-free fixture recipe in the
[Mac fixture guide](../macos-network-consent/README.md). Transfer it, the native
example as `research.exe`, SYN probe as `utp-syn.exe`, and `Run-matrix.ps1` through
claimed Machine Control `testbed -- push`. A runtime-only guest may lack the
MSVC runtime; the research session used verified Microsoft-signed runtime DLLs
beside the executable, removed during cleanup, rather than changing the guest's
installed toolchain. Never check those binaries into this repository.

Run `Run-matrix.ps1 -Root OWNED_ROOT` inside the guest through claimed
`testbed -- ps`. `-ExcludedPorts` accepts previous observed ports, including
failed attempts. The runner reserves a numeric port ledger before each client,
guards earlier ports in later servers, and uses fresh processes/profiles for
`off / on / tcp / off`. It asserts On SYN positives and Off/unused/TCP-only
negatives, Off TCP refusal and zero incoming allocation, client results,
independent SHA-256, and absent terminal owners. The repaired `client`
diagnostic must complete against On. Tactical 338's expected diagnostic failure
and TCP-Off uTP admission describe the old source. A failed validation must
stay failed;
inspect logs, correct the harness, and run a new cohort rather than weakening
assertions. Generated logs/profile/payload files belong only in the owned root.

The example's independent `wire-utp` and `wire-tcp` clients use plain BEP 3
framing, exact seed identity, per-piece SHA-1 and a 30-second transfer deadline.
`wire-fast` adds the BEP 6 handshake bit and initial `HaveNone`;
`wire-fast-missing` intentionally omits that required availability message.
Each frame is capped at 16,393 bytes, messages at 128, payload at 1 MiB. The
caller independently hashes successful output. Optional final `PEER_IPV4`
selects an owned private-network seed for a non-loopback outbound check; it is
an explicit diagnostic endpoint, not product local-network permission policy.
uTP shutdown reports zero connections/tasks separately from transfer success.

The research-only `interactive` server starts the actual application service
with TCP/UPnP/DHT/PEX/IPv6 disabled and Online network policy. Launch it in the
guest user session with the normal five server arguments. Its fresh case root
contains `ready.json`; caller-created `enable-incoming` and `enable-upnp` files
apply ordinary settings commands once and record action results. `stop` requests
joined shutdown, or a four-minute deadline does; `stopped.json` records terminal
owners. Observe socket inventory and the OS independently: successful commands
or a bound listener do not establish firewall permission. This trigger-file
interface exists only in the example, not any product client.

For actual desktop restore checks, `prepare-client OWNED_APP_DATA FIXTURE_ROOT
SERVER_PORT [PEER_IPV4]` accepts an explicitly owned loopback/private peer. Use
a host loopback seed reached through the guest's declared NAT host-alias route
to exercise cross-VM outgoing traffic. Stop the owned desktop before
`inspect-profile OWNED_APP_DATA` (at most eight torrents) or `prepare-legacy`.
Inspection reports saved settings, wanted intent and verified piece counts
without creating a network owner. `prepare-legacy` retains the existing data and
sets old fixed-port/UPnP intent; an owned v3 shell record then exercises the real
Windows migration. Independently hash downloaded/retained bytes and join both
desktop and seed. Stage verified runtime DLLs beside versioned native helpers
too when the runtime-only guest lacks the MSVC runtime.

Finish by joining research processes, deleting only this round's exact-path
OS-created rules and artifacts, verifying inherited rules remain unchanged,
and returning an initially stopped guest to powered off before releasing its
claim. Use the provider's declared clean shutdown route, including its typed
disruptive claim when the configured scheduling assist requires one.

For controller-local temporary artifacts, a command-policy rejection before
PowerShell execution is distinct from a filesystem access failure. Native
Python cleanup worked in this round: verify the exact expected folder name and
resolved TEMP parent, reject Windows reparse points and any resolved descendant
outside that root, then call `shutil.rmtree` and assert the folder is absent.
Keep validation and deletion in that single process; do not change ACLs or
assemble deletion commands from paths enumerated in another shell.
