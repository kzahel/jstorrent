# Sign a binary using Azure Trusted Signing
#
# Prerequisites:
# - Environment variables must be set: AZURE_CLIENT_ID, AZURE_TENANT_ID, AZURE_CLIENT_SECRET
# - signtool.exe must be available (Windows SDK)
# - Azure.CodeSigning.Dlib.dll must be downloaded
# - metadata.json must exist with Azure configuration
#
# Usage:
#   .\sign-binary.ps1 -FilePath "path\to\file.exe"
#   .\sign-binary.ps1 -FilePath "path\to\file.exe" -Verbose

param(
    [Parameter(Mandatory=$true)]
    [string]$FilePath,

    [Parameter(Mandatory=$false)]
    [switch]$Verbose
)

$ErrorActionPreference = "Stop"

# Resolve to absolute path
$FilePath = Resolve-Path $FilePath -ErrorAction Stop

Write-Host "Signing: $FilePath" -ForegroundColor Cyan

# Check environment variables
$requiredEnvVars = @("AZURE_CLIENT_ID", "AZURE_TENANT_ID", "AZURE_CLIENT_SECRET")
foreach ($var in $requiredEnvVars) {
    if (-not (Test-Path "env:$var")) {
        Write-Error "Environment variable $var is not set. Please set it before running this script."
        exit 1
    }
}

# Configuration - these paths can be customized
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$signingDir = Join-Path $scriptDir "signing"
$metadataPath = Join-Path $signingDir "metadata.json"
$dlibPath = Join-Path $signingDir "Azure.CodeSigning.Dlib.dll"

# Check if metadata and DLL exist
if (-not (Test-Path $metadataPath)) {
    Write-Error "Metadata file not found at: $metadataPath"
    Write-Host "Please create it with your Azure Trusted Signing configuration." -ForegroundColor Yellow
    exit 1
}

if (-not (Test-Path $dlibPath)) {
    Write-Error "Azure.CodeSigning.Dlib.dll not found at: $dlibPath"
    Write-Host "Download from: https://www.nuget.org/packages/Microsoft.Trusted.Signing.Client" -ForegroundColor Yellow
    Write-Host "Extract and copy the x64 version to: $dlibPath" -ForegroundColor Yellow
    exit 1
}

# Find signtool.exe
$signtoolPaths = @(
    "C:\Program Files (x86)\Windows Kits\10\bin\10.0.22621.0\x64\signtool.exe",
    "C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\signtool.exe",
    "C:\Program Files (x86)\Windows Kits\10\App Certification Kit\signtool.exe"
)

# Also search in Windows SDK directories
$windowsKitsPath = "C:\Program Files (x86)\Windows Kits\10\bin"
if (Test-Path $windowsKitsPath) {
    $versions = Get-ChildItem $windowsKitsPath -Directory | Sort-Object Name -Descending
    foreach ($version in $versions) {
        $signtoolPaths += Join-Path $version.FullName "x64\signtool.exe"
    }
}

$signtoolPath = $null
foreach ($path in $signtoolPaths) {
    if (Test-Path $path) {
        $signtoolPath = $path
        break
    }
}

if (-not $signtoolPath) {
    Write-Error "signtool.exe not found. Please install Windows SDK."
    Write-Host "Download from: https://developer.microsoft.com/windows/downloads/windows-sdk/" -ForegroundColor Yellow
    exit 1
}

Write-Host "Using signtool: $signtoolPath" -ForegroundColor Green

# Build signing command
$signtoolArgs = @(
    "sign",
    "/v",
    "/fd", "SHA256",
    "/tr", "http://timestamp.acs.microsoft.com",
    "/td", "SHA256",
    "/dlib", $dlibPath,
    "/dmdf", $metadataPath,
    $FilePath
)

if ($Verbose) {
    $signtoolArgs = @("/debug") + $signtoolArgs
}

# Execute signing
Write-Host "Running Azure Trusted Signing..." -ForegroundColor Cyan
& $signtoolPath @signtoolArgs

if ($LASTEXITCODE -ne 0) {
    Write-Error "Signing failed with exit code: $LASTEXITCODE"
    exit $LASTEXITCODE
}

Write-Host "Successfully signed: $FilePath" -ForegroundColor Green

# Verify signature
Write-Host "`nVerifying signature..." -ForegroundColor Cyan
& $signtoolPath verify /v /pa $FilePath

if ($LASTEXITCODE -eq 0) {
    Write-Host "Signature verified successfully!" -ForegroundColor Green
} else {
    Write-Warning "Signature verification returned exit code: $LASTEXITCODE"
}
