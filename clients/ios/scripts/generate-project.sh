#!/usr/bin/env bash
set -euo pipefail

script_root=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
client_root=$(cd "${script_root}/.." && pwd)
repository_root=$(cd "${client_root}/../.." && pwd)
generated_root="${client_root}/Generated"

source "${repository_root}/scripts/dev-env.sh"
mkdir -p "${generated_root}"
rm -f \
  "${generated_root}/RSTorrentIOS.swift" \
  "${generated_root}/RSTorrentIOSFFI.h" \
  "${generated_root}/RSTorrentIOSFFI.modulemap" \
  "${generated_root}/RSTorrentSession.swift" \
  "${generated_root}/RSTorrentSessionFFI.h" \
  "${generated_root}/RSTorrentSessionFFI.modulemap"

cargo build \
  --manifest-path "${repository_root}/Cargo.toml" \
  --package rstorrent-ios \
  --release
cargo run \
  --manifest-path "${repository_root}/Cargo.toml" \
  --package rstorrent-ios \
  --features bindgen \
  --bin rstorrent-ios-uniffi-bindgen \
  -- generate \
  --library "${repository_root}/target/release/librstorrent_ios.a" \
  --crate rstorrent_ios \
  --config "${repository_root}/crates/rstorrent-ios/uniffi.toml" \
  --language swift \
  --out-dir "${generated_root}" \
  --no-format
cargo run \
  --manifest-path "${repository_root}/Cargo.toml" \
  --package rstorrent-ios \
  --features bindgen \
  --bin rstorrent-ios-uniffi-bindgen \
  -- generate \
  --library "${repository_root}/target/release/librstorrent_ios.a" \
  --crate rstorrent_session \
  --config "${repository_root}/crates/rstorrent-session/uniffi.toml" \
  --language swift \
  --out-dir "${generated_root}" \
  --no-format

# UniFFI 0.31 emits external Swift types for their own module but does not add
# that module import to the dependent binding file.
sed -i '' '/^import Foundation$/a\
import RSTorrentSession
' "${generated_root}/RSTorrentIOS.swift"

xcodegen generate --spec "${client_root}/project.yml" --project "${client_root}"
