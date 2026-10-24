#!/usr/bin/env bash
set -euo pipefail

script_root=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
client_root=$(cd "${script_root}/.." && pwd)
repository_root=$(cd "${client_root}/../.." && pwd)

source "${repository_root}/scripts/dev-env.sh"

case "${PLATFORM_NAME:-${1:-}}" in
  iphoneos)
    rust_target=aarch64-apple-ios
    ;;
  iphonesimulator)
    rust_target=aarch64-apple-ios-sim
    ;;
  *)
    echo "unsupported Apple platform ${PLATFORM_NAME:-${1:-missing}}" >&2
    exit 1
    ;;
esac

CARGO_TARGET_DIR="${repository_root}/target" \
  cargo build \
    --manifest-path "${repository_root}/Cargo.toml" \
    --package rstorrent-ios \
    --release \
    --target "${rust_target}"
