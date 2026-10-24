#!/usr/bin/env bash
set -euo pipefail

if [ "$(uname -s)" != "Linux" ]; then
    echo "ChromeOS Linux packages must be built on Linux." >&2
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VERSION="$(sed -n '/^\[package\]/,/^\[/s/^version = "\([^"]*\)"/\1/p' "$REPO_ROOT/crates/rstorrent-crostini/Cargo.toml")"
case "$VERSION" in
    ''|*[!0-9.]*|.*|*.) echo "Invalid Crostini package version: $VERSION" >&2; exit 1 ;;
esac
case "$(uname -m)" in
    x86_64) ARCH="x86_64" ;;
    aarch64|arm64) ARCH="aarch64" ;;
    *) echo "Unsupported Crostini architecture: $(uname -m)" >&2; exit 1 ;;
esac

cd "$REPO_ROOT"
VITE_RSTORRENT_DEFAULT_LIVE=same-origin npm run build:hosted --prefix clients/web
cargo build --release -p rstorrent-gateway -p rstorrent-crostini

STAGING="$(mktemp -d)"
trap 'rm -rf "$STAGING"' EXIT
mkdir -p "$STAGING/bin" "$STAGING/web" "$STAGING/icons" target/crostini
install -m 0755 target/release/rstorrent-crostini "$STAGING/bin/rstorrent-crostini"
install -m 0755 target/release/rstorrent-gateway "$STAGING/bin/rstorrent-gateway"
cp -R clients/web/dist/. "$STAGING/web/"
install -m 0644 clients/extension/icons/icon-128.png "$STAGING/icons/rstorrent-128.png"
install -m 0755 scripts/crostini/install.sh "$STAGING/install.sh"
printf '%s\n' "$VERSION" > "$STAGING/VERSION"

OUTPUT="$REPO_ROOT/target/crostini/rstorrent-crostini-${VERSION}-${ARCH}.tar.gz"
tar --sort=name --mtime='UTC 2020-01-01' --owner=0 --group=0 --numeric-owner \
    -czf "$OUTPUT" -C "$STAGING" .
"$REPO_ROOT/scripts/validate-crostini-package.sh" "$OUTPUT"
printf '%s\n' "$OUTPUT"
