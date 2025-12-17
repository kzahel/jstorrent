# Build Windows installer for JSTorrent Native Host
$ErrorActionPreference = "Stop"

# Ensure we are in the native-host directory
if (-not (Test-Path "Cargo.toml")) {
    Write-Error "This script must be run from the native-host directory."
    exit 1
}

# Check for Rust/cargo
$cargo = Get-Command cargo -ErrorAction SilentlyContinue
if (-not $cargo) {
    Write-Host "Rust is not installed." -ForegroundColor Red
    Write-Host "Install Rust from: https://rustup.rs" -ForegroundColor Yellow
    exit 1
}

Write-Host "Rust found: $(cargo --version)" -ForegroundColor Green

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

# Build release binaries
Write-Host "`nBuilding release binaries..." -ForegroundColor Cyan
cargo build --release --workspace
if ($LASTEXITCODE -ne 0) {
    Write-Error "Cargo build failed."
    exit 1
}

Write-Host "Build complete." -ForegroundColor Green

# Build installer
Write-Host "`nCompiling installer..." -ForegroundColor Cyan
& $isccPath "installers\windows\jstorrent.iss"
if ($LASTEXITCODE -ne 0) {
    Write-Error "Installer compilation failed."
    exit 1
}

# Output path
$outputPath = Join-Path (Get-Location) "installers\windows\Output\jstorrent-native-host-install-windows-x86_64.exe"
$outputDir = Split-Path $outputPath -Parent
if (Test-Path $outputPath) {
    Write-Host "`n========================================" -ForegroundColor Green
    Write-Host "Installer created successfully!" -ForegroundColor Green
    Write-Host "Folder: $outputDir" -ForegroundColor Cyan
    Write-Host "Output: $outputPath" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Green
} else {
    Write-Error "Installer not found at expected path: $outputPath"
    exit 1
}
