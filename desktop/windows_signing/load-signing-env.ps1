# Load Azure Trusted Signing environment variables from .env file
#
# Usage:
#   . .\load-signing-env.ps1
#   (Note the dot and space before the command - this sources the script)
#
# Or:
#   .\load-signing-env.ps1
#   (This will tell you the variables but won't set them in your session)

param(
    [switch]$Verify
)

$ErrorActionPreference = "Stop"

$envFile = Join-Path $PSScriptRoot ".env"

if (-not (Test-Path $envFile)) {
    Write-Host "ERROR: .env file not found at: $envFile" -ForegroundColor Red
    Write-Host ""
    Write-Host "Copy .env.example to .env and fill in AZURE_CLIENT_SECRET:" -ForegroundColor Yellow
    Write-Host "  cp .env.example .env" -ForegroundColor Cyan
    Write-Host "  # Then edit .env and add your secret value" -ForegroundColor Cyan
    exit 1
}

Write-Host "Loading environment variables from .env..." -ForegroundColor Cyan

# Read and parse .env file
$envVars = @{}
Get-Content $envFile | ForEach-Object {
    $line = $_.Trim()
    # Skip comments and empty lines
    if ($line -and -not $line.StartsWith("#")) {
        if ($line -match '^([^=]+)=(.*)$') {
            $key = $matches[1].Trim()
            $value = $matches[2].Trim()
            $envVars[$key] = $value
        }
    }
}

# Set environment variables
$requiredVars = @("AZURE_CLIENT_ID", "AZURE_TENANT_ID", "AZURE_CLIENT_SECRET")
$allSet = $true

foreach ($var in $requiredVars) {
    if ($envVars.ContainsKey($var) -and $envVars[$var]) {
        [Environment]::SetEnvironmentVariable($var, $envVars[$var])

        # Show value or redact secret
        if ($var -eq "AZURE_CLIENT_SECRET") {
            $displayValue = "***REDACTED***"
        } else {
            $displayValue = $envVars[$var]
        }

        Write-Host "  $var = $displayValue" -ForegroundColor Green
    } else {
        Write-Host "  $var = <NOT SET>" -ForegroundColor Red
        $allSet = $false
    }
}

Write-Host ""

if (-not $allSet) {
    Write-Host "ERROR: Some required environment variables are missing!" -ForegroundColor Red
    Write-Host "Please edit .env and fill in all values, especially AZURE_CLIENT_SECRET" -ForegroundColor Yellow
    exit 1
}

if ($Verify) {
    Write-Host "Verifying environment variables are accessible..." -ForegroundColor Cyan
    foreach ($var in $requiredVars) {
        $value = [Environment]::GetEnvironmentVariable($var)
        if ($value) {
            Write-Host "  ✓ $var is set" -ForegroundColor Green
        } else {
            Write-Host "  ✗ $var is NOT set" -ForegroundColor Red
        }
    }
    Write-Host ""
}

Write-Host "Environment variables loaded successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "You can now build with signing enabled:" -ForegroundColor Yellow
Write-Host "  `$env:SIGN_BINARIES = `"1`"" -ForegroundColor Cyan
Write-Host "  .\scripts\build-windows-installer.ps1" -ForegroundColor Cyan
Write-Host ""
Write-Host "Or test signing a binary:" -ForegroundColor Yellow
Write-Host "  .\scripts\sign-binary.ps1 -FilePath `"target\release\jstorrent-host.exe`"" -ForegroundColor Cyan
