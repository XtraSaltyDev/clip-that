$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

Set-Location (Join-Path $PSScriptRoot '..')

if ((node -p "process.platform").Trim() -ne 'win32') {
    throw 'The production Windows package must be built on Windows so npm installs the Windows FFmpeg binary.'
}

$ffmpegPath = (node -p "require('@ffmpeg-installer/ffmpeg').path").Trim()
if (-not (Test-Path $ffmpegPath) -or [IO.Path]::GetExtension($ffmpegPath) -ne '.exe') {
    throw "The Windows FFmpeg executable is missing: $ffmpegPath"
}

$version = (node -p "require('./package.json').version").Trim()
$azureFields = @(
    'WINDOWS_SIGNING_PUBLISHER',
    'WINDOWS_SIGNING_ENDPOINT',
    'WINDOWS_SIGNING_ACCOUNT',
    'WINDOWS_SIGNING_PROFILE'
)
function Test-EnvValue([string]$name) {
    return -not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))
}

$hasAzureMetadata = ($azureFields | Where-Object { -not (Test-EnvValue $_) }).Count -eq 0
$hasAzureIdentity = (Test-EnvValue 'AZURE_TENANT_ID') -and
    (Test-EnvValue 'AZURE_CLIENT_ID') -and
    (Test-EnvValue 'AZURE_CLIENT_SECRET')
$hasClassicCertificate = (Test-EnvValue 'WIN_CSC_LINK') -and
    (Test-EnvValue 'WIN_CSC_KEY_PASSWORD')

if (-not (($hasAzureMetadata -and $hasAzureIdentity) -or $hasClassicCertificate)) {
    throw @'
No production Windows signing credential is configured.

Use either:
  - Azure Artifact Signing: WINDOWS_SIGNING_PUBLISHER, WINDOWS_SIGNING_ENDPOINT,
    WINDOWS_SIGNING_ACCOUNT, WINDOWS_SIGNING_PROFILE, AZURE_TENANT_ID,
    AZURE_CLIENT_ID, and AZURE_CLIENT_SECRET
  - An OV/EV certificate: WIN_CSC_LINK and WIN_CSC_KEY_PASSWORD

This command intentionally refuses to create an unsigned release.
'@
}

npm run build
if ($LASTEXITCODE -ne 0) { throw "npm run build failed with exit code $LASTEXITCODE" }

$builderArgs = @('electron-builder', '--win', '--x64', '--publish', 'never', '-c.forceCodeSigning=true')
if ($hasAzureMetadata -and $hasAzureIdentity) {
    $builderArgs += @(
        "-c.win.azureSignOptions.publisherName=$env:WINDOWS_SIGNING_PUBLISHER",
        "-c.win.azureSignOptions.endpoint=$env:WINDOWS_SIGNING_ENDPOINT",
        "-c.win.azureSignOptions.codeSigningAccountName=$env:WINDOWS_SIGNING_ACCOUNT",
        "-c.win.azureSignOptions.certificateProfileName=$env:WINDOWS_SIGNING_PROFILE"
    )
}

& npx @builderArgs
if ($LASTEXITCODE -ne 0) { throw "electron-builder failed with exit code $LASTEXITCODE" }

$artifacts = @(
    "dist/ClipThat-$version-x64-setup.exe",
    "dist/ClipThat-$version-x64-portable.exe",
    "dist/ClipThat-$version-x64.zip"
)
foreach ($artifact in $artifacts | Where-Object { [IO.Path]::GetExtension($_) -eq '.exe' }) {
    if (-not (Test-Path $artifact)) { throw "Missing Windows release artifact: $artifact" }
    $signature = Get-AuthenticodeSignature $artifact
    if ($signature.Status -ne 'Valid') {
        throw "$artifact has Authenticode status $($signature.Status), not Valid"
    }
    if ($null -eq $signature.TimeStamperCertificate) {
        throw "$artifact is signed but has no trusted timestamp"
    }
}

$zipArtifact = "dist/ClipThat-$version-x64.zip"
if (-not (Test-Path $zipArtifact)) { throw "Missing Windows release artifact: $zipArtifact" }
$extractDir = Join-Path ([IO.Path]::GetTempPath()) ("clipthat-release-" + [guid]::NewGuid())
try {
    Expand-Archive -Path $zipArtifact -DestinationPath $extractDir
    $packedExecutable = Get-ChildItem -Path $extractDir -Filter 'ClipThat.exe' -File -Recurse |
        Select-Object -First 1
    if ($null -eq $packedExecutable) {
        throw "$zipArtifact does not contain ClipThat.exe"
    }
    $packedSignature = Get-AuthenticodeSignature $packedExecutable.FullName
    if ($packedSignature.Status -ne 'Valid') {
        throw "ClipThat.exe inside $zipArtifact has Authenticode status $($packedSignature.Status), not Valid"
    }
    if ($null -eq $packedSignature.TimeStamperCertificate) {
        throw "ClipThat.exe inside $zipArtifact is signed but has no trusted timestamp"
    }
    $packedFfmpeg = Get-ChildItem -Path $extractDir -Filter 'ffmpeg.exe' -File -Recurse |
        Where-Object { $_.FullName -match '@ffmpeg-installer[\\/]win32-x64' } |
        Select-Object -First 1
    if ($null -eq $packedFfmpeg) {
        throw "$zipArtifact does not contain the Windows x64 FFmpeg binary"
    }
    & $packedFfmpeg.FullName -version | Select-Object -First 1
    if ($LASTEXITCODE -ne 0) {
        throw "FFmpeg inside $zipArtifact did not run successfully"
    }
} finally {
    if (Test-Path $extractDir) { Remove-Item -Path $extractDir -Recurse -Force }
}

$checksums = foreach ($artifact in $artifacts) {
    $hash = Get-FileHash -Algorithm SHA256 $artifact
    "$($hash.Hash.ToLowerInvariant())  $([IO.Path]::GetFileName($artifact))"
}
$checksumPath = "dist/ClipThat-$version-windows-SHA256SUMS.txt"
Set-Content -Path $checksumPath -Value $checksums -Encoding ascii

Write-Host "Verified ClipThat $version: signed and timestamped Windows x64 installer, portable build, and ZIP."
Write-Host "Wrote $checksumPath"
