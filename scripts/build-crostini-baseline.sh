#!/usr/bin/env bash
# Host-side release-baseline build; physical Chromebooks receive packages only.
set -euo pipefail
repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
case "$(uname -m)" in
  x86_64) ;;
  *) echo 'This local baseline lane requires native x86_64; retain the native ARM64 release lane.' >&2; exit 1 ;;
esac
build_root="$repository_root/target/crostini-baseline"
mkdir -p "$build_root"
exec 9>"$build_root/build.lock"
flock -n 9 || { echo 'Another baseline build owns this output directory.' >&2; exit 1; }
docker_config="$(mktemp -d)"
trap 'rm -rf "$docker_config"' EXIT
# Public base images need no account or machine-specific credential helper.
docker --config "$docker_config" build --file "$repository_root/scripts/crostini/baseline.Dockerfile" \
  --tag rstorrent-crostini-baseline:ubuntu22-rust1.97 "$repository_root/scripts/crostini"
docker --config "$docker_config" run --rm --init --user "$(id -u):$(id -g)" \
  --env CARGO_HOME=/build/cargo --env CARGO_TARGET_DIR=/build/rust \
  --env HOME=/build/home \
  --mount "type=bind,source=$repository_root,target=/source,readonly" \
  --mount "type=bind,source=$build_root,target=/build" \
  rstorrent-crostini-baseline:ubuntu22-rust1.97 bash -euo pipefail -c '
    rm -rf /build/source
    mkdir -p /build/home /build/source
    tar -C /source --exclude=./.git --exclude=./target --exclude=node_modules \
      --exclude=./clients/web/dist --exclude=./clients/web/test-results \
      --exclude=./clients/android/app/build --exclude=./clients/android/.gradle \
      -cf - . | tar -C /build/source -xf -
    cd /build/source
    test -L target || ln -s /build/rust target
    npm ci --prefix clients/web
    scripts/build-crostini-package.sh
    version=$(sed -n '\''/^\[package\]/,/^\[/s/^version = "\([^"]*\)"/\1/p'\'' crates/rstorrent-crostini/Cargo.toml)
    asset="target/crostini/rstorrent-crostini-${version}-x86_64.tar.gz"
    mkdir -p /build/packages
    cp "$asset" /build/packages/
    scratch=$(mktemp -d)
    trap '\''rm -rf "$scratch"'\'' EXIT
    tar -xzf "$asset" -C "$scratch"
    for binary in "$scratch"/bin/*; do
      readelf --version-info "$binary" | sed -n '\''s/.*Name: \(GLIBC_[0-9.]*\).*/\1/p'\'' | sort -Vu
      ldd "$binary"
      "$binary" --version
    done
  '
printf '%s\n' "$build_root/packages/"
