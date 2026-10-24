#!/usr/bin/env bash
set -euo pipefail

usage() {
    echo "Usage: $0 [--architecture x86_64|aarch64] [--binary-directory ABSOLUTE_PATH]" >&2
    exit 2
}

REQUESTED_ARCH=""
BINARY_DIRECTORY=""
while [ "$#" -gt 0 ]; do
    case "$1" in
        --architecture)
            [ "$#" -ge 2 ] || usage
            REQUESTED_ARCH="$2"
            shift 2
            ;;
        --binary-directory)
            [ "$#" -ge 2 ] || usage
            BINARY_DIRECTORY="$2"
            shift 2
            ;;
        *) usage ;;
    esac
done

if [ "$(uname -s)" != "Linux" ]; then
    echo "Headless packages must be built natively on Linux." >&2
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VERSION="$(sed -n '/^\[package\]/,/^\[/s/^version = "\([^"]*\)"/\1/p' "$REPO_ROOT/crates/rstorrent-headless/Cargo.toml")"
case "$VERSION" in
    ''|*[!0-9A-Za-z.+_-]*|.*|*.) echo "Invalid headless package version: $VERSION" >&2; exit 1 ;;
esac
case "$(uname -m)" in
    x86_64) HOST_ARCH="x86_64" ;;
    aarch64|arm64) HOST_ARCH="aarch64" ;;
    *) echo "Unsupported headless architecture: $(uname -m)" >&2; exit 1 ;;
esac
ARCH="${REQUESTED_ARCH:-$HOST_ARCH}"
case "$ARCH" in
    x86_64|aarch64) ;;
    *) echo "Unsupported headless package architecture: $ARCH" >&2; exit 1 ;;
esac
if [ -n "$BINARY_DIRECTORY" ] && [[ "$BINARY_DIRECTORY" != /* ]]; then
    echo "--binary-directory must be absolute." >&2
    exit 1
fi
if [ "$ARCH" != "$HOST_ARCH" ] && [ -z "$BINARY_DIRECTORY" ]; then
    echo "Cross-architecture packaging requires --binary-directory." >&2
    exit 1
fi

cd "$REPO_ROOT"
VITE_RSTORRENT_DEFAULT_LIVE=same-origin npm run build:hosted --prefix clients/web
if [ -z "$BINARY_DIRECTORY" ]; then
    cargo build --release -p rstorrent-gateway -p rstorrent-headless
    BINARY_DIRECTORY="$REPO_ROOT/target/release"
fi
for binary in rstorrent-headless rstorrent-gateway; do
    path="$BINARY_DIRECTORY/$binary"
    if [ ! -x "$path" ]; then
        echo "Missing executable package binary: $path" >&2
        exit 1
    fi
    machine="$(od -An -tx1 -j18 -N2 "$path" | tr -d ' \n')"
    case "$ARCH:$machine" in
        x86_64:3e00|aarch64:b700) ;;
        *) echo "Package binary $path does not match $ARCH." >&2; exit 1 ;;
    esac
done

STAGING="$(mktemp -d)"
trap 'rm -rf "$STAGING"' EXIT
mkdir -p "$STAGING/bin" "$STAGING/resources" "$STAGING/web" target/headless
install -m 0755 "$BINARY_DIRECTORY/rstorrent-headless" "$STAGING/bin/rstorrent-headless"
install -m 0755 "$BINARY_DIRECTORY/rstorrent-gateway" "$STAGING/bin/rstorrent-gateway"
cp -R clients/web/dist/. "$STAGING/web/"
find "$STAGING/web" -type d -exec chmod 0755 {} +
find "$STAGING/web" -type f -exec chmod 0644 {} +
install -m 0644 crates/rstorrent-headless/resources/com.jstorrent.rstorrent.headless.service.in \
    "$STAGING/resources/com.jstorrent.rstorrent.headless.service.in"
install -m 0644 crates/rstorrent-headless/resources/headless.toml.example \
    "$STAGING/resources/headless.toml.example"
install -m 0755 scripts/headless/install.sh "$STAGING/install.sh"
printf '%s\n' "$VERSION" > "$STAGING/VERSION"
printf '%s\n' 'com.jstorrent.rstorrent.headless' > "$STAGING/PACKAGE_ID"
printf '%s\n' "$ARCH" > "$STAGING/ARCH"
chmod 0644 "$STAGING/VERSION" "$STAGING/PACKAGE_ID" "$STAGING/ARCH"

OUTPUT="$REPO_ROOT/target/headless/rstorrent-headless-${VERSION}-linux-${ARCH}.tar.gz"
tar --sort=name --mtime='UTC 2020-01-01' --owner=0 --group=0 --numeric-owner \
    -czf "$OUTPUT" -C "$STAGING" .
"$REPO_ROOT/scripts/validate-headless-package.sh" "$OUTPUT"
printf '%s\n' "$OUTPUT"
