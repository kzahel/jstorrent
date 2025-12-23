# Windows Code Signing Checklist

Use this checklist to verify your signing setup before building signed installers.

## ✅ One-Time Setup

### Azure Configuration
- [ ] Azure Trusted Signing account created (`kylegraehl`)
- [ ] Certificate profile created (`jstorrent-profile`)
- [ ] App Registration created
- [ ] App Registration has "Trusted Signing Certificate Profile Signer" role assigned
- [ ] Client secret created and VALUE saved securely

### Local Setup
- [ ] Windows SDK installed (signtool.exe available)
- [ ] .NET 6.0+ runtime installed
- [ ] Azure.CodeSigning.Dlib.dll downloaded to `desktop/scripts/signing/`
- [ ] Verified DLL is the **x64** version from `bin/x64/` folder

### Configuration Files
- [ ] `desktop/scripts/signing/metadata.json` exists with correct values:
  - [ ] Endpoint URL matches Azure Portal (check Account URI)
  - [ ] CodeSigningAccountName = `kylegraehl`
  - [ ] CertificateProfileName = `jstorrent-profile`

## 🔐 Before Each Build Session

### Environment Variables Set
```powershell
# Check these are set:
$env:AZURE_CLIENT_ID
$env:AZURE_TENANT_ID
$env:AZURE_CLIENT_SECRET
```

- [ ] `AZURE_CLIENT_ID` = `0f2201f6-45dc-4c8a-8aa5-3de10d5b1bfd`
- [ ] `AZURE_TENANT_ID` = `776b33e3-c8b0-469a-9a5d-d7754693229b`
- [ ] `AZURE_CLIENT_SECRET` = **secret VALUE** (not the ID!)

### Test Signing
```powershell
# From desktop/ directory
.\scripts\sign-binary.ps1 -FilePath "target\release\jstorrent-host.exe" -Verbose
```

- [ ] Test signing succeeds
- [ ] See "Signing completed with status 'Succeeded'" message
- [ ] Signature verification passes

## 🏗️ Building Signed Installer

### Build Command
```powershell
# From desktop/ directory
$env:SIGN_BINARIES = "1"
.\scripts\build-windows-installer.ps1
```

### Expected Output
- [ ] "Code signing: ENABLED" message shown
- [ ] All 3 binaries signed (host, io-daemon, link-handler)
- [ ] Installer created
- [ ] Installer signed
- [ ] Final message shows "Status: SIGNED"

### Verify Installer
```powershell
# From desktop/ directory
$installerPath = "installers\windows\Output\jstorrent-system-bridge-install-windows-x86_64.exe"
signtool verify /v /pa $installerPath
```

- [ ] Signature verification succeeds
- [ ] Certificate shows your organization name
- [ ] Timestamp is present (Microsoft timestamp authority)

## 🚀 CI/CD Setup (Optional)

### GitHub Secrets
- [ ] `AZURE_CLIENT_ID` added to repository secrets
- [ ] `AZURE_TENANT_ID` added to repository secrets
- [ ] `AZURE_CLIENT_SECRET` added to repository secrets

### Workflow
- [ ] Workflow downloads Azure.CodeSigning.Dlib.dll
- [ ] Workflow sets SIGN_BINARIES=1
- [ ] Workflow uploads signed installer as artifact

## 📝 Common Issues Reference

| Issue | Solution |
|-------|----------|
| "No certificates found" | Check DLL path and version (must be x64) |
| 403 Forbidden | Verify environment variables and role assignment |
| "Invalid client secret" | Use secret VALUE, not ID |
| Endpoint error | Check Account URI in Azure Portal |
| .NET runtime error | Install .NET 6.0+ |

## 📚 Documentation

- **[SIGNING.md](SIGNING.md)** - Complete signing documentation
- **[scripts/signing/README.md](scripts/signing/README.md)** - Detailed setup guide
- **[azure-trusted-signing-setup.md](../azure-trusted-signing-setup.md)** - Azure configuration reference

---

**Last Updated:** 2025-12-23
