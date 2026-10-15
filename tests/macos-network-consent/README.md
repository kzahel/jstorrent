# macOS Network Consent Research Fixtures

These independently authored diagnostics support
[Tactical 338](../../docs/tactical/338-macos-network-consent-research.md) and
[Tactical 339](../../docs/tactical/339-macos-quiet-network-startup.md).
They are not product startup code or a permission-state API. Use an isolated,
claimed macOS testbed through Machine Control; do not reset a person's privacy
database or accept access for their installed product.

`Probe.m` creates a Cocoa app with explicit actions for wildcard TCP/UDP bind,
public-address UDP route selection and multicast UDP connect. None sends a
datagram. It records operations and errno to a caller-owned JSON file selected
by `ProbeResults` in its plist. Optional `ProbeAutomaticMulticast` and
`ProbeAutomaticInterfaces` plist booleans perform the corresponding operation
at GUI startup. The former is deliberately prompt-producing research behavior.

Prepare a fresh identity and independently linked executable for each consent
cohort. Verify UUIDs differ with `dwarfdump --uuid`; a renamed copy of the same
Mach-O is insufficient. Ad-hoc identity/name/description and denial behavior
must not be treated as qualification of Developer ID signed shipping apps.

Example from the repository root on a Mac:

```bash
lan_probe_root="$(mktemp -d)"
lan_probe_identifier="com.jstorrent.network-probe.$(date +%s)"
lan_probe_app="$lan_probe_root/JSTorrent Network Probe.app"
mkdir -p "$lan_probe_app/Contents/MacOS" "$lan_probe_app/Contents/Resources"
clang -fobjc-arc -mmacosx-version-min=13.0 -framework Cocoa \
  "-DPROBE_ID=\"$lan_probe_identifier\"" \
  tests/macos-network-consent/Probe.m \
  -o "$lan_probe_app/Contents/MacOS/probe"
python3 - "$lan_probe_app" "$lan_probe_identifier" "$lan_probe_root" <<'PY'
import pathlib, plistlib, sys
app, identity, root = sys.argv[1:]
info = {
    "CFBundleIdentifier": identity,
    "CFBundleExecutable": "probe",
    "CFBundleName": "JSTorrent Network Probe",
    "CFBundleDisplayName": "JSTorrent Network Probe",
    "CFBundleInfoDictionaryVersion": "6.0",
    "CFBundlePackageType": "APPL",
    "CFBundleVersion": "1",
    "CFBundleShortVersionString": "1.0",
    "NSLocalNetworkUsageDescription":
        "Test when local-network access is requested. This probe sends no torrent data.",
    "ProbeResults": str(pathlib.Path(root) / "results.json"),
}
(pathlib.Path(app) / "Contents/Info.plist").write_bytes(plistlib.dumps(info))
PY
codesign --force --sign - "$lan_probe_app"
dwarfdump --uuid "$lan_probe_app/Contents/MacOS/probe"
```

For a guest, stream the built bundle through Machine Control's claimed guest
`exec -i` transport, and set `ProbeResults` to the owned **guest** output path
before signing. Launch with guest `open -n APP_PATH` to exercise LaunchServices.
Use Machine Control snapshots and AX button actions to observe the initial
state, press a probe action, inspect UserNotificationCenter, and decline the
owned request. Record action receipts and independently read the result file.
An explicit Terminal-opened `.command` file executing the inner binary tests
Terminal-child attribution; ordinary remote execution is not that comparison.
Do not infer granted access from a successful `connect()` return value.

`utp-syn.c` sends one independently encoded 20-byte uTP SYN to an owned
**loopback** UDP port, from an explicit fresh client port. It randomizes the
connection ID and SYN sequence, waits at most two seconds/eight packets, and
checks the reply's source address/port, version, STATE type, connection ID and
acknowledgement. A matching reply is followed by a RESET for that new research
connection. This proves a SYN response; it alone proves neither a completed
BitTorrent handshake nor payload access. JSON reports each check separately;
exit zero means the observation ran, so assert the expected JSON fields.

```bash
clang -Wall -Wextra -Werror -mmacosx-version-min=13.0 \
  tests/macos-network-consent/utp-syn.c -o "$lan_probe_root/utp-syn"
"$lan_probe_root/utp-syn" OWNED_SESSION_UDP_PORT FRESH_CLIENT_PORT
```

The research-only Rust example exercises the same application service used by
the native apps, headlessly. It does not qualify macOS GUI consent or change
product defaults. Build after sourcing `scripts/dev-env.sh`:

```bash
cargo build -p rstorrent-session --example incoming-off-research
```

Create an independently authored private, tracker-free v1 fixture in an owned
`fixture` directory. It contains 131,803 deterministic bytes and three pieces:

```python
import hashlib, pathlib
root = pathlib.Path("OWNED_ROOT/fixture")
root.mkdir(parents=True, exist_ok=False)
def encode(value):
    if isinstance(value, int):
        return b"i" + str(value).encode() + b"e"
    if isinstance(value, bytes):
        return str(len(value)).encode() + b":" + value
    return b"d" + b"".join(encode(k) + encode(value[k])
                           for k in sorted(value)) + b"e"
payload = bytes((i * 17 + 31) % 256 for i in range(128 * 1024 + 731))
info = {b"length": len(payload), b"name": b"fixture.bin",
        b"piece length": 65536, b"private": 1,
        b"pieces": b"".join(hashlib.sha1(payload[i:i + 65536]).digest()
                            for i in range(0, len(payload), 65536))}
(root / "fixture.bin").write_bytes(payload)
(root / "fixture.torrent").write_bytes(encode({b"info": info}))
print(len(payload), hashlib.sha256(payload).hexdigest())
```

Transfer the executable and fixture through claimed Machine Control `exec -i`.
Run these commands **inside the guest**, using a fresh case directory and
explicit ports for each client invocation:

```text
incoming-off-research server CASE_ROOT FIXTURE_ROOT off EXCLUDED_PORTS
incoming-off-research handshake FIXTURE_ROOT SERVER_PORT CLIENT_PORT UNUSED_OUTPUT
incoming-off-research client FIXTURE_ROOT SERVER_PORT CLIENT_PORT PAYLOAD_OUTPUT
```

Server modes are `off` (TCP Disabled, uTP preferred), `on` (loopback TCP enabled,
uTP preferred), and `tcp` (loopback TCP enabled, uTP disabled). UPnP, DHT, PEX
and IPv6 are disabled in every cohort. The server validates the fixture's piece
hashes, starts the ordinary maintenance owner, and waits for active/inactive-
exempt seed admission before reporting its actual UDP port and listener status.
It holds guards on at most 64 comma-separated excluded earlier server/client
ports, and has a 90-second deadline. `CASE_ROOT/stop` requests joined shutdown.

The handshake client independently encodes/validates the 68-byte plain
BitTorrent exchange, including info hash and server peer ID, with a five-second
deadline. It uses a distinct peer ID from the download client, avoiding a
self-inflicted duplicate-peer admission conflict. Transport shutdown is joined
separately; FIN-drain time is not handshake evidence. The download uses the
existing bounded controlled-uTP diagnostic (35 seconds overall, 20-second
message timeout), validates every piece hash, and reports terminal connections
and UDP tasks. Independently compare the returned payload's SHA-256; do not
claim transfer success from an emitted readiness record.

Repeat `off / on / tcp / off` with distinct processes, profiles and all numeric
server/client ports. Assert initial uTP connection count zero, random IDs differ,
reply source/header checks pass only for `on`, and `off`/`tcp` are silent.
Current `off` must allocate no incoming uTP connection and refuse TCP; the
TCP-Off admission recorded by 338 describes the pre-339 source.
Also probe a verified unused loopback port from another fresh source; it must
be silent. Guard every earlier server/client port in later cohorts and retain
all observed ports in the run record, including failed client attempts.

For a real native desktop outbound restore, stop the owned isolated app and use
only its disposable support root (never a user's installed profile):

```text
incoming-off-research prepare-client OWNED_APP_SUPPORT_ROOT FIXTURE_ROOT SERVER_PORT
incoming-off-research prepare-legacy OWNED_APP_SUPPORT_ROOT
```

`prepare-client` requires a fresh profile, persists Off/UPnP Off, disabled
DHT/PEX/IPv6/encryption, a wanted private fixture and its loopback peer hint,
then installs independently verified metadata without networking. A duplicate
intake intentionally retains its original source, so the peer magnet is added
first. Launch the native app normally and independently hash its downloaded
file. Use `on` and `tcp` seeds separately to distinguish uTP and TCP fallback;
assert the app still reports Off and the seed's actual transport counters.
`prepare-legacy` requires an existing owned profile and writes old fixed-port/
UPnP intent without starting an engine. With an owned version-3 shell fixture,
normal Mac startup should hold both off, retain port 45432 and all torrent/data/
unrelated shell choices, and atomically persist its defaults marker.

Finish by gracefully quitting owned apps, closing only owned Terminal windows,
restoring any inherited native-host registrations, and deleting owned bundles,
profiles, logs and captures. Preserve inherited Machine Control grants and
release the owned claim. OS privacy history may outlive discarded ad-hoc test
identities; do not edit its databases to make the fixture appear fresh.
