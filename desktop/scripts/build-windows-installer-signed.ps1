# Build Windows installer with code signing enabled
# This is a wrapper that sets SIGN_BINARIES=1 and calls build-windows-installer.ps1

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Building SIGNED Windows Installer" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if we're in the right directory
if (-not (Test-Path "Cargo.toml")) {
    Write-Host "ERROR: This script must be run from the desktop directory." -ForegroundColor Red
    Write-Host "Current directory: $(Get-Location)" -ForegroundColor Red
    exit 1
}

# Auto-load environment variables from .env if not already set
$envFile = Join-Path (Get-Location) "windows_signing\.env"

if (Test-Path $envFile) {
    Write-Host "Loading environment variables from .env..." -ForegroundColor Cyan

    # Read and parse .env file
    Get-Content $envFile | ForEach-Object {
        $line = $_.Trim()
        # Skip comments and empty lines
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
} else {
    Write-Host "WARNING: .env file not found at: $envFile" -ForegroundColor Yellow
    Write-Host "Please create windows_signing\.env with your Azure credentials" -ForegroundColor Yellow
    Write-Host ""
}

# Enable signing and run build
$env:SIGN_BINARIES = "1"

Write-Host "Calling build-windows-installer.ps1 with SIGN_BINARIES=1..." -ForegroundColor Cyan
Write-Host ""

& "$PSScriptRoot\build-windows-installer.ps1"

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Red
    Write-Host "Build FAILED" -ForegroundColor Red
    Write-Host "========================================" -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "Build completed successfully!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
