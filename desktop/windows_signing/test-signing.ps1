# Test Azure Trusted Signing with verbose output

$ErrorActionPreference = "Stop"

# Load environment variables from .env
$envFile = Join-Path $PSScriptRoot ".env"
if (Test-Path $envFile) {
    Write-Host "Loading .env..." -ForegroundColor Cyan
    Get-Content $envFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#")) {
            if ($line -match '^([^=]+)=(.*)$') {
                $key = $matches[1].Trim()
                $value = $matches[2].Trim()
                if ($value) {
                    [Environment]::SetEnvironmentVariable($key, $value)
                    if ($key -eq "AZURE_CLIENT_SECRET") {
                        Write-Host "  $key = ***REDACTED***" -ForegroundColor Green
                    } else {
                        Write-Host "  $key = $value" -ForegroundColor Green
                    }
                }
            }
        }
    }
    Write-Host ""
}

# Check environment variables
Write-Host "Checking environment variables..." -ForegroundColor Cyan
$vars = @("AZURE_CLIENT_ID", "AZURE_TENANT_ID", "AZURE_CLIENT_SECRET")
foreach ($var in $vars) {
    $value = [Environment]::GetEnvironmentVariable($var)
    if ($value) {
        if ($var -eq "AZURE_CLIENT_SECRET") {
            Write-Host "  ✓ $var is set" -ForegroundColor Green
        } else {
            Write-Host "  ✓ $var = $value" -ForegroundColor Green
        }
    } else {
        Write-Host "  ✗ $var is NOT set" -ForegroundColor Red
    }
}
Write-Host ""

# Check metadata.json
$metadataPath = Join-Path $PSScriptRoot "signing\metadata.json"
if (Test-Path $metadataPath) {
    Write-Host "Metadata configuration:" -ForegroundColor Cyan
    Get-Content $metadataPath | Write-Host -ForegroundColor White
    Write-Host ""
}

# Find a test binary
$testBinary = "..\target\release\jstorrent-host.exe"
if (-not (Test-Path $testBinary)) {
    Write-Host "ERROR: Test binary not found: $testBinary" -ForegroundColor Red
    Write-Host "Build the project first: cd .. && .\scripts\build-windows-installer.ps1" -ForegroundColor Yellow
    exit 1
}

Write-Host "Test binary: $testBinary" -ForegroundColor Cyan
Write-Host ""

# Try signing with debug output
Write-Host "Attempting to sign with DEBUG output..." -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
& "$PSScriptRoot\sign-binary.ps1" -FilePath $testBinary -DebugOutput

Write-Host ""
Write-Host "If signing failed, check:" -ForegroundColor Yellow
Write-Host "1. Azure Portal → Trusted Signing Account → Account URI matches metadata.json" -ForegroundColor White
Write-Host "2. Azure Portal → Trusted Signing Account → Access control (IAM) → App has 'Certificate Profile Signer' role" -ForegroundColor White
Write-Host "3. Certificate profile 'jstorrent-profile' exists and is active" -ForegroundColor White
