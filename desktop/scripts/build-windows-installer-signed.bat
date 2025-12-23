@echo off
REM Build Windows installer with code signing enabled
REM This is a wrapper that sets SIGN_BINARIES=1 and calls build-windows-installer.ps1

echo ========================================
echo Building SIGNED Windows Installer
echo ========================================
echo.

REM Check if we're in the right directory
if not exist "Cargo.toml" (
    echo ERROR: This script must be run from the desktop directory.
    echo Current directory: %CD%
    exit /b 1
)

REM Auto-load environment variables from .env file
if exist "windows_signing\.env" (
    echo Loading environment variables from .env...
    for /f "usebackq eol=# tokens=1,* delims==" %%a in ("windows_signing\.env") do (
        REM Only process lines that have both key and value
        if not "%%a"=="" if not "%%b"=="" (
            set "%%a=%%b"
            REM Don't print the secret value
            if "%%a"=="AZURE_CLIENT_SECRET" (
                echo   %%a = ***REDACTED***
            ) else (
                echo   %%a = %%b
            )
        )
    )
    echo.
) else (
    echo WARNING: .env file not found at windows_signing\.env
    echo Please create it with your Azure credentials
    echo.
)

REM Enable signing and run build
set SIGN_BINARIES=1
powershell -ExecutionPolicy Bypass -File ".\scripts\build-windows-installer.ps1"

if errorlevel 1 (
    echo.
    echo ========================================
    echo Build FAILED
    echo ========================================
    exit /b 1
)

echo.
echo ========================================
echo Build completed successfully!
echo ========================================
