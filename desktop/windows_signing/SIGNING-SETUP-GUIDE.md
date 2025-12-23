# Windows Code Signing Setup Guide
## Complete Setup and Usage Instructions

**Created:** 2025-12-23
**Status:** ✅ Infrastructure ready, awaiting environment variables

---

## 📋 Table of Contents

1. [What Was Created](#what-was-created)
2. [Current Status](#current-status)
3. [Next Steps](#next-steps)
4. [Usage Instructions](#usage-instructions)
5. [Testing the Setup](#testing-the-setup)
6. [Troubleshooting](#troubleshooting)
7. [File Reference](#file-reference)

---

## What Was Created

### 1. Signing Infrastructure

A complete Azure Trusted Signing integration was set up for the JSTorrent Windows installer build process.

#### New Files Created

| File | Purpose | Status |
|------|---------|--------|
| [scripts/sign-binary.ps1](scripts/sign-binary.ps1) | PowerShell script to sign individual binaries | ✅ Created |
| [scripts/signing/metadata.json](scripts/signing/metadata.json) | Azure Trusted Signing configuration | ✅ Created |
| [scripts/signing/download-signing-dll.bat](scripts/signing/download-signing-dll.bat) | One-time DLL download script | ✅ Created & Run |
| [scripts/signing/Azure.CodeSigning.Dlib.dll](scripts/signing/Azure.CodeSigning.Dlib.dll) | Microsoft signing client library (119KB) | ✅ Downloaded |
| [scripts/signing/.gitignore](scripts/signing/.gitignore) | Prevents committing DLL and secrets | ✅ Created |
| [scripts/signing/README.md](scripts/signing/README.md) | Detailed setup instructions | ✅ Created |
| [SIGNING.md](SIGNING.md) | Complete signing documentation | ✅ Created |
| [SIGNING-CHECKLIST.md](SIGNING-CHECKLIST.md) | Quick verification checklist | ✅ Created |
| [SIGNING-SETUP-GUIDE.md](SIGNING-SETUP-GUIDE.md) | This file | ✅ Created |

#### Modified Files

| File | Changes | Status |
|------|---------|--------|
| [scripts/build-windows-installer.ps1](scripts/build-windows-installer.ps1) | Added signing support via SIGN_BINARIES=1 | ✅ Modified |

### 2. Azure Configuration

Your Azure Trusted Signing is configured with:

```json
{
  "Endpoint": "https://wus2.codesigning.azure.net/",
  "CodeSigningAccountName": "kylegraehl",
  "CertificateProfileName": "jstorrent-profile"
}
```

**Azure Credentials (from [azure-trusted-signing-setup.md](../azure-trusted-signing-setup.md)):**
- **Client ID:** `<your-client-id>`
- **Tenant ID:** `<your-tenant-id>`
- **Secret ID:** `adda34ba-566e-4d55-bf76-f226371127a6` (expires 12/19/2027)
- **Secret Value:** `<REDACTED>` - You need this for signing

### 3. Build Process Integration

The Windows installer build script now supports signing:

**New Environment Variable:** `SIGN_BINARIES=1`

When enabled, the build process will:
1. Build Rust binaries (jstorrent-host, jstorrent-io-daemon, jstorrent-link-handler)
2. **Sign each binary** with Azure Trusted Signing
3. Package into Inno Setup installer
4. **Sign the installer** with Azure Trusted Signing

---

## Current Status

### ✅ Completed

- [x] Signing infrastructure created
- [x] Helper scripts written
- [x] Build script modified to support signing
- [x] Azure.CodeSigning.Dlib.dll downloaded (119KB)
- [x] Configuration files created
- [x] Documentation written

### ⏳ Remaining (You Need To Do)

- [ ] Set environment variables with Azure credentials
- [ ] Test signing with a sample binary
- [ ] Run a full build with signing enabled
- [ ] Verify signed installer works correctly
- [ ] (Optional) Set up CI/CD with signing

---

## Next Steps

### Step 1: Set Environment Variables

You need to set three environment variables before signing will work.

#### Option A: For Current PowerShell Session

```powershell
# Open PowerShell and run:
$env:AZURE_CLIENT_ID = "<your-client-id>"
$env:AZURE_TENANT_ID = "<your-tenant-id>"
$env:AZURE_CLIENT_SECRET = "<YOUR_SECRET_VALUE>"
```

**CRITICAL:** You need the secret **VALUE** (the long random string), NOT the secret ID (`adda34ba-566e-4d55-bf76-f226371127a6`).

If you don't have the secret value:
1. Go to Azure Portal → App Registration → Certificates & secrets
2. Create a new client secret
3. **Copy the VALUE immediately** (it's only shown once!)
4. Update your records with the new secret

#### Option B: Set Permanently (Windows)

```powershell
# Open PowerShell as Administrator
[System.Environment]::SetEnvironmentVariable('AZURE_CLIENT_ID', '<your-client-id>', 'User')
[System.Environment]::SetEnvironmentVariable('AZURE_TENANT_ID', '<your-tenant-id>', 'User')
[System.Environment]::SetEnvironmentVariable('AZURE_CLIENT_SECRET', '<YOUR_SECRET_VALUE>', 'User')

# Restart your terminal for changes to take effect
```

#### Option C: Using .env File (Alternative)

Create a file `desktop/.env` (never commit this!):

```bash
AZURE_CLIENT_ID=<your-client-id>
AZURE_TENANT_ID=<your-tenant-id>
AZURE_CLIENT_SECRET=<YOUR_SECRET_VALUE>
```

Then load before building:
```powershell
Get-Content .env | ForEach-Object {
    if ($_ -match '^([^=]+)=(.*)$') {
        [Environment]::SetEnvironmentVariable($matches[1], $matches[2])
    }
}
```

### Step 2: Verify Environment Variables

```powershell
# Check they're set correctly
echo $env:AZURE_CLIENT_ID
echo $env:AZURE_TENANT_ID
echo $env:AZURE_CLIENT_SECRET
```

All three should output values (not blank).

### Step 3: Verify Prerequisites

```powershell
# Check .NET runtime (need 6.0+)
dotnet --list-runtimes

# Check signtool exists
where.exe signtool
# Or manually check:
# C:\Program Files (x86)\Windows Kits\10\bin\<version>\x64\signtool.exe
```

**If .NET 6.0+ not installed:**
Download from: https://dotnet.microsoft.com/download/dotnet/6.0

**If signtool not found:**
Install Windows SDK: https://developer.microsoft.com/windows/downloads/windows-sdk/

### Step 4: Test Signing (Recommended)

Before building everything, test signing with an existing binary:

```powershell
cd desktop

# If you have a test binary in target/release/
.\scripts\sign-binary.ps1 -FilePath "target\release\jstorrent-host.exe" -Verbose
```

**Expected output:**
```
Signing: Z:\home\kyle\code\jstorrent\desktop\target\release\jstorrent-host.exe
Using signtool: C:\Program Files (x86)\Windows Kits\10\bin\10.0.22621.0\x64\signtool.exe
Running Azure Trusted Signing...
Trusted Signing

Version: 1.0.xx

Submitting digest for signing...
OperationId xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx: InProgress
Signing completed with status 'Succeeded' in X.XXs
Successfully signed: Z:\home\kyle\code\jstorrent\desktop\target\release\jstorrent-host.exe

Number of files successfully Signed: 1
Successfully signed: ...
```

If successful, continue to Step 5. If errors, see [Troubleshooting](#troubleshooting) section.

---

## Usage Instructions

### Building with Signing

Once environment variables are set and tested:

```powershell
cd desktop

# Set signing flag
$env:SIGN_BINARIES = "1"

# Build and sign
.\scripts\build-windows-installer.ps1
```

This will:
1. Build all Rust binaries in release mode
2. Sign each of the 3 binaries
3. Create the Inno Setup installer
4. Sign the installer
5. Output to `installers\windows\Output\jstorrent-system-bridge-install-windows-x86_64.exe`

**Expected output includes:**
```
Code signing: ENABLED
...
Signing binaries...
  Signing: target\release\jstorrent-host.exe
  Signing: target\release\jstorrent-io-daemon.exe
  Signing: target\release\jstorrent-link-handler.exe
All binaries signed successfully.
...
Signing installer...
Installer signed successfully.
...
Status: SIGNED
```

### Building WITHOUT Signing

```powershell
cd desktop

# Just don't set SIGN_BINARIES (or set it to anything other than "1")
.\scripts\build-windows-installer.ps1
```

Output will show:
```
Code signing: DISABLED (set SIGN_BINARIES=1 to enable)
...
Status: UNSIGNED (set SIGN_BINARIES=1 to sign)
```

### Other Build Options

```powershell
# Skip Rust build, just package existing binaries and sign
$env:SKIP_BUILD = "1"
$env:SIGN_BINARIES = "1"
.\scripts\build-windows-installer.ps1

# Use alternate target directory (useful for WSL)
$env:CARGO_TARGET_DIR = "C:\temp\jstorrent-target"
$env:SIGN_BINARIES = "1"
.\scripts\build-windows-installer.ps1
```

---

## Testing the Setup

### Verify Signed Installer

After building with signing:

```powershell
cd desktop

# Path to signed installer
$installer = "installers\windows\Output\jstorrent-system-bridge-install-windows-x86_64.exe"

# Verify signature
signtool verify /v /pa $installer

# View certificate details
signtool verify /v /pa /all $installer
```

**Expected output:**
```
Verifying: jstorrent-system-bridge-install-windows-x86_64.exe

Signature Index: 0 (Primary Signature)
Hash of file (sha256): ...

Signing Certificate Chain:
    Issued to: Kyle Graehl (or your verified name)
    Issued by: Microsoft Identity Verification Root Certificate Authority
    Expires: ...
    SHA256 hash: ...

The signature is timestamped: [timestamp]
Timestamp Verified by:
    Issued to: Microsoft Time Stamping PCA 2010

Successfully verified: jstorrent-system-bridge-install-windows-x86_64.exe
```

### Test Installation

1. Right-click the installer → Properties → Digital Signatures tab
2. Should show your organization name
3. Should show "This digital signature is OK"
4. Run the installer - should have NO SmartScreen warnings

### Test Individual Binaries

```powershell
# Verify each binary was signed
signtool verify /pa target\release\jstorrent-host.exe
signtool verify /pa target\release\jstorrent-io-daemon.exe
signtool verify /pa target\release\jstorrent-link-handler.exe
```

All should show "Successfully verified".

---

## Troubleshooting

### "No certificates were found that met all the given criteria"

**Cause:** signtool is not invoking Azure Trusted Signing properly.

**Solutions:**
1. Verify DLL is exactly at: `desktop\scripts\signing\Azure.CodeSigning.Dlib.dll`
2. Verify it's the **x64** version (should be 119KB)
3. Re-download if needed: `cd scripts\signing && .\download-signing-dll.bat -f`
4. Check signtool version is 10.0.22621.0 or newer
5. Ensure using x64 signtool, not x86

### 403 Forbidden Error

**Cause:** Azure is rejecting your credentials.

**Solutions:**
1. Verify environment variables are set: `echo $env:AZURE_CLIENT_ID`
2. Ensure you're using the secret **VALUE**, not the secret ID
3. Check App Registration has "Trusted Signing Certificate Profile Signer" role:
   - Azure Portal → Trusted Signing Account → Access control (IAM)
   - Should see your App Registration with the role
4. Verify `CodeSigningAccountName` in metadata.json is exactly `kylegraehl`

### "Invalid client secret provided"

**Cause:** Using the secret ID instead of the secret VALUE.

**Solution:**
1. Go to Azure Portal → App Registration → Certificates & secrets
2. Create a **new** client secret
3. Copy the **VALUE** (long random string) immediately
4. Set `$env:AZURE_CLIENT_SECRET` to this VALUE
5. Update your records

### Endpoint Error / 404

**Cause:** Wrong endpoint URL in metadata.json.

**Solution:**
1. Azure Portal → Trusted Signing Account → Overview
2. Look for "Account URI" - this is your endpoint
3. Update `scripts\signing\metadata.json` with correct endpoint

Common endpoints:
- West US 2: `https://wus2.codesigning.azure.net/`
- East US: `https://eus.codesigning.azure.net/`
- North Europe: `https://neu.codesigning.azure.net/`

### .NET Runtime Error

**Cause:** .NET 6.0+ not installed.

**Solution:**
Install from: https://dotnet.microsoft.com/download/dotnet/6.0

### Signing Takes Forever / Hangs

**Cause:** Network issues or Azure service delay.

**Solutions:**
1. Check internet connection
2. Retry after a few minutes
3. Check Azure Service Health: https://status.azure.com/
4. Signing typically takes 2-5 seconds per file

### "Signing script not found"

**Cause:** Running build script from wrong directory.

**Solution:**
```powershell
# Must run from desktop/ directory
cd z:\home\kyle\code\jstorrent\desktop
.\scripts\build-windows-installer.ps1
```

---

## File Reference

### Core Signing Files

#### [scripts/sign-binary.ps1](scripts/sign-binary.ps1)
PowerShell script that signs a single binary using Azure Trusted Signing.

**Usage:**
```powershell
.\scripts\sign-binary.ps1 -FilePath "path\to\file.exe"
.\scripts\sign-binary.ps1 -FilePath "path\to\file.exe" -Verbose
```

**Requirements:**
- Environment variables must be set
- Azure.CodeSigning.Dlib.dll must exist
- metadata.json must exist
- signtool.exe must be available

#### [scripts/signing/metadata.json](scripts/signing/metadata.json)
Azure Trusted Signing configuration.

```json
{
  "Endpoint": "https://wus2.codesigning.azure.net/",
  "CodeSigningAccountName": "kylegraehl",
  "CertificateProfileName": "jstorrent-profile"
}
```

**Note:** If you get 403 errors, verify the endpoint URL matches your Azure Portal "Account URI".

#### [scripts/signing/download-signing-dll.bat](scripts/signing/download-signing-dll.bat)
Batch script to download the Microsoft signing DLL.

**Usage:**
```cmd
cd scripts\signing
download-signing-dll.bat         # Download if not exists
download-signing-dll.bat -f      # Force re-download
```

**What it does:**
1. Downloads Microsoft.Trusted.Signing.Client from NuGet
2. Extracts to temp directory
3. Copies x64 DLL to current directory
4. Cleans up temp files

#### [scripts/signing/Azure.CodeSigning.Dlib.dll](scripts/signing/Azure.CodeSigning.Dlib.dll)
Microsoft's Azure Trusted Signing client library (119KB).

**Status:** ✅ Already downloaded
**Note:** This file is in .gitignore and should not be committed.

To re-download: `.\download-signing-dll.bat -f`

### Build Scripts

#### [scripts/build-windows-installer.ps1](scripts/build-windows-installer.ps1)
Main build script for Windows installer.

**New Features:**
- Detects `SIGN_BINARIES=1` environment variable
- Signs all binaries before packaging
- Signs installer after creation
- Shows signing status in output

**Usage:**
```powershell
# Build and sign
$env:SIGN_BINARIES = "1"
.\scripts\build-windows-installer.ps1

# Build without signing
.\scripts\build-windows-installer.ps1

# Skip Rust build, sign existing binaries
$env:SKIP_BUILD = "1"
$env:SIGN_BINARIES = "1"
.\scripts\build-windows-installer.ps1
```

### Documentation Files

| File | Purpose |
|------|---------|
| [SIGNING.md](SIGNING.md) | Complete signing documentation with examples |
| [SIGNING-CHECKLIST.md](SIGNING-CHECKLIST.md) | Quick verification checklist |
| [SIGNING-SETUP-GUIDE.md](SIGNING-SETUP-GUIDE.md) | This file - complete setup guide |
| [scripts/signing/README.md](scripts/signing/README.md) | Detailed signing directory setup |
| [../azure-trusted-signing-setup.md](../azure-trusted-signing-setup.md) | Original Azure configuration notes |

---

## Quick Start Summary

For when you come back to this later:

```powershell
# 1. Set environment variables (if not already set)
$env:AZURE_CLIENT_ID = "<your-client-id>"
$env:AZURE_TENANT_ID = "<your-tenant-id>"
$env:AZURE_CLIENT_SECRET = "<YOUR_SECRET_VALUE>"

# 2. Navigate to desktop directory
cd z:\home\kyle\code\jstorrent\desktop

# 3. Build and sign
$env:SIGN_BINARIES = "1"
.\scripts\build-windows-installer.ps1

# 4. Verify signature
signtool verify /pa installers\windows\Output\jstorrent-system-bridge-install-windows-x86_64.exe
```

---

## CI/CD Integration (Future)

When you're ready to set up automated builds with signing:

### GitHub Actions

Add these secrets to your repository:
- `AZURE_CLIENT_ID`
- `AZURE_TENANT_ID`
- `AZURE_CLIENT_SECRET`

Example workflow snippet:
```yaml
- name: Download signing DLL
  working-directory: desktop/scripts/signing
  run: .\download-signing-dll.bat

- name: Build and sign installer
  working-directory: desktop
  env:
    SIGN_BINARIES: "1"
    AZURE_CLIENT_ID: ${{ secrets.AZURE_CLIENT_ID }}
    AZURE_TENANT_ID: ${{ secrets.AZURE_TENANT_ID }}
    AZURE_CLIENT_SECRET: ${{ secrets.AZURE_CLIENT_SECRET }}
  run: .\scripts\build-windows-installer.ps1
```

---

## Security Notes

1. **Never commit secrets:** Azure client secret should only be in environment variables or CI/CD secrets
2. **Never commit the DLL:** It's in .gitignore for a reason (large binary file)
3. **Rotate secrets regularly:** Azure secrets can be rotated without disrupting signing
4. **Use least privilege:** The App Registration only needs "Trusted Signing Certificate Profile Signer" role
5. **Monitor signing activity:** Check Azure Portal for signing usage and any anomalies

---

## Support Resources

- **Azure Trusted Signing Docs:** https://learn.microsoft.com/azure/trusted-signing/
- **NuGet Package:** https://www.nuget.org/packages/Microsoft.Trusted.Signing.Client
- **Windows SDK:** https://developer.microsoft.com/windows/downloads/windows-sdk/
- **.NET Runtime:** https://dotnet.microsoft.com/download/dotnet/6.0

---

## Changelog

**2025-12-23 - Initial Setup**
- Created signing infrastructure
- Downloaded Azure.CodeSigning.Dlib.dll
- Configured metadata.json with Azure account details
- Modified build script to support SIGN_BINARIES=1
- Created documentation

---

**Last Updated:** 2025-12-23
**Next Review:** After first successful signed build
