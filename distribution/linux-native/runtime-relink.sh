#!/bin/bash
set -euo pipefail
export LC_ALL=C
test -d /inputs && test -d /work
case "$(uname -m)" in x86_64|aarch64) task_runtime_arch="$(uname -m)" ;; *) exit 2 ;; esac
cd /work
/sbin/apk update
/sbin/apk add --no-cache alpine-sdk util-linux strace file autoconf automake libtool xz bash \
  eudev-dev gettext-dev linux-headers meson clang python3 \
  'clang19=19.1.4-r0' 'musl-dev=1.2.5-r11' \
  'mimalloc2-dev=2.1.7-r0' 'zstd-dev=1.5.6-r2' 'zstd-static=1.5.6-r2' \
  'zlib-dev=1.3.2-r1' 'zlib-static=1.3.2-r1'
mkdir -p /work/out
/sbin/apk info -v > /work/out/alpine-installed-packages.txt
clang --version > /work/out/clang-version.txt
cd /inputs
sha256sum -c SHA256SUMS
cd /work
tar -xf /inputs/fuse-3.15.0.tar.xz
cd /work/fuse-3.15.0
patch -p1 < /inputs/libfuse_mount.c.diff
meson setup --prefix=/usr --default-library=static build
ninja -C build -j4 -v install
cd /work
tar -xf /inputs/squashfuse-0.5.2.tar.gz
cd /work/squashfuse-0.5.2
export CFLAGS='-ffunction-sections -fdata-sections -Os'
./autogen.sh
./configure LDFLAGS='-static'
make -j4
make install
install -m644 ./*.h /usr/local/include/squashfuse/
cd /work
# Original-r0 recipe uses unpatched upstream1.3.2 with these build flags.
# Keep installed-r1 build tools intact; link both prototypes explicitly to r0.
tar -xf /inputs/zlib-1.3.2.tar.gz
cd /work/zlib-1.3.2
CFLAGS='-O2' CHOST="${CHOST:-}" ./configure --prefix=/work/zlib-r0 --shared --disable-crcvx
make -j4
make check
make install
cp README ChangeLog zlib.h /work/out/
sha256sum /inputs/zlib-1.3.2.tar.gz /inputs/zlib-APKBUILD /work/zlib-r0/lib/libz.a > /work/out/zlib-r0-source-inputs.txt
cd /work
tar -xf /inputs/type2-runtime-8f39b89.tar.gz
cd /work/type2-runtime-8f39b89e2ac31e1640b3d3f7e9a5108e6ce805fa
printf '%s\n' 'https://github.com/AppImage/type2-runtime/commit/8f39b89' > src/runtime/version
python3 - <<'EDIT'
from pathlib import Path
p=Path('src/runtime/Makefile');s=p.read_text();assert s.count(' -lz ')==1
p.write_text(s.replace(' -lz ', ' /work/zlib-r0/lib/libz.a '))
EDIT
cp src/runtime/Makefile /work/out/runtime-source-Makefile.txt
bash scripts/build-runtime.sh
cp out/runtime-${task_runtime_arch} out/runtime-${task_runtime_arch}.debug /work/out/
cd src/runtime
# Preserve the application object and exact libraries for a separate relink.
clang -I/usr/local/include/squashfuse -I/usr/include/fuse3 \
  -std=gnu99 -Os -D_FILE_OFFSET_BITS=64 \
  '-DGIT_COMMIT="https://github.com/AppImage/type2-runtime/commit/8f39b89"' \
  -fPIE -ffunction-sections -fdata-sections -Wall -Werror -c runtime.c \
  -o /work/out/runtime.o
cp data_sections.ld /work/out/
for task_runtime_library in /usr/local/lib/libsquashfuse.a /usr/local/lib/libsquashfuse_ll.a \
  /usr/lib/libzstd.a /work/zlib-r0/lib/libz.a /usr/lib/libfuse3.a /usr/lib/libmimalloc.a /usr/lib/libc.a; do
  cp -L "$task_runtime_library" /work/out/
done
cd /work/out
clang -T data_sections.ld -Wl,--gc-sections -static -static-pie runtime.o \
  -L. -lsquashfuse -lsquashfuse_ll -lzstd -lz -lfuse3 -lmimalloc \
  -o runtime-relinked
./runtime-relinked --appimage-version > relinked-version.txt 2>&1
./runtime-relinked --appimage-help > relinked-help.txt 2>&1
./runtime-${task_runtime_arch} --appimage-version > rebuilt-version.txt 2>&1
grep -Fx 'AppImage runtime version: https://github.com/AppImage/type2-runtime/commit/8f39b89' relinked-version.txt
cmp relinked-version.txt rebuilt-version.txt
sha256sum ./* > /work/output-SHA256SUMS
cp /work/output-SHA256SUMS /work/out/
printf '%s\n' 'PASS_SOURCE_BUILD_AND_SEPARATE_RELINK' > /work/out/result.txt
