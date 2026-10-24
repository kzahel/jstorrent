# JSTorrent AppImage sources and rebuilding

The enclosed `candidate.json` and `source-index.json` identify the exact signed
desktop version and source commit matched by this carrier. `source-index.json` binds both
AppImages by size and SHA-256 and maps every selected Ubuntu binary package to
its exact source version, notice and bundled components. First-party source
remains MIT. Original third-party source files retain their own terms; supplying
them does not relicense the application or assert binary reproducibility.

Extract this archive into a new directory and run `sha256sum -c SHA256SUMS`.
Do not build in an existing product installation or use its payload/profile.
These instructions use ordinary development tools and no production signing key.

## Application and native libraries

Use Ubuntu 24.04 on the target architecture, x86_64 or aarch64. Install the
prerequisites from the enclosed source's `DEVELOPMENT.md` and desktop workflow.
Rust and Node toolchains are development prerequisites rather than bundled
product libraries. Extract the exact source and enable the supplied vendor tree:

```bash
mkdir application
tar -xf application.tar -C application
mkdir -p application/.cargo
cp cargo-vendor-config.toml application/.cargo/config.toml
cd application
cargo metadata --locked --offline --filter-platform x86_64-unknown-linux-gnu
```

Use `aarch64-unknown-linux-gnu` for ARM. The relative Cargo configuration expects
`cargo-vendor/` beside `application/`. The vendor tree supplies every locked Cargo
registry input, including unused-platform and build/test inputs. The exact npm
production distributions and preferred upstream sources are in
`web-distribution/` and `web-preferred/`; the full web lockfile remains in the
application snapshot. Use `npm ci --prefix clients/web` to install its declared
build tools before running the web build. A sealed offline npm build environment
is not claimed.

For ordinary native libraries, `ubuntu/PACKAGE_VERSION/` contains the original
`.dsc`, upstream archive and Debian changes. The descriptor declares the source
file checksums and build dependencies. For example, from the carrier root:

```bash
dpkg-source -x ubuntu/glib-networking_2.80.0-1build1/glib-networking_2.80.0-1build1.dsc glib-networking-source
cd glib-networking-source
dpkg-checkbuilddeps
dpkg-buildpackage -b -us -uc
```

Install the descriptor's declared build dependencies in the owned environment
first. Preserve its patches, copyrights and license texts. All selected package
sources are supplied; all individual upstream builds have not been executed.
An original OpenPGP signature is retained without claiming its independent
authentication. Libraries stripped or relocated during packaging retain the
manifest's original/bundled hashes and build IDs; these changes are not source
patches.

TIFF and the GTK3 appindicator are custom builds. Their exact archives,
copyrights, patch, recipe, compiler and flags are supplied separately under
`native/x64/custom-source/` and `native/arm64/custom-source/`. Use the recipe in
the application snapshot, which applies the retained Ubuntu patches and our
appindicator patch. From `application/`, with carrier and build paths adjusted:

```bash
python3 scripts/build-linux-native.py \
  --sources-dir ../native/x64/custom-source --output ../modified-native
export JSTORRENT_LINUX_NATIVE_BUILD="$(realpath ../modified-native)"
node scripts/build-jstorrent-desktop.mjs --unsigned --bundles appimage
```

The output must not exist. Use `native/arm64/custom-source` on ARM. The recipe
never installs its output into `/usr`. TIFF disables JBIG; appindicator disables
desktop-file shortcuts, retaining ordinary menu/icon/status behavior. Original
security patches and all modification sources are included. The application
also contains its original GLib Rust-boundary patch. A local rebuild can change
the libraries or application and rebuild an unsigned AppImage without official
keys. It cannot acquire an original updater signature or masquerade as the
official update. For manual library replacement, extract an AppImage with
`--appimage-extract`, replace the relevant SONAME libraries under its AppDir and
run the AppDir's `AppRun`; preserve the notices and use an owned test profile.

## Outer runtime and separate relinking

The bundled MIT AppRun launcher source is also included as
`apprun/AppImageKit-5735cc5.tar.gz`, retaining its original license and CMake
build files. Its exact revision is
`5735cc5bed206497cddfbd2a75e1982c2606c35d`; no newer launcher source is substituted.

`runtime/sources/`, `runtime/recipes/` and `runtime/notices/` supply the selected
type2-runtime, libfuse, squashfuse, zstd, zlib, mimalloc and musl inputs and their
original Alpine recipes/patches. The runtime source revision is
`8f39b89e2ac31e1640b3d3f7e9a5108e6ce805fa`. Each official outer runtime is bound
independently in `source-index.json`, excluding only its 16-byte payload digest.

Run `runtime/relink.sh` only inside a new owned Alpine 3.21 development chroot
on the target architecture. It writes to `/work`, installs development tools in
that chroot and expects `/inputs` populated with:

- `fuse-3.15.0.tar.xz`, `squashfuse-0.5.2.tar.gz`,
  `type2-runtime-8f39b89.tar.gz`, and `zlib-1.3.2.tar.gz` from `runtime/sources/`;
- `libfuse_mount.c.diff` from `runtime/recipes/libfuse/` and `zlib-APKBUILD`
  copied from `runtime/recipes/zlib/APKBUILD`;
- a `SHA256SUMS` inventory of those input files, checked against this carrier's
  root inventory before copying.

The script builds original unpatched zlib 1.3.2 using the retained r0 recipe
flags and links its static archive explicitly. Installed r1 development packages
remain build tools. It exports the application object, linker script and seven
static archives, then performs a separate relink and executes version/help.
No original private key is required. The x64 prototype has executed; ARM
execution is a separate recorded gate. The rebuilt bytes differ from the
official runtime, so no reproducibility or signed-equivalence claim is made.

## Distribution

Preserve this carrier and original notices with the matching release. Provide
equivalent access to it beside both AppImages and link it next to Linux downloads.
A source locator alone is insufficient. Verify the actual public download and
its checksum after publication. Package-level license labels in the index
describe upstream source-file terms; they do not classify every compiled file
by all unrelated tools/tests in the same source repository.
