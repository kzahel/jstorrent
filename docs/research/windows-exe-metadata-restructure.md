# Windows Executable Metadata: Restructuring for Independent Control

## Current Limitation

Currently, `jstorrent-host` and `jstorrent-link-handler` are defined as two binaries in the same Cargo package (`native-host/Cargo.toml`):

```toml
[[bin]]
name = "jstorrent-host"
path = "src/main.rs"

[[bin]]
name = "jstorrent-link-handler"
path = "src/bin/link-handler.rs"
```

Cargo runs `build.rs` **once per package**, not per binary. The `winres` crate compiles Windows resources (icon, version info, metadata) during the build script, and these resources are embedded into **all binaries** in the package.

This means `jstorrent-host.exe` and `jstorrent-link-handler.exe` will always have identical:
- ProductName
- FileDescription (shown in Task Manager "Name" column)
- CompanyName
- Icon
- Version info

## Restructure Option: Separate Packages

To give each binary independent Windows metadata, move `jstorrent-link-handler` to its own package.

### Proposed Structure

```
native-host/
├── Cargo.toml              # workspace root
├── src/
│   ├── lib.rs              # shared library (jstorrent_common)
│   └── main.rs             # jstorrent-host binary
├── build.rs                # resources for jstorrent-host
├── link-handler/           # NEW: separate package
│   ├── Cargo.toml
│   ├── build.rs            # resources for link-handler (can set "JSTorrent")
│   └── src/
│       └── main.rs         # moved from src/bin/link-handler.rs
└── io-daemon/              # already separate
    ├── Cargo.toml
    ├── build.rs
    └── src/
        └── main.rs
```

### Changes Required

1. **Create `native-host/link-handler/Cargo.toml`**:
   ```toml
   [package]
   name = "jstorrent-link-handler"
   version = "0.1.0"
   edition = "2021"

   [dependencies]
   jstorrent_common = { package = "jstorrent-host", path = ".." }
   # ... other deps used by link-handler

   [build-dependencies]
   winres = "0.1"
   ```

2. **Create `native-host/link-handler/build.rs`**:
   ```rust
   fn main() {
       #[cfg(windows)]
       {
           let mut res = winres::WindowsResource::new();
           res.set_icon("../installers/windows/assets/icon.ico");
           res.set("ProductName", "JSTorrent");
           res.set("FileDescription", "JSTorrent");  // Shows in Task Manager
           res.set("CompanyName", "JSTorrent");
           res.set("LegalCopyright", "JSTorrent");
           res.compile().unwrap();
       }
   }
   ```

3. **Move the source file**:
   ```bash
   mkdir -p native-host/link-handler/src
   mv native-host/src/bin/link-handler.rs native-host/link-handler/src/main.rs
   ```

4. **Update workspace in `native-host/Cargo.toml`**:
   ```toml
   [workspace]
   members = ["io-daemon", "link-handler"]
   ```

5. **Remove from main package**:
   ```toml
   # Remove this section:
   # [[bin]]
   # name = "jstorrent-link-handler"
   # path = "src/bin/link-handler.rs"
   ```

6. **Update `native-host/build.rs`** to set jstorrent-host specific metadata:
   ```rust
   res.set("FileDescription", "JSTorrent Native Host");
   ```

7. **Update installer** (`jstorrent.iss`) source path:
   ```ini
   Source: "..\..\link-handler\target\release\jstorrent-link-handler.exe"; ...
   ```
   Or build from workspace root and use:
   ```ini
   Source: "..\..\target\release\jstorrent-link-handler.exe"; ...
   ```

### Result After Restructure

| Executable | Package | FileDescription |
|------------|---------|-----------------|
| `jstorrent-link-handler.exe` | `link-handler` | JSTorrent |
| `jstorrent-host.exe` | `jstorrent-host` | JSTorrent Native Host |
| `jstorrent-io-daemon.exe` | `io-daemon` | JSTorrent Bridge |

### Trade-offs

**Pros:**
- Full independent control over each binary's Windows metadata
- Cleaner separation of concerns
- Each component can have different version numbers if needed

**Cons:**
- More complex project structure
- Additional `Cargo.toml` to maintain
- Need to ensure shared dependencies stay in sync
- Build commands may need adjustment (though workspace builds handle this)

## Alternative: Post-Build Resource Editing

Instead of restructuring, you could use a post-build tool to modify the embedded resources:

1. **Resource Hacker** (Windows GUI tool)
2. **rcedit** (command-line tool by Electron team)

Example with rcedit:
```bash
rcedit jstorrent-host.exe --set-version-string "FileDescription" "JSTorrent Native Host"
```

This could be integrated into the build/installer process but adds external tool dependencies.

## Current Workaround

The current setup accepts that `jstorrent-host.exe` and `jstorrent-link-handler.exe` share the same "JSTorrent" FileDescription. This is acceptable because:
- The link-handler is short-lived and rarely visible in Task Manager
- The native-host and link-handler are logically related
- Explorer's "Open with" dialog uses the registry `FriendlyAppName` ("JSTorrent"), not the exe metadata
