# ChromeOS Linux Release Runbook

RSTorrent's ChromeOS Linux package uses the `crostini-v<version>` tag family
and the [`Crostini Release`](../.github/workflows/crostini-release.yml)
workflow. It is separate from the desktop updater channel and GitHub's latest
release selection. The website bootstrap is pinned to one reviewed tag.

`crostini-v0.1.0` is the first public ChromeOS Linux preview release. Its
tagged workflow, independently downloaded assets, production-key signature,
exact x86_64 website installation, Launcher handoff, and stop/relaunch smoke
passed on 2026-08-26. The native ARM64 package passes the hosted build and
archive gates but has not run on a physical ARM Chromebook.

## Trust And Artifacts

The workflow natively builds one GNU/Linux archive on Ubuntu 22.04 x86_64 and
one on Ubuntu 22.04 ARM64. It generates a canonical manifest containing the
source commit, launch protocol, extension identity, and exact size and SHA-256
of both packages. The existing RSTorrent beta updater key signs that manifest.

A complete release has exactly these five assets:

- `rstorrent-crostini-X.Y.Z-x86_64.tar.gz`
- `rstorrent-crostini-X.Y.Z-aarch64.tar.gz`
- `rstorrent-crostini-release.manifest`
- `rstorrent-crostini-release.manifest.minisig`
- `SHA256SUMS`

`SHA256SUMS` is useful independent transport evidence, but the bootstrap's
trust root is the embedded public key and signed manifest. The workflow keeps
an incomplete upload as a draft and publishes the release as non-latest only
after checking the remote asset set.

## First Public Release Evidence

Public non-latest release
[`crostini-v0.1.0`](https://github.com/kzahel/rstorrent/releases/tag/crostini-v0.1.0)
points at source commit `4abf165f07a94d86a88f443bd9f879c2079d227c`.
Workflow run
[`32986250710`](https://github.com/kzahel/rstorrent/actions/runs/32986250710)
passed the source gate, native Ubuntu 22.04 x86_64 and ARM64 package builds,
production-key signing, exact asset-set verification, draft creation, and
publication. The exact public hashes are:

- website bootstrap:
  `188064c7c983d44230785639d3e2d0c1d8963a507b709059b101af876785bed0`;
- x86_64 package:
  `1d0ec34e55e7fc58742cb59ae8e40100e3b8a429f4d908440a1e26ecc8189979`;
- ARM64 package:
  `67a3922170b970e7b11ef7a4a628a546922b0a486f15e42311f0988df4843919`;
- manifest:
  `881881456a4653a9d3df7fb09b41941d73a689db367dd4eb7ec79374f886bf44`;
- manifest signature:
  `1a3e1469caac6b349c0e4d10d1efa2c906cdf3f0da16df75c4a8975f3110ba07`;
  and
- `SHA256SUMS`:
  `f6a573a3ac8e162a2343a5f9ef8dd7dd13b6195df2b958669e097ee2e643e07d`.

An independent download verified every `SHA256SUMS` row, the manifest's
production-key signature, strict signed identity, and both archive shapes.
The exact website command then repaired the retained installation as the
ordinary user in x86_64 Debian 12.12 `penguin` on ChromeOS `16700.60.0` M150.
It preserved `metrics.db`, `session.db`, and `web-auth.sqlite3` byte-for-byte
across installation. The installed launcher and gateway hashes were
`24788ce9280609485b19963eb5d10d5b3b80e8b006342346f138fe3f04a12d10`
and
`77289ce2834a4250917fd7754a63b4d12712f0529f04b3c0a60e473e74d5ed6c`.

The ChromeOS Launcher produced one static active service, one listener, and
one `http://penguin.linux.test:3030/` RSTorrent tab. `/healthz` reported
product `rstorrent-crostini`, build `0.1.0`, and launch protocol `1`; the
host-served React UI reported `connected`. Closing the tab, stopping
the service, and selecting the Launcher item again restored the same identity
and singleton cardinality.

## Rehearse Without Publishing

After the workflow source exists on GitHub, run it manually from `main`:

```bash
gh workflow run crostini-release.yml --ref main
gh run list --workflow crostini-release.yml --limit 1
gh run watch RUN_ID --exit-status
```

The manual run does not read the production signing secret: the source gate
and two native build jobs run, and their packages remain as private Actions
artifacts for 14 days. No tag or GitHub Release is created.

## Cut A Release

1. Set the same stable three-part version in
   `crates/rstorrent-crostini/Cargo.toml`, its `Cargo.lock` entry, the matching
   changelog heading, and `PINNED_TAG` in
   `website/public/install-crostini.sh`. A pin may advance only to the release
   being reviewed; it must never select GitHub's latest release implicitly.
2. Run the source baseline from Tactical 169, including the bootstrap fixture,
   manifest tests, package validation, shared web tests, and website build.
3. Commit the release source and let ordinary CI pass. Do not advertise the
   website command yet.
4. Create and push the exact annotated tag only with explicit maintainer
   authorization:

   ```bash
   git tag -a crostini-vX.Y.Z -m "RSTorrent ChromeOS Linux X.Y.Z"
   git push origin crostini-vX.Y.Z
   ```

5. Watch the tagged workflow. It must pass its source gate, both native package
   jobs, production-key signature verification, exact release-set check, and
   final publication step. Failure before finalization must leave no public
   partial release.
6. Independently download all five immutable release assets. Check every
   `SHA256SUMS` entry, verify the manifest with the public key, compare the
   signed commit/tag/version/protocol/extension/runtime fields, and re-run the
   package validator on both archives.
7. On a physical Chromebook of the matching architecture, run the exact
   website bootstrap, open the ChromeOS Launcher entry, verify health and the
   host-served UI identity, stop/relaunch once, and confirm existing profile
   data is preserved. Record exact public hashes and cleanup in a dated
   evidence document.
8. Only after that acceptance may product or extension copy present
   `curl -fsSL https://rstorrent.com/install-crostini.sh | bash` as a supported
   installation path.

The website deployment and tag are separate external mutations. A source
commit, manual rehearsal, or successful native build does not authorize either
one.
