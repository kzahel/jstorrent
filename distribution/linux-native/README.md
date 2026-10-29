# Linux AppImage native library builds

First-party JSTorrent remains MIT. This recipe removes two reviewed GPL-only
runtime library chains from Linux AppImages while retaining the GTK3 tray and
WebKit UI. This is bounded packaging work, not a new Linux compatibility promise
or comprehensive license/security clearance. Linux remains best effort.

`sources.json` binds the exact Ubuntu descriptors, upstream archives and Debian
changes by size and SHA-256. Verify all files before extraction. `dpkg-source`
applies the original Debian patches, including TIFF's sixteen fixes through
CVE-2025-61144. Descriptor signatures are retained; independent OpenPGP
authentication is not claimed. Review security updates before changing pins.

The small, independently authored appindicator patch adds an upstream-default
enabled desktop-shortcut option. Our GTK3 build disables it, excluding the
libayatana-indicator header and dependency. The ordinary menu, icon, status and
fallback behavior are unchanged. The exported `app_indicator_build_menu_from_desktop`
remains callable, logs a warning and leaves the ordinary menu intact. JSTorrent's
tray uses `app_indicator_set_menu`; it does not use desktop-file shortcuts.
The patch retains the original library's LGPL2.1/LGPL3 alternatives and all
original copyrights. Source tools/tests may contain GPL code; they are not
bundled executable runtime components.

TIFF's supported `-Djbig=OFF` option removes JBIG. Other reviewed codecs and
symbol versioning remain enabled. JBIG-compressed TIFF images are unsupported;
this does not affect torrent data transfer.

Build in a fresh Ubuntu24.04 x64 or ARM64 environment with:

```bash
sudo apt-get install build-essential cmake pkg-config dpkg-dev patch \
  libgtk-3-dev libdbusmenu-gtk3-dev libgirepository1.0-dev libjpeg-dev \
  liblzma-dev libzstd-dev libwebp-dev zlib1g-dev libdeflate-dev liblerc-dev
python3 scripts/build-linux-native.py --sources-dir /owned/sources \
  --output /owned/native-build --download
```

The output root must not exist. The script never installs into `/usr`; it emits
`prefix/lib/`, `source-materials/` and `provenance.json`. Sources may instead be
provided offline by omitting `--download`. Preserve all materials and notices.
The compiler, flags, patch series, recipe/input/output hashes and architecture
are recorded. Source archives and the custom build recipe travel inside the
AppImage's native notice bundle. Remaining third-party libraries retain their
own licenses and corresponding-source obligations.

Set `JSTORRENT_LINUX_NATIVE_BUILD` to this output root for Tauri packaging.
The output hook replaces both regular SONAME copies before native attribution,
checks that no other consumer still needs the two GPL-only library families,
then removes their unused copies. Unknown consumers, recipe/input drift,
wrong-architecture builds or missing provenance fail packaging before signing.
Custom binaries are attributed as source builds, not unchanged distro files.
`inspect-distribution.py --require-native-notices --require-mit-native` repeats
the source/material and known dependency checks after extraction.

`verify-linux-native.py` compares all exported symbols against retained original
libraries, resolves relocations, checks TIFF codecs and loads the original
GdkPixbuf TIFF module. TIFF's upstream CTest suite runs during building.
`tray-probe.c` independently checks ordinary GTK menu callbacks and indicator
state under an owned `dbus-run-session -- xvfb-run` test session. It is test
source only; its executable is never part of the AppImage.

Original signed packages remain unchanged historical evidence. A rebuilt
AppImage requires a new signed candidate and package/runtime qualification.

## Current release source carriers

`package-current-appimage-sources.py` binds the selected commit and ordinary
version overlay to both exact collected AppImages. It vendors current locked
Cargo sources and verifies empty-Cargo-home offline metadata for both targets.
It retains the independently hash-verified prior public carrier for unchanged
native source/version pairs, original runtime inputs and preferred web sources.
Changed native pairs or outer runtimes block publication pending review.

`distribution/appimage-source-inputs.json` records additional exact web
source inputs. The current additions are uqr 0.1.3 (unjs/uqr's v0.1.3 commit)
and @vitejs/plugin-react 6.1.2 (its npm gitHead). Both upstream distributions
and preferred archives declare MIT and retain their original LICENSE files;
reuse supplies complete source/attribution without importing their code into
first-party source. Distribution bytes must match package-lock SHA-512, and
preferred archives must match their recorded immutable Git commit and SHA-256.
The archive keeps original component terms and source/relink instructions.
It does not promise a sealed offline web build or binary reproducibility.

The October 22 carrier also supplies Vitest 4.1.12 and its seven changed
packages, Vite 8.1.6, Chai 6.3.0 and tinyrainbow 3.2.0. Official npm metadata
matches the locked distribution integrity and MIT license. Preferred sources
use the Vitest/Vite version tags resolved to immutable commits and Chai's and
tinyrainbow's npm `gitHead` commits. All four archives retain their MIT license
files. Chai and tinyrainbow stamp distribution versions during publication;
their repository package versions differ. These inputs are retained for
source/attribution, without importing their code into first-party source.

`additionalRuntimes` binds each October 22 outer runtime to the official
AppImage binary digest and source commit
`fedfad51acc2860b2916a1eef32ba4a500ff31ef`. Its sole change from the retained
`8f39b89` source adds temporary-path mapping to dependency build flags; runtime
code, dependency versions and original terms are unchanged. The new MIT runtime
archive retains its recipes and notices; the prior carrier retains all original
component sources and separate relink instructions. Only the named 16-byte
payload digest is excluded from the binary comparison. Unreviewed runtime
changes still stop publication.

The same carrier supplies exact Ubuntu source descriptors and every referenced
archive for GLib `2.80.0-6ubuntu3.10` and xz-utils
`5.6.1+really5.4.5-1ubuntu0.4`, in addition to the existing libxml2 pin. The
packaged notices bind these source pairs to the actual binaries. Primary HTTPS,
descriptor identity, byte counts and descriptor SHA-256 inventories are checked;
the original OpenPGP signatures are retained without claiming independent key
verification. Original component terms and Ubuntu patches accompany the sources.

The October 29 carrier additionally supplies Ubuntu Brotli
`1.1.0-2ubuntu0.1` and systemd `255.4-1ubuntu8.18`. These are the only new
source/version pairs found across both exact 0.3.6 AppImages after subtracting
the prior carrier and already reviewed additions. Exact signed descriptors,
every descriptor-referenced archive, sizes and SHA-256 inventories are checked
over primary `security.ubuntu.com` HTTPS. OpenPGP signatures are preserved;
independent key verification is not claimed. Brotli's original MIT license and
Debian copyright/patch series are retained, including Ubuntu's
[CVE-2026-111497 fix](https://ubuntu.com/security/notices/USN-8956-1).
Systemd's original LGPL-2.1+ library terms, other component-specific terms,
Debian copyright and complete Ubuntu patch series remain intact. Supplying
these unchanged upstream sources permits the existing source/relink workflow;
it imports no third-party code into first-party application code. It does not
change or re-sign any already collected native executable.
