# AppImage source delivery

Status: final local carrier independently verified, 2026-10-10. Public download
and adjacent website links remain a shipment gate.
Owner: [beta-release-readiness](topics/beta-release-readiness.md).
Execution: [Tactical293](tactical/293-appimage-source-delivery.md).
Linux remains best effort; iOS is excluded. First-party source remains MIT;
third-party sources retain their original terms.

## Final signed binding

The carrier matches desktop source
`ff632f4588a474d7b169de3cea228bd406e6982d`, version0.3.0, signed candidate
run38050770001. It replaces the historical2b83 source packets for shipment.
Those earlier receipts remain historical and are not new-package qualification.

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| `JSTorrent_0.3.0_amd64.AppImage` | 101231096 | `88abbeac098954313493dcdc33e2741754d16a534e273309ac51f435b9bd19e4` |
| `JSTorrent_0.3.0_aarch64.AppImage` | 99404296 | `c90800c587da5eb4d8881f2e912fb6726fa83e1371d75b53d9848e474a1242e7` |
| `JSTorrent_0.3.0_AppImage-sources-final.tar.gz` | 847197977 | `124233d3f2aad395fa2bff07be4d2ae03aafdedaef2f6ab181574251583c1e5e` |

The portable source archive includes38,866 independently checksum-verified
regular members: exact application source,733 locked Cargo inputs,27 npm
archives,14 preferred upstream archives,85 exact Ubuntu source/version pairs
covering217 binary-package/architecture rows, original notices, both custom
native rebuild inputs, original AppRun and outer-runtime sources/recipes/patches,
and an architecture-aware separate relink script. `source-index.json` binds
172 x64/171 ARM selected native components and original outer-runtime bytes.
Source-file license labels do not classify every compiled file by unrelated
build tools or tests in the same upstream repository.

The custom TIFF/appindicator source recipes preserve original security patches,
copyrights and provenance. Exact signed extracted checks confirm that the
reviewed GPL-only runtime chains are absent. Remaining library source, notice
and modification materials retain their own requirements; this is not a blanket
legal or reproducibility clearance.

## Extraction and rebuilding

Extract into a new owned directory and run `sha256sum --check SHA256SUMS`.
Follow the archive's `README.md`, also maintained as
[the rebuild guide](../distribution/linux-native/source-rebuild.md).
It describes exact-source application rebuilding, relative Cargo vendoring,
original Ubuntu descriptors, custom native-library changes, manual AppDir
replacement, AppRun and original-r0 outer-runtime rebuilding/relinking. It uses
ordinary development tools and no original signing keys.

Independent empty-Cargo-home locked offline metadata passes for both targets:
586 x64 and584 ARM resolved packages. This does not claim a complete offline
compilation or sealed npm build environment. Original descriptor signatures are
retained without asserting independent OpenPGP authentication. Every selected
package source is supplied; all85 upstream package builds have not been run.

Original unpatched-zlib-r0 runtime source builds and separate object/seven-archive
relinks execute successfully on both x64 and ARM. Version/help and exported
hashes pass; ARM exports independently verify AArch64 ELF. Rebuilt bytes differ
from official bytes, so no reproducibility or signed-equivalence claim is made.
The carrier guide predates the ARM execution receipt; Tactical293 records it.
Neither relink execution qualifies mounted FUSE or the ARM product window.

## Shipment

Publish this exact versioned source archive beside the matching AppImages,
retain original notices and link it adjacent to both Linux downloads. Verify
actual public bytes and SHA-256, not just the locator or upload status. If any
AppImage is rebuilt, rebind the carrier to the new exact binaries first.
`scripts/package-appimage-sources.py` performs offline guarded preparation; it
refuses mismatched source/version, dependency locks, source hashes or assets.
Its four adversarial tests cover integrity, membership, duplicates and unsafe
paths. It neither fetches, signs nor publishes.
