# Build Windows installer for JSTorrent Native Host
#
# Environment variables:
#   SKIP_BUILD=1              - Skip cargo build, use existing binaries
#   CARGO_TARGET_DIR=<path>   - Use alternate target directory (useful for WSL filesystems)
#
# Examples:
#   .\scripts\build-windows-installer.ps1                    # Normal build
#   $env:SKIP_BUILD=1; .\scripts\build-windows-installer.ps1 # Skip build, just create installer
#   $env:CARGO_TARGET_DIR="C:\temp\jstorrent-target"; .\scripts\build-windows-installer.ps1
#
$ErrorActionPreference = "Stop"

# Ensure we are in the native-host directory
if (-not (Test-Path "Cargo.toml")) {
    Write-Error "This script must be run from the native-host directory."
    exit 1
}

$skipBuild = $env:SKIP_BUILD -eq "1"
$targetDir = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { "target" }

Write-Host "Target directory: $targetDir" -ForegroundColor Cyan
if ($skipBuild) {
    Write-Host "SKIP_BUILD=1: Skipping cargo build" -ForegroundColor Yellow
} else {
    # Check for Rust/cargo
    $cargo = Get-Command cargo -ErrorAction SilentlyContinue
    if (-not $cargo) {
        Write-Host "Rust is not installed." -ForegroundColor Red
        Write-Host "Install Rust from: https://rustup.rs" -ForegroundColor Yellow
        exit 1
    }
    Write-Host "Rust found: $(cargo --version)" -ForegroundColor Green
}

# Check for Inno Setup in common locations
$isccPaths = @(
    "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
    "C:\Program Files\Inno Setup 6\ISCC.exe",
    "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe"
)

$isccPath = $null
foreach ($path in $isccPaths) {
    if (Test-Path $path) {
        $isccPath = $path
        break
    }
}

if (-not $isccPath) {
    Write-Host "Inno Setup 6 not found. Attempting to install via winget..." -ForegroundColor Yellow

    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if (-not $winget) {
        Write-Error "winget not available. Please install Inno Setup manually from: https://jrsoftware.org/isdl.php"
        exit 1
    }

    winget install JRSoftware.InnoSetup --silent --accept-package-agreements --accept-source-agreements

    # Re-check all paths after installation
    foreach ($path in $isccPaths) {
        if (Test-Path $path) {
            $isccPath = $path
            break
        }
    }

    if (-not $isccPath) {
        Write-Error "Inno Setup installation failed. Please install manually from: https://jrsoftware.org/isdl.php"
        exit 1
    }

    Write-Host "Inno Setup installed successfully." -ForegroundColor Green
}

Write-Host "Inno Setup found at: $isccPath" -ForegroundColor Green

# Build release binaries (unless skipped)
if (-not $skipBuild) {
    Write-Host "`nBuilding release binaries..." -ForegroundColor Cyan
    cargo build --release --workspace
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Cargo build failed."
        exit 1
    }
    Write-Host "Build complete." -ForegroundColor Green
}

# Verify binaries exist
$requiredBinaries = @(
    "$targetDir\release\jstorrent-host.exe",
    "$targetDir\release\jstorrent-io-daemon.exe",
    "$targetDir\release\jstorrent-link-handler.exe"
)

foreach ($binary in $requiredBinaries) {
    if (-not (Test-Path $binary)) {
        Write-Error "Required binary not found: $binary"
        exit 1
    }
}
Write-Host "All required binaries found." -ForegroundColor Green

# If using custom target dir, copy binaries to expected location for .iss file
if ($targetDir -ne "target") {
    Write-Host "`nCopying binaries from $targetDir to target\release..." -ForegroundColor Cyan
    New-Item -ItemType Directory -Force -Path "target\release" | Out-Null
    Copy-Item "$targetDir\release\jstorrent-host.exe" "target\release\" -Force
    Copy-Item "$targetDir\release\jstorrent-io-daemon.exe" "target\release\" -Force
    Copy-Item "$targetDir\release\jstorrent-link-handler.exe" "target\release\" -Force
    Write-Host "Binaries copied." -ForegroundColor Green
}

# Build installer
Write-Host "`nCompiling installer..." -ForegroundColor Cyan

# If on a network/WSL path, output to a temp directory then copy back
$currentPath = (Get-Location).Path
$useAltOutput = $currentPath -match "^\\\\|^[A-Z]:\\.*wsl" -or $currentPath -match "^Z:\\"
$outputDir = "installers\windows\Output"

if ($useAltOutput) {
    $tempOutputDir = "$env:TEMP\jstorrent-installer-output"
    Write-Host "Using alternate output directory: $tempOutputDir" -ForegroundColor Yellow
    New-Item -ItemType Directory -Force -Path $tempOutputDir | Out-Null
    & $isccPath "/O$tempOutputDir" "installers\windows\jstorrent.iss"
} else {
    & $isccPath "installers\windows\jstorrent.iss"
}

if ($LASTEXITCODE -ne 0) {
    Write-Error "Installer compilation failed."
    exit 1
}

# Copy back if we used alternate output
if ($useAltOutput) {
    Write-Host "Copying installer to project directory..." -ForegroundColor Cyan
    try {
        New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
        Copy-Item "$tempOutputDir\*.exe" $outputDir -Force
        Write-Host "Installer copied to $outputDir" -ForegroundColor Green
    } catch {
        Write-Host "Could not copy to project directory (WSL filesystem permission issue)" -ForegroundColor Yellow
        Write-Host "Installer is available at: $tempOutputDir" -ForegroundColor Cyan
        $outputDir = $tempOutputDir
    }
}

# Output path - check temp dir first if we used it, otherwise project dir
$installerName = "jstorrent-native-host-install-windows-x86_64.exe"
if ($useAltOutput) {
    $outputPath = Join-Path $tempOutputDir $installerName
} else {
    $outputPath = Join-Path (Get-Location) "installers\windows\Output\$installerName"
}

if (Test-Path $outputPath) {
    $finalOutputDir = Split-Path $outputPath -Parent
    Write-Host "`n========================================" -ForegroundColor Green
    Write-Host "Installer created successfully!" -ForegroundColor Green
    Write-Host "Folder: $finalOutputDir" -ForegroundColor Cyan
    Write-Host "Output: $outputPath" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Green
} else {
    Write-Error "Installer not found at expected path: $outputPath"
    exit 1
}
