#!/bin/bash
set -euo pipefail

# JSTorrent Desktop App installer for Linux
# Usage: curl -fsSL https://jstorrent.com/install.sh | bash
#
# Installs the Tauri desktop app and registers the native messaging host
# for Chrome/Chromium browsers so the JSTorrent extension can communicate
# with the native host.
#
# Supports: x86_64 and aarch64
# Default: AppImage (supports auto-update, no root required)
# Options: --deb (Debian/Ubuntu, requires sudo, no auto-update)
#          --rpm (Fedora/RHEL, requires sudo, no auto-update)

FALLBACK_TAG="v0.2.1"
MANIFEST_NAME="com.jstorrent.native"
CHECKSUMS_NAME="SHA256SUMS"
CHECKSUMS_FALLBACK_BASE_URL="${JSTORRENT_CHECKSUMS_FALLBACK_BASE_URL:-https://jstorrent.com/checksums}"

# Colors (disabled if not a terminal)
if [ -t 1 ]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    BOLD='\033[1m'
    NC='\033[0m'
else
    RED='' GREEN='' YELLOW='' BOLD='' NC=''
fi

info()  { echo -e "${GREEN}==>${NC} ${BOLD}$*${NC}"; }
warn()  { echo -e "${YELLOW}warning:${NC} $*"; }
error() { echo -e "${RED}error:${NC} $*" >&2; }

download_verified_asset() {
    local asset_name="$1"
    local destination="$2"
    local checksums_file="${TMP_DIR}/${CHECKSUMS_NAME}"

    if ! command -v sha256sum >/dev/null 2>&1; then
        error "sha256sum is required to verify release downloads."
        return 1
    fi

    if [ ! -s "$checksums_file" ]; then
        info "Downloading checksum manifest..."
        if ! curl -fSL --progress-bar "${BASE_URL}/${CHECKSUMS_NAME}" -o "$checksums_file"; then
            local fallback_url="${CHECKSUMS_FALLBACK_BASE_URL}/tauri-app-${TAG}-${CHECKSUMS_NAME}"
            warn "Release checksum manifest is unavailable; checking the bootstrap manifest."
            if ! curl -fSL --progress-bar "$fallback_url" -o "$checksums_file"; then
                error "Checksum manifests are unavailable; refusing an unverified install."
                return 1
            fi
        fi
    fi

    local expected
    expected=$(awk -v name="$asset_name" '$2 == name { print $1; exit }' "$checksums_file")
    if [[ ! "$expected" =~ ^[[:xdigit:]]{64}$ ]]; then
        error "No valid checksum was published for ${asset_name}."
        return 1
    fi

    info "Downloading ${asset_name}..."
    if ! curl -fSL --progress-bar "${BASE_URL}/${asset_name}" -o "$destination"; then
        rm -f "$destination"
        error "Failed to download ${asset_name}."
        return 1
    fi

    local actual
    actual=$(sha256sum "$destination" | awk '{ print $1 }')
    if [ "${actual,,}" != "${expected,,}" ]; then
        rm -f "$destination"
        error "Checksum verification failed for ${asset_name}; refusing to install it."
        return 1
    fi

    info "Verified ${asset_name}."
}

if [ "${JSTORRENT_INSTALLER_LIB_ONLY:-}" = "1" ]; then
    return 0 2>/dev/null || exit 0
fi

# --- OS check ---
if [[ "$(uname -s)" != "Linux" ]]; then
    error "This script is for Linux only."
    echo "For Windows and macOS, download from: https://jstorrent.com"
    exit 1
fi

# --- Architecture ---
ARCH="$(uname -m)"
case "$ARCH" in
    x86_64)
        DEB_ARCH="amd64"
        APPIMAGE_ARCH="amd64"
        RPM_ARCH="x86_64"
        TRIPLE="x86_64-unknown-linux-gnu"
        ;;
    aarch64)
        DEB_ARCH="arm64"
        APPIMAGE_ARCH="aarch64"
        RPM_ARCH="aarch64"
        TRIPLE="aarch64-unknown-linux-gnu"
        ;;
    *)
        error "Unsupported architecture: $ARCH (supported: x86_64, aarch64)"
        exit 1
        ;;
esac

# --- Fetch latest release tag ---
info "Checking for latest release..."
TAG=$(curl -fsSL "https://api.github.com/repos/kzahel/jstorrent/releases" 2>/dev/null | \
    grep -o '"tag_name": "tauri-app-v[^"]*"' | head -1 | \
    sed 's/.*tauri-app-\(v[^"]*\)".*/\1/' || echo "")

if [ -z "$TAG" ]; then
    warn "Could not fetch latest release, using fallback: $FALLBACK_TAG"
    TAG="$FALLBACK_TAG"
else
    info "Latest release: $TAG"
fi

VERSION="${TAG#v}"
BASE_URL="https://github.com/kzahel/jstorrent/releases/download/tauri-app-${TAG}"

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

# --- Native host registration ---

# Find jstorrent-host sidecar binary in standard install locations.
find_host_binary() {
    local candidates=(
        "/usr/lib/jstorrent/binaries/jstorrent-host-${TRIPLE}"
        "/usr/lib/jstorrent/binaries/jstorrent-host"
        "/usr/lib/jstorrent/jstorrent-host-${TRIPLE}"
        "/usr/lib/jstorrent/jstorrent-host"
    )
    for candidate in "${candidates[@]}"; do
        if [ -x "$candidate" ]; then
            echo "$candidate"
            return
        fi
    done
    # Fallback: search
    find /usr/lib -name 'jstorrent-host*' -type f -executable 2>/dev/null | head -1
}

# Write native messaging manifest for each installed Chromium browser.
register_native_host() {
    local host_path="$1"

    if [ -z "$host_path" ] || [ ! -x "$host_path" ]; then
        warn "Could not find jstorrent-host binary for browser registration."
        warn "Launch JSTorrent to complete browser integration."
        return
    fi

    info "Registering native messaging host..."

    local manifest
    manifest=$(cat <<MANIFEST
{
  "name": "${MANIFEST_NAME}",
  "description": "JSTorrent Native Messaging Host",
  "path": "${host_path}",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://dbokmlpefliilbjldladbimlcfgbolhk/",
    "chrome-extension://opkmhecbhgngcbglpcdfmnomkffenapc/"
  ]
}
MANIFEST
)

    local browsers=(
        "$HOME/.config/google-chrome"
        "$HOME/.config/chromium"
        "$HOME/.config/BraveSoftware/Brave-Browser"
        "$HOME/.config/microsoft-edge"
    )

    local count=0
    for browser_dir in "${browsers[@]}"; do
        if [ -d "$browser_dir" ]; then
            local hosts_dir="${browser_dir}/NativeMessagingHosts"
            mkdir -p "$hosts_dir"
            echo "$manifest" > "${hosts_dir}/${MANIFEST_NAME}.json"
            chmod 644 "${hosts_dir}/${MANIFEST_NAME}.json"
            echo "  Registered: ${hosts_dir}/${MANIFEST_NAME}.json"
            count=$((count + 1))
        fi
    done

    if [ "$count" -eq 0 ]; then
        warn "No Chromium browser config directories found."
        warn "Launch JSTorrent after installing a browser to register the native host."
    else
        info "Registered native host for $count browser(s)."
    fi
}

# --- Install methods ---

install_deb() {
    local deb_file="JSTorrent_${VERSION}_${DEB_ARCH}.deb"
    if ! download_verified_asset "$deb_file" "${TMP_DIR}/${deb_file}"; then
        exit 1
    fi

    info "Installing (requires sudo)..."
    sudo dpkg -i "${TMP_DIR}/${deb_file}" || { sudo apt-get install -f -y && sudo dpkg -i "${TMP_DIR}/${deb_file}"; }

    register_native_host "$(find_host_binary)"

    echo ""
    info "JSTorrent ${VERSION} installed successfully!"
    echo "  Launch from your application menu or run: jstorrent"
    echo ""
    echo "  Uninstall: sudo apt remove jstorrent"
}

install_rpm() {
    local rpm_file="JSTorrent-${VERSION}-1.${RPM_ARCH}.rpm"
    if ! download_verified_asset "$rpm_file" "${TMP_DIR}/${rpm_file}"; then
        exit 1
    fi

    info "Installing (requires sudo)..."
    sudo rpm -U "${TMP_DIR}/${rpm_file}"

    register_native_host "$(find_host_binary)"

    echo ""
    info "JSTorrent ${VERSION} installed successfully!"
    echo "  Launch from your application menu or run: jstorrent"
    echo ""
    echo "  Uninstall: sudo rpm -e jstorrent"
}

install_appimage() {
    local appimage_file="JSTorrent_${VERSION}_${APPIMAGE_ARCH}.AppImage"
    local install_dir="$HOME/.local/bin"
    local install_path="${install_dir}/JSTorrent.AppImage"
    local lib_dir="$HOME/.local/lib/jstorrent"

    if ! download_verified_asset "$appimage_file" "${TMP_DIR}/${appimage_file}"; then
        exit 1
    fi

    mkdir -p "$install_dir"
    mv "${TMP_DIR}/${appimage_file}" "$install_path"
    chmod +x "$install_path"

    # Extract jstorrent-host sidecar from AppImage for native host registration.
    # The AppImage FUSE-mounts to a temp path at runtime, so we extract the
    # host binary to a permanent location that the browser manifest can reference.
    info "Extracting native host binary..."
    local extract_dir="${TMP_DIR}/squashfs-root"
    (cd "$TMP_DIR" && "$install_path" --appimage-extract "usr/lib/jstorrent/binaries/jstorrent-host*" >/dev/null 2>&1) || true

    local host_bin=""
    if [ -d "$extract_dir" ]; then
        host_bin=$(find "$extract_dir" -name 'jstorrent-host*' -type f 2>/dev/null | head -1)
    fi

    if [ -n "$host_bin" ] && [ -f "$host_bin" ]; then
        mkdir -p "$lib_dir"
        cp "$host_bin" "$lib_dir/jstorrent-host"
        chmod 755 "$lib_dir/jstorrent-host"
        register_native_host "$lib_dir/jstorrent-host"
    else
        warn "Could not extract native host binary from AppImage."
        warn "Launch JSTorrent to complete browser integration."
    fi

    # Create desktop entry for app launcher + protocol handler
    mkdir -p "$HOME/.local/share/applications"
    cat > "$HOME/.local/share/applications/jstorrent.desktop" <<DESKTOP
[Desktop Entry]
Name=JSTorrent
Comment=A fast, free BitTorrent client
Exec=${install_path} %u
Type=Application
Categories=Network;FileTransfer;P2P;
MimeType=x-scheme-handler/magnet;application/x-bittorrent;
NoDisplay=false
DESKTOP

    # Register as default handler for magnet links and .torrent files
    if command -v xdg-mime &>/dev/null; then
        xdg-mime default jstorrent.desktop x-scheme-handler/magnet 2>/dev/null || true
        xdg-mime default jstorrent.desktop application/x-bittorrent 2>/dev/null || true
    fi

    echo ""
    info "JSTorrent ${VERSION} installed to ${install_path}"
    echo "  Launch from your application menu or run: ${install_path}"
    echo ""
    echo "  Uninstall:"
    echo "    rm ~/.local/bin/JSTorrent.AppImage"
    echo "    rm -rf ~/.local/lib/jstorrent"
    echo "    rm ~/.local/share/applications/jstorrent.desktop"
}

# --- Choose install method ---
# Prefer AppImage: it supports Tauri's built-in auto-updater.
# Use --deb or --rpm to force a system package instead (no auto-update).
case "${1:-}" in
    --deb) install_deb ;;
    --rpm) install_rpm ;;
    *)     install_appimage ;;
esac
