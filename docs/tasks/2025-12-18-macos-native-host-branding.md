# macOS Native Host Branding

## Implemented: Link Handler App Bundle

The JSTorrent Link Handler is installed as a proper macOS app bundle at `~/Applications/JSTorrent Link Handler.app` with:

- **CFBundleDisplayName**: "JSTorrent" shown in system UI
- **CFBundleIdentifier**: `com.jstorrent.link-handler`
- **App Icon**: Custom JSTorrent icon (`AppIcon.icns`)
- **Document Type Icon**: Same icon shown for .torrent files
- **URL Scheme**: Handles `magnet:` links
- **Document Handler**: Opens `.torrent` files

### App Bundle Structure

```
~/Applications/JSTorrent Link Handler.app/
├── Contents/
│   ├── Info.plist
│   ├── PkgInfo
│   ├── MacOS/
│   │   ├── droplet           (AppleScript runner)
│   │   └── jstorrent-link-handler-bin
│   └── Resources/
│       ├── AppIcon.icns
│       └── Scripts/
│           └── main.scpt     (compiled AppleScript)
```

### Icon Generation

The build script generates `AppIcon.icns` from PNG source files using `iconutil`:

```bash
# Creates iconset with proper naming
mkdir -p AppIcon.iconset
cp js-16.png AppIcon.iconset/icon_16x16.png
cp js-32.png AppIcon.iconset/icon_32x32.png
# ... etc

# Convert to .icns
iconutil -c icns AppIcon.iconset -o AppIcon.icns
```

---

## Future: Native Host App Bundle

### Problem: Truncated Names in System Dialogs

macOS truncates binary names in permission dialogs (e.g., "Allow jstorrent-nativ to find devices..."). This looks unprofessional.

### Solution: Wrap Native Host in App Bundle

Instead of running a bare binary, wrap `jstorrent-native-host` in a minimal `.app` bundle with proper `Info.plist` metadata.

### Benefits

- **CFBundleDisplayName**: Full "JSTorrent Native Host" name in dialogs
- **CFBundleIdentifier**: Proper app identification for permissions
- **App icon**: Custom icon in system dialogs
- **Consistent branding**: Matches the Link Handler app bundle approach

### Implementation

1. **Create app bundle structure during install:**
   ```
   ~/Library/Application Support/JSTorrent/JSTorrent Native Host.app/
   ├── Contents/
   │   ├── Info.plist
   │   ├── MacOS/
   │   │   └── jstorrent-native-host  (the binary)
   │   └── Resources/
   │       └── AppIcon.icns
   ```

2. **Info.plist for native host:**
   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
   <plist version="1.0">
   <dict>
       <key>CFBundleDisplayName</key>
       <string>JSTorrent Native Host</string>
       <key>CFBundleName</key>
       <string>JSTorrent Native Host</string>
       <key>CFBundleIdentifier</key>
       <string>com.jstorrent.native-host</string>
       <key>CFBundleExecutable</key>
       <string>jstorrent-native-host</string>
       <key>CFBundleIconFile</key>
       <string>AppIcon</string>
       <key>CFBundleVersion</key>
       <string>1.0</string>
       <key>CFBundleShortVersionString</key>
       <string>1.0</string>
       <key>CFBundlePackageType</key>
       <string>APPL</string>
       <key>LSBackgroundOnly</key>
       <true/>
       <key>NSLocalNetworkUsageDescription</key>
       <string>JSTorrent needs local network access to communicate with the download daemon.</string>
   </dict>
   </plist>
   ```

3. **Update Chrome native messaging manifest** to point to the app bundle:
   ```json
   {
     "path": "/Users/xxx/Library/Application Support/JSTorrent/JSTorrent Native Host.app/Contents/MacOS/jstorrent-native-host"
   }
   ```

### Notes

- `LSBackgroundOnly` prevents the app from appearing in the Dock
- `NSLocalNetworkUsageDescription` provides context for the network permission dialog
- The binary path in the manifest must point to the actual executable inside the bundle

---

## Future Enhancements

- Codesign the app bundles for Gatekeeper compatibility
- Notarize for distribution outside the App Store
- Create a distinct document icon for .torrent files (currently uses same as app icon)
