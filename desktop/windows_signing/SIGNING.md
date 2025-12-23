# Windows Code Signing Setup

This document explains how to set up and use Azure Trusted Signing for JSTorrent Windows binaries and installers.

## Overview

The signing infrastructure consists of:
- **[scripts/sign-binary.ps1](scripts/sign-binary.ps1)** - Signs individual binaries using Azure Trusted Signing
- **[scripts/signing/metadata.json](scripts/signing/metadata.json)** - Azure Trusted Signing configuration
- **[scripts/signing/README.md](scripts/signing/README.md)** - Detailed setup instructions
- **[scripts/build-windows-installer.ps1](scripts/build-windows-installer.ps1)** - Modified to support signing during build

## Quick Setup (First Time)

### 1. Download the Signing DLL

You need to download the Microsoft Azure Trusted Signing client DLL once:

```powershell
# From desktop/scripts/signing/ directory
cd scripts\signing

# Download and extract
$url = "https://www.nuget.org/api/v2/package/Microsoft.Trusted.Signing.Client"
$output = "$env:TEMP\signing-client.zip"
Invoke-WebRequest -Uri $url -OutFile $output
Expand-Archive -Path $output -DestinationPath "$env:TEMP\signing-client" -Force

# Copy the x64 DLL
Copy-Item "$env:TEMP\signing-client\bin\x64\Azure.CodeSigning.Dlib.dll" ".\Azure.CodeSigning.Dlib.dll"

Write-Host "DLL downloaded successfully!" -ForegroundColor Green
```

### 2. Set Environment Variables

Set these environment variables with your Azure credentials:

```powershell
$env:AZURE_CLIENT_ID = "<your-client-id>"
$env:AZURE_TENANT_ID = "<your-tenant-id>"
$env:AZURE_CLIENT_SECRET = "<your-secret-value>"
```

**IMPORTANT:** Use the secret **VALUE** (the long random string), not the secret ID. If you don't have the secret value, you'll need to create a new secret in Azure Portal.

### 3. Verify Setup

Test signing with any existing executable:

```powershell
# From desktop/ directory
cd ..\..\
.\scripts\sign-binary.ps1 -FilePath "target\release\jstorrent-host.exe" -Verbose
```

If successful, you'll see:
```
Trusted Signing
Submitting digest for signing...
Signing completed with status 'Succeeded'
Successfully signed: ...
```

## Building and Signing

### Build with Signing Enabled

```powershell
# From desktop/ directory
$env:SIGN_BINARIES = "1"
.\scripts\build-windows-installer.ps1
```

This will:
1. Build all Rust binaries (jstorrent-host, jstorrent-io-daemon, jstorrent-link-handler)
2. Sign each binary
3. Create the Inno Setup installer
4. Sign the installer

### Build WITHOUT Signing

```powershell
# Just omit SIGN_BINARIES or set it to anything other than "1"
.\scripts\build-windows-installer.ps1
```

### Other Build Options

```powershell
# Skip Rust build, just package and sign existing binaries
$env:SKIP_BUILD = "1"
$env:SIGN_BINARIES = "1"
.\scripts\build-windows-installer.ps1

# Use alternate target directory (useful for WSL)
$env:CARGO_TARGET_DIR = "C:\temp\jstorrent-target"
$env:SIGN_BINARIES = "1"
.\scripts\build-windows-installer.ps1
```

## CI/CD Integration

### GitHub Actions Example

```yaml
- name: Set up signing credentials
  env:
    AZURE_CLIENT_ID: ${{ secrets.AZURE_CLIENT_ID }}
    AZURE_TENANT_ID: ${{ secrets.AZURE_TENANT_ID }}
    AZURE_CLIENT_SECRET: ${{ secrets.AZURE_CLIENT_SECRET }}
  run: |
    echo "AZURE_CLIENT_ID=$env:AZURE_CLIENT_ID" >> $env:GITHUB_ENV
    echo "AZURE_TENANT_ID=$env:AZURE_TENANT_ID" >> $env:GITHUB_ENV
    echo "AZURE_CLIENT_SECRET=$env:AZURE_CLIENT_SECRET" >> $env:GITHUB_ENV

- name: Download signing DLL
  working-directory: desktop/scripts/signing
  run: |
    # Download DLL (only needs to be done once per build)
    $url = "https://www.nuget.org/api/v2/package/Microsoft.Trusted.Signing.Client"
    $output = "$env:TEMP\signing-client.zip"
    Invoke-WebRequest -Uri $url -OutFile $output
    Expand-Archive -Path $output -DestinationPath "$env:TEMP\signing-client" -Force
    Copy-Item "$env:TEMP\signing-client\bin\x64\Azure.CodeSigning.Dlib.dll" ".\Azure.CodeSigning.Dlib.dll"

- name: Build and sign installer
  working-directory: desktop
  env:
    SIGN_BINARIES: "1"
  run: .\scripts\build-windows-installer.ps1
```

## Troubleshooting

### "No certificates were found that met all the given criteria"

This means signtool is not invoking Azure Trusted Signing. Check:
- Is `Azure.CodeSigning.Dlib.dll` in the correct location?
- Is it the **x64** version?
- Is signtool version 10.0.22621.0 or newer?

### 403 Forbidden Error

The Azure API is rejecting your credentials. Check:
- Are environment variables set correctly?
- Is the secret VALUE (not ID) being used?
- Does the App Registration have "Trusted Signing Certificate Profile Signer" role?
- Is the `CodeSigningAccountName` in metadata.json correct? (Should be "kylegraehl")

### "Invalid client secret provided"

You're using the secret ID instead of the secret VALUE. Create a new secret in Azure Portal and copy the VALUE this time.

### Endpoint Error / 404

The endpoint URL in metadata.json may be wrong. Check your Azure Portal:
1. Go to your Trusted Signing Account
2. Look for "Account URI" - this is your endpoint
3. Update `scripts/signing/metadata.json` with the correct endpoint

Common endpoints:
- East US: `https://eus.codesigning.azure.net/`
- West US 2: `https://wus2.codesigning.azure.net/`
- North Europe: `https://neu.codesigning.azure.net/`

### .NET Runtime Error

Azure Trusted Signing requires .NET 6.0 or later. Install from:
https://dotnet.microsoft.com/download/dotnet/6.0

## Verifying Signed Binaries

```powershell
# Verify signature
signtool verify /v /pa "path\to\signed.exe"

# View certificate details
signtool verify /v /pa /all "path\to\signed.exe"
```

A valid signature will show:
- **Issued to:** Your organization name (from Azure identity validation)
- **Issued by:** Microsoft Identity Verification Root Certificate Authority
- **Timestamp:** Microsoft's timestamp authority

## Security Notes

1. **Never commit secrets:** The Azure client secret should only be in environment variables or CI/CD secrets, never in git
2. **Rotate secrets:** Azure secrets can be rotated without disrupting the signing process
3. **SmartScreen reputation:** Azure Trusted Signing provides instant SmartScreen reputation (no warning dialogs)
4. **Certificate validity:** Your signing certificate is managed by Microsoft and automatically renewed

## Files Reference

| File | Purpose |
|------|---------|
| [scripts/sign-binary.ps1](scripts/sign-binary.ps1) | Signs a single binary with Azure Trusted Signing |
| [scripts/signing/metadata.json](scripts/signing/metadata.json) | Azure account configuration |
| [scripts/signing/Azure.CodeSigning.Dlib.dll](scripts/signing/Azure.CodeSigning.Dlib.dll) | Microsoft signing client (not in git) |
| [scripts/signing/README.md](scripts/signing/README.md) | Detailed setup instructions |
| [scripts/build-windows-installer.ps1](scripts/build-windows-installer.ps1) | Build script with signing support |

## Additional Resources

- [Azure Trusted Signing Documentation](https://learn.microsoft.com/azure/trusted-signing/)
- [Microsoft Trusted Signing Client NuGet](https://www.nuget.org/packages/Microsoft.Trusted.Signing.Client)
- [Windows SDK Download](https://developer.microsoft.com/windows/downloads/windows-sdk/)
- [Project Setup Guide](../azure-trusted-signing-setup.md)
