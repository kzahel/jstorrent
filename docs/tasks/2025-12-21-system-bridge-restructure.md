# System Bridge Restructure

Reorganize the native components for better naming, independent Windows metadata, and macOS app bundles.

## Goals

1. **Rename** `native-host/` → `system-bridge/` (umbrella folder name)
2. **Restructure** into separate Cargo packages for independent Windows metadata
3. **Create macOS app bundles** for all three components
4. **Update all references** across the codebase

## Naming Strategy

| Component | Package Name | Binary Name | Windows FileDescription | macOS CFBundleName |
|-----------|--------------|-------------|------------------------|-------------------|
| Shared lib | `jstorrent-common` | (library) | N/A | N/A |
| Native Host | `jstorrent-host` | `jstorrent-host` | JSTorrent Native Host | JSTorrent Native Host |
| IO Daemon | `jstorrent-io-daemon` | `jstorrent-io-daemon` | JSTorrent IO | JSTorrent IO |
| Link Handler | `jstorrent-link-handler` | `jstorrent-link-handler` | JSTorrent | JSTorrent |

The Link Handler gets just "JSTorrent" because it's the user-facing component in "Open with" dialogs.

---

## Phase 1: Create New Directory Structure

### 1.1 Create the new structure

```bash
cd /path/to/jstorrent-monorepo

# Create system-bridge with new structure
mkdir -p system-bridge/common/src
mkdir -p system-bridge/host/src
mkdir -p system-bridge/link-handler/src

# Move existing io-daemon (already a separate package)
mv native-host/io-daemon system-bridge/

# Move shared library code
mv native-host/src/lib.rs system-bridge/common/src/lib.rs

# Move host code  
mv native-host/src/main.rs system-bridge/host/src/main.rs
mv native-host/src/*.rs system-bridge/host/src/
mv native-host/build.rs system-bridge/host/build.rs

# Move link-handler code
mv native-host/src/bin/link-handler.rs system-bridge/link-handler/src/main.rs

# Move other directories
mv native-host/installers system-bridge/
mv native-host/manifests system-bridge/
mv native-host/scripts system-bridge/

# Move remaining files
mv native-host/Cargo.lock system-bridge/
mv native-host/.gitignore system-bridge/
mv native-host/DESIGN.md system-bridge/
mv native-host/jstorrent-native.env.example system-bridge/
mv native-host/docs_archive system-bridge/

# Move verification scripts
mv native-host/verify_*.py system-bridge/

# Remove old directory
rmdir native-host/src/bin 2>/dev/null || true
rmdir native-host/src 2>/dev/null || true
rmdir native-host
```

### 1.2 Final structure

```
system-bridge/
├── Cargo.toml              # Workspace root (no [package])
├── Cargo.lock
├── .gitignore
├── DESIGN.md
├── jstorrent-native.env.example
├── common/
│   ├── Cargo.toml
│   └── src/
│       └── lib.rs
├── host/
│   ├── Cargo.toml
│   ├── build.rs
│   ├── Info.plist          # NEW: macOS app bundle metadata
│   └── src/
│       ├── main.rs
│       ├── daemon_manager.rs
│       ├── folder_picker.rs
│       ├── ipc.rs
│       ├── logging.rs
│       ├── opener.rs
│       ├── path_safety.rs
│       ├── protocol.rs
│       ├── rpc.rs
│       ├── state.rs
│       └── win_foreground.rs
├── io-daemon/
│   ├── Cargo.toml          # Already exists, update dependency path
│   ├── build.rs
│   ├── Info.plist          # NEW: macOS app bundle metadata
│   └── src/
│       └── ...
├── link-handler/
│   ├── Cargo.toml          # NEW
│   ├── build.rs            # NEW
│   ├── Info.plist          # NEW (move from installers/macos/)
│   └── src/
│       └── main.rs
├── installers/
│   ├── linux/
│   ├── macos/
│   └── windows/
├── manifests/
├── scripts/
├── docs_archive/
└── verify_*.py
```

---

## Phase 2: Create Cargo.toml Files

### 2.1 Workspace root: `system-bridge/Cargo.toml`

```toml
[workspace]
members = ["common", "host", "io-daemon", "link-handler"]
resolver = "2"

[workspace.package]
version = "0.1.5"
edition = "2021"

[workspace.dependencies]
tokio = { version = "1.32", features = ["full"] }
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
anyhow = "1.0"
thiserror = "1.0"
base64 = "0.21"
sha2 = "0.10"
hex = "0.4"
clap = { version = "4.4", features = ["derive"] }
chrono = "0.4"
uuid = { version = "1.0", features = ["v4", "serde"] }
tracing = "0.1"
```

### 2.2 Common library: `system-bridge/common/Cargo.toml`

```toml
[package]
name = "jstorrent-common"
version.workspace = true
edition.workspace = true

[dependencies]
serde = { workspace = true }
serde_json = { workspace = true }
anyhow = { workspace = true }
thiserror = { workspace = true }
sha2 = { workspace = true }
hex = { workspace = true }
```

### 2.3 Host: `system-bridge/host/Cargo.toml`

```toml
[package]
name = "jstorrent-host"
version.workspace = true
edition.workspace = true

[dependencies]
jstorrent-common = { path = "../common" }
tokio = { workspace = true }
serde = { workspace = true }
serde_json = { workspace = true }
byteorder = "1.4"
thiserror = { workspace = true }
anyhow = { workspace = true }
rfd = "0.15"
base64 = { workspace = true }
axum = "0.7"
uuid = { workspace = true }
sysinfo = "0.30"
reqwest = { version = "0.11", default-features = false, features = ["blocking", "json", "rustls-tls"] }
clap = { workspace = true }
dirs = "5.0"
tempfile = "3.8"
chrono = { workspace = true }
lazy_static = "1.5.0"
ctrlc = "3.5.1"
sha2 = { workspace = true }
hex = { workspace = true }
open = "5"
pollster = "0.4"

[target.'cfg(windows)'.dependencies]
windows-sys = { version = "0.52", features = [
    "Win32_UI_WindowsAndMessaging",
    "Win32_UI_Input_KeyboardAndMouse",
    "Win32_Foundation",
] }

[build-dependencies]
winres = "0.1"

[[bin]]
name = "jstorrent-host"
path = "src/main.rs"
```

### 2.4 Link Handler: `system-bridge/link-handler/Cargo.toml`

```toml
[package]
name = "jstorrent-link-handler"
version.workspace = true
edition.workspace = true

[dependencies]
jstorrent-common = { path = "../common" }
anyhow = { workspace = true }
serde = { workspace = true }
serde_json = { workspace = true }
reqwest = { version = "0.11", default-features = false, features = ["blocking", "json", "rustls-tls"] }
clap = { workspace = true }
dirs = "5.0"
base64 = { workspace = true }
open = "5"

[build-dependencies]
winres = "0.1"

[[bin]]
name = "jstorrent-link-handler"
path = "src/main.rs"
```

### 2.5 Update IO Daemon: `system-bridge/io-daemon/Cargo.toml`

Change the dependency path:

```toml
# Change from:
jstorrent_common = { package = "jstorrent-host", path = "../" }

# To:
jstorrent-common = { path = "../common" }
```

Also update any imports in the io-daemon source from `jstorrent_common` to `jstorrent_common` (the crate name stays the same due to the `-` to `_` conversion).

---

## Phase 3: Update Build Scripts

### 3.1 Host: `system-bridge/host/build.rs`

```rust
fn main() {
    #[cfg(windows)]
    {
        let mut res = winres::WindowsResource::new();
        res.set_icon("../installers/windows/assets/icon.ico");
        res.set("ProductName", "JSTorrent Native Host");
        res.set("FileDescription", "JSTorrent Native Host");
        res.set("CompanyName", "JSTorrent");
        res.set("LegalCopyright", "JSTorrent");
        res.compile().unwrap();
    }
}
```

### 3.2 Link Handler: `system-bridge/link-handler/build.rs`

```rust
fn main() {
    #[cfg(windows)]
    {
        let mut res = winres::WindowsResource::new();
        res.set_icon("../installers/windows/assets/icon.ico");
        res.set("ProductName", "JSTorrent");
        res.set("FileDescription", "JSTorrent");
        res.set("CompanyName", "JSTorrent");
        res.set("LegalCopyright", "JSTorrent");
        res.compile().unwrap();
    }
}
```

### 3.3 IO Daemon: `system-bridge/io-daemon/build.rs`

```rust
fn main() {
    #[cfg(windows)]
    {
        let mut res = winres::WindowsResource::new();
        res.set_icon("../installers/windows/assets/icon.ico");
        res.set("ProductName", "JSTorrent IO");
        res.set("FileDescription", "JSTorrent IO");
        res.set("CompanyName", "JSTorrent");
        res.set("LegalCopyright", "JSTorrent");
        res.compile().unwrap();
    }
}
```

---

## Phase 4: Create macOS Info.plist Files

### 4.1 Host: `system-bridge/host/Info.plist`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>jstorrent-host</string>
    <key>CFBundleIdentifier</key>
    <string>com.jstorrent.native-host</string>
    <key>CFBundleName</key>
    <string>JSTorrent Native Host</string>
    <key>CFBundleDisplayName</key>
    <string>JSTorrent Native Host</string>
    <key>CFBundleVersion</key>
    <string>0.1.5</string>
    <key>CFBundleShortVersionString</key>
    <string>0.1.5</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleIconFile</key>
    <string>AppIcon</string>
    <key>LSUIElement</key>
    <true/>
    <key>LSBackgroundOnly</key>
    <true/>
</dict>
</plist>
```

### 4.2 IO Daemon: `system-bridge/io-daemon/Info.plist`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>jstorrent-io-daemon</string>
    <key>CFBundleIdentifier</key>
    <string>com.jstorrent.io-daemon</string>
    <key>CFBundleName</key>
    <string>JSTorrent IO</string>
    <key>CFBundleDisplayName</key>
    <string>JSTorrent IO</string>
    <key>CFBundleVersion</key>
    <string>0.1.5</string>
    <key>CFBundleShortVersionString</key>
    <string>0.1.5</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleIconFile</key>
    <string>AppIcon</string>
    <key>LSUIElement</key>
    <true/>
    <key>LSBackgroundOnly</key>
    <true/>
</dict>
</plist>
```

### 4.3 Link Handler: `system-bridge/link-handler/Info.plist`

Move from `installers/macos/Info.plist` and update:
- Keep URL/file type handlers
- Keep `CFBundleExecutable` as `jstorrent-link-handler`
- `CFBundleName`: "JSTorrent"
- `CFBundleDisplayName`: "JSTorrent"

---

## Phase 5: Update macOS Installer Script

### 5.1 Update `system-bridge/scripts/build-macos-installer.sh`

Major changes needed:

1. Build all three as app bundles
2. Native messaging manifest points into the app bundle
3. All three bundles go to `/Library/Application Support/JSTorrent/`

Key changes to the script:

```bash
# Build app bundles for all three components
function build_app_bundle() {
    local NAME=$1           # e.g., "JSTorrent Native Host"
    local BINARY=$2         # e.g., "jstorrent-host"
    local PLIST_SRC=$3      # e.g., "host/Info.plist"
    local BUNDLE_DIR="pkgroot/${NAME}.app"
    
    mkdir -p "$BUNDLE_DIR/Contents/MacOS"
    mkdir -p "$BUNDLE_DIR/Contents/Resources"
    
    # Copy binary
    cp "target/release/$BINARY" "$BUNDLE_DIR/Contents/MacOS/$BINARY"
    chmod 755 "$BUNDLE_DIR/Contents/MacOS/$BINARY"
    
    # Copy Info.plist
    cp "$PLIST_SRC" "$BUNDLE_DIR/Contents/Info.plist"
    
    # Copy icon
    cp "$ICONSET_ICNS" "$BUNDLE_DIR/Contents/Resources/AppIcon.icns"
    
    # Create PkgInfo
    echo -n "APPL????" > "$BUNDLE_DIR/Contents/PkgInfo"
    
    # Sign if requested
    if $SIGN; then
        codesign --sign "$CODESIGN_IDENTITY" --options runtime --timestamp --force --deep "$BUNDLE_DIR"
    fi
}

# Generate icon once
# ... (existing icon generation code) ...
ICONSET_ICNS="/tmp/AppIcon.icns"

# Build all three app bundles
build_app_bundle "JSTorrent Native Host" "jstorrent-host" "host/Info.plist"
build_app_bundle "JSTorrent IO" "jstorrent-io-daemon" "io-daemon/Info.plist"
build_app_bundle "JSTorrent" "jstorrent-link-handler" "link-handler/Info.plist"  # Link Handler

# For Link Handler, also handle the AppleScript droplet wrapper
# (existing link handler app bundle code, but now building on top of the above)
```

Update the native messaging manifest template path:
```json
{
  "path": "/Library/Application Support/JSTorrent/JSTorrent Native Host.app/Contents/MacOS/jstorrent-host"
}
```

Also update the postinstall script to:
- Copy Link Handler to `~/Applications/` (for file associations)
- Leave Native Host and IO Daemon in `/Library/Application Support/JSTorrent/`

---

## Phase 6: Update Windows Installer

### 6.1 Update `system-bridge/installers/windows/jstorrent.iss`

Update source paths (they now come from workspace target directory, same as before):

```ini
[Files]
Source: "..\..\target\release\jstorrent-host.exe"; DestDir: "{app}"; DestName: "jstorrent-native-host.exe"; Flags: ignoreversion
Source: "..\..\target\release\jstorrent-io-daemon.exe"; DestDir: "{app}"; DestName: "jstorrent-io-daemon.exe"; Flags: ignoreversion
Source: "..\..\target\release\jstorrent-link-handler.exe"; DestDir: "{app}"; DestName: "JSTorrent Link Handler.exe"; Flags: ignoreversion
```

No changes needed to the source paths since `cargo build --workspace` still outputs to `target/release/`.

---

## Phase 7: Update Linux Installer

### 7.1 Update `system-bridge/installers/linux/install.sh`

No changes needed to the install logic itself—binary names stay the same.

### 7.2 Update `system-bridge/scripts/build-linux-installer.sh`

Update working directory check:
```bash
# Change from:
if [ ! -f "Cargo.toml" ]; then
    echo "Error: This script must be run from the native-host directory."

# To:
if [ ! -f "Cargo.toml" ]; then
    echo "Error: This script must be run from the system-bridge directory."
```

---

## Phase 8: Update CI Workflows

### 8.1 Update `.github/workflows/native-ci.yml`

```yaml
on:
  push:
    paths:
      - 'system-bridge/**'        # Changed from native-host
      # ...
  pull_request:
    paths:
      - 'system-bridge/**'        # Changed from native-host
      # ...

defaults:
  run:
    working-directory: system-bridge  # Changed from native-host

# Update all artifact paths:
#   native-host/installers/... → system-bridge/installers/...
#   native-host/dist/... → system-bridge/dist/...
#   native-host/*.pkg → system-bridge/*.pkg
```

### 8.2 Update `.github/workflows/extension-ci.yml`

```yaml
      - name: Install Native Host
        working-directory: system-bridge  # Changed from native-host
        run: ./scripts/install-local-linux.sh
```

---

## Phase 9: Update Scripts

All scripts in `system-bridge/scripts/` need their working directory messages updated:

```bash
# In each script, change:
echo "Error: This script must be run from the native-host directory."
# To:
echo "Error: This script must be run from the system-bridge directory."
```

Scripts to update:
- `build-linux-installer.sh`
- `build-macos-installer.sh`
- `build-windows-installer.ps1`
- `install-local-linux.sh`
- `install-local-macos.sh`
- `install-local-windows.bat`
- `verify-linux-installer.sh`
- `verify-macos-installer.sh`
- `verify-torrent-association.sh`

---

## Phase 10: Update Documentation

### 10.1 Files to update

| File | Changes |
|------|---------|
| `DEVELOPMENT.md` | All `native-host/` references → `system-bridge/` |
| `CLAUDE.md` | Any references (none found) |
| `docs/project/PACKAGES.md` | Update package structure section |
| `docs/project/WORKFLOW.md` | Update commands and paths |
| `docs/project/ARCHITECTURE.md` | Minor terminology updates |
| `docs/project/DAEMON-PROTOCOL.md` | Minor terminology updates |
| `.github/copilot-instructions.md` | Update directory references |
| `docs/design_docs/native-components.md` | Update paths |
| `docs/design_docs/native-components-authentication.md` | Update paths |
| `docs/design_docs/io-daemon-design.md` | Update paths |
| `docs/research/windows-exe-metadata-restructure.md` | Mark as implemented or archive |

---

## Phase 11: Update Source Code Imports

### 11.1 Host source files

In all files under `system-bridge/host/src/`, update:
```rust
// If any file imports from lib.rs, change:
use crate::...  // Internal to host package
// Or if importing from common:
use jstorrent_common::...
```

### 11.2 Link Handler

In `system-bridge/link-handler/src/main.rs`:
```rust
// Update imports to use jstorrent_common instead of jstorrent_common from parent
use jstorrent_common::...;
```

### 11.3 IO Daemon

Check all imports in `system-bridge/io-daemon/src/` and update:
```rust
// Change from (if any):
use jstorrent_common::...
// The import path stays the same, but verify it works with new package structure
```

---

## Verification Checklist

After completing all phases, verify:

### Build verification
- [ ] `cd system-bridge && cargo build --workspace` succeeds
- [ ] `cd system-bridge && cargo build --workspace --release` succeeds
- [ ] All three binaries are produced in `target/release/`

### Windows verification
- [ ] `jstorrent-host.exe` shows "JSTorrent Native Host" in Task Manager
- [ ] `jstorrent-io-daemon.exe` shows "JSTorrent IO" in Task Manager
- [ ] `jstorrent-link-handler.exe` shows "JSTorrent" in Task Manager
- [ ] Windows installer builds successfully
- [ ] Windows installer installs correctly

### macOS verification
- [ ] All three `.app` bundles are created
- [ ] Each bundle has correct `CFBundleName` in Info.plist
- [ ] Native messaging manifest points to correct path in app bundle
- [ ] `codesign --verify` passes on all bundles
- [ ] Firewall prompts show correct names
- [ ] File access prompts show correct names
- [ ] Installer builds and installs correctly

### Linux verification
- [ ] Tarball installer builds successfully
- [ ] Installation works correctly
- [ ] Magnet links open correctly

### CI verification
- [ ] `native-ci.yml` runs on system-bridge changes
- [ ] `extension-ci.yml` E2E tests pass
- [ ] All three platform builds succeed

### Documentation verification
- [ ] `DEVELOPMENT.md` has correct paths
- [ ] `docs/project/PACKAGES.md` reflects new structure
- [ ] No broken references to `native-host/`

### Website verification
- [ ] `website/install.sh` still downloads correct release asset
  - (Asset name doesn't change, just the source path in CI)

---

## Rollback Plan

If issues are discovered after merge:

1. The old `native-host/` structure can be restored from git history
2. CI workflows can be reverted
3. No user-facing installer changes until verified

---

## Future Considerations

After this restructure:
- Version numbers can diverge per component if needed
- Each component's build.rs can be customized independently
- Adding new native components just means adding a new workspace member
