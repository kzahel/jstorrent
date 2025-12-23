# Azure Trusted Signing Setup

This directory contains the configuration for Azure Trusted Signing.

## Required Files

### metadata.json ✅ (Already configured)

Contains your Azure Trusted Signing configuration:
- Endpoint: Your Azure region endpoint
- CodeSigningAccountName: `kylegraehl`
- CertificateProfileName: `jstorrent-profile`

**Note:** If you get 403 errors when signing, verify the endpoint URL in your Azure portal under Trusted Signing Account → Account URI.

### Azure.CodeSigning.Dlib.dll ⚠️ (You need to download this)

This is the Microsoft signing DLL required for Azure Trusted Signing.

#### How to Download:

1. Visit: https://www.nuget.org/packages/Microsoft.Trusted.Signing.Client
2. Click "Download package" on the right side
3. Rename the downloaded `.nupkg` file to `.zip`
4. Extract the ZIP file
5. Navigate to: `bin/x64/Azure.CodeSigning.Dlib.dll`
6. Copy that DLL to this directory

**IMPORTANT:**
- Use the **x64** version from `bin/x64/` folder
- Do NOT use `Azure.CodeSigning.dll` or `Azure.CodeSigning.Dlib.Core.dll`
- The DLL must be exactly named `Azure.CodeSigning.Dlib.dll`

#### Quick PowerShell Download (Alternative):

```powershell
# Download and extract
$url = "https://www.nuget.org/api/v2/package/Microsoft.Trusted.Signing.Client"
$output = "$env:TEMP\signing-client.zip"
Invoke-WebRequest -Uri $url -OutFile $output
Expand-Archive -Path $output -DestinationPath "$env:TEMP\signing-client" -Force

# Copy the x64 DLL
Copy-Item "$env:TEMP\signing-client\bin\x64\Azure.CodeSigning.Dlib.dll" ".\Azure.CodeSigning.Dlib.dll"

Write-Host "DLL downloaded successfully!" -ForegroundColor Green
```

## Environment Variables

Before signing, set these environment variables:

```powershell
# PowerShell
$env:AZURE_CLIENT_ID = "0f2201f6-45dc-4c8a-8aa5-3de10d5b1bfd"
$env:AZURE_TENANT_ID = "776b33e3-c8b0-469a-9a5d-d7754693229b"
$env:AZURE_CLIENT_SECRET = "<your-secret-value>"
```

```cmd
# CMD
set AZURE_CLIENT_ID=0f2201f6-45dc-4c8a-8aa5-3de10d5b1bfd
set AZURE_TENANT_ID=776b33e3-c8b0-469a-9a5d-d7754693229b
set AZURE_CLIENT_SECRET=<your-secret-value>
```

**CRITICAL:** Use the secret **VALUE**, not the secret ID. The secret value was shown only once when you created it. If you lost it, you'll need to create a new secret in Azure Portal → App Registration → Certificates & secrets.

## Testing

After downloading the DLL and setting environment variables, test signing:

```powershell
# From desktop/ directory
.\scripts\sign-binary.ps1 -FilePath "path\to\test.exe" -Verbose
```

## Verification

To verify a signed file:

```powershell
signtool verify /v /pa "path\to\signed.exe"
```

A successfully signed binary will show your organization name in the signature details.
