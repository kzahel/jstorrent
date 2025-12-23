@echo off
REM Install JSTorrent System Bridge locally on Windows
REM Similar to install-local-linux.sh but for Windows

setlocal enabledelayedexpansion

REM Change to system-bridge directory (parent of scripts)
cd /d "%~dp0.."

REM Ensure we are in the system-bridge directory
if not exist "Cargo.toml" (
    echo Error: This script must be run from the system-bridge directory.
    exit /b 1
)

echo Building Windows installer...

REM Set environment variable for cargo target directory (same as build script)
set CARGO_TARGET_DIR=C:\temp\jstorrent-target

REM Call the PowerShell build script directly (avoiding the pause in .bat wrapper)
powershell -ExecutionPolicy Bypass -File "%~dp0build-windows-installer.ps1"

if %ERRORLEVEL% neq 0 (
    echo Build failed with error code %ERRORLEVEL%
    exit /b %ERRORLEVEL%
)

REM Determine installer path (check temp first since WSL/network builds go there)
set INSTALLER_NORMAL=installers\windows\Output\jstorrent-system-bridge-install-windows-x86_64.exe
set INSTALLER_TEMP=%TEMP%\jstorrent-installer-output\jstorrent-system-bridge-install-windows-x86_64.exe
set INSTALLER_PATH=

if exist "%INSTALLER_TEMP%" (
    set INSTALLER_PATH=%INSTALLER_TEMP%
) else if exist "%INSTALLER_NORMAL%" (
    set INSTALLER_PATH=%INSTALLER_NORMAL%
) else (
    echo Error: Installer not found at expected locations:
    echo   - %INSTALLER_TEMP%
    echo   - %INSTALLER_NORMAL%
    exit /b 1
)

echo Installing locally from: %INSTALLER_PATH%

REM Run the installer silently (installer will handle terminating running processes)
echo Running installer...
"%INSTALLER_PATH%" /VERYSILENT /NORESTART

if %ERRORLEVEL% neq 0 (
    echo Installation failed with error code %ERRORLEVEL%
    exit /b %ERRORLEVEL%
)

echo Local installation complete.
