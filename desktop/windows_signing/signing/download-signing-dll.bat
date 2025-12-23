@echo off
REM Download Azure Trusted Signing Client DLL
REM This needs to be run once to set up the signing infrastructure

echo ========================================
echo Azure Trusted Signing DLL Setup
echo ========================================
echo.

REM Check if DLL already exists
if exist "Azure.CodeSigning.Dlib.dll" (
    echo [INFO] Azure.CodeSigning.Dlib.dll already exists.
    if "%1"=="-f" (
        echo [INFO] Force flag detected, re-downloading...
    ) else if "%1"=="--force" (
        echo [INFO] Force flag detected, re-downloading...
    ) else (
        echo [INFO] Use -f or --force to re-download.
        goto :end
    )
)

echo [1/4] Downloading Microsoft.Trusted.Signing.Client from NuGet...
powershell -Command "Invoke-WebRequest -Uri 'https://www.nuget.org/api/v2/package/Microsoft.Trusted.Signing.Client' -OutFile '%TEMP%\signing-client.zip'"
if errorlevel 1 (
    echo [ERROR] Failed to download package.
    exit /b 1
)
echo [OK] Package downloaded.

echo.
echo [2/4] Extracting package...
powershell -Command "Expand-Archive -Path '%TEMP%\signing-client.zip' -DestinationPath '%TEMP%\signing-client' -Force"
if errorlevel 1 (
    echo [ERROR] Failed to extract package.
    exit /b 1
)
echo [OK] Package extracted.

echo.
echo [3/4] Locating x64 DLL...
if not exist "%TEMP%\signing-client\bin\x64\Azure.CodeSigning.Dlib.dll" (
    echo [ERROR] x64 DLL not found in package!
    echo Expected location: %TEMP%\signing-client\bin\x64\Azure.CodeSigning.Dlib.dll
    exit /b 1
)
echo [OK] Found x64 DLL.

echo.
echo [4/4] Copying DLL to signing directory...
copy /Y "%TEMP%\signing-client\bin\x64\Azure.CodeSigning.Dlib.dll" "Azure.CodeSigning.Dlib.dll"
if errorlevel 1 (
    echo [ERROR] Failed to copy DLL.
    exit /b 1
)
echo [OK] DLL copied successfully.

echo.
echo ========================================
echo Setup Complete!
echo ========================================
echo.
echo DLL Location: %CD%\Azure.CodeSigning.Dlib.dll
echo.
echo Next steps:
echo 1. Set environment variables (AZURE_CLIENT_ID, AZURE_TENANT_ID, AZURE_CLIENT_SECRET)
echo 2. Build with signing: set SIGN_BINARIES=1 ^&^& cd ..\..\ ^&^& .\scripts\build-windows-installer.ps1
echo.
echo See README.md for detailed instructions.
echo.

:end
REM Remove 'pause' for automation - add it back if running manually and window closes too fast
