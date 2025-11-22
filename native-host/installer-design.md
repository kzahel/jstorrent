Below is a **complete design document** for installer creation for **Windows**, **macOS**, and **Linux**, using a **single repository** that contains both the Rust project and all installer scaffolding.
It incorporates:

- suggested repo structure
- Inno Setup for Windows
- pkgbuild/productbuild for macOS
- shell scripts for Linux
- uninstallation strategy
- CI automation via GitHub Actions
- support for signed installers + unsigned fallback builds
- update strategy (reinstall = update)

This document describes _exactly_ how the packaging pipeline should be structured going forward.

---

# **JSTorrent Native Host – Installer Design Document**

## **0. Purpose**

This document specifies how to create, sign, package, and distribute installers for the **JSTorrent Native Messaging Host** on:

- Windows (Inno Setup)
- macOS (.pkg installer)
- Linux (shell install/uninstall script)

The goals:

- Install the binary in a platform-appropriate location
- Install the Chrome Native Messaging manifest
- Provide an uninstall method (Windows = system-managed, macOS/Linux = script)
- Generate installers via **GitHub Actions**
- Support **signed installers** when signing keys become available
- Support **unsigned installers** for local testing
- Keep everything in a **single repository**

---

# **1. Repository Structure**

Recommended layout:

```
jstorrent-native-host/
  src/
  Cargo.toml

  manifests/
    com.jstorrent.native.json.template

  installers/
    windows/
      jstorrent.iss              # Inno Setup script
      assets/
        icon.ico                  # optional
    macos/
      scripts/
        preinstall.sh
        postinstall.sh
        uninstall.sh
      pkg/
        distribution.xml          # optional
        org.jstorrent.native.pkgproj (if using a pkgproj)
    linux/
      install.sh
      uninstall.sh

  ci/
    github-actions/
      build-and-package.yml
```

---

# **2. Installation Target Paths**

## **2.1 macOS**

Binary directory:

```
/usr/local/lib/jstorrent-native/
```

Binary path:

```
/usr/local/lib/jstorrent-native/jstorrent-native-host
```

Manifest:

```
~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.jstorrent.native.json
```

Uninstall script:

```
/usr/local/lib/jstorrent-native/uninstall.sh
```

---

## **2.2 Windows (Inno Setup)**

Binary directory:

```
%LOCALAPPDATA%\JSTorrent\
```

Binary path:

```
%LOCALAPPDATA%\JSTorrent\native-host.exe
```

Manifest:

```
%LOCALAPPDATA%\JSTorrent\com.jstorrent.native.json
```

Registry key:

```
HKCU\Software\Google\Chrome\NativeMessagingHosts\com.jstorrent.native
(default) = path to manifest
```

Inno Setup automatically provides an uninstaller entry in:

- “Apps & Features”
- “Add/Remove Programs”

---

## **2.3 Linux**

Installation directory:

```
$HOME/.local/lib/jstorrent-native/
```

Binary path:

```
$HOME/.local/lib/jstorrent-native/jstorrent-native-host
```

Manifest:

```
$HOME/.config/google-chrome/NativeMessagingHosts/com.jstorrent.native.json
```

Uninstaller:

```
$HOME/.local/lib/jstorrent-native/uninstall.sh
```

Installation/uninstallation is handled purely by shell scripts.

---

# **3. Installer Requirements by Platform**

---

# **3.1 Windows – Inno Setup Installer**

### Installer Responsibilities

- Install the binary into `%LOCALAPPDATA%\JSTorrent\`
- Write the manifest file (with substituted absolute path)
- Write registry key to:

  ```
  HKCU\Software\Google\Chrome\NativeMessagingHosts\com.jstorrent.native
  ```

- Provide uninstall entry automatically
- Remove directory and manifest on uninstall

### Repository Files

```
installers/windows/jstorrent.iss
installers/windows/assets/icon.ico
```

### Inno Setup script tasks

1. Copy Rust binary from CI output → installer
2. Generate manifest file using built-in Preprocessor or a small script
3. Create registry key
4. Sign binaries & installer (if Windows code-signing cert exists)

### CI: unsigned fallback

If signing is not configured:

- Build installer unsigned
- Emit a CI warning
- Produce `.exe` anyway (works for local testing; Windows SmartScreen warnings will appear)

---

# **3.2 macOS – pkg Installer**

### Installer Responsibilities

- Install binary into `/usr/local/lib/jstorrent-native/`
- Install manifest file into the user’s Chrome Native Messaging directory
- Install uninstall script to same binary directory
- Ensure correct permissions:
  - binary: 755
  - manifest: 644
  - script: 755

- Support signed + notarized builds (future)
- Support unsigned builds for local testing (PKG can still run with warning dialogs)

### Required Scripts

```
installers/macos/scripts/preinstall.sh
installers/macos/scripts/postinstall.sh
installers/macos/scripts/uninstall.sh
```

`postinstall.sh`:

- Creates jstorrent-native directory
- Writes final manifest file (substitution from template)
- Ensures permissions

`preinstall.sh`:

- Optional cleanup of older versions

`uninstall.sh`:

- Removes binary + manifest

### Build Steps

Using `pkgbuild` and `productbuild`:

1. Stage directory:

   ```
   pkgroot/usr/local/lib/jstorrent-native/
   ```

2. Copy binary and uninstall.sh into staging directory.
3. `pkgbuild --root pkgroot ...`
4. `productbuild ...` to produce final `.pkg`

### CI: unsigned fallback

If codesigning identity missing:

- Build unsigned `.pkg`
- Print warning during CI
- Upload unsigned `.pkg` artifact
- User will receive Gatekeeper warnings; but can right-click → "Open"

---

# **3.3 Linux – Script Installer**

### Installer Responsibilities

`install.sh`:

- Creates `$HOME/.local/lib/jstorrent-native/`
- Installs binary + manifest
- Sets permissions
- Prints uninstall instructions

`uninstall.sh`:

- Removes above files
- Provides a clean removal

### No signing required.

---

# **4. Manifest Generation (All Platforms)**

A template is stored at:

```
manifests/com.jstorrent.native.json.template
```

Fields to substitute:

- `"path"` → absolute path to installed binary
- `"allowed_origins"` → list of extension IDs (hardcoded or CI-injected)

allowed_origins list initially is bnceafpojmnimbnhamaeedgomdcgnbjk
and
opkmhecbhgngcbglpcdfmnomkffenapc

### Example substitution mechanism:

- macOS: `sed` or small Rust tool
- Windows: Inno Setup Preprocessor (`#define`) or installer-time file generation
- Linux: shell script using `sed`

---

# **5. CI/CD Pipeline (GitHub Actions)**

File:

```
ci/github-actions/build-and-package.yml
```

Pipeline steps:

---

## **5.1 Build Matrix**

```
runs-on: [windows-latest, macos-latest, ubuntu-latest]
```

Each job:

- Installs Rust stable
- `cargo build --release`
- Collect binary from `target/release` directory

---

## **5.2 Windows job**

1. Build Rust binary
2. Attempt to sign with Windows cert (optional)
3. Inno Setup Compile:

   ```
   iscc installers/windows/jstorrent.iss
   ```

4. Upload artifacts:
   - `jstorrent-native-host.exe` (signed/unsigned)
   - `jstorrent-installer.exe` (signed/unsigned)

If cert missing:

- Emit warning
- Continue with unsigned installer

---

## **5.3 macOS job**

1. Build Rust binary
2. Try to `codesign` (fails gracefully if keys absent)
3. Build `.pkg`:
   - `pkgbuild`
   - `productbuild`

4. Attempt notarization; on failure, produce unsigned `.pkg`
5. Upload:
   - Signed `.pkg` if fully successful
   - Unsigned `.pkg` if not

---

## **5.4 Linux job**

1. Build Rust binary
2. Create tarball:

   ```
   jstorrent-native-host-linux-x86_64.tar.gz
   ```

3. Include the install/uninstall scripts
4. Upload tarball

---

# **6. Update Strategy**

### Chosen Strategy: **Reinstall = Update**

The extension can:

- check host version
- prompt user to download installer
- reinstall (overwrites existing files)

No auto-updater needed.

---

# **7. Uninstallation Strategy**

## **7.1 Windows**

Handled automatically by Inno Setup:

- appears in “Apps & Features”
- removes binary, manifest, registry keys

## **7.2 macOS**

User runs:

```
/usr/local/lib/jstorrent-native/uninstall.sh
```

Script removes:

- binary
- directory
- user-level native messaging manifest

## **7.3 Linux**

User runs:

```
~/.local/lib/jstorrent-native/uninstall.sh
```

---

# **8. Testing Installers**

Each installer must be testable manually:

- Windows: run `.exe`, verify manifest path in registry, run uninstaller
- macOS: run `.pkg`, verify binary + manifest installed, run uninstall script
- Linux: run install.sh + uninstall.sh

Unsigned builds must be easy to test locally for developer workflows.

---

# **9. Summary**

This design provides:

- A unified repository with installers and binary
- Consistent directory layout per platform
- Inno Setup on Windows
- pkgbuild/productbuild on macOS
- shell scripts on Linux
- Code signing + notarization scaffolding, but not required initially
- GitHub Actions automation for building and packaging
- A simple reinstall-based update model
- Script-based uninstallers for macOS/Linux
- unsigned fallback installers for local testing

This structure will enable seamless packaging and professional distribution of the JSTorrent Native Host across all major platforms.

---
