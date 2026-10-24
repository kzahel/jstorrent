# Running the Linux headless service

The headless service owns a persistent application session; a browser controls
it. Use the [foreground downloader](engine.md#one-foreground-download) for a
finite download or the [client guide](clients.md#live-web-ui) for UI development.
This guide describes local source builds, not a newly published release channel.

## Build and install

On native x86_64 or ARM64 Linux:

```bash
source ~/.profile
scripts/build-headless-package.sh
scripts/validate-headless-package.sh /path/to/the/generated-archive.tar.gz
```

The builder writes the archive under `target/headless/`. Its
[source](../../scripts/build-headless-package.sh) documents architecture and
binary-directory overrides. Cross-host validation checks archive/ELF structure;
target-native execution is required for runtime evidence.

Extract the archive into an ordinary-user-owned directory and run its
`install.sh`. It creates immutable versions, a stable command link and the
user service without starting it, enabling it or changing lingering. Follow
the installer's instructions to configure `~/.config/rstorrent/headless.toml`
and protect it with mode `0600` before explicitly enabling:

```bash
systemctl --user enable --now com.jstorrent.rstorrent.headless.service
$HOME/.local/bin/rstorrent-headless status
journalctl --user -u com.jstorrent.rstorrent.headless.service
```

Retained internal/package identifiers are independent from the active product
release identity. [Release policy](releasing.md) freezes new RSTorrent
incubation publication; building locally does not promote a public service
channel or authorize deployment.

## Configuration and exposure

The [runtime configuration topic](../topics/runtime-configurations-and-headless-deployment.md#configuration-contract)
owns the configuration schema. Its [deployment security modes](../topics/runtime-configurations-and-headless-deployment.md#deployment-security-modes)
explain authenticated hosting, exact trusted-LAN binding and a separate
loopback host behind Tailscale Serve.

Choose exposure deliberately. The no-auth modes give every permitted network
participant full owner control; exact Host/Origin validation is still required.
The installer does not configure firewalls, DNS, TLS, a reverse proxy, router
mapping, Funnel or tailnet ACLs. Machine-specific listener addresses and service
state belong in private deployment records, not this shared guide.

## Updates and removal

Where an existing signed channel is configured, checking is read-only and
applying delegates to the health-checked, rollback-safe installer:

```bash
$HOME/.local/bin/rstorrent-headless update --check
$HOME/.local/bin/rstorrent-headless update --apply
$HOME/.local/bin/rstorrent-headless uninstall
```

The browser can show update status and the operator command; it cannot install
or restart the service. Repair restores prior enabled/running intent only after
readiness succeeds. Normal uninstall retains configuration, secrets, profile
and downloaded files.

For optional local deployment after an authorized push, use the
[local-deploy guide](../../scripts/local-deploy/README.md). That worker builds
the exact pushed source snapshot and never broadens exposure or enables the
service. Retained signed manifests and installer compatibility are documented
in the [migration stream](../migration/README.md).
