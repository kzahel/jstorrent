# Latest 0.2.801 Public Delivery Evidence

Date: 2026-09-29 UTC. Owning tactical: [240](../tactical/240-signed-desktop-control-qualification.md).

[Release](https://github.com/kzahel/rstorrent/releases/tag/desktop-latest-v0.2.801)
published at 23:19:13 UTC from immutable source
`fc401ecf72936b073d0825644c94971b44718247`.
[Main CI](https://github.com/kzahel/rstorrent/actions/runs/36636558577)
passes all ten required jobs; the forced
[Nightly workflow](https://github.com/kzahel/rstorrent/actions/runs/36640704946)
passes source checks, all five signed package jobs and the collector.
This is an incubation Latest prerelease, not a Stable or production graduation.

Independent public verification downloads all 14 assets, checks each GitHub
SHA-256 digest and every `SHA256SUMS` entry, resolves the tag to the exact source,
and verifies all ten unique updater payload signatures with `minisign -V`
against the updater public key from that source. The manifest contains 15
platform aliases for five target/architecture pairs. No published 701 asset
is replaced.

## Public Package SHA-256

| Package | SHA-256 |
| --- | --- |
| `RSTorrent-0.2.801-1.aarch64.rpm` | `b37892c2c90812602db1555b99ee8b33273236b4317eadecf2b263b2f467f764` |
| `RSTorrent-0.2.801-1.x86_64.rpm` | `5cfd6276e33ca8a16f56985fd5e5ea4ef354147f1a5d1d07f19f2480e1928c6e` |
| `RSTorrent_0.2.801_aarch64.AppImage` | `2aa4e7d12cbbdab5a520164f73bf1dea6940848edc78a9286d44605a636dfeff` |
| `RSTorrent_0.2.801_aarch64.dmg` | `d0db51d5012e55d49629a68c388219b0bd058ed7cb623eccc393c0c45e05a5f5` |
| `RSTorrent_0.2.801_amd64.AppImage` | `6bd9f5f8306c5182fc04dff18760f9af22e4028947a7be7c96e63c5bfc8b7b9e` |
| `RSTorrent_0.2.801_amd64.deb` | `f3cf8451525a803ff137f3056cc83d46982f858dcd723a34fffdc74d16f515b2` |
| `RSTorrent_0.2.801_arm64.deb` | `47813cac10395146b1ad661579fd3bee3f05d370a9da8c7acb4df5d9124a810d` |
| `RSTorrent_0.2.801_x64-setup.exe` | `1606b110156fda0f7a9850b3009664d79e27f3a543a740ba57230f36fcbf2c2c` |
| `RSTorrent_0.2.801_x64.dmg` | `da279d004ff240367516a19e6a7dfcfef151ec2135257a5a1b25b285bb6d46a8` |
| `RSTorrent_0.2.801_x64_en-US.msi` | `af96fa31a153ea9389909e4229fd8c3c9d46e21216a4786b8cf652a12bb1e3d6` |
| `RSTorrent_aarch64.app.tar.gz` | `aafc0cfede3d197459dd2107dd0788c3322020db59abce6ea4b63242a6b98473` |
| `RSTorrent_x64.app.tar.gz` | `8beb1f401137c48be42638f515df21b26732c5573ab6a0af07b890c0237ea14b` |

## macOS Initial Download And Update Archive

Both downloaded DMGs pass `codesign --verify`, `xcrun stapler validate`, and
`spctl --assess --type open --context context:primary-signature --verbose=4`
with **accepted / Notarized Developer ID**. Read-only mounts expose apps that
pass deep/strict codesign, execute assessment and app-ticket validation. Bundled
helpers are signed by the expected Developer ID team with hardened runtime;
app and helper bytes match their corresponding signed updater archives.
The arm64 DMG also passes independent stapler/open assessment inside the
claimed macOS guest before installation.

The two retained CI notary logs report Accepted, status code 0, and no issues;
both tickets explicitly cover the outer DMG, application and native host.
The pipeline staples before final hashing/staging. These results supersede
701's failed outer-DMG assessment without rewriting that historical evidence.

| Architecture | Desktop SHA-256 | Helper SHA-256 |
| --- | --- | --- |
| aarch64 | `91f8714cb110186e3efb512f07bc72d660befad131035b2b22d7f7b8f5f9614e` | `07aa29020f8a4fe8fcd709999f10750a6eeebc846986b93a4c232e63f6cfb1ae` |
| x64 | `a7881c3148418694c8cb7821071f7a7a612bca0b26df6da2d17f109296043e7a` | `dee7e5ffbee6254d56ccd92dadb97338d75e2a5d8e7d608179c90d842ff93bd2` |

Both apps require macOS 13.0. The arm64 helper's Mach-O minimum is 11.0.
Both architectures receive builder-side package/trust inspection; installed
behavior is qualified only on the arm64 guest, not Intel or minimum-version
macOS hardware.

## Routes And Installed Evidence Boundary

After a short publication-to-service cache delay, 20 read-only route probes
pass across darwin/aarch64, darwin/x86_64, windows/x86_64, linux/x86_64 and
linux/aarch64: Latest 701 requests offer immutable 801 signed payload URLs;
current 801 requests return 204; explicit Stable and channel-less 0.0.0
requests still offer 0.1.4. No route, identity, updater key or Stable asset
changes are made.

Public and hosted verification do not establish installed behavior. Tactical
240 separately records native updates, exact-DMG installation, registered
helper trust, controlled libraries, transfer/lifecycle evidence and cleanup.
Native physical sleep/wake, interrupted updates, broader endurance and
production release readiness remain separate gates. No importer is implemented.
