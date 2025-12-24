# Download a specific version of Azure.CodeSigning.Dlib.dll
param(
    [Parameter(Mandatory=$false)]
    [string]$Version = "1.0.60"
)

$ErrorActionPreference = "Stop"

Write-Host "Downloading Microsoft.Trusted.Signing.Client version $Version..." -ForegroundColor Cyan

$url = "https://www.nuget.org/api/v2/package/Microsoft.Trusted.Signing.Client/$Version"
$tempZip = "$env:TEMP\signing-client-$Version.zip"
$tempDir = "$env:TEMP\signing-client-$Version"

# Download
Invoke-WebRequest -Uri $url -OutFile $tempZip
Write-Host "Downloaded to $tempZip" -ForegroundColor Green

# Extract
Expand-Archive -Path $tempZip -DestinationPath $tempDir -Force
Write-Host "Extracted to $tempDir" -ForegroundColor Green

# Copy DLL
$dllPath = "$tempDir\bin\x64\Azure.CodeSigning.Dlib.dll"
Copy-Item $dllPath ".\Azure.CodeSigning.Dlib.dll" -Force
Write-Host "Copied DLL to current directory" -ForegroundColor Green

# Show version info
Write-Host "`nDLL Information:" -ForegroundColor Cyan
Get-Item ".\Azure.CodeSigning.Dlib.dll" | Select-Object Name, Length, LastWriteTime | Format-List

Write-Host "Done! DLL version $Version installed." -ForegroundColor Green
