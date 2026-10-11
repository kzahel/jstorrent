#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
INSTALLER="$REPO_ROOT/website/public/install-crostini.sh"

if [ "$(uname -s)" != "Linux" ]; then
    echo "Crostini bootstrap integrity tests require Linux." >&2
    exit 1
fi

bash -n "$INSTALLER"

TEST_DIR=$(mktemp -d)
trap 'rm -rf "$TEST_DIR"' EXIT
export RSTORRENT_CROSTINI_INSTALLER_LIB_ONLY=1
# shellcheck source=/dev/null
source "$INSTALLER"
unset RSTORRENT_CROSTINI_INSTALLER_LIB_ONLY

base64_line() {
    base64 < "$1" | tr -d '\n'
}

make_signature() {
    local mode="$1"
    local data="$2"
    local output="$3"
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
        echo 'untrusted comment: test RSTorrent release signature'
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
cp "$TEST_DIR/prehashed.minisig" "$TEST_DIR/tampered-signature.minisig"
sed -i.bak '2s/^./A/' "$TEST_DIR/tampered-signature.minisig"
if verify_minisign \
    "$TEST_DIR/data" "$TEST_DIR/tampered-signature.minisig" \
    "$TEST_PUBLIC_KEY" "$TEST_DIR" 2>/dev/null; then
    echo "FAIL: installer accepted tampered signature bytes" >&2
    exit 1
fi

BUNDLE="$TEST_DIR/bundle"
mkdir -p "$BUNDLE/bin" "$BUNDLE/icons" "$BUNDLE/web"
printf '0.1.0\n' > "$BUNDLE/VERSION"
printf 'icon fixture\n' > "$BUNDLE/icons/rstorrent-128.png"
printf '<!doctype html><title>fixture</title>\n' > "$BUNDLE/web/index.html"
cat > "$BUNDLE/bin/rstorrent-crostini" <<'EOF'
#!/usr/bin/env bash
if [ "${1:-}" = "--version" ]; then
    echo "rstorrent-crostini 0.1.0"
    exit 0
fi
echo "unexpected fixture launcher command" >&2
exit 1
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
cp "$SCRIPT_DIR/bin/rstorrent-crostini" "$HOME/.local/bin/rstorrent-crostini"
chmod 755 "$HOME/.local/bin/rstorrent-crostini"
printf 'installed\n' > "$HOME/install-marker"
EOF
chmod 755 \
    "$BUNDLE/bin/rstorrent-crostini" \
    "$BUNDLE/bin/rstorrent-gateway" \
    "$BUNDLE/install.sh"

ASSET="$TEST_DIR/rstorrent-crostini-0.1.0-x86_64.tar.gz"
tar -czf "$ASSET" -C "$BUNDLE" .
FIXTURE_SIZE=$(wc -c < "$ASSET" | tr -d ' ')
FIXTURE_SHA=$(sha256sum "$ASSET" | awk '{ print $1 }')
cat > "$TEST_DIR/$MANIFEST_NAME" <<EOF
rstorrent-crostini-release-v1
version=0.1.0
tag=crostini-v0.1.0
repository=kzahel/rstorrent
source_commit=0123456789abcdef0123456789abcdef01234567
launch_protocol=1
extension_id=gcgoepclopkgijmclmlheafaglmbjlcc
runtime=linux-gnu-crostini-package
x86_64_asset=rstorrent-crostini-0.1.0-x86_64.tar.gz
x86_64_sha256=$FIXTURE_SHA
x86_64_size=$FIXTURE_SIZE
aarch64_asset=rstorrent-crostini-0.1.0-aarch64.tar.gz
aarch64_sha256=$FIXTURE_SHA
aarch64_size=$FIXTURE_SIZE
manifest_asset=rstorrent-crostini-release.manifest
signature_asset=rstorrent-crostini-release.manifest.minisig
EOF
make_signature prehashed "$TEST_DIR/$MANIFEST_NAME" "$TEST_DIR/$SIGNATURE_NAME"

parse_manifest "$TEST_DIR/$MANIFEST_NAME" x86_64
test "$RELEASE_VERSION" = "0.1.0"
test "$RELEASE_ASSET" = "rstorrent-crostini-0.1.0-x86_64.tar.gz"
test "$RELEASE_SHA256" = "$FIXTURE_SHA"
test "$RELEASE_SIZE" = "$FIXTURE_SIZE"
verify_release_asset "$ASSET" "$FIXTURE_SIZE" "$FIXTURE_SHA"
validate_archive_listing "$ASSET" "$TEST_DIR/archive.list"
validate_extracted_bundle "$BUNDLE" 0.1.0
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
sed -i.bak '/^runtime=/h;/^runtime=/d;/^extension_id=/G' "$TEST_DIR/bad-order.manifest"
if parse_manifest "$TEST_DIR/bad-order.manifest" x86_64 2>/dev/null; then
    echo "FAIL: installer accepted reordered release metadata" >&2
    exit 1
fi

cp "$TEST_DIR/$MANIFEST_NAME" "$TEST_DIR/bad-protocol.manifest"
sed -i.bak 's/launch_protocol=1/launch_protocol=2/' "$TEST_DIR/bad-protocol.manifest"
if parse_manifest "$TEST_DIR/bad-protocol.manifest" x86_64 2>/dev/null; then
    echo "FAIL: installer accepted incompatible launch metadata" >&2
    exit 1
fi

cp "$TEST_DIR/$MANIFEST_NAME" "$TEST_DIR/bad-extension.manifest"
sed -i.bak 's/extension_id=gcgoepclopkgijmclmlheafaglmbjlcc/extension_id=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/' "$TEST_DIR/bad-extension.manifest"
if parse_manifest "$TEST_DIR/bad-extension.manifest" x86_64 2>/dev/null; then
    echo "FAIL: installer accepted a different extension identity" >&2
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
    local _requested_version="$1"
    local destination="$2"
    cp "$TEST_DIR/$MANIFEST_NAME" "$destination/$MANIFEST_NAME"
    cp "$TEST_DIR/$SIGNATURE_NAME" "$destination/$SIGNATURE_NAME"
}
download_release_asset() {
    case "$1" in
        https://github.com/kzahel/jstorrent/releases/download/*) ;;
        *) echo "FAIL: installer did not use canonical release transport" >&2; return 1 ;;
    esac
    local _url="$1"
    local output="$2"
    local _maximum_size="$3"
    cp "$ASSET" "$output"
}
MINISIGN_PUBLIC_KEY="$TEST_PUBLIC_KEY"
export HOME="$TEST_DIR/home"
mkdir -p "$HOME"
installer_main --version 0.1.0
test -f "$HOME/install-marker"
test "$("$HOME/.local/bin/rstorrent-crostini" --version)" = \
    "rstorrent-crostini 0.1.0"

echo "Crostini bootstrap installer integrity tests passed."
