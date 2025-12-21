@echo off
REM Build Windows installer for JSTorrent System Bridge
REM This batch file sets up the environment and calls the PowerShell script

cd /d "%~dp0.."

set CARGO_TARGET_DIR=C:\temp\jstorrent-target

powershell -ExecutionPolicy Bypass -File "%~dp0build-windows-installer.ps1"

if %ERRORLEVEL% neq 0 (
    echo Build failed with error code %ERRORLEVEL%
    pause
    exit /b %ERRORLEVEL%
)

pause
