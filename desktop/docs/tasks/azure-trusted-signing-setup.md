# Azure Trusted Signing - Local Signing Setup Guide

## MY INFO:

app id (client) 0f2201f6-45dc-4c8a-8aa5-3de10d5b1bfd
directory tenant id 776b33e3-c8b0-469a-9a5d-d7754693229b

jstorrent-signing-secret
exp 12/19/2027
secret id: adda34ba-566e-4d55-bf76-f226371127a6
value: <REDACTED>

trusted signing account: kylegraehl
certificate profile name jstorrent-profile



## Context

User has completed Azure Trusted Signing identity validation and has a certificate profile ready. Now needs to set up local signing tools on Windows.

## User Should Have Ready

Ask the user to provide these values (they should have them from Azure portal):

1. **AZURE_CLIENT_ID** - from App Registration
2. **AZURE_TENANT_ID** - from App Registration  
3. **AZURE_CLIENT_SECRET** - the secret VALUE (not ID!) from App Registration
4. **Endpoint URL** - e.g., `https://wus2.codesigning.azure.net/` (from Trusted Signing Account → Account URI)
5. **CodeSigningAccountName** - the name of their Trusted Signing Account (NOT the App Registration name)
6. **CertificateProfileName** - from the certificate profile they created

## Setup Steps

### 1. Check Prerequisites

```powershell
# Check .NET runtime version (need 6.0+)
dotnet --list-runtimes

# Check signtool version (need 10.0.2261.755+)
# Usually located at:
# C:\Program Files (x86)\Windows Kits\10\bin\<version>\x64\signtool.exe
```

If .NET 6.0+ not installed: https://dotnet.microsoft.com/download/dotnet/6.0

If signtool not available or too old: Install Windows SDK or download via Visual Studio Installer → Individual Components → "Windows SDK Signing Tools"

### 2. Download the Signing DLib

Download from NuGet: https://www.nuget.org/packages/Microsoft.Trusted.Signing.Client

```powershell
# Option A: Use nuget CLI
nuget install Microsoft.Trusted.Signing.Client -OutputDirectory C:\tools\signing

# Option B: Manual download
# 1. Download .nupkg from the NuGet page
# 2. Rename .nupkg to .zip
# 3. Extract
# 4. Find Azure.CodeSigning.Dlib.dll in the bin/x64 folder
```

**IMPORTANT:** Use the x64 version of the DLL, located at:
`bin/x64/Azure.CodeSigning.Dlib.dll`

NOT `Azure.CodeSigning.dll` or `Azure.CodeSigning.Dlib.Core.dll`

### 3. Create metadata.json

Create a file (e.g., `C:\tools\signing\metadata.json`):

```json
{
  "Endpoint": "<USER'S ENDPOINT URL>",
  "CodeSigningAccountName": "<USER'S ACCOUNT NAME>",
  "CertificateProfileName": "<USER'S PROFILE NAME>"
}
```

### 4. Set Environment Variables

For the current session:

```powershell
$env:AZURE_CLIENT_ID = "<value>"
$env:AZURE_TENANT_ID = "<value>"
$env:AZURE_CLIENT_SECRET = "<value>"
```

Or in CMD:

```cmd
set AZURE_CLIENT_ID=<value>
set AZURE_TENANT_ID=<value>
set AZURE_CLIENT_SECRET=<value>
```

For persistent setup, add to system environment variables.

### 5. Create Signing Script

Create `sign.ps1`:

```powershell
param(
    [Parameter(Mandatory=$true)]
    [string]$FilePath
)

$signtool = "C:\Program Files (x86)\Windows Kits\10\bin\10.0.22621.0\x64\signtool.exe"
$dlib = "C:\tools\signing\Azure.CodeSigning.Dlib.dll"
$metadata = "C:\tools\signing\metadata.json"

& $signtool sign /v /debug /fd SHA256 /tr "http://timestamp.acs.microsoft.com" /td SHA256 /dlib $dlib /dmdf $metadata $FilePath
```

Adjust paths as needed for the user's setup.

### 6. Test Signing

```powershell
# Sign a test file
.\sign.ps1 -FilePath "C:\path\to\test.exe"

# Verify signature
signtool verify /v /pa "C:\path\to\test.exe"
```

## Expected Success Output

```
Trusted Signing

Version: 1.0.xx

"Metadata": {
  "Endpoint": "https://xxx.codesigning.azure.net/",
  "CodeSigningAccountName": "xxx",
  "CertificateProfileName": "xxx",
  "ExcludeCredentials": []
}

Submitting digest for signing...
OperationId xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx: InProgress
Signing completed with status 'Succeeded' in X.XXs
Successfully signed: C:\path\to\file.exe

Number of files successfully Signed: 1
Number of warnings: 0
Number of errors: 0
```

## Troubleshooting

### "No certificates were found that met all the given criteria"

- Azure call not being invoked
- Check dlib path is exactly to `Azure.CodeSigning.Dlib.dll`
- Check x64 vs x86 alignment (both signtool and dlib must match)
- Check signtool version is recent enough
- Check you're using x64 signtool, not x86

### 403 Forbidden

- Environment variables not set or not visible to signtool
- App Registration doesn't have "Trusted Signing Certificate Profile Signer" role
- Wrong CodeSigningAccountName (should be Trusted Signing Account name, NOT App Registration name)

### "Invalid client secret provided"

- User copied the secret ID instead of the secret VALUE
- Need to create a new secret in Azure and copy the VALUE this time

### Silent failure / crash

- .NET 6.0 runtime not installed
- Using 32-bit signtool (use 64-bit)
- Check Windows Event Viewer for crash details

### Error 0x80070057 "The parameter is incorrect"

- signtool version too new for the Windows version
- Try an older signtool version matching the OS

## File Locations Summary

| Item | Typical Path |
|------|--------------|
| signtool.exe | `C:\Program Files (x86)\Windows Kits\10\bin\<version>\x64\signtool.exe` |
| Azure.CodeSigning.Dlib.dll | User's choice, e.g., `C:\tools\signing\` |
| metadata.json | User's choice, e.g., `C:\tools\signing\` |

## Additional Notes

- The signing makes a network call to Azure - expect 2-5 seconds per file
- Timestamp server `http://timestamp.acs.microsoft.com` is Microsoft's (note: http not https)
- Signed binaries get instant SmartScreen reputation (unlike traditional OV certs)
- Certificate details will show the user's verified name from identity validation
