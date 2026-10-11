#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
INSTALLER="$REPO_ROOT/website/public/install-headless.sh"

if [ "$(uname -s)" != "Linux" ]; then
    echo "Headless bootstrap integrity tests require Linux." >&2
    exit 1
fi

bash -n "$INSTALLER"

TEST_DIR=$(mktemp -d)
trap 'rm -rf -- "$TEST_DIR"' EXIT
export RSTORRENT_HEADLESS_INSTALLER_LIB_ONLY=1
# shellcheck source=/dev/null
source "$INSTALLER"
unset RSTORRENT_HEADLESS_INSTALLER_LIB_ONLY

base64_line() {
    base64 < "$1" | tr -d '\n'
}

make_signature() {
    local mode="$1" data="$2" output="$3"
    local message="$TEST_DIR/message-$mode"
    local signature="$TEST_DIR/signature-$mode.raw"
    local packet="$TEST_DIR/signature-$mode.packet"
    local algorithm
    if [ "$mode" = "prehashed" ]; then
        algorithm='\105\104'
        openssl dgst -blake2b512 -binary "$data" > "$message"
    else
        algorithm='\105\144'
        cp "$data" "$message"
    fi
    openssl pkeyutl -sign -inkey "$TEST_DIR/test.key" \
        -rawin -in "$message" -out "$signature"
    printf "$algorithm" > "$packet"
    printf '\001\002\003\004\005\006\007\010' >> "$packet"
    cat "$signature" >> "$packet"
    {
        echo 'untrusted comment: test RSTorrent headless release signature'
        base64_line "$packet"
        echo
        echo 'trusted comment: test fixture'
        dd if=/dev/zero bs=64 count=1 status=none | base64 | tr -d '\n'
        echo
    } > "$output"
}

openssl genpkey -algorithm Ed25519 -out "$TEST_DIR/test.key" >/dev/null 2>&1
openssl pkey -in "$TEST_DIR/test.key" -pubout -outform DER \
    -out "$TEST_DIR/test-public.der" >/dev/null 2>&1
printf '\105\144' > "$TEST_DIR/test-public.packet"
printf '\001\002\003\004\005\006\007\010' >> "$TEST_DIR/test-public.packet"
tail -c 32 "$TEST_DIR/test-public.der" >> "$TEST_DIR/test-public.packet"
TEST_PUBLIC_KEY=$(base64_line "$TEST_DIR/test-public.packet")

printf 'signed metadata\n' > "$TEST_DIR/data"
for mode in legacy prehashed; do
    make_signature "$mode" "$TEST_DIR/data" "$TEST_DIR/$mode.minisig"
    verify_minisign \
        "$TEST_DIR/data" "$TEST_DIR/$mode.minisig" \
        "$TEST_PUBLIC_KEY" "$TEST_DIR"
done
printf 'tampered metadata\n' > "$TEST_DIR/tampered"
if verify_minisign \
    "$TEST_DIR/tampered" "$TEST_DIR/prehashed.minisig" \
    "$TEST_PUBLIC_KEY" "$TEST_DIR" 2>/dev/null; then
    echo "FAIL: installer accepted a tampered signed message" >&2
    exit 1
fi

BUNDLE="$TEST_DIR/bundle"
mkdir -p "$BUNDLE/bin" "$BUNDLE/resources" "$BUNDLE/web"
printf 'x86_64\n' > "$BUNDLE/ARCH"
printf 'com.jstorrent.rstorrent.headless\n' > "$BUNDLE/PACKAGE_ID"
printf '0.1.0\n' > "$BUNDLE/VERSION"
printf 'service fixture\n' > \
    "$BUNDLE/resources/com.jstorrent.rstorrent.headless.service.in"
printf 'config fixture\n' > "$BUNDLE/resources/headless.toml.example"
printf '<!doctype html><title>fixture</title>\n' > "$BUNDLE/web/index.html"
cat > "$BUNDLE/bin/rstorrent-headless" <<'EOF'
#!/usr/bin/env bash
case "${1:-}" in
    --version) echo "rstorrent-headless 0.1.0" ;;
    validate-package) exit 0 ;;
    *) echo "unexpected fixture command" >&2; exit 1 ;;
esac
EOF
cat > "$BUNDLE/bin/rstorrent-gateway" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
cat > "$BUNDLE/install.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$HOME/.local/bin"
cp "$SCRIPT_DIR/bin/rstorrent-headless" "$HOME/.local/bin/rstorrent-headless"
chmod 755 "$HOME/.local/bin/rstorrent-headless"
printf 'installed\n' > "$HOME/install-marker"
EOF
chmod 755 \
    "$BUNDLE/bin/rstorrent-headless" \
    "$BUNDLE/bin/rstorrent-gateway" \
    "$BUNDLE/install.sh"

ASSET="$TEST_DIR/rstorrent-headless-0.1.0-linux-x86_64.tar.gz"
tar -czf "$ASSET" -C "$BUNDLE" .
FIXTURE_SIZE=$(wc -c < "$ASSET" | tr -d ' ')
FIXTURE_SHA=$(sha256sum "$ASSET" | awk '{ print $1 }')
cat > "$TEST_DIR/$MANIFEST_NAME" <<EOF
rstorrent-headless-release-v1
version=0.1.0
tag=headless-v0.1.0
repository=kzahel/rstorrent
source_commit=0123456789abcdef0123456789abcdef01234567
install_protocol=1
runtime=linux-gnu-headless-package
x86_64_asset=rstorrent-headless-0.1.0-linux-x86_64.tar.gz
x86_64_sha256=$FIXTURE_SHA
x86_64_size=$FIXTURE_SIZE
aarch64_asset=rstorrent-headless-0.1.0-linux-aarch64.tar.gz
aarch64_sha256=$FIXTURE_SHA
aarch64_size=$FIXTURE_SIZE
manifest_asset=rstorrent-headless-release.manifest
signature_asset=rstorrent-headless-release.manifest.minisig
EOF
make_signature prehashed "$TEST_DIR/$MANIFEST_NAME" "$TEST_DIR/$SIGNATURE_NAME"

parse_manifest "$TEST_DIR/$MANIFEST_NAME" x86_64
test "$RELEASE_VERSION" = "0.1.0"
test "$RELEASE_ASSET" = "rstorrent-headless-0.1.0-linux-x86_64.tar.gz"
test "$RELEASE_SHA256" = "$FIXTURE_SHA"
test "$RELEASE_SIZE" = "$FIXTURE_SIZE"
verify_release_asset "$ASSET" "$FIXTURE_SIZE" "$FIXTURE_SHA"
validate_archive_listing "$ASSET" "$TEST_DIR/archive.list"
validate_extracted_bundle "$BUNDLE" 0.1.0 x86_64

ORIGINAL_EXPANDED_LIMIT=$MAX_EXPANDED_BYTES
MAX_EXPANDED_BYTES=1
if validate_archive_listing "$ASSET" "$TEST_DIR/oversize.list" 2>/dev/null; then
    echo "FAIL: installer accepted a package beyond its expanded byte limit" >&2
    exit 1
fi
MAX_EXPANDED_BYTES=$ORIGINAL_EXPANDED_LIMIT

test "$(detect_architecture x86_64)" = x86_64
test "$(detect_architecture amd64)" = x86_64
test "$(detect_architecture aarch64)" = aarch64
test "$(detect_architecture arm64)" = aarch64
if detect_architecture riscv64 >/dev/null 2>&1; then
    echo "FAIL: installer accepted an unsupported architecture" >&2
    exit 1
fi

cp "$TEST_DIR/$MANIFEST_NAME" "$TEST_DIR/bad-order.manifest"
sed -i.bak '/^runtime=/h;/^runtime=/d;/^install_protocol=/G' \
    "$TEST_DIR/bad-order.manifest"
if parse_manifest "$TEST_DIR/bad-order.manifest" x86_64 2>/dev/null; then
    echo "FAIL: installer accepted reordered release metadata" >&2
    exit 1
fi
cp "$TEST_DIR/$MANIFEST_NAME" "$TEST_DIR/bad-protocol.manifest"
sed -i.bak 's/install_protocol=1/install_protocol=2/' \
    "$TEST_DIR/bad-protocol.manifest"
if parse_manifest "$TEST_DIR/bad-protocol.manifest" x86_64 2>/dev/null; then
    echo "FAIL: installer accepted incompatible install metadata" >&2
    exit 1
fi

cp "$ASSET" "$TEST_DIR/tampered-package.tar.gz"
printf 'tamper\n' >> "$TEST_DIR/tampered-package.tar.gz"
if verify_release_asset \
    "$TEST_DIR/tampered-package.tar.gz" "$FIXTURE_SIZE" "$FIXTURE_SHA" \
    2>/dev/null; then
    echo "FAIL: installer accepted tampered package bytes" >&2
    exit 1
fi

ln -s /tmp "$BUNDLE/unsafe-link"
tar -czf "$TEST_DIR/link-package.tar.gz" -C "$BUNDLE" .
if validate_archive_listing \
    "$TEST_DIR/link-package.tar.gz" "$TEST_DIR/link.list" 2>/dev/null; then
    echo "FAIL: installer accepted a package containing a link" >&2
    exit 1
fi
rm "$BUNDLE/unsafe-link"

version_is_older 1.2.2 1.2.3
version_is_older 0.9.9 1.0.0
if version_is_older 1.2.3 1.2.3 || version_is_older 2.0.0 1.9.9; then
    echo "FAIL: installer downgrade comparison is incorrect" >&2
    exit 1
fi

download_release_metadata() {
    local _requested_version="$1" destination="$2"
    cp "$TEST_DIR/$MANIFEST_NAME" "$destination/$MANIFEST_NAME"
    cp "$TEST_DIR/$SIGNATURE_NAME" "$destination/$SIGNATURE_NAME"
}
download_release_asset() {
    case "$1" in
        https://github.com/kzahel/jstorrent/releases/download/*) ;;
        *) echo "FAIL: installer did not use canonical release transport" >&2; return 1 ;;
    esac
    local _url="$1" output="$2" _maximum_size="$3"
    cp "$ASSET" "$output"
}
MINISIGN_PUBLIC_KEY="$TEST_PUBLIC_KEY"
export HOME="$TEST_DIR/home"
mkdir -p "$HOME"
installer_main --version 0.1.0
test -f "$HOME/install-marker"
test "$("$HOME/.local/bin/rstorrent-headless" --version)" = \
    "rstorrent-headless 0.1.0"

echo "Headless bootstrap installer integrity tests passed."
