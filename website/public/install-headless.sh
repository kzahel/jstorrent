#!/usr/bin/env bash
set -euo pipefail

# JSTorrent Headless verified per-user installer.
# Usage: curl -fsSL https://rstorrent.com/install-headless.sh | bash

PINNED_TAG="headless-v0.1.0"
REPOSITORY="kzahel/jstorrent"
# Immutable signed v1 identity is retained across the GitHub rename.
MANIFEST_REPOSITORY="kzahel/rstorrent"
MANIFEST_NAME="rstorrent-headless-release.manifest"
SIGNATURE_NAME="rstorrent-headless-release.manifest.minisig"
INSTALL_PROTOCOL_VERSION="1"
RUNTIME="linux-gnu-headless-package"
MINISIGN_PUBLIC_KEY="RWSWcDYxUXiKeJJ+KkHnWgOjCVOTZ6det0/BsM5QiFH+ohMb464FcQfL"
MAX_METADATA_BYTES=65536
MAX_ASSET_BYTES=134217728
MAX_ARCHIVE_ENTRIES=4096
MAX_EXPANDED_BYTES=268435456

if [ -t 1 ]; then
    GREEN='\033[0;32m' RED='\033[0;31m' BOLD='\033[1m' NC='\033[0m'
else
    GREEN='' RED='' BOLD='' NC=''
fi

info() { printf '%b\n' "${GREEN}==>${NC} ${BOLD}$*${NC}"; }
error() { printf '%b\n' "${RED}error:${NC} $*" >&2; }
hex_bytes() { od -An -tx1 | tr -d ' \n'; }

decode_base64_to() {
    local value="$1" output="$2"
    if ! printf '%s' "$value" | base64 -d > "$output" 2>/dev/null; then
        error "Release metadata contains invalid base64."
        return 1
    fi
}

verify_minisign() {
    local data_file="$1" signature_file="$2" public_key="$3" scratch_dir="$4"
    local public_binary="$scratch_dir/minisign-public.bin"
    local signature_binary="$scratch_dir/minisign-signature.bin"
    local public_der="$scratch_dir/minisign-public.der"
    local signature_raw="$scratch_dir/minisign-signature.raw"
    local signed_message="$scratch_dir/minisign-message.bin"
    if [ "$(awk 'END { print NR }' "$signature_file")" -ne 4 ] ||
       ! sed -n '1p' "$signature_file" | grep -q '^untrusted comment:' ||
       ! sed -n '3p' "$signature_file" | grep -q '^trusted comment:'; then
        error "Release signature has an invalid Minisign shape."
        return 1
    fi
    local signature_line
    signature_line=$(sed -n '2p' "$signature_file")
    decode_base64_to "$public_key" "$public_binary" || return 1
    decode_base64_to "$signature_line" "$signature_binary" || return 1
    if [ "$(wc -c < "$public_binary" | tr -d ' ')" -ne 42 ] ||
       [ "$(wc -c < "$signature_binary" | tr -d ' ')" -ne 74 ]; then
        error "Release key or signature has an invalid encoded size."
        return 1
    fi
    local public_key_id signature_key_id signature_algorithm
    public_key_id=$(dd if="$public_binary" bs=1 skip=2 count=8 status=none | hex_bytes)
    signature_key_id=$(dd if="$signature_binary" bs=1 skip=2 count=8 status=none | hex_bytes)
    signature_algorithm=$(dd if="$signature_binary" bs=1 count=2 status=none | hex_bytes)
    if [ "$public_key_id" != "$signature_key_id" ]; then
        error "Release signature was made by a different key."
        return 1
    fi
    printf '\060\052\060\005\006\003\053\145\160\003\041\000' > "$public_der"
    dd if="$public_binary" bs=1 skip=10 count=32 status=none >> "$public_der"
    dd if="$signature_binary" bs=1 skip=10 count=64 status=none > "$signature_raw"
    case "$signature_algorithm" in
        4544) openssl dgst -blake2b512 -binary "$data_file" > "$signed_message" ;;
        4564) cp "$data_file" "$signed_message" ;;
        *) error "Release signature uses an unsupported algorithm."; return 1 ;;
    esac
    if ! openssl pkeyutl -verify -pubin -keyform DER \
        -inkey "$public_der" -sigfile "$signature_raw" \
        -rawin -in "$signed_message" >/dev/null 2>&1; then
        error "Release signature verification failed."
        return 1
    fi
}

manifest_value() {
    local key="$1" manifest="$2" values
    values=$(sed -n "s/^${key}=//p" "$manifest")
    if [ -z "$values" ] ||
       [ "$(printf '%s\n' "$values" | wc -l | tr -d ' ')" -ne 1 ]; then
        error "Release manifest has invalid ${key}."
        return 1
    fi
    printf '%s' "$values"
}

parse_manifest() {
    local manifest="$1" arch="$2" expected_keys actual_keys
    expected_keys='version
tag
repository
source_commit
install_protocol
runtime
x86_64_asset
x86_64_sha256
x86_64_size
aarch64_asset
aarch64_sha256
aarch64_size
manifest_asset
signature_asset'
    actual_keys=$(sed -n '2,$s/=.*//p' "$manifest")
    if [ "$(sed -n '1p' "$manifest")" != "rstorrent-headless-release-v1" ] ||
       [ "$actual_keys" != "$expected_keys" ]; then
        error "Release manifest has an unsupported shape."
        return 1
    fi
    RELEASE_VERSION=$(manifest_value version "$manifest") || return 1
    RELEASE_TAG=$(manifest_value tag "$manifest") || return 1
    RELEASE_REPOSITORY=$(manifest_value repository "$manifest") || return 1
    local source_commit install_protocol runtime manifest_asset signature_asset
    source_commit=$(manifest_value source_commit "$manifest") || return 1
    install_protocol=$(manifest_value install_protocol "$manifest") || return 1
    runtime=$(manifest_value runtime "$manifest") || return 1
    manifest_asset=$(manifest_value manifest_asset "$manifest") || return 1
    signature_asset=$(manifest_value signature_asset "$manifest") || return 1
    if [[ ! "$RELEASE_VERSION" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] ||
       [ "$RELEASE_TAG" != "headless-v${RELEASE_VERSION}" ] ||
       [ "$RELEASE_REPOSITORY" != "$MANIFEST_REPOSITORY" ] ||
       [[ ! "$source_commit" =~ ^[0-9a-f]{40}$ ]] ||
       [ "$install_protocol" != "$INSTALL_PROTOCOL_VERSION" ] ||
       [ "$runtime" != "$RUNTIME" ] ||
       [ "$manifest_asset" != "$MANIFEST_NAME" ] ||
       [ "$signature_asset" != "$SIGNATURE_NAME" ]; then
        error "Release manifest identity or compatibility validation failed."
        return 1
    fi
    RELEASE_ASSET=$(manifest_value "${arch}_asset" "$manifest") || return 1
    RELEASE_SHA256=$(manifest_value "${arch}_sha256" "$manifest") || return 1
    RELEASE_SIZE=$(manifest_value "${arch}_size" "$manifest") || return 1
    if [ "$RELEASE_ASSET" != "rstorrent-headless-${RELEASE_VERSION}-linux-${arch}.tar.gz" ] ||
       [[ ! "$RELEASE_SHA256" =~ ^[0-9a-f]{64}$ ]] ||
       [[ ! "$RELEASE_SIZE" =~ ^[0-9]+$ ]] ||
       [ "$RELEASE_SIZE" -le 0 ] || [ "$RELEASE_SIZE" -gt "$MAX_ASSET_BYTES" ]; then
        error "Release manifest has invalid ${arch} package metadata."
        return 1
    fi
}

version_is_older() {
    local candidate="$1" current="$2"
    local c1 c2 c3 i1 i2 i3 index
    IFS=. read -r c1 c2 c3 <<< "$candidate"
    IFS=. read -r i1 i2 i3 <<< "$current"
    local candidate_parts=("$c1" "$c2" "$c3") current_parts=("$i1" "$i2" "$i3")
    for index in 0 1 2; do
        if ((10#${candidate_parts[$index]} < 10#${current_parts[$index]})); then return 0; fi
        if ((10#${candidate_parts[$index]} > 10#${current_parts[$index]})); then return 1; fi
    done
    return 1
}

detect_architecture() {
    case "$1" in
        x86_64|amd64) printf '%s' x86_64 ;;
        aarch64|arm64) printf '%s' aarch64 ;;
        *) error "Unsupported architecture: $1"; return 1 ;;
    esac
}

download_release_metadata() {
    local requested_version="$1" temp_dir="$2" tag="$PINNED_TAG"
    if [ -n "$requested_version" ]; then tag="headless-v${requested_version}"; fi
    local base_url="https://github.com/${REPOSITORY}/releases/download/${tag}"
    info "Downloading signed release metadata for ${tag}..."
    curl -fSL --proto '=https' --proto-redir '=https' --max-time 30 \
        --max-filesize "$MAX_METADATA_BYTES" \
        "${base_url}/${MANIFEST_NAME}" -o "$temp_dir/$MANIFEST_NAME"
    curl -fSL --proto '=https' --proto-redir '=https' --max-time 30 \
        --max-filesize "$MAX_METADATA_BYTES" \
        "${base_url}/${SIGNATURE_NAME}" -o "$temp_dir/$SIGNATURE_NAME"
}

download_release_asset() {
    local url="$1" output="$2" maximum_size="$3"
    curl -fSL --proto '=https' --proto-redir '=https' --max-time 180 \
        --max-filesize "$maximum_size" "$url" -o "$output"
}

verify_release_asset() {
    local asset="$1" expected_size="$2" expected_sha256="$3"
    local actual_size actual_sha256
    actual_size=$(wc -c < "$asset" | tr -d ' ')
    actual_sha256=$(sha256sum "$asset" | awk '{ print $1 }')
    if [ "$actual_size" != "$expected_size" ] ||
       [ "$actual_sha256" != "$expected_sha256" ]; then
        error "Downloaded package failed its signed size or SHA-256 check."
        return 1
    fi
}

validate_archive_listing() {
    local archive="$1" list_file="$2"
    local verbose_file="${list_file}.verbose"
    tar -tzf "$archive" > "$list_file" || {
        error "Release package is not a readable gzip-compressed tar archive."; return 1;
    }
    local count=0 entry normalized
    while IFS= read -r entry; do
        count=$((count + 1))
        if [ "$count" -gt "$MAX_ARCHIVE_ENTRIES" ]; then
            error "Release package contains too many entries."; return 1
        fi
        case "$entry" in ''|/*|*\\*) error "Release package contains an unsafe path."; return 1 ;; esac
        normalized="${entry#./}"; normalized="${normalized%/}"
        case "/${normalized}/" in */../*|*/./*) error "Release package contains path traversal."; return 1 ;; esac
    done < "$list_file"
    [ "$count" -gt 0 ] || { error "Release package is empty."; return 1; }
    tar -tvzf "$archive" > "$verbose_file" || return 1
    if awk '{ print substr($1, 1, 1) }' "$verbose_file" | grep -Ev '^[-d]$' >/dev/null; then
        error "Release package contains a link or special file."; return 1
    fi
    if ! awk -v maximum="$MAX_EXPANDED_BYTES" '
        $3 !~ /^[0-9]+$/ { exit 1 }
        { total += $3; if (total > maximum) exit 1 }
    ' "$verbose_file"; then
        error "Release package exceeds its expanded byte limit."; return 1
    fi
}

validate_extracted_bundle_shape() {
    local bundle="$1" version="$2" architecture="$3" expected actual
    expected='ARCH
PACKAGE_ID
VERSION
bin
install.sh
resources
web'
    actual=$(find "$bundle" -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort)
    if [ "$actual" != "$expected" ] ||
       [ "$(find "$bundle" -type l -print -quit)" != "" ] ||
       [ "$(sed -n '1p' "$bundle/VERSION")" != "$version" ] ||
       [ "$(sed -n '1p' "$bundle/ARCH")" != "$architecture" ] ||
       [ "$(sed -n '1p' "$bundle/PACKAGE_ID")" != "com.jstorrent.rstorrent.headless" ] ||
       [ ! -x "$bundle/install.sh" ] ||
       [ ! -x "$bundle/bin/rstorrent-headless" ] ||
       [ ! -x "$bundle/bin/rstorrent-gateway" ] ||
       [ ! -f "$bundle/web/index.html" ]; then
        error "Release package has an invalid bundle shape."; return 1
    fi
}

validate_extracted_bundle() {
    local bundle="$1" version="$2" architecture="$3"
    validate_extracted_bundle_shape "$bundle" "$version" "$architecture" || return 1
    if [ "$("$bundle/bin/rstorrent-headless" --version)" != "rstorrent-headless ${version}" ]; then
        error "Release package version does not match its signed manifest."; return 1
    fi
    "$bundle/bin/rstorrent-headless" validate-package --bundle "$bundle" >/dev/null
}

installer_main() (
    local requested_version=""
    while [ "$#" -gt 0 ]; do
        case "$1" in
            --version) [ "$#" -ge 2 ] || { error "--version requires a value"; return 1; }; requested_version="${2#v}"; shift 2 ;;
            --help|-h) printf '%s\n' "Usage: install-headless.sh [--version X.Y.Z]"; return 0 ;;
            *) error "Unknown option: $1"; return 1 ;;
        esac
    done
    if [ -n "$requested_version" ] &&
       [[ ! "$requested_version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]; then
        error "Version must use numeric semantic versioning, such as 0.1.0."; return 1
    fi
    [ "$(uname -s)" = "Linux" ] || { error "This installer is for Linux."; return 1; }
    ARCH=$(detect_architecture "$(uname -m)") || return 1
    local command_name
    for command_name in awk base64 cp curl dd find grep mkdir mktemp od openssl rm sed sha256sum sort tar tr wc; do
        command -v "$command_name" >/dev/null 2>&1 || {
            error "$command_name is required by the verified installer."; return 1;
        }
    done
    local temp_dir
    temp_dir=$(mktemp -d) || return 1
    INSTALLER_TEMP_DIR="$temp_dir"
    trap 'rm -rf -- "$INSTALLER_TEMP_DIR"' EXIT
    download_release_metadata "$requested_version" "$temp_dir" || return 1
    local manifest="$temp_dir/$MANIFEST_NAME" signature="$temp_dir/$SIGNATURE_NAME"
    verify_minisign "$manifest" "$signature" "$MINISIGN_PUBLIC_KEY" "$temp_dir" || return 1
    parse_manifest "$manifest" "$ARCH" || return 1
    if [ -n "$requested_version" ] && [ "$RELEASE_VERSION" != "$requested_version" ]; then
        error "Requested ${requested_version}, but the signed manifest is ${RELEASE_VERSION}."; return 1
    fi
    info "Verified signed JSTorrent Headless ${RELEASE_VERSION} manifest."
    local installed_binary="${HOME}/.local/bin/rstorrent-headless"
    if [ -x "$installed_binary" ]; then
        local installed_output installed_version
        installed_output=$("$installed_binary" --version) || {
            error "The installed headless command failed its version self-test."; return 1;
        }
        if [[ ! "$installed_output" =~ ^rstorrent-headless\ ((0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*))$ ]]; then
            error "The installed headless command reported an invalid version."; return 1
        fi
        installed_version="${BASH_REMATCH[1]}"
        if version_is_older "$RELEASE_VERSION" "$installed_version"; then
            error "Refusing to replace ${installed_version} with older signed release ${RELEASE_VERSION}."; return 1
        fi
    fi
    local asset="$temp_dir/$RELEASE_ASSET"
    local asset_url="https://github.com/${REPOSITORY}/releases/download/${RELEASE_TAG}/${RELEASE_ASSET}"
    info "Downloading ${RELEASE_ASSET}..."
    download_release_asset "$asset_url" "$asset" "$RELEASE_SIZE" || return 1
    verify_release_asset "$asset" "$RELEASE_SIZE" "$RELEASE_SHA256" || return 1
    info "Verified ${RELEASE_ASSET}."
    local bundle="$temp_dir/bundle"
    validate_archive_listing "$asset" "$temp_dir/archive.list" || return 1
    mkdir "$bundle"
    tar -xzf "$asset" -C "$bundle"
    validate_extracted_bundle "$bundle" "$RELEASE_VERSION" "$ARCH" || return 1
    "$bundle/install.sh" || return 1
    if [ "$("$installed_binary" --version)" != "rstorrent-headless ${RELEASE_VERSION}" ]; then
        error "Installed JSTorrent Headless version does not match the signed release."; return 1
    fi
    printf '\n'
    info "JSTorrent Headless ${RELEASE_VERSION} is installed."
    printf '%s\n' "Follow the printed configuration and systemd user-service steps."
    printf '%s\n' "Updates always require: rstorrent-headless update --apply"
)

if [ "${RSTORRENT_HEADLESS_INSTALLER_LIB_ONLY:-}" = "1" ]; then
    return 0 2>/dev/null || exit 0
fi

installer_main "$@"
