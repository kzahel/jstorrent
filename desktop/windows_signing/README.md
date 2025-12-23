# Windows Code Signing Directory

This directory contains all files and configuration for signing Windows binaries and installers with Azure Trusted Signing.

## 📁 Directory Structure

```
windows_signing/
├── .env                           # Environment variables (in .gitignore)
├── .env.example                   # Template with all values except secret
├── load-signing-env.ps1           # Helper to load .env variables
├── sign-binary.ps1                # Main signing script
├── signing/
│   ├── .gitignore                 # Prevents committing DLL and secrets
│   ├── Azure.CodeSigning.Dlib.dll # Microsoft signing client (119KB)
│   ├── download-signing-dll.bat   # One-time DLL download script
│   ├── metadata.json              # Azure Trusted Signing configuration
│   └── README.md                  # Signing directory details
├── SIGNING.md                     # Complete signing documentation
├── SIGNING-CHECKLIST.md           # Quick verification checklist
└── SIGNING-SETUP-GUIDE.md         # Full setup and usage guide
```

## 🚀 Quick Start

### 1. Add Your Secret

Edit [.env](.env) and add your Azure client secret:

```bash
AZURE_CLIENT_SECRET=<your-actual-secret-value>
```

### 2. Load Environment Variables

```powershell
cd windows_signing

# Load the environment variables
. .\load-signing-env.ps1
```

### 3. Build with Signing

```powershell
cd ..  # Back to desktop/

$env:SIGN_BINARIES = "1"
.\scripts\build-windows-installer.ps1
```

## 📚 Documentation

- **[SIGNING-SETUP-GUIDE.md](SIGNING-SETUP-GUIDE.md)** - Start here! Complete setup instructions
- **[SIGNING-CHECKLIST.md](SIGNING-CHECKLIST.md)** - Quick verification checklist
- **[SIGNING.md](SIGNING.md)** - Complete documentation with examples
- **[signing/README.md](signing/README.md)** - Signing directory details

## 🔑 Files Reference

| File | Purpose | Status |
|------|---------|--------|
| [.env](.env) | Your Azure credentials | ⚠️ Fill in secret |
| [.env.example](.env.example) | Template (safe to commit) | ✅ Ready |
| [load-signing-env.ps1](load-signing-env.ps1) | Load env vars helper | ✅ Ready |
| [sign-binary.ps1](sign-binary.ps1) | Sign individual binaries | ✅ Ready |
| [signing/metadata.json](signing/metadata.json) | Azure config | ✅ Ready |
| [signing/Azure.CodeSigning.Dlib.dll](signing/Azure.CodeSigning.Dlib.dll) | Microsoft DLL (119KB) | ✅ Downloaded |
| [signing/download-signing-dll.bat](signing/download-signing-dll.bat) | DLL download script | ✅ Ready |

## 🔒 Security Notes

- `.env` is in .gitignore (won't be committed)
- `.env.example` is safe to commit
- DLL is in .gitignore (download with script)
- Secrets are redacted when loading env vars

## 💡 Usage Examples

### Load Environment Variables

```powershell
cd windows_signing
. .\load-signing-env.ps1

# Verify they're loaded
.\load-signing-env.ps1 -Verify
```

### Sign a Single Binary

```powershell
cd windows_signing
.\sign-binary.ps1 -FilePath "..\target\release\jstorrent-host.exe"
```

### Build and Sign Installer

```powershell
# From desktop/ directory
cd ..

# Load env vars
. .\windows_signing\load-signing-env.ps1

# Build with signing
$env:SIGN_BINARIES = "1"
.\scripts\build-windows-installer.ps1
```

### Re-download DLL

```powershell
cd windows_signing\signing
.\download-signing-dll.bat -f
```

## 🛠️ Integration

The build script ([scripts/build-windows-installer.ps1](../scripts/build-windows-installer.ps1)) automatically uses the signing infrastructure in this directory when `SIGN_BINARIES=1` is set.

It will:
1. Sign all three binaries (jstorrent-host, jstorrent-io-daemon, jstorrent-link-handler)
2. Create the Inno Setup installer
3. Sign the installer

## 📖 More Information

See [SIGNING-SETUP-GUIDE.md](SIGNING-SETUP-GUIDE.md) for complete setup instructions, troubleshooting, and CI/CD integration.
