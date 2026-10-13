#!/usr/bin/env bash
set -euo pipefail

build_mode="${1:-debug}"
if [[ "$build_mode" != debug && "$build_mode" != release ]]; then
    echo "Usage: $0 [debug|release]" >&2; exit 1
fi
if [[ "$build_mode" == release ]]; then
    for name in UPLOAD_KEYSTORE_PATH UPLOAD_KEYSTORE_PASSWORD UPLOAD_KEY_ALIAS UPLOAD_KEY_PASSWORD; do
        if [[ -z "${!name:-}" ]]; then echo "Missing signing variable: $name" >&2; exit 1; fi
    done
fi

android_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd "$android_root/../.." && pwd)"
source "$repository_root/scripts/dev-env.sh"
android_sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}}"
ndk_root="$android_sdk/ndk/28.2.13676358"
generated_root="$android_root/app/build/generated"

if [[ ! -d "$android_sdk/platforms/android-36" ]]; then
    echo "Android platform 36 is unavailable under $android_sdk" >&2
    exit 1
fi
if [[ ! -d "$ndk_root" ]]; then
    echo "Android NDK 28.2.13676358 is unavailable under $android_sdk" >&2
    exit 1
fi
if [[ -z "${JDK17_HOME:-}" ]]; then
    echo "JDK 17 is unavailable; install it (brew install openjdk@17) or set JDK17_HOME" >&2
    exit 1
fi
for rust_target in x86_64-linux-android aarch64-linux-android; do
    if ! rustup target list --installed | grep -qx "$rust_target"; then
        echo "Install the Rust target with: rustup target add $rust_target" >&2
        exit 1
    fi
done

if [[ "$(cargo-about --version 2>/dev/null || true)" != "cargo-about 0.9.2" ]]; then
    echo "Install the notice generator: cargo install cargo-about --locked --version 0.9.2 --features cli" >&2
    exit 1
fi

export ANDROID_HOME="$android_sdk"
export ANDROID_NDK_HOME="$ndk_root"

"$android_root/gradlew" -p "$android_root" clean

cd "$repository_root"

cargo ndk \
    -t x86_64 \
    -t arm64-v8a \
    -P 28 \
    -o "$generated_root/jniLibs" \
    build --locked --release -p rstorrent-android --lib

cargo build --locked -p rstorrent-android --lib
case "$(uname -s)" in
    Darwin)
        bindgen_library="$repository_root/target/debug/librstorrent_android.dylib"
        ;;
    Linux)
        bindgen_library="$repository_root/target/debug/librstorrent_android.so"
        ;;
    *)
        echo "Unsupported UniFFI bindgen host: $(uname -s)" >&2
        exit 1
        ;;
esac
if [[ ! -f "$bindgen_library" ]]; then
    echo "UniFFI bindgen library is unavailable at $bindgen_library" >&2
    exit 1
fi
cargo run --locked \
    -p rstorrent-android \
    --features bindgen \
    --bin rstorrent-uniffi-bindgen \
    -- generate \
    --library "$bindgen_library" \
    --crate rstorrent_android \
    --config "$repository_root/crates/rstorrent-android/uniffi.toml" \
    --language kotlin \
    --out-dir "$generated_root/source/uniffi" \
    --no-format
cargo run --locked \
    -p rstorrent-android \
    --features bindgen \
    --bin rstorrent-uniffi-bindgen \
    -- generate \
    --library "$bindgen_library" \
    --crate rstorrent_session \
    --config "$repository_root/crates/rstorrent-session/uniffi.toml" \
    --language kotlin \
    --out-dir "$generated_root/source/uniffi" \
    --no-format

if [[ "$build_mode" == release ]]; then
    "$android_root/gradlew" -p "$android_root" assembleRelease bundleRelease testReleaseUnitTest lintRelease
else
    "$android_root/gradlew" -p "$android_root" assembleDebug testDebugUnitTest
fi

apk="$android_root/app/build/outputs/apk/$build_mode/app-$build_mode.apk"
if [[ ! -f "$apk" ]]; then
    echo "Android APK was not created at $apk" >&2
    exit 1
fi
python3 "$repository_root/scripts/inspect-android-notices.py" --archive "$apk" --variant "$build_mode"
echo "$apk"
if [[ "$build_mode" == release ]]; then
    bundle="$android_root/app/build/outputs/bundle/release/app-release.aab"
    test -f "$bundle"
    echo "$bundle"
fi
